/**
 * useConversation Hook - 统一对话管理
 * 参考 claw-code 架构，替换 useAgentMode 和 useChatMode
 */

import { useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { ConversationRuntime, type ApiClient, type ToolExecutor } from '../services/conversation-runtime'
import {
  MessageRole,
  AssistantEventType,
  type ConversationMessage,
  type AssistantEvent,
  type Session,
  type TurnResult
} from '../../../shared/types/conversation'
import { executeTool } from '../services/tool-client'
import { useStore } from '../store'

interface UseConversationOptions {
  cwd: string
  systemPrompt: string
  maxIterations?: number
  maxContextMessages?: number
}

interface UseConversationReturn {
  sendMessage: (content: string) => AsyncGenerator<AssistantEvent, TurnResult, unknown>
  abort: () => void
  getSession: () => Session
}

export function useConversation(options: UseConversationOptions): UseConversationReturn {
  const { cwd, systemPrompt, maxIterations = 16, maxContextMessages = 20 } = options
  const { addMessage, updateTokens } = useStore()

  // 使用 ref 保持会话状态
  const sessionRef = useRef<Session>({
    id: uuidv4(),
    messages: [{
      role: MessageRole.System,
      content: systemPrompt,
      timestamp: Date.now()
    }],
    cwd,
    mode: 'agent',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  const runtimeRef = useRef<ConversationRuntime | null>(null)

  /**
   * 创建 API Client
   */
  const createApiClient = useCallback((): ApiClient => {
    return {
      async *stream(messages, systemPrompt) {
        // 调用后端 IPC 获取流式响应
        const ipcApi = (window as unknown as {
          api?: {
            cliChat?: {
              createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
              sendMessage: (sessionId: string, message: string, messages?: Array<{ role: string; content: string; name?: string }>) => Promise<{ success: boolean; error?: string }>
              onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
            }
          }
        }).api

        if (!ipcApi?.cliChat) {
          throw new Error('CLI Chat IPC not available')
        }

        // 创建临时会话
        const createResult = await ipcApi.cliChat.createSession('agent', cwd)
        if (!createResult.success || !createResult.sessionId) {
          throw new Error(createResult.error || 'Failed to create session')
        }

        const sessionId = createResult.sessionId

        // 转换消息格式
        const apiMessages = messages.map(m => ({
          role: m.role,
          content: m.content,
          name: m.toolName
        }))

        // 获取最后一条用户消息
        const lastUserMessage = messages.filter(m => m.role === MessageRole.User).pop()
        const message = lastUserMessage?.content || ''

        // 设置流式监听
        const streamChunks: any[] = []
        let streamResolve: (() => void) | null = null
        let streamPromise = new Promise<void>(resolve => { streamResolve = resolve })

        const unsubscribe = ipcApi.cliChat.onStreamChunk((_event, data) => {
          if (data.sessionId === sessionId) {
            streamChunks.push(data.chunk)
            if (data.chunk.type === 'done' || data.chunk.type === 'error') {
              streamResolve?.()
            }
          }
        })

        // 发送消息
        const sendResult = await ipcApi.cliChat.sendMessage(sessionId, message, apiMessages)
        if (!sendResult.success) {
          unsubscribe()
          throw new Error(sendResult.error || 'Failed to send message')
        }

        // 等待流式响应
        await streamPromise
        unsubscribe()

        // 转换 chunk 为 AssistantEvent
        for (const chunk of streamChunks) {
          if (chunk.type === 'text') {
            yield { type: AssistantEventType.TextDelta, textDelta: chunk.content }
          } else if (chunk.type === 'tool_call') {
            yield {
              type: AssistantEventType.ToolUse,
              toolUse: {
                id: chunk.toolCall?.id || uuidv4(),
                name: chunk.toolCall?.name || '',
                arguments: JSON.parse(chunk.toolCall?.arguments || '{}')
              }
            }
          } else if (chunk.type === 'tool_result') {
            yield {
              type: AssistantEventType.ToolResult,
              toolResult: {
                toolCallId: chunk.toolResult?.toolCallId || '',
                toolName: chunk.toolResult?.toolName || '',
                output: chunk.toolResult?.output || '',
                isError: !chunk.toolResult?.success
              }
            }
          } else if (chunk.type === 'error') {
            yield { type: AssistantEventType.Error, error: chunk.error }
          } else if (chunk.type === 'done') {
            yield { type: AssistantEventType.MessageStop }
          }
        }
      }
    }
  }, [cwd])

  /**
   * 创建 Tool Executor
   */
  const createToolExecutor = useCallback((): ToolExecutor => {
    return {
      async execute(toolName, args, cwd) {
        const result = await executeTool(toolName, args, { cwd })
        return {
          output: result.output || result.error || 'No output',
          isError: !result.success
        }
      }
    }
  }, [])

  /**
   * 发送消息
   */
  const sendMessage = useCallback(async function* (content: string) {
    // 添加用户消息到 UI
    addMessage({
      role: 'user',
      content,
      timestamp: Date.now()
    })

    // 添加空的助手消息
    addMessage({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    })

    // 创建 Runtime
    const apiClient = createApiClient()
    const toolExecutor = createToolExecutor()

    runtimeRef.current = new ConversationRuntime(
      sessionRef.current,
      apiClient,
      toolExecutor,
      {
        maxIterations,
        maxContextMessages,
        systemPrompt
      }
    )

    // 运行对话
    let fullContent = ''

    try {
      const result = yield* runtimeRef.current.runTurn(content)

      // 更新 tokens
      updateTokens(
        result.usage.inputTokens,
        result.usage.outputTokens
      )

      return result
    } finally {
      runtimeRef.current = null
    }
  }, [addMessage, createApiClient, createToolExecutor, maxIterations, maxContextMessages, systemPrompt, updateTokens])

  /**
   * 中断对话
   */
  const abort = useCallback(() => {
    runtimeRef.current?.abort()
  }, [])

  /**
   * 获取会话
   */
  const getSession = useCallback(() => {
    return sessionRef.current
  }, [])

  return {
    sendMessage,
    abort,
    getSession
  }
}
