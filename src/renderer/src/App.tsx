import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ProviderConfig, type Session, type Step } from './store'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsModal from './components/SettingsModal'
import StatusBar from './components/StatusBar'
import FileExplorer from './components/FileExplorer'
import FileViewer from './components/FileViewer'
import FileTabs, { type Tab } from './components/FileTabs'
import Terminal, { type TerminalRef } from './components/Terminal'
import SessionSidebar from './components/SessionSidebar'
import { t } from './i18n'
import { useChatMode, useAgentMode } from './hooks'

const API_BASE = 'http://localhost:3847/api'

// Project context cache
let cachedProjectContext: string = ''
let cachedProjectPath: string = ''

// Build chat mode system prompt (with tools but only use when needed)
function buildChatSystemPrompt(cwd: string, projectContext: string = ''): string {
  const platform = navigator.platform.toLowerCase().includes('win') ? 'Windows' :
                   navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Linux'

  let prompt = `You are a helpful AI assistant. Answer the user's questions clearly and concisely.

=== SYSTEM INFORMATION ===
Platform: ${platform}
Working Directory: ${cwd}
Current Time: ${new Date().toISOString()}
`

  // Add project context if available
  if (projectContext) {
    prompt += `\n${projectContext}\n`
  }

  prompt += `
=== AVAILABLE TOOLS ===
You have access to the following tools. ONLY use them when the user explicitly asks you to analyze, read, or explore files/projects:

read_file: Read file contents. Use when user asks to analyze or view specific files.
list_directory: List directory contents. Use when user asks to explore project structure.
search_code: Search for code patterns. Use when user asks to find specific code.
execute_bash: Execute shell commands. Use only when user explicitly requests command execution.

=== TOOL INVOCATION FORMAT ===
When you need to use a tool, output ONLY the JSON code block:

\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

=== IMPORTANT RULES ===
1. For general questions and conversations, respond naturally WITHOUT using tools
2. ONLY use tools when the user explicitly asks you to analyze, read, explore, or work with files
3. Examples of when to use tools:
   - "帮我分析下这个项目" → Use list_directory, read_file to explore
   - "查看一下这个文件" → Use read_file
   - "搜索一下这段代码" → Use search_code
4. For greetings, general coding questions, or explanations, do NOT use tools
5. **CRITICAL - READ-ONLY MODE**: You are in CHAT MODE which is READ-ONLY. You CANNOT create, write, edit, append, delete, or modify files in any way. This includes:
   - NO write_file, edit_file, append_file operations
   - NO delete_file or file removal operations
   - NO using execute_bash to write/create/modify/delete files (e.g., NO 'cat >', NO 'echo >', NO 'rm', NO 'mkdir' for creating files)
   - If the user asks you to write, create, edit, or delete files (e.g., "写入文件", "创建文件", "修改文件", "删除文件"), you MUST:
     * Explain that file modification is not supported in chat mode
     * Suggest switching to "智能体模式" (Agent Mode) for file operations
     * Do NOT attempt to use any tool to modify files
6. **execute_bash usage**: ONLY use execute_bash when user explicitly asks to run commands like npm, git, etc. NEVER use it for file operations.

Please provide helpful, accurate, and concise responses to the user's questions.
`

  return prompt
}

