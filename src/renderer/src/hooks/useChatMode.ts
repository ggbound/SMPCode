/**
 * useChatMode - 智能问答模式 Hook
 * 基于 useConversationBase 构建，支持只读工具调用
 */

import { useCallback } from 'react'
import { useStore, type Message } from '../store'
import { CHAT_MODE_TOOLS } from '../prompts/shared'
import {
  useConversationBase,
  parseToolCalls,
  cleanToolCallBlocks,
  type StreamChunk,
  type ConversationOptions,
  type ConversationResult
} from './useConversationBase'

// 智能问答模式允许的工具列表（只读工具）
const ALLOWED_CHAT_TOOLS = CHAT_MODE_TOOLS.map((t: { name: string }) => t.name)

/**
 * 智能问答模式专用 Hook
 * 使用 CLI 运行时引擎通过 IPC 处理对话
 */
export function useChatMode() {
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

  const { updateMessage } = useStore()

  /**
   * 处理智能问答模式的消息 - 使用 CLI Chat IPC
   */
  const processChatMessage = useCallback(async (
    content: string,
    apiMessages: Message[],
    options: ConversationOptions
  ): Promise<ConversationResult> => {
    const { currentCwd, projectPath, currentSession, localSessions } = options

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    // Add an empty assistant message for streaming
    addMessage({
      role: 'assistant',
      content: '',
      isBuilder: false
    })

    let fullContent = ''
    let iterationCount = 0
    let currentContent = content

    try {
      // 创建 CLI 会话
      const createResult = await createSession('chat', currentCwd)
      if (!createResult.success || !createResult.sessionId) {
        throw new Error(createResult.error || 'Failed to create CLI session')
      }

      const sessionId = createResult.sessionId

      // Tool calling loop
      while (true) {
        iterationCount++
        console.log(`[useChatMode] Iteration ${iterationCount}`)

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

        // 发送消息
        const sendResult = await sendMessage(sessionId, currentContent)
        if (!sendResult.success) {
          unsubscribe()
          throw new Error(sendResult.error || 'Failed to send message')
        }

        // 等待流式响应完成
        await streamPromise
        unsubscribe()

        // 处理流式响应
        let iterationContent = ''

        for (const chunk of streamChunks) {
          if (abortControllerRef.current?.signal.aborted) break

          if (chunk.type === 'text' && chunk.content) {
            iterationContent += chunk.content
            fullContent += chunk.content
            updateLastMessage(fullContent)
          } else if (chunk.type === 'error') {
            fullContent += `\n\n**错误：** ${chunk.error || 'Unknown error'}`
            updateLastMessage(fullContent)
            break
          }
        }

        if (abortControllerRef.current?.signal.aborted) {
          fullContent += '\n\n**已停止：** 用户中断了生成'
          updateLastMessage(fullContent)
          break
        }

        // Check for tool calls
        const toolCalls = parseToolCalls(iterationContent)

        if (!toolCalls || toolCalls.length === 0) {
          console.log('[useChatMode] No tool calls detected, conversation complete')
          break
        }

        console.log('[useChatMode] Detected tool calls:', toolCalls.length)

        // Clean tool call blocks from display
        const cleanedIterationContent = cleanToolCallBlocks(iterationContent)

        if (cleanedIterationContent !== iterationContent) {
          const iterationStartIndex = fullContent.lastIndexOf(iterationContent)
          if (iterationStartIndex !== -1) {
            fullContent = fullContent.slice(0, iterationStartIndex) + cleanedIterationContent
          }

          // Add visual indicator for tool execution
          const pendingTools = toolCalls.map(tc =>
            `<div class="smp-tool-status-item smp-running">
              <span class="smp-tool-status-pulse"></span>
              <span class="smp-tool-status-name">${tc.tool}</span>
            </div>`
          ).join('')

          fullContent += `\n\n<div class="smp-tool-execution-card smp-running">
  <div class="smp-tool-execution-header">
    <div class="smp-tool-execution-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    </div>
    <span class="smp-tool-execution-title">正在执行工具</span>
    <span class="smp-tool-execution-badge">${toolCalls.length}</span>
  </div>
  <div class="smp-tool-execution-body">
    ${pendingTools}
  </div>
</div>\n\n`
          updateLastMessage(fullContent)
        }

        // Execute tools - 智能问答模式只允许只读工具
        const toolResults: Array<{ tool: string; result: string; success: boolean }> = []
        let shouldRefreshFileExplorer = false

        for (const toolCall of toolCalls) {
          console.log(`[useChatMode] Executing tool:`, toolCall.tool)

          // 检查工具是否在允许列表中
          if (!ALLOWED_CHAT_TOOLS.includes(toolCall.tool)) {
            console.warn(`[useChatMode] Tool ${toolCall.tool} is not allowed in chat mode`)
            toolResults.push({
              tool: toolCall.tool,
              result: `工具 "${toolCall.tool}" 在智能问答模式中不可用。智能问答模式仅支持只读操作（read_file, list_directory, search_code, execute_bash）。如需文件修改操作，请切换到智能体模式。`,
              success: false
            })
            continue
          }

          try {
            const { success, result } = await executeToolCall(toolCall, currentCwd)
            toolResults.push({ tool: toolCall.tool, result, success })
            if (success && isFileOperationTool(toolCall.tool)) {
              shouldRefreshFileExplorer = true
            }
          } catch (toolError) {
            console.error(`[useChatMode] Tool execution error:`, toolCall.tool, toolError)
            toolResults.push({ tool: toolCall.tool, result: `执行错误: ${String(toolError)}`, success: false })
          }
        }

        // Trigger file explorer refresh after file operations
        if (shouldRefreshFileExplorer) {
          triggerFileRefresh()
        }

        // Build tool execution summary
        const toolSummary = toolResults.map(r => {
          const statusClass = r.success ? 'smp-success' : 'smp-failed'
          const statusIcon = r.success
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          const statusText = r.success ? '成功' : '失败'
          return `<div class="smp-tool-status-item ${statusClass}">\n              <span class="smp-tool-status-icon">${statusIcon}</span>\n              <span class="smp-tool-status-name">${r.tool}</span>\n              <span class="smp-tool-status-text">${statusText}</span>\n            </div>`
        }).join('')

        const allSuccess = toolResults.every(r => r.success)
        const cardClass = allSuccess ? 'smp-success' : 'smp-partial'
        const headerIcon = allSuccess
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'

        fullContent += `\n\n<div class="smp-tool-execution-card ${cardClass}">\n  <div class="smp-tool-execution-header">\n    <div class="smp-tool-execution-icon">${headerIcon}</div>\n    <span class="smp-tool-execution-title">工具执行完成</span>\n    <span class="smp-tool-execution-stats">${toolResults.filter(r => r.success).length}/${toolResults.length}</span>\n  </div>\n  <div class="smp-tool-execution-body">\n    ${toolSummary}\n  </div>\n</div>\n\n`
        updateLastMessage(fullContent)

        // Prepare next prompt with tool results
        const nextStepPrompt = toolResults.every(r => r.success)
          ? `工具执行成功。基于以上结果，你还需要继续调用工具来完成用户的任务。请立即输出 JSON 格式的工具调用。\n\n**强制要求**：\n1. 不要输出任何分析文本或描述\n2. 直接输出 JSON 工具调用（使用 \`\`\`json 代码块）\n3. 如果需要读取文件，调用 read_file 工具\n4. 如果需要查看目录，调用 list_directory 工具\n5. 只有在任务完全完成后，才能输出最终总结\n\n请继续调用工具：`
          : `部分工具执行失败。请分析错误原因，修正参数后重新调用工具。\n\n失败的工具：\n${toolResults.filter(r => !r.success).map(r => `- ${r.tool}: ${r.result}`).join('\n')}\n\n请修正后继续调用工具：`

        currentContent = nextStepPrompt
      }

      // Cleanup
      cleanupSession()

      // Update tokens
      updateTokens(content.length / 4, fullContent.length / 4)

      // Save to session
      if (currentSession && projectPath) {
        const updatedMessages = [...useStore.getState().messages]
        const session = localSessions.find(s => s.id === currentSession)
        await saveConversation(projectPath, currentSession, updatedMessages, session?.title)
      }

      return { success: true }
    } catch (error) {
      console.error('[useChatMode] Error:', error)
      updateLastMessage(`Error: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  }, [
    abortControllerRef,
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
    cleanupSession
  ])

  return {
    processChatMessage,
    stopGeneration
  }
}

export default useChatMode
