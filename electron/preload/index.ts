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

  // File watching
  fsWatch: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  fsUnwatch: (dirPath: string) => ipcRenderer.invoke('fs:unwatch', dirPath),
  fsGetGitignore: (dirPath: string) => ipcRenderer.invoke('fs:get-gitignore', dirPath),

  // Event listeners for file watching
  onFileChange: (callback: (event: unknown, data: { eventType: string; filename: string; dirPath: string }) => void) => {
    ipcRenderer.on('fs:change', callback)
    return () => ipcRenderer.removeListener('fs:change', callback)
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