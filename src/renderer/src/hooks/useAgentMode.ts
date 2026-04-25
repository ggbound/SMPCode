import { useRef, useCallback } from 'react'
import { useStore, type Message } from '../store'
import { buildAgentModePrompt, getSystemInfo, type PromptCommand } from '../prompts'
import { executeTool } from '../services/tool-client'

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
  tools: Array<{
    name: string
    description: string
    parameters?: Record<string, { type: string; description: string; required?: boolean }>
    required?: string[]
  }>
}

/**
 * 从截断的 JSON 内容中提取工具调用信息
 * 当 AI 返回的 JSON 被截断时使用启发式方法提取关键信息
 */
function extractToolCallFromTruncatedContent(content: string): Array<ToolCall> {
  try {
    const toolCalls: Array<ToolCall> = []
    
    // 尝试提取 tool_calls 数组格式
    const toolCallsMatch = content.match(/"tool_calls"\s*:\s*\[/)
    if (toolCallsMatch) {
      // 格式: {"tool_calls": [{"name": "...", "arguments": {...}}]}
      const arrayStartIndex = content.indexOf('[')
      const arrayContent = content.substring(arrayStartIndex)
      
      // 尝试提取每个工具调用
      const nameMatches = Array.from(arrayContent.matchAll(/"name"\s*:\s*"([^"]+)"/g))
      
      for (const nameMatch of nameMatches) {
        const toolName = nameMatch[1]
        const nameIndex = nameMatch.index!
        
        // 查找对应的 arguments
        const argsSection = arrayContent.substring(nameIndex)
        const argsMatch = argsSection.match(/"arguments"\s*:\s*\{/)
        
        if (argsMatch) {
          const argsStartIndex = argsSection.indexOf('{', argsMatch.index)
          const argsContent = argsSection.substring(argsStartIndex)
          
          // 提取参数
          const args: Record<string, unknown> = {}
          
          // 提取 path 参数
          const pathMatch = argsContent.match(/"path"\s*:\s*"([^"]+)"/)
          if (pathMatch) args.path = pathMatch[1]
          
          // 提取 command 参数
          const commandMatch = argsContent.match(/"command"\s*:\s*"([^"]+)"/)
          if (commandMatch) args.command = commandMatch[1]
          
          // 提取 query/pattern 参数
          const queryMatch = argsContent.match(/"(query|pattern)"\s*:\s*"([^"]+)"/)
          if (queryMatch) args[queryMatch[1]] = queryMatch[2]
          
          // 提取其他简单参数
          const paramMatches = argsContent.matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g)
          for (const match of paramMatches) {
            const key = match[1]
            const value = match[2]
            if (!(key in args)) {
              args[key] = value
            }
          }
          
          if (Object.keys(args).length > 0) {
            toolCalls.push({ tool: toolName, arguments: args })
            console.log('[extractToolCallFromTruncatedContent] Extracted tool call:', toolName, args)
          }
        }
      }
    } else {
      // 尝试提取单个工具格式: {"tool": "...", "arguments": {...}}
      const toolMatch = content.match(/"tool"\s*:\s*"([^"]+)"/)
      if (!toolMatch) return []
      const toolName = toolMatch[1]

      // 尝试提取 arguments 对象的开始
      const argsMatch = content.match(/"arguments"\s*:\s*\{/)
      if (!argsMatch) return []

      // 从 arguments 开始位置提取所有可能的键值对
      const argsStartIndex = content.indexOf('"arguments"')
      const argsContent = content.substring(argsStartIndex + '"arguments"'.length)

      // 尝试提取常见的参数
      const args: Record<string, unknown> = {}

      // 提取 path 参数
      const pathMatch = argsContent.match(/"path"\s*:\s*"([^"]+)"/)
      if (pathMatch) args.path = pathMatch[1]

      // 提取 content 参数（可能是多行，尝试匹配到下一个引号前）
      const contentMatch = argsContent.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*})/)
      if (contentMatch) args.content = contentMatch[1]

      // 提取 old_string 参数
      const oldStringMatch = argsContent.match(/"old_string"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*})/)
      if (oldStringMatch) args.old_string = oldStringMatch[1]

      // 提取 new_string 参数（可能被截断，尝试提取已有部分）
      const newStringMatch = argsContent.match(/"new_string"\s*:\s*"([\s\S]*?)$/)
      if (newStringMatch) {
        // 如果被截断，尝试清理未闭合的转义字符
        let newString = newStringMatch[1]
        // 移除末尾未闭合的转义序列
        newString = newString.replace(/\\$/, '')
        args.new_string = newString
      }

      // 提取其他常见参数
      const paramMatches = argsContent.matchAll(/"(\w+)"\s*:\s*(?:"([^"]*)"|true|false|null|\d+)/g)
      for (const match of paramMatches) {
        const key = match[1]
        const value = match[2]
        if (!(key in args)) {
          if (value === undefined) {
            // 可能是布尔值或数字
            if (match[0].includes('true')) args[key] = true
            else if (match[0].includes('false')) args[key] = false
            else if (match[0].includes('null')) args[key] = null
            else {
              const numMatch = match[0].match(/:\s*(\d+)/)
              if (numMatch) args[key] = parseInt(numMatch[1], 10)
            }
          } else {
            args[key] = value
          }
        }
      }

      if (Object.keys(args).length > 0) {
        console.log('[extractToolCallFromTruncatedContent] Extracted args:', Object.keys(args))
        toolCalls.push({ tool: toolName, arguments: args })
      }
    }
    
    return toolCalls
  } catch (e) {
    console.log('[extractToolCallFromTruncatedContent] Extraction failed:', e)
    return []
  }
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
   * 支持在一次回复中解析多个工具调用（包括代码块中的多行 JSON）
   */
  const parseToolCalls = useCallback((text: string): ToolCall[] | null => {
    console.log('[parseToolCalls] ========== Starting Tool Call Parsing ==========')
    console.log('[parseToolCalls] Input text length:', text.length)
    
    const toolCalls: ToolCall[] = []

    // Method 1: Parse MiniMax XML format tool calls
    console.log('[parseToolCalls] Method 1: Checking for <minimax:tool_call> format')
    // Format: <minimax:tool_call><invoke name="ToolName"><parameter name="arg">value</parameter></invoke></minimax:tool_call>
    const xmlToolCallRegex = /<minimax:tool_call>[\s\S]*?<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>[\s\S]*?<\/minimax:tool_call>/g
    const xmlMatches = Array.from(text.matchAll(xmlToolCallRegex))

    for (const match of xmlMatches) {
      const toolName = match[1]
      const paramsContent = match[2]

      // Parse parameters from XML
      const args: Record<string, unknown> = {}
      const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g
      const paramMatches = Array.from(paramsContent.matchAll(paramRegex))

      for (const paramMatch of paramMatches) {
        const paramName = paramMatch[1]
        const paramValue = paramMatch[2].trim()
        args[paramName] = paramValue
      }

      if (toolName && Object.keys(args).length > 0) {
        toolCalls.push({ tool: toolName, arguments: args })
        console.log('[parseToolCalls] Parsed XML tool call:', toolName, args)
      }
    }

    // Method 1.5: Check for <function_calls> format (Claude-style XML)
    console.log('[parseToolCalls] Method 1.5: Checking for <function_calls> format (Claude-style)')
    const functionCallsRegex = /<function_calls>[\s\S]*?<invoke\s+name=["']([^"']+)["'][\s\S]*?<parameter\s+name=["']([^"']+)["'][\s\S]*?<\/parameter>[\s\S]*?<\/invoke>[\s\S]*?<\/function_calls>/gi
    const functionCallsMatches = text.matchAll(functionCallsRegex)
    
    for (const match of functionCallsMatches) {
      try {
        const toolName = match[1]
        const paramName = match[2]
        
        // Extract parameter value from the full match
        const fullMatch = match[0]
        const paramMatch = fullMatch.match(new RegExp(`<parameter\\s+name=["']${paramName}["']>([\\s\\S]*?)<\\/parameter>`))
        const paramValue = paramMatch ? paramMatch[1].trim() : ''
        
        toolCalls.push({ 
          tool: toolName, 
          arguments: { [paramName]: paramValue }
        })
        console.log('[parseToolCalls] Parsed Claude-style function call:', toolName, { [paramName]: paramValue })
      } catch (e) {
        console.log('[parseToolCalls] Failed to parse Claude-style function call:', e)
      }
    }

    // Method 2: Parse <tool_code> XML format tool calls
    console.log('[parseToolCalls] Method 2: Checking for <tool_code> format')
    // Format: <tool_code> <tool name="ToolName" param1="value1" param2="value2"/> </tool_code>
    // Also handles incomplete/truncated tool_code blocks
    // Use [\s\S]*? to match any content including newlines, non-greedy
    const toolCodeRegex = /<tool_code>[\s\S]*?<tool\s+name="([^"]+)"([\s\S]*?)(?:\/>|<\/tool>)[\s\S]*?(?:<\/tool_code>|$)/g
    const toolCodeMatches = Array.from(text.matchAll(toolCodeRegex))

    for (const match of toolCodeMatches) {
      const toolName = match[1]
      let attrsContent = match[2]

      // Decode HTML entities that might be in the content
      attrsContent = attrsContent.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

      // Parse attributes from the tool tag
      // Handle both simple values and values with escaped quotes
      const args: Record<string, unknown> = {}
      // Match attributes with values that may contain escaped quotes
      // Pattern: name="value" where value can contain \" (escaped quotes)
      const attrRegex = /(\w+)="((?:[^"\\]|\\.)*)"/g
      let attrMatch
      while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
        const attrName = attrMatch[1]
        let attrValue = attrMatch[2]
        // Unescape escaped characters (\", \\, \n, etc.)
        attrValue = attrValue.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
        // Skip the 'name' attribute as it's the tool name
        if (attrName !== 'name') {
          args[attrName] = attrValue
        }
      }

      if (toolName && Object.keys(args).length > 0) {
        toolCalls.push({ tool: toolName, arguments: args })
        console.log('[parseToolCalls] Parsed <tool_code> tool call:', toolName, Object.keys(args))
      }
    }

    // Method 3: Parse JSON format tool calls from code blocks
    console.log('[parseToolCalls] Method 3: Checking for JSON code blocks')
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
    const matches = Array.from(text.matchAll(codeBlockRegex))
    console.log(`[parseToolCalls] Found ${matches.length} code blocks`)

    for (const match of matches) {
      let blockContent = match[1].trim()
      console.log('[parseToolCalls] Code block content preview:', blockContent.substring(0, 100))

      // Check for tool call pattern (support both "tool" and 'tool')
      const hasToolPattern = blockContent.includes('"tool"') || blockContent.includes("'tool'") || blockContent.includes('tool')
      const hasArgumentsPattern = blockContent.includes('"arguments"') || blockContent.includes("'arguments'") || blockContent.includes('arguments')
      const hasToolCallsArray = blockContent.includes('"tool_calls"') || blockContent.includes("'tool_calls'")

      if (hasToolCallsArray) {
        // PRIORITY 3a: Parse tool_calls array format (OpenAI standard)
        console.log('[parseToolCalls] Detected tool_calls array format')
        
        try {
          // Try to fix incomplete JSON
          const openBraces = (blockContent.match(/\{/g) || []).length
          const closeBraces = (blockContent.match(/\}/g) || []).length
          if (openBraces > closeBraces) {
            console.log(`[parseToolCalls] JSON appears incomplete, adding ${openBraces - closeBraces} closing braces`)
            blockContent += '}'.repeat(openBraces - closeBraces)
          }
          
          const parsed = JSON.parse(blockContent)
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            console.log('[parseToolCalls] Parsing tool_calls array with', parsed.tool_calls.length, 'items')
            for (const tc of parsed.tool_calls) {
              // Support both {name, arguments} and {tool, arguments} formats
              const toolName = tc.name || tc.tool || tc.function?.name
              const toolArgs = tc.arguments || tc.function?.arguments || {}
              
              if (toolName && typeof toolArgs === 'object') {
                toolCalls.push({ tool: toolName, arguments: toolArgs })
                console.log('[parseToolCalls] Parsed tool_call from array:', toolName)
              }
            }
            continue
          }
        } catch (e) {
          console.log('[parseToolCalls] Failed to parse tool_calls array:', e)
        }
      }

      if (hasToolPattern && hasArgumentsPattern) {
        console.log('[parseToolCalls] Detected tool call pattern in code block')

        // Try to fix incomplete JSON (AI may have truncated the output)
        // Common issue: missing closing braces
        const openBraces = (blockContent.match(/\{/g) || []).length
        const closeBraces = (blockContent.match(/\}/g) || []).length
        if (openBraces > closeBraces) {
          console.log(`[parseToolCalls] JSON appears incomplete, adding ${openBraces - closeBraces} closing braces`)
          blockContent += '}'.repeat(openBraces - closeBraces)
        }

        // 尝试解析整个代码块内容为单个 JSON
        try {
          const parsed = JSON.parse(blockContent)
          if (parsed.tool && typeof parsed.arguments === 'object') {
            toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
            console.log('[parseToolCalls] Parsed single JSON tool call:', parsed.tool)
            continue
          }
        } catch (e) {
          console.log('[parseToolCalls] Not a single JSON, trying line by line parsing')
        }

        // 尝试按行解析多个 JSON 对象
        const lines = blockContent.split('\n').filter(line => line.trim())
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim())
            if (parsed.tool && typeof parsed.arguments === 'object') {
              toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
              console.log('[parseToolCalls] Parsed line JSON tool call:', parsed.tool)
            }
          } catch (e) {
            // 这一行不是有效的工具调用 JSON
          }
        }

        // 尝试从截断的内容中提取有效的工具调用信息
        // 如果上述方法都失败了，尝试提取关键信息构建工具调用
        if (!toolCalls.length) {
          console.log('[parseToolCalls] Trying to extract tool call from truncated content')
          const extractedToolCalls = extractToolCallFromTruncatedContent(blockContent)
          if (extractedToolCalls.length > 0) {
            toolCalls.push(...extractedToolCalls)
            console.log('[parseToolCalls] Extracted tool calls from truncated content:', extractedToolCalls.length, extractedToolCalls.map(tc => tc.tool))
          }
        }
      } else {
        console.log('[parseToolCalls] No tool call pattern found in code block')
      }
    }

    // Method 4: DISABLED - Parsing HTML tool execution cards causes issues
    // The HTML cards are generated by frontend, not returned by AI
    // Parsing them leads to incorrect parameter extraction (e.g., SVG paths)
    // TODO: Re-enable only if AI actually returns HTML format tool calls
    /*
    console.log('[parseToolCalls] Method 4: DISABLED - HTML parsing causes parameter extraction errors')
    */

    console.log('[parseToolCalls] ========== Parsing Complete ==========')
    console.log('[parseToolCalls] Total tool calls found:', toolCalls.length)
    console.log('[parseToolCalls] Tool calls:', toolCalls.map(tc => ({ tool: tc.tool, args: Object.keys(tc.arguments) })))
    
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
   * 执行单个工具调用 - 使用新的工具客户端
   */
  const executeToolCall = useCallback(async (
    toolCall: ToolCall,
    cwd: string
  ): Promise<{ success: boolean; result: string }> => {
    try {
      // Use tool-client.ts to execute tool (this will properly record in store)
      const result = await executeTool(toolCall.tool, toolCall.arguments, { cwd })

      return {
        success: result.success,
        result: result.output || result.error || 'No output'
      }
    } catch (error) {
      console.error(`[useAgentMode] Tool execution error:`, toolCall.tool, error)
      return { success: false, result: String(error) }
    }
  }, [])

  /**
   * 构建系统提示词 - 使用新的提示词模块
   * 注意：工具名称统一使用 snake_case（如 write_file），与执行器保持一致
   */
  const buildSystemPrompt = useCallback((
    commands: Array<{ name: string; description: string }>,
    tools: Array<{
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

    // Context compression: Keep last N messages to prevent API overflow
    const MAX_CONTEXT_MESSAGES = 20
    const compressContext = (messages: Message[]): Message[] => {
      if (messages.length <= MAX_CONTEXT_MESSAGES) return messages

      // Keep last N messages (both user and assistant)
      return messages.slice(-MAX_CONTEXT_MESSAGES)
    }

    try {
      // Tool calling loop - no upper limit for agent mode
      while (true) {
        iterationCount++
        console.log(`[useAgentMode] Iteration ${iterationCount}, total messages: ${conversationMessages.length}`)

        // Compress context before sending to API
        const compressedMessages = compressContext(conversationMessages)
        console.log(`[useAgentMode] Compressed to ${compressedMessages.length} messages`)

        // Call API with streaming
        // CRITICAL: Pass tools definition to enable OpenAI standard tool calling
        const toolsForAPI = tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: tool.parameters || {},
              required: tool.required || []
            }
          }
        }))
        
        console.log('[useAgentMode] 🛠️ Sending tools to API:', toolsForAPI.map(t => t.function.name))
        
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: providerApiKey,
            model,
            messages: compressedMessages,
            tools: toolsForAPI,
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
        let streamToolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []

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
                  
                  // CRITICAL: Extract tool_calls from stream chunk (OpenAI standard)
                  // This is how VSCode and Claude Code handle tool calls
                  if (parsed.choices?.[0]?.delta?.tool_calls) {
                    const toolCallsDelta = parsed.choices[0].delta.tool_calls
                    console.log('[useAgentMode] 🛠️ Detected tool_calls in stream:', toolCallsDelta)
                    
                    // Parse tool calls from the delta
                    // tool_calls can be an array of tool call objects
                    for (const tc of toolCallsDelta) {
                      if (tc.function?.name) {
                        const toolName = tc.function.name
                        let toolArgs = {}
                        
                        // Arguments may come as a string that needs parsing
                        if (tc.function.arguments) {
                          try {
                            toolArgs = JSON.parse(tc.function.arguments)
                          } catch (e) {
                            // Arguments might be streamed in chunks, handle partial JSON
                            console.log('[useAgentMode] Partial tool arguments received, will parse later')
                          }
                        }
                        
                        streamToolCalls.push({ tool: toolName, arguments: toolArgs })
                        console.log('[useAgentMode] Extracted tool call:', toolName, toolArgs)
                      }
                    }
                  }
                  
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
          // Check if this is an abort error (user cancelled)
          const errorStr = String(streamError)
          if (errorStr.includes('abort') || errorStr.includes('AbortError')) {
            console.log('[useAgentMode] Stream was aborted by user')
            // Still check for tool calls in the partial content received so far
            console.log('[useAgentMode] Checking for tool calls in partial iteration content, length:', iterationContent.length)
            const partialToolCalls = parseToolCalls(iterationContent)
            if (partialToolCalls && partialToolCalls.length > 0) {
              console.log('[useAgentMode] Found tool calls in partial content, continuing execution:', partialToolCalls.map(tc => tc.tool))
              // Continue with tool execution even though stream was aborted
            } else {
              fullContent += '\n\n**已停止：** 用户中断了生成'
              updateLastMessage(fullContent)
              break
            }
          } else {
            fullContent += `\n\n**错误：** 读取响应流时出错：${errorStr}`
            updateLastMessage(fullContent)
            break
          }
        }

        // Check for tool calls
        console.log('[useAgentMode] ========== Checking for Tool Calls ==========')
        console.log('[useAgentMode] Stream tool calls detected:', streamToolCalls.length)
        console.log('[useAgentMode] Iteration content length:', iterationContent.length)
        console.log('[useAgentMode] Iteration content preview (first 500 chars):', iterationContent.substring(0, 500))
        
        // PRIORITY 1: Use tool_calls from stream (OpenAI standard, like VSCode/Claude Code)
        let toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []
        
        if (streamToolCalls.length > 0) {
          console.log('[useAgentMode] ✅ Using tool_calls from stream (OpenAI standard)')
          toolCalls = streamToolCalls
        } else {
          // PRIORITY 2: Fallback to text parsing (legacy support)
          console.log('[useAgentMode] ⚠️ No stream tool calls, trying text parsing...')
          console.log('[useAgentMode] Contains minimax:tool_call:', iterationContent.includes('<minimax:tool_call>'))
          console.log('[useAgentMode] Contains tool_code:', iterationContent.includes('<tool_code>'))
          console.log('[useAgentMode] Contains ```json:', iterationContent.includes('```json'))
          console.log('[useAgentMode] Contains ```bash:', iterationContent.includes('```bash'))
          
          const parsedCalls = parseToolCalls(iterationContent)
          toolCalls = parsedCalls || []
        }

        if (!toolCalls || toolCalls.length === 0) {
          console.log('[useAgentMode] ❌ No tool calls detected, conversation complete')
          console.log('[useAgentMode] Full content preview (last 500 chars):', fullContent.substring(fullContent.length - 500))
          break
        }

        console.log('[useAgentMode] ✅ Detected tool calls:', toolCalls.length, toolCalls.map(tc => tc.tool))
        console.log('[useAgentMode] 🔄 Starting single-tool execution loop')
        
        let shouldRefreshFileExplorer = false

        // CRITICAL: Enforce SINGLE tool execution per iteration
        // AI should only call ONE tool at a time for proper verification loop
        if (toolCalls.length > 1) {
          console.log(`[useAgentMode] ⚠️ AI returned ${toolCalls.length} tools, but we only execute the FIRST one`)
          console.log(`[useAgentMode] Tools received:`, toolCalls.map(tc => tc.tool))
          console.log(`[useAgentMode] Executing only: ${toolCalls[0].tool}`)
        }
        
        // Take only the FIRST tool call
        const toolCall = toolCalls[0]
        console.log(`[useAgentMode] ━━━ Executing single tool: ${toolCall.tool} ━━━`)
        
        try {
          const { success, result } = await executeToolCall(toolCall, currentCwd)
          
          // Mark for refresh if file operation was successful
          const fileOperationTools = ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir', 'FileWriteTool', 'FileDeleteTool', 'FileEditTool', 'FileAppendTool', 'MkdirTool']
          if (success && fileOperationTools.includes(toolCall.tool)) {
            shouldRefreshFileExplorer = true
          }
          
          console.log(`[useAgentMode] ✅ Tool ${toolCall.tool} completed: ${success ? 'SUCCESS' : 'FAILED'}`)
          
          // CRITICAL: After tool execution, send result to AI immediately
          console.log(`[useAgentMode] 📤 Sending tool result to AI for verification...`)
          
          const verificationPrompt = `工具执行结果：

**工具名称：** ${toolCall.tool}
**参数：** \`\`\`json\n${JSON.stringify(toolCall.arguments, null, 2)}\n\`\`\`
**执行状态：** ${success ? '✅ 成功' : '❌ 失败'}
**结果：**
\`\`\`
${result.slice(0, 2000)}${result.length > 2000 ? '\n... (已截断)' : ''}
\`\`\`

请分析以上结果，然后：
1. 如果任务已完成，输出最终总结（不要调用工具）
2. 如果还需要继续，请调用下一个工具（使用 \`\`\`json 代码块，**只调用一个工具**）`          
          
          // Add tool result to conversation
          conversationMessages = [
            ...conversationMessages,
            { role: 'assistant' as const, content: iterationContent },
            { role: 'user' as const, content: verificationPrompt }
          ]
          
          console.log('[useAgentMode] 🔄 Exiting iteration to let outer loop continue with AI response')
          
          // CRITICAL: Remove ALL tool call JSON blocks from fullContent
          // This prevents BuilderMessage from showing tools that weren't executed
          let cleanedFullContent = fullContent
          const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
          const codeMatches = Array.from(fullContent.matchAll(codeBlockRegex))
          
          for (const match of codeMatches) {
            const blockContent = match[1].trim()
            const fullBlock = match[0]
            
            // Remove tool call blocks (both single tool and tool_calls array)
            const hasToolPattern = blockContent.includes('"tool"') || 
                                   blockContent.includes("'tool'") ||
                                   blockContent.includes('"tool_calls"') ||
                                   blockContent.includes("'tool_calls'") ||
                                   blockContent.includes('"name"') && blockContent.includes('"arguments"')
            
            if (hasToolPattern) {
              console.log('[useAgentMode] 🧹 Removing tool call JSON block from fullContent')
              cleanedFullContent = cleanedFullContent.replace(fullBlock, '')
            }
          }
          
          // Update fullContent with cleaned version
          fullContent = cleanedFullContent.trim()
          
          // Also clean iterationContent for the conversation history
          iterationContent = iterationContent.replace(/```(?:json)?\s*\n?[\s\S]*?```/g, '').trim()
          
          updateLastMessage(fullContent)
          
          console.log('[useAgentMode] 🔄 Continuing to next iteration for AI response...')
          // Continue the while loop to make a new API call with updated conversationMessages
          continue
        } catch (toolError) {
          console.error(`[useAgentMode] ❌ Tool execution error:`, toolCall.tool, toolError)
          
          // Still send error result to AI
          const errorPrompt = `工具执行失败：

**工具名称：** ${toolCall.tool}
**参数：** \`\`\`json\n${JSON.stringify(toolCall.arguments, null, 2)}\n\`\`\`
**错误信息：** ${String(toolError)}

请根据错误信息调整策略，重新调用工具或选择其他方式。`
          
          conversationMessages = [
            ...conversationMessages,
            { role: 'assistant' as const, content: iterationContent },
            { role: 'user' as const, content: errorPrompt }
          ]
          
          // Also clean tool call blocks from fullContent on error
          let cleanedFullContent = fullContent
          const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
          const codeMatches = Array.from(fullContent.matchAll(codeBlockRegex))
          
          for (const match of codeMatches) {
            const blockContent = match[1].trim()
            const fullBlock = match[0]
            
            const hasToolPattern = blockContent.includes('"tool"') || 
                                   blockContent.includes("'tool'") ||
                                   blockContent.includes('"tool_calls"') ||
                                   blockContent.includes("'tool_calls'") ||
                                   blockContent.includes('"name"') && blockContent.includes('"arguments"')
            
            if (hasToolPattern) {
              cleanedFullContent = cleanedFullContent.replace(fullBlock, '')
            }
          }
          
          fullContent = cleanedFullContent.trim()
          iterationContent = iterationContent.replace(/```(?:json)?\s*\n?[\s\S]*?```/g, '').trim()
          updateLastMessage(fullContent)
          
          console.log('[useAgentMode] 🔄 Continuing to next iteration after error...')
          continue
        }
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
