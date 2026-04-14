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
  prompt += `5. VERIFY BEFORE PROCEEDING: After making changes, verify they work as expected before declaring completion.\n\n`

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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // Clear pending continuation to prevent it from being executed on next message
    if (pendingContinuation) {
      console.log('[handleStopGeneration] Clearing pending continuation due to user stop')
      setPendingContinuation(null)
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
        providerApiUrl,
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
        // Clear needsAction from all messages to hide all "继续执行" buttons
        const clearedMessages = messages.map(msg => ({
          ...msg,
          needsAction: undefined
        }))
        setMessages(clearedMessages)
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
    providerApiUrl: string | undefined,
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
    // 跟踪已读取的文件路径，防止重复读取
    const readFilesSet = new Set<string>()
    // 跟踪执行计划
    let executionPlan: string[] = []
    // 跟踪已完成的步骤
    const completedSteps: string[] = []
    // 任务记忆：存储关键分析结论和修复策略
    const taskMemory: {
      problemAnalysis?: string;      // 问题分析
      rootCause?: string;            // 根本原因
      fixStrategy?: string;          // 修复策略
      filesToModify?: string[];      // 需要修改的文件列表
      completedFixes?: string[];     // 已完成的修复
      errorsFound?: string[];        // 发现的错误
    } = {}

    // Add initial assistant message for tool calling progress - only if not continuation
    let assistantMessageIndex = -1
    if (!isContinuation) {
      // TRAE Builder模式：添加带有isBuilder标记的助手消息
      addMessage({ 
        role: 'assistant', 
        content: '',
        isBuilder: true,
        thinkingSteps: []
      })
      assistantMessageIndex = useStore.getState().messages.length - 1
    } else {
      // 找到最后一条助手消息
      const msgs = useStore.getState().messages
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          assistantMessageIndex = i
          break
        }
      }
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
        
        // 构建任务记忆摘要
        const taskMemorySummary = []
        if (taskMemory.problemAnalysis) {
          taskMemorySummary.push(`【问题分析】\n${taskMemory.problemAnalysis.substring(0, 300)}`)
        }
        if (taskMemory.rootCause) {
          taskMemorySummary.push(`【根本原因】\n${taskMemory.rootCause.substring(0, 300)}`)
        }
        if (taskMemory.fixStrategy) {
          taskMemorySummary.push(`【修复策略】\n${taskMemory.fixStrategy.substring(0, 300)}`)
        }
        if (taskMemory.filesToModify && taskMemory.filesToModify.length > 0) {
          const remainingFiles = taskMemory.filesToModify.filter(f => !taskMemory.completedFixes?.includes(f))
          taskMemorySummary.push(`【待修复文件】\n${remainingFiles.join(', ') || '无'}\n【已完成】\n${taskMemory.completedFixes?.join(', ') || '无'}`)
        }
        if (taskMemory.errorsFound && taskMemory.errorsFound.length > 0) {
          taskMemorySummary.push(`【发现的错误】\n${taskMemory.errorsFound.slice(-3).join('\n')}`)
        }
        
        // 构建压缩后的上下文
        const compressedContext = {
          role: 'user' as const,
          content: `[系统提示：对话历史已被智能压缩以节省空间。以下是关键信息摘要：

【用户原始请求】
${userOriginalRequest.substring(0, 500)}${userOriginalRequest.length > 500 ? '...' : ''}

${taskMemorySummary.length > 0 ? taskMemorySummary.join('\n\n') + '\n\n' : ''}【已读取的文件】
${contextSummary}

【当前任务状态】
- 已迭代次数: ${iterations}
- 已写入文件: ${writtenFiles.length > 0 ? writtenFiles.join(', ') : '无'}
- 任务进行中，请继续完成用户请求

⚠️ 重要提醒：
- 你已经分析过问题并制定了修复策略
- 不要重复读取已分析的文件
- 基于已有分析继续执行修复
- 如果修复完成，请明确总结修改内容65

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
            stream: false,
            apiUrl: providerApiUrl
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

      // 检查是否有重复读取的文件
      const duplicateReads: string[] = []
      const filteredToolCalls = toolCalls.filter((t) => {
        if (t.tool === 'read_file') {
          const path = (t.arguments as { path?: string }).path
          if (path && readFilesSet.has(path)) {
            duplicateReads.push(path)
            return false // 过滤掉重复读取
          }
          if (path) {
            readFilesSet.add(path)
          }
        }
        return true
      })
      
      // 如果有重复读取，添加警告到对话历史
      if (duplicateReads.length > 0) {
        const warningMessage = `⚠️ 警告: 检测到重复读取以下文件，已跳过: ${duplicateReads.join(', ')}\n\n请基于已读取的内容继续分析，不要重复读取。如果信息不足，请尝试其他方法或总结当前发现。`
        conversationHistory.push({ role: 'user', content: warningMessage })
        console.log('[ToolLoop] Blocked duplicate reads:', duplicateReads)
      }
      
      // 使用过滤后的工具调用
      const toolCallsToExecute = filteredToolCalls.length > 0 ? filteredToolCalls : toolCalls
      
      // TRAE风格：为每个工具调用创建步骤
      const currentSteps: Step[] = []
      if (assistantMessageIndex >= 0) {
        // 将之前的运行中步骤标记为完成
        const existingSteps = useStore.getState().messages[assistantMessageIndex]?.steps || []
        existingSteps.forEach(step => {
          if (step.status === 'running') {
            updateStepStatus(assistantMessageIndex, step.id, 'completed')
          }
        })
        
        // 为当前迭代的每个工具创建步骤
        toolCallsToExecute.forEach((toolCall, idx) => {
          const step: Step = {
            id: `step-${iterations}-${idx}-${Date.now()}`,
            title: `执行 ${toolCall.tool}`,
            status: idx === 0 ? 'running' : 'pending',
            timestamp: Date.now(),
            stepNumber: iterations,
            totalSteps: maxIterations,
            action: '正在调用工具',
            toolName: toolCall.tool,
            toolArgs: toolCall.arguments as Record<string, any>
          }
          addStepToMessage(assistantMessageIndex, step)
          currentSteps.push(step)
        })
      }
      
      // Execute tool calls with retry and error handling
      const results: Array<{ tool: string; result: { success: boolean; output: string; error?: string } }> = []
      
      console.log(`[ToolLoop] Starting execution of ${toolCallsToExecute.length} tool calls`)
      
      for (let toolIdx = 0; toolIdx < toolCallsToExecute.length; toolIdx++) {
        const toolCall = toolCallsToExecute[toolIdx]
        
        // 更新当前步骤状态为运行中
        if (assistantMessageIndex >= 0 && currentSteps[toolIdx]) {
          // 将之前的步骤标记为完成
          if (toolIdx > 0 && currentSteps[toolIdx - 1]) {
            updateStepStatus(assistantMessageIndex, currentSteps[toolIdx - 1].id, 'completed')
          }
          updateStepStatus(assistantMessageIndex, currentSteps[toolIdx].id, 'running')
        }
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
          // TRAE风格：更新步骤状态为完成
          if (assistantMessageIndex >= 0 && currentSteps[toolIdx]) {
            updateStepStatus(assistantMessageIndex, currentSteps[toolIdx].id, toolResult.success ? 'completed' : 'failed')
          }
        } else {
          // All retries failed
          results.push({ tool: toolCall.tool, result: { success: false, output: '', error: lastError || 'Unknown error after retries' } })
          console.error(`[ToolLoop] Tool ${toolCall.tool} failed after ${maxRetries} attempts:`, lastError)
          // TRAE风格：更新步骤状态为失败
          if (assistantMessageIndex >= 0 && currentSteps[toolIdx]) {
            updateStepStatus(assistantMessageIndex, currentSteps[toolIdx].id, 'failed')
          }
        }
      }
      
      console.log(`[ToolLoop] All tool calls completed, results:`, results)
      console.log(`[ToolLoop] Preparing to call LLM again with tool results...`)

      // 验证所有工具都已执行完成（关键监控）
      if (results.length !== toolCallsToExecute.length) {
        console.error(`[ToolLoop] WARNING: Expected ${toolCallsToExecute.length} results but got ${results.length}`)
        // 补充缺失的结果
        for (let i = results.length; i < toolCallsToExecute.length; i++) {
          results.push({ 
            tool: toolCallsToExecute[i].tool, 
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

      // 详细工具执行结果显示
      const allSuccess = results.every(r => r.result?.success)
      const successCount = results.filter(r => r.result?.success).length
      const statusEmoji = allSuccess ? '✅' : successCount > 0 ? '⚠️' : '❌'
      
      // 分类文件操作
      const readFiles: string[] = []
      const modifiedFiles: string[] = []
      const createdFiles: string[] = []
      const otherOperations: string[] = []
      
      results.forEach(r => {
        const args = toolCallsToExecute.find(t => t.tool === r.tool)?.arguments as { path?: string } | undefined
        const path = args?.path || ''
        
        if (r.tool === 'read_file' && path) {
          readFiles.push(path)
        } else if ((r.tool === 'edit_file' || r.tool === 'write_file') && path && r.result?.success) {
          if (r.tool === 'write_file') {
            createdFiles.push(path)
          } else {
            modifiedFiles.push(path)
          }
        } else {
          otherOperations.push(`${r.tool}${path ? ` (${path})` : ''} - ${r.result?.success ? '✅' : '❌'}`)
        }
      })
      
      // 构建文件操作摘要
      const fileOpsSummary = []
      if (readFiles.length > 0) {
        fileOpsSummary.push(`📖 已读取: ${readFiles.length} 个文件`)
      }
      if (modifiedFiles.length > 0) {
        fileOpsSummary.push(`✏️ 已修改: ${modifiedFiles.join(', ')}`)
      }
      if (createdFiles.length > 0) {
        fileOpsSummary.push(`📝 已创建: ${createdFiles.join(', ')}`)
      }
      
      // 构建详细的执行结果展示
      const detailedResults = results.map((r, idx) => {
        const toolStatus = r.result?.success ? '✅ 成功' : '❌ 失败'
        const output = r.result?.output 
          ? `\n   📤 输出:\n   \`\`\`\n   ${r.result.output.substring(0, 300)}${r.result.output.length > 300 ? '...' : ''}\n   \`\`\`` 
          : ''
        const error = r.result?.error 
          ? `\n   ⚠️ 错误: ${r.result.error.substring(0, 200)}` 
          : ''
        return `**${idx + 1}. ${r.tool}** - ${toolStatus}${output}${error}`
      }).join('\n\n')
      
      // TRAE风格：更新消息内容（保留步骤信息）
      if (assistantMessageIndex >= 0) {
        const state = useStore.getState()
        const msgs = [...state.messages]
        if (msgs[assistantMessageIndex]) {
          msgs[assistantMessageIndex] = { 
            ...msgs[assistantMessageIndex], 
            content: `**步骤 ${iterations}/${maxIterations}**\n\n` +
              `${statusEmoji} **工具执行完成** (${successCount}/${results.length} 成功)\n\n` +
              `${fileOpsSummary.length > 0 ? '📁 **文件操作:**\n' + fileOpsSummary.join('\n') + '\n\n' : ''}` +
              `**详细结果:**\n${detailedResults}`
          }
          useStore.setState({ messages: msgs })
        }
      }
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
        
        // 构建详细的达到最大迭代次数说明
        const maxIterMessage = `⏹️ **已达到最大迭代次数 (${maxIterations} 次)**\n\n` +
          `📊 **执行统计:**\n` +
          `- 总迭代次数: ${iterations}\n` +
          `- 已写入文件: ${writtenFiles.length > 0 ? writtenFiles.join(', ') : '无'}\n` +
          `- 已读取文件: ${readFilesSet.size} 个\n\n` +
          `🤔 **为什么任务没有完成?**\n` +
          `AI 可能需要更多步骤来完成复杂的任务。任务可能需要:\n` +
          `- 读取更多文件\n` +
          `- 执行更多命令\n` +
          `- 进行更多修改\n\n` +
          `💡 **下一步:**\n` +
          `点击 **"继续执行"** 按钮让 AI 继续处理，或直接发送新消息。`
        
        return {
          content: maxIterMessage + '\n\n---\n\n**AI 最后响应:**\n' + finalContent,
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

    // Find provider by selected model
    const providerForModel = providers.find(p => 
      p.enabled && p.models.some(m => m.id === model)
    )
    
    // Get API key and URL from the provider that has the selected model
    // Note: providerForModel should always exist if a model is selected
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

    // Check chat mode: 'agent' uses tools, 'chat' uses simple Q&A
    const isCodeRequest = chatMode === 'agent'

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
            providerApiUrl,
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
          const result = await processWithTools(apiMessages, content, currentCwd, providerApiKey, providerApiUrl)
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
            apiUrl: providerApiUrl,
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

        // 注意：消息保存已由 auto-save useEffect 处理，使用 window.api.saveConversation
        // 不需要再手动调用 HTTP API
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