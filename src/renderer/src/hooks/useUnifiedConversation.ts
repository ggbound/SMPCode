/**
 * useUnifiedConversation - 统一的对话管理 Hook
 * 整合 Chat Mode 和 Agent Mode，替换 useChatMode 和 useAgentMode
 * 支持步骤化消息展示
 */

import { useRef, useCallback } from 'react'
import { useStore, type Message, type MessageStep, type ExecutionPhase } from '../store'

/**
 * 解析内容中的 thinking 标签
 * 返回提取的思考内容和清理后的内容
 */
function parseThinkingTags(content: string): { thinking: string | null; cleaned: string } {
  const thinkingRegex = /<think>([\s\S]*?)<\/think>/g
  const matches: string[] = []
  let cleaned = content
  
  let match
  while ((match = thinkingRegex.exec(content)) !== null) {
    matches.push(match[1].trim())
  }
  
  // 移除 thinking 标签
  cleaned = content.replace(thinkingRegex, '').trim()
  
  return {
    thinking: matches.length > 0 ? matches.join('\n\n') : null,
    cleaned
  }
}

/**
 * 检测是否是工具调用标记
 */
function isToolCallMarker(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.includes('**正在调用工具：**') || 
         trimmed.includes('**工具执行结果：**') ||
         trimmed.includes('**工具执行失败：**')
}

/**
 * 提取工具调用信息
 */
function extractToolCallInfo(content: string): { toolName: string | null; isResult: boolean } {
  const callMatch = content.match(/\*\*正在调用工具：\*\*\s*(\w+)/)
  if (callMatch) {
    return { toolName: callMatch[1], isResult: false }
  }
  
  const resultMatch = content.match(/\*\*工具执行结果：\*\*/)
  if (resultMatch) {
    return { toolName: null, isResult: true }
  }
  
  const failMatch = content.match(/\*\*工具执行失败：\*\*/)
  if (failMatch) {
    return { toolName: null, isResult: true }
  }
  
  return { toolName: null, isResult: false }
}

type ExecutionState = 'thinking' | 'executing_tool' | 'analyzing' | 'completed' | 'error'

interface UseUnifiedConversationOptions {
  cwd: string
  projectPath: string | null
  currentSession: string | null
  localSessions: Array<{ id: string; title?: string }>
  chatMode: 'chat' | 'agent'
  commands: Array<{ name: string; responsibility: string }>
  tools: Array<{
    name: string
    responsibility: string
    parameters?: Record<string, { type: string; description: string; required?: boolean }>
    required?: string[]
  }>
  systemPrompt: string
  maxIterations?: number
  onExecutionStateChange?: (state: ExecutionState) => void
}

interface UseUnifiedConversationReturn {
  sendMessage: (
    content: string,
    apiMessages: Message[],
    options: {
      providerApiKey: string
      providerApiUrl?: string
      model: string
    }
  ) => Promise<void>
  stopGeneration: () => void
  isRunning: () => boolean
  executionState: ExecutionState
}

