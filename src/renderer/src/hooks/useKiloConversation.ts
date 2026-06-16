/**
 * Kilo Code 风格对话 Hook
 * 完全复刻 Kilo Code 的交互逻辑
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { useKiloStore, KiloMessage, KiloSession, KiloToolCall, TextBlock, ToolCallBlock, ImageContent } from '../store/kiloStore'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'
import { executeTool } from '../services/tool-client'
import { buildMultimodalContent } from '../App'

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

// CLI Chat IPC 消息类型（与后端 LLMMessage 完全兼容）
interface CliChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

// CLI Chat IPC API 类型
interface CliChatApi {
  createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  sendMessage: (sessionId: string, message: string, messages?: CliChatMessage[], model?: string) => Promise<{ success: boolean; error?: string }>
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
    
    // 图片处理提示
    const imagePrompt = `\n\n【图片处理说明】
用户可能会上传图片（截图、照片等）。当用户上传图片时，图片内容已经包含在对话中，你不需要去文件系统中查找图片文件。
直接分析用户上传的图片内容并回答问题即可。`;
    
    return `${basePrompt}${contextPrompt}${toolPrompt}${imagePrompt}`
  }, [projectPath])
  
  // 发送消息
  const sendMessage = useCallback(async (content: string, images?: ImageContent[]) => {
    
    if ((!content.trim() && !images?.length) || store.isGenerating) {
      console.log('[useKiloConversation] sendMessage early return:', {
        noContent: !content.trim() && !images?.length,
        isGenerating: store.isGenerating
      })
      return
    }
    
    setError(null)
    
    // 如果当前没有会话，创建一个新会话（在发送第一条消息时）
    if (!store.currentSession && projectPath) {
      const sessionId = uuidv4()
      const sessionTitle = content.trim().slice(0, 50) || '图片对话' // 使用用户输入的前50个字符作为标题
      
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
    
    // 构建统一的内容格式（与后端 LLMMessage 完全兼容）
    // ✅ 使用 buildMultimodalContent 统一处理，确保图片 URL 格式正确
    const messageContent = buildMultimodalContent(content, images)
    
    // 创建用户消息（使用统一的 content 格式）
    const userMessage: KiloMessage = {
      id: uuidv4(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      mode: store.currentMode,
      images: images  // 保留 images 字段用于前端展示
    }
    
    if (Array.isArray(messageContent)) {
      messageContent.forEach((part, i) => {
        if (part.type === 'image_url') {
          
        } else {

        }
      })
    }
    console.log('[useKiloConversation] images field:', { 
      hasImages: !!images?.length, 
      imageCount: images?.length || 0 
    })
    console.log('[useKiloConversation] ========== END CREATE MESSAGE ==========')
    
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
    
    // 准备请求 - 构建符合 OpenAI API 格式的消息历史（与后端 LLMMessage 完全兼容）
    const messages: CliChatMessage[] = []
    
    // 添加系统提示词
    const systemPrompt = generateSystemPrompt(store.currentMode)
    messages.push({ role: 'system', content: systemPrompt })
    
    // 转换历史消息为 API 格式
    // ✅ 修复：限制消息历史长度，避免发送过多旧消息（特别是带图片的消息）
    const MAX_HISTORY_MESSAGES = 10  // 最多保留10条历史消息
    const allHistoryMessages = store.messages.filter(m => m.id !== assistantMessageId && m.id !== userMessage.id)
    // 只保留最近的消息（不包括当前用户消息，我们将单独添加）
    const historyMessages = allHistoryMessages.slice(-MAX_HISTORY_MESSAGES)
    
    if (allHistoryMessages.length > MAX_HISTORY_MESSAGES) {
      console.log(`[useKiloConversation] Truncated history messages from ${allHistoryMessages.length} to ${MAX_HISTORY_MESSAGES}`)
    }
    
    // DEBUG: 检查历史消息中用户消息的内容格式
    console.log('[useKiloConversation] History messages count (excluding current):', historyMessages.length)
    
    // ✅ 关键修复：先添加历史消息（旧消息，剥离图片），最后再添加当前用户消息
    // 这样保证 messages 数组按时间顺序排列，且当前用户消息是最后一条
    // 后端的重复检测会重置会话并重新添加"最后一条用户消息"，必须是包含图片的多模态消息
    
    // 先添加历史消息（旧消息，剥离图片）
    for (const msg of historyMessages) {
      if (msg.role === 'user') {
        // 用户消息 - 对于旧消息，只保留文本内容，不保留图片
        let messageContent = msg.content
        
        // ✅ 修复：旧的多模态消息，只提取文本部分，避免AI看到旧图片
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter(c => c.type === 'text').map(c => (c as {type: 'text', text: string}).text)
          messageContent = textParts.join('\n') || '[图片消息]'
          console.log(`[useKiloConversation] Stripped images from old user message ${msg.id}, keeping only text`)
        } else if (typeof msg.content === 'string' && msg.images && msg.images.length > 0) {
          // 旧消息有 images 字段但 content 是纯文本，只保留文本
          messageContent = msg.content
          console.log(`[useKiloConversation] Old message with images field, using text only:`, msg.id)
        }
        
        messages.push({ 
          role: 'user', 
          content: messageContent
        })
      } else if (msg.role === 'assistant') {
        // 助手消息 - 检查是否包含工具调用
        // 处理 content 格式：可能是 string 或 MessageContentPart[]
        let cleanContent = ''
        if (typeof msg.content === 'string') {
          cleanContent = msg.content
        } else {
          // 如果是数组格式，提取文本内容
          cleanContent = msg.content
            .filter(p => p.type === 'text')
            .map(p => (p as {type: 'text'; text: string}).text)
            .join('')
        }
        
        // 清理 content 中可能包含的工具调用格式
        cleanContent = cleanContent
          .replace(/\w+:\s*"\{[^}]*\}"/g, '')  // 移除工具调用 JSON 格式
          .replace(/```json\s*\n?\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?```/g, '')  // 移除代码块中的工具调用
          .replace(/^\s*-\s+\w+\s*\([^)]*\)\s*$/gm, '')  // 移除列表格式的工具调用
          .replace(/我将使用以下工具[：:]\s*\n?/g, '')  // 移除提示文本
          .replace(/\n{3,}/g, '\n\n').trim()  // 清理空行
        
        // 构建助手消息
        const assistantMsg: CliChatMessage = {
          role: 'assistant',
          content: cleanContent || '我将分析并处理您的请求。'
        }
        
        // 如果有后端格式的工具调用，添加到消息中
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          assistantMsg.tool_calls = msg.tool_calls
        }
        
        messages.push(assistantMsg)
        
        // 添加工具结果作为 tool 角色消息
        // 优先使用后端格式的工具调用
        const toolCallList = msg.tool_calls || msg.toolCalls || []
        for (const toolCall of toolCallList) {
          // 处理两种格式的工具调用
          const toolCallId = 'id' in toolCall ? toolCall.id : (toolCall as any).id
          const toolResult = 'function' in toolCall 
            ? (toolCall as any).result 
            : (toolCall as KiloToolCall).result
          const toolError = 'function' in toolCall 
            ? undefined 
            : (toolCall as KiloToolCall).error
          
          if ((toolCall as any).status === 'completed' || (toolCall as any).status === 'failed') {
            messages.push({
              role: 'tool',
              content: String(toolResult || toolError || ''),
              tool_call_id: toolCallId
            })
          }
        }
      } else if (msg.role === 'tool') {
        // 直接传递工具消息
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id,
          name: msg.name
        })
      }
    }
    
    // ✅ 关键修复：最后添加当前用户消息（使用传入的参数，确保是最新的）
    // 这样保证当前的多模态消息是 messages 数组中的最后一条用户消息
    // 后端重复检测重置会话时，会重新添加这条消息，保留图片数据
    let currentMessageContent: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>
    if (images && images.length > 0) {
      // 多模态消息
      currentMessageContent = buildMultimodalContent(content, images)
      console.log('[useKiloConversation] Built current user message with images:', { 
        imageCount: images.length,
        contentType: 'multimodal'
      })
    } else {
      // 纯文本消息
      currentMessageContent = content.trim()
      console.log('[useKiloConversation] Built current user message (text only)')
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
            // 更新消息，包含 usage 数据
            const updateData: Partial<KiloMessage> = {
              isStreaming: false
            }
            if (chunk.usage) {
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
              
              // 直接执行保存逻辑 - 使用原始会话ID，防止切换会话后保存到错误的会话
              const targetSessionId = originalSessionIdRef.current || currentStore.currentSession
              console.log('[useKiloConversation] Target session ID for saving:', targetSessionId, 'Original:', originalSessionIdRef.current, 'Current:', currentStore.currentSession)
              
              if (projectPath && window.api?.saveConversation && targetSessionId) {
                const session = currentStore.sessions.find(s => s.id === targetSessionId)
                if (session) {
                  // 保存完整消息格式，包括 images 和所有字段
                  const messagesToSave = currentStore.messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,  // 统一格式：string | MessageContentPart[]
                    timestamp: m.timestamp,
                    mode: m.mode,
                    blocks: m.blocks,
                    toolCalls: m.toolCalls,
                    reasoning: m.reasoning,
                    usage: m.usage,
                    images: m.images,  // 确保图片内容被保存
                    tool_call_id: m.tool_call_id,
                    tool_calls: m.tool_calls,
                    name: m.name
                  }))
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
      
      // DEBUG: 详细检查要发送的消息（包含所有消息，不仅仅是用户消息）
      console.log('[useKiloConversation] ========== MESSAGES TO SEND ==========')
      messages.forEach((m, i) => {
        if (typeof m.content === 'string') {
          console.log(`[useKiloConversation]   content (string): ${m.content.substring(0, 100)}...`)
        } else {
          console.log(`[useKiloConversation]   content (array) length: ${m.content.length}`)
          m.content.forEach((part, j) => {
            if (part.type === 'image_url') {
              console.log(`[useKiloConversation]     Part ${j}: type=${part.type}, hasUrl=${!!part.image_url?.url}, urlLength=${part.image_url?.url?.length || 0}`)
            } else {
              console.log(`[useKiloConversation]     Part ${j}: type=${part.type}, textLength=${part.text?.length || 0}`)
            }
          })
        }
      })
      console.log('[useKiloConversation] ========== END MESSAGES ==========')
      
      // DEBUG: 检查 store 中的最新用户消息
      const lastUserMsg = store.messages.filter(m => m.role === 'user').pop()
      console.log('[useKiloConversation] Store last user message:', {
        contentIsArray: Array.isArray(lastUserMsg?.content),
        contentLength: Array.isArray(lastUserMsg?.content) ? lastUserMsg?.content.length : (lastUserMsg?.content as string)?.length,
        hasImagesField: !!lastUserMsg?.images?.length,
        imagesCount: lastUserMsg?.images?.length || 0,
        contentPreview: typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.substring(0, 50) : 'Array content'
      })
      
      console.log('[useKiloConversation] Final messages to send:', messages.map(m => {
        if (typeof m.content === 'string') {
          return { role: m.role, type: 'text', length: m.content.length }
        } else {
          return { 
            role: m.role, 
            type: 'multimodal', 
            parts: m.content.map(c => {
              if (c.type === 'image_url') {
                return {
                  type: c.type,
                  hasUrl: !!c.image_url?.url,
                  urlLength: c.image_url?.url?.length || 0,
                  urlPreview: c.image_url?.url?.substring(0, 50) + '...'
                }
              }
              return {
                type: c.type,
                textLength: c.text?.length || 0,
                textPreview: c.text?.substring(0, 50) + '...'
              }
            })
          }
        }
      }))
      // DEBUG: 检查发送给后端的消息
      const lastMsg = messages[messages.length - 1]
      console.log('[useKiloConversation] Last message:', {
        role: lastMsg?.role,
        contentIsArray: Array.isArray(lastMsg?.content),
        contentLength: Array.isArray(lastMsg?.content) ? lastMsg?.content.length : (lastMsg?.content as string)?.length,
        parts: Array.isArray(lastMsg?.content) ? lastMsg.content.map(c => ({ type: c.type, hasUrl: c.type === 'image_url' && !!c.image_url?.url })) : 'N/A'
      })
      
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
        content: m.content,  // 统一格式：string | MessageContentPart[]
        timestamp: m.timestamp,
        mode: m.mode,
        blocks: m.blocks,
        toolCalls: m.toolCalls,
        reasoning: m.reasoning,
        usage: m.usage,
        images: m.images,  // 确保图片内容被保存
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
        name: m.name
      }))
      
      // 保存到文件（主进程会自动更新 updatedAt）
      await window.api.saveConversation(projectPath, session.id, messagesToSave, session.title)
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
