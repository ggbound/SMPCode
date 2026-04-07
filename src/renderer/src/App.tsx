import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ProviderConfig } from './store'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsModal from './components/SettingsModal'
import StatusBar from './components/StatusBar'
import FileExplorer from './components/FileExplorer'
import FileViewer from './components/FileViewer'
import Terminal, { type TerminalRef } from './components/Terminal'
import { t } from './i18n'

const API_BASE = 'http://localhost:3847/api'

// Build system prompt with available commands and tools
function buildSystemPrompt(commands: { name: string; responsibility: string }[], tools: { name: string; responsibility: string }[], cwd: string): string {
  const platform = navigator.platform.toLowerCase().includes('win') ? 'Windows' :
                   navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Linux'

  let prompt = `You are Claude Code, an AI coding assistant with direct access to the user's file system and command line. You can read, write, and edit files, execute shell commands, and help with software development tasks.\n\n`

  prompt += `=== SYSTEM INFORMATION ===\n`
  prompt += `Platform: ${platform}\n`
  prompt += `Working Directory: ${cwd}\n\n`

  prompt += `=== CORE PRINCIPLES ===\n`
  prompt += `1. **ALWAYS USE TOOLS**: When the user asks you to create, edit, or modify files, you MUST use the available tools. Do not just describe what you would do.\n`
  prompt += `2. **BE PROACTIVE**: Take initiative to complete tasks. If you see a way to help, do it.\n`
  prompt += `3. **EXPLAIN YOUR ACTIONS**: After using tools, briefly summarize what you did and why.\n`
  prompt += `4. **ASK FOR CLARITY**: If a request is ambiguous, ask clarifying questions before proceeding.\n\n`

  prompt += `=== AVAILABLE TOOLS ===\n`
  prompt += `Use these tools by outputting JSON code blocks:\n\n`
  prompt += `**read_file(path)** - Read file contents\n`
  prompt += `  Example: {"tool": "read_file", "arguments": {"path": "/path/to/file.txt"}}\n\n`
  prompt += `**write_file(path, content)** - Create or overwrite files\n`
  prompt += `  Example: {"tool": "write_file", "arguments": {"path": "/path/to/file.txt", "content": "file contents"}}\n\n`
  prompt += `**edit_file(path, old_string, new_string)** - Replace specific text\n`
  prompt += `  Example: {"tool": "edit_file", "arguments": {"path": "/path/to/file.txt", "old_string": "old text", "new_string": "new text"}}\n\n`
  prompt += `**delete_file(path)** - Delete a file or directory\n`
  prompt += `  Example: {"tool": "delete_file", "arguments": {"path": "/path/to/file.txt"}}\n\n`
  prompt += `**list_directory(path)** - List directory contents\n`
  prompt += `  Example: {"tool": "list_directory", "arguments": {"path": "/path/to/dir"}}\n\n`
  prompt += `**execute_bash(command)** - Execute shell commands\n`
  prompt += `  Example: {"tool": "execute_bash", "arguments": {"command": "npm install"}}\n\n`
  prompt += `**search_code(pattern, path?)** - Search for code patterns\n`
  prompt += `  Example: {"tool": "search_code", "arguments": {"pattern": "function main", "path": "/path/to/search"}}\n\n`
  prompt += `**get_running_processes()** - Get list of running processes in terminal\n`
  prompt += `  Example: {"tool": "get_running_processes", "arguments": {}}\n\n`
  prompt += `**stop_process(process_id)** - Stop a running process by its ID\n`
  prompt += `  Example: {"tool": "stop_process", "arguments": {"process_id": "abc-123"}}\n\n`
  prompt += `**restart_process(process_id)** - Restart a running process by its ID\n`
  prompt += `  Example: {"tool": "restart_process", "arguments": {"process_id": "abc-123"}}\n\n`

  prompt += `=== TOOL INVOCATION FORMAT ===\n`
  prompt += `IMPORTANT: When you need to use a tool, you MUST output the tool call in a JSON code block format like this:\n`
  prompt += `\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

`
  prompt += `CRITICAL RULES:\n`
  prompt += `1. ONLY use the JSON code block format shown above\n`
  prompt += `2. NEVER use any other format like <|tool_calls_section_begin|> or special markers\n`
  prompt += `3. ALWAYS wrap the JSON in triple backticks with 'json' language identifier\n`
  prompt += `4. You can invoke multiple tools by outputting multiple JSON code blocks in sequence\n`
  prompt += `5. DO NOT output raw text explanations before or between tool calls\n`
  prompt += `6. When multiple tools are needed, output them one after another in separate code blocks\n\n`
  prompt += `=== RESPONSE FORMAT ===\n`
  prompt += `When you need to use tools, your ENTIRE response must be ONLY the JSON code block(s).\n`
  prompt += `Do not include any explanatory text before, between, or after the tool calls.\n`
  prompt += `Example of CORRECT response with multiple tools:\n`
  prompt += `\`\`\`json
{"tool": "list_directory", "arguments": {"path": "/project"}}
\`\`\`
\`\`\`json
{"tool": "read_file", "arguments": {"path": "/project/package.json"}}
\`\`\`

`
  prompt += `Example of INCORRECT response (do NOT do this):\n`
  prompt += `Let me check the directory first:\n\`\`\`json
{"tool": "list_directory", "arguments": {"path": "/project"}}
\`\`\`
Now let me read the file...\n\`\`\`json
{"tool": "read_file", "arguments": {"path": "/project/package.json"}}
\`\`\`

`

  if (commands.length > 0) {
    prompt += `=== AVAILABLE COMMANDS ===\n`
    prompt += `Users can type /command_name to execute these:\n`
    commands.slice(0, 20).forEach(cmd => {
      prompt += `  /${cmd.name} - ${cmd.responsibility}\n`
    })
    prompt += `\n`
  }

  prompt += `=== WORKFLOW GUIDELINES ===\n`
  prompt += `When creating projects or modifying files:\n`
  prompt += `1. **Explore First**: Use list_directory to understand the current structure\n`
  prompt += `2. **Plan Ahead**: Think about the complete set of changes needed\n`
  prompt += `3. **Execute**: Use write_file, edit_file, and execute_bash as needed\n`
  prompt += `4. **Verify**: Check that changes were applied correctly\n`
  prompt += `5. **Summarize**: Provide a brief summary of what was accomplished\n\n`

  prompt += `=== PROCESS MANAGEMENT GUIDELINES ===\n`
  prompt += `When user asks to stop, restart, or manage running services/processes:\n`
  prompt += `1. **DO NOT USE pkill or kill commands** - These won't work properly with the terminal system\n`
  prompt += `2. **DO NOT assume process status** - Always use tools to check actual process status\n`
  prompt += `3. **MUST USE TOOLS** - You MUST call get_running_processes() first, then stop_process() to actually stop a process\n`
  prompt += `4. **NEVER say process is stopped without using stop_process tool** - Always use the tool\n`
  prompt += `\n**REQUIRED WORKFLOW to stop a process:**\n`
  prompt += `Step 1: Get current running processes:\n`
  prompt += `  {"tool": "get_running_processes", "arguments": {}}\n`
  prompt += `Step 2: Find the process ID from the output\n`
  prompt += `Step 3: Call stop_process with the actual process ID:\n`
  prompt += `  {"tool": "stop_process", "arguments": {"process_id": "actual-process-id-from-step-1"}}\n`
  prompt += `Step 4: Call get_running_processes again to verify the process is actually stopped\n\n`
  prompt += `**CRITICAL**: If user says "帮我中断/停止 server", you MUST:\n`
  prompt += `1. Call get_running_processes() to get the process ID\n`
  prompt += `2. Call stop_process(process_id) with the actual ID\n`
  prompt += `3. Call get_running_processes() again to verify\n`
  prompt += `4. Only then report success/failure based on actual tool results\n\n`

  prompt += `=== NODE.JS PROJECT STARTUP GUIDELINES ===\n`
  prompt += `When starting a Node.js/TypeScript project:\n`
  prompt += `1. **ALWAYS read package.json first** - Check the "scripts" section to find the correct start command\n`
  prompt += `2. **Check if dist/index.js exists** - If the project uses TypeScript and the compiled file doesn't exist, run 'npm run build' first\n`
  prompt += `3. **Common start commands:**\n`
  prompt += `   - npm start (most common)\n`
  prompt += `   - npm run dev (for development)\n`
  prompt += `   - node dist/index.js (if already compiled)\n`
  prompt += `   - npm run serve (for Vue/React projects)\n`
  prompt += `4. **DO NOT guess the entry file** - Don't use 'node app.js' unless you see it in package.json\n`
  prompt += `5. **Example workflow to start a project:**\n`
  prompt += `   {"tool": "read_file", "arguments": {"path": "/path/to/project/package.json"}}\n`
  prompt += `   Then use the appropriate start command from the scripts section\n\n`

  prompt += `=== SAFETY & SECURITY ===\n`
  prompt += `- Never execute destructive commands without user confirmation\n`
  prompt += `- Be careful with file deletions and overwrites\n`
  prompt += `- Respect user privacy and data\n\n`

  prompt += `=== RESPONSE LANGUAGE ===\n`
  prompt += `Respond in the same language as the user's query.\n`

  return prompt
}

interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showTerminal, setShowTerminal] = useState(true)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [selectedFileContent, setSelectedFileContent] = useState<string>('')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const terminalRef = useRef<TerminalRef>(null)

  const {
    apiKey,
    model,
    defaultModel,
    permissionMode,
    sessions,
    currentSession,
    messages,
    inputTokens,
    outputTokens,
    commands,
    tools,
    providers,
    setApiKey,
    setModel,
    setDefaultModel,
    setPermissionMode,
    setProviders,
    setCommands,
    setTools,
    addSession,
    selectSession,
    addMessage,
    clearMessages,
    updateTokens
  } = useStore()

  // Load commands and tools on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Try IPC first, fallback to HTTP API
        let commands = []
        let tools = []
        
        // Try IPC
        if (window.api?.getCommands) {
          console.log('Loading commands via IPC...')
          commands = await window.api.getCommands()
          console.log('Loaded commands via IPC:', commands.length)
        }
        
        if (window.api?.getTools) {
          console.log('Loading tools via IPC...')
          tools = await window.api.getTools()
          console.log('Loaded tools via IPC:', tools.length)
        }
        
        // Fallback to HTTP API if IPC not available or returned empty
        if (commands.length === 0) {
          console.log('Loading commands via HTTP API...')
          const commandsRes = await fetch(`${API_BASE}/commands`)
          if (commandsRes.ok) {
            const commandsData = await commandsRes.json()
            commands = commandsData.commands || []
            console.log('Loaded commands via HTTP:', commands.length)
          }
        }
        
        if (tools.length === 0) {
          console.log('Loading tools via HTTP API...')
          const toolsRes = await fetch(`${API_BASE}/tools`)
          if (toolsRes.ok) {
            const toolsData = await toolsRes.json()
            tools = toolsData.tools || []
            console.log('Loaded tools via HTTP:', tools.length)
          }
        }
        
        if (commands.length > 0) {
          setCommands(commands)
        }
        if (tools.length > 0) {
          setTools(tools)
        }
        
        setDataLoaded(true)
      } catch (error) {
        console.error('Failed to load commands/tools:', error)
        setDataLoaded(false)
      }
    }
    
    loadData()
  }, [setCommands, setTools])

  // Load config on mount
  useEffect(() => {
    window.api?.getConfig().then((config: Record<string, unknown>) => {
      console.log('Loaded config:', config)
      if (config?.apiKey !== undefined) setApiKey(config.apiKey as string)
      if (config?.defaultModel !== undefined) setDefaultModel(config.defaultModel as string)
      if (config?.permissionMode !== undefined) setPermissionMode(config.permissionMode as string)
      if (config?.providers && Array.isArray(config.providers)) {
        console.log('Setting providers:', config.providers.length)
        setProviders(config.providers as ProviderConfig[])
      }
      // Set model: use config.model if available, otherwise use defaultModel
      const modelToSet = (config?.model as string) || (config?.defaultModel as string)
      if (modelToSet) {
        console.log('Setting model:', modelToSet)
        setModel(modelToSet)
      }
    })

    // Listen for menu events
    const unsubNewSession = window.api?.onNewSession(() => {
      handleNewSession()
    })
    const unsubOpenSettings = window.api?.onOpenSettings(() => {
      setShowSettings(true)
    })

    return () => {
      unsubNewSession?.()
      unsubOpenSettings?.()
    }
  }, [])

  // Stop generation handler
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }

  // Auto-create session on mount if no current session
  useEffect(() => {
    const initSession = async () => {
      // 如果没有当前会话，自动创建一个新会话
      if (!currentSession) {
        try {
          const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' })
          const session = await res.json()
          addSession(session)
          selectSession(session.id)
          clearMessages()
        } catch (error) {
          console.error('Failed to create initial session:', error)
        }
      }
    }
    initSession()
  }, [currentSession, addSession, selectSession, clearMessages])

  const handleNewSession = useCallback(async () => {
    // Always create a new session
    const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' })
    const session = await res.json()
    addSession(session)
    selectSession(session.id)
    clearMessages()
  }, [addSession, selectSession, clearMessages])

  // Parse tool calls from AI response text
  const parseToolCalls = (text: string): Array<{ tool: string; arguments: Record<string, unknown> }> | null => {
    const toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []

    // Method 0: Parse special tool call format <|tool_calls_section_begin|>...<|tool_calls_section_end|>
    const toolCallsSectionRegex = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g
    let sectionMatch
    while ((sectionMatch = toolCallsSectionRegex.exec(text)) !== null) {
      const sectionContent = sectionMatch[1]
      // Parse individual tool calls within the section
      const toolCallRegex = /<\|tool_call_begin\|>functions\.(\w+):\d+<\|tool_call_args\|>([\s\S]*?)<\|tool_call_end\|>/g
      let toolMatch
      while ((toolMatch = toolCallRegex.exec(sectionContent)) !== null) {
        const toolName = toolMatch[1]
        const argsJson = toolMatch[2].trim()
        try {
          const args = JSON.parse(argsJson)
          toolCalls.push({ tool: toolName, arguments: args })
          console.log('Parsed tool call from special format:', toolName, args)
        } catch (e) {
          console.error('Failed to parse tool call args:', argsJson)
        }
      }
    }

    // Method 1: Look for JSON in markdown code blocks (```json ... ```)
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g
    let match
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const blockContent = match[1].trim()
      try {
        // Try to parse the entire block as JSON
        const parsed = JSON.parse(blockContent)
        if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
        }
      } catch (e) {
        // If the block contains multiple JSON objects (one per line), try each line
        const lines = blockContent.split('\n')
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine.startsWith('//')) continue
          try {
            const parsed = JSON.parse(trimmedLine)
            if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
              toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
            }
          } catch (e2) {
            // Try to find JSON object in the line
            const jsonStart = trimmedLine.indexOf('{')
            const jsonEnd = trimmedLine.lastIndexOf('}')
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
              try {
                const jsonStr = trimmedLine.substring(jsonStart, jsonEnd + 1)
                const parsed = JSON.parse(jsonStr)
                if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
                  toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
                }
              } catch (e3) {
                // Ignore
              }
            }
          }
        }
      }
    }

    // Method 2: Look for inline JSON objects with "tool" and "arguments" fields
    // Match patterns like: {"tool": "name", "arguments": {...}} or {\n  "tool": "name",\n  ...\n}
    const jsonObjectRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g
    let jsonMatch
    while ((jsonMatch = jsonObjectRegex.exec(text)) !== null) {
      const jsonStr = jsonMatch[0]
      // Skip if this JSON was already found in a code block
      const alreadyFound = toolCalls.some(tc => {
        const tcStr = JSON.stringify(tc)
        return jsonStr.includes(tcStr) || tcStr.includes(jsonStr.substring(0, 50))
      })
      if (alreadyFound) continue

      try {
        const parsed = JSON.parse(jsonStr)
        if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return toolCalls.length > 0 ? toolCalls : null
  }

  // Tool calling loop for automatic code editing
  const processWithTools = async (
    apiMessages: Message[],
    userContent: string,
    workingDir: string,
    providerApiKey: string,
    maxIterations = 10
  ): Promise<string> => {
    let iterations = 0
    let finalContent = ''

    // Add initial assistant message for tool calling progress
    addMessage({ role: 'assistant', content: '🔄 正在分析请求并准备工具调用...' })

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    while (iterations < maxIterations) {
      iterations++

      // Check if aborted
      if (abortControllerRef.current.signal.aborted) {
        throw new Error('Generation stopped by user')
      }

      // Call LLM without tools (we'll parse tool calls from text)
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: providerApiKey,
          model,
          messages: apiMessages,
          stream: false
        }),
        signal: abortControllerRef.current.signal
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`)
      }

      const data = await res.json()
      const responseText = data.content?.[0]?.text || data.content || ''
      const textContent = typeof responseText === 'string' ? responseText : JSON.stringify(responseText)

      // Debug: log the response
      console.log('AI Response:', textContent.substring(0, 500))
      console.log('AI Response data:', data)

      let toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []

      // Check if the API returned structured tool_calls
      if (data.tool_calls && Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
        // Convert OpenAI/Anthropic tool_calls format to our internal format
        toolCalls = data.tool_calls.map((tc: { function?: { name: string; arguments: string }; name?: string; arguments?: Record<string, unknown> }) => {
          if (tc.function) {
            // OpenAI format: tool_calls[].function.name and tool_calls[].function.arguments (JSON string)
            return {
              tool: tc.function.name,
              arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
            }
          } else if (tc.name) {
            // Alternative format: tool_calls[].name and tool_calls[].arguments
            return {
              tool: tc.name,
              arguments: tc.arguments || {}
            }
          }
          return null
        }).filter(Boolean) as Array<{ tool: string; arguments: Record<string, unknown> }>
        console.log('Using structured tool_calls from API:', toolCalls)
      } else {
        // Parse tool calls from the response text
        const parsedToolCalls = parseToolCalls(textContent)
        toolCalls = parsedToolCalls || []
        console.log('Parsed tool calls from text:', toolCalls)
      }

      if (toolCalls.length === 0) {
        // No tool calls, return the text content
        finalContent = textContent
        // Update the message with final content
        updateLastMessage(textContent)
        break
      }

      // Show what tools are being executed
      const toolNames = toolCalls.map(t => t.tool).join(', ')
      const debugInfo = `\n\n**[调试] 发现 ${toolCalls.length} 个工具调用:** ${toolNames}\n\n**工作目录:** ${workingDir}\n\n**工具详情:**\n${toolCalls.map(t => `- ${t.tool}: ${JSON.stringify(t.arguments)}`).join('\n')}`
      console.log('Updating message with debug info:', debugInfo)
      updateLastMessage(textContent + debugInfo)

      // Execute tool calls
      const results: Array<{ tool: string; result: { success: boolean; output: string; error?: string } }> = []

      for (const toolCall of toolCalls) {
        console.log(`Executing tool: ${toolCall.tool}`, toolCall.arguments, 'in cwd:', workingDir)
        try {
          const execRes = await fetch(`${API_BASE}/tools/execute-direct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: toolCall.tool,
              arguments: toolCall.arguments,
              cwd: workingDir
            })
          })

          if (execRes.ok) {
            const execData = await execRes.json()
            console.log(`Tool ${toolCall.tool} result:`, execData.result)
            results.push({ tool: toolCall.tool, result: execData.result })

            // Auto-open file in viewer if write_file or edit_file was successful
            if ((toolCall.tool === 'write_file' || toolCall.tool === 'edit_file') && execData.result.success) {
              const filePath = (toolCall.arguments as { path?: string }).path
              if (filePath && typeof filePath === 'string') {
                try {
                  const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(filePath)}`)
                  if (readRes.ok) {
                    const fileData = await readRes.json() as { content?: string }
                    setSelectedFilePath(filePath)
                    setSelectedFileContent(fileData.content || '')
                    console.log(`Auto-opened file: ${filePath}`)
                  }
                } catch (readError) {
                  console.error('Failed to auto-open file:', readError)
                }
              }
            }
          } else {
            const errorText = await execRes.text()
            console.error(`Tool ${toolCall.tool} failed:`, errorText)
            results.push({ tool: toolCall.tool, result: { success: false, output: '', error: `HTTP ${execRes.status}: ${errorText}` } })
          }
        } catch (error) {
          console.error(`Tool ${toolCall.tool} error:`, error)
          results.push({ tool: toolCall.tool, result: { success: false, output: '', error: `Exception: ${String(error)}` } })
        }
      }

      // Add assistant message to conversation
      apiMessages.push({
        role: 'assistant',
        content: textContent
      })

      // Add tool results to conversation as a system message
      const resultsText = results.map(r =>
        `Tool: ${r.tool}\nSuccess: ${r.result.success}\nOutput: ${r.result.output}${r.result.error ? '\nError: ' + r.result.error : ''}`
      ).join('\n\n')

      apiMessages.push({
        role: 'user',
        content: `Tool execution results:\n\n${resultsText}\n\nContinue with the task based on these results.`
      })

      // Update UI with progress and results
      const resultsSummary = results.map(r => {
        const status = r.result.success ? '✅' : '❌'
        const output = r.result.output ? `\n\`\`\`\n${r.result.output.substring(0, 500)}${r.result.output.length > 500 ? '...' : ''}\n\`\`\`` : ''
        const error = r.result.error ? `\n⚠️ 错误: ${r.result.error.substring(0, 200)}` : ''
        return `${status} **${r.tool}**${output}${error}`
      }).join('\n\n')

      updateLastMessage(`${textContent}\n\n---\n\n**[调试] 工具执行结果:**\n\n${resultsSummary}\n\n**继续下一步...**`)
    }

    return finalContent
  }

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return

    // Get API key from enabled provider
    const enabledProvider = providers.find(p => p.enabled)
    const providerApiKey = enabledProvider?.apiKey || apiKey
    
    if (!providerApiKey) {
      addMessage({ role: 'assistant', content: '请先在设置中配置 API 密钥' })
      return
    }

    // Check if this is a command invocation (starts with /)
    let commandResult: { success: boolean; output: string; error?: string; cwd: string } | null = null
    if (content.startsWith('/')) {
      const commandName = content.slice(1).split(' ')[0]
      const command = commands.find(cmd => cmd.name.toLowerCase() === commandName.toLowerCase())
      if (command) {
        try {
          // Call command execution API to execute the command
          const execRes = await fetch(`${API_BASE}/commands/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: command.name, prompt: content })
          })
          if (execRes.ok) {
            const execData = await execRes.json()
            commandResult = execData.result
          }
        } catch (error) {
          console.error('Failed to execute command:', error)
        }
      }
    }

    // Add user message
    addMessage({ role: 'user', content })
    setIsLoading(true)

    // If command executed successfully, show result immediately
    if (commandResult && commandResult.success) {
      const outputMsg = `**命令执行成功**\\n\\n\`\`\`\\n${commandResult.output}\\n\`\`\`\\n\\n*当前目录: ${commandResult.cwd}*`
      addMessage({ role: 'assistant', content: outputMsg })
      setIsLoading(false)
      return
    }

    // If command failed, show error
    if (commandResult && !commandResult.success) {
      const errorMsg = `**命令执行失败**\\n\\n错误: ${commandResult.error || '未知错误'}\\n\\n*当前目录: ${commandResult.cwd}*`
      addMessage({ role: 'assistant', content: errorMsg })
      setIsLoading(false)
      return
    }

    // Check if message requests code changes, project creation, or running commands (heuristic)
    // Default to true to always use tool calling mode
    const isCodeRequest = true

    // For code requests, processWithTools will add the assistant message
    // For regular chat, add empty assistant message for streaming
    if (!isCodeRequest) {
      addMessage({ role: 'assistant', content: '' })
    }

    try {
      // Get current working directory for system prompt
      let currentCwd = '/'
      try {
        const cwdRes = await fetch(`${API_BASE}/cwd`)
        if (cwdRes.ok) {
          const cwdData = await cwdRes.json()
          currentCwd = cwdData.cwd || '/'
        }
      } catch (e) {
        console.error('Failed to get cwd:', e)
      }

      // Build system prompt with available commands and tools
      const systemPrompt = buildSystemPrompt(commands, tools, currentCwd)

      // Prepare messages for API
      const apiMessages: Message[] = []

      // Add system prompt as first message
      if (systemPrompt) {
        apiMessages.push({ role: 'user', content: systemPrompt })
        apiMessages.push({ role: 'assistant', content: ' understood. I will use the available commands and tools when needed.' })
      }

      // Add existing messages
      messages.forEach(m => {
        apiMessages.push({ role: m.role, content: m.content })
      })

      // Add the user message
      apiMessages.push({ role: 'user', content: content })

      if (isCodeRequest) {
        // Use tool calling for code requests
        const finalContent = await processWithTools(apiMessages, content, currentCwd, providerApiKey)
        // processWithTools already updates the message, no need to update again
        
        // Update tokens (estimate)
        updateTokens(content.length / 4, finalContent.length / 4)
        
        // Save messages to session
        if (currentSession) {
          try {
            await fetch(`${API_BASE}/sessions/${currentSession}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'user', content })
            })
            await fetch(`${API_BASE}/sessions/${currentSession}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'assistant', content: finalContent })
            })
          } catch (error) {
            console.error('Failed to save messages to session:', error)
          }
        }
      } else {
        // Use streaming for regular chat
        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: providerApiKey,
            model,
            messages: apiMessages,
            stream: true
          })
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || `HTTP error! status: ${res.status}`)
        }

        const reader = res.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  fullContent += parsed.delta.text
                  // Update the last assistant message
                  updateLastMessage(fullContent)
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }

        // Update tokens (estimate if not provided)
        updateTokens(content.length / 4, fullContent.length / 4)

        // Save messages to session if we have a current session
        if (currentSession) {
          try {
            // Save user message
            await fetch(`${API_BASE}/sessions/${currentSession}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'user', content })
            })
            // Save assistant message
            await fetch(`${API_BASE}/sessions/${currentSession}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'assistant', content: fullContent })
            })
          } catch (error) {
            console.error('Failed to save messages to session:', error)
          }
        }
      }

    } catch (error) {
      updateLastMessage(`Error: ${String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  // Helper function to update the last assistant message
  const updateLastMessage = (content: string) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    // Find the last assistant message
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content }
        // Use setState to properly update the store
        useStore.setState({ messages: msgs })
        console.log('Updated last assistant message:', content.substring(0, 100))
        break
      }
    }
  }

  // Track last saved config to avoid redundant saves
  const lastSavedConfigRef = useRef<{
    apiKey: string
    model: string
    defaultModel: string
    permissionMode: string
    providers: string
  }>({ apiKey: '', model: '', defaultModel: '', permissionMode: '', providers: '[]' })
  
  // Save config before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Force save current state
      window.api?.saveAllConfig?.({
        apiKey,
        model,
        defaultModel,
        permissionMode,
        providers
      })
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [apiKey, model, defaultModel, permissionMode, providers])

  const handleSettingsSave = async (
    newApiKey: string,
    newModel: string,
    newDefaultModel: string,
    newPermissionMode: string,
    newProviders: ProviderConfig[]
  ) => {
    // Create deep copy to ensure data integrity
    const providersCopy = JSON.parse(JSON.stringify(newProviders))
    
    // Check if anything changed to avoid redundant saves
    const providersJson = JSON.stringify(providersCopy)
    if (
      lastSavedConfigRef.current.apiKey === newApiKey &&
      lastSavedConfigRef.current.model === newModel &&
      lastSavedConfigRef.current.defaultModel === newDefaultModel &&
      lastSavedConfigRef.current.permissionMode === newPermissionMode &&
      lastSavedConfigRef.current.providers === providersJson
    ) {
      return // Nothing changed, skip save
    }

    // Update local state first
    setApiKey(newApiKey)
    setModel(newModel)
    setDefaultModel(newDefaultModel)
    setPermissionMode(newPermissionMode)
    setProviders(providersCopy)

    // Update ref before save
    lastSavedConfigRef.current = {
      apiKey: newApiKey,
      model: newModel,
      defaultModel: newDefaultModel,
      permissionMode: newPermissionMode,
      providers: providersJson
    }

    // Save all config at once
    console.log('Saving config with providers:', providersCopy.length)
    const success = await window.api?.saveAllConfig?.({
      apiKey: newApiKey,
      model: newModel,
      defaultModel: newDefaultModel,
      permissionMode: newPermissionMode,
      providers: providersCopy
    })
    console.log('Config save result:', success)
  }
  
  const handleSettingsClose = () => {
    setShowSettings(false)
  }

  // Handle file selection from FileExplorer
  const handleFileSelect = useCallback((path: string, content: string) => {
    setSelectedFilePath(path)
    setSelectedFileContent(content)
  }, [])

  // Handle file content change from FileViewer
  const handleFileContentChange = useCallback((content: string) => {
    setSelectedFileContent(content)
  }, [])

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="header-title">{t('appName')}</h1>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>
            {t('settings')}
          </button>
        </div>
      </header>

      <main className="main-content three-column-layout">
        {/* Left: File Explorer */}
        <FileExplorer
          onFileSelect={handleFileSelect}
          selectedPath={selectedFilePath}
          onRootPathChange={setProjectPath}
        />

        {/* Center: File Viewer + Terminal */}
        <div className="center-column">
          <div className="file-viewer-container">
            <FileViewer
              filePath={selectedFilePath}
              content={selectedFileContent}
              onContentChange={handleFileContentChange}
              isEditable={true}
            />
          </div>
          <Terminal ref={terminalRef} isVisible={showTerminal} projectPath={projectPath} />
        </div>

        {/* Right: Chat Area */}
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          onSendMessage={handleSendMessage}
          onStopGeneration={handleStopGeneration}
          messagesEndRef={messagesEndRef}
          commands={commands}
          permissionMode={permissionMode}
          inputTokens={inputTokens}
          outputTokens={outputTokens}
          providers={providers}
          model={model}
          onModelChange={setModel}
        />


      </main>

      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          model={model}
          defaultModel={defaultModel}
          permissionMode={permissionMode}
          providers={providers}
          onSave={handleSettingsSave}
          onClose={handleSettingsClose}
        />
      )}
    </div>
  )
}

export default App