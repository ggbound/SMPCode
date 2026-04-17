import { useRef, useCallback } from 'react'
import { useStore, type Message } from '../store'
import { CHAT_MODE_TOOLS } from '../prompts/shared'

const API_BASE = 'http://localhost:3847/api'

// 智能问答模式允许的工具列表（只读工具）
const ALLOWED_CHAT_TOOLS = CHAT_MODE_TOOLS.map((t: { name: string }) => t.name)

interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

interface ChatModeOptions {
  providerApiKey: string
  providerApiUrl?: string
  model: string
  currentCwd: string
  projectPath: string | null
  currentSession: string | null
  localSessions: Array<{ id: string; title?: string }>
}

interface ChatModeResult {
  success: boolean
  error?: string
}

/**
 * 智能问答模式专用 Hook
 * 处理流式响应、工具调用循环、消息更新等逻辑
 */
export function useChatMode() {
  const abortControllerRef = useRef<AbortController | null>(null)
  const { addMessage, updateMessage, updateTokens } = useStore()

  /**
   * 解析工具调用
   * 支持在一次回复中解析多个工具调用（包括代码块中的多行 JSON）
   */
  const parseToolCalls = useCallback((text: string): ToolCall[] | null => {
    const toolCalls: ToolCall[] = []
    // 使用 matchAll 来避免正则表达式状态问题
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
    const matches = Array.from(text.matchAll(codeBlockRegex))

    for (const match of matches) {
      const blockContent = match[1].trim()
      if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
        // 尝试解析整个代码块内容为单个 JSON
        try {
          const parsed = JSON.parse(blockContent)
          if (parsed.tool && typeof parsed.arguments === 'object') {
            toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
            continue
          }
        } catch (e) {
          // 不是单个 JSON，尝试按行解析多个 JSON
        }

        // 尝试按行解析多个 JSON 对象
        const lines = blockContent.split('\n').filter(line => line.trim())
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim())
            if (parsed.tool && typeof parsed.arguments === 'object') {
              toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
            }
          } catch (e) {
            // 这一行不是有效的工具调用 JSON
          }
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : null
  }, [])

  /**
   * 更新最后一条助手消息
   */
  const updateLastMessage = useCallback((content: string) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content }
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
   * 执行单个工具调用
   */
  const executeTool = useCallback(async (
    toolCall: ToolCall,
    cwd: string
  ): Promise<{ success: boolean; result: string }> => {
    try {
      const execRes = await fetch(`${API_BASE}/tools/execute-direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: toolCall.tool,
          arguments: toolCall.arguments,
          cwd
        })
      })

      if (!execRes.ok) {
        const errorText = await execRes.text()
        return { success: false, result: `Tool execution failed: ${execRes.status} - ${errorText}` }
      }

      const execData = await execRes.json()
      const result = execData.result
      return { success: true, result: result.output || result }
    } catch (error) {
      return { success: false, result: String(error) }
    }
  }, [])

  /**
   * 处理智能问答模式的消息
   */
  const processChatMessage = useCallback(async (
    content: string,
    apiMessages: Message[],
    options: ChatModeOptions
  ): Promise<ChatModeResult> => {
    const { providerApiKey, providerApiUrl, model, currentCwd, projectPath, currentSession, localSessions } = options

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    // Add an empty assistant message for streaming
    addMessage({
      role: 'assistant',
      content: '',
      isBuilder: false
    })

    let fullContent = ''
    let conversationMessages = [...apiMessages]
    let iterationCount = 0

    try {
      // Tool calling loop - no upper limit for chat mode
      while (true) {
        iterationCount++
        console.log(`[useChatMode] Iteration ${iterationCount}`)

        // Call API with streaming
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: providerApiKey,
            model,
            messages: conversationMessages,
            stream: true,
            apiUrl: providerApiUrl
          }),
          signal: abortControllerRef.current?.signal
        })

        if (!res.ok) {
          const errorMessage = `HTTP error! status: ${res.status}`
          fullContent += `\n\n**错误：** API 请求失败：${errorMessage}`
          updateLastMessage(fullContent)
          break
        }

        // Handle streaming response
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let iterationContent = ''

        if (!reader) {
          fullContent += '\n\n**错误：** 无法读取响应内容'
          updateLastMessage(fullContent)
          break
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6)
                if (data === '[DONE]') continue

                try {
                  const parsed = JSON.parse(data)
                  let delta = ''
                  if (parsed.delta?.text) {
                    delta = parsed.delta.text
                  } else if (parsed.choices?.[0]?.delta?.content) {
                    delta = parsed.choices[0].delta.content
                  }
                  if (delta) {
                    iterationContent += delta
                    fullContent += delta
                    updateLastMessage(fullContent)
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        } catch (streamError) {
          fullContent += `\n\n**错误：** 读取响应流时出错：${String(streamError)}`
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

        // Remove tool call JSON blocks from display
        let cleanedIterationContent = iterationContent
        const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
        const matches = Array.from(iterationContent.matchAll(codeBlockRegex))
        const blocksToRemove: string[] = []

        for (const match of matches) {
          const blockContent = match[1].trim()
          if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
            try {
              const parsed = JSON.parse(blockContent)
              if (parsed.tool && typeof parsed.arguments === 'object') {
                blocksToRemove.push(match[0])
              }
            } catch (e) {
              // Not a tool call block
            }
          }
        }

        for (const block of blocksToRemove) {
          cleanedIterationContent = cleanedIterationContent.replace(block, '')
        }

        if (blocksToRemove.length > 0) {
          const iterationStartIndex = fullContent.lastIndexOf(iterationContent)
          if (iterationStartIndex !== -1) {
            fullContent = fullContent.slice(0, iterationStartIndex) + cleanedIterationContent
          }

          // Add visual indicator
          fullContent += `\n\n---\n\n**🔧 正在执行工具**\n\n`
          fullContent += toolCalls.map(tc => `- ⏳ ${tc.tool}`).join('\n')
          fullContent += '\n\n'
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

          const { success, result } = await executeTool(toolCall, currentCwd)
          toolResults.push({ tool: toolCall.tool, result, success })
          // Mark for refresh if file operation was successful
          if (success && ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir'].includes(toolCall.tool)) {
            shouldRefreshFileExplorer = true
          }
        }

        // Trigger file explorer refresh after file operations
        if (shouldRefreshFileExplorer) {
          console.log('[useChatMode] File operation completed, triggering refresh')
          window.dispatchEvent(new CustomEvent('file-operation-completed'))
        }

        // Build tool execution summary
        const toolSummary = toolResults.map(r => {
          const icon = r.success ? '✅' : '❌'
          const status = r.success ? '成功' : '失败'
          return `- ${icon} **${r.tool}** - ${status}`
        }).join('\n')

        fullContent += `**✓ 工具执行完成**\n\n${toolSummary}\n\n---\n\n`
        updateLastMessage(fullContent)

        // Update conversation messages
        conversationMessages = [
          ...conversationMessages,
          { role: 'assistant' as const, content: iterationContent },
          {
            role: 'user' as const,
            content: `工具执行结果：\n${toolResults.map(r => `- ${r.tool}: ${r.success ? '成功' : '失败'}\n${r.result}`).join('\n')}\n\n请基于以上工具执行结果，继续分析或执行下一步操作。\n\n重要提示：\n1. 直接输出分析结果，不要使用代码块包裹你的回复\n2. 如果需要展示代码或配置文件内容，请使用正确的代码块格式（如 \`\`\`typescript 或 \`\`\`json）\n3. 目录结构等文本内容直接输出，不要放在代码块中\n4. 如果需要调用更多工具，请使用标准工具调用格式`
          }
        ]
      }

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
  }, [addMessage, updateLastMessage, parseToolCalls, executeTool, updateTokens, saveConversation])

  /**
   * 停止生成
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  return {
    processChatMessage,
    stopGeneration
  }
}
