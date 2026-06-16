/// <reference types="./env" />
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ProviderConfig, type Session, type Step, type ImageContent, type FeishuConfig, type SyncStatus } from './store'
import { useKiloStore } from './store/kiloStore'
import { initFeishuService, getFeishuService, updateFeishuConfig } from './services/feishuService'
import KiloPage from './pages/KiloPage'
import SettingsModal from './components/SettingsModal'
import TitleBar from './components/TitleBar'
import ActivityBar, { type ActivityBarItem } from './components/ActivityBar'
import JackFileExplorer from './components/JackFileExplorer'
import SearchPanel from './components/SearchPanel'
import GitPanel from './components/GitPanel'
import ReminderPanel from './components/ReminderPanel'
import MCPSkillPanel from './components/MCPSkillPanel'
import FileViewer from './components/FileViewer'
import DiffViewer from './components/DiffViewer'
import BrowserView from './components/BrowserView'
import FileTabs, { type Tab } from './components/FileTabs'
import Terminal, { type TerminalRef } from './components/Terminal'

import CommandPalette, { type Command } from './components/CommandPalette'
import { t } from './i18n'
import { useChatMode, useAgentMode, useUnifiedConversation } from './hooks'
import {
  buildChatModePrompt,
  buildAgentModePrompt,
  getSystemInfo,
  type PromptCommand
} from './prompts'
import { useCodeCompletion } from './hooks/useCodeCompletion'
import { useCodeIntelligence } from './hooks/useCodeIntelligence'
import FileWriteIndicator, { useFileWriteStatus } from './components/FileWriteIndicator'
import Resizer from './components/Resizer'
import './styles/completion.css'
import './styles/vscode-sidebar.css'
import './styles/resizer.css'
import { getLanguageFromPath } from './utils/languageMap'
import { saveWorkspaceState, loadWorkspaceState } from './utils/workspaceState'

// API_BASE 已移除 - 现在使用 IPC 通信替代 HTTP API
// const API_BASE = 'http://localhost:3847/api'

// Project context cache
let cachedProjectContext: string = ''
let cachedProjectPath: string = ''

/**
 * 构建 Chat Mode 系统提示词（使用新的提示词模块）
 * @deprecated 直接使用 buildChatModePrompt 从 './prompts' 导入
 */
function buildChatSystemPrompt(cwd: string, projectContext: string = ''): string {
  return buildChatModePrompt({
    systemInfo: getSystemInfo(cwd),
    projectContext
  })
}

/**
 * 构建 Agent Mode 系统提示词（使用新的提示词模块）
 * @deprecated 直接使用 buildAgentModePrompt 从 './prompts' 导入
 */
function buildSystemPrompt(
  commands: { name: string; responsibility: string }[],
  tools: { name: string; responsibility: string; parameters?: Record<string, { type: string; description: string; required?: boolean }>; required?: string[] }[],
  cwd: string,
  projectContext: string = ''
): string {
  const promptCommands: PromptCommand[] = commands.map(c => ({
    name: c.name,
    description: c.responsibility
  }))

  return buildAgentModePrompt({
    systemInfo: getSystemInfo(cwd),
    projectContext,
    commands: promptCommands
  })
}

// Extended Message interface for API calls (includes 'tool' role)
interface ApiMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

