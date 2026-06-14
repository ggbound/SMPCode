/**
 * Kilo Code 风格对话 Hook
 * 完全复刻 Kilo Code 的交互逻辑
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { useKiloStore, KiloMessage, KiloSession, KiloToolCall, TextBlock, ToolCallBlock } from '../store/kiloStore'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'
import { executeTool } from '../services/tool-client'

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
  stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
}

export function useKiloConversation(options: UseKiloConversationOptions) {
  const { apiKey, model, projectPath } = options
  
  const store = useKiloStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const originalSessionIdRef = useRef<string | null>(null) // 保存发送消息时的会话ID
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
    
    // 如果当前没有会话，创建一个新会话（在发送第一条消息时）
    if (!store.currentSession && projectPath) {
      const sessionId = uuidv4()
      const sessionTitle = content.trim().slice(0, 50) // 使用用户输入的前50个字符作为标题
      
      const session: KiloSession = {
        id: sessionId,
        title: sessionTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        mode: store.currentMode
      }
      
      store.addSession(session)
      store.setCurrentSession(sessionId)
      console.log('[useKiloConversation] Created new session on first message:', sessionId)
    }
    
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
    
    // 记录发送消息时的会话ID，防止切换会话后保存到错误的会话
    originalSessionIdRef.current = store.currentSession
    console.log('[useKiloConversation] Recording original session ID:', originalSessionIdRef.current)
    
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
    
    // 准备请求 - 构建符合 OpenAI API 格式的消息历史
    const messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string }> = []
    
    // 添加系统提示词
    const systemPrompt = generateSystemPrompt(store.currentMode)
    messages.push({ role: 'system', content: systemPrompt })
    
    // 转换历史消息为 API 格式
    const historyMessages = store.messages.filter(m => m.id !== assistantMessageId)
    for (const msg of historyMessages) {
      if (msg.role === 'user') {
        // 用户消息
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        // 助手消息 - 检查是否包含工具调用
        // 清理 content 中可能包含的工具调用格式
        let cleanContent = msg.content || ''
        // 移除可能的工具调用 JSON 格式（如 file_read: "{"path": ...}"）
        cleanContent = cleanContent.replace(/\w+:\s*"\{[^}]*\}"/g, '')
        // 移除 Markdown 代码块中的工具调用 JSON
        cleanContent = cleanContent.replace(/```json\s*\n?\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?```/g, '')
        // 移除列表格式的工具调用描述（如 - file_read (...)）
        cleanContent = cleanContent.replace(/^\s*-\s+\w+\s*\([^)]*\)\s*$/gm, '')
        // 移除"我将使用以下工具"等提示文本
        cleanContent = cleanContent.replace(/我将使用以下工具[：:]\s*\n?/g, '')
        // 清理多余的空行
        cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim()
        
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // 只发送清理后的内容，不包含工具调用描述
          messages.push({ 
            role: 'assistant', 
            content: cleanContent || '我将分析并处理您的请求。'
          })
          
          // 添加工具结果作为 tool 角色消息
          for (const toolCall of msg.toolCalls) {
            if (toolCall.status === 'completed' || toolCall.status === 'failed') {
              messages.push({
                role: 'tool',
                content: String(toolCall.result || toolCall.error || ''),
                tool_call_id: toolCall.id
              })
            }
          }
        } else {
          // 普通助手消息
          messages.push({ role: 'assistant', content: cleanContent })
        }
      }
    }
    
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
      sessionIdRef.current = sessionId
      
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
            // ✅ 修复：前端不再执行工具，只显示工具调用状态
            // 工具执行由后端 cli-chat-service.ts 全权处理
            if (chunk.toolCall) {
              console.log('[useKiloConversation] ========== Tool Call Received (Backend will execute) ==========')
              console.log('[useKiloConversation] Tool name:', chunk.toolCall.name)
              console.log('[useKiloConversation] Tool arguments:', JSON.stringify(chunk.toolCall.arguments))
              
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
              
              // ✅ 不再在前端执行工具，等待后端发送 tool_result
              console.log('[useKiloConversation] Tool call registered, waiting for backend execution result...')
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
              
              // 将工具调用结果追加到消息内容中，让用户能看到结果
              const resultText = chunk.toolResult.success 
                ? `\n\n**工具执行结果：**\n\`\`\`\n${chunk.toolResult.output}\n\`\`\``
                : `\n\n**工具执行失败：**\n${chunk.toolResult.error || 'Unknown error'}`
              
              const currentContent = currentMsg?.content || ''
              store.updateMessage(assistantMessageId, {
                content: currentContent + resultText
              })
              
              // ✅ 文件操作完成后立即刷新资源管理器
              if (chunk.toolResult.success) {
                console.log('[useKiloConversation] Tool execution completed, triggering file tree refresh')
                window.dispatchEvent(new CustomEvent('file-operation-completed'))
              }
            }
            break
            
          case 'error':
            // ✅ 修复：忽略 AbortError，这是正常的取消操作（如应用退出时）
            if (chunk.error?.includes('aborted') || chunk.error?.includes('AbortError')) {
              console.debug('[useKiloConversation] Stream aborted (normal cleanup), ignoring')
              break
            }
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
            console.log('[useKiloConversation] Conversation complete', chunk)
            // 更新消息，包含 usage 数据
            const updateData: Partial<KiloMessage> = {
              isStreaming: false
            }
            if (chunk.usage) {
              console.log('[useKiloConversation] Updating message with usage:', chunk.usage)
              updateData.usage = {
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens
              }
            } else {
              console.log('[useKiloConversation] No usage data in done chunk')
            }
            store.updateMessage(assistantMessageId, updateData)
            
            // 验证消息是否更新成功
            const updatedMsg = store.messages.find(m => m.id === assistantMessageId)
            console.log('[useKiloConversation] Updated message usage:', updatedMsg?.usage)
            
            store.stopStreaming()
            
            // 更新会话
            if (store.currentSession) {
              store.updateSession(store.currentSession, {
                messageCount: store.messages.length,
                updatedAt: Date.now()
              })
            }
            
            // 自动保存到项目目录 - 延迟执行确保消息已更新
            setTimeout(() => {
              // 从 store 获取最新状态
              const currentStore = useKiloStore.getState()
              console.log('[useKiloConversation] Saving after done, messages count:', currentStore.messages.length)
              const msgToSave = currentStore.messages.find(m => m.id === assistantMessageId)
              console.log('[useKiloConversation] Message to save usage:', msgToSave?.usage)
              
              // 直接执行保存逻辑 - 使用原始会话ID，防止切换会话后保存到错误的会话
              const targetSessionId = originalSessionIdRef.current || currentStore.currentSession
              console.log('[useKiloConversation] Target session ID for saving:', targetSessionId, 'Original:', originalSessionIdRef.current, 'Current:', currentStore.currentSession)
              
              if (projectPath && window.api?.saveConversation && targetSessionId) {
                const session = currentStore.sessions.find(s => s.id === targetSessionId)
                if (session) {
                  const messagesToSave = currentStore.messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                    mode: m.mode,
                    blocks: m.blocks,
                    toolCalls: m.toolCalls,
                    reasoning: m.reasoning,
                    usage: m.usage
                  }))
                  console.log('[useKiloConversation] Direct saving conversation:', session.id, 'Messages:', messagesToSave.length)
                  window.api.saveConversation(projectPath, session.id, messagesToSave, session.title)
                    .then(() => {
                      console.log('[useKiloConversation] Direct save successful')
                      // ✅ AI对话完成后刷新资源管理器，让用户看到文件变化
                      console.log('[useKiloConversation] Triggering file tree refresh after AI conversation')
                      window.dispatchEvent(new CustomEvent('file-operation-completed'))
                    })
                    .catch(err => console.error('[useKiloConversation] Direct save failed:', err))
                } else {
                  console.error('[useKiloConversation] Session not found for saving:', targetSessionId)
                }
              }
            }, 100)
            
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
    
    // 调用后端停止会话
    if (sessionIdRef.current) {
      const ipcApi = (window as unknown as { api?: { cliChat?: CliChatApi } }).api?.cliChat
      if (ipcApi?.stopSession) {
        ipcApi.stopSession(sessionIdRef.current)
      }
      sessionIdRef.current = null
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
    
    // 跳过飞书专用对话会话，避免覆盖飞书消息
    // 检查会话ID是否以 feishu-session- 开头，或者标题包含飞书
    const isFeishuSession = session.id.startsWith('feishu-session-') || 
                            session.title?.includes('飞书') ||
                            session.title === '飞书专用对话'
    if (isFeishuSession) {
      console.log('[useKiloConversation] Skipping save for Feishu session:', session.id, 'Title:', session.title)
      return
    }
    
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
        reasoning: m.reasoning,
        usage: m.usage
      }))
      
      // 保存到文件（主进程会自动更新 updatedAt）
      console.log('[useKiloConversation] Saving conversation:', session.id, 'Title:', session.title, 'Messages:', messagesToSave.length)
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
