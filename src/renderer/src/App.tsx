/// <reference types="./env" />
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ProviderConfig, type Session, type Step, type ImageContent, type FeishuConfig, type SyncStatus } from './store'
import { useKiloStore } from './store/kiloStore'
import { v4 as uuidv4 } from 'uuid'
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
import FeishuPanel from './components/FeishuPanel'
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
import './styles/index.css'
import './styles/completion.css'
import './styles/resizer.css'
import { getLanguageFromPath } from './utils/languageMap'
import { saveWorkspaceState, loadWorkspaceState } from './utils/workspaceState'
import { parseToolCalls } from './utils/toolParser'

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
          commands = await api.getCommands()
        }
        
        if (api?.getTools) {
          tools = await api.getTools()
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
        const api = window.api as unknown as { getConfig?: () => Promise<{
          apiKey: string
          model: string
          defaultModel: string
          permissionMode: string
          providers: any[]
        }> }
        
        if (api?.getConfig) {
          const config = await api.getConfig()
          
          if (config) {
            setApiKey(config.apiKey || '')
            setModel(config.model || '')
            setDefaultModel(config.defaultModel || '')
            setPermissionMode(config.permissionMode || 'workspace-write')
            setProviders(config.providers || [])
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
      return cachedProjectContext
    }

    try {
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

    // Save current project state before switching
    // Use refs to get the latest state, not the stale closure values
    // Fallback to projectPath state if ref is not set (e.g., first time opening folder)
    const currentPath = currentProjectPathRef.current || projectPath

    if (currentPath && currentPath !== newPath) {
      console.log('[handleProjectPathChange] Saving current project state:', currentPath)
      const openTabs = latestTabsRef.current.map(tab => ({
        path: tab.path,
        name: tab.name,
        type: tab.language === 'browser' ? 'browser' : 'file' as 'file' | 'diff' | 'browser',
        browserUrl: tab.browserUrl
      }))
      saveWorkspaceState(currentPath, {
        expandedPaths: [],
        openTabs,
        activeTabId: latestActiveTabIdRef.current,
        selectedFilePath: latestSelectedFilePathRef.current,
        activeActivity: latestActiveActivityRef.current
      })
    } else {
    }

    // Reset the saved state refs to prevent auto-save from saving old tabs to new project
    // This is crucial: we reset lastSavedProjectRef so the effect will skip saving
    // until both projectPath and tabs have been updated
    lastSavedProjectRef.current = null

    // 先清空当前会话和消息，防止旧消息被保存到新项目
    clearMessages()
    setLocalSessions([])
    setSessions([]) // 清空 mainStore 的会话，避免显示其他项目的会话
    
    // 清空 kiloStore 的会话，避免显示其他项目的会话
    const kiloStore = useKiloStore.getState()
    kiloStore.clearAllSessions()
    kiloStore.setCurrentSession(null)
    kiloStore.clearMessages()

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
    
    // Always clear tabs first, then restore if there's saved state
    // This ensures old project tabs are cleared even if new project has no saved state
    if (!workspaceState || !workspaceState.openTabs || workspaceState.openTabs.length === 0) {
      console.log('[handleProjectPathChange] No saved tabs for this project, ensuring tabs are cleared')
      setTabs([])
      setActiveTabId(null)
      setSelectedFilePath(null)
    }
    
    if (workspaceState) {
      
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
        
        const restoredTabs: Tab[] = []
        // Map to track old ID -> new ID for active tab restoration
        const idMapping: Map<string, string> = new Map()
        
        for (const savedTab of workspaceState.openTabs) {
          try {
            if (savedTab.type === 'file' && savedTab.path) {
              // Try to read file content
              const api = window.api as any
              if (api?.fsReadFile) {
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
            }
          } catch (error) {
            console.error('[handleProjectPathChange] Failed to restore tab:', savedTab, error)
          }
        }
        
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
              } else {
                setActiveTabId(restoredTabs[0].id)
                setSelectedFilePath(restoredTabs[0].path)
              }
            } else {
              setActiveTabId(restoredTabs[0].id)
              setSelectedFilePath(restoredTabs[0].path)
            }
          } else {
            setActiveTabId(restoredTabs[0].id)
            setSelectedFilePath(restoredTabs[0].path)
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

    try {
      // TRAE风格：从本地存储加载会话列表
      console.log('[handleProjectPathChange] Loading sessions for:', newPath)
      if (window.api?.listSessions) {
        const result = await window.api.listSessions(newPath)
        console.log('[handleProjectPathChange] listSessions result:', result)
        if (result.success && result.sessions) {
          // 按创建时间排序（由近到远）
          const sortedSessions = result.sessions.sort((a: any, b: any) => {
            const timeA = new Date(a.createdAt || a.updatedAt).getTime()
            const timeB = new Date(b.createdAt || b.updatedAt).getTime()
            return timeB - timeA // 降序，最新的在前
          })
          
          const loadedSessions = sortedSessions.map((s: { id: string; title: string; updatedAt: string; createdAt?: string; messageCount: number }) => ({
            id: s.id,
            createdAt: s.createdAt || s.updatedAt,
            messageCount: s.messageCount,
            projectPath: newPath,
            title: s.title
          }))
          setLocalSessions(loadedSessions)
          setSessions(loadedSessions)
          
          // 同时同步会话到 kiloStore
          const kiloStore = useKiloStore.getState()
          kiloStore.clearAllSessions()
          sortedSessions.forEach((s: any) => {
            const createdAtTime = new Date(s.createdAt || s.updatedAt).getTime()
            kiloStore.addSession({
              id: s.id,
              title: s.title,
              createdAt: createdAtTime,
              updatedAt: new Date(s.updatedAt).getTime(),
              messageCount: s.messageCount,
              mode: 'code' as any
            })
          })
          
          // 如果有会话，加载最新的一个
          if (loadedSessions.length > 0) {
            const latestSession = loadedSessions[0]
            console.log('[handleProjectPathChange] Selecting latest session:', latestSession.id)
            selectSession(latestSession.id)
            
            // 同时设置 kiloStore 的当前会话
            const kiloStore = useKiloStore.getState()
            kiloStore.setCurrentSession(latestSession.id)
            
            // 加载消息
            try {
              console.log('[handleProjectPathChange] Loading conversation for session:', latestSession.id)
              const msgResult = await window.api.loadConversation(newPath, latestSession.id)
              console.log('[handleProjectPathChange] loadConversation result:', msgResult)
              if (msgResult.success && msgResult.messages) {
                console.log('[handleProjectPathChange] Setting messages, count:', msgResult.messages.length)
                setMessages(msgResult.messages)
                
                // 同时同步到 kiloStore，确保 KiloPage 能显示消息
                kiloStore.clearMessages()
                msgResult.messages.forEach((msg: any) => {
                  kiloStore.addMessage({
                    id: msg.id || uuidv4(),
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp || Date.now(),
                    mode: msg.mode || 'code',
                    blocks: msg.blocks,
                    toolCalls: msg.toolCalls,
                    reasoning: msg.reasoning,
                    isStreaming: false,
                    usage: msg.usage,
                    images: msg.images
                  })
                })
              } else {
                console.log('[handleProjectPathChange] No messages in conversation')
                clearMessages()
                kiloStore.clearMessages()
              }
            } catch (err) {
              // 会话文件可能不存在，清空消息
              console.log('[handleProjectPathChange] Failed to load conversation, clearing messages:', err)
              clearMessages()
            }
          } else {
            // 没有会话，不自动创建，等待用户主动创建
            console.log('[handleProjectPathChange] No sessions found, waiting for user to create one')
            selectSession('')
            clearMessages()
          }
        } else {
          // 加载失败，不自动创建
          console.log('[handleProjectPathChange] Failed to load sessions, waiting for user to create one')
          selectSession('')
          clearMessages()
        }
      } else {
        // API不可用，不自动创建
        console.log('[handleProjectPathChange] API not available, waiting for user to create one')
        selectSession('')
        clearMessages()
      }
    } catch (error) {
      console.error('[handleProjectPathChange] Error:', error)
      // 出错时不自动创建会话
      selectSession('')
      clearMessages()
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

  // 注意：自动保存已移除，改为在 AI 回复完成后统一保存
  // 保存逻辑现在在 useUnifiedConversation 的 sendMessage 中处理

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
    } catch (error) {
      console.error('Failed to create new session:', error)
    }
  }, [addSession, selectSession, clearMessages])


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

  // ==================== 飞书机器人消息处理（已迁移到 FeishuPanel） ====================
  // 旧版本飞书消息处理已删除，新版本由 FeishuPanel 组件处理

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
    const handleOpenDiff = (event: CustomEvent<{ filePath: string; commitHash?: string; repoPath: string; diffContent?: string }>) => {
      const { filePath, commitHash, repoPath, diffContent } = event.detail
      console.log('[App] Received git:openDiff event:', { filePath, commitHash, repoPath, diffContentLength: diffContent?.length })
      
      const fileName = filePath.split('/').pop() || filePath
      
      // Check if diff tab already exists for this file+commit
      const existingTab = tabs.find(tab => 
        tab.isDiff && tab.path === filePath && tab.diffCommitHash === commitHash
      )
      
      if (existingTab) {
        console.log('[App] Diff tab already exists:', existingTab.id)
        setActiveTabId(existingTab.id)
        return
      }
      
      // Create new diff tab
      const newTab: Tab = {
        id: generateTabId(),
        path: filePath,
        name: commitHash ? `${fileName} (${commitHash.substring(0, 7)})` : fileName,
        content: diffContent || '',
        isDirty: false,
        isPreview: false,
        language: 'diff',
        isDiff: true,
        diffCommitHash: commitHash
      }
      
      console.log('[App] Creating new diff tab:', newTab)
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

            {/* Feishu Panel - 占据整个工作区（除了ActivityBar） */}
            {activeActivity === 'feishu' && (
              <div className="feishu-full-container" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <FeishuPanel 
                  apiKey={apiKey}
                  model={model}
                  providers={providers}
                  projectPath={projectPath || undefined}
                  onModelChange={setModel}
                />
              </div>
            )}

            {/* Center: File Tabs + File Viewer + Terminal - 使用 CSS 控制在设置页面或飞书页面时隐藏 */}
            <div className="center-column" style={{ display: activeActivity === 'settings' || activeActivity === 'feishu' ? 'none' : 'flex' }}>
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
            {activeActivity !== 'settings' && activeActivity !== 'feishu' && (
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
                display: activeActivity === 'settings' || activeActivity === 'feishu' ? 'none' : 'flex',
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