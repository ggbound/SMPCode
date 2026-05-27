/**
 * Conversation Runtime - 对话运行时
 * 参考 claw-code 架构，提供统一的对话管理能力
 */

import { v4 as uuidv4 } from 'uuid'
import {
  MessageRole,
  AssistantEventType,
  type ConversationMessage,
  type ContentBlock,
  type AssistantEvent,
  type ToolCall,
  type ToolResult,
  type TurnResult,
  type ConversationConfig,
  type Session
} from '../../../shared/types/conversation'

export interface ApiClient {
  stream(messages: ConversationMessage[], systemPrompt: string): AsyncGenerator<AssistantEvent>
}

export interface ToolExecutor {
  execute(toolName: string, args: Record<string, unknown>, cwd: string): Promise<{ output: string; isError: boolean }>
}

export class ConversationRuntime {
  private session: Session
  private apiClient: ApiClient
  private toolExecutor: ToolExecutor
  private config: ConversationConfig
  private abortController: AbortController | null = null

  constructor(
    session: Session,
    apiClient: ApiClient,
    toolExecutor: ToolExecutor,
    config: ConversationConfig
  ) {
    this.session = session
    this.apiClient = apiClient
    this.toolExecutor = toolExecutor
    this.config = config
  }

  /**
   * 运行单轮对话（支持多工具调用）
   */
  async *runTurn(userInput: string): AsyncGenerator<AssistantEvent, TurnResult, unknown> {
    // 1. 添加用户消息
    const userMessage: ConversationMessage = {
      role: MessageRole.User,
      content: userInput,
      timestamp: Date.now()
    }
    this.session.messages.push(userMessage)
    this.session.updatedAt = Date.now()

    // 2. 创建 AbortController
    this.abortController = new AbortController()

    const assistantMessages: ConversationMessage[] = []
    const toolCalls: ToolCall[] = []
    const toolResults: ToolResult[] = []
    let iterations = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    try {
      while (iterations < this.config.maxIterations) {
        iterations++

        // 3. 构建上下文（压缩历史消息）
        const contextMessages = this.buildContext()

        // 4. 调用 LLM API
        let assistantMessage: ConversationMessage | null = null
        let pendingToolCalls: ToolCall[] = []
        const collectedEvents: AssistantEvent[] = []

        for await (const event of this.apiClient.stream(contextMessages, this.config.systemPrompt)) {
          // 检查是否被中断
          if (this.abortController?.signal.aborted) {
            yield { type: AssistantEventType.Error, error: 'User aborted' }
            return {
              messages: assistantMessages,
              toolCalls,
              toolResults,
              usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
              stopReason: 'user_abort'
            }
          }

          collectedEvents.push(event)
          yield event

          // 收集工具调用
          if (event.type === AssistantEventType.ToolUse && event.toolUse) {
            pendingToolCalls.push(event.toolUse)
          }

          // 收集使用量
          if (event.type === AssistantEventType.Usage && event.usage) {
            totalInputTokens += event.usage.inputTokens
            totalOutputTokens += event.usage.outputTokens
          }

          // 构建助手消息
          if (event.type === AssistantEventType.MessageStop) {
            assistantMessage = this.buildAssistantMessageFromEvents(collectedEvents)
          }
        }

        if (!assistantMessage) {
          throw new Error('Assistant message not received')
        }

        // 5. 添加助手消息到会话
        this.session.messages.push(assistantMessage)
        assistantMessages.push(assistantMessage)
        this.session.updatedAt = Date.now()

        // 6. 检查是否有工具调用
        if (pendingToolCalls.length === 0) {
          // 没有工具调用，结束本轮
          return {
            messages: assistantMessages,
            toolCalls,
            toolResults,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            stopReason: 'completed'
          }
        }

        // 7. 执行工具调用
        for (const toolCall of pendingToolCalls) {
          toolCalls.push(toolCall)

          yield {
            type: AssistantEventType.ToolResult,
            toolResult: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              output: 'Executing...',
              isError: false
            }
          }

          const result = await this.toolExecutor.execute(
            toolCall.name,
            toolCall.arguments,
            this.session.cwd
          )

          const toolResult: ToolResult = {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            output: result.output,
            isError: result.isError
          }
          toolResults.push(toolResult)

          // 8. 添加工具结果到会话（tool 角色）
          const toolMessage: ConversationMessage = {
            role: MessageRole.Tool,
            content: result.output,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            timestamp: Date.now()
          }
          this.session.messages.push(toolMessage)
          this.session.updatedAt = Date.now()

          yield {
            type: AssistantEventType.ToolResult,
            toolResult
          }
        }

        // 9. 继续循环，让 LLM 处理工具结果
      }

      // 达到最大迭代次数
      return {
        messages: assistantMessages,
        toolCalls,
        toolResults,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        stopReason: 'max_iterations'
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      yield { type: AssistantEventType.Error, error: errorMessage }

      return {
        messages: assistantMessages,
        toolCalls,
        toolResults,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        stopReason: 'error'
      }
    }
  }

  /**
   * 中断对话
   */
  abort(): void {
    this.abortController?.abort()
  }

  /**
   * 获取当前会话
   */
  getSession(): Session {
    return this.session
  }

  /**
   * 构建上下文（压缩历史消息）
   */
  private buildContext(): ConversationMessage[] {
    const { maxContextMessages } = this.config
    const messages = this.session.messages

    if (messages.length <= maxContextMessages) {
      return messages
    }

    // 保留系统提示词和最近的消息
    const systemMessages = messages.filter(m => m.role === MessageRole.System)
    const recentMessages = messages.slice(-maxContextMessages)

    return [...systemMessages, ...recentMessages]
  }

  /**
   * 从事件构建助手消息
   */
  private buildAssistantMessageFromEvents(events: AssistantEvent[]): ConversationMessage {
    const blocks: ContentBlock[] = []
    let text = ''

    for (const event of events) {
      switch (event.type) {
        case AssistantEventType.TextDelta:
          if (event.textDelta) {
            text += event.textDelta
          }
          break
        case AssistantEventType.ToolUse:
          if (event.toolUse) {
            // 先刷新文本块
            if (text) {
              blocks.push({ type: 'text', text })
              text = ''
            }
            blocks.push({
              type: 'tool_use',
              toolUse: {
                id: event.toolUse.id,
                name: event.toolUse.name,
                input: JSON.stringify(event.toolUse.arguments)
              }
            })
          }
          break
      }
    }

    // 刷新剩余的文本
    if (text) {
      blocks.push({ type: 'text', text })
    }

    return {
      role: MessageRole.Assistant,
      content: blocks.map(b => {
        if (b.type === 'text') return b.text || ''
        if (b.type === 'tool_use') return `[Tool: ${b.toolUse?.name}]`
        return ''
      }).join(''),
      blocks,
      timestamp: Date.now()
    }
  }
}