export function useUnifiedConversation(options: UseUnifiedConversationOptions): UseUnifiedConversationReturn {
  const {
    cwd,
    projectPath,
    currentSession,
    localSessions,
    chatMode,
    onExecutionStateChange
  } = options

  const { addMessage, updateTokens } = useStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const isRunningRef = useRef(false)
  const executionStateRef = useRef<ExecutionState>('thinking')

  /**
   * 设置执行状态
   */
  const setExecutionState = useCallback((state: ExecutionState) => {
    executionStateRef.current = state
    onExecutionStateChange?.(state)
  }, [onExecutionStateChange])

  /**
   * 更新最后一条助手消息
   */
  const updateLastMessage = useCallback((content: string, updates?: Partial<Message>) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content, ...updates }
        useStore.setState({ messages: msgs })
        break
      }
    }
  }, [])

  /**
   * 添加消息步骤
   */
  const addMessageStep = useCallback((step: MessageStep) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        const currentSteps = msgs[i].messageSteps || []
        msgs[i] = { ...msgs[i], messageSteps: [...currentSteps, step] }
        useStore.setState({ messages: msgs })
        break
      }
    }
  }, [])

  /**
   * 更新消息步骤状态
   */
  const updateMessageStep = useCallback((stepId: string, updates: Partial<MessageStep>) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].messageSteps) {
        msgs[i].messageSteps = msgs[i].messageSteps!.map(step =>
          step.id === stepId ? { ...step, ...updates } : step
        )
        useStore.setState({ messages: msgs })
        break
      }
    }
  }, [])

  /**
   * 更新消息执行阶段
   */
  const updateExecutionPhase = useCallback((phase: ExecutionPhase) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], executionPhase: phase }
        useStore.setState({ messages: msgs })
        break
      }
    }
  }, [])

  /**
   * 保存对话到会话
   */
  const saveConversation = useCallback(async (
    projectPath: string,
    sessionId: string,
    messages: Message[],
    title?: string
  ) => {
    try {
      const api = (window as unknown as { api?: { saveConversation?: Function } }).api
      if (api?.saveConversation) {
        await api.saveConversation(projectPath, sessionId, messages, title)
      }
    } catch (e) {
      console.error('Failed to save conversation:', e)
    }
  }, [])

  /**
   * 发送消息
   */
  const sendMessage = useCallback(async (
    content: string,
    apiMessages: Message[],
    sendOptions: {
      providerApiKey: string
      providerApiUrl?: string
      model: string
    }
  ) => {
    if (isRunningRef.current) {
      console.warn('[useUnifiedConversation] Already running, please wait or stop first')
      return
    }

    isRunningRef.current = true
    abortControllerRef.current = new AbortController()
    setExecutionState('thinking')

    // 添加空的助手消息
    addMessage({
      role: 'assistant',
      content: '',
      isBuilder: false
    })

    let fullContent = ''
    let currentStepId: string | null = null
    let stepCounter = 0

    // 生成唯一步骤ID
    const generateStepId = () => `step-${Date.now()}-${stepCounter++}`

    try {
      const ipcApi = (window as unknown as {
        api?: {
          cliChat?: {
            createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
            // ✅ 修复：content 支持 string 或 多模态数组
            sendMessage: (sessionId: string, message: string, messages?: Array<{ 
              role: string; 
              content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
              name?: string 
            }>) => Promise<{ success: boolean; error?: string }>
            onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
          }
        }
      }).api

      if (!ipcApi?.cliChat) {
        throw new Error('CLI Chat IPC API not available')
      }

      // 创建会话
      const createResult = await ipcApi.cliChat.createSession(chatMode, cwd)
      if (!createResult.success || !createResult.sessionId) {
        throw new Error(createResult.error || 'Failed to create CLI session')
      }

      const sessionId = createResult.sessionId

      // 设置流式监听（实时处理数据块）
      // 注意：后端会处理整个对话流程，包括多次工具调用和继续对话
      // 前端只需要持续接收流式响应直到收到 done 信号
      
      // 性能优化：使用 requestAnimationFrame 批量更新 UI
      let pendingUpdate = false
      let lastChunkTime = 0
      const CHUNK_THROTTLE_MS = 16 // 约60fps，每帧最多处理一次
      
      const unsubscribe = ipcApi.cliChat.onStreamChunk((_event, data) => {
        if (data.sessionId !== sessionId) return
        
        const chunk = data.chunk
        const now = Date.now()
        
        // 节流：避免过于频繁的处理
        if (now - lastChunkTime < CHUNK_THROTTLE_MS && chunk.type === 'text') {
          // 累积内容但不立即处理
          if (chunk.content) {
            fullContent += chunk.content
          }
          return
        }
        lastChunkTime = now
        
        // 对于文本块，累积内容后批量处理
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content
          
          // 使用 requestAnimationFrame 批量更新 UI
          if (!pendingUpdate) {
            pendingUpdate = true
            requestAnimationFrame(() => {
              pendingUpdate = false
              processTextChunk(fullContent)
            })
          }
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          // 工具调用需要立即处理
          handleToolCallChunk(chunk)
        } else if (chunk.type === 'tool_result' && chunk.toolResult) {
          // 工具结果需要立即处理
          handleToolResultChunk(chunk)
        }
      })
      
      // 提取文本处理逻辑到单独函数
      const processTextChunk = (content: string) => {
        // 解析 thinking 标签
        const { thinking, cleaned } = parseThinkingTags(content)
        
        // 如果检测到 thinking 内容，创建思考步骤
        if (thinking && thinking.length > 0) {
          // 检查是否已存在 thinking 步骤
          const state = useStore.getState()
          const lastMsg = state.messages[state.messages.length - 1]
          const hasThinkingStep = lastMsg?.messageSteps?.some(s => s.type === 'thinking')
          
          if (!hasThinkingStep) {
            currentStepId = generateStepId()
            const thinkingStep: MessageStep = {
              id: currentStepId,
              type: 'thinking',
              title: '分析思考',
              content: thinking,
              status: 'completed',
              timestamp: Date.now()
            }
            addMessageStep(thinkingStep)
          }
        }

        // 检测工具调用标记（只在必要时解析）
        if (content.includes('[') || content.includes('tool')) {
          const toolInfo = extractToolCallInfo(content)
          if (toolInfo.toolName && !toolInfo.isResult) {
            // 创建工具调用步骤
            currentStepId = generateStepId()
            const toolStep: MessageStep = {
              id: currentStepId,
              type: 'tool_call',
              title: `调用 ${toolInfo.toolName}`,
              status: 'running',
              timestamp: Date.now(),
              toolName: toolInfo.toolName
            }
            addMessageStep(toolStep)
            setExecutionState('executing_tool')
            updateExecutionPhase('executing_tool')
          }
        }

        // 更新消息内容（使用清理后的内容）
        updateLastMessage(cleaned, { executionPhase: 'thinking' })
        setExecutionState('thinking')
      }
      
      // 提取工具调用处理逻辑
      const handleToolCallChunk = (chunk: any) => {
        setExecutionState('executing_tool')
        updateExecutionPhase('executing_tool')

        // 完成当前思考步骤
        if (currentStepId) {
          updateMessageStep(currentStepId, { status: 'completed' })
        }

        // 创建工具调用步骤
        currentStepId = generateStepId()
        const toolStep: MessageStep = {
          id: currentStepId,
          type: 'tool_call',
          title: `调用 ${chunk.toolCall.name}`,
          status: 'running',
          timestamp: Date.now(),
          toolName: chunk.toolCall.name,
          toolArgs: chunk.toolCall.arguments || {}
        }
        addMessageStep(toolStep)

      }
      
      // 提取工具结果处理逻辑
      const handleToolResultChunk = (chunk: any) => {
        setExecutionState('analyzing')
        updateExecutionPhase('analyzing')

        // 完成工具调用步骤
        if (currentStepId) {
          updateMessageStep(currentStepId, {
            status: chunk.toolResult.success ? 'completed' : 'failed',
            toolResult: {
              success: chunk.toolResult.success,
              output: chunk.toolResult.output,
              error: chunk.toolResult.error
            }
          })
        }

        // 创建结果分析步骤
        currentStepId = generateStepId()
        const resultStep: MessageStep = {
          id: currentStepId,
          type: 'tool_result',
          title: chunk.toolResult.success ? '工具执行成功' : '工具执行失败',
          status: 'completed',
          timestamp: Date.now(),
          toolResult: {
            success: chunk.toolResult.success,
            output: chunk.toolResult.output?.slice(0, 500),
            error: chunk.toolResult.error
          }
        }
        addMessageStep(resultStep)
      }
      
      // 处理错误和完成信号
      const handleOtherChunks = (chunk: any) => {
        if (chunk.type === 'error') {
          console.error('[useUnifiedConversation] Error chunk:', chunk.error)
          setExecutionState('error')
          updateExecutionPhase('error')

          // 完成当前步骤并标记为失败
          if (currentStepId) {
            updateMessageStep(currentStepId, { status: 'failed' })
          }

          fullContent += `\n\n**错误：** ${chunk.error || 'Unknown error'}`
          updateLastMessage(fullContent)
        } else if (chunk.type === 'done') {
          setExecutionState('completed')
          updateExecutionPhase('completed')

          // 完成当前步骤
          if (currentStepId) {
            updateMessageStep(currentStepId, { status: 'completed' })
          }

          // 添加总结步骤
          const summaryStep: MessageStep = {
            id: generateStepId(),
            type: 'summary',
            title: '任务完成',
            status: 'completed',
            timestamp: Date.now()
          }
          addMessageStep(summaryStep)

          streamResolve?.() // 完成时解析
        }
      }
      
      // 修改主监听器，调用辅助函数
      const mainUnsubscribe = ipcApi.cliChat.onStreamChunk((_event, data) => {
        if (data.sessionId !== sessionId) return
        
        const chunk = data.chunk
        
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content
          
          // 使用 requestAnimationFrame 批量更新 UI
          if (!pendingUpdate) {
            pendingUpdate = true
            requestAnimationFrame(() => {
              pendingUpdate = false
              processTextChunk(fullContent)
            })
          }
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          handleToolCallChunk(chunk)
        } else if (chunk.type === 'tool_result' && chunk.toolResult) {
          handleToolResultChunk(chunk)
        } else {
          handleOtherChunks(chunk)
        }
      })

      // 创建完成监听器
      let streamResolve: (() => void) | null = null
      const streamPromise = new Promise<void>(resolve => { streamResolve = resolve })

      // 转换消息格式
      const messagesForAPI = apiMessages.map(m => {
        const msg: any = {
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }
        // tool 角色的消息需要包含 name 和 tool_call_id
        if (m.role === 'tool') {
          msg.name = (m as any).name
          msg.tool_call_id = (m as any).toolCallId || (m as any).tool_call_id
        }
        return msg
      })


      // 发送消息
      // 注意：messagesForAPI 已经包含了完整的对话历史（包括当前用户消息）
      // 所以 message 参数使用空字符串，避免 CLI Chat Service 重复添加
      const sendResult = await ipcApi.cliChat.sendMessage(sessionId, '', messagesForAPI)
      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Failed to send message')
      }

      // 等待流式响应完成（后端会处理所有迭代）
      await streamPromise

      if (abortControllerRef.current?.signal.aborted) {
        fullContent += '\n\n**已停止：** 用户中断了生成'
        updateLastMessage(fullContent)
      }

      // 取消流式监听
      unsubscribe()

      // TODO: 从后端获取 token 使用量并更新
      // updateTokens(totalInputTokens, totalOutputTokens)

      // 保存对话
      if (projectPath && currentSession) {
        const session = localSessions.find(s => s.id === currentSession)
        // 跳过飞书会话，避免覆盖飞书消息
        if (session?.title === '飞书专用对话' || currentSession.startsWith('feishu-session-')) {
        } else {
          const updatedMessages = [...useStore.getState().messages]
          await saveConversation(projectPath, currentSession, updatedMessages, session?.title)
        }
      }

    } catch (error) {
      console.error('[useUnifiedConversation] Error:', error)
      setExecutionState('error')
      updateLastMessage(`Error: ${String(error)}`)
    } finally {
      isRunningRef.current = false
      abortControllerRef.current = null
      // 状态会在 done 或 error 时更新，这里不需要重复设置
    }
  }, [addMessage, chatMode, cwd, localSessions, projectPath, saveConversation, updateLastMessage, updateTokens, setExecutionState, addMessageStep, updateMessageStep, updateExecutionPhase])

  /**
   * 停止生成
   */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  /**
   * 检查是否正在运行
   */
  const isRunning = useCallback(() => {
    return isRunningRef.current
  }, [])

  return {
    sendMessage,
    stopGeneration,
    isRunning,
    executionState: executionStateRef.current
  }
}
