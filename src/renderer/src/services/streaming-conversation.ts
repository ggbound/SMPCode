/**
 * 流式对话服务 - 参考 Kilo Code 和 Cursor 的先进设计
 * 
 * 核心设计理念：
 * 1. 消息由多个内容块组成（文本、工具调用、工具结果）
 * 2. 工具调用内联显示，不是独立的消息
 * 3. 流式更新，实时反馈
 * 4. 清晰的协议，易于扩展
 */

import { v4 as uuidv4 } from 'uuid'
import type { KiloMessage, KiloToolCall, ContentBlock } from '../store/kiloStore'

// 流式事件类型
export type StreamEventType = 
  | 'text_delta'      // 文本增量
  | 'tool_call'       // 工具调用开始
  | 'tool_result'     // 工具执行结果
  | 'thinking'        // 思考过程
  | 'error'           // 错误
  | 'done'            // 完成

// 流式事件
export interface StreamEvent {
  type: StreamEventType
  id?: string          // 块 ID
  content?: string     // 文本内容
  toolCall?: {
    id: string
    name: string
    args: Record<string, unknown>
  }
  toolResult?: {
    toolCallId: string
    success: boolean
    output: string
    error?: string
  }
  error?: string
}

// 对话配置
export interface ConversationConfig {
  mode: 'chat' | 'agent'
  cwd: string
  model: string
  maxIterations?: number
}

// 对话状态
export interface ConversationState {
  messages: KiloMessage[]
  isStreaming: boolean
  currentMessageId: string | null
  iterationCount: number
}

// 工具定义
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, {
    type: string
    description: string
    required?: boolean
  }>
}

/**
 * 创建新的消息
 */
export function createMessage(role: 'user' | 'assistant', content: string = ''): KiloMessage {
  return {
    id: uuidv4(),
    role,
    content,
    timestamp: Date.now(),
    isStreaming: role === 'assistant',
    blocks: role === 'assistant' ? [] : undefined
  }
}

/**
 * 创建文本内容块
 */
export function createTextBlock(content: string): ContentBlock {
  return {
    id: uuidv4(),
    type: 'text',
    content,
    timestamp: Date.now()
  }
}

/**
 * 创建工具调用内容块
 */
export function createToolCallBlock(toolCall: KiloToolCall): ContentBlock {
  return {
    id: uuidv4(),
    type: 'tool_call',
    toolCall,
    timestamp: Date.now()
  }
}

/**
 * 创建工具结果内容块
 */
export function createToolResultBlock(
  toolCallId: string,
  result: unknown,
  error?: string
): ContentBlock {
  return {
    id: uuidv4(),
    type: 'tool_result',
    toolCallId,
    result,
    error,
    timestamp: Date.now()
  }
}

/**
 * 创建工具调用
 */
export function createToolCall(
  name: string,
  args: Record<string, unknown>
): KiloToolCall {
  return {
    id: uuidv4(),
    name,
    args,
    status: 'pending',
    timestamp: Date.now()
  }
}

/**
 * 解析 AI 响应中的工具调用
 * 支持格式：<tool name="..." param1="..." param2="..."/>
 */
export function parseToolCallsFromText(text: string): Array<{
  name: string
  args: Record<string, unknown>
}> {
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  
  // 匹配 <tool name="..." .../> 格式
  const toolRegex = /<tool\s+name="([^"]+)"([^\/>]*)\/>/g
  let match
  
  while ((match = toolRegex.exec(text)) !== null) {
    const toolName = match[1]
    const attrsContent = match[2]
    
    // 解析属性
    const args: Record<string, unknown> = {}
    const attrRegex = /(\w+)="([^"]*)"/g
    let attrMatch
    
    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      let value = attrMatch[2]
      // 处理转义字符
      value = value.replace(/\\"/g, '"').replace(/\\n/g, '\n')
      args[attrMatch[1]] = value
    }
    
    toolCalls.push({ name: toolName, args })
  }
  
  return toolCalls
}

/**
 * 清理消息内容中的工具调用标记
 */
