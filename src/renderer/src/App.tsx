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

// Project context cache
let cachedProjectContext: string = ''
let cachedProjectPath: string = ''

// Build system prompt with available commands, tools, and project context
function buildSystemPrompt(
  commands: { name: string; responsibility: string }[],
  tools: { name: string; responsibility: string }[],
  cwd: string,
  projectContext: string = ''
): string {
  const platform = navigator.platform.toLowerCase().includes('win') ? 'Windows' :
                   navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Linux'

  let prompt = `You are Claude Code, an AI coding assistant with direct access to the user's file system and command line.\n\n`

  prompt += `=== SYSTEM INFORMATION ===\n`
  prompt += `Platform: ${platform}\n`
  prompt += `Working Directory: ${cwd}\n`

  // Add project context if available
  if (projectContext) {
    prompt += `\n${projectContext}\n`
  }

  prompt += `\n`

  prompt += `=== CORE PRINCIPLES ===\n`
  prompt += `1. ALWAYS USE TOOLS: When the user asks you to create, edit, or modify files, you MUST use the available tools.\n`
  prompt += `2. BE PROACTIVE: Take initiative to complete tasks.\n`
  prompt += `3. EXPLAIN YOUR ACTIONS: After using tools, briefly summarize what you did.\n\n`

  prompt += `=== AVAILABLE TOOLS ===\n`
  prompt += `You have access to the following tools. Use them by outputting JSON code blocks:\n\n`
  prompt += `read_file: Read file contents\n`
  prompt += `write_file: Create or overwrite files\n`
  prompt += `edit_file: Replace specific text in a file\n`
  prompt += `append_file: Append content to existing file\n`
  prompt += `delete_file: Delete a file or directory\n`
  prompt += `list_directory: List directory contents\n`
  prompt += `execute_bash: Execute shell commands\n`
  prompt += `search_code: Search for code patterns\n`
  prompt += `get_running_processes: Get list of running processes\n`
  prompt += `stop_process: Stop a running process by its ID\n`
  prompt += `restart_process: Restart a running process by its ID\n\n`

  prompt += `=== TOOL INVOCATION FORMAT ===\n`
  prompt += `When you need to use a tool, output ONLY the JSON code block:\n\n`
  prompt += `\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

`
  prompt += `CRITICAL RULES:\n`
  prompt += `1. ONLY output the JSON code block, no explanatory text before or between tool calls\n`
  prompt += `2. You can output multiple tool calls in sequence\n`
  prompt += `3. After seeing tool results, continue with next steps if needed\n`
  prompt += `4. When task is complete, summarize what was done\n\n`

  prompt += `=== WORKFLOW ===\n`
  prompt += `1. Analyze the user's request\n`
  prompt += `2. Use the provided PROJECT STRUCTURE to understand the codebase\n`
  prompt += `3. If tools are needed, output the tool call(s)\n`
  prompt += `4. Wait for tool results (you will see them in the next message)\n`
  prompt += `5. Based on results, either:\n`
  prompt += `   - Output more tool calls if more work is needed\n`
  prompt += `   - Provide a summary if the task is complete\n\n`
  prompt += `NOTE: The PROJECT STRUCTURE above shows the current project layout. Use this information to:\n`
  prompt += `- Understand project organization without needing to list directories\n`
  prompt += `- Find relevant files quickly\n`
  prompt += `- Know which files exist before trying to read them\n\n`

  prompt += `=== LARGE FILE HANDLING ===\n`
  prompt += `For files > 8KB, use write_file to create initial file, then append_file to add content.\n\n`

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
  needsAction?: 'continue' // 标记消息需要用户操作（如继续执行）
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
          // Try new Port Architecture API first
          try {
            const portCommandsRes = await fetch(`${API_BASE}/port/commands`)
            if (portCommandsRes.ok) {
              const commandsData = await portCommandsRes.json()
              commands = commandsData.commands || []
              console.log('Loaded commands via Port API:', commands.length)
            }
          } catch (portError) {
            console.log('Port API not available, falling back to legacy API')
            const commandsRes = await fetch(`${API_BASE}/commands`)
            if (commandsRes.ok) {
              const commandsData = await commandsRes.json()
              commands = commandsData.commands || []
              console.log('Loaded commands via HTTP:', commands.length)
            }
          }
        }
        
        if (tools.length === 0) {
          console.log('Loading tools via HTTP API...')
          // Try new Port Architecture API first
          try {
            const portToolsRes = await fetch(`${API_BASE}/port/tools`)
            if (portToolsRes.ok) {
              const toolsData = await portToolsRes.json()
              tools = toolsData.tools || []
              console.log('Loaded tools via Port API:', tools.length)
            }
          } catch (portError) {
            console.log('Port API not available, falling back to legacy API')
            const toolsRes = await fetch(`${API_BASE}/tools`)
            if (toolsRes.ok) {
              const toolsData = await toolsRes.json()
              tools = toolsData.tools || []
              console.log('Loaded tools via HTTP:', tools.length)
            }
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

  // Continue execution handler
  const handleContinueExecution = async () => {
    if (!pendingContinuation) {
      console.error('[handleContinueExecution] No pending continuation')
      return
    }

    console.log('[handleContinueExecution] Continuing execution...')
    setIsLoading(true)

    try {
      // Get API key from enabled provider
      const enabledProvider = providers.find(p => p.enabled)
      const providerApiKey = enabledProvider?.apiKey || apiKey

      if (!providerApiKey) {
        addMessage({ role: 'assistant', content: '请先在设置中配置 API 密钥' })
        setIsLoading(false)
        return
      }

      // Get current working directory
      let currentCwd = projectPath || '/'
      if (!currentCwd || currentCwd === '/') {
        try {
          const cwdRes = await fetch(`${API_BASE}/cwd`)
          if (cwdRes.ok) {
            const cwdData = await cwdRes.json()
            currentCwd = cwdData.cwd || '/'
          }
        } catch (e) {
          console.error('Failed to get cwd:', e)
        }
      }

      // Save pending continuation data first
      const userOriginalRequest = pendingContinuation.userOriginalRequest
      const currentIterations = pendingContinuation.iterations
      const currentWrittenFiles = pendingContinuation.writtenFiles
      const currentConversationHistory = pendingContinuation.conversationHistory

      // Build system prompt
      let projectContextStr = ''
      if (projectPath) {
        projectContextStr = await fetchProjectContext(projectPath)
      }
      const systemPrompt = buildSystemPrompt(commands, tools, currentCwd, projectContextStr)

      // Prepare messages - use conversationHistory from pendingContinuation if available
      let apiMessages: Message[] = []
      
      if (currentConversationHistory && currentConversationHistory.length > 0) {
        // Use saved conversation history
        apiMessages = [...currentConversationHistory]
        console.log('[handleContinueExecution] Using saved conversation history, length:', apiMessages.length)
      } else {
        // Build from scratch
        if (systemPrompt) {
          apiMessages.push({ role: 'user', content: systemPrompt })
          apiMessages.push({ role: 'assistant', content: ' understood. I will use the available commands and tools when needed.' })
        }

        // Add existing messages
        messages.forEach(m => {
          apiMessages.push({ role: m.role, content: m.content })
        })
      }

      // Add continuation instruction
      apiMessages.push({
        role: 'user',
        content: '请继续完成之前的任务。如果需要，可以使用工具继续处理。'
      })

      console.log('[handleContinueExecution] Continuing with iterations:', currentIterations, 'writtenFiles:', currentWrittenFiles.length)

      // Continue execution - reset iterations to 0 for new batch, but keep conversation history
      const result = await processWithTools(
        apiMessages,
        userOriginalRequest,
        currentCwd,
        providerApiKey,
        100, // maxIterations - this is the max for this batch
        true, // isContinuation
        {
          conversationHistory: currentConversationHistory,
          iterations: 0, // Reset iterations for new batch
          writtenFiles: currentWrittenFiles
        }
      )

      // Clear pending continuation
      setPendingContinuation(null)

      // Handle result
      await handleProcessResult(result, userOriginalRequest, currentSession)

      // Check if still needs continuation
      if (result.needsContinuation || result.error) {
        setPendingContinuation({
          conversationHistory: result.conversationHistory || [],
          userOriginalRequest: userOriginalRequest,
          iterations: 100,
          writtenFiles: result.writtenFiles,
          lastContent: result.content
        })
        addMessage({
          role: 'assistant',
          content: `${result.content}\n\n---\n\n⚠️ **${result.error ? '执行过程中发生异常' : '已达到最大迭代次数（100次）'}**\n\n任务可能尚未完成。请选择：\n- 点击 **"继续执行"** 按钮继续处理\n- 或直接发送新消息以其他方式继续`,
          needsAction: 'continue'
        })
      } else {
        // Task completed successfully - add a new clean message without the continue button
        console.log('[handleContinueExecution] Task completed successfully')
        // Add a clear completion message
        addMessage({
          role: 'assistant',
          content: `## ✅ 任务完成\n\n${result.content}`
        })
      }
    } catch (error) {
      console.error('[handleContinueExecution] Error:', error)
      updateLastMessage(`继续执行出错: ${String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-create session on mount if no current session
  useEffect(() => {
    const initSession = async () => {
      // 如果没有当前会话，自动创建一个新会话
      if (!currentSession) {
        try {
          // 使用旧的 API 创建会话（与消息保存 API 兼容）
          const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' })
          const session = await res.json()
          
          const sessionId = session.id
          if (sessionId) {
            addSession({ id: sessionId, createdAt: new Date().toISOString(), messageCount: 0 })
            selectSession(sessionId)
            clearMessages()
            console.log('Created session via legacy API:', sessionId)
          }
        } catch (error) {
          console.error('Failed to create initial session:', error)
        }
      }
    }
    initSession()
  }, [currentSession, addSession, selectSession, clearMessages])

  // Handle process result (extracted to avoid duplication)
  const handleProcessResult = async (
    result: { content: string; writtenFiles: string[]; needsContinuation?: boolean; error?: string | null; conversationHistory?: Message[] },
    userContent: string,
    sessionId: string | null
  ) => {
    console.log('[handleSendMessage] processWithTools returned:', result.content?.substring(0, 100))
    console.log('[handleSendMessage] writtenFiles:', result.writtenFiles)
    // processWithTools already updates the message, no need to update again

    // Update tokens (estimate)
    updateTokens(userContent.length / 4, result.content.length / 4)

    // Auto-open written files
    if (result.writtenFiles.length > 0) {
      const lastFile = result.writtenFiles[result.writtenFiles.length - 1]
      try {
        const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(lastFile)}`)
        if (readRes.ok) {
          const fileData = await readRes.json() as { content?: string }
          setSelectedFilePath(lastFile)
          setSelectedFileContent(fileData.content || '')
        }
      } catch (readError) {
        console.error('Failed to auto-open file:', readError)
      }
    }

    // Save messages to session
    if (sessionId) {
      try {
        await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: userContent })
        })
        await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: result.content })
        })
      } catch (error) {
        console.error('Failed to save messages to session:', error)
      }
    }
  }

  // Fetch project context from main process
  const fetchProjectContext = useCallback(async (projectPath: string): Promise<string> => {
    // Return cached context if path hasn't changed
    if (cachedProjectContext && cachedProjectPath === projectPath) {
      console.log('[ProjectContext] Using cached context for:', projectPath)
      return cachedProjectContext
    }

    try {
      console.log('[ProjectContext] Fetching context for:', projectPath)
      const res = await fetch(`${API_BASE}/project-context?path=${encodeURIComponent(projectPath)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.context) {
          cachedProjectContext = data.context
          cachedProjectPath = projectPath
          console.log('[ProjectContext] Context fetched successfully, length:', data.context.length)
          return data.context
        }
      }
    } catch (error) {
      console.error('[ProjectContext] Failed to fetch context:', error)
    }
    return ''
  }, [])

  // Refresh project context when project path changes
  useEffect(() => {
    if (projectPath) {
      fetchProjectContext(projectPath)
    }
  }, [projectPath, fetchProjectContext])

  const handleNewSession = useCallback(async () => {
    // Always create a new session using legacy API (compatible with messages API)
    try {
      const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' })
      const session = await res.json()
      
      const sessionId = session.id
      if (sessionId) {
        addSession({ id: sessionId, createdAt: new Date().toISOString(), messageCount: 0 })
        selectSession(sessionId)
        clearMessages()
        console.log('Created new session:', sessionId)
      }
    } catch (error) {
      console.error('Failed to create new session:', error)
    }
  }, [addSession, selectSession, clearMessages])

  // Parse tool calls from AI response text
  const parseToolCalls = (text: string): Array<{ tool: string; arguments: Record<string, unknown> }> | null => {
    const toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []
    
    console.log('[parseToolCalls] Input text length:', text.length)
    console.log('[parseToolCalls] Input text preview:', text.substring(0, 300))

    // Method 0: Parse special tool call format <|tool_calls_section_begin|>...</think>
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
    // 使用字符串分割方法，更可靠
    const codeBlockMarker = '```'
    let searchIndex = 0
    let matchCount = 0
    
    console.log('[parseToolCalls] Searching for code blocks, text length:', text.length)
    console.log('[parseToolCalls] First 500 chars:', text.substring(0, 500))
    
    // 检查文本中是否包含 ```
    const firstBacktick = text.indexOf('`')
    console.log('[parseToolCalls] First backtick position:', firstBacktick)
    if (firstBacktick !== -1) {
      console.log('[parseToolCalls] Text around first backtick:', text.substring(firstBacktick, firstBacktick + 20))
    }
    
    while (true) {
      // 找到代码块开始标记
      const blockStart = text.indexOf(codeBlockMarker, searchIndex)
      if (blockStart === -1) {
        console.log('[parseToolCalls] No more code block markers found after position', searchIndex)
        break
      }
      
      console.log('[parseToolCalls] Found code block marker at position:', blockStart)
      console.log('[parseToolCalls] Text at marker:', text.substring(blockStart, blockStart + 20))
      
      // 找到代码块结束标记
      const blockEnd = text.indexOf(codeBlockMarker, blockStart + codeBlockMarker.length)
      if (blockEnd === -1) {
        console.log('[parseToolCalls] No closing marker found')
        break
      }
      
      matchCount++
      
      // 提取代码块内容（包括 ```json 或 ``` 标记）
      const blockWithMarker = text.substring(blockStart, blockEnd + codeBlockMarker.length)
      
      // 检查是否包含 json 标记
      const hasJsonMarker = text.substring(blockStart, blockStart + 7) === '```json'
      
      // 提取代码块内部内容
      const contentStart = hasJsonMarker ? blockStart + 7 : blockStart + 3
      const blockContent = text.substring(contentStart, blockEnd).trim()
      
      console.log(`[parseToolCalls] Found code block #${matchCount} at ${blockStart}-${blockEnd}, hasJsonMarker: ${hasJsonMarker}`)
      console.log(`[parseToolCalls] Block content preview:`, blockContent.substring(0, 100))
      
      try {
        // Try to parse the entire block as JSON
        const parsed = JSON.parse(blockContent)
        console.log(`[parseToolCalls] Parsed JSON from code block #${matchCount}:`, parsed)
        if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
          console.log(`[parseToolCalls] Added tool call from code block #${matchCount}:`, parsed.tool)
        }
      } catch (e) {
        console.log(`[parseToolCalls] Failed to parse code block #${matchCount} as single JSON, trying line by line`)
        // If the block contains multiple JSON objects (one per line), try each line
        const lines = blockContent.split('\n')
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine.startsWith('//')) continue
          try {
            const parsed = JSON.parse(trimmedLine)
            if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
              toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
              console.log(`[parseToolCalls] Added tool call from line:`, parsed.tool)
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
                  console.log(`[parseToolCalls] Added tool call from JSON in line:`, parsed.tool)
                }
              } catch (e3) {
                // Ignore
              }
            }
          }
        }
      }
      
      // 继续搜索下一个代码块
      searchIndex = blockEnd + codeBlockMarker.length
    }
    
    console.log(`[parseToolCalls] Total code blocks found: ${matchCount}`)

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

  // State for pending continuation
  const [pendingContinuation, setPendingContinuation] = useState<{
    conversationHistory: Message[];
    userOriginalRequest: string;
    iterations: number;
    writtenFiles: string[];
    lastContent: string;
  } | null>(null)

  // Tool calling loop for automatic code editing
  const processWithTools = async (
    apiMessages: Message[],
    userContent: string,
    workingDir: string,
    providerApiKey: string,
    maxIterations = 100,
    isContinuation: boolean = false,
    previousState?: {
      conversationHistory: Message[];
      iterations: number;
      writtenFiles: string[];
    }
  ): Promise<{ content: string; writtenFiles: string[]; needsContinuation?: boolean; error?: string | null; conversationHistory?: Message[] }> => {
    console.log('[processWithTools] Starting execution, isContinuation:', isContinuation)
    // 如果是继续执行，恢复之前的状态
    let iterations = previousState?.iterations || 0
    // Fix: check if conversationHistory has items, not just if it exists (empty array is truthy)
    let conversationHistory = (previousState?.conversationHistory && previousState.conversationHistory.length > 0) 
      ? [...previousState.conversationHistory] 
      : [...apiMessages]
    console.log('[processWithTools] conversationHistory length:', conversationHistory.length, 'from previousState:', previousState?.conversationHistory?.length)
    const writtenFiles: string[] = previousState?.writtenFiles ? [...previousState.writtenFiles] : []
    let finalContent = ''
    // 跟踪连续截断次数
    let consecutiveTruncations = 0
    const MAX_CONSECUTIVE_TRUNCATIONS = 3
    // 保存用户原始请求用于上下文压缩
    const userOriginalRequest = apiMessages[apiMessages.length - 1]?.content || ''
    // 跟踪已读取的文件内容摘要
    const fileReadSummaries: string[] = []

    // Add initial assistant message for tool calling progress - only if not continuation
    if (!isContinuation) {
      addMessage({ role: 'assistant', content: '🔄 正在处理...' })
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    // Wrap entire process in try-catch to ensure we always return a result
    try {
      console.log('[ToolLoop] Starting processWithTools, maxIterations:', maxIterations)
      while (iterations < maxIterations) {
      iterations++
      console.log('[ToolLoop] Iteration', iterations, '/', maxIterations)

      // Check if aborted
      if (abortControllerRef.current.signal.aborted) {
        throw new Error('Generation stopped by user')
      }

      // Call LLM
      console.log('[ToolLoop] Calling LLM with', conversationHistory.length, 'messages')
      
      // 限制对话历史长度，防止超过模型上下文限制
      const MAX_HISTORY_MESSAGES = 20
      if (conversationHistory.length > MAX_HISTORY_MESSAGES) {
        console.log('[ToolLoop] Conversation history too long, compressing...')
        
        // 收集已读取的文件信息
        const readFileResults = conversationHistory
          .filter((m, i) => m.role === 'user' && i > 0)
          .map(m => {
            const match = m.content.match(/工具执行结果.*?read_file.*?```\n([\s\S]*?)```/)
            if (match) {
              const fileMatch = m.content.match(/path[:\s]*([^\s]+)/)
              const path = fileMatch ? fileMatch[1] : 'unknown'
              const preview = match[1].substring(0, 500)
              return { path, preview }
            }
            return null
          })
          .filter(Boolean)
          .slice(-5) // 只保留最近5个文件
        
        // 构建智能上下文摘要
        const contextSummary = readFileResults.length > 0 
          ? readFileResults.map(r => `已读取文件: ${r?.path}\n内容摘要:\n${r?.preview}...`).join('\n\n')
          : '（无文件读取记录）'
        
        // 保留系统提示（前2条）
        const systemMessages = conversationHistory.slice(0, 2)
        
        // 保留最近的消息（工具调用和结果）
        const recentMessages = conversationHistory.slice(-8)
        
        // 构建压缩后的上下文
        const compressedContext = {
          role: 'user' as const,
          content: `[系统提示：对话历史已被智能压缩以节省空间。以下是关键信息摘要：

【用户原始请求】
${userOriginalRequest.substring(0, 500)}${userOriginalRequest.length > 500 ? '...' : ''}

【已读取的文件】
${contextSummary}

【当前任务状态】
- 已迭代次数: ${iterations}
- 已写入文件: ${writtenFiles.length > 0 ? writtenFiles.join(', ') : '无'}
- 任务进行中，请继续完成用户请求

可用工具：
- read_file: 读取文件，支持 offset 和 limit 参数
- write_file: 写入文件  
- edit_file: 编辑文件
- execute_bash: 执行命令

工具调用格式：
\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

请基于以上信息继续完成任务。]`
        }
        
        conversationHistory = [...systemMessages, compressedContext, ...recentMessages]
        console.log('[ToolLoop] Compressed conversation history to', conversationHistory.length, 'messages')
      }
      
      let data
      try {
        // 定义可用的工具
        const availableTools = [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read file contents',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                  offset: { type: 'number', description: 'Start line offset' },
                  limit: { type: 'number', description: 'Number of lines to read' }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Create or overwrite files',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                  content: { type: 'string', description: 'File content' }
                },
                required: ['path', 'content']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'edit_file',
              description: 'Replace specific text in a file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                  old_string: { type: 'string', description: 'Text to replace' },
                  new_string: { type: 'string', description: 'Replacement text' }
                },
                required: ['path', 'old_string', 'new_string']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'append_file',
              description: 'Append content to existing file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                  content: { type: 'string', description: 'Content to append' }
                },
                required: ['path', 'content']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'delete_file',
              description: 'Delete a file or directory',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File or directory path' }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'list_directory',
              description: 'List directory contents',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Directory path' }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'execute_bash',
              description: 'Execute shell commands',
              parameters: {
                type: 'object',
                properties: {
                  command: { type: 'string', description: 'Command to execute' },
                  cwd: { type: 'string', description: 'Working directory' }
                },
                required: ['command']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'search_code',
              description: 'Search for code patterns',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
              }
            }
          }
        ]

        const res = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: providerApiKey,
            model,
            messages: conversationHistory,
            tools: availableTools,
            tool_choice: 'auto',
            stream: false
          }),
          signal: abortControllerRef.current.signal
        })

        if (!res.ok) {
          const errorData = await res.json()
          console.error('[ToolLoop] LLM API error:', res.status, errorData)
          throw new Error(errorData.error || `HTTP error! status: ${res.status}`)
        }

        data = await res.json()
      } catch (llmError) {
        console.error('[ToolLoop] LLM call failed:', llmError)
        throw llmError
      }

      // 处理 content 可能是字符串化的 JSON 数组的情况
      let content = data.content
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content)
          if (Array.isArray(parsed)) {
            content = parsed
          }
        } catch (e) {
          // 不是 JSON 字符串，保持原样
        }
      }
      
      const responseText = Array.isArray(content) ? (content[0]?.text || '') : (content || '')
      const textContent = typeof responseText === 'string' ? responseText : JSON.stringify(responseText)

      console.log('AI Response:', textContent.substring(0, 500))
      console.log('[ToolLoop] data.tool_calls:', data.tool_calls ? JSON.stringify(data.tool_calls).substring(0, 500) : 'undefined')

      let toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []

      // Check if the API returned structured tool_calls
      if (data.tool_calls && Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
        console.log('[ToolLoop] Found structured tool_calls:', data.tool_calls.length)
        toolCalls = data.tool_calls.map((tc: { function?: { name: string; arguments: string }; name?: string; arguments?: Record<string, unknown> }) => {
          if (tc.function) {
            return {
              tool: tc.function.name,
              arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
            }
          } else if (tc.name) {
            return { tool: tc.name, arguments: tc.arguments || {} }
          }
          return null
        }).filter(Boolean) as Array<{ tool: string; arguments: Record<string, unknown> }>
      } else {
        // Parse tool calls from the response text as fallback
        console.log('[ToolLoop] No structured tool_calls, parsing from text...')
        const parsedToolCalls = parseToolCalls(textContent)
        toolCalls = parsedToolCalls || []
      }

      // 将AI响应添加到对话历史
      conversationHistory.push({ role: 'assistant', content: textContent })

      if (toolCalls.length === 0) {
        // 检查AI是否表达了使用工具的意图但没有正确调用
        const toolIntentPatterns = [
          /让.*读取.*文件/i,
          /让.*获取.*文件/i,
          /让我.*读取/i,
          /让我.*获取/i,
          /让我.*查看/i,
          /让我.*检查/i,
          /让我.*列出/i,
          /使用.*read_file/i,
          /使用.*write_file/i,
          /使用.*edit_file/i,
          /使用.*execute_bash/i,
          /使用.*list_directory/i,
          /使用.*search_code/i,
          /继续读取/i,
          /继续获取/i,
          /查看.*目录/i,
          /查看.*文件/i,
          /检查.*目录/i,
          /检查.*文件/i,
          /列出.*目录/i,
          /列出.*文件/i
        ]
        
        const hasToolIntent = toolIntentPatterns.some(pattern => pattern.test(textContent))
        
        // 检测是否有不完整的工具调用（JSON 被截断）
        const jsonBlockStart = textContent.indexOf('```json')
        const hasIncompleteToolCall = jsonBlockStart !== -1 && 
                                      !textContent.includes('```', jsonBlockStart + 7)
        
        if (hasIncompleteToolCall) {
          consecutiveTruncations++
          console.log(`[ToolLoop] Detected incomplete tool call (truncated JSON), count: ${consecutiveTruncations}`)
          
          if (consecutiveTruncations >= MAX_CONSECUTIVE_TRUNCATIONS) {
            console.log('[ToolLoop] Too many consecutive truncations, stopping loop')
            finalContent = textContent + '\n\n⚠️ AI 响应连续多次被截断，请尝试：\n1. 简化您的请求\n2. 使用支持更长上下文的模型\n3. 减少一次请求中需要处理的文件数量'
            updateLastMessage(finalContent)
            break
          }
          
          // 提示 AI 重新调用，但简化提示
          const promptMessage = `请使用简洁的格式调用工具（确保 JSON 完整）：

\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\``
          conversationHistory.push({ role: 'user', content: promptMessage })
          updateLastMessage(`${textContent}\n\n🔄 响应截断，重新尝试 (${consecutiveTruncations}/${MAX_CONSECUTIVE_TRUNCATIONS})...`)
          continue
        }
        
        // 重置截断计数（成功解析到工具调用）
        consecutiveTruncations = 0
        
        if (hasToolIntent && iterations < maxIterations - 1) {
          // AI 想使用工具但没有正确调用，提示它使用正确的格式
          console.log('[ToolLoop] AI expressed tool intent but no tool calls found, prompting for correct format')
          const promptMessage = `请使用以下格式调用工具：

\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

可用工具：
- read_file: 读取文件，参数: path, offset, limit
- write_file: 写入文件，参数: path, content
- edit_file: 编辑文件，参数: path, old_string, new_string
- execute_bash: 执行命令，参数: command

请直接输出工具调用代码块。`
          
          conversationHistory.push({ role: 'user', content: promptMessage })
          updateLastMessage(`${textContent}\n\n🔄 等待工具调用...`)
          continue  // 继续循环，让AI重新响应
        }
        
        // No tool calls, task is complete
        console.log('[ToolLoop] No tool calls found, breaking loop')
        console.log('[ToolLoop] textContent:', textContent.substring(0, 200))
        console.log('[ToolLoop] data:', JSON.stringify(data).substring(0, 200))
        finalContent = textContent
        updateLastMessage(textContent)
        break
      }

      // 显示正在执行的工具 - 简化显示
      const toolNames = toolCalls.map(t => t.tool).join(', ')
      updateLastMessage(`🔄 正在执行: ${toolNames}...`)
      
      // Execute tool calls with retry and error handling
      const results: Array<{ tool: string; result: { success: boolean; output: string; error?: string } }> = []
      
      console.log(`[ToolLoop] Starting execution of ${toolCalls.length} tool calls`)
      
      for (const toolCall of toolCalls) {
        const maxRetries = 3
        const toolTimeout = 60000 // 60秒超时
        let retryCount = 0
        let lastError: string = ''
        let toolResult: { success: boolean; output: string; error?: string } | null = null
        
        // 记录工具开始执行时间
        const toolStartTime = Date.now()
        console.log(`[ToolLoop] Tool ${toolCall.tool} started at`, toolStartTime)
      
        while (retryCount < maxRetries) {
          // 检查是否超时
          const elapsedTime = Date.now() - toolStartTime
          if (elapsedTime > toolTimeout) {
            lastError = `工具执行超时 (${toolTimeout/1000}秒)`
            console.error(`[ToolLoop] Tool ${toolCall.tool} timeout after ${elapsedTime}ms`)
            break
          }
          try {
            console.log(`[ToolLoop] Executing tool: ${toolCall.tool} (attempt ${retryCount + 1}/${maxRetries})`, toolCall.arguments)
            console.log(`[ToolLoop] Sending request to API...`)
      
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
              toolResult = execData.result
      
              // 记录成功写入的文件，用于后续自动打开
              if ((toolCall.tool === 'write_file' || toolCall.tool === 'edit_file') && execData.result.success) {
                const filePath = (toolCall.arguments as { path?: string }).path
                if (filePath && typeof filePath === 'string') {
                  writtenFiles.push(filePath)
                  console.log('[ToolLoop] Recorded written file:', filePath)
                }
              }
            } else {
              const errorText = await execRes.text()
              lastError = `HTTP ${execRes.status}: ${errorText}`
              console.error(`[ToolLoop] Tool ${toolCall.tool} failed:`, lastError)
            }
          } catch (error) {
            lastError = `Exception: ${String(error)}`
            console.error(`[ToolLoop] Tool ${toolCall.tool} exception:`, error)
          }
      
          // Check if the tool executed successfully
          if (toolResult && toolResult.success) {
            console.log(`[ToolLoop] Tool ${toolCall.tool} succeeded`)
            break
          } else {
            retryCount++
            if (retryCount < maxRetries) {
              console.log(`[ToolLoop] Tool ${toolCall.tool} failed, retrying... (${retryCount}/${maxRetries})`)
              // Wait before retrying
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          }
        }
      
        // Add result (either success or final failure)
        if (toolResult) {
          results.push({ tool: toolCall.tool, result: toolResult })
        } else {
          // All retries failed
          results.push({ tool: toolCall.tool, result: { success: false, output: '', error: lastError || 'Unknown error after retries' } })
          console.error(`[ToolLoop] Tool ${toolCall.tool} failed after ${maxRetries} attempts:`, lastError)
        }
      }
      
      console.log(`[ToolLoop] All tool calls completed, results:`, results)
      console.log(`[ToolLoop] Preparing to call LLM again with tool results...`)

      // 验证所有工具都已执行完成（关键监控）
      if (results.length !== toolCalls.length) {
        console.error(`[ToolLoop] WARNING: Expected ${toolCalls.length} results but got ${results.length}`)
        // 补充缺失的结果
        for (let i = results.length; i < toolCalls.length; i++) {
          results.push({ 
            tool: toolCalls[i].tool, 
            result: { success: false, output: '', error: '工具执行结果丢失' } 
          })
        }
      }

      // 构建工具结果消息 - 这是关键修复
      const resultsText = results.map(r => {
        const status = r.result?.success ? '成功' : '失败'
        const output = r.result?.output ? `\n输出: ${r.result.output.substring(0, 1000)}` : ''
        const error = r.result?.error ? `\n错误: ${r.result.error.substring(0, 500)}` : ''
        return `[${r.tool}] ${status}${output}${error}`
      }).join('\n\n')

      const toolResultMessage = `工具执行结果:\n\n${resultsText}`

      // 将工具结果添加到对话历史 - 关键修复：使用 user role 让AI能看到结果
      conversationHistory.push({ role: 'user', content: toolResultMessage })
      console.log('[ToolLoop] Added tool result to conversation history, now', conversationHistory.length, 'messages')

      // 更新UI显示工具执行结果
      const resultsSummary = results.map(r => {
        const status = r.result?.success ? '✅' : '❌'
        const output = r.result?.output ? `\n\`\`\`\n${r.result.output.substring(0, 300)}${r.result.output.length > 300 ? '...' : ''}\n\`\`\`` : ''
        const error = r.result?.error ? `\n⚠️ ${r.result.error.substring(0, 200)}` : ''
        return `${status} **${r.tool}**${output}${error}`
      }).join('\n\n')

      // 简化工具执行结果显示
      const allSuccess = results.every(r => r.result?.success)
      const successCount = results.filter(r => r.result?.success).length
      const statusEmoji = allSuccess ? '✅' : successCount > 0 ? '⚠️' : '❌'
      updateLastMessage(`${statusEmoji} 工具执行完成 (${successCount}/${results.length})`)
      console.log('[ToolLoop] Tool execution cycle completed, continuing to next iteration...')
      console.log('[ToolLoop] Current iteration:', iterations, 'of max', maxIterations)
      }
  
      // 循环结束，检查是否因为达到最大迭代次数
      const reachedMaxIterations = iterations >= maxIterations

      if (!finalContent) {
        // 如果循环因达到最大迭代次数而退出，使用最后一条assistant消息
        const lastAssistantMsg = conversationHistory.slice().reverse().find(m => m.role === 'assistant')
        if (lastAssistantMsg) {
          finalContent = lastAssistantMsg.content
          console.log('[ToolLoop] Using last assistant message as finalContent')
        } else {
          finalContent = '处理完成（无最终响应）'
        }
      }

      // 如果达到最大迭代次数，返回需要继续执行的状态
      if (reachedMaxIterations) {
        console.log('[ToolLoop] Reached max iterations, returning needsContinuation=true')
        return {
          content: finalContent,
          writtenFiles,
          needsContinuation: true
        }
      }

      console.log('[ToolLoop] Exiting while loop, returning finalContent:', finalContent.substring(0, 100))
      return { content: finalContent, writtenFiles, needsContinuation: false, error: null, conversationHistory }
    } catch (error) {
      // 确保任何异常都被捕获并返回错误信息
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ToolLoop] processWithTools error:', errorMessage)
      console.error('[ToolLoop] Stack:', error instanceof Error ? error.stack : 'no stack')
      updateLastMessage(`执行出错: ${errorMessage}`)
      return { content: `执行出错: ${errorMessage}`, writtenFiles, needsContinuation: false, error: errorMessage, conversationHistory: conversationHistory.length > 0 ? conversationHistory : apiMessages }
    }
    // 注意：这里不要在 finally 中设置 setIsLoading(false)，因为 handleSendMessage 会处理
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
          // Try new Port Architecture API first
          let execData
          try {
            const portExecRes = await fetch(`${API_BASE}/port/exec-command`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: command.name, prompt: content })
            })
            if (portExecRes.ok) {
              execData = await portExecRes.json()
              console.log('Executed command via Port API:', command.name)
            }
          } catch (portError) {
            console.log('Port API not available, falling back to legacy API')
          }
          
          // Fallback to legacy API
          if (!execData) {
            const execRes = await fetch(`${API_BASE}/commands/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: command.name, prompt: content })
            })
            if (execRes.ok) {
              execData = await execRes.json()
            }
          }
          
          if (execData?.result) {
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
      // 优先使用 projectPath（文件浏览器中选中的项目路径），如果没有则使用 API 返回的 cwd
      let currentCwd = projectPath || '/'
      if (!currentCwd || currentCwd === '/') {
        try {
          const cwdRes = await fetch(`${API_BASE}/cwd`)
          if (cwdRes.ok) {
            const cwdData = await cwdRes.json()
            currentCwd = cwdData.cwd || '/'
          }
        } catch (e) {
          console.error('Failed to get cwd:', e)
        }
      }

      // Fetch project context if available
      let projectContextStr = ''
      if (projectPath) {
        projectContextStr = await fetchProjectContext(projectPath)
      }

      // Build system prompt with available commands, tools, and project context
      const systemPrompt = buildSystemPrompt(commands, tools, currentCwd, projectContextStr)

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
        // Check if there's a pending continuation
        if (pendingContinuation) {
          // Continue from previous state
          console.log('[handleSendMessage] Continuing from pending state...')
          const result = await processWithTools(
            apiMessages,
            pendingContinuation.userOriginalRequest,
            currentCwd,
            providerApiKey,
            100, // maxIterations
            true, // isContinuation
            {
              conversationHistory: pendingContinuation.conversationHistory,
              iterations: pendingContinuation.iterations,
              writtenFiles: pendingContinuation.writtenFiles
            }
          )
          // Clear pending continuation
          setPendingContinuation(null)
          // Continue with result handling...
          await handleProcessResult(result, content, currentSession)
        } else {
          // Normal execution
          console.log('[handleSendMessage] Calling processWithTools...')
          const result = await processWithTools(apiMessages, content, currentCwd, providerApiKey)
          console.log('[handleSendMessage] processWithTools returned:', result.content?.substring(0, 100))
          console.log('[handleSendMessage] writtenFiles:', result.writtenFiles)

          // Check if needs continuation (max iterations reached)
          if (result.needsContinuation) {
            console.log('[handleSendMessage] Tool execution needs continuation')
            // Store state for potential continuation
            setPendingContinuation({
              conversationHistory: result.conversationHistory || [],
              userOriginalRequest: content,
              iterations: 100,
              writtenFiles: result.writtenFiles,
              lastContent: result.content
            })
            // Add continuation prompt message
            addMessage({
              role: 'assistant',
              content: `${result.content}\n\n---\n\n⚠️ **已达到最大迭代次数（100次）**\n\n任务可能尚未完成。请选择：\n- 点击 **"继续执行"** 按钮继续处理\n- 或直接发送新消息以其他方式继续`,
              needsAction: 'continue'
            })
            // Don't save to session yet, wait for user decision
            setIsLoading(false)
            return
          }

          // Check if there was an error - allow user to continue
          if (result.error) {
            console.log('[handleSendMessage] Tool execution encountered error')
            // Store state for potential continuation
            setPendingContinuation({
              conversationHistory: result.conversationHistory || [],
              userOriginalRequest: content,
              iterations: 100, // Assume max reached or error occurred
              writtenFiles: result.writtenFiles,
              lastContent: result.content
            })
            // Add error message with continue option
            addMessage({
              role: 'assistant',
              content: `${result.content}\n\n---\n\n⚠️ **执行过程中发生异常**\n\n任务可能尚未完成。请选择：\n- 点击 **"继续执行"** 按钮尝试继续处理\n- 或直接发送新消息以其他方式继续`,
              needsAction: 'continue'
            })
            // Don't save to session yet, wait for user decision
            setIsLoading(false)
            return
          }

          await handleProcessResult(result, content, currentSession)
        }
        return
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
      console.error('[handleSendMessage] Error caught:', error)
      updateLastMessage(`Error: ${String(error)}`)
    } finally {
      console.log('[handleSendMessage] Finally block, setting isLoading to false')
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
          onContinueExecution={handleContinueExecution}
          showContinueButton={!!pendingContinuation}
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