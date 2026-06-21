/**
 * 流式智能体 Hook - 参考 Kilo Code 和 Cursor 设计
 * 
 * 核心特性：
 * 1. 流式消息处理
 * 2. 内联工具调用
 * 3. 自动迭代
 * 4. 清晰的错误处理
 */

import { useCallback, useRef, useState } from 'react'
import { useKiloStore, type KiloMessage, type KiloToolCall, type ContentBlock } from '../store/kiloStore'
import type { StreamEvent, StreamEventType } from '../services/streaming-conversation'
import { parseToolCalls as parseToolCallsUtil, cleanToolCallBlocks as cleanToolCallBlocksUtil } from '../utils/toolParser'

interface UseStreamingAgentOptions {
  cwd: string
  model: string
  maxIterations?: number
}

interface UseStreamingAgentReturn {
  messages: KiloMessage[]
  isGenerating: boolean
  currentMessageId: string | null
  sendMessage: (content: string) => Promise<void>
  stopGeneration: () => void
  retryLastMessage: () => Promise<void>
  clearMessages: () => void
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// 创建文本块
function createTextBlock(content: string): ContentBlock {
  return {
    id: generateId(),
    type: 'text',
    content,
    timestamp: Date.now()
  }
}

// 创建工具调用块
function createToolCallBlock(toolCall: KiloToolCall): ContentBlock {
  return {
    id: generateId(),
    type: 'tool_call',
    toolCall,
    timestamp: Date.now()
  }
}

// 创建工具结果块
function createToolResultBlock(
  toolCallId: string,
  result: unknown,
  error?: string
): ContentBlock {
  return {
    id: generateId(),
    type: 'tool_result',
    toolCallId,
    result,
    error,
    timestamp: Date.now()
  }
}

// 创建思考块
function createThinkingBlock(content: string): ContentBlock {
  return {
    id: generateId(),
    type: 'thinking',
    content,
    timestamp: Date.now()
  }
}

// 创建工具调用对象
function createToolCall(name: string, args: Record<string, unknown>): KiloToolCall {
  return {
    id: generateId(),
    name,
    args,
    status: 'pending',
    timestamp: Date.now()
  }
}

// 解析工具调用 - 使用共享模块
function parseToolCalls(content: string): Array<{ name: string; args: Record<string, unknown> }> {
  const result = parseToolCallsUtil(content)
  return result?.map(tc => ({ name: tc.tool, args: tc.arguments })) || []
}

// 清理工具调用标记 - 使用共享模块
function cleanToolCallMarkers(content: string): string {
  return cleanToolCallBlocksUtil(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function useStreamingAgent(options: UseStreamingAgentOptions): UseStreamingAgentReturn {
  const { cwd, model, maxIterations = 10 } = options
  
  const store = useKiloStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const iterationCountRef = useRef(0)
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null)
  
  // 创建 CLI 会话
  const createSession = useCallback(async (mode: 'chat' | 'agent'): Promise<string> => {
    try {
      const result = await window.api?.cliChat?.createSession(mode, cwd)
      if (result?.success && result.sessionId) {
        sessionIdRef.current = result.sessionId
        return result.sessionId
      }
      throw new Error(result?.error || 'Failed to create session')
    } catch (error) {
      console.error('[useStreamingAgent] Failed to create session:', error)
      throw error
    }
  }, [cwd])
  
  // 发送消息到 CLI
  const sendToCLI = useCallback(async (
    sessionId: string,
    content: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      
      // 设置流式监听
      const cleanup = window.api?.cliChat?.onStreamChunk?.((event: unknown, data: {
        sessionId: string
        chunk: StreamEvent
      }) => {
        if (data.sessionId !== sessionId) return
        
        if (abortController.signal.aborted) {
          cleanup?.()
          reject(new Error('Aborted'))
          return
        }
        
        handleStreamEvent(data.chunk)
        
        if (data.chunk.type === 'done' || data.chunk.type === 'error') {
          cleanup?.()
          if (data.chunk.type === 'error') {
            reject(new Error(data.chunk.error || 'Stream error'))
          } else {
            resolve()
          }
        }
      })
      
      // 发送消息
      window.api?.cliChat?.sendMessage(sessionId, content, messages).catch(reject)
    })
  }, [])
  
  // 处理流式事件
  const handleStreamEvent = useCallback((event: StreamEvent) => {
    const currentMsgId = currentMessageId
    if (!currentMsgId) return
    
    switch (event.type) {
      case 'text_delta':
        if (event.content) {
          store.appendTextToLastBlock(currentMsgId, event.content)
        }
        break
        
      case 'tool_call':
        if (event.toolCall) {
          const toolCall = createToolCall(event.toolCall.name, event.toolCall.args)
          const block = createToolCallBlock(toolCall)
          store.addContentBlock(currentMsgId, block)
        }
        break
        
      case 'tool_result':
        if (event.toolResult) {
          const block = createToolResultBlock(
            event.toolResult.toolCallId,
            event.toolResult.output,
            event.toolResult.error
          )
          store.addContentBlock(currentMsgId, block)
          
          // 更新工具调用状态
          store.updateToolCall(currentMsgId, event.toolResult.toolCallId, {
            status: event.toolResult.success ? 'completed' : 'failed',
            result: event.toolResult.output,
            error: event.toolResult.error,
            duration: Date.now() - (store.messages
              .find(m => m.id === currentMsgId)
              ?.toolCalls?.find(tc => tc.id === event.toolResult!.toolCallId)
              ?.timestamp || Date.now())
          })
        }
        break
        
      case 'thinking':
        if (event.content) {
          const block = createThinkingBlock(event.content)
          store.addContentBlock(currentMsgId, block)
        }
        break
        
      case 'error':
        console.error('[useStreamingAgent] Stream error:', event.error)
        break
    }
  }, [currentMessageId, store])
  
