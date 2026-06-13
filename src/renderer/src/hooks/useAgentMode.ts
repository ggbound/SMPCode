/**
 * useAgentMode - 智能体模式 Hook
 * 基于 useConversationBase 构建，支持完整工具调用
 */

import { useCallback } from 'react'
import { useStore, type Message, type ToolCall } from '../store'
import { buildAgentModePrompt, getSystemInfo, type PromptCommand } from '../prompts'
import {
  useConversationBase,
  parseToolCalls,
  cleanToolCallBlocks,
  TOOL_NAME_MAP,
  type StreamChunk,
  type ConversationOptions,
  type ConversationResult
} from './useConversationBase'

interface AgentModeOptions extends ConversationOptions {
  commands: Array<{ name: string; description: string }>
  tools: Array<{
    name: string
    description: string
    parameters?: Record<string, { type: string; description: string; required?: boolean }>
    required?: string[]
  }>
}

/**
 * 智能体模式专用 Hook
 * 使用 CLI 运行时引擎通过 IPC 处理对话
 */
export function useAgentMode() {
  const {
    abortControllerRef,
    sessionIdRef,
    addMessage,
    updateTokens,
    updateLastMessage,
    saveConversation,
    executeToolCall,
    isFileOperationTool,
    triggerFileRefresh,
    stopGeneration,
    createSession,
    sendMessage,
    setupStreamListener,
    cleanupSession
  } = useConversationBase()
  
  // 获取 store 方法
  const addToolCallToMessage = useStore(state => state.addToolCallToMessage)
  const updateToolCallStatus = useStore(state => state.updateToolCallStatus)

  /**
   * 构建系统提示词
   */
  const buildSystemPrompt = useCallback((
    commands: Array<{ name: string; description: string }>,
    _tools: Array<{
      name: string
      description: string
      parameters?: Record<string, { type: string; description: string; required?: boolean }>
      required?: string[]
    }>,
    cwd: string,
    projectContext: string
  ): string => {
    const promptCommands: PromptCommand[] = commands.map(c => ({
      name: c.name,
      description: c.description
    }))

    return buildAgentModePrompt({
      systemInfo: getSystemInfo(cwd),
      projectContext,
      commands: promptCommands
    })
  }, [])

  /**
   * 压缩上下文消息
   */
  const compressContext = useCallback((messages: Message[], maxMessages = 20): Message[] => {
    if (messages.length <= maxMessages) return messages
    return messages.slice(-maxMessages)
  }, [])

  /**
   * 处理智能体模式的消息 - 使用 CLI Chat IPC
   */
  const processAgentMessage = useCallback(async (
    content: string,
    apiMessages: Message[],
    options: AgentModeOptions
  ): Promise<ConversationResult> => {
    const { currentCwd, projectPath, currentSession, localSessions } = options

    abortControllerRef.current = new AbortController()

    addMessage({
      role: 'assistant',
      content: '',
      isBuilder: false
    })

    let fullContent = ''
    let conversationMessages = [...apiMessages]
    let iterationCount = 0

    try {
      const createResult = await createSession('agent', currentCwd)
      if (!createResult.success || !createResult.sessionId) {
        throw new Error(createResult.error || 'Failed to create CLI session')
      }

      sessionIdRef.current = createResult.sessionId
      const sessionId = createResult.sessionId

      while (true) {
        iterationCount++
        console.log(`[useAgentMode] ========== Iteration ${iterationCount} ==========`)

        const compressedMessages = compressContext(conversationMessages)
        console.log(`[useAgentMode] Messages for API: count=${compressedMessages.length}`)

        // 收集流式响应
        const streamChunks: StreamChunk[] = []
        let streamResolve: (() => void) | null = null
        const streamPromise = new Promise<void>(resolve => { streamResolve = resolve })

        // 设置流式响应监听
        const unsubscribe = setupStreamListener(sessionId, (chunk) => {
          streamChunks.push(chunk)
          if (chunk.type === 'done' || chunk.type === 'error') {
            streamResolve?.()
          }
        })

        // 转换消息格式并发送
        const messagesForAPI = compressedMessages.map(m => {
          const baseMsg = { role: m.role, content: m.content }
          // 保留 tool 角色的 name 字段
          if (m.role === 'tool' && m.name) {
            return { ...baseMsg, name: m.name }
          }
          return baseMsg
        })
        console.log(`[useAgentMode] Sending to IPC: messagesCount=${messagesForAPI.length}`)

        const sendResult = await sendMessage(sessionId, content, messagesForAPI)
        console.log(`[useAgentMode] IPC send result: success=${sendResult.success}`)

        if (!sendResult.success) {
          unsubscribe()
          throw new Error(sendResult.error || 'Failed to send message')
        }

        console.log('[useAgentMode] Waiting for stream...')
        await streamPromise
        console.log(`[useAgentMode] Stream complete: received ${streamChunks.length} chunks`)

        unsubscribe()

        let iterationContent = ''
        let textChunks = 0
        let toolCallChunks = 0
        let toolResultChunks = 0
        let errorChunks = 0

        // 收集从 IPC 传来的工具调用
        const receivedToolCalls: Array<{ tool: string; arguments: Record<string, unknown>; id: string }> = []

        for (const chunk of streamChunks) {
          if (abortControllerRef.current?.signal.aborted) break

          if (chunk.type === 'text' && chunk.content) {
            textChunks++
            iterationContent += chunk.content
            fullContent += chunk.content
            updateLastMessage(fullContent)
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCallChunks++
            console.log(`[useAgentMode] Received tool_call from IPC: ${chunk.toolCall.name}`)
            try {
              // arguments 可能是对象或字符串
              const args = typeof chunk.toolCall.arguments === 'string' 
                ? JSON.parse(chunk.toolCall.arguments) 
                : chunk.toolCall.arguments
              receivedToolCalls.push({ tool: chunk.toolCall.name, arguments: args, id: chunk.toolCall.id })
              
              // 立即将工具调用添加到消息中，以便 UI 可以显示
              const messages = useStore.getState().messages
              const lastMessageIndex = messages.length - 1
              if (lastMessageIndex >= 0) {
                const toolCallForStore: ToolCall = {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.name,
                  args: args,
                  status: 'pending',
                  timestamp: Date.now()
                }
                addToolCallToMessage(lastMessageIndex, toolCallForStore)
                console.log(`[useAgentMode] Added tool call to message ${lastMessageIndex}: ${chunk.toolCall.name}`)
              }
            } catch (e) {
              console.error('[useAgentMode] Failed to parse tool call arguments:', e)
            }
          } else if (chunk.type === 'tool_result' && chunk.toolResult) {
            toolResultChunks++
            console.log(`[useAgentMode] Received tool_result: success=${chunk.toolResult.success}`)
            const resultText = chunk.toolResult.success
              ? `\n\n**工具执行结果：**\n\`\`\`\n${chunk.toolResult.output.slice(0, 500)}${chunk.toolResult.output.length > 500 ? '\n...' : ''}\n\`\`\``
              : `\n\n**工具执行失败：** ${chunk.toolResult.error || 'Unknown error'}`
            fullContent += resultText
            updateLastMessage(fullContent)
          } else if (chunk.type === 'error') {
            errorChunks++
            fullContent += `\n\n**错误：** ${chunk.error || 'Unknown error'}`
            updateLastMessage(fullContent)
            break
          }
        }

        console.log(`[useAgentMode] Chunk breakdown: text=${textChunks}, tool_calls=${toolCallChunks}, tool_results=${toolResultChunks}, errors=${errorChunks}`)

        if (abortControllerRef.current?.signal.aborted) {
          fullContent += '\n\n**已停止：** 用户中断了生成'
          updateLastMessage(fullContent)
          break
        }

        // 优先使用从 IPC 接收到的工具调用，如果没有则尝试从文本解析
        let toolCalls = receivedToolCalls.length > 0
          ? receivedToolCalls
          : (parseToolCalls(iterationContent) || [])

        console.log(`[useAgentMode] Total tool calls: ${toolCalls.length}`)

        if (toolCalls.length === 0) {
          console.log('[useAgentMode] No tool calls detected, conversation complete')
          break
        }

        console.log('[useAgentMode] Detected tool calls:', toolCalls.map(t => t.tool).join(', '))

        // 性能优化：每次 iteration 只执行第一个工具，避免并发执行导致卡顿
        // AI 会根据第一个工具的结果决定下一步操作
        if (toolCalls.length > 1) {
          console.log(`[useAgentMode] Multiple tools detected (${toolCalls.length}), executing only the first one`)
          console.log(`[useAgentMode] First tool: ${toolCalls[0].tool}`)
          console.log(`[useAgentMode] Deferred tools:`, toolCalls.slice(1).map(t => t.tool).join(', '))
        }
        
        let toolCall = toolCalls[0]  // 只取第一个工具

        // 映射工具名称
        if (TOOL_NAME_MAP[toolCall.tool]) {
          toolCall = { ...toolCall, tool: TOOL_NAME_MAP[toolCall.tool] }
        }

        console.log(`[useAgentMode] Executing tool: ${toolCall.tool}`)
        console.log(`[useAgentMode] Tool arguments:`, JSON.stringify(toolCall.arguments))
        console.log(`[useAgentMode] Current CWD: ${currentCwd}`)

        try {
          // 更新工具状态为运行中
          const messages = useStore.getState().messages
          const lastMessageIndex = messages.length - 1
          const lastToolCall = messages[lastMessageIndex]?.toolCalls?.find(
            tc => tc.name === toolCall.tool && tc.status === 'pending'
          )
          if (lastToolCall) {
            updateToolCallStatus(lastMessageIndex, lastToolCall.id, 'running')
          }
          
          const { success, result } = await executeToolCall(toolCall, currentCwd)
          console.log(`[useAgentMode] Tool execution result: success=${success}, result length=${result.length}`)
          console.log(`[useAgentMode] Tool result (first 200 chars):`, result.substring(0, 200))

          // 更新工具状态为完成或失败
          if (lastToolCall) {
            updateToolCallStatus(lastMessageIndex, lastToolCall.id, success ? 'completed' : 'failed', result)
          }

          if (success && isFileOperationTool(toolCall.tool)) {
            triggerFileRefresh()
          }

          const verificationPrompt = `工具执行结果：\n\n**工具名称：** ${toolCall.tool}\n**参数：** \`\`\`json\n${JSON.stringify(toolCall.arguments, null, 2)}\n\`\`\`\n**执行状态：** ${success ? '✅ 成功' : '❌ 失败'}\n**结果：**\n\`\`\`\n${result.slice(0, 2000)}${result.length > 2000 ? '\n... (已截断)' : ''}\n\`\`\`\n\n请分析以上结果，然后：\n1. 如果任务已完成，输出最终总结（不要调用工具）\n2. 如果还需要继续，请调用下一个工具（使用 \`\`\`json 代码块，**只调用一个工具**）`

          // Clean tool call blocks from content
          const cleanedIterationContent = cleanToolCallBlocks(iterationContent)

          // 更新对话历史
          // 注意：需要添加 tool_call_id 以便 API 正确处理工具调用链
          conversationMessages = [
            ...conversationMessages,
            { role: 'assistant', content: cleanedIterationContent } as Message,
            { role: 'tool', content: result, name: toolCall.tool, tool_call_id: toolCall.id || 'unknown' } as Message,
            { role: 'user', content: verificationPrompt } as Message
          ]

          // Clean full content
          fullContent = cleanToolCallBlocks(fullContent)
          updateLastMessage(fullContent)

          content = verificationPrompt
          continue

        } catch (toolError) {
          const errorPrompt = `工具执行失败：\n\n**工具名称：** ${toolCall.tool}\n**错误信息：** ${String(toolError)}\n\n请根据错误信息调整策略。`

          const cleanedIterationContent = cleanToolCallBlocks(iterationContent)

          conversationMessages = [
            ...conversationMessages,
            { role: 'assistant', content: cleanedIterationContent } as Message,
            { role: 'user', content: errorPrompt } as Message
          ]

          content = errorPrompt
          continue
        }
      }

      cleanupSession()

      updateTokens(content.length / 4, fullContent.length / 4)

      if (currentSession && projectPath) {
        const session = localSessions.find(s => s.id === currentSession)
        // 跳过飞书会话，避免覆盖飞书消息
        if (session?.title === '飞书专用对话' || currentSession.startsWith('feishu-session-')) {
          console.log('[useAgentMode] Skipping save for Feishu session:', currentSession)
        } else {
          const updatedMessages = [...useStore.getState().messages]
          await saveConversation(projectPath, currentSession, updatedMessages, session?.title)
        }
      }

      return { success: true }
    } catch (error) {
      console.error('[useAgentMode] Error:', error)
      updateLastMessage(`Error: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  }, [
    abortControllerRef,
    sessionIdRef,
    addMessage,
    updateLastMessage,
    updateTokens,
    saveConversation,
    executeToolCall,
    isFileOperationTool,
    triggerFileRefresh,
    createSession,
    sendMessage,
    setupStreamListener,
    cleanupSession,
    compressContext
  ])

  return {
    processAgentMessage,
    stopGeneration,
    buildSystemPrompt
  }
}

export default useAgentMode