// Build system prompt with available commands, tools, and project context
function buildSystemPrompt(
  commands: { name: string; responsibility: string }[],
  tools: { name: string; responsibility: string }[],
  cwd: string,
  projectContext: string = ''
): string {
  const platform = navigator.platform.toLowerCase().includes('win') ? 'Windows' :
                   navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Linux'

  let prompt = `You are Claude Code, an expert AI coding assistant with direct access to the user's file system and command line. Your goal is to help users write, modify, and understand code effectively.\n\n`

  prompt += `=== SYSTEM INFORMATION ===\n`
  prompt += `Platform: ${platform}\n`
  prompt += `Working Directory: ${cwd}\n`
  prompt += `Current Time: ${new Date().toISOString()}\n`

  // Add project context if available
  if (projectContext) {
    prompt += `\n${projectContext}\n`
  }

  prompt += `\n`

  prompt += `=== CORE PRINCIPLES ===\n`
  prompt += `1. ALWAYS USE TOOLS: When the user asks you to create, edit, or modify files, you MUST use the available tools. Never describe what you would do - actually do it.\n`
  prompt += `2. BE PROACTIVE: Take initiative to complete tasks. If you see issues or improvements, suggest and implement them.\n`
  prompt += `3. EXPLAIN YOUR ACTIONS: After using tools, briefly summarize what you did and why.\n`
  prompt += `4. THINK STEP BY STEP: For complex tasks, break them down into steps and execute them sequentially.\n`
  prompt += `5. VERIFY BEFORE PROCEEDING: After making changes, verify they work as expected before declaring completion.\n`
  prompt += `6. IGNORE PREVIOUS MODE LIMITATIONS: You are now in AGENT MODE with FULL tool access. Ignore any previous messages about "cannot delete files" or "not supported in chat mode". You CAN and SHOULD directly execute file operations including delete, write, edit when requested.\n\n`

  prompt += `=== AVAILABLE TOOLS ===\n`
  prompt += `You have access to the following tools. Use them by outputting JSON code blocks:\n\n`
  prompt += `read_file: Read file contents. Use offset/limit for large files. Always read before editing.\n`
  prompt += `write_file: Create or overwrite files. Use for new files or complete rewrites.\n`
  prompt += `edit_file: Replace specific text in a file. old_string must match EXACTLY (including whitespace).\n`
  prompt += `append_file: Append content to existing file. Use for adding to the end of files.\n`
  prompt += `delete_file: Delete a file or directory. Use with caution.\n`
  prompt += `list_directory: List directory contents. Use to explore project structure.\n`
  prompt += `execute_bash: Execute shell commands. Can run npm, git, node, etc. Commands run in integrated terminal.\n`
  prompt += `search_code: Search for code patterns using regex. Use to find references, definitions, etc.\n`
  prompt += `get_running_processes: Get list of running processes. Check before starting duplicate services.\n`
  prompt += `stop_process: Stop a running process by its ID.\n`
  prompt += `restart_process: Restart a running process by its ID.\n\n`

  prompt += `=== TOOL INVOCATION FORMAT ===\n`
  prompt += `When you need to use a tool, output ONLY the JSON code block:\n\n`
  prompt += `\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

`
  prompt += `For multiple tool calls, output them sequentially:\n\n`
  prompt += `\`\`\`json
{"tool": "read_file", "arguments": {"path": "/path/to/file"}}
\`\`\`
\`\`\`json
{"tool": "list_directory", "arguments": {"path": "/path/to/dir"}}
\`\`\`

`
  prompt += `CRITICAL RULES:\n`
  prompt += `1. ONLY output the JSON code block, no explanatory text before or between tool calls\n`
  prompt += `2. Wait for tool results before proceeding to the next step\n`
  prompt += `3. If a tool fails, analyze the error and retry with corrections\n`
  prompt += `4. When task is complete, provide a clear summary of what was accomplished\n\n`

  prompt += `=== BEST PRACTICES ===\n`
  prompt += `FILE OPERATIONS:\n`
  prompt += `- Always read a file before modifying it\n`
  prompt += `- For files > 100 lines, use offset and limit to read specific sections\n`
  prompt += `- When editing, ensure old_string matches EXACTLY (whitespace, indentation, line breaks)\n`
  prompt += `- For multi-file changes, plan the order: read all first, then write/edit\n\n`
  prompt += `CODE ANALYSIS:\n`
  prompt += `- Use search_code to find references, imports, and dependencies\n`
  prompt += `- Use list_directory to understand project structure\n`
  prompt += `- Read configuration files (package.json, tsconfig.json, etc.) to understand tech stack\n\n`
  prompt += `COMMAND EXECUTION:\n`
  prompt += `- npm/node commands run in the integrated terminal and can be monitored\n`
  prompt += `- Use 'npm install' before running projects\n`
  prompt += `- Check if processes are already running before starting new ones\n\n`

  prompt += `=== ERROR HANDLING ===\n`
  prompt += `If a tool execution fails:\n`
  prompt += `1. Read the error message carefully\n`
  prompt += `2. Check if the file/path exists\n`
  prompt += `3. Verify you have the correct parameters\n`
  prompt += `4. Retry with corrections\n`
  prompt += `5. If still failing, explain the issue to the user and ask for guidance\n\n`

  prompt += `=== WORKFLOW ===\n`
  prompt += `For each user request:\n`
  prompt += `1. ANALYZE: Understand what the user wants\n`
  prompt += `2. EXPLORE: Use list_directory, search_code, read_file to gather context\n`
  prompt += `3. PLAN: Determine the steps needed to complete the task\n`
  prompt += `4. EXECUTE: Use tools to make changes\n`
  prompt += `5. VERIFY: Check that changes work correctly\n`
  prompt += `6. SUMMARIZE: Explain what was done\n\n`

  prompt += `=== TASK PLANNING PROTOCOL ===\n`
  prompt += `CRITICAL: Before executing any tools, you MUST create a clear task plan:\n\n`
  prompt += `Step 1 - ANALYZE THE REQUEST:\n`
  prompt += `- What is the user asking for?\n`
  prompt += `- What files/components are likely involved?\n`
  prompt += `- What is the scope of changes needed?\n\n`
  prompt += `Step 2 - CREATE EXECUTION PLAN:\n`
  prompt += `- List ALL files you need to read\n`
  prompt += `- Identify dependencies between files\n`
  prompt += `- Plan the order of modifications\n`
  prompt += `- Estimate number of steps needed\n\n`
  prompt += `Step 3 - EXECUTE WITH TRACKING:\n`
  prompt += `- Read all necessary files FIRST before making changes\n`
  prompt += `- After reading, analyze what you learned\n`
  prompt += `- Make changes based on your analysis\n`
  prompt += `- DO NOT read the same file twice unless necessary\n\n`
  prompt += `Step 4 - AVOID INFINITE LOOPS:\n`
  prompt += `- If you find yourself reading files repeatedly, STOP and reassess\n`
  prompt += `- Ask yourself: "What am I trying to find?"\n`
  prompt += `- If stuck, summarize findings and ask user for clarification\n\n`
  prompt += `Step 5 - MEMORY MANAGEMENT:\n`
  prompt += `When context is compressed, maintain task memory by explicitly stating:\n`
  prompt += `- 【问题分析】: What is the problem you're solving\n`
  prompt += `- 【根本原因】: Root cause of the issue\n`
  prompt += `- 【修复策略】: Your plan to fix it\n`
  prompt += `- 【待修复文件】: List of files that need modification\n`
  prompt += `- 【已完成】: Files already fixed\n`
  prompt += `Example: "【问题分析】API接口404错误 【根本原因】路由配置错误 【修复策略】修改server.js中的路由 【待修复文件】server.js, api.js 【已完成】无"\n\n`
  prompt += `=== CONTEXT RETENTION ===\n`
  prompt += `The conversation history includes:\n`
  prompt += `- Previous tool calls and their results\n`
  prompt += `- Files you've read and their contents\n`
  prompt += `- Commands you've executed and their output\n`
  prompt += `Use this information to maintain context across the conversation.\n\n`

  if (projectContext) {
    prompt += `=== PROJECT STRUCTURE USAGE ===\n`
    prompt += `The PROJECT STRUCTURE above shows the current project layout. Use this to:\n`
    prompt += `- Understand project organization without listing directories\n`
    prompt += `- Find relevant files quickly\n`
    prompt += `- Know which files exist before trying to read them\n`
    prompt += `- Identify the tech stack and framework being used\n\n`
  }

  prompt += `=== RESPONSE FORMAT ===\n`
  prompt += `ALWAYS structure your response in the following format:\n\n`
  prompt += `## 🤔 思考过程\n`
  prompt += `Explain your analysis and reasoning. What did you find? What are you planning to do?\n\n`
  prompt += `## 📋 执行任务\n`
  prompt += `List the specific tasks you're performing:\n`
  prompt += `- ✅ 已完成: [task description]\n`
  prompt += `- ⏳ 进行中: [task description]\n`
  prompt += `- 📌 待处理: [task description]\n\n`
  prompt += `## 📁 文件操作\n`
  prompt += `Document all file operations:\n`
  prompt += `- 📖 已读取: file1.js, file2.js\n`
  prompt += `- ✏️ 已修改: file3.js (what changed)\n`
  prompt += `- 📝 已创建: file4.js\n\n`
  prompt += `## 💡 总结\n`
  prompt += `Provide a clear summary of what was accomplished and any next steps.\n\n`
  prompt += `IMPORTANT: Use this format consistently so the user can track your progress.\n\n`

  prompt += `=== RESPONSE LANGUAGE ===\n`
  prompt += `Respond in the same language as the user's query. Be concise but thorough.\n`

  return prompt
}

