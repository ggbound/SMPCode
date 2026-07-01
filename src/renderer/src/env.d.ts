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
      startProcessInTerminal: (command: string, cwd: string, terminalId?: string, aiPrompt?: string) => Promise<{ processId: string; success: boolean; error?: string }>
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
      fsReadFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      fsWriteFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      onFileChange: (callback: (event: unknown, data: { eventType: string; filename: string; dirPath: string }) => void) => () => void
      onFileContentChanged: (callback: (event: unknown, data: { filePath: string; content: string }) => void) => () => void
      
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
      
      // CLI Chat API - 替代 HTTP API 模式
      cliChat: {
        createSession: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
        // ✅ 修复：content 支持 string 或 多模态数组
        sendMessage: (sessionId: string, message: string, messages?: Array<{ 
          role: string; 
          content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> 
        }>, model?: string) => Promise<{ success: boolean; error?: string }>
        stopSession: (sessionId: string) => Promise<{ success: boolean }>
        deleteSession: (sessionId: string) => Promise<{ success: boolean }>
        onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => () => void
      }

      // Feishu WebSocket API
      feishu: {
        startWebSocket: (config: { appId: string; appSecret: string; botEnabled?: boolean }) => Promise<{ success: boolean; error?: string }>
        stopWebSocket: () => Promise<{ success: boolean; error?: string }>
        getWebSocketStatus: () => Promise<{ success: boolean; status?: any; error?: string }>
        sendMessage: (content: string, chatId: string, chatType: 'group' | 'p2p') => Promise<{ success: boolean; error?: string }>
        replyMessage: (content: string, messageId: string, chatId: string, chatType: 'group' | 'p2p') => Promise<{ success: boolean; error?: string }>
        onMessage: (callback: (event: unknown, data: any) => void) => () => void
        onStatusChange: (callback: (event: unknown, status: any) => void) => () => void
        // 会话存储
        saveSessions: (projectPath: string, sessions: any[]) => Promise<{ success: boolean; error?: string }>
        listSessions: (projectPath: string) => Promise<{ success: boolean; sessions?: any[]; error?: string }>
        saveConversation: (projectPath: string, sessionId: string, messages: any[], sessionTitle?: string) => Promise<{ success: boolean; error?: string }>
        loadConversation: (projectPath: string, sessionId: string) => Promise<{ success: boolean; messages?: any[]; title?: string; error?: string }>
        deleteSession: (projectPath: string, sessionId: string) => Promise<{ success: boolean; error?: string }>
      }

      // MCP & Skill API
      mcp: {
        getServers: () => Promise<{ success: boolean; servers?: any[]; error?: string }>
        addServer: (config: any) => Promise<{ success: boolean; server?: any; error?: string }>
        updateServer: (id: string, updates: any) => Promise<{ success: boolean; server?: any; error?: string }>
        removeServer: (id: string) => Promise<{ success: boolean; error?: string }>
        connectServer: (id: string) => Promise<{ success: boolean; error?: string }>
        disconnectServer: (id: string) => Promise<{ success: boolean; error?: string }>
        getServerStatus: (id: string) => Promise<{ success: boolean; status?: any; error?: string }>
      }
      skill: {
        getAll: () => Promise<{ success: boolean; skills?: any[]; error?: string }>
        add: (config: any) => Promise<{ success: boolean; skill?: any; error?: string }>
        update: (id: string, updates: any) => Promise<{ success: boolean; skill?: any; error?: string }>
        remove: (id: string) => Promise<{ success: boolean; error?: string }>
        setEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
        onInstallProgress: (callback: (event: unknown, data: { skillId: string; status: string; progress?: number; message: string; error?: string }) => void) => () => void
      }
      // Reminder API
      reminder: {
        getAll: () => Promise<any[]>
        add: (content: string, cronExpression: string, targetType: 'user' | 'group', targetId: string, description?: string) => Promise<{ success: boolean; reminder?: any; error?: string }>
        remove: (id: string) => Promise<{ success: boolean; error?: string }>
        update: (id: string, updates: Partial<{ content?: string; cronExpression?: string; enabled?: boolean }>) => Promise<{ success: boolean; reminder?: any; error?: string }>
        toggle: (id: string) => Promise<{ success: boolean; reminder?: any; error?: string }>
      }
      
      // MemCoder API
      memcoder: {
        initialize: (projectPath: string) => Promise<{ success: boolean; error?: string }>
        getConfig: (projectPath: string) => Promise<{ success: boolean; config?: any; error?: string }>
        updateConfig: (projectPath: string, config: any) => Promise<{ success: boolean; error?: string }>
        setEnabled: (projectPath: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
        analyzeGit: (projectPath: string, maxCommits?: number) => Promise<{ success: boolean; count?: number; error?: string }>
        learnFromWork: (projectPath: string, intent: string, files: string[]) => Promise<{ success: boolean; mapping?: any; error?: string }>
        searchHistory: (projectPath: string, query: string, limit?: number) => Promise<{ success: boolean; mappings?: any[]; error?: string }>
        getEnhancedPrompt: (projectPath: string, basePrompt: string) => Promise<{ success: boolean; prompt?: string; error?: string }>
        getRelevantContext: (projectPath: string, query: string, limit?: number) => Promise<{ success: boolean; context?: string; error?: string }>
        provideFeedback: (projectPath: string, mappingId: string, type: 'approve' | 'reject' | 'modify', feedback: string) => Promise<{ success: boolean; error?: string }>
        getStats: (projectPath: string) => Promise<{ success: boolean; stats?: any; error?: string }>
        getMemorySummary: (projectPath: string) => Promise<{ success: boolean; summary?: string; error?: string }>
        getSuggestions: (projectPath: string, query: string) => 
      Promise<{ success: boolean, suggestions?: any, error?: string }>,
    getFeedback: (projectPath: string) => 
      Promise<{ success: boolean, feedback?: any[], error?: string }>,
    exportMemory: (projectPath: string) => 
      Promise<{ success: boolean, memory?: any, error?: string }>,
    clearMemory: (projectPath: string) => 
      Promise<{ success: boolean, error?: string }>
      }
      
      // Diff Service - 文件差异服务
      diff: {
        applyEdit: (editId: string, cwd: string) => Promise<{ success: boolean; error?: string }>
        cancelEdit: (editId: string) => Promise<{ success: boolean; error?: string }>
        getPendingEdits: () => Promise<{ success: boolean; edits?: any[]; error?: string }>
      }
      
      // Operation History - 操作历史
      history: {
        undo: (projectPath: string) => Promise<{ success: boolean; operation?: any; description?: string; canUndo?: boolean; error?: string }>
        redo: (projectPath: string) => Promise<{ success: boolean; operation?: any; description?: string; canRedo?: boolean; error?: string }>
        get: (projectPath: string) => Promise<{ success: boolean; history?: any[]; currentIndex?: number; canUndo?: boolean; canRedo?: boolean; error?: string }>
        clear: (projectPath: string) => Promise<{ success: boolean; error?: string }>
      }
      
      // Mention Service - @ 符号引用
      mention: {
        search: (projectPath: string, query: string, type?: 'file' | 'symbol' | 'directory') => Promise<{ success: boolean; items?: any[]; error?: string }>
        expand: (projectPath: string, message: string) => Promise<{ success: boolean; expandedMessage?: string; contexts?: any; error?: string }>
        suggestions: (projectPath: string, partialQuery: string, type?: 'file' | 'symbol' | 'directory') => Promise<{ success: boolean; items?: any[]; error?: string }>
      }
      
      // Inline AI - 代码内联 AI
      inlineAI: {
        create: (filePath: string, selectedCode: string, startLine: number, endLine: number, language: string) => Promise<{ success: boolean; session?: any; error?: string }>
        get: (sessionId: string) => Promise<{ success: boolean; session?: any; error?: string }>
        update: (sessionId: string, updates: any) => Promise<{ success: boolean; session?: any; error?: string }>
        delete: (sessionId: string) => Promise<{ success: boolean; error?: string }>
        generatePrompt: (selectedCode: string, instruction: string, language: string) => Promise<{ success: boolean; prompt?: string; error?: string }>
        onReplace: (callback: (event: unknown, data: any) => void) => () => void
      }
      
      // Batch Edit - 批量文件编辑
      batchEdit: {
        create: (projectPath: string, description: string, edits: Array<{ filePath: string; oldContent: string; newContent: string }>) => Promise<{ success: boolean; session?: any; error?: string }>
        get: (sessionId: string) => Promise<{ success: boolean; session?: any; error?: string }>
        apply: (sessionId: string) => Promise<{ success: boolean; result?: any; error?: string }>
        cancel: (sessionId: string) => Promise<{ success: boolean; error?: string }>
        stats: (sessionId: string) => Promise<{ success: boolean; stats?: any; error?: string }>
        all: () => Promise<{ success: boolean; sessions?: any[]; error?: string }>
      }
      
      // Completion Service - 智能补全
      completion: {
        get: (projectPath: string, context: any) => Promise<{ success: boolean; completions?: any[]; error?: string }>
        shouldTrigger: (lineContent: string, character: number) => Promise<{ success: boolean; shouldTrigger?: boolean; error?: string }>
      }
    }
  }
}