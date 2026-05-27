import { contextBridge, ipcRenderer, dialog } from 'electron'

// Custom APIs for renderer
const api = {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke('set-config', key, value),
  saveAllConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('save-all-config', config),

  // Sessions
  getSessionsDir: () => ipcRenderer.invoke('get-sessions-dir'),

  // Commands and Tools
  getCommands: () => ipcRenderer.invoke('get-commands'),
  getTools: () => ipcRenderer.invoke('get-tools'),

  // File System
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFile: () => ipcRenderer.invoke('open-file'),
  showSaveDialog: (options?: Electron.SaveDialogOptions) => ipcRenderer.invoke('show-save-dialog', options),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // Terminal
  createTerminal: (options?: { name?: string; cwd?: string; id?: string }) => ipcRenderer.invoke('terminal:create', options),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.invoke('terminal:kill', { id }),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),
  renameTerminal: (id: string, name: string) => ipcRenderer.invoke('terminal:rename', { id, name }),

  // Event listeners
  onNewSession: (callback: () => void) => {
    ipcRenderer.on('new-session', callback)
    return () => ipcRenderer.removeListener('new-session', callback)
  },
  onOpenSession: (callback: () => void) => {
    ipcRenderer.on('open-session', callback)
    return () => ipcRenderer.removeListener('open-session', callback)
  },
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback)
    return () => ipcRenderer.removeListener('open-settings', callback)
  },
  onUpdateAvailable: (callback: () => void) => {
    ipcRenderer.on('update-available', callback)
    return () => ipcRenderer.removeListener('update-available', callback)
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('update-downloaded', callback)
    return () => ipcRenderer.removeListener('update-downloaded', callback)
  },
  
  // File menu events
  onFileNew: (callback: () => void) => {
    ipcRenderer.on('file:new', callback)
    return () => ipcRenderer.removeListener('file:new', callback)
  },
  onFileOpen: (callback: () => void) => {
    ipcRenderer.on('file:open', callback)
    return () => ipcRenderer.removeListener('file:open', callback)
  },
  onFolderOpen: (callback: () => void) => {
    ipcRenderer.on('folder:open', callback)
    return () => ipcRenderer.removeListener('folder:open', callback)
  },
  onFileSave: (callback: () => void) => {
    ipcRenderer.on('file:save', callback)
    return () => ipcRenderer.removeListener('file:save', callback)
  },
  onFileSaveAs: (callback: () => void) => {
    ipcRenderer.on('file:save-as', callback)
    return () => ipcRenderer.removeListener('file:save-as', callback)
  },
  onFileRefresh: (callback: () => void) => {
    ipcRenderer.on('file:refresh', callback)
    return () => ipcRenderer.removeListener('file:refresh', callback)
  },
  onTerminalData: (callback: (event: unknown, data: { id: string; data: string }) => void) => {
    ipcRenderer.on('terminal:data', callback)
    return () => ipcRenderer.removeListener('terminal:data', callback)
  },
  onTerminalExit: (callback: (event: unknown, data: { id: string; exitCode: number }) => void) => {
    ipcRenderer.on('terminal:exit', callback)
    return () => ipcRenderer.removeListener('terminal:exit', callback)
  },
  onTerminalCreateRequest: (callback: (event: unknown, data: { id: string; cwd?: string; title?: string }) => void) => {
    ipcRenderer.on('terminal:create', callback)
    return () => ipcRenderer.removeListener('terminal:create', callback)
  },

  // Process management - 支持AI意图
  startProcessInTerminal: (command: string, cwd: string, terminalId: string, aiPrompt?: string) =>
    ipcRenderer.invoke('process:start-in-terminal', { command, cwd, terminalId, aiPrompt }),
  stopProcess: (processId: string) =>
    ipcRenderer.invoke('process:stop', { processId }),
  restartProcess: (processId: string) =>
    ipcRenderer.invoke('process:restart', { processId }),
  getRunningProcesses: () =>
    ipcRenderer.invoke('process:list'),
  shouldRunInTerminal: (command: string) =>
    ipcRenderer.invoke('process:should-run-in-terminal', { command }),
  
  // AI意图相关API
  getAIIntentContext: (processId: string) =>
    ipcRenderer.invoke('process:get-ai-intent', { processId }),
  getProjectAIHistory: (cwd: string) =>
    ipcRenderer.invoke('process:get-ai-history', { cwd }),

  // Conversation storage - TRAE风格项目级对话存储
  saveConversation: (projectPath: string, sessionId: string, messages: any[], sessionTitle?: string) =>
    ipcRenderer.invoke('conversation:save', { projectPath, sessionId, messages, sessionTitle }),
  loadConversation: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke('conversation:load', { projectPath, sessionId }),
  listSessions: (projectPath: string) =>
    ipcRenderer.invoke('conversation:list-sessions', { projectPath }),
  deleteSession: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke('conversation:delete-session', { projectPath, sessionId }),
  autoSaveAllSessions: (projectPath: string, sessions: any[]) =>
    ipcRenderer.invoke('conversation:auto-save-all', { projectPath, sessions }),

  // Process event listeners - 支持AI意图数据
  onProcessStarted: (callback: (event: unknown, data: { 
    processId: string; 
    command: string; 
    cwd: string; 
    terminalId?: string;
    aiIntentId?: string;
    taskType?: string;
  }) => void) => {
    ipcRenderer.on('process:started', callback)
    return () => ipcRenderer.removeListener('process:started', callback)
  },
  onProcessData: (callback: (event: unknown, data: { terminalId: string; processId: string; data: string }) => void) => {
    ipcRenderer.on('terminal:process-data', callback)
    return () => ipcRenderer.removeListener('terminal:process-data', callback)
  },
  onProcessExit: (callback: (event: unknown, data: { terminalId: string; processId: string; exitCode: number }) => void) => {
    ipcRenderer.on('terminal:process-exit', callback)
    return () => ipcRenderer.removeListener('terminal:process-exit', callback)
  },
  onProcessError: (callback: (event: unknown, data: { terminalId: string; processId: string; error: string }) => void) => {
    ipcRenderer.on('terminal:process-error', callback)
    return () => ipcRenderer.removeListener('terminal:process-error', callback)
  },

  // Git operations
  gitStatus: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
  gitIsRepo: (dirPath: string) => ipcRenderer.invoke('git:is-repo', dirPath),
  gitFindRoot: (startPath: string) => ipcRenderer.invoke('git:find-root', startPath),
  gitFileStatus: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:file-status', { repoPath, filePath }),
  gitCommits: (repoPath: string, count?: number) => ipcRenderer.invoke('git:commits', { repoPath, count }),
  gitBranches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
  gitStage: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:stage', { repoPath, files }),
  gitUnstage: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:unstage', { repoPath, files }),
  gitCommit: (repoPath: string, message: string, files?: string[]) => ipcRenderer.invoke('git:commit', { repoPath, message, files }),
  gitDiscard: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:discard', { repoPath, files }),
  gitCreateBranch: (repoPath: string, branchName: string, checkout?: boolean) => ipcRenderer.invoke('git:create-branch', { repoPath, branchName, checkout }),
  gitCheckoutBranch: (repoPath: string, branchName: string) => ipcRenderer.invoke('git:checkout-branch', { repoPath, branchName }),
  gitDeleteBranch: (repoPath: string, branchName: string, force?: boolean) => ipcRenderer.invoke('git:delete-branch', { repoPath, branchName, force }),
  gitPush: (repoPath: string, remote?: string, branch?: string) => ipcRenderer.invoke('git:push', { repoPath, remote, branch }),
  gitPull: (repoPath: string, remote?: string, branch?: string) => ipcRenderer.invoke('git:pull', { repoPath, remote, branch }),
  gitDiff: (repoPath: string, filePath: string, staged?: boolean) => ipcRenderer.invoke('git:diff', { repoPath, filePath, staged }),
  gitStashList: (repoPath: string) => ipcRenderer.invoke('git:stash-list', repoPath),
  gitStash: (repoPath: string, message?: string) => ipcRenderer.invoke('git:stash', { repoPath, message }),
  gitStashPop: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stash-pop', { repoPath, index }),

  // File watching
  fsWatch: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  fsUnwatch: (dirPath: string) => ipcRenderer.invoke('fs:unwatch', dirPath),
  fsGetGitignore: (dirPath: string) => ipcRenderer.invoke('fs:get-gitignore', dirPath),

  // Event listeners for file watching
  onFileChange: (callback: (event: unknown, data: { eventType: string; filename: string; dirPath: string }) => void) => {
    ipcRenderer.on('fs:change', callback)
    return () => ipcRenderer.removeListener('fs:change', callback)
  },

  // File operation notifications from AI tools
  onFileOperation: (callback: (event: unknown, data: { operation: 'writing' | 'editing' | 'creating'; path: string; timestamp: number }) => void) => {
    ipcRenderer.on('file-operation-notification', callback)
    return () => ipcRenderer.removeListener('file-operation-notification', callback)
  },

  // Tool executor events
  onToolStatusChanged: (callback: (event: unknown, data: { type: string; callId: string; toolName: string; timestamp: number; result?: unknown; error?: string }) => void) => {
    ipcRenderer.on('tool-status-changed', callback)
    return () => ipcRenderer.removeListener('tool-status-changed', callback)
  },

  // Execute tool via IPC
  executeTool: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) =>
    ipcRenderer.invoke('tool:execute', callId, toolName, args, cwd),

  // Get tool records
  getToolRecords: () => ipcRenderer.invoke('tool:get-records'),

  // Clear tool history
  clearToolHistory: () => ipcRenderer.invoke('tool:clear-history'),

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
  }) => ipcRenderer.invoke('search:execute', options),

  // CLI Chat API - 替代 HTTP API 模式
  cliChat: {
    // 创建会话
    createSession: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string) =>
      ipcRenderer.invoke('cli-chat:create-session', { mode, cwd, initialPrompt }),
    // 发送消息（流式）
    sendMessage: (sessionId: string, message: string, messages?: Array<{ role: string; content: string }>, model?: string) =>
      ipcRenderer.invoke('cli-chat:send-message', { sessionId, message, messages, model }),
    // 停止会话
    stopSession: (sessionId: string) =>
      ipcRenderer.invoke('cli-chat:stop-session', { sessionId }),
    // 删除会话
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke('cli-chat:delete-session', { sessionId }),
    // 监听流式数据
    onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => {
      ipcRenderer.on('cli-chat:stream', callback)
      return () => ipcRenderer.removeListener('cli-chat:stream', callback)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}