// Extended Message interface for API calls (includes 'tool' role)
interface ApiMessage {
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
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const terminalRef = useRef<TerminalRef>(null)

  // File tabs state
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  
  // Session sidebar state - 默认关闭，显示文件浏览器
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(false)
  const [localSessions, setLocalSessions] = useState<Session[]>([])

  // Initialize mode-specific hooks
  const { processChatMessage, stopGeneration: stopChatGeneration } = useChatMode()
  const { processAgentMessage, stopGeneration: stopAgentGeneration, buildSystemPrompt: buildAgentSystemPrompt } = useAgentMode()

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
    chatMode,
    setApiKey,
    setModel,
    setDefaultModel,
    setPermissionMode,
    setProviders,
    setCommands,
    setTools,
    setChatMode,
    addSession,
    selectSession,
    updateSessionTitle,
    deleteSession,
    addMessage,
    clearMessages,
    setMessages,
    updateTokens,
    setSessions,
    setCurrentProjectPath,
    addStepToMessage,
    updateStepStatus
  } = useStore()

  // Load commands and tools on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Try IPC first, fallback to HTTP API
        let commands = []
        let tools = []
        
        // Try IPC
        const api = window.api as unknown as { getCommands?: () => Promise<Array<{ name: string; responsibility: string }>>; getTools?: () => Promise<Array<{ name: string; responsibility: string }>> }
        if (api?.getCommands) {
          console.log('Loading commands via IPC...')
          commands = await api.getCommands()
          console.log('Loaded commands via IPC:', commands.length)
        }
        
        if (api?.getTools) {
          console.log('Loading tools via IPC...')
          tools = await api.getTools()
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
    const api = window.api as unknown as { 
      getConfig?: () => Promise<Record<string, unknown>>;
      onNewSession?: (callback: () => void) => () => void;
      onOpenSettings?: (callback: () => void) => () => void;
    }
    api?.getConfig?.().then((config: Record<string, unknown>) => {
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
    const unsubNewSession = api?.onNewSession?.(() => {
      handleNewSession()
    })
    const unsubOpenSettings = api?.onOpenSettings?.(() => {
      setShowSettings(true)
    })

    return () => {
      unsubNewSession?.()
      unsubOpenSettings?.()
    }
  }, [])

  // Stop generation handler
  const handleStopGeneration = () => {
    // Stop both chat and agent mode generations
    stopChatGeneration()
    stopAgentGeneration()
    
    // Clear pending continuation to prevent it from being executed on next message
    if (pendingContinuation) {
      console.log('[handleStopGeneration] Clearing pending continuation due to user stop')
      setPendingContinuation(null)
    }
    setIsLoading(false)
  }

  // Continue execution handler - simplified to work like chat mode
  const handleContinueExecution = async () => {
    if (!pendingContinuation) {
      console.error('[handleContinueExecution] No pending continuation')
      return
    }

    console.log('[handleContinueExecution] Continuing execution...')
    setIsLoading(true)

    try {
      // Find provider by selected model
      const providerForModel = providers.find(p =>
        p.enabled && p.models.some(m => m.id === model)
      )

      // Get API key and URL from the provider that has the selected model
      const providerApiKey = providerForModel?.apiKey
      const providerApiUrl = providerForModel?.apiUrl

      if (!providerApiKey) {
        addMessage({ role: 'assistant', content: '请先在设置中为所选模型配置 API 密钥' })
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

      // Clear pending continuation
      setPendingContinuation(null)

      // Simply continue with agent mode - no upper limit
      await processAgentMessage(
        pendingContinuation.userOriginalRequest,
        pendingContinuation.conversationHistory as import('./store').Message[],
        {
          providerApiKey,
          providerApiUrl,
          model,
          currentCwd,
          projectPath,
          currentSession,
          localSessions,
          commands: commands.map(c => ({ name: c.name, description: c.responsibility })),
          tools: tools.map(t => ({ name: t.name, description: t.responsibility }))
        }
      )
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
    result: { content: string; writtenFiles: string[]; needsContinuation?: boolean; error?: string | null; conversationHistory?: import('./store').Message[] },
    userContent: string,
    sessionId: string | null
  ) => {
    console.log('[handleSendMessage] processWithTools returned:', result.content?.substring(0, 100))
    console.log('[handleSendMessage] writtenFiles:', result.writtenFiles)
    // processWithTools already updates the message, no need to update again

    // Clear needsAction from all messages to hide all "继续执行" buttons when task completes
    const currentMessages = useStore.getState().messages
    const clearedMessages = currentMessages.map(msg => ({
      ...msg,
      needsAction: undefined
    }))
    setMessages(clearedMessages)

    // Update tokens (estimate)
    updateTokens(userContent.length / 4, result.content.length / 4)

    // Auto-open written files
    if (result.writtenFiles.length > 0) {
      const lastFile = result.writtenFiles[result.writtenFiles.length - 1]
      try {
        const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(lastFile)}`)
        if (readRes.ok) {
          const fileData = await readRes.json() as { content?: string }
          openFile(lastFile, fileData.content || '')
        }
      } catch (readError) {
        console.error('Failed to auto-open file:', readError)
      }
    }

    // 注意：消息保存已由 auto-save useEffect 处理，使用 window.api.saveConversation
    // 不需要再手动调用 HTTP API
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

  // Handle project path change - auto load associated session from local storage
  const handleProjectPathChange = useCallback(async (newPath: string) => {
    console.log('[handleProjectPathChange] New project path:', newPath)
    setProjectPath(newPath)
    setCurrentProjectPath(newPath)

    if (!newPath) {
      setLocalSessions([])
      return
    }

    try {
      // TRAE风格：从本地存储加载会话列表
      if (window.api?.listSessions) {
        const result = await window.api.listSessions(newPath)
        if (result.success && result.sessions) {
          const loadedSessions = result.sessions.map(s => ({
            id: s.id,
            createdAt: s.updatedAt,
            messageCount: s.messageCount,
            projectPath: newPath,
            title: s.title
          }))
          setLocalSessions(loadedSessions)
          setSessions(loadedSessions)
          
          // 如果有会话，加载最新的一个
          if (loadedSessions.length > 0) {
            const latestSession = loadedSessions[0]
            selectSession(latestSession.id)
            
            // 加载消息
            const msgResult = await window.api.loadConversation(newPath, latestSession.id)
            if (msgResult.success && msgResult.messages) {
              setMessages(msgResult.messages)
              console.log('[handleProjectPathChange] Loaded session with', msgResult.messages.length, 'messages')
            }
          } else {
            // 没有会话，创建新的
            await createNewSession(newPath)
          }
        } else {
          // 加载失败，创建新的
          await createNewSession(newPath)
        }
      } else {
        // API不可用，创建新的
        await createNewSession(newPath)
      }
    } catch (error) {
      console.error('[handleProjectPathChange] Error:', error)
      await createNewSession(newPath)
    }
  }, [setProjectPath, setCurrentProjectPath, setLocalSessions, setSessions, selectSession, setMessages])
  
  // 创建新会话的辅助函数
  const createNewSession = async (projectPath: string) => {
    const newSessionId = `session-${Date.now()}`
    const newSession: Session = {
      id: newSessionId,
      createdAt: new Date().toISOString(),
      messageCount: 0,
      projectPath: projectPath,
      title: `会话 ${new Date().toLocaleString()}`
    }
    
    addSession(newSession)
    selectSession(newSessionId)
    clearMessages()
    setLocalSessions(prev => [newSession, ...prev])
    
    // 保存到本地
    if (window.api?.saveConversation) {
      await window.api.saveConversation(projectPath, newSessionId, [], newSession.title)
    }
    
    console.log('[handleProjectPathChange] Created new session:', newSessionId)
  }

  // Handle session selection from sidebar
  const handleSelectSessionFromSidebar = useCallback(async (sessionId: string) => {
    if (!projectPath) return
    
    selectSession(sessionId)
    
    // 加载会话消息
    if (window.api?.loadConversation) {
      const result = await window.api.loadConversation(projectPath, sessionId)
      if (result.success && result.messages) {
        setMessages(result.messages)
      } else {
        clearMessages()
      }
    }
  }, [projectPath, selectSession, setMessages, clearMessages])

  // Handle create new session from sidebar
  const handleCreateSessionFromSidebar = useCallback(async () => {
    if (!projectPath) {
      alert('请先打开一个项目')
      return
    }
    
    await createNewSession(projectPath)
  }, [projectPath])

  // Handle delete session from sidebar
  const handleDeleteSessionFromSidebar = useCallback(async (sessionId: string) => {
    if (!projectPath) return
    
    if (window.api?.deleteSession) {
      await window.api.deleteSession(projectPath, sessionId)
    }
    
    deleteSession(sessionId)
    setLocalSessions(prev => prev.filter(s => s.id !== sessionId))
    
    // 如果删除的是当前会话，清空消息
    if (currentSession === sessionId) {
      clearMessages()
    }
  }, [projectPath, currentSession, deleteSession, clearMessages])

  // Handle rename session from sidebar
  const handleRenameSessionFromSidebar = useCallback(async (sessionId: string, title: string) => {
    if (!projectPath) return
    
    updateSessionTitle(sessionId, title)
    setLocalSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s))
    
    // 保存到本地
    if (window.api?.saveConversation) {
      const session = localSessions.find(s => s.id === sessionId)
      if (session) {
        const msgResult = await window.api.loadConversation(projectPath, sessionId)
        await window.api.saveConversation(projectPath, sessionId, msgResult.messages || [], title)
      }
    }
  }, [projectPath, localSessions, updateSessionTitle])

  // Auto-save conversation when messages change
  useEffect(() => {
    const autoSave = async () => {
      if (!projectPath || !currentSession || messages.length === 0) return
      
      if (window.api?.saveConversation) {
        const session = localSessions.find(s => s.id === currentSession)
        await window.api.saveConversation(
          projectPath, 
          currentSession, 
          messages, 
          session?.title || `会话 ${new Date().toLocaleString()}`
        )
      }
    }
    
    // 延迟保存，避免频繁写入
    const timer = setTimeout(autoSave, 2000)
    return () => clearTimeout(timer)
  }, [messages, projectPath, currentSession, localSessions])

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
        
        // Validate JSON before parsing
        if (!argsJson || argsJson.length < 2) {
          console.log('[parseToolCalls] Empty or too short args JSON, skipping')
          continue
        }
        
        try {
          const args = JSON.parse(argsJson)
          toolCalls.push({ tool: toolName, arguments: args })
          console.log('Parsed tool call from special format:', toolName, args)
        } catch (e) {
          console.error('Failed to parse tool call args:', argsJson.substring(0, 200))
          console.error('Parse error:', e)
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
        // First check if content looks like valid JSON
        if (!blockContent.trim().startsWith('{') || !blockContent.trim().endsWith('}')) {
          console.log(`[parseToolCalls] Code block #${matchCount} doesn't look like JSON object, skipping`)
          // Continue to line-by-line parsing
        } else {
          const parsed = JSON.parse(blockContent)
          console.log(`[parseToolCalls] Parsed JSON from code block #${matchCount}:`, parsed)
          if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
            toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
            console.log(`[parseToolCalls] Added tool call from code block #${matchCount}:`, parsed.tool)
          }
        }
      } catch (e) {
        console.log(`[parseToolCalls] Failed to parse code block #${matchCount} as single JSON, trying line by line. Error:`, e)
        // If the block contains multiple JSON objects (one per line), try each line
        const lines = blockContent.split('\n')
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine.startsWith('//')) continue
          
          // Skip if doesn't look like JSON
          if (!trimmedLine.startsWith('{') || !trimmedLine.endsWith('}')) {
            continue
          }
          
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
                // Validate JSON string looks complete
                if (jsonStr.length < 10 || !jsonStr.includes('"tool"')) {
                  continue
                }
                const parsed = JSON.parse(jsonStr)
                if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
                  toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
                  console.log(`[parseToolCalls] Added tool call from JSON in line:`, parsed.tool)
                }
              } catch (e3) {
                // Ignore parse errors for individual lines
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
      
      // Validate JSON string before parsing
      if (!jsonStr || jsonStr.length < 10) {
        continue
      }
      
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
        // Ignore parse errors for inline JSON
        console.log(`[parseToolCalls] Failed to parse inline JSON:`, jsonStr.substring(0, 100))
      }
    }

    return toolCalls.length > 0 ? toolCalls : null
  }

  // State for pending continuation
  const [pendingContinuation, setPendingContinuation] = useState<{
    conversationHistory: ApiMessage[];
    userOriginalRequest: string;
    iterations: number;
    writtenFiles: string[];
    lastContent: string;
  } | null>(null)


  
  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return

    // Find provider by selected model
    const providerForModel = providers.find(p => 
      p.enabled && p.models.some(m => m.id === model)
    )
    
    // Get API key and URL from the provider that has the selected model
    const providerApiKey = providerForModel?.apiKey
    const providerApiUrl = providerForModel?.apiUrl
    
    if (!providerApiKey) {
      addMessage({ role: 'assistant', content: '请先在设置中为所选模型配置 API 密钥' })
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
      const outputMsg = `**命令执行成功**\n\n\`\`\`\n${commandResult.output}\n\`\`\`\n\n*当前目录: ${commandResult.cwd}*`
      addMessage({ role: 'assistant', content: outputMsg })
      setIsLoading(false)
      return
    }

    // If command failed, show error
    if (commandResult && !commandResult.success) {
      const errorMsg = `**命令执行失败**\n\n错误: ${commandResult.error || '未知错误'}\n\n*当前目录: ${commandResult.cwd}*`
      addMessage({ role: 'assistant', content: errorMsg })
      setIsLoading(false)
      return
    }

    // Check chat mode: 'agent' uses tools, 'chat' uses simple Q&A
    const isAgentMode = chatMode === 'agent'

    try {
      // Get current working directory for system prompt
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

      // Build system prompt based on chat mode
      const systemPrompt = isAgentMode
        ? buildSystemPrompt(commands, tools, currentCwd, projectContextStr)
        : buildChatSystemPrompt(currentCwd, projectContextStr)

      // Prepare messages for API
      const apiMessages: ApiMessage[] = []

      // Add system prompt as system message (not user/assistant pair)
      if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt })
      }

      // Add existing messages (filter out system messages to avoid duplication)
      messages.forEach(m => {
        if (m.role !== 'system') {
          apiMessages.push({ role: m.role, content: m.content })
        }
      })

      // Add the user message
      apiMessages.push({ role: 'user', content: content })

      if (isAgentMode) {
        // Agent mode: Use useAgentMode hook
        console.log('[handleSendMessage] Agent mode - using useAgentMode hook')

        // Simply call processAgentMessage - same as chat mode but with more tools
        await processAgentMessage(content, apiMessages as import('./store').Message[], {
          providerApiKey,
          providerApiUrl,
          model,
          currentCwd,
          projectPath,
          currentSession,
          localSessions,
          commands: commands.map(c => ({ name: c.name, description: c.responsibility })),
          tools: tools.map(t => ({ name: t.name, description: t.responsibility }))
        })
      } else {
        // Chat mode: Use useChatMode hook
        console.log('[handleSendMessage] Chat mode - using useChatMode hook')
        
        await processChatMessage(content, apiMessages as import('./store').Message[], {
          providerApiKey,
          providerApiUrl,
          model,
          currentCwd,
          projectPath,
          currentSession,
          localSessions
        })
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
      const api = window.api as unknown as { saveAllConfig?: (config: Record<string, unknown>) => Promise<boolean> }
      api?.saveAllConfig?.({
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
    const api = window.api as unknown as { saveAllConfig?: (config: Record<string, unknown>) => Promise<boolean> }
    const success = await api?.saveAllConfig?.({
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

  // Generate unique tab ID
  const generateTabId = useCallback(() => {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }, [])

  // Get file language from path
  const getFileLanguage = useCallback((path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      'js': 'javascript', 'ts': 'typescript', 'tsx': 'tsx', 'jsx': 'jsx',
      'py': 'python', 'json': 'json', 'md': 'markdown', 'css': 'css',
      'scss': 'scss', 'html': 'html', 'xml': 'xml', 'yaml': 'yaml',
      'yml': 'yaml', 'sh': 'bash', 'bash': 'bash', 'rs': 'rust',
      'go': 'go', 'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
      'hpp': 'cpp', 'rb': 'ruby', 'php': 'php', 'sql': 'sql'
    }
    return langMap[ext || ''] || 'text'
  }, [])

  // Open file in tab
  const openFile = useCallback((path: string, content: string) => {
    // Check if file is already open
    const existingTab = tabs.find(tab => tab.path === path)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      setSelectedFilePath(path)
      return
    }

    // Create new tab
    const fileName = path.split('/').pop() || path
    const newTab: Tab = {
      id: generateTabId(),
      path,
      name: fileName,
      content,
      isDirty: false,
      isPreview: true, // First open is preview mode
      language: getFileLanguage(path)
    }

    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    setSelectedFilePath(path)
  }, [tabs, generateTabId, getFileLanguage])

  // Handle file selection from FileExplorer
  const handleFileSelect = useCallback((path: string, content: string) => {
    openFile(path, content)
  }, [openFile])

  // Handle tab selection
  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      setSelectedFilePath(tab.path)
    }
  }, [tabs])

  // Handle tab close
  const handleTabClose = useCallback((tabId: string) => {
    setTabs(prev => {
      const tabIndex = prev.findIndex(t => t.id === tabId)
      const newTabs = prev.filter(t => t.id !== tabId)
      
      // Update active tab
      if (activeTabId === tabId) {
        if (newTabs.length > 0) {
          // Select previous tab or the first one
          const newActiveIndex = Math.max(0, tabIndex - 1)
          const newActiveTab = newTabs[newActiveIndex] || newTabs[0]
          setActiveTabId(newActiveTab.id)
          setSelectedFilePath(newActiveTab.path)
        } else {
          setActiveTabId(null)
          setSelectedFilePath(null)
        }
      }
      
      return newTabs
    })
  }, [activeTabId])

  // Handle close other tabs
  const handleTabCloseOthers = useCallback((tabId: string) => {
    setTabs(prev => {
      const keepTab = prev.find(t => t.id === tabId)
      if (!keepTab) return prev
      setActiveTabId(keepTab.id)
      setSelectedFilePath(keepTab.path)
      return [keepTab]
    })
  }, [])

  // Handle close all tabs
  const handleTabCloseAll = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
    setSelectedFilePath(null)
  }, [])

  // Handle close tabs to the right
  const handleTabCloseToRight = useCallback((tabId: string) => {
    setTabs(prev => {
      const tabIndex = prev.findIndex(t => t.id === tabId)
      return prev.slice(0, tabIndex + 1)
    })
  }, [])

  // Handle close tabs to the left
  const handleTabCloseToLeft = useCallback((tabId: string) => {
    setTabs(prev => {
      const tabIndex = prev.findIndex(t => t.id === tabId)
      const newTabs = prev.slice(tabIndex)
      if (!newTabs.find(t => t.id === activeTabId)) {
        const newActive = newTabs[0]
        if (newActive) {
          setActiveTabId(newActive.id)
          setSelectedFilePath(newActive.path)
        }
      }
      return newTabs
    })
  }, [activeTabId])

  // Handle tab content change
  const handleTabContentChange = useCallback((tabId: string, content: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, content, isDirty: true, isPreview: false } : tab
    ))
  }, [])

  // Handle tab save
  const handleTabSave = useCallback(async (tabId: string, content: string): Promise<boolean> => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return false

    try {
      const res = await fetch(`${API_BASE}/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content })
      })

      if (res.ok) {
        setTabs(prev => prev.map(t => 
          t.id === tabId ? { ...t, content, isDirty: false } : t
        ))
        return true
      }
    } catch (error) {
      console.error('Failed to save file:', error)
    }
    return false
  }, [tabs])

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId) || null

  // Handle file renamed from FileExplorer
  const handleFileRenamed = useCallback((oldPath: string, newPath: string, newName: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.path === oldPath) {
        return { ...tab, path: newPath, name: newName }
      }
      return tab
    }))
    // Update selected path if it was the renamed file
    if (selectedFilePath === oldPath) {
      setSelectedFilePath(newPath)
    }
  }, [selectedFilePath])

  // Handle file deleted from FileExplorer
  const handleFileDeleted = useCallback((deletedPath: string) => {
    setTabs(prev => {
      const tabToDelete = prev.find(tab => tab.path === deletedPath)
      if (!tabToDelete) return prev

      const newTabs = prev.filter(tab => tab.path !== deletedPath)
      
      // If the deleted tab was active, switch to another tab
      if (activeTabId === tabToDelete.id) {
        if (newTabs.length > 0) {
          const newActiveTab = newTabs[newTabs.length - 1]
          setActiveTabId(newActiveTab.id)
          setSelectedFilePath(newActiveTab.path)
        } else {
          setActiveTabId(null)
          setSelectedFilePath(null)
        }
      }
      
      return newTabs
    })
  }, [activeTabId])

  return (
    <div className={`app-container ${sessionSidebarOpen ? 'with-session-sidebar' : ''}`}>
      {/* Session Sidebar - TRAE风格会话管理 */}
      <SessionSidebar
        sessions={localSessions}
        currentSession={currentSession}
        projectPath={projectPath}
        onSelectSession={handleSelectSessionFromSidebar}
        onCreateSession={handleCreateSessionFromSidebar}
        onDeleteSession={handleDeleteSessionFromSidebar}
        onRenameSession={handleRenameSessionFromSidebar}
        isOpen={sessionSidebarOpen}
        onToggle={() => setSessionSidebarOpen(!sessionSidebarOpen)}
      />

      <div className="app-main-wrapper">
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
          onRootPathChange={handleProjectPathChange}
          openFile={openFile}
          onFileRenamed={handleFileRenamed}
          onFileDeleted={handleFileDeleted}
        />

        {/* Center: File Tabs + File Viewer + Terminal */}
        <div className="center-column">
          {/* File Tabs */}
          <FileTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={handleTabSelect}
            onTabClose={handleTabClose}
            onTabCloseOthers={handleTabCloseOthers}
            onTabCloseAll={handleTabCloseAll}
            onTabCloseToRight={handleTabCloseToRight}
            onTabCloseToLeft={handleTabCloseToLeft}
          />
          
          {/* File Viewer */}
          <div className="file-viewer-container">
            <FileViewer
              tab={activeTab}
              onContentChange={handleTabContentChange}
              onSave={handleTabSave}
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
          chatMode={chatMode}
          onChatModeChange={setChatMode}
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
    </div>
  )
}

export default App