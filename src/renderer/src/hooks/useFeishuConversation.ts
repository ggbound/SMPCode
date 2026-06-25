/**
 * Feishu 对话 Hook
 * 基于 KiloConversation 但使用独立的 FeishuStore
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { useFeishuStore, FeishuMessage, FeishuSession, FeishuToolCall, FeishuImageContent } from '../store/feishuStore'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'
import { buildMultimodalContent } from '../App'

interface UseFeishuConversationOptions {
  apiKey: string
  model: string
  projectPath?: string
}

export function useFeishuConversation(options: UseFeishuConversationOptions) {
  const { apiKey, model, projectPath } = options
  
  // 使用 ref 存储 store，避免闭包问题
  const storeRef = useRef(useFeishuStore.getState())
  const abortControllerRef = useRef<AbortController | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // MemCoder 初始化 - 当项目路径变化时
  useEffect(() => {
    if (projectPath && window.api?.memcoder) {
      console.log('[useFeishuConversation] Initializing MemCoder for project:', projectPath)
      window.api.memcoder.initialize(projectPath).catch(err => {
        console.error('[useFeishuConversation] Failed to initialize MemCoder:', err)
      })
    }
  }, [projectPath])
  
  // 使用 ref 存储最新的 model 值
  const modelRef = useRef(model)
  useEffect(() => {
    modelRef.current = model
  }, [model])
  
  // 同步 store 到 ref
  useEffect(() => {
    const unsubscribe = useFeishuStore.subscribe((state) => {
      storeRef.current = state
    })
    return () => unsubscribe()
  }, [])
  
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
  
  // 生成系统提示词
  const generateSystemPrompt = useCallback(async (mode: AgentMode) => {
    const config = AGENT_MODE_CONFIGS[mode]
    let basePrompt = config.systemPrompt
    
    const contextPrompt = projectPath 
      ? `\n\n当前项目路径: ${projectPath}`
      : ''
    
    const toolPrompt = config.allowedTools.length > 0
      ? `\n\n可用工具:\n${config.allowedTools.map(t => `- ${t}`).join('\n')}`
      : ''
    
    const imagePrompt = `\n\n【图片处理说明】
用户可能会上传图片（截图、照片等）。当用户上传图片时，图片内容已经包含在对话中，你不需要去文件系统中查找图片文件。
直接分析用户上传的图片内容并回答问题即可。`;
    
    // 使用 MemCoder 增强提示词（如果可用）
    if (projectPath && window.api?.memcoder) {
      try {
        const result = await window.api.memcoder.getEnhancedPrompt(projectPath, basePrompt)
        if (result.success && result.prompt) {
          basePrompt = result.prompt
        }
      } catch (err) {
        console.error('[useFeishuConversation] Failed to get enhanced prompt from MemCoder:', err)
      }
    }
    
    return `${basePrompt}${contextPrompt}${toolPrompt}${imagePrompt}`
  }, [projectPath])
  
  // 发送消息
  const sendMessage = useCallback(async (content: string, images?: FeishuImageContent[]) => {
    const store = storeRef.current
    
    if ((!content.trim() && !images?.length) || store.isGenerating) {
      return
    }
    
    setError(null)
    
    // 如果当前没有会话，创建一个新会话
    if (!store.currentSession) {
      const sessionId = uuidv4()
      const sessionTitle = content.trim().slice(0, 50) || '图片对话'
      
      const session: FeishuSession = {
        id: sessionId,
        title: sessionTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        mode: store.currentMode
      }
      
      store.addSession(session)
      store.setCurrentSession(sessionId)
    }
    
    // 构建消息内容
    const messageContent = buildMultimodalContent(content, images)
    
    // 创建用户消息
    const userMessage: FeishuMessage = {
      id: uuidv4(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      mode: store.currentMode,
      images: images
    }
    
    store.addMessage(userMessage)
    store.setInput('')
    
    // 创建 AI 消息占位
    const assistantMessageId = uuidv4()
    const initialTextBlockId = uuidv4()
    const assistantMessage: FeishuMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      mode: store.currentMode,
      blocks: [{
        id: initialTextBlockId,
        type: 'text',
        content: '',
        timestamp: Date.now()
      }]
    }
    
    store.addMessage(assistantMessage)
    store.startStreaming(assistantMessageId)
    
    // 准备请求
    const messages: any[] = []
    
    // 添加系统提示词（异步获取，支持 MemCoder 增强）
    const systemPrompt = await generateSystemPrompt(store.currentMode)
    messages.push({ role: 'system', content: systemPrompt })
    
    // 获取 MemCoder 的相关历史上下文（如果可用）
    let memcoderContext = ''
    if (projectPath && window.api?.memcoder) {
      try {
        const result = await window.api.memcoder.getRelevantContext(projectPath, content, 3)
        if (result.success && result.context) {
          memcoderContext = result.context
        }
      } catch (err) {
        console.error('[useFeishuConversation] Failed to get relevant context from MemCoder:', err)
      }
    }
    
    // 如果有 MemCoder 上下文，添加到系统提示词之后
    if (memcoderContext) {
      messages.push({ role: 'system', content: memcoderContext })
    }
    
    // 添加当前用户消息
    let currentMessageContent: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>
    if (images && images.length > 0) {
      currentMessageContent = buildMultimodalContent(content, images)
    } else {
      currentMessageContent = content.trim()
    }
    
    messages.push({
      role: 'user',
      content: currentMessageContent
    })
    
    // 创建 AbortController
    abortControllerRef.current = new AbortController()
    
    try {
      // 获取 IPC API
      const ipcApi = (window as unknown as {
        api?: {
          cliChat?: {
            createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
            sendMessage: (sessionId: string, message: string, messages?: any[], model?: string) => Promise<{ success: boolean; error?: string }>
            stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
            onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
          }
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
      
      // 设置流式监听
      // 使用本地变量累加内容，避免闭包问题
      let accumulatedContent = ''
      const unsubscribe = ipcApi.cliChat.onStreamChunk((_event, data) => {
        if (data.sessionId !== sessionId) return
        
        const chunk = data.chunk
        // 每次都从最新状态获取 store
        const currentStore = useFeishuStore.getState()
        
        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              // 使用本地变量累加，避免依赖 store 中的旧状态
              accumulatedContent += chunk.content
              // 同时更新 blocks 数组（用于渲染）
              currentStore.appendTextToLastBlock(assistantMessageId, chunk.content)
              // 更新 content 字段
              currentStore.updateMessage(assistantMessageId, { content: accumulatedContent })
            }
            break
            
          case 'tool_call':
            if (chunk.toolCall) {
              const toolCall: FeishuToolCall = {
                id: chunk.toolCall.id || uuidv4(),
                name: chunk.toolCall.name,
                args: chunk.toolCall.arguments || {},
                status: 'running',
                timestamp: Date.now()
              }
              currentStore.addToolCall(assistantMessageId, toolCall)
            }
            break
            
          case 'tool_result':
            if (chunk.toolResult) {
              const latestStore = useFeishuStore.getState()
              const currentMsg = latestStore.messages.find(m => m.id === assistantMessageId)
              if (currentMsg?.toolCalls) {
                const toolCall = currentMsg.toolCalls.find(t => t.id === chunk.toolResult.toolCallId)
                if (toolCall) {
                  latestStore.updateToolCall(assistantMessageId, toolCall.id, {
                    status: chunk.toolResult.success ? 'completed' : 'failed',
                    result: chunk.toolResult.output,
                    error: chunk.toolResult.error,
                    duration: Date.now() - toolCall.timestamp
                  })
                }
              }
              
              // 工具结果不直接显示在消息中，只存储在 toolCall.result 中供 AI 参考
              // AI 的分析结果会通过后续的 'text' chunk 接收并显示
            }
            break
            
          case 'error':
            // 忽略 AbortError
            if (chunk.error?.includes('aborted') || chunk.error?.includes('AbortError')) {
              break
            }
            
            const errorMsg = chunk.error || 'Unknown error'
            
            // 所有错误都不应该停止 AI 对话，AI 会继续处理并返回最终结果
            // 只记录错误日志，不中断流式输出
            console.log('[useFeishuConversation] Error occurred but continuing conversation:', errorMsg)
            // 不追加错误信息到内容，不停止流式输出，让 AI 自行处理并返回结果
            break
            
          case 'done':
            const updateData: Partial<FeishuMessage> = {
              isStreaming: false,
              content: accumulatedContent
            }
            if (chunk.usage) {
              updateData.usage = {
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens
              }
            }
            currentStore.updateMessage(assistantMessageId, updateData)
            currentStore.stopStreaming()
            
            // 更新会话
            if (currentStore.currentSession) {
              currentStore.updateSession(currentStore.currentSession, {
                messageCount: currentStore.messages.length,
                updatedAt: Date.now()
              })
            }
            
            // ✅ 学习对话：使用 MemCoder 学习用户意图和文件变更
            setTimeout(() => {
              if (projectPath && window.api?.memcoder) {
                const currentStore = useFeishuStore.getState()
                
                // 找到用户最后一条消息作为意图
                const userMessages = currentStore.messages.filter(m => m.role === 'user')
                if (userMessages.length > 0) {
                  const lastUserMsg = userMessages[userMessages.length - 1]
                  
                  // 从最后一条用户消息中提取意图文本
                  let intentText = ''
                  if (typeof lastUserMsg.content === 'string') {
                    intentText = lastUserMsg.content
                  } else if (Array.isArray(lastUserMsg.content)) {
                    intentText = lastUserMsg.content
                      .filter(p => p.type === 'text')
                      .map(p => p.text || '')
                      .join('\n')
                  }
                  
                  // 提取工具调用中修改过的文件
                  const assistantMsg = currentStore.messages.find(m => m.id === assistantMessageId)
                  const modifiedFiles = new Set<string>()
                  
                  if (assistantMsg?.toolCalls) {
                    for (const toolCall of assistantMsg.toolCalls) {
                      const args = toolCall.args as Record<string, unknown>
                      if (toolCall.name === 'write_file' && args?.path && typeof args.path === 'string') {
                        modifiedFiles.add(args.path)
                      } else if (toolCall.name === 'edit_file' && args?.path && typeof args.path === 'string') {
                        modifiedFiles.add(args.path)
                      } else if (toolCall.name === 'delete_file' && args?.path && typeof args.path === 'string') {
                        modifiedFiles.add(args.path)
                      } else if (toolCall.name === 'search_replace' && args?.path && typeof args.path === 'string') {
                        modifiedFiles.add(args.path)
                      }
                    }
                  }
                  
                  // 如果有意图和修改的文件，进行学习
                  if (intentText.trim() && modifiedFiles.size > 0) {
                    console.log('[useFeishuConversation] Learning with MemCoder:', {
                      intent: intentText.substring(0, 100),
                      files: Array.from(modifiedFiles)
                    })
                    
                    window.api.memcoder.learnFromWork(
                      projectPath,
                      intentText,
                      Array.from(modifiedFiles)
                    ).catch(err => {
                      console.error('[useFeishuConversation] MemCoder learn failed:', err)
                    })
                  } else {
                    console.log('[useFeishuConversation] Skipping MemCoder learning:', {
                      hasIntent: !!intentText.trim(),
                      modifiedFiles: modifiedFiles.size
                    })
                  }
                }
              }
            }, 200)
            
            // 取消订阅
            if (unsubscribeRef.current) {
              unsubscribeRef.current()
              unsubscribeRef.current = null
            }
            break
        }
      })
      
      unsubscribeRef.current = unsubscribe

      // 发送消息
      const currentModel = modelRef.current
      await ipcApi.cliChat.sendMessage(sessionId, content.trim(), messages, currentModel)
      
    } catch (error) {
      console.error('[useFeishuConversation] Error:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)
      
      const currentStore = storeRef.current
      currentStore.updateMessage(assistantMessageId, {
        content: `❌ **错误：** ${errorMsg}`,
        isStreaming: false
      })
      currentStore.stopStreaming()
      setError(errorMsg)
    }
  }, [apiKey, model, projectPath])
  
  // 停止生成
  const stopGeneration = useCallback(() => {
    if (sessionIdRef.current) {
      const ipcApi = (window as unknown as {
        api?: {
          cliChat?: {
            stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
          }
        }
      }).api
      
      if (ipcApi?.cliChat) {
        ipcApi.cliChat.stopSession(sessionIdRef.current)
      }
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    storeRef.current.stopStreaming()
  }, [])
  
  // 清空消息
  const clearMessages = useCallback(() => {
    storeRef.current.clearMessages()
  }, [])
  
  // 添加消息（用于同步）
  const addMessage = useCallback((message: FeishuMessage) => {
    storeRef.current.addMessage(message)
  }, [])
  
  // 设置输入
  const setInput = useCallback((input: string) => {
    storeRef.current.setInput(input)
  }, [])
  
  // 清除错误
  const clearError = useCallback(() => {
    setError(null)
  }, [])
  
  // 从 store 获取当前状态
  const store = useFeishuStore()
  
  return {
    messages: store.messages,
    input: store.input,
    isGenerating: store.isGenerating,
    error,
    currentMode: store.currentMode,
    sendMessage,
    stopGeneration,
    clearMessages,
    addMessage,
    setInput,
    clearError
  }
}