export function cleanToolCallMarkers(content: string): string {
  return content
    // 移除 XML 格式的工具调用
    .replace(/<tool\s+name="[^"]+"[^\/>]*\/>\s*/g, '')
    // 移除 JSON 格式的工具调用
    .replace(/```json\s*\{\s*"tool"[\s\S]*?```/gi, '')
    // 移除多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 将消息转换为 API 格式
 */
export function messagesToApiFormat(
  messages: KiloMessage[],
  maxMessages: number = 20
): Array<{ role: string; content: string }> {
  const recentMessages = messages.slice(-maxMessages)
  
  return recentMessages.map(m => {
    // 如果有 blocks，需要特殊处理
    if (m.blocks && m.blocks.length > 0) {
      // 构建包含工具调用的内容
      let content = ''
      for (const block of m.blocks) {
        if (block.type === 'text') {
          content += block.content
        }
        // 工具调用和结果不放入 content，而是通过 tool_calls/tool 角色传递
      }
      return { role: m.role, content: content || m.content }
    }
    return { role: m.role, content: m.content }
  })
}

/**
 * 流式对话处理器
 */
export class StreamingConversation {
  private config: ConversationConfig
  private state: ConversationState
  private eventHandlers: Map<StreamEventType, ((event: StreamEvent) => void)[]>
  private abortController: AbortController | null = null

  constructor(config: ConversationConfig) {
    this.config = config
    this.state = {
      messages: [],
      isStreaming: false,
      currentMessageId: null,
      iterationCount: 0
    }
    this.eventHandlers = new Map()
  }

  /**
   * 注册事件处理器
   */
  on(event: StreamEventType, handler: (event: StreamEvent) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  /**
   * 触发事件
   */
  private emit(event: StreamEvent): void {
    const handlers = this.eventHandlers.get(event.type) || []
    for (const handler of handlers) {
      try {
        handler(event)
      } catch (e) {
        console.error('[StreamingConversation] Event handler error:', e)
      }
    }
  }

  /**
   * 开始对话
   */
  async start(userMessage: string): Promise<void> {
    // 添加用户消息
    const userMsg = createMessage('user', userMessage)
    this.state.messages.push(userMsg)
    
    // 开始生成回复
    await this.generateResponse()
  }

  /**
   * 生成 AI 回复
   */
  private async generateResponse(): Promise<void> {
    if (this.state.iterationCount >= (this.config.maxIterations || 10)) {
      this.emit({ type: 'error', error: '达到最大迭代次数' })
      return
    }

    this.state.iterationCount++
    this.state.isStreaming = true

    // 创建助手消息
    const assistantMsg = createMessage('assistant')
    this.state.currentMessageId = assistantMsg.id
    this.state.messages.push(assistantMsg)

    this.abortController = new AbortController()

    try {
      // 这里应该调用实际的 LLM API
      // 现在用模拟数据展示流程
      await this.simulateStreamResponse()
    } catch (error) {
      this.emit({ 
        type: 'error', 
        error: error instanceof Error ? error.message : String(error) 
      })
    } finally {
      this.state.isStreaming = false
      this.abortController = null
    }
  }

  /**
   * 模拟流式响应（实际实现中替换为真实 API 调用）
   */
  private async simulateStreamResponse(): Promise<void> {
    // 实际实现中，这里应该：
    // 1. 调用 LLM API 获取流式响应
    // 2. 解析响应中的文本和工具调用
    // 3. 触发相应的事件
    
    // 示例流程：
    // this.emit({ type: 'thinking', content: '分析用户请求...' })
    // this.emit({ type: 'text_delta', content: '我来帮你' })
    // this.emit({ type: 'tool_call', toolCall: { id: '...', name: 'read_file', args: {...} } })
    // ... 执行工具 ...
    // this.emit({ type: 'tool_result', toolResult: {...} })
    // this.emit({ type: 'text_delta', content: '文件内容是...' })
    // this.emit({ type: 'done' })
  }

  /**
   * 执行工具调用
   */
  async executeTool(
    toolCall: KiloToolCall
  ): Promise<{ success: boolean; output: string; error?: string }> {
    // 更新工具状态为运行中
    toolCall.status = 'running'
    this.emit({
      type: 'tool_call',
      toolCall: {
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args
      }
    })

    try {
      // 这里调用实际的工具执行
      // 通过 IPC 发送到主进程
      const result = await window.api?.executeTool?.(
        toolCall.id,
        toolCall.name,
        toolCall.args,
        this.config.cwd
      )

      if (result?.success) {
        toolCall.status = 'completed'
        toolCall.result = result.output
        toolCall.duration = Date.now() - toolCall.timestamp
        
        this.emit({
          type: 'tool_result',
          toolResult: {
            toolCallId: toolCall.id,
            success: true,
            output: result.output
          }
        })
        
        return { success: true, output: result.output }
      } else {
        throw new Error(result?.error || '工具执行失败')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      toolCall.status = 'failed'
      toolCall.error = errorMsg
      
      this.emit({
        type: 'tool_result',
        toolResult: {
          toolCallId: toolCall.id,
          success: false,
          output: '',
          error: errorMsg
        }
      })
      
      return { success: false, output: '', error: errorMsg }
    }
  }

  /**
   * 停止生成
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.state.isStreaming = false
  }

  /**
   * 获取当前状态
   */
  getState(): ConversationState {
    return { ...this.state }
  }

  /**
   * 获取所有消息
   */
  getMessages(): KiloMessage[] {
    return [...this.state.messages]
  }
}

// 导出便捷函数
export function createConversation(config: ConversationConfig): StreamingConversation {
  return new StreamingConversation(config)
}
