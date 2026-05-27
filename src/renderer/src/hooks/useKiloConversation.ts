/**
 * Kilo Code 风格对话 Hook
 * 完全复刻 Kilo Code 的交互逻辑
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { useKiloStore, KiloMessage, KiloToolCall, TextBlock, ToolCallBlock } from '../store/kiloStore'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'

// 流式响应块类型
type StreamBlock = 
  | { type: 'content'; content: string }
  | { type: 'tool_call'; toolCall: KiloToolCall }
  | { type: 'tool_result'; toolCallId: string; result: unknown }
  | { type: 'reasoning'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'text'; content: string }

interface UseKiloConversationOptions {
  apiKey: string
  model: string
  projectPath?: string
}

// CLI Chat IPC API 类型
interface CliChatApi {
  createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  sendMessage: (sessionId: string, message: string, messages?: Array<{ role: string; content: string; name?: string }>, model?: string) => Promise<{ success: boolean; error?: string }>
  onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
}

export function useKiloConversation(options: UseKiloConversationOptions) {
  const { apiKey, model, projectPath } = options
  
  const store = useKiloStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // 使用 ref 存储最新的 model 值，确保发送消息时使用最新值
  const modelRef = useRef(model)
  useEffect(() => {
    modelRef.current = model
  }, [model])
  
  // 清理函数
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [])
  
  // 定期自动保存（每30秒）
  useEffect(() => {
    if (!projectPath) return
    
    const interval = setInterval(() => {
      if (store.messages.length > 0 && !store.isGenerating) {
        saveCurrentConversation()
      }
    }, 30000)
    
    return () => clearInterval(interval)
  }, [projectPath, store.messages.length, store.isGenerating])
  
  // 生成系统提示词
  const generateSystemPrompt = useCallback((mode: AgentMode) => {
    const config = AGENT_MODE_CONFIGS[mode]
    const basePrompt = config.systemPrompt
    
    const contextPrompt = projectPath 
      ? `\n\n当前项目路径: ${projectPath}`
      : ''
    
    const toolPrompt = config.allowedTools.length > 0
      ? `\n\n可用工具:\n${config.allowedTools.map(t => `- ${t}`).join('\n')}`
      : ''
    
    return `${basePrompt}${contextPrompt}${toolPrompt}`
  }, [projectPath])
  
  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || store.isGenerating) return
    
    setError(null)
    
    // 创建用户消息
    const userMessage: KiloMessage = {
      id: uuidv4(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      mode: store.currentMode
    }
    
    store.addMessage(userMessage)
    store.setInput('')
    
    // 创建 AI 消息占位 - 使用 blocks 支持内联工具调用
    const assistantMessageId = uuidv4()
    const initialTextBlock: TextBlock = {
      id: uuidv4(),
      type: 'text',
      content: '',
      timestamp: Date.now()
    }
    const assistantMessage: KiloMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      mode: store.currentMode,
      blocks: [initialTextBlock],
      toolCalls: []
    }
    
    store.addMessage(assistantMessage)
    store.startStreaming(assistantMessageId)
    
    // 准备请求
    const messages = store.messages
      .filter(m => m.id !== assistantMessageId)
      .map(m => ({
        role: m.role,
        content: m.content
      }))
    
    // 添加系统提示词
    const systemPrompt = generateSystemPrompt(store.currentMode)
    messages.unshift({ role: 'system', content: systemPrompt })
    
    // 创建 AbortController
    abortControllerRef.current = new AbortController()
    
    try {
      // 获取 IPC API
      const ipcApi = (window as unknown as {
        api?: {
          cliChat?: CliChatApi
        }
      }).api

      if (!ipcApi?.cliChat) {
        throw new Error('CLI Chat IPC API not available')
      }

      // 创建会话
      const mode = store.currentMode === 'ask' ? 'chat' : 'agent'
      const cwd = projectPath || '/'
      const createResult = await ipcApi.cliChat.createSession(mode, cwd)
      if (!createResult.success || !createResult.sessionId) {
        throw new Error(createResult.error || 'Failed to create CLI session')
      }

      const sessionId = createResult.sessionId
      
      // 设置流式监听 - 支持内联工具调用
      const unsubscribe = ipcApi.cliChat.onStreamChunk((_event, data) => {
        if (data.sessionId !== sessionId) return
        
        const chunk = data.chunk
        
        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              // 使用 appendTextToLastBlock 追加到当前文本块
              store.appendTextToLastBlock(assistantMessageId, chunk.content)
              // 同时更新 content 字段保持兼容
              const currentMsg = store.messages.find(m => m.id === assistantMessageId)
              if (currentMsg) {
                const textBlocks = currentMsg.blocks?.filter(b => b.type === 'text') as TextBlock[] || []
                const fullContent = textBlocks.map(b => b.content).join('')
                store.updateMessage(assistantMessageId, { content: fullContent })
              }
            }
            break
            
          case 'tool_call':
            if (chunk.toolCall) {
              const toolCall: KiloToolCall = {
                id: chunk.toolCall.id || uuidv4(),
                name: chunk.toolCall.name,
                args: chunk.toolCall.arguments || {},
                status: 'running',
                timestamp: Date.now()
              }
              // 添加到 toolCalls 数组
              store.addToolCall(assistantMessageId, toolCall)
              // 同时添加为内联内容块
              const toolBlock: ToolCallBlock = {
                id: uuidv4(),
                type: 'tool_call',
                toolCall: toolCall,
                timestamp: Date.now()
              }
              store.addContentBlock(assistantMessageId, toolBlock)
            }
            break
            
          case 'tool_result':
            if (chunk.toolResult) {
              const currentMsg = store.messages.find(m => m.id === assistantMessageId)
              const toolCallId = chunk.toolResult.toolCallId
              
              // 更新 toolCalls 中的状态 - 通过 toolCallId 精确匹配
              if (toolCallId && currentMsg?.toolCalls) {
                const toolCall = currentMsg.toolCalls.find(t => t.id === toolCallId)
                if (toolCall) {
                  store.updateToolCall(assistantMessageId, toolCall.id, {
                    status: chunk.toolResult.success ? 'completed' : 'failed',
                    result: chunk.toolResult.output,
                    error: chunk.toolResult.error,
                    duration: Date.now() - toolCall.timestamp
                  })
                }
              }
              
              // 更新 blocks 中的工具调用状态 - 通过 toolCallId 精确匹配
              if (currentMsg?.blocks) {
                const toolBlock = currentMsg.blocks.find(
                  b => b.type === 'tool_call' && (b as ToolCallBlock).toolCall.id === toolCallId
                ) as ToolCallBlock | undefined
                if (toolBlock) {
                  store.updateContentBlock(assistantMessageId, toolBlock.id, {
                    toolCall: {
                      ...toolBlock.toolCall,
                      status: chunk.toolResult.success ? 'completed' : 'failed',
                      result: chunk.toolResult.output,
                      error: chunk.toolResult.error,
                      duration: Date.now() - toolBlock.toolCall.timestamp
                    }
                  })
                }
              }
            }
            break
            
          case 'error':
            console.error('[useKiloConversation] Error chunk:', chunk.error)
            const errorMsg = chunk.error || 'Unknown error'
            const currentContent = store.messages.find(m => m.id === assistantMessageId)?.content || ''
            
            // 判断错误类型
            let errorType: 'model' | 'network' | 'api' | 'unknown' = 'unknown'
            if (errorMsg.includes('model') && errorMsg.includes('not supported')) {
              errorType = 'model'
            } else if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
              errorType = 'network'
            } else if (errorMsg.includes('API error') || errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('429')) {
              errorType = 'api'
            }
            
            // 设置全局错误状态，用于显示错误提示
            store.setError(errorMsg, errorType)
            
            // 更新消息内容
            store.updateMessage(assistantMessageId, {
              content: currentContent + `\n\n❌ **错误：** ${errorMsg}`,
              isStreaming: false
            })
            store.stopStreaming()
            break
            
          case 'done':
            console.log('[useKiloConversation] Conversation complete')
            store.updateMessage(assistantMessageId, {
              isStreaming: false
            })
            store.stopStreaming()
            
            // 更新会话
            if (store.currentSession) {
              store.updateSession(store.currentSession, {
                messageCount: store.messages.length,
                updatedAt: Date.now()
              })
            }
            
            // 自动保存到项目目录
            saveCurrentConversation()
            
            // 取消订阅
            if (unsubscribeRef.current) {
              unsubscribeRef.current()
              unsubscribeRef.current = null
            }
            break
        }
      })
      
      unsubscribeRef.current = unsubscribe

      // 发送消息，传递当前选中的模型（使用 ref 确保是最新值）
      const userContent = content.trim()
      const currentModel = modelRef.current
      console.log('[useKiloConversation] Sending with model:', currentModel)
      const sendResult = await ipcApi.cliChat.sendMessage(sessionId, userContent, messages, currentModel)
      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Failed to send message')
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      
      // 判断错误类型
      let errorType: 'model' | 'network' | 'api' | 'unknown' = 'unknown'
      if (errorMessage.includes('model') && errorMessage.includes('not supported')) {
        errorType = 'model'
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
        errorType = 'network'
      } else if (errorMessage.includes('API error') || errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('429')) {
        errorType = 'api'
      }
      
      // 设置全局错误状态
      store.setError(errorMessage, errorType)
      
      store.updateMessage(assistantMessageId, {
        content: `❌ **错误：** ${errorMessage}`,
        isStreaming: false
      })
      store.stopStreaming()
      
      // 取消订阅
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [store, apiKey, generateSystemPrompt])
  
  // 停止生成
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    if (store.streamingMessageId) {
      store.updateMessage(store.streamingMessageId, {
        isStreaming: false
      })
      store.stopStreaming()
    }
  }, [store])
  
  // 保存当前对话到项目目录
  const saveCurrentConversation = useCallback(async () => {
    if (!projectPath || !window.api?.saveConversation) return
    
    const session = store.sessions.find(s => s.id === store.currentSession)
    if (!session) return
    
    try {
      // 更新会话的 updatedAt 和时间戳
      const now = Date.now()
      store.updateSession(session.id, {
        messageCount: store.messages.length,
        updatedAt: now
      })
      
      const messagesToSave = store.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        mode: m.mode,
        blocks: m.blocks,
        toolCalls: m.toolCalls,
        reasoning: m.reasoning
      }))
      
      // 保存到文件（主进程会自动更新 updatedAt）
      await window.api.saveConversation(projectPath, session.id, messagesToSave, session.title)
      console.log('[useKiloConversation] Conversation saved successfully')
    } catch (err) {
      console.error('[useKiloConversation] Failed to save conversation:', err)
    }
  }, [store, projectPath])
  
  // 创建新会话
  const createSession = useCallback((title?: string) => {
    const session: import('../store/kiloStore').KiloSession = {
      id: uuidv4(),
      title: title || 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      mode: store.currentMode
    }
    
    store.addSession(session)
    store.clearMessages()
    
    return session.id
  }, [store])
  
  // 切换会话
  const switchSession = useCallback((sessionId: string) => {
    store.setCurrentSession(sessionId)
    // TODO: 加载会话消息
  }, [store])
  
  // 删除会话
  const deleteSession = useCallback((sessionId: string) => {
    store.deleteSession(sessionId)
  }, [store])
  
  // 清空当前会话
  const clearCurrentSession = useCallback(() => {
    store.clearMessages()
    if (store.currentSession) {
      store.updateSession(store.currentSession, {
        messageCount: 0,
        updatedAt: Date.now()
      })
    }
  }, [store])
  
  return {
    // 状态
    messages: store.messages,
    sessions: store.sessions,
    currentSession: store.currentSession,
    currentMode: store.currentMode,
    input: store.input,
    isGenerating: store.isGenerating,
    streamingMessageId: store.streamingMessageId,
    error,
    
    // Actions
    sendMessage,
    stopGeneration,
    createSession,
    switchSession,
    deleteSession,
    clearCurrentSession,
    saveConversation: saveCurrentConversation,
    setInput: store.setInput,
    setCurrentMode: store.setCurrentMode
  }
}
