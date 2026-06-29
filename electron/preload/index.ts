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
  startProcessInTerminal: (command: string, cwd: string, terminalId?: string, aiPrompt?: string) =>
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
  gitCommitDiff: (repoPath: string, filePath: string, commitHash: string) => ipcRenderer.invoke('git:commit-diff', { repoPath, filePath, commitHash }),
  gitStashList: (repoPath: string) => ipcRenderer.invoke('git:stash-list', repoPath),
  gitStash: (repoPath: string, message?: string) => ipcRenderer.invoke('git:stash', { repoPath, message }),
  gitStashPop: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stash-pop', { repoPath, index }),
  gitFetch: (repoPath: string, remote?: string) => ipcRenderer.invoke('git:fetch', { repoPath, remote }),
  gitRemoteBranches: (repoPath: string) => ipcRenderer.invoke('git:remote-branches', repoPath),
  gitDeleteRemoteBranch: (repoPath: string, remote: string, branch: string) => ipcRenderer.invoke('git:delete-remote-branch', { repoPath, remote, branch }),
  gitRemotes: (repoPath: string) => ipcRenderer.invoke('git:remotes', repoPath),
  gitMerge: (repoPath: string, branchName: string, noFastForward?: boolean) => ipcRenderer.invoke('git:merge', { repoPath, branchName, noFastForward }),
  gitCheckMergeConflicts: (repoPath: string) => ipcRenderer.invoke('git:check-merge-conflicts', repoPath),
  gitAbortMerge: (repoPath: string) => ipcRenderer.invoke('git:abort-merge', repoPath),
  gitContinueMerge: (repoPath: string, message?: string) => ipcRenderer.invoke('git:continue-merge', { repoPath, message }),
  gitTags: (repoPath: string) => ipcRenderer.invoke('git:tags', repoPath),
  gitCreateTag: (repoPath: string, tagName: string, message?: string, commitHash?: string) => ipcRenderer.invoke('git:create-tag', { repoPath, tagName, message, commitHash }),
  gitDeleteTag: (repoPath: string, tagName: string) => ipcRenderer.invoke('git:delete-tag', { repoPath, tagName }),
  gitPushTag: (repoPath: string, tagName: string, remote?: string) => ipcRenderer.invoke('git:push-tag', { repoPath, tagName, remote }),
  gitPushAllTags: (repoPath: string, remote?: string) => ipcRenderer.invoke('git:push-all-tags', { repoPath, remote }),
  gitRevert: (repoPath: string, commitHash: string, noEdit?: boolean) => ipcRenderer.invoke('git:revert', { repoPath, commitHash, noEdit }),
  gitReset: (repoPath: string, commitHash: string, mode?: 'soft' | 'mixed' | 'hard') => ipcRenderer.invoke('git:reset', { repoPath, commitHash, mode }),
  gitCherryPick: (repoPath: string, commitHash: string, noCommit?: boolean) => ipcRenderer.invoke('git:cherry-pick', { repoPath, commitHash, noCommit }),
  gitAbortCherryPick: (repoPath: string) => ipcRenderer.invoke('git:abort-cherry-pick', repoPath),
  gitContinueCherryPick: (repoPath: string) => ipcRenderer.invoke('git:continue-cherry-pick', repoPath),
  gitCommitDetails: (repoPath: string, commitHash: string) => ipcRenderer.invoke('git:commit-details', { repoPath, commitHash }),
  gitSubmodules: (repoPath: string) => ipcRenderer.invoke('git:submodules', repoPath),
  gitAddSubmodule: (repoPath: string, url: string, path: string, branch?: string) => ipcRenderer.invoke('git:add-submodule', { repoPath, url, path, branch }),
  gitRemoveSubmodule: (repoPath: string, path: string) => ipcRenderer.invoke('git:remove-submodule', { repoPath, path }),
  gitUpdateSubmodule: (repoPath: string, path?: string, init?: boolean) => ipcRenderer.invoke('git:update-submodule', { repoPath, path, init }),
  gitSyncSubmodule: (repoPath: string, path?: string) => ipcRenderer.invoke('git:sync-submodule', { repoPath, path }),
  addToGitignore: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:add-to-gitignore', { repoPath, filePath }),

  // File watching
  fsWatch: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  fsUnwatch: (dirPath: string) => ipcRenderer.invoke('fs:unwatch', dirPath),
  fsGetGitignore: (dirPath: string) => ipcRenderer.invoke('fs:get-gitignore', dirPath),
  fsReadFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  fsWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', { filePath, content }),

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
    // 发送消息（流式）- 支持多模态（文本+图片）
    sendMessage: (sessionId: string, message: string, messages?: Array<{ 
      role: string; 
      content: string | Array<{type: string; text?: string; image_url?: {url: string}}> 
    }>, model?: string) => {
      // ✅ 修复：序列化消息以确保大数据正确传输
      const serializedMessages = messages ? JSON.parse(JSON.stringify(messages)) : undefined
      console.log('[Preload] Sending messages:', serializedMessages?.length, 'messages')
      return ipcRenderer.invoke('cli-chat:send-message', { sessionId, message, messages: serializedMessages, model })
    },
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
  },

  // Reminder management
  reminder: {
    getAll: () => ipcRenderer.invoke('reminder:get-all'),
    remove: (id: string) => ipcRenderer.invoke('reminder:remove', id),
    toggle: (id: string) => ipcRenderer.invoke('reminder:toggle', id)
  },

  // MCP & Skill management
  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:get-servers'),
    addServer: (config: any) => ipcRenderer.invoke('mcp:add-server', config),
    updateServer: (id: string, updates: any) => ipcRenderer.invoke('mcp:update-server', id, updates),
    removeServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
    connectServer: (id: string) => ipcRenderer.invoke('mcp:connect-server', id),
    disconnectServer: (id: string) => ipcRenderer.invoke('mcp:disconnect-server', id),
    getServerStatus: (id: string) => ipcRenderer.invoke('mcp:get-server-status', id),
  },
  skill: {
    getAll: () => ipcRenderer.invoke('skill:get-all'),
    add: (config: any) => ipcRenderer.invoke('skill:add', config),
    update: (id: string, updates: any) => ipcRenderer.invoke('skill:update', id, updates),
    remove: (id: string) => ipcRenderer.invoke('skill:remove', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('skill:set-enabled', id, enabled),
    // 监听安装进度
    onInstallProgress: (callback: (event: unknown, data: { skillId: string; status: string; progress?: number; message: string; error?: string }) => void) => {
      ipcRenderer.on('skill:install-progress', callback)
      return () => ipcRenderer.removeListener('skill:install-progress', callback)
    },
  },

  // Feishu WebSocket
  feishu: {
    // 启动 WebSocket 连接
    startWebSocket: (config: { appId: string; appSecret: string; botEnabled?: boolean }) => 
      ipcRenderer.invoke('feishu:ws:start', config),
    // 停止 WebSocket 连接
    stopWebSocket: () => 
      ipcRenderer.invoke('feishu:ws:stop'),
    // 获取连接状态
    getWebSocketStatus: () => 
      ipcRenderer.invoke('feishu:ws:status'),
    // 发送消息
    sendMessage: (content: string, chatId: string, chatType: 'group' | 'p2p') => 
      ipcRenderer.invoke('feishu:ws:send', { content, chatId, chatType }),
    // 回复消息（用于回复特定消息）
    replyMessage: (content: string, messageId: string, chatId: string, chatType: 'group' | 'p2p') => 
      ipcRenderer.invoke('feishu:ws:reply', { content, messageId, chatId, chatType }),
    // 监听接收到的消息
    onMessage: (callback: (event: unknown, data: any) => void) => {
      ipcRenderer.on('feishu:ws:message', callback)
      return () => ipcRenderer.removeListener('feishu:ws:message', callback)
    },
    // 监听状态变化
    onStatusChange: (callback: (event: unknown, status: any) => void) => {
      ipcRenderer.on('feishu:ws:status', callback)
      return () => ipcRenderer.removeListener('feishu:ws:status', callback)
    },
    // 会话存储
    saveSessions: (projectPath: string, sessions: any[]) => 
      ipcRenderer.invoke('feishu:conversation:save-sessions', { projectPath, sessions }),
    listSessions: (projectPath: string) => 
      ipcRenderer.invoke('feishu:conversation:list-sessions', { projectPath }),
    saveConversation: (projectPath: string, sessionId: string, messages: any[], sessionTitle?: string) => 
      ipcRenderer.invoke('feishu:conversation:save', { projectPath, sessionId, messages, sessionTitle }),
    loadConversation: (projectPath: string, sessionId: string) => 
      ipcRenderer.invoke('feishu:conversation:load', { projectPath, sessionId }),
    deleteSession: (projectPath: string, sessionId: string) => 
      ipcRenderer.invoke('feishu:conversation:delete-sessions', { projectPath, sessionId })
  },

  // MemCoder
  memcoder: {
    initialize: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:initialize', projectPath),
    getConfig: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:get-config', projectPath),
    updateConfig: (projectPath: string, config: any) => 
      ipcRenderer.invoke('memcoder:update-config', { projectPath, config }),
    setEnabled: (projectPath: string, enabled: boolean) => 
      ipcRenderer.invoke('memcoder:set-enabled', { projectPath, enabled }),
    analyzeGit: (projectPath: string, maxCommits?: number) => 
      ipcRenderer.invoke('memcoder:analyze-git', { projectPath, maxCommits }),
    learnFromWork: (projectPath: string, intent: string, files: string[]) => 
      ipcRenderer.invoke('memcoder:learn-from-work', { projectPath, intent, files }),
    searchHistory: (projectPath: string, query: string, limit?: number) => 
      ipcRenderer.invoke('memcoder:search-history', { projectPath, query, limit }),
    getEnhancedPrompt: (projectPath: string, basePrompt: string) => 
      ipcRenderer.invoke('memcoder:get-enhanced-prompt', { projectPath, basePrompt }),
    getRelevantContext: (projectPath: string, query: string, limit?: number) => 
      ipcRenderer.invoke('memcoder:get-relevant-context', { projectPath, query, limit }),
    provideFeedback: (projectPath: string, mappingId: string, type: 'approve' | 'reject' | 'modify', feedback: string) => 
      ipcRenderer.invoke('memcoder:provide-feedback', { projectPath, mappingId, type, feedback }),
    getStats: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:get-stats', projectPath),
    getMemorySummary: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:get-memory-summary', projectPath),
    getSuggestions: (projectPath: string, query: string) => 
      ipcRenderer.invoke('memcoder:get-suggestions', { projectPath, query }),
    getFeedback: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:get-feedback', projectPath),
    exportMemory: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:export-memory', projectPath),
    clearMemory: (projectPath: string) => 
      ipcRenderer.invoke('memcoder:clear-memory', projectPath)
  },

  // Task Resumption - 任务断点续传
  taskResumption: {
    // 获取可恢复的任务列表
    getResumableTasks: () => 
      ipcRenderer.invoke('task-resumption:get-tasks'),
    // 准备任务恢复
    prepareTaskResume: (taskId: string) => 
      ipcRenderer.invoke('task-resumption:prepare-resume', taskId),
    // 删除任务
    deleteTask: (taskId: string) => 
      ipcRenderer.invoke('task-resumption:delete-task', taskId),
    // 创建增强会话（支持断点续传）
    createEnhancedSession: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string, options?: { resumeTaskId?: string; maxIterations?: number }) =>
      ipcRenderer.invoke('task-resumption:create-session', { mode, cwd, initialPrompt, options }),
    // 发送增强消息流
    sendEnhancedMessage: (sessionId: string, message: string, options?: { maxIterations?: number }) =>
      ipcRenderer.invoke('task-resumption:send-message', { sessionId, message, options }),
    // 停止增强会话
    stopEnhancedSession: (sessionId: string) =>
      ipcRenderer.invoke('task-resumption:stop-session', { sessionId }),
    // 删除增强会话
    deleteEnhancedSession: (sessionId: string) =>
      ipcRenderer.invoke('task-resumption:delete-session', { sessionId }),
    // 监听流式数据
    onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: any }) => void) => {
      ipcRenderer.on('task-resumption:stream', callback)
      return () => ipcRenderer.removeListener('task-resumption:stream', callback)
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