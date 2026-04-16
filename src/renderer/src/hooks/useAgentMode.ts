import { useRef, useCallback } from 'react'
import { useStore, type Message } from '../store'

const API_BASE = 'http://localhost:3847/api'

interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

interface AgentModeOptions {
  providerApiKey: string
  providerApiUrl?: string
  model: string
  currentCwd: string
  projectPath: string | null
  currentSession: string | null
  localSessions: Array<{ id: string; title?: string }>
  commands: Array<{ name: string; description: string }>
  tools: Array<{ name: string; description: string }>
}

interface AgentModeResult {
  success: boolean
  error?: string
}

/**
 * 智能体模式专用 Hook
 * 基于智能问答模式，增加更多工具调用能力
 * 展示方式与智能问答保持一致
 */
export function useAgentMode() {
  const abortControllerRef = useRef<AbortController | null>(null)
  const { addMessage, updateMessage, updateTokens } = useStore()

  /**
   * 解析工具调用
   */
  const parseToolCalls = useCallback((text: string): ToolCall[] | null => {
    const toolCalls: ToolCall[] = []
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
    let match

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const blockContent = match[1].trim()
      if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
        try {
          const parsed = JSON.parse(blockContent)
          if (parsed.tool && parsed.arguments) {
            toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
          }
        } catch (e) {
          // Not valid JSON or not a tool call block
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
   * 构建系统提示词 - 包含更多工具信息
   */
  const buildSystemPrompt = useCallback((
    commands: Array<{ name: string; description: string }>,
    tools: Array<{ name: string; description: string }>,
    cwd: string,
    projectContext: string
  ): string => {
    return `You are an AI assistant that can use commands and tools to help users.

Available commands:
${commands.map(c => `- ${c.name}: ${c.description}`).join('\n')}

Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Current working directory: ${cwd}

${projectContext ? `Project context:\n${projectContext}` : ''}

When you need to use a tool, output it in this JSON format:
\`\`\`json
{
  "tool": "tool_name",
  "arguments": { ... }
}
\`\`\``
  }, [])

  /**
   * 处理智能体模式的消息
   * 基于智能问答模式，增加更多工具能力
   */
  const processAgentMessage = useCallback(async (
    content: string,
    apiMessages: Message[],
    options: AgentModeOptions
  ): Promise<AgentModeResult> => {
    const { providerApiKey, providerApiUrl, model, currentCwd, projectPath, currentSession, localSessions, commands, tools } = options

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
      // Tool calling loop - no upper limit for agent mode
      while (true) {
        iterationCount++
        console.log(`[useAgentMode] Iteration ${iterationCount}`)

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
          console.log('[useAgentMode] No tool calls detected, conversation complete')
          break
        }

        console.log('[useAgentMode] Detected tool calls:', toolCalls.length)

        // Remove tool call JSON blocks from display
        let cleanedIterationContent = iterationContent
        const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
        let match
        const blocksToRemove: string[] = []

        while ((match = codeBlockRegex.exec(iterationContent)) !== null) {
          const blockContent = match[1].trim()
          if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
            try {
              const parsed = JSON.parse(blockContent)
              if (parsed.tool && parsed.arguments) {
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

          // Add visual indicator - same as chat mode
          fullContent += `\n\n---\n\n**🔧 正在执行工具**\n\n`
          fullContent += toolCalls.map(tc => `- ⏳ ${tc.tool}`).join('\n')
          fullContent += '\n\n'
          updateLastMessage(fullContent)
        }

        // Execute tools
        const toolResults: Array<{ tool: string; result: string; success: boolean }> = []
        let shouldRefreshFileExplorer = false

        for (const toolCall of toolCalls) {
          console.log(`[useAgentMode] Executing tool:`, toolCall.tool)
          const { success, result } = await executeTool(toolCall, currentCwd)
          toolResults.push({ tool: toolCall.tool, result, success })
          // Mark for refresh if file operation was successful
          if (success && ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir'].includes(toolCall.tool)) {
            shouldRefreshFileExplorer = true
          }
        }

        // Trigger file explorer refresh after file operations
        if (shouldRefreshFileExplorer) {
          console.log('[useAgentMode] File operation completed, triggering refresh')
          window.dispatchEvent(new CustomEvent('file-operation-completed'))
        }

        // Build tool execution summary - same as chat mode
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
      console.error('[useAgentMode] Error:', error)
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
    processAgentMessage,
    stopGeneration,
    buildSystemPrompt
  }
}