  // 执行工具调用
  const executeTool = useCallback(async (toolCall: KiloToolCall): Promise<void> => {
    const currentMsgId = currentMessageId
    if (!currentMsgId) return
    
    // 更新工具状态为运行中
    store.updateToolCall(currentMsgId, toolCall.id, { status: 'running' })
    
    try {
      const result = await window.api?.executeTool?.(
        toolCall.id,
        toolCall.name,
        toolCall.args,
        cwd
      )
      
      // 添加工具结果块
      const resultBlock = createToolResultBlock(
        toolCall.id,
        result?.output || '',
        result?.error
      )
      store.addContentBlock(currentMsgId, resultBlock)
      
      // 更新工具调用状态
      store.updateToolCall(currentMsgId, toolCall.id, {
        status: result?.success ? 'completed' : 'failed',
        result: result?.output,
        error: result?.error,
        duration: Date.now() - toolCall.timestamp
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      
      // 添加错误结果块
      const resultBlock = createToolResultBlock(toolCall.id, '', errorMsg)
      store.addContentBlock(currentMsgId, resultBlock)
      
      // 更新工具调用状态
      store.updateToolCall(currentMsgId, toolCall.id, {
        status: 'failed',
        error: errorMsg,
        duration: Date.now() - toolCall.timestamp
      })
    }
  }, [cwd, currentMessageId, store])
  
  // 生成回复
  const generateResponse = useCallback(async (userContent: string) => {
    if (!sessionIdRef.current) {
      await createSession('agent')
    }
    
    const sessionId = sessionIdRef.current!
    iterationCountRef.current = 0
    
    // 创建助手消息
    const assistantMessage: KiloMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      blocks: []
    }
    
    setCurrentMessageId(assistantMessage.id)
    store.addMessage(assistantMessage)
    store.startStreaming(assistantMessage.id)
    setIsGenerating(true)
    
    try {
      // 准备消息历史
      const apiMessages = store.messages
        .slice(-20)
        .map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      
      // 发送消息并等待流式响应
      await sendToCLI(sessionId, userContent, apiMessages)
      
      // 检查是否需要继续（工具调用）
      const currentMsg = store.messages.find(m => m.id === assistantMessage.id)
      const hasToolCalls = currentMsg?.blocks?.some(b => b.type === 'tool_call')
      
      if (hasToolCalls && iterationCountRef.current < maxIterations) {
        // 执行工具调用并继续对话
        const toolCalls = currentMsg!.blocks!
          .filter(b => b.type === 'tool_call')
          .map(b => b.toolCall)
        
        for (const toolCall of toolCalls) {
          if (toolCall.status === 'pending') {
            await executeTool(toolCall)
          }
        }
        
        // 继续生成回复
        iterationCountRef.current++
        await generateResponse('请继续分析工具执行结果')
      }
    } catch (error) {
      console.error('[useStreamingAgent] Generation error:', error)
      store.setError(error instanceof Error ? error.message : String(error), 'unknown')
    } finally {
      store.stopStreaming()
      setIsGenerating(false)
    }
  }, [createSession, executeTool, maxIterations, sendToCLI, store])
  
  // 发送用户消息
  const sendMessage = useCallback(async (content: string) => {
    // 添加用户消息
    const userMessage: KiloMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    store.addMessage(userMessage)
    
    // 生成回复
    await generateResponse(content)
  }, [generateResponse, store])
  
  // 停止生成
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    store.stopStreaming()
    setIsGenerating(false)
    
    // 停止 CLI 会话
    if (sessionIdRef.current) {
      window.api?.cliChat?.stopSession(sessionIdRef.current)
    }
  }, [store])
  
  // 重试最后一条消息
  const retryLastMessage = useCallback(async () => {
    const messages = store.messages
    if (messages.length === 0) return
    
    // 找到最后一条用户消息
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUserMessage) return
    
    // 删除最后一条助手消息（如果有）
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role === 'assistant') {
      store.deleteMessage(lastMessage.id)
    }
    
    // 重新生成
    const content = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : lastUserMessage.content.map(c => c.type === 'text' ? c.text : '').join('')
    await generateResponse(content)
  }, [generateResponse, store])
  
  // 清空消息
  const clearMessages = useCallback(() => {
    store.clearMessages()
    sessionIdRef.current = null
    iterationCountRef.current = 0
  }, [store])
  
  return {
    messages: store.messages,
    isGenerating,
    currentMessageId,
    sendMessage,
    stopGeneration,
    retryLastMessage,
    clearMessages
  }
}

export default useStreamingAgent