// 转换消息内容为多模态格式
export function buildMultimodalContent(content: string, images?: ImageContent[]): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!images || images.length === 0) {
    return content
  }

  const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

  // 添加文本内容
  if (content.trim()) {
    contentParts.push({ type: 'text', text: content })
  }

  // 添加图片
  // ✅ 修复：img.data 已经是完整的 data URL (data:image/xxx;base64,...)
  // 不需要再添加前缀
  images.forEach(img => {
    // 检查 img.data 是否已经是 data URL 格式
    const imageUrl = img.data.startsWith('data:') 
      ? img.data  // 已经是 data URL，直接使用
      : `data:${img.mimeType};base64,${img.data}`  // 不是 data URL，添加前缀
    
    contentParts.push({
      type: 'image_url',
      image_url: {
        url: imageUrl
      }
    })
  })

  return contentParts
}

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showMCPSkillPanel, setShowMCPSkillPanel] = useState(false)
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
  
  // Pending workspace state for restoring tabs after file tree loads
  const pendingWorkspaceStateRef = useRef<any>(null)
  // Ref to track current project path for preventing cross-project saves
  const currentProjectPathRef = useRef<string | null>(null)
  
  // Editor reference for jumping to lines
  const editorRef = useRef<any>(null)
  
  // Ref to track latest edited content for each tab (for menu save)
  const latestTabContentRef = useRef<Map<string, string>>(new Map())
  
  // Session sidebar state - 已移动到顶部，不再需要侧边栏
  const [localSessions, setLocalSessions] = useState<Session[]>([])
  
  // Activity Bar state - 默认为 'explorer' 以确保文件浏览器始终可见
  const [activeActivity, setActiveActivity] = useState<ActivityBarItem>('explorer')
  const [previousActivity, setPreviousActivity] = useState<ActivityBarItem>('explorer')

  // Panel widths state - 可调整的面板宽度
  const [leftPanelWidth, setLeftPanelWidth] = useState(320)
  const [rightPanelWidth, setRightPanelWidth] = useState(420)
  const MIN_LEFT_WIDTH = 200
  const MAX_LEFT_WIDTH = 500
  const MIN_RIGHT_WIDTH = 300
  const MAX_RIGHT_WIDTH = 600
  
  // Activity Bar click handler
  const handleActivityClick = useCallback((item: ActivityBarItem) => {
    // Settings 按钮切换设置页面
    if (item === 'settings') {
      setShowSettings(true)
      setActiveActivity('settings')
      return
    }
    
    // 切换到其他 Activity 时关闭设置
    if (showSettings) {
      setShowSettings(false)
    }
    
    // 切换其他 Activity
    if (item !== activeActivity) {
      setPreviousActivity(activeActivity)
      setActiveActivity(item)
    }
  }, [activeActivity, showSettings])
  
  // Command Palette state
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  
  // Monaco Editor cursor position
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number }>({ line: 1, column: 1 })

  // VS Code Copilot integration hooks
  const codeCompletion = useCodeCompletion()
  const codeIntelligence = useCodeIntelligence()

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
    copilotEnabled,
    setCopilotEnabled,
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
    updateStepStatus,
    feishuConfig,
    syncStatus,
    setFeishuConfig,
    setSyncStatus
  } = useStore()

  // Initialize mode-specific hooks
  const { processChatMessage, stopGeneration: stopChatGeneration } = useChatMode()
  const { processAgentMessage, stopGeneration: stopAgentGeneration, buildSystemPrompt: buildAgentSystemPrompt } = useAgentMode()

  // 新的统一对话 Hook（基于 claw-code 架构）
  const {
    sendMessage: sendUnifiedMessage,
    stopGeneration: stopUnifiedGeneration,
    isRunning: isUnifiedRunning
  } = useUnifiedConversation({
    cwd: projectPath || '/',
    projectPath,
    currentSession,
    localSessions,
    chatMode,
    commands,
    tools,
    systemPrompt: '', // 将在发送时动态构建
    maxIterations: 16
  })

  // Load commands and tools on mount via IPC
  useEffect(() => {
    const loadData = async () => {
      try {
        // 使用 IPC 加载命令和工具
        type CommandData = { name: string; responsibility: string; source_hint?: string; description?: string }
        type ToolData = { name: string; responsibility: string; source_hint?: string; description?: string }
        let commands: CommandData[] = []
        let tools: ToolData[] = []
        
        const api = window.api as unknown as { 
          getCommands?: () => Promise<CommandData[]>
          getTools?: () => Promise<ToolData[]>
        }
        
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
        
        // 添加 source_hint 字段以匹配类型要求
        const commandsWithSourceHint: import('./store').Command[] = commands.map(cmd => ({
          name: cmd.name,
          responsibility: cmd.responsibility,
          source_hint: cmd.source_hint || cmd.description || 'builtin'
        }))
        
        const toolsWithSourceHint: import('./store').Tool[] = tools.map(tool => ({
          name: tool.name,
          responsibility: tool.responsibility,
          source_hint: tool.source_hint || tool.description || 'builtin'
        }))
        
        if (commandsWithSourceHint.length > 0) {
          setCommands(commandsWithSourceHint)
        }
        if (toolsWithSourceHint.length > 0) {
          setTools(toolsWithSourceHint)
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
    const loadConfig = async () => {
      try {
        console.log('Loading config from store...')
        const api = window.api as unknown as { getConfig?: () => Promise<{
          apiKey: string
          model: string
          defaultModel: string
          permissionMode: string
          providers: any[]
        }> }
        
        if (api?.getConfig) {
          const config = await api.getConfig()
          console.log('Loaded config:', config)
          
          if (config) {
            setApiKey(config.apiKey || '')
            setModel(config.model || '')
            setDefaultModel(config.defaultModel || '')
            setPermissionMode(config.permissionMode || 'workspace-write')
            setProviders(config.providers || [])
            console.log(`Config loaded: ${config.providers?.length || 0} providers`)
          }
        }
        
        // 加载飞书配置
        const savedFeishuConfig = localStorage.getItem('feishuConfig')
        if (savedFeishuConfig) {
          try {
            const parsedConfig = JSON.parse(savedFeishuConfig)
            setFeishuConfig(parsedConfig)
            // 初始化飞书服务
            initFeishuService(parsedConfig, (status) => {
              setSyncStatus({ ...syncStatus, ...status })
            })
            console.log('Feishu config loaded:', parsedConfig)

            // 如果启用了机器人功能，初始化 WebSocket 长连接
            if (parsedConfig.botEnabled && window.api?.feishu) {
              // 启动 WebSocket 连接
              window.api.feishu.startWebSocket({
                appId: parsedConfig.appId,
                appSecret: parsedConfig.appSecret,
                botEnabled: parsedConfig.botEnabled
              }).then((result: any) => {
                if (result.success) {
                  console.log('[App] Feishu WebSocket started successfully')
                } else {
                  console.error('[App] Failed to start Feishu WebSocket:', result.error)
                }
              })
            }
          } catch (error) {
            console.error('Failed to parse Feishu config:', error)
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error)
      }
    }
    
    loadConfig()
    
    // Restore workspace state on app launch if projectPath exists
    const restoreWorkspaceOnLaunch = async () => {
      const savedProjectPath = localStorage.getItem('current-project-path')
      // Check if already restored to prevent infinite loop
      if (savedProjectPath && savedProjectPath !== projectPath) {
        console.log('[App] Restoring workspace on launch:', savedProjectPath)

        // Initialize the ref with the saved path
        currentProjectPathRef.current = savedProjectPath

        const workspaceState = loadWorkspaceState(savedProjectPath)
        if (workspaceState) {
          console.log('[App] Found workspace state:', workspaceState)

          // Restore activity
          if (workspaceState.activeActivity) {
            setActiveActivity(workspaceState.activeActivity)
          }

          // Restore selected file path
          if (workspaceState.selectedFilePath) {
            setSelectedFilePath(workspaceState.selectedFilePath)
          }

          // Store for later tab restoration after projectPath is set
          pendingWorkspaceStateRef.current = workspaceState
        }

        // Trigger project path change to restore sessions and tabs
        // Use setTimeout to ensure all state is ready
        setTimeout(() => {
          handleProjectPathChange(savedProjectPath)
        }, 100)
      }
    }
    
    // Only restore if projectPath is not already set
    if (!projectPath) {
      restoreWorkspaceOnLaunch()
    }
    
    const unsubOpenSettings = window.api?.onOpenSettings?.(() => {
      setShowSettings(true)
    })

    // Save workspace state before page unload
    // Use refs to always get the latest state (closures capture old values)
    const handleBeforeUnload = () => {
      // Get the current project path from localStorage (most reliable)
      const currentProjectPath = localStorage.getItem('current-project-path')
      if (currentProjectPath) {
        console.log('[App] Saving workspace state before unload:', currentProjectPath)
        console.log('[App] Current tabs count from ref:', latestTabsRef.current.length)
        const openTabs = latestTabsRef.current.map(tab => ({
          path: tab.path,
          name: tab.name,
          type: tab.language === 'browser' ? 'browser' : 'file' as 'file' | 'diff' | 'browser',
          browserUrl: tab.browserUrl
        }))
        saveWorkspaceState(currentProjectPath, {
          expandedPaths: [],
          openTabs,
          activeTabId: latestActiveTabIdRef.current,
          selectedFilePath: latestSelectedFilePathRef.current,
          activeActivity: latestActiveActivityRef.current
        })
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsubOpenSettings?.()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [setApiKey, setModel, setDefaultModel, setPermissionMode, setProviders, projectPath, tabs, activeTabId, selectedFilePath, activeActivity])

  // Stop generation handler
  const handleStopGeneration = () => {
    // Stop both chat and agent mode generations
    stopChatGeneration()
    stopAgentGeneration()
    
    // Stop unified conversation
    stopUnifiedGeneration()
    
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

      // Get current working directory from projectPath
      const currentCwd = projectPath || '/'
      console.log('[handleContinueExecution] Current working directory:', currentCwd)

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
          const newSessionId = `session-${Date.now()}`
          const newSession = {
            id: newSessionId,
            createdAt: new Date().toISOString(),
            messageCount: 0
          }
          addSession(newSession)
          selectSession(newSessionId)
          clearMessages()
          console.log('Created session via IPC:', newSessionId)
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

    // Auto-open written files via IPC
    if (result.writtenFiles.length > 0) {
      const lastFile = result.writtenFiles[result.writtenFiles.length - 1]
      try {
        // 使用 IPC 读取文件
        const api = window.api as unknown as { 
          executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
        }
        if (api?.executeTool) {
          const fileResult = await api.executeTool(
            `auto-open-${Date.now()}`,
            'read_file',
            { path: lastFile },
            projectPath || '/'
          )
          if (fileResult.success && fileResult.output) {
            openFile(lastFile, fileResult.output)
          }
        }
      } catch (readError) {
        console.error('Failed to auto-open file:', readError)
      }
    }

    // 注意：消息保存已由 auto-save useEffect 处理，使用 window.api.saveConversation
    // 不需要再手动调用 HTTP API
  }

  // Fetch project context from main process via IPC
  const fetchProjectContext = useCallback(async (projectPath: string): Promise<string> => {
    // Return cached context if path hasn't changed
    if (cachedProjectContext && cachedProjectPath === projectPath) {
      console.log('[ProjectContext] Using cached context for:', projectPath)
      return cachedProjectContext
    }

    try {
      console.log('[ProjectContext] Fetching context for:', projectPath)
      // 使用 IPC 调用获取项目上下文
      const api = window.api as unknown as { 
        executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
      }
      if (api?.executeTool) {
        const result = await api.executeTool(
          `project-context-${Date.now()}`,
          'list_directory',
          { path: projectPath, recursive: false },
          projectPath
        )
        if (result.success && result.output) {
          const context = `Project structure:\n${result.output}`
          cachedProjectContext = context
          cachedProjectPath = projectPath
          console.log('[ProjectContext] Context fetched successfully, length:', context.length)
          return context
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
    // Prevent duplicate processing of the same path
    if (newPath === projectPath) {
      console.log('[handleProjectPathChange] Path already set, skipping:', newPath)
      return
    }

    console.log('[handleProjectPathChange] New project path:', newPath)
    console.log('[handleProjectPathChange] Path length:', newPath.length)
    console.log('[handleProjectPathChange] Path chars:', newPath.split('').map(c => c.charCodeAt(0)))

    // Save current project state before switching
    // Use refs to get the latest state, not the stale closure values
    // Fallback to projectPath state if ref is not set (e.g., first time opening folder)
    const currentPath = currentProjectPathRef.current || projectPath
    console.log('[handleProjectPathChange] Current path for saving:', currentPath, 'ref:', currentProjectPathRef.current, 'state:', projectPath)
    console.log('[handleProjectPathChange] New path:', newPath, 'tabs count:', latestTabsRef.current.length)
    if (currentPath && currentPath !== newPath) {
      console.log('[handleProjectPathChange] Saving current project state:', currentPath)
      const openTabs = latestTabsRef.current.map(tab => ({
        path: tab.path,
        name: tab.name,
        type: tab.language === 'browser' ? 'browser' : 'file' as 'file' | 'diff' | 'browser',
        browserUrl: tab.browserUrl
      }))
      console.log('[handleProjectPathChange] Saving tabs:', openTabs.length, 'tabs')
      saveWorkspaceState(currentPath, {
        expandedPaths: [],
        openTabs,
        activeTabId: latestActiveTabIdRef.current,
        selectedFilePath: latestSelectedFilePathRef.current,
        activeActivity: latestActiveActivityRef.current
      })
    } else {
      console.log('[handleProjectPathChange] Skipping save: currentPath=', currentPath, 'newPath=', newPath)
    }

    // Reset the saved state refs to prevent auto-save from saving old tabs to new project
    // This is crucial: we reset lastSavedProjectRef so the effect will skip saving
    // until both projectPath and tabs have been updated
    lastSavedProjectRef.current = null
    console.log('[handleProjectPathChange] Reset lastSavedProjectRef to prevent cross-project save')

    // 先清空当前会话和消息，防止旧消息被保存到新项目
    clearMessages()
    setLocalSessions([])

    // 清空当前打开的文件标签和选中状态
    setTabs([])
    setActiveTabId(null)
    setSelectedFilePath(null)

    setProjectPath(newPath)
    setCurrentProjectPath(newPath)
    // Update the ref immediately to prevent auto-save from using old project
    currentProjectPathRef.current = newPath
    
    // Save project path to localStorage for app launch restoration
    localStorage.setItem('current-project-path', newPath)

    if (!newPath) {
      return
    }

    // Load workspace state for this project
    const workspaceState = loadWorkspaceState(newPath)
    console.log('[handleProjectPathChange] Workspace state loaded:', workspaceState, 'for path:', newPath)
    
    // Always clear tabs first, then restore if there's saved state
    // This ensures old project tabs are cleared even if new project has no saved state
    if (!workspaceState || !workspaceState.openTabs || workspaceState.openTabs.length === 0) {
      console.log('[handleProjectPathChange] No saved tabs for this project, ensuring tabs are cleared')
      setTabs([])
      setActiveTabId(null)
      setSelectedFilePath(null)
    }
    
    if (workspaceState) {
      console.log('[handleProjectPathChange] Loading workspace state:', workspaceState)
      
      // Restore active activity
      if (workspaceState.activeActivity) {
        setActiveActivity(workspaceState.activeActivity)
      }
      
      // Restore selected file path
      if (workspaceState.selectedFilePath) {
        setSelectedFilePath(workspaceState.selectedFilePath)
      }
      
      // Restore open tabs immediately
      if (workspaceState.openTabs && workspaceState.openTabs.length > 0) {
        console.log('[handleProjectPathChange] Restoring tabs:', workspaceState.openTabs.length)
        
        const restoredTabs: Tab[] = []
        // Map to track old ID -> new ID for active tab restoration
        const idMapping: Map<string, string> = new Map()
        
        for (const savedTab of workspaceState.openTabs) {
          try {
            if (savedTab.type === 'file' && savedTab.path) {
              // Try to read file content
              const api = window.api as any
              if (api?.fsReadFile) {
                console.log('[handleProjectPathChange] Reading file:', savedTab.path)
                const result = await api.fsReadFile(savedTab.path)
                if (result.success) {
                  // Generate new ID but keep track of the mapping
                  const newId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                  // Store mapping from saved path to new ID (for finding active tab)
                  idMapping.set(savedTab.path, newId)
                  
                  const newTab: Tab = {
                    id: newId,
                    name: savedTab.name,
                    path: savedTab.path,
                    content: result.content,
                    language: getLanguageFromPath(savedTab.path),
                    isDirty: false,
                    isPreview: false
                  }
                  restoredTabs.push(newTab)
                  console.log('[handleProjectPathChange] Restored tab:', savedTab.name, 'new ID:', newId)
                } else {
                  console.error('[handleProjectPathChange] Failed to read file:', savedTab.path, result.error)
                }
              }
            } else if (savedTab.type === 'browser' && savedTab.browserUrl) {
              const newId = `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
              idMapping.set(savedTab.path, newId)
              
              const newTab: Tab = {
                id: newId,
                name: savedTab.name || 'Browser',
                path: 'browser://' + savedTab.browserUrl,
                content: '',
                language: 'browser',
                isDirty: false,
                browserUrl: savedTab.browserUrl,
                isPreview: false
              }
              restoredTabs.push(newTab)
              console.log('[handleProjectPathChange] Restored browser tab:', savedTab.name)
            }
          } catch (error) {
            console.error('[handleProjectPathChange] Failed to restore tab:', savedTab, error)
          }
        }
        
        console.log('[handleProjectPathChange] Restored tabs count:', restoredTabs.length)
        
        // Always set tabs to clear old project tabs, even if restoredTabs is empty
        setTabs(restoredTabs)
        
        if (restoredTabs.length > 0) {
          // Restore active tab - find by path since IDs are regenerated
          if (workspaceState.activeTabId) {
            // Find the saved active tab by looking up which tab had this ID
            const savedActiveTab = workspaceState.openTabs.find(t => {
              // Try to match by path since we can't match by regenerated ID
              return t.path === workspaceState.selectedFilePath
            })
            
            if (savedActiveTab) {
              // Find the restored tab with the same path
              const activeTab = restoredTabs.find(t => t.path === savedActiveTab.path)
              if (activeTab) {
                setActiveTabId(activeTab.id)
                setSelectedFilePath(activeTab.path)
                console.log('[handleProjectPathChange] Restored active tab by path:', activeTab.id, activeTab.path)
              } else {
                setActiveTabId(restoredTabs[0].id)
                setSelectedFilePath(restoredTabs[0].path)
                console.log('[handleProjectPathChange] Set first tab as active:', restoredTabs[0].id)
              }
            } else {
              setActiveTabId(restoredTabs[0].id)
              setSelectedFilePath(restoredTabs[0].path)
              console.log('[handleProjectPathChange] Set first tab as active:', restoredTabs[0].id)
            }
          } else {
            setActiveTabId(restoredTabs[0].id)
            setSelectedFilePath(restoredTabs[0].path)
            console.log('[handleProjectPathChange] Set first tab as active:', restoredTabs[0].id)
          }
        } else {
          // No tabs to restore, clear active tab
          setActiveTabId(null)
          setSelectedFilePath(null)
          console.log('[handleProjectPathChange] No tabs to restore, cleared active tab')
        }
      }
    }

    // Working directory is now managed by projectPath, no need to sync with backend
    console.log('[handleProjectPathChange] Working directory set to:', newPath)

    try {
      // TRAE风格：从本地存储加载会话列表
      if (window.api?.listSessions) {
        const result = await window.api.listSessions(newPath)
        if (result.success && result.sessions) {
          const loadedSessions = result.sessions.map((s: { id: string; title: string; updatedAt: string; messageCount: number }) => ({
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
      
      // 验证当前会话是否属于当前项目（防止切换项目时保存旧消息到新项目）
      const session = localSessions.find(s => s.id === currentSession)
      if (!session) return
      
      // 跳过飞书会话，避免覆盖飞书消息
      if (session.title === '飞书专用对话' || currentSession.startsWith('feishu-session-')) {
        console.log('[AutoSave] Skipping save for Feishu session:', currentSession)
        return
      }
      
      // 如果会话有 projectPath 属性，验证是否匹配当前项目
      if (session.projectPath && session.projectPath !== projectPath) {
        console.log('[AutoSave] Skipping save - session belongs to different project:', session.projectPath)
        return
      }
      
      if (window.api?.saveConversation) {
        await window.api.saveConversation(
          projectPath, 
          currentSession, 
          messages, 
          session.title || `会话 ${new Date().toLocaleString()}`
        )
      }
    }
    
    // 延迟保存，避免频繁写入
    const timer = setTimeout(autoSave, 2000)
    return () => clearTimeout(timer)
  }, [messages, projectPath, currentSession, localSessions])

  const handleNewSession = useCallback(async () => {
    // Create a new session via IPC
    try {
      const newSessionId = `session-${Date.now()}`
      const newSession = {
        id: newSessionId,
        createdAt: new Date().toISOString(),
        messageCount: 0
      }
      addSession(newSession)
      selectSession(newSessionId)
      clearMessages()
      console.log('Created new session:', newSessionId)
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


  
  const handleSendMessage = async (content: string, images?: ImageContent[]) => {
    if (!content.trim() && (!images || images.length === 0)) return

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
          // 使用 IPC 执行命令
          const api = window.api as unknown as { 
            cliChat?: {
              executeCommand?: (name: string, prompt: string, cwd: string) => Promise<{ success: boolean; result?: { success: boolean; output: string; error?: string; cwd: string } }>
            }
          }
          if (api?.cliChat?.executeCommand) {
            const execResult = await api.cliChat.executeCommand(command.name, content, projectPath || '/')
            if (execResult.success && execResult.result) {
              commandResult = execResult.result
              console.log('Executed command via IPC:', command.name)
            }
          }
        } catch (error) {
          console.error('Failed to execute command:', error)
        }
      }
    }

    // Add user message (with images if provided)
    addMessage({ role: 'user', content, images })
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
      const currentCwd = projectPath || '/'
      console.log('[handleSendMessage] Current working directory:', currentCwd)

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
          // 如果有图片，转换为多模态格式
          const hasImages = m.images && m.images.length > 0
          const messageContent = hasImages
            ? buildMultimodalContent(m.content, m.images)
            : m.content
          apiMessages.push({ role: m.role, content: messageContent })
        }
      })

      // Add the user message (with images if provided)
      apiMessages.push({ role: 'user', content: buildMultimodalContent(content, images) })

      // 使用新的统一对话 Hook（基于 claw-code 架构）
      console.log(`[handleSendMessage] ${isAgentMode ? 'Agent' : 'Chat'} mode - using useUnifiedConversation hook`)
      
      await sendUnifiedMessage(content, apiMessages as import('./store').Message[], {
        providerApiKey,
        providerApiUrl,
        model
      })

      // 飞书机器人：如果开启了机器人功能，等待 AI 回复后发送到飞书
      if (feishuConfig.botEnabled && feishuConfig.chatId) {
        // 延迟检查 AI 回复
        setTimeout(() => {
          const sendToFeishu = async () => {
            try {
              const feishuService = getFeishuService()
              if (!feishuService) {
                console.log('[FeishuBot] Feishu service not initialized')
                return
              }

              // 获取最后一条助手消息
              const state = useStore.getState()
              const lastAssistantMessage = state.messages
                .filter(m => m.role === 'assistant')
                .pop()

              if (lastAssistantMessage && typeof lastAssistantMessage.content === 'string') {
                await feishuService.sendMessage(
                  lastAssistantMessage.content,
                  feishuConfig.chatId,
                  feishuConfig.chatType || 'group'
                )
                console.log('[FeishuBot] AI reply sent to Feishu')
              }
            } catch (error) {
              console.error('[FeishuBot] Failed to send AI reply:', error)
            }
          }
          sendToFeishu()
        }, 5000) // 等待 5 秒让 AI 生成回复
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

  // ==================== 飞书机器人消息处理 ====================
  
  // 处理从飞书接收到的消息
  const handleFeishuMessage = useCallback(async (content: string, chatId: string, chatType: 'group' | 'user' | 'p2p', messageId?: string) => {
    if (!content.trim()) return null

    console.log('[FeishuBot] Received message:', { content, chatId, chatType, messageId })

    // 获取当前项目路径
    const state = useStore.getState()
    const currentProjectPath = state.currentProjectPath
    
    if (!currentProjectPath) {
      const errorReply = '请先打开一个项目，才能使用工具功能'
      if (window.api?.feishu) {
        await window.api.feishu.sendMessage(errorReply, chatId, chatType as 'group' | 'p2p')
      }
      return errorReply
    }

    // 使用 cliChat 进行对话（支持工具调用）
    try {
      const ipcApi = (window as unknown as {
        api?: {
          cliChat?: {
            createSession: (mode: 'chat' | 'agent', cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
            // ✅ 修复：content 支持 string 或 多模态数组
            sendMessage: (sessionId: string, message: string, messages?: Array<{ 
              role: string; 
              content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> 
            }>, model?: string) => Promise<{ success: boolean; error?: string }>
            onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
            stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
          }
        }
      }).api

      if (!ipcApi?.cliChat) {
        throw new Error('CLI Chat IPC API not available')
      }

      // 创建临时会话（agent 模式支持工具调用）
      const createResult = await ipcApi.cliChat.createSession('agent', currentProjectPath!)
      if (!createResult.success || !createResult.sessionId) {
        throw new Error(createResult.error || 'Failed to create CLI session')
      }

      const sessionId = createResult.sessionId
      console.log('[FeishuBot] Created CLI session:', sessionId)

      // 收集 AI 回复内容
      let aiReply = ''
      let isComplete = false
      let hasError = false
      let errorMsg = ''
      const toolResults: Array<{ name: string; success: boolean; output: string; error?: string }> = []
      let lastActivityTime = Date.now()
      let doneCount = 0

      // 设置流式监听
      const unsubscribe = ipcApi.cliChat.onStreamChunk((_, data) => {
        if (data.sessionId !== sessionId) return

        const chunk = data.chunk
        lastActivityTime = Date.now()
        
        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              aiReply += chunk.content
            }
            break
          case 'tool_call':
            console.log('[FeishuBot] Tool call:', chunk.toolCall?.name)
            // 记录工具调用
            if (chunk.toolCall?.name) {
              toolResults.push({
                name: chunk.toolCall.name,
                success: false,
                output: '',
                error: '等待执行结果...'
              })
            }
            break
          case 'tool_result':
            console.log('[FeishuBot] Tool result received:', chunk.toolResult)
            // 更新最后一个工具调用结果
            if (toolResults.length > 0 && chunk.toolResult) {
              const lastTool = toolResults[toolResults.length - 1]
              lastTool.success = chunk.toolResult.success
              lastTool.output = chunk.toolResult.output
              lastTool.error = chunk.toolResult.error
            }
            break
          case 'done':
            doneCount++
            console.log(`[FeishuBot] Conversation complete (done #${doneCount})`)
            // 如果有工具调用且执行成功，继续等待 AI 的最终回复
            const hasSuccessfulTool = toolResults.some(t => t.success)
            if (!hasSuccessfulTool || doneCount >= 2) {
              // 没有成功执行的工具，或者已经收到第二个 done（AI 最终回复完成）
              isComplete = true
            }
            break
          case 'error':
            console.error('[FeishuBot] Stream error:', chunk.error)
            hasError = true
            errorMsg = chunk.error || 'Unknown error'
            break
        }
      })

      // 发送消息
      const sendResult = await ipcApi.cliChat.sendMessage(sessionId, content, undefined, model)
      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Failed to send message')
      }

      // 等待对话完成（最多等待 3 分钟）
      const startTime = Date.now()
      const maxWaitTime = 180000 // 3 minutes
      const activityTimeout = 30000 // 30 秒无活动则认为完成
      
      while (!isComplete && !hasError && Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // 如果 30 秒没有新活动，且至少收到过一个 done，则认为完成
        if (doneCount > 0 && Date.now() - lastActivityTime > activityTimeout) {
          console.log('[FeishuBot] No activity for 30s, considering complete')
          isComplete = true
        }
      }

      // 取消监听
      unsubscribe()

      // 停止会话
      await ipcApi.cliChat.stopSession(sessionId)

      if (hasError) {
        throw new Error(errorMsg)
      }

      if (!isComplete) {
        console.warn('[FeishuBot] Conversation timed out, using partial reply')
      }

      // 如果没有收到文本回复，但有工具执行结果，生成工具执行摘要
      if (!aiReply.trim() && toolResults.length > 0) {
        // 根据工具执行结果生成回复
        const successTools = toolResults.filter(t => t.success)
        const failedTools = toolResults.filter(t => !t.success)
        
        if (successTools.length > 0) {
          aiReply = `✅ 工具执行成功！\n\n`
          for (const tool of successTools) {
            aiReply += `**${tool.name}**:\n${tool.output}\n\n`
          }
        }
        
        if (failedTools.length > 0) {
          aiReply += `\n❌ 部分工具执行失败:\n\n`
          for (const tool of failedTools) {
            aiReply += `**${tool.name}**: ${tool.error || '未知错误'}\n`
          }
        }
      }
      
      // 如果仍然没有回复，使用默认消息
      if (!aiReply.trim()) {
        aiReply = '抱歉，我没有收到回复'
      }

      console.log('[FeishuBot] AI reply:', aiReply.substring(0, 200) + '...')

      // 发送回复到飞书
      if (window.api?.feishu) {
        let success = false
        let errorMsg = ''
        if (chatType === 'group' && messageId) {
          // 群聊中回复原消息
          const result = await window.api.feishu.replyMessage(aiReply, messageId, chatId, chatType as 'group' | 'p2p')
          success = result.success
          errorMsg = result.error || ''
          console.log('[FeishuBot] Reply sent to group message:', success, errorMsg)
        } else {
          // 私聊直接发送
          const result = await window.api.feishu.sendMessage(aiReply, chatId, chatType as 'group' | 'p2p')
          success = result.success
          errorMsg = result.error || ''
          console.log('[FeishuBot] Message sent to user:', success, errorMsg)
        }
        
        if (!success) {
          console.error('[FeishuBot] Failed to send message to Feishu:', errorMsg)
        }
      } else {
        console.error('[FeishuBot] Feishu API not available')
      }

      // 将飞书对话保存到"飞书专用对话"会话中
      const feishuSession = state.sessions.find(s => s.title === '飞书专用对话')
      
      // 构建新消息（使用与 Kilo 兼容的格式）
      const userMessage = { 
        id: `msg-${Date.now()}-user`,
        role: 'user', 
        content, 
        timestamp: Date.now(),
        mode: 'code' as const
      }
      const assistantMessage = { 
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant', 
        content: aiReply, 
        timestamp: Date.now(),
        mode: 'code' as const
      }
      
      console.log('[FeishuBot] Current project path:', currentProjectPath)
      console.log('[FeishuBot] Feishu session found:', feishuSession?.id, 'Title:', feishuSession?.title, 'MessageCount:', feishuSession?.messageCount)
      
      if (feishuSession) {
        // 如果已存在"飞书专用对话"会话，更新消息数并保存
        const updatedSession: Session = {
          ...feishuSession,
          messageCount: feishuSession.messageCount + 2
        }
        setSessions(state.sessions.map(s => s.id === feishuSession.id ? updatedSession : s))
        setLocalSessions(prev => prev.map(s => s.id === feishuSession.id ? updatedSession : s))
        
        // ✅ 修复：同步更新 kiloStore，确保 KiloPage 能显示飞书会话
        const kiloStore = useKiloStore.getState()
        const existingKiloSession = kiloStore.sessions.find(s => s.id === feishuSession.id)
        if (existingKiloSession) {
          kiloStore.updateSession(feishuSession.id, {
            messageCount: updatedSession.messageCount,
            updatedAt: Date.now()
          })
        } else {
          // 如果 kiloStore 中没有这个会话，添加它
          kiloStore.addSession({
            id: feishuSession.id,
            title: feishuSession.title || '飞书专用对话',
            createdAt: new Date(feishuSession.createdAt).getTime(),
            updatedAt: Date.now(),
            messageCount: updatedSession.messageCount,
            mode: 'code'
          })
        }
        
        // 持久化保存：先加载现有消息，再追加新消息
        if (window.api?.saveConversation && currentProjectPath) {
          try {
            console.log('[FeishuBot] Saving to session:', feishuSession.id, 'Project:', currentProjectPath)
            // 加载现有消息
            const loadResult = await window.api.loadConversation(currentProjectPath, feishuSession.id)
            console.log('[FeishuBot] Loaded existing messages:', loadResult.success, 'count:', loadResult.messages?.length || 0, 'Error:', loadResult.error)
            const existingMessages = loadResult.success && loadResult.messages ? loadResult.messages : []
            // 追加新消息并保存
            const allMessages = [...existingMessages, userMessage, assistantMessage]
            console.log('[FeishuBot] Saving messages:', allMessages.length, 'Existing:', existingMessages.length, 'New: 2')
            const saveResult = await window.api.saveConversation(currentProjectPath, feishuSession.id, allMessages, feishuSession.title)
            console.log('[FeishuBot] Save result:', saveResult.success, 'Session:', feishuSession.id, 'Total messages:', allMessages.length)
            
            // 触发事件通知 KiloPage 刷新会话列表
            window.dispatchEvent(new CustomEvent('feishu:session-updated', { detail: { sessionId: feishuSession.id } }))
          } catch (error) {
            console.error('[FeishuBot] Failed to save conversation:', error)
          }
        } else {
          console.warn('[FeishuBot] Cannot save conversation: projectPath is empty or saveConversation API not available')
        }
      } else {
        // 如果不存在，创建新的"飞书专用对话"会话
        const newSessionId = `feishu-session-${Date.now()}`
        const now = Date.now()
        const newSession: Session = {
          id: newSessionId,
          title: '飞书专用对话',
          createdAt: new Date().toISOString(),
          messageCount: 2,
          projectPath: currentProjectPath || undefined
        }
        addSession(newSession)
        
        // ✅ 修复：同时添加到 kiloStore，确保 KiloPage 能显示飞书会话
        const kiloStore = useKiloStore.getState()
        kiloStore.addSession({
          id: newSessionId,
          title: '飞书专用对话',
          createdAt: now,
          updatedAt: now,
          messageCount: 2,
          mode: 'code'
        })
        
        // 持久化保存新会话和消息
        if (window.api?.saveConversation && currentProjectPath) {
          try {
            await window.api.saveConversation(currentProjectPath, newSessionId, [userMessage, assistantMessage], '飞书专用对话')
            console.log('[FeishuBot] Created new session and saved messages:', newSessionId)
            
            // 触发事件通知 KiloPage 刷新会话列表
            window.dispatchEvent(new CustomEvent('feishu:session-updated', { detail: { sessionId: newSessionId } }))
          } catch (error) {
            console.error('[FeishuBot] Failed to save conversation:', error)
          }
        } else {
          console.warn('[FeishuBot] Cannot save conversation: projectPath is empty or saveConversation API not available')
        }
      }

      return aiReply
    } catch (error) {
      console.error('[FeishuBot] Error processing message:', error)
      const errorReply = `处理消息时出错: ${error instanceof Error ? error.message : '未知错误'}`
      
      // 发送错误回复
      if (window.api?.feishu) {
        await window.api.feishu.sendMessage(errorReply, chatId, chatType as 'group' | 'p2p')
      }
      
      // ✅ 修复：错误情况下也要保存对话历史到飞书专用对话
      const errorState = useStore.getState()
      const currentProjectPath = errorState.currentProjectPath
      const feishuSession = errorState.sessions.find(s => s.title === '飞书专用对话')
      
      // 构建消息
      const userMessage = { 
        id: `msg-${Date.now()}-user`,
        role: 'user', 
        content, 
        timestamp: Date.now(),
        mode: 'code' as const
      }
      const errorMessage = { 
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant', 
        content: errorReply, 
        timestamp: Date.now(),
        mode: 'code' as const
      }
      
      if (feishuSession) {
        // 更新会话消息计数
        const updatedSession: Session = {
          ...feishuSession,
          messageCount: feishuSession.messageCount + 2
        }
        setSessions(errorState.sessions.map(s => s.id === feishuSession.id ? updatedSession : s))
        setLocalSessions(prev => prev.map(s => s.id === feishuSession.id ? updatedSession : s))
        
        // 更新 kiloStore
        const kiloStore = useKiloStore.getState()
        kiloStore.updateSession(feishuSession.id, {
          messageCount: updatedSession.messageCount,
          updatedAt: Date.now()
        })
        
        // 持久化保存
        if (window.api?.saveConversation && currentProjectPath) {
          try {
            const loadResult = await window.api.loadConversation(currentProjectPath, feishuSession.id)
            const existingMessages = loadResult.success && loadResult.messages ? loadResult.messages : []
            const allMessages = [...existingMessages, userMessage, errorMessage]
            await window.api.saveConversation(currentProjectPath, feishuSession.id, allMessages, feishuSession.title)
            console.log('[FeishuBot] Error conversation saved:', feishuSession.id)
            window.dispatchEvent(new CustomEvent('feishu:session-updated', { detail: { sessionId: feishuSession.id } }))
          } catch (saveError) {
            console.error('[FeishuBot] Failed to save error conversation:', saveError)
          }
        }
      } else {
        // 创建新会话
        const newSessionId = `feishu-session-${Date.now()}`
        const now = Date.now()
        const newSession: Session = {
          id: newSessionId,
          title: '飞书专用对话',
          createdAt: new Date().toISOString(),
          messageCount: 2,
          projectPath: currentProjectPath || undefined
        }
        addSession(newSession)
        
        const kiloStore = useKiloStore.getState()
        kiloStore.addSession({
          id: newSessionId,
          title: '飞书专用对话',
          createdAt: now,
          updatedAt: now,
          messageCount: 2,
          mode: 'code'
        })
        
        if (window.api?.saveConversation && currentProjectPath) {
          try {
            await window.api.saveConversation(currentProjectPath, newSessionId, [userMessage, errorMessage], '飞书专用对话')
            console.log('[FeishuBot] Created new session for error:', newSessionId)
            window.dispatchEvent(new CustomEvent('feishu:session-updated', { detail: { sessionId: newSessionId } }))
          } catch (saveError) {
            console.error('[FeishuBot] Failed to save error conversation:', saveError)
          }
        }
      }
      
      return errorReply
    }
  }, [providers, model, addSession, projectPath])

  // 飞书消息监听 useEffect - 在 handleFeishuMessage 定义之后
  useEffect(() => {
    if (!window.api?.feishu) return

    // 监听飞书消息
    const unsubscribe = window.api.feishu.onMessage((_: unknown, event: any) => {
      console.log('[App] Received Feishu message:', event)
      const messageText = event.message?.content ? JSON.parse(event.message.content).text : ''
      const chatId = event.message?.chat_id
      const chatType = event.message?.chat_type
      const messageId = event.message?.message_id

      if (messageText && chatId) {
        // 使用 handleFeishuMessage 处理飞书消息（包含回复逻辑）
        handleFeishuMessage(messageText, chatId, chatType as 'group' | 'user' | 'p2p', messageId)
      }
    })

    // 监听状态变化
    const unsubscribeStatus = window.api.feishu.onStatusChange((_: unknown, status: any) => {
      console.log('[App] Feishu WebSocket status:', status)
    })

    return () => {
      unsubscribe()
      unsubscribeStatus()
    }
  }, [handleFeishuMessage])

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
    // 关闭设置后切换回之前的 Activity
    setActiveActivity(previousActivity)
  }

  // 处理飞书配置保存
  const handleFeishuSave = async (newConfig: FeishuConfig) => {
    setFeishuConfig(newConfig)
    updateFeishuConfig(newConfig)
    
    // 保存到 localStorage
    try {
      localStorage.setItem('feishuConfig', JSON.stringify(newConfig))
    } catch (error) {
      console.error('Failed to save Feishu config:', error)
    }
  }

  // Generate unique tab ID
  const generateTabId = useCallback(() => {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }, [])

  // Listen for git:openDiff event - open diff as a tab
  useEffect(() => {
    const handleOpenDiff = (event: CustomEvent<{ filePath: string; commitHash?: string; repoPath: string }>) => {
      const { filePath, commitHash, repoPath } = event.detail
      const fileName = filePath.split('/').pop() || filePath
      
      // Check if diff tab already exists for this file+commit
      const existingTab = tabs.find(tab => 
        tab.isDiff && tab.path === filePath && tab.diffCommitHash === commitHash
      )
      
      if (existingTab) {
        setActiveTabId(existingTab.id)
        return
      }
      
      // Create new diff tab
      const newTab: Tab = {
        id: generateTabId(),
        path: filePath,
        name: commitHash ? `${fileName} (${commitHash.substring(0, 7)})` : fileName,
        content: '',
        isDirty: false,
        isPreview: false,
        language: 'diff',
        isDiff: true,
        diffCommitHash: commitHash
      }
      
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)
    }
    
    window.addEventListener('git:openDiff', handleOpenDiff as EventListener)
    return () => {
      window.removeEventListener('git:openDiff', handleOpenDiff as EventListener)
    }
  }, [tabs, generateTabId])

  // Get file language from path (using unified language map)
  const getFileLanguage = useCallback((path: string): string => {
    return getLanguageFromPath(path)
  }, [])

  // Jump to line in editor
  const goToLine = useCallback((lineNumber: number) => {
    if (editorRef.current) {
      try {
        // Reveal the line in the center of the viewport
        editorRef.current.revealLineInCenter(lineNumber)
        // Set cursor position to the line
        editorRef.current.setPosition({ lineNumber, column: 1 })
        // Focus the editor
        editorRef.current.focus()
        console.log(`[App] Jumped to line ${lineNumber}`)
      } catch (error) {
        console.error('[App] Failed to jump to line:', error)
      }
    }
  }, [])

  // Open file in tab
  const openFile = useCallback((path: string, content: string) => {
    console.log('[App] openFile called:', path)
    
    // Check if file is already open
    const existingTab = tabs.find(tab => tab.path === path)
    if (existingTab) {
      console.log('[App] File already open, switching to tab:', existingTab.id)
      setActiveTabId(existingTab.id)
      setSelectedFilePath(path)
      return
    }

    // Create new tab
    const fileName = path.split('/').pop() || path
    console.log('[App] Creating new tab:', fileName)
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
    console.log('[App] New tab created:', newTab.id)
  }, [tabs, generateTabId, getFileLanguage])

  // Handle file selection from JackFileExplorer
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
    // Clean up the content ref for this tab
    latestTabContentRef.current.delete(tabId)
    
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
    // Clear all content refs
    latestTabContentRef.current.clear()
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

  // Save workspace state when tabs, activeTabId, selectedFilePath, or activeActivity changes
  // Use a ref to track the last saved state to avoid unnecessary saves
  const lastSavedTabsRef = useRef<string>('')
  const lastSavedProjectRef = useRef<string | null>(null)
  // Refs to always have access to latest state for beforeunload
  const latestTabsRef = useRef<Tab[]>(tabs)
  const latestActiveTabIdRef = useRef<string | null>(activeTabId)
  const latestSelectedFilePathRef = useRef<string | null>(selectedFilePath)
  const latestActiveActivityRef = useRef<ActivityBarItem>(activeActivity)

  // Update refs whenever state changes
  useEffect(() => {
    latestTabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    latestActiveTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    latestSelectedFilePathRef.current = selectedFilePath
  }, [selectedFilePath])

  useEffect(() => {
    latestActiveActivityRef.current = activeActivity
  }, [activeActivity])

  useEffect(() => {
    if (!projectPath) return

    // CRITICAL: Check if projectPath matches the ref (which is updated immediately in handleProjectPathChange)
    // This prevents saving when projectPath state hasn't caught up with the ref yet
    if (projectPath !== currentProjectPathRef.current) {
      console.log('[App] Project path mismatch, skipping save. State:', projectPath, 'Ref:', currentProjectPathRef.current)
      return
    }

    // Create a signature of current state
    const tabsSignature = tabs.map(t => t.path).join(',')
    const stateSignature = `${projectPath}|${tabsSignature}|${activeTabId}|${selectedFilePath}`

    // Skip if state hasn't changed
    if (stateSignature === lastSavedTabsRef.current) {
      return
    }

    // Skip if project changed (prevents saving old tabs to new project)
    // This happens when projectPath updates before tabs update
    if (projectPath !== lastSavedProjectRef.current && lastSavedProjectRef.current !== null) {
      console.log('[App] Project changed, skipping save until tabs update. Current:', projectPath, 'Last:', lastSavedProjectRef.current)
      return
    }

    // Save tabs state
    const openTabs = tabs.map(tab => ({
      path: tab.path,
      name: tab.name,
      type: tab.language === 'browser' ? 'browser' : 'file' as 'file' | 'diff' | 'browser',
      browserUrl: tab.browserUrl
    }))

    // Always save workspace state (even when empty, to clear previous state)
    saveWorkspaceState(projectPath, {
      expandedPaths: [], // Will be populated by JackFileExplorer
      openTabs,
      activeTabId,
      selectedFilePath,
      activeActivity
    })

    // Update refs
    lastSavedTabsRef.current = stateSignature
    lastSavedProjectRef.current = projectPath

    console.log('[App] Workspace state saved:', openTabs.length, 'tabs, activeTab:', activeTabId)
  }, [projectPath, tabs, activeTabId, selectedFilePath, activeActivity])

  // Handle open file in browser
  const handleOpenInBrowser = useCallback((filePath: string) => {
    console.log('[App] Opening file in browser:', filePath)
    
    // 检查是否为 HTML 文件
    const isHtmlFile = /\.(html|htm)$/i.test(filePath)
    
    if (isHtmlFile) {
      // 对于 HTML 文件，使用 file:// 协议打开
      const fileUrl = `file://${filePath}`
      window.open(fileUrl, '_blank')
    } else {
      // 对于其他文件，可以显示一个提示或尝试用其他方式打开
      alert(`无法在浏览器中打开非 HTML 文件: ${filePath}\n仅支持 .html 和 .htm 文件`)
    }
  }, [])

  // Toggle browser view - 创建新的浏览器标签
  const handleToggleBrowserView = useCallback(() => {
    const browserTabId = `browser-${Date.now()}`
    const newTab: Tab = {
      id: browserTabId,
      path: `browser://${browserTabId}`,
      name: '浏览器',
      content: '',
      isDirty: false,
      isBrowser: true,
      browserUrl: ''
    }
    
    setTabs(prev => [...prev, newTab])
    setActiveTabId(browserTabId)
  }, [])

  // Open URL in browser tab - 从终端点击URL打开
  const handleOpenUrlInBrowser = useCallback((url: string) => {
    const browserTabId = `browser-${Date.now()}`
    const newTab: Tab = {
      id: browserTabId,
      path: `browser://${browserTabId}`,
      name: '浏览器',
      content: '',
      isDirty: false,
      isBrowser: true,
      browserUrl: url
    }
    
    setTabs(prev => [...prev, newTab])
    setActiveTabId(browserTabId)
  }, [])

  // Handle tab content change
  const handleTabContentChange = useCallback((tabId: string, content: string) => {
    // Update the ref with latest content for menu save
    latestTabContentRef.current.set(tabId, content)
    console.log('[App] handleTabContentChange called, tabId:', tabId, 'content length:', content.length)
    setTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, content, isDirty: true, isPreview: false } : tab
    ))
  }, [])

  // Handle tab save via IPC
  const handleTabSave = useCallback(async (tabId: string, content: string): Promise<boolean> => {
    console.log('[App] handleTabSave called, tabId:', tabId, 'content length:', content?.length)
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return false

    // Prevent saving undefined or null content
    if (content === undefined || content === null) {
      console.error('[App] handleTabSave - content is undefined or null, aborting save')
      return false
    }

    // Prevent saving empty content if file originally had content
    // This prevents accidental file truncation
    if (content === '' && tab.content && tab.content.length > 0) {
      console.error('[App] handleTabSave - attempting to save empty content when file has content, aborting save')
      return false
    }

    try {
      // 使用 IPC 写入文件
      const api = window.api as unknown as { 
        executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
      }
      if (api?.executeTool) {
        const result = await api.executeTool(
          `save-file-${Date.now()}`,
          'write_file',
          { path: tab.path, content },
          projectPath || '/'
        )
        if (result.success) {
          setTabs(prev => prev.map(t => 
            t.id === tabId ? { ...t, content, isDirty: false } : t
          ))
          // Clear the ref since content is now saved and in sync
          latestTabContentRef.current.delete(tabId)
          // Trigger file operation event to refresh Git status and file tree
          window.dispatchEvent(new CustomEvent('file-operation-completed'))
          return true
        }
      }
    } catch (error) {
      console.error('Failed to save file:', error)
    }
    return false
  }, [tabs, projectPath])

  // Get active tab - must be before file menu event listeners
  const activeTab = tabs.find(t => t.id === activeTabId) || null

  // File menu event listeners - must be after function definitions
  useEffect(() => {
    // New Session
    const unsubNewSession = window.api?.onNewSession?.(() => {
      handleNewSession()
    })
    
    // New File
    const unsubFileNew = window.api?.onFileNew?.(() => {
      const newFileName = `untitled-${Date.now()}.txt`
      openFile(newFileName, '')
    })
    
    // Open File
    const unsubFileOpen = window.api?.onFileOpen?.(async () => {
      try {
        const filePath = await window.api?.openFile()
        if (filePath) {
          // 使用 IPC 读取文件
          const api = window.api as unknown as { 
            executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
          }
          if (api?.executeTool) {
            const result = await api.executeTool(
              `open-file-${Date.now()}`,
              'read_file',
              { path: filePath },
              projectPath || '/'
            )
            if (result.success) {
              openFile(filePath, result.output || '')
            }
          }
        }
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    })
    
    // Open Folder
    const unsubFolderOpen = window.api?.onFolderOpen?.(async () => {
      try {
        const folderPath = await window.api?.selectFolder()
        if (folderPath) {
          // Use handleProjectPathChange to properly handle project switch
          handleProjectPathChange(folderPath)
        }
      } catch (error) {
        console.error('Failed to open folder:', error)
      }
    })
    
    // Save File
    const unsubFileSave = window.api?.onFileSave?.(() => {
      console.log('[App] Menu save triggered, activeTabId:', activeTabId)
      if (activeTabId) {
        const tab = tabs.find(t => t.id === activeTabId)
        const refContent = latestTabContentRef.current.get(activeTabId)
        console.log('[App] Menu save - tab.isDirty:', tab?.isDirty, 'ref content length:', refContent?.length, 'tab content length:', tab?.content?.length)
        if (tab && tab.isDirty) {
          // Use latest content from ref to ensure we save the most recent edits
          const latestContent = refContent || tab.content || ''
          console.log('[App] Menu save - using content length:', latestContent?.length)
          handleTabSave(tab.id, latestContent)
        }
      }
    })
    
    // Save As
    const unsubFileSaveAs = window.api?.onFileSaveAs?.(async () => {
      if (!activeTab) return
      
      try {
        // Show save dialog
        const result = await window.api?.showSaveDialog({
          defaultPath: activeTab.path,
          title: 'Save As',
          buttonLabel: 'Save'
        })
        
        if (result && !result.canceled && result.filePath) {
          // Write to new file via IPC
          const api = window.api as unknown as { 
            executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
          }
          if (api?.executeTool) {
            const writeResult = await api.executeTool(
              `save-as-${Date.now()}`,
              'write_file',
              { path: result.filePath, content: activeTab.content },
              projectPath || '/'
            )
            
            if (writeResult.success) {
              // Update tab with new path
              setTabs(prev => prev.map(t => 
                t.id === activeTabId ? { 
                  ...t, 
                  path: result.filePath!, 
                  name: result.filePath!.split('/').pop()!,
                  isDirty: false 
                } : t
              ))
              setSelectedFilePath(result.filePath!)
            }
          }
        }
      } catch (error) {
        console.error('Failed to save as:', error)
      }
    })
    
    // Refresh File Tree
    const unsubFileRefresh = window.api?.onFileRefresh?.(() => {
      // Dispatch custom event to JackFileExplorer for refresh
      window.dispatchEvent(new CustomEvent('file-operation-completed'))
    })
    
    // Listen for file system changes (for auto-refresh opened files)
    const unsubFileChange = window.api?.onFileChange?.((_event, data: { eventType: string; filename: string; dirPath: string }) => {
      console.log('[App] === File Change Event Received ===')
      console.log('[App] Event Type:', data.eventType)
      console.log('[App] Filename:', data.filename)
      console.log('[App] DirPath:', data.dirPath)
      console.log('[App] Current tabs count:', tabs.length)
      console.log('[App] Current tab paths:', tabs.map(t => t.path))

      // Try both path separators to ensure compatibility
      const changedFilePathUnix = `${data.dirPath}/${data.filename}`
      const changedFilePathWin = `${data.dirPath}\\${data.filename}`

      console.log('[App] Looking for file:', changedFilePathUnix)

      // Check if the changed file is currently open in a tab
      const openTab = tabs.find(tab => {
        const match = tab.path === changedFilePathUnix || tab.path === changedFilePathWin
        if (match) {
          console.log('[App] ✓ Found matching tab:', tab.path)
        }
        return match
      })

      // Handle 'rename' event - new file created
      if (data.eventType === 'rename') {
        console.log('[App] File rename/create event detected')
        // Check if it's a new file (not currently open)
        if (!openTab) {
          console.log('[App] New file detected, auto-opening:', changedFilePathUnix)
          // Auto-open the new file via IPC
          const api = window.api as unknown as { 
            executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
          }
          if (api?.executeTool) {
            api.executeTool(
              `auto-open-${Date.now()}`,
              'read_file',
              { path: changedFilePathUnix },
              projectPath || '/'
            ).then(fileData => {
              if (fileData.success && fileData.output !== undefined) {
                console.log('[App] Auto-opening new file with content length:', fileData.output.length)
                openFile(changedFilePathUnix, fileData.output)
              }
            }).catch((err: Error) => {
              console.error('[App] Failed to auto-open new file:', err)
            })
          }
        }
        return
      }

      // Only handle 'change' events for existing open files
      if (data.eventType !== 'change') {
        console.log('[App] Ignoring non-change event:', data.eventType)
        return
      }

      if (!openTab) {
        console.log('[App] ✗ No matching tab found for changed file')
        return
      }

      console.log('[App] Opened file changed, refreshing content:', changedFilePathUnix)
      console.log('[App] Current tab content length:', openTab.content.length)

      // Read the latest content from disk via IPC
      const api = window.api as unknown as { 
        executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
      }
      if (api?.executeTool) {
        api.executeTool(
          `refresh-file-${Date.now()}`,
          'read_file',
          { path: changedFilePathUnix },
          projectPath || '/'
        ).then(fileData => {
          console.log('[App] File read result via IPC:', fileData.success)
          const fileContent = fileData.output
          console.log('[App] File read result:', {
            hasContent: fileContent !== undefined,
            contentLength: fileContent?.length || 0,
            currentContentLength: openTab.content.length,
            isDifferent: fileContent !== openTab.content
          })
          if (fileContent !== undefined && fileContent !== openTab.content) {
            console.log('[App] ✓ Content is different, updating tab...')

            // Update the tab content with animation flag
            setTabs(prev => {
              console.log('[App] Updating tabs state')
              return prev.map(tab => {
                if (tab.id === openTab.id) {
                  console.log('[App] Updated tab:', {
                    id: tab.id,
                    oldContentLength: tab.content.length,
                    newContentLength: fileContent.length
                  })
                  return { ...tab, content: fileContent, isDirty: false, lastModified: Date.now() }
                }
                return tab
              })
            })

            // If this is the active tab, also update the editor
            if (activeTabId === openTab.id) {
              console.log('[App] ✓ This is the active tab, editor should auto-update')
              // Dispatch a custom event to notify FileViewer of external change
              window.dispatchEvent(new CustomEvent('file-content-externally-changed', {
                detail: { path: changedFilePathUnix, content: fileContent }
              }))
            }
          } else {
            console.log('[App] ✗ Content is the same, no update needed')
          }
        }).catch((err: Error) => {
          console.error('[App] ✗ Failed to read updated file:', err)
        })
      }
    })

    return () => {
      unsubNewSession?.()
      unsubFileNew?.()
      unsubFileOpen?.()
      unsubFolderOpen?.()
      unsubFileSave?.()
      unsubFileSaveAs?.()
      unsubFileRefresh?.()
      unsubFileChange?.()
    }
  }, [activeTabId, tabs, activeTab, openFile, handleTabSave, handleNewSession, projectPath, setProjectPath, setTabs])

  // Handle file renamed from JackFileExplorer
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

  // Handle file deleted from JackFileExplorer
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

  // Register commands for Command Palette
  const paletteCommands: Command[] = [
    {
      id: 'file.new',
      label: 'New File',
      description: 'Create a new file',
      shortcut: 'Ctrl+N',
      category: 'File',
      execute: () => console.log('New file')
    },
    {
      id: 'file.open',
      label: 'Open File',
      description: 'Open an existing file',
      shortcut: 'Ctrl+O',
      category: 'File',
      execute: () => console.log('Open file')
    },
    {
      id: 'file.save',
      label: 'Save',
      description: 'Save current file',
      shortcut: 'Ctrl+S',
      category: 'File',
      execute: async () => {
        if (activeTab && activeTab.isDirty) {
          // Use latest content from ref to ensure we save the most recent edits
          const latestContent = latestTabContentRef.current.get(activeTab.id) || activeTab.content || ''
          await handleTabSave(activeTab.id, latestContent)
        }
      }
    },
    {
      id: 'view.toggleTerminal',
      label: 'Toggle Terminal',
      description: 'Show/hide terminal panel',
      shortcut: 'Ctrl+`',
      category: 'View',
      execute: () => setShowTerminal(prev => !prev)
    },
    {
      id: 'view.toggleSearch',
      label: 'Toggle Search Panel',
      description: 'Show/hide search panel',
      shortcut: 'Ctrl+Shift+F',
      category: 'View',
      execute: () => setActiveActivity('search')
    },
    {
      id: 'view.toggleExplorer',
      label: 'Toggle Explorer',
      description: 'Show/hide file explorer',
      shortcut: 'Ctrl+Shift+E',
      category: 'View',
      execute: () => setActiveActivity('explorer')
    },
    {
      id: 'settings.open',
      label: 'Open Settings',
      description: 'Open settings modal',
      shortcut: 'Ctrl+,',
      category: 'Preferences',
      execute: () => setShowSettings(true)
    },
    {
      id: 'editor.splitRight',
      label: 'Split Editor Right',
      description: 'Split editor vertically',
      shortcut: 'Ctrl+\\',
      category: 'Editor',
      execute: () => console.log('Split right')
    },
    {
      id: 'editor.splitDown',
      label: 'Split Editor Down',
      description: 'Split editor horizontally',
      shortcut: 'Ctrl+K Ctrl+\\',
      category: 'Editor',
      execute: () => console.log('Split down')
    }
  ]

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+P or Cmd+Shift+P: Command Palette
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setShowCommandPalette(prev => !prev)
        return
      }

      // Escape: Close command palette
      if (e.key === 'Escape' && showCommandPalette) {
        e.preventDefault()
        setShowCommandPalette(false)
        return
      }

      // Ctrl+,: Settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
        return
      }

      // Ctrl+`: Toggle terminal
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        setShowTerminal(prev => !prev)
        return
      }

      // Ctrl+Shift+E: Explorer
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        setActiveActivity('explorer')
        return
      }

      // Ctrl+Shift+F: Search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setActiveActivity('search')
        return
      }

      // Ctrl+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeTab && activeTab.isDirty) {
          // Use latest content from ref to ensure we save the most recent edits
          const latestContent = latestTabContentRef.current.get(activeTab.id) || activeTab.content || ''
          handleTabSave(activeTab.id, latestContent)
        }
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showCommandPalette, activeTab, handleTabSave])

  return (
    <div className="app-container">
      <div className="app-main-wrapper">
        {/* Custom Title Bar - draggable area for window management */}
        <TitleBar />
        
        {/* Top area: ActivityBar + Main Content */}
        <div className="app-top-area">
          {/* Activity Bar - VSCode style left icon navigation */}
          <ActivityBar
            activeItem={activeActivity}
            onItemClick={handleActivityClick}
          />

          {/* Main Content Area */}
          <main className="main-content three-column-layout">
            {/* Settings Page - 占满整个 main-content 区域，使用 CSS 控制显示 */}
            <div 
              className="settings-full-page" 
              style={{ display: activeActivity === 'settings' ? 'flex' : 'none' }}
            >
              <SettingsModal
                apiKey={apiKey}
                model={model}
                defaultModel={defaultModel}
                permissionMode={permissionMode}
                providers={providers}
                feishuConfig={feishuConfig}
                syncStatus={syncStatus}
                onSave={handleSettingsSave}
                onSaveFeishu={handleFeishuSave}
                onClose={handleSettingsClose}
              />
            </div>

            {/* Left: Sidebar (File Explorer or Search) - 可调整宽度 */}
            {(activeActivity === 'explorer' || activeActivity === 'search' || activeActivity === 'git' || activeActivity === 'reminders' || activeActivity === 'mcp-skill') && (
              <>
                <div 
                  className="sidebar-panel-container" 
                  style={{ 
                    display: 'flex',
                    width: leftPanelWidth,
                    minWidth: MIN_LEFT_WIDTH,
                    maxWidth: MAX_LEFT_WIDTH
                  }}
                >
                  {activeActivity === 'explorer' && (
                    <JackFileExplorer
                      projectPath={projectPath}
                      onFileSelect={handleFileSelect}
                      selectedPath={selectedFilePath}
                      onRootPathChange={handleProjectPathChange}
                      onFileRenamed={handleFileRenamed}
                      onFileDeleted={handleFileDeleted}
                    />
                  )}
                  {activeActivity === 'search' && (
                    <SearchPanel
                      projectPath={projectPath}
                      onFileClick={(filePath, line) => {
                        // 打开文件并跳转到指定行
                        console.log('[App] onFileClick called with:', filePath, line)
                        const existingTab = tabs.find(tab => tab.path === filePath)
                        if (existingTab) {
                          console.log('[App] Tab already exists, switching to it')
                          setActiveTabId(existingTab.id)
                          // 延迟跳转，等待标签页切换完成
                          setTimeout(() => goToLine(line), 100)
                        } else {
                          console.log('[App] Opening new file')
                          // 读取文件内容 via IPC
                          const api = window.api as unknown as { 
                            executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
                          }
                          if (api?.executeTool) {
                            api.executeTool(
                              `open-search-result-${Date.now()}`,
                              'read_file',
                              { path: filePath },
                              projectPath || '/'
                            ).then(data => {
                              if (data.success && data.output !== undefined) {
                                console.log('[App] File loaded, opening in editor')
                                openFile(filePath, data.output)
                                // 延迟跳转，等待编辑器渲染完成
                                setTimeout(() => goToLine(line), 200)
                              }
                            }).catch((err: Error) => console.error('Failed to read file:', err))
                          }
                        }
                      }}
                    />
                  )}
                  {activeActivity === 'git' && <GitPanel repoPath={projectPath} openFile={openFile} />}
                  {activeActivity === 'reminders' && <ReminderPanel />}
                  {activeActivity === 'mcp-skill' && <MCPSkillPanel />}
                </div>
                {/* Left Resizer */}
                <Resizer
                  direction="horizontal"
                  onResize={(delta) => {
                    const newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, leftPanelWidth + delta))
                    setLeftPanelWidth(newWidth)
                  }}
                />
              </>
            )}

            {/* Center: File Tabs + File Viewer + Terminal - 使用 CSS 控制在设置页面时隐藏 */}
            <div className="center-column" style={{ display: activeActivity === 'settings' ? 'none' : 'flex' }}>
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
                onOpenInBrowser={handleOpenInBrowser}
                onToggleBrowserView={handleToggleBrowserView}
              />
              
              {/* File Viewer / Diff Viewer / Browser View */}
              <div className="file-viewer-container">
                {activeTab?.isDiff ? (
                  <DiffViewer
                    filePath={activeTab.path}
                    commitHash={activeTab.diffCommitHash}
                    repoPath={projectPath || ''}
                    onClose={() => handleTabClose(activeTab.id)}
                  />
                ) : activeTab?.isBrowser ? (
                  <BrowserView 
                    key={activeTab.id}
                    initialUrl={activeTab.browserUrl || ''}
                    onClose={() => handleTabClose(activeTab.id)}
                    onUrlChange={(url) => {
                      // 更新浏览器标签的 URL
                      setTabs(prev => prev.map(tab => 
                        tab.id === activeTab.id ? { ...tab, browserUrl: url } : tab
                      ))
                    }}
                  />
                ) : activeTab ? (
                  <FileViewer
                    key={activeTab.id}
                    tab={activeTab}
                    onContentChange={handleTabContentChange}
                    onSave={handleTabSave}
                    rootPath={projectPath || undefined}
                    onCursorPositionChange={setCursorPosition}
                    onEditorMount={(editor) => {
                      editorRef.current = editor
                      console.log('[App] Editor mounted')
                    }}
                  />
                ) : null}
              </div>
              <Terminal 
                ref={terminalRef} 
                isVisible={showTerminal} 
                projectPath={projectPath}
                onOpenUrl={handleOpenUrlInBrowser}
              />
            </div>

            {/* Right Resizer */}
            {activeActivity !== 'settings' && (
              <Resizer
                direction="horizontal"
                onResize={(delta) => {
                  const newWidth = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, rightPanelWidth - delta))
                  setRightPanelWidth(newWidth)
                }}
              />
            )}

            {/* Right: Chat Area - Kilo Style - 可调整宽度 */}
            <div 
              className="right-column" 
              style={{ 
                display: activeActivity === 'settings' ? 'none' : 'flex',
                width: rightPanelWidth,
                minWidth: MIN_RIGHT_WIDTH,
                maxWidth: MAX_RIGHT_WIDTH,
                flex: '0 0 auto'
              }}
            >
              <KiloPage 
                apiKey={apiKey}
                model={model}
                providers={providers}
                projectPath={projectPath || undefined}
                onModelChange={setModel}
                onOpenUrl={handleOpenUrlInBrowser}
              />
            </div>
          </main>
        </div>



            {/* Command Palette */}
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          commands={paletteCommands}
        />

        {/* File Write Status Indicator */}
        <FileWriteIndicatorStatus />


      </div>
    </div>
  )
}

// File write status indicator component
function FileWriteIndicatorStatus() {
  const { status } = useFileWriteStatus()
  return <FileWriteIndicator status={status} />
}

export default App