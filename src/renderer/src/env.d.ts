// 全局类型定义文件 - 确保 Window 接口扩展被正确识别
export {}

interface RunningProcess {
  id: string
  command: string
  isRunning: boolean
  startTime: string
  cwd: string
  terminalId?: string
}

declare global {
  interface Window {
    api?: {
      // Config
      getConfig: () => Promise<{
        apiKey: string
        model: string
        permissionMode: string
        defaultModel?: string
        providers?: Array<{ id: string; name: string; apiKey: string; baseUrl: string; enabled: boolean }>
      }>
      setConfig: (key: string, value: unknown) => Promise<boolean>
      saveAllConfig: (config: Record<string, unknown>) => Promise<boolean>
      
      // Sessions
      getSessionsDir: () => Promise<string>
      
      // Commands and Tools
      getCommands: () => Promise<Array<{ name: string; source_hint: string; responsibility: string; description?: string }>>
      getTools: () => Promise<Array<{ name: string; source_hint: string; responsibility: string; description?: string; parameters?: Record<string, unknown>; required?: string[] }>>
      
      // File System
      selectFolder: () => Promise<string | null>
      openFile: () => Promise<string | null>
      showSaveDialog: (options?: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>
      
      // Updates
      checkForUpdates: () => Promise<unknown>
      
      // Window controls
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      
      // Event listeners
      onNewSession: (callback: () => void) => () => void
      onOpenSession: (callback: () => void) => () => void
      onOpenSettings: (callback: () => void) => () => void
      onUpdateAvailable: (callback: () => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      
      // File menu events
      onFileNew: (callback: () => void) => () => void
      onFileOpen: (callback: () => void) => () => void
      onFolderOpen: (callback: () => void) => () => void
      onFileSave: (callback: () => void) => () => void
      onFileSaveAs: (callback: () => void) => () => void
      onFileRefresh: (callback: () => void) => () => void
      
      // Terminal APIs
      createTerminal: (options?: { name?: string; cwd?: string; id?: string }) => Promise<{ id: string; name: string }>
      writeTerminal: (id: string, data: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
      killTerminal: (id: string) => Promise<void>
      listTerminals: () => Promise<Array<{ id: string; name: string }>>
      renameTerminal: (id: string, name: string) => Promise<void>
      onTerminalData: (callback: (event: unknown, data: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (event: unknown, data: { id: string; exitCode: number }) => void) => () => void
      onTerminalCreateRequest: (callback: (event: unknown, data: { id: string; cwd?: string; title?: string }) => void) => () => void
      
      // Process management - 支持AI意图
      startProcessInTerminal: (command: string, cwd: string, terminalId: string, aiPrompt?: string) => Promise<{ processId: string; success: boolean; error?: string }>
      stopProcess: (processId: string) => Promise<{ success: boolean; error?: string; actuallyStopped?: boolean }>
      restartProcess: (processId: string) => Promise<{ success: boolean; error?: string; processId?: string }>
      getRunningProcesses: () => Promise<RunningProcess[]>
      shouldRunInTerminal: (command: string) => Promise<boolean>
      
      // AI意图相关API
      getAIIntentContext: (processId: string) => Promise<{ taskType: string; originalPrompt: string } | undefined>
      getProjectAIHistory: (cwd: string) => Promise<Array<{ prompt: string; timestamp: string; taskType: string }>>
      
      // Conversation storage - TRAE风格项目级对话存储
      saveConversation: (projectPath: string, sessionId: string, messages: any[], sessionTitle?: string) => Promise<{ success: boolean; error?: string }>
      loadConversation: (projectPath: string, sessionId: string) => Promise<{ success: boolean; error?: string; messages?: any[]; title?: string }>
      listSessions: (projectPath: string) => Promise<{ success: boolean; error?: string; sessions?: Array<{ id: string; title: string; updatedAt: string; messageCount: number }> }>
      deleteSession: (projectPath: string, sessionId: string) => Promise<{ success: boolean; error?: string }>
      autoSaveAllSessions: (projectPath: string, sessions: any[]) => Promise<{ success: boolean; error?: string }>
      
      // Process event listeners
      onProcessStarted: (callback: (event: unknown, data: { processId: string; command: string; cwd: string; terminalId?: string; aiIntentId?: string; taskType?: string }) => void) => () => void
      onProcessData: (callback: (event: unknown, data: { terminalId: string; processId: string; data: string }) => void) => () => void
      onProcessExit: (callback: (event: unknown, data: { terminalId: string; processId: string; exitCode: number }) => void) => () => void
      onProcessError: (callback: (event: unknown, data: { terminalId: string; processId: string; error: string }) => void) => () => void
      
      // Git operations
      gitStatus: (repoPath: string) => Promise<unknown>
      gitIsRepo: (dirPath: string) => Promise<boolean>
      gitFindRoot: (startPath: string) => Promise<string | null>
      gitFileStatus: (repoPath: string, filePath: string) => Promise<unknown>
      gitCommits: (repoPath: string, count?: number) => Promise<unknown>
      gitBranches: (repoPath: string) => Promise<unknown>
      
      // File watching
      fsWatch: (dirPath: string) => Promise<void>
      fsUnwatch: (dirPath: string) => Promise<void>
      fsGetGitignore: (dirPath: string) => Promise<string[]>
      onFileChange: (callback: (event: unknown, data: { eventType: string; filename: string; dirPath: string }) => void) => () => void
      
      // File operation notifications from AI tools
      onFileOperation: (callback: (event: unknown, data: { 
        operation: 'writing' | 'editing' | 'creating' | 'completed' | 'error'
        path: string
        timestamp: number
        message?: string
      }) => void) => () => void
      
      // Tool executor events
      onToolStatusChanged: (callback: (event: unknown, data: {
        type: 'started' | 'completed' | 'failed' | 'cancelled'
        callId: string
        toolName: string
        timestamp: number
        result?: { success: boolean; output: string; error?: string }
        error?: string
      }) => void) => () => void

      // Execute tool via IPC
      executeTool: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<{ success: boolean; output: string; error?: string }>

      // Get tool records
      getToolRecords: () => Promise<Array<unknown>>

      // Clear tool history
      clearToolHistory: () => Promise<void>

      // Search API
      executeSearch: (options: {
        query: string
        path: string
        includePattern?: string
        excludePattern?: string
        isRegex?: boolean
        isCaseSensitive?: boolean
        isWholeWords?: boolean
        maxResults?: number
        useIgnoreFiles?: boolean
      }) => Promise<{ success: boolean; data?: { matches: Array<{ file: string; line: number; column: number; content: string; match: string }>; totalFiles: number; limitHit: boolean }; error?: string }>
    }
  }
}