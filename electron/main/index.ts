import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, shell, dialog, nativeTheme } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, readFile, writeFileSync, mkdirSync, readdir, unlink, statSync } from 'fs'
import { promisify } from 'util'

const readdirAsync = promisify(readdir)
const unlinkAsync = promisify(unlink)
import log from 'electron-log'
import { startApiServer, stopApiServer } from './api-server'
import { 
  initConfigStore, 
  loadConfig as loadConfigFromStore, 
  saveConfig as saveConfigToStore, 
  updateConfigField, 
  getStorePath,
  AppConfig 
} from './config-service'
import { initTerminalService, cleanupTerminals } from './services/terminal-service'
import { processBridge } from './services/process-terminal-bridge'
import { commandRegistry, toolRegistry, runtimeEngine } from './cli'
import { browseWebsite } from './services/browser-tool-service'
import { 
  initReminderService,
  addReminder,
  getAllReminders,
  removeReminder,
  updateReminder,
  parseNaturalLanguageToCron
} from './services/reminder-service'
import { 
  initFeishuWebSocketService, 
  getFeishuWebSocketService,
  updateFeishuWebSocketConfig,
  type FeishuConfig 
} from './services/feishu-ws-service'

// 当前飞书会话上下文（用于提醒功能）
let currentFeishuContext: { chatId?: string; chatType?: 'group' | 'p2p' } = {}
import {
  getGitStatus,
  isGitRepository,
  findGitRoot,
  getFileStatus,
  getRecentCommits,
  getBranches,
  stageFiles,
  unstageFiles,
  commitChanges,
  discardChanges,
  createBranch,
  checkoutBranch,
  deleteBranch,
  push,
  pull,
  getFileDiff,
  getCommitFileDiff,
  getStashList,
  stashChanges,
  popStash,
  fetchRemote,
  getRemoteBranches,
  deleteRemoteBranch,
  getRemotes,
  mergeBranch,
  checkMergeConflicts,
  abortMerge,
  continueMerge,
  getTags,
  createTag,
  deleteTag,
  pushTag,
  pushAllTags,
  revertCommit,
  resetToCommit,
  cherryPickCommit,
  abortCherryPick,
  continueCherryPick,
  getCommitDetails,
  getSubmodules,
  addSubmodule,
  removeSubmodule,
  updateSubmodule,
  syncSubmodule
} from './services/git-service'
import { 
  watchDirectory,
  unwatchDirectory,
  stopAllWatchers,
  getGitIgnorePatterns,
  writeFile as writeFileService,
  readFile as readFileService
} from './services/files-service'
import { searchFiles } from './services/search-service'
import { initializeToolExecutor } from './services/tool-executor'
import {
  createCLISession,
  getCLISession,
  deleteCLISession,
  stopCLISession,
  sendCLIMessageStream,
  cleanupCLISessions,
  type StreamChunk
} from './services/cli-chat-service'

// Configure logging
// ✅ 性能优化：文件日志只记录 warn 及以上级别，减少磁盘 I/O 导致的主线程阻塞
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('Application starting...')

// Fix node-pty path in asar environment
// node-pty needs to find its spawn-helper binary which is unpacked from asar
if (app.isPackaged) {
  const possiblePaths = [
    // asar unpacked path
    join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', process.platform + '-' + process.arch),
    // legacy non-asar path (fallback)
    join(process.resourcesPath, 'app', 'node_modules', 'node-pty', 'prebuilds', process.platform + '-' + process.arch)
  ]
  
  for (const ptyPath of possiblePaths) {
    if (existsSync(ptyPath)) {
      process.env.PTY_HELPER_PATH = ptyPath
      log.info(`Set PTY_HELPER_PATH to: ${ptyPath}`)
      break
    }
  }
  
  if (!process.env.PTY_HELPER_PATH) {
    log.warn('Could not find node-pty prebuilds directory')
  }
}

// Global exception handler - 改进：不再直接退出进程，而是记录错误并尝试恢复
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
  // 不再直接退出，而是记录错误信息让用户知道出了问题
  // app.exit(1)  // 注释掉，避免直接退出
  
  // 如果主窗口存在，尝试显示错误
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-error', {
      type: 'uncaughtException',
      message: String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
  }
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
  // 同样不直接退出，记录错误
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-error', {
      type: 'unhandledRejection',
      message: String(reason)
    })
  }
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Initialize config store
initConfigStore()
log.info(`Config store path: ${getStorePath()}`)

function createWindow(): void {
  log.info('Creating main window...')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'SMP Code',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true
    }
  })

  // Create application menu
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'SMP Code',
      submenu: [
        { label: '关于 SMP Code', role: 'about' },
        { type: 'separator' },
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('open-settings') },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('file:new') },
        { label: '打开文件...', accelerator: 'CmdOrCtrl+Shift+F', click: () => mainWindow?.webContents.send('file:open') },
        { label: '打开文件夹...', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('folder:open') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('file:save') },
        { label: '另存为...', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('file:save-as') },
        { type: 'separator' },
        { label: '刷新文件树', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.send('file:refresh') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '切换开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '文档',
          click: async () => { await shell.openExternal('https://github.com/ggbound/SMPCode') }
        },
        {
          label: '报告问题',
          click: async () => { await shell.openExternal('https://github.com/ggbound/SMPCode/issues') }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)

  // Capture console logs from renderer
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level === 0) log.debug(`[Renderer] ${message}`)
    else if (level === 1) log.info(`[Renderer] ${message}`)
    else if (level === 2) log.warn(`[Renderer] ${message}`)
    else log.error(`[Renderer] ${message}`)
  })

  // Load the app
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
      return false
    }
    return true
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  log.info('Main window created')
}

function createTray(): void {
  // Use a simple approach - create tray without icon for now
  try {
    // Skip tray if no icon available
    log.info('Tray functionality available')
  } catch (error) {
    log.warn('Failed to create tray:', error)
  }
}

function registerGlobalShortcuts(): void {
  // Register global shortcut for new session
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  log.info('Global shortcuts registered')
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Config handlers - using electron-store
  ipcMain.handle('get-config', () => {
    const config = loadConfigFromStore()
    log.info(`Config loaded with ${config.providers?.length || 0} providers`)
    return config
  })

  // File dialog handlers
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Folder'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle('open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: 'Open File'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle('set-config', (_event, key: string, value: unknown) => {
    const success = updateConfigField(key as keyof AppConfig, value as AppConfig[keyof AppConfig])
    log.info(`Config field ${key} saved, success: ${success}`)
    return success
  })

  ipcMain.handle('save-all-config', (_event, newConfig: Record<string, unknown>) => {
    // Validate providers data
    if (newConfig.providers && Array.isArray(newConfig.providers)) {
      log.info(`Saving config with ${newConfig.providers.length} providers`)
    }
    
    const success = saveConfigToStore(newConfig as unknown as AppConfig)
    log.info(`All config saved, success: ${success}`)
    
    // Verify the save by reading back
    if (success) {
      try {
        const verify = loadConfigFromStore()
        log.info(`Config verified: ${verify.providers?.length || 0} providers in store`)
      } catch (e) {
        log.error('Failed to verify saved config:', e)
      }
    }
    
    return success
  })

  // Commands and tools handlers
  ipcMain.handle('get-commands', () => {
    try {
      // Try development path first
      const devPath = join(__dirname, '../../../../resources/reference_data/commands_snapshot.json')
      const prodPath = join(__dirname, '../../resources/reference_data/commands_snapshot.json')
      
      const commandsPath = existsSync(devPath) ? devPath : prodPath
      
      if (existsSync(commandsPath)) {
        const data = readFileSync(commandsPath, 'utf-8')
        return JSON.parse(data)
      }
      return []
    } catch (error) {
      log.error('Failed to load commands:', error)
      return []
    }
  })

  ipcMain.handle('get-tools', () => {
    try {
      // Try development path first
      const devPath = join(__dirname, '../../../../resources/reference_data/tools_snapshot.json')
      const prodPath = join(__dirname, '../../resources/reference_data/tools_snapshot.json')
      
      const toolsPath = existsSync(devPath) ? devPath : prodPath
      
      if (existsSync(toolsPath)) {
        const data = readFileSync(toolsPath, 'utf-8')
        return JSON.parse(data)
      }
      return []
    } catch (error) {
      log.error('Failed to load tools:', error)
      return []
    }
  })

  // Subsystems handler
  ipcMain.handle('get-subsystems', () => {
    return [
      { name: 'commands', file_count: 1, notes: 'Command surface' },
      { name: 'tools', file_count: 1, notes: 'Tool surface' },
      { name: 'runtime', file_count: 1, notes: 'Runtime orchestration' },
      { name: 'query_engine', file_count: 1, notes: 'Query engine' },
      { name: 'session_store', file_count: 1, notes: 'Session storage' },
      { name: 'permissions', file_count: 1, notes: 'Permission management' }
    ]
  })

  // Route prompt handler - 使用新的 CLI 运行时引擎
  ipcMain.handle('route-prompt', (_event, prompt: string) => {
    const matches = runtimeEngine.routePrompt(prompt, 5)
    return matches
  })

  // CLI 命令执行 handler
  ipcMain.handle('cli:execute-command', async (_event, { name, prompt, cwd }: { name: string; prompt: string; cwd: string }) => {
    try {
      const result = await commandRegistry.execute(name, prompt, {
        cwd,
        sessionId: undefined,
        config: {}
      })
      return result
    } catch (error) {
      log.error('Failed to execute command:', error)
      return {
        success: false,
        handled: false,
        message: `Error: ${String(error)}`
      }
    }
  })

  // CLI 工具执行 handler
  ipcMain.handle('cli:execute-tool', async (_event, { name, args, cwd }: { name: string; args: Record<string, unknown>; cwd: string }) => {
    try {
      const result = await toolRegistry.execute(name, args, {
        cwd,
        sessionId: undefined,
        permissionMode: 'moderate'
      })
      return result
    } catch (error) {
      log.error('Failed to execute tool:', error)
      return {
        success: false,
        output: '',
        error: String(error)
      }
    }
  })

  // CLI 会话创建 handler
  ipcMain.handle('cli:create-session', (_event, { prompt, cwd }: { prompt: string; cwd: string }) => {
    const session = runtimeEngine.createSession(prompt, cwd)
    return {
      id: session.id,
      prompt: session.prompt,
      cwd: session.cwd,
      createdAt: session.createdAt.toISOString()
    }
  })

  // CLI 回合执行 handler
  ipcMain.handle('cli:execute-turn', async (_event, { sessionId, prompt }: { sessionId: string; prompt: string }) => {
    try {
      const result = await runtimeEngine.executeTurn(sessionId, prompt)
      return result
    } catch (error) {
      log.error('Failed to execute turn:', error)
      return {
        prompt,
        output: `Error: ${String(error)}`,
        matchedCommands: [],
        matchedTools: [],
        permissionDenials: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: 'error'
      }
    }
  })

  // CLI 获取所有命令 handler
  ipcMain.handle('cli:get-commands', () => {
    return commandRegistry.getAll().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      sourceHint: cmd.sourceHint,
      responsibility: cmd.responsibility
    }))
  })

  // CLI 获取所有工具 handler
  ipcMain.handle('cli:get-tools', () => {
    return toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      sourceHint: tool.sourceHint,
      responsibility: tool.responsibility,
      parameters: tool.parameters,
      required: tool.required
    }))
  })

  // Window control handlers
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    mainWindow?.close()
  })

  // Git service handlers
  ipcMain.handle('git:status', async (_event, repoPath: string) => {
    return await getGitStatus(repoPath)
  })

  ipcMain.handle('git:is-repo', (_event, dirPath: string) => {
    return isGitRepository(dirPath)
  })

  ipcMain.handle('git:find-root', (_event, startPath: string) => {
    return findGitRoot(startPath)
  })

  ipcMain.handle('git:file-status', (_event, { repoPath, filePath }: { repoPath: string; filePath: string }) => {
    return getFileStatus(repoPath, filePath)
  })

  ipcMain.handle('git:commits', async (_event, { repoPath, count }: { repoPath: string; count?: number }) => {
    return await getRecentCommits(repoPath, count || 10)
  })

  ipcMain.handle('git:branches', async (_event, repoPath: string) => {
    return await getBranches(repoPath)
  })

  // Enhanced Git operations
  ipcMain.handle('git:stage', async (_event, { repoPath, files }: { repoPath: string; files: string[] }) => {
    return await stageFiles(repoPath, files)
  })

  ipcMain.handle('git:unstage', async (_event, { repoPath, files }: { repoPath: string; files: string[] }) => {
    return await unstageFiles(repoPath, files)
  })

  ipcMain.handle('git:commit', async (_event, { repoPath, message, files }: { repoPath: string; message: string; files?: string[] }) => {
    return await commitChanges(repoPath, message, files)
  })

  ipcMain.handle('git:discard', async (_event, { repoPath, files }: { repoPath: string; files: string[] }) => {
    return await discardChanges(repoPath, files)
  })

  ipcMain.handle('git:create-branch', async (_event, { repoPath, branchName, checkout }: { repoPath: string; branchName: string; checkout?: boolean }) => {
    return await createBranch(repoPath, branchName, checkout)
  })

  ipcMain.handle('git:checkout-branch', async (_event, { repoPath, branchName }: { repoPath: string; branchName: string }) => {
    return await checkoutBranch(repoPath, branchName)
  })

  ipcMain.handle('git:delete-branch', async (_event, { repoPath, branchName, force }: { repoPath: string; branchName: string; force?: boolean }) => {
    return await deleteBranch(repoPath, branchName, force)
  })

  ipcMain.handle('git:push', async (_event, { repoPath, remote, branch }: { repoPath: string; remote?: string; branch?: string }) => {
    return await push(repoPath, remote, branch)
  })

  ipcMain.handle('git:pull', async (_event, { repoPath, remote, branch }: { repoPath: string; remote?: string; branch?: string }) => {
    return await pull(repoPath, remote, branch)
  })

  ipcMain.handle('git:diff', async (_event, { repoPath, filePath, staged }: { repoPath: string; filePath: string; staged?: boolean }) => {
    return await getFileDiff(repoPath, filePath, staged)
  })

  ipcMain.handle('git:commit-diff', async (_event, { repoPath, filePath, commitHash }: { repoPath: string; filePath: string; commitHash: string }) => {
    return await getCommitFileDiff(repoPath, filePath, commitHash)
  })

  ipcMain.handle('git:stash-list', async (_event, repoPath: string) => {
    return await getStashList(repoPath)
  })

  ipcMain.handle('git:stash', async (_event, { repoPath, message }: { repoPath: string; message?: string }) => {
    return await stashChanges(repoPath, message)
  })

  ipcMain.handle('git:stash-pop', async (_event, { repoPath, index }: { repoPath: string; index?: number }) => {
    return await popStash(repoPath, index)
  })

  // Remote branch management handlers
  ipcMain.handle('git:fetch', async (_event, { repoPath, remote }: { repoPath: string; remote?: string }) => {
    return await fetchRemote(repoPath, remote)
  })

  ipcMain.handle('git:remote-branches', async (_event, repoPath: string) => {
    return await getRemoteBranches(repoPath)
  })

  ipcMain.handle('git:delete-remote-branch', async (_event, { repoPath, remote, branch }: { repoPath: string; remote: string; branch: string }) => {
    return await deleteRemoteBranch(repoPath, remote, branch)
  })

  ipcMain.handle('git:remotes', async (_event, repoPath: string) => {
    return await getRemotes(repoPath)
  })

  // Merge handlers
  ipcMain.handle('git:merge', async (_event, { repoPath, branchName, noFastForward }: { repoPath: string; branchName: string; noFastForward?: boolean }) => {
    return await mergeBranch(repoPath, branchName, noFastForward)
  })

  ipcMain.handle('git:check-merge-conflicts', async (_event, repoPath: string) => {
    return await checkMergeConflicts(repoPath)
  })

  ipcMain.handle('git:abort-merge', async (_event, repoPath: string) => {
    return await abortMerge(repoPath)
  })

  ipcMain.handle('git:continue-merge', async (_event, { repoPath, message }: { repoPath: string; message?: string }) => {
    return await continueMerge(repoPath, message)
  })

  // Tag management handlers
  ipcMain.handle('git:tags', async (_event, repoPath: string) => {
    return await getTags(repoPath)
  })

  ipcMain.handle('git:create-tag', async (_event, { repoPath, tagName, message, commitHash }: { repoPath: string; tagName: string; message?: string; commitHash?: string }) => {
    return await createTag(repoPath, tagName, message, commitHash)
  })

  ipcMain.handle('git:delete-tag', async (_event, { repoPath, tagName }: { repoPath: string; tagName: string }) => {
    return await deleteTag(repoPath, tagName)
  })

  ipcMain.handle('git:push-tag', async (_event, { repoPath, tagName, remote }: { repoPath: string; tagName: string; remote?: string }) => {
    return await pushTag(repoPath, tagName, remote)
  })

  ipcMain.handle('git:push-all-tags', async (_event, { repoPath, remote }: { repoPath: string; remote?: string }) => {
    return await pushAllTags(repoPath, remote)
  })

  // Commit history operations handlers
  ipcMain.handle('git:revert', async (_event, { repoPath, commitHash, noEdit }: { repoPath: string; commitHash: string; noEdit?: boolean }) => {
    return await revertCommit(repoPath, commitHash, noEdit)
  })

  ipcMain.handle('git:reset', async (_event, { repoPath, commitHash, mode }: { repoPath: string; commitHash: string; mode?: 'soft' | 'mixed' | 'hard' }) => {
    return await resetToCommit(repoPath, commitHash, mode)
  })

  ipcMain.handle('git:cherry-pick', async (_event, { repoPath, commitHash, noCommit }: { repoPath: string; commitHash: string; noCommit?: boolean }) => {
    return await cherryPickCommit(repoPath, commitHash, noCommit)
  })

  ipcMain.handle('git:abort-cherry-pick', async (_event, repoPath: string) => {
    return await abortCherryPick(repoPath)
  })

  ipcMain.handle('git:continue-cherry-pick', async (_event, repoPath: string) => {
    return await continueCherryPick(repoPath)
  })

  ipcMain.handle('git:commit-details', async (_event, { repoPath, commitHash }: { repoPath: string; commitHash: string }) => {
    return await getCommitDetails(repoPath, commitHash)
  })

  // Submodule management handlers
  ipcMain.handle('git:submodules', async (_event, repoPath: string) => {
    return await getSubmodules(repoPath)
  })

  ipcMain.handle('git:add-submodule', async (_event, { repoPath, url, path, branch }: { repoPath: string; url: string; path: string; branch?: string }) => {
    return await addSubmodule(repoPath, url, path, branch)
  })

  ipcMain.handle('git:remove-submodule', async (_event, { repoPath, path }: { repoPath: string; path: string }) => {
    return await removeSubmodule(repoPath, path)
  })

  ipcMain.handle('git:update-submodule', async (_event, { repoPath, path, init }: { repoPath: string; path?: string; init?: boolean }) => {
    return await updateSubmodule(repoPath, path, init)
  })

  ipcMain.handle('git:sync-submodule', async (_event, { repoPath, path }: { repoPath: string; path?: string }) => {
    return await syncSubmodule(repoPath, path)
  })

  // File watching handlers
  ipcMain.handle('fs:watch', (_event, dirPath: string) => {
    log.info(`[IPC] Starting to watch directory: ${dirPath}`)
    return watchDirectory(dirPath, (eventType, filename) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        log.info(`[IPC] Sending fs:change event: ${eventType} - ${filename} in ${dirPath}`)
        mainWindow.webContents.send('fs:change', { eventType, filename, dirPath })
      } else {
        log.warn('[IPC] mainWindow is destroyed or not available')
      }
    })
  })

  ipcMain.handle('fs:unwatch', (_event, dirPath: string) => {
    return unwatchDirectory(dirPath)
  })

  ipcMain.handle('fs:get-gitignore', (_event, dirPath: string) => {
    return getGitIgnorePatterns(dirPath)
  })

  // File read/write handlers
  ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
    try {
      const content = readFileService(filePath)
      return { success: true, content }
    } catch (error) {
      log.error('Failed to read file:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('fs:write-file', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      writeFileService(filePath, content)
      return { success: true }
    } catch (error) {
      log.error('Failed to write file:', error)
      return { success: false, error: String(error) }
    }
  })

  // Search handlers
  ipcMain.handle('search:execute', async (_event, options: {
    query: string
    path: string
    includePattern?: string
    excludePattern?: string
    isRegex?: boolean
    isCaseSensitive?: boolean
    isWholeWords?: boolean
    maxResults?: number
    useIgnoreFiles?: boolean
  }) => {
    try {
      const result = await searchFiles(options)
      return { success: true, data: result }
    } catch (error) {
      log.error('Search execution error:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }
    }
  })

  // Note: Search history will be managed in frontend using localStorage
  // No need for IPC handlers for save/load history

  // File dialog handlers
  ipcMain.handle('show-open-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(mainWindow, options)
  })

  ipcMain.handle('show-save-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: undefined }
    return dialog.showSaveDialog(mainWindow, options)
  })

  // CLI Chat IPC handlers
  ipcMain.handle('cli-chat:create-session', (_event, { mode, cwd, initialPrompt }: { mode: 'chat' | 'agent'; cwd: string; initialPrompt?: string }) => {
    try {
      const sessionId = createCLISession(mode, cwd, initialPrompt)
      log.info(`[IPC] CLI chat session created: ${sessionId}`)
      return { success: true, sessionId }
    } catch (error) {
      log.error('[IPC] Failed to create CLI chat session:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('cli-chat:send-message', async (_event, { sessionId, message, messages, model }: { sessionId: string; message: string; messages?: Array<{ role: string; content: string }>; model?: string }) => {
    try {
      const session = getCLISession(sessionId)
      if (!session) {
        return { success: false, error: 'Session not found' }
      }

      // 使用流式发送，通过事件将数据发送回渲染进程
      // 如果提供了完整消息历史，则传递给后端
      await sendCLIMessageStream(sessionId, message, (chunk: StreamChunk) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cli-chat:stream', { sessionId, chunk })
        }
      }, messages, model)

      return { success: true }
    } catch (error) {
      log.error('[IPC] Failed to send CLI chat message:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('cli-chat:stop-session', (_event, { sessionId }: { sessionId: string }) => {
    try {
      const stopped = stopCLISession(sessionId)
      return { success: stopped }
    } catch (error) {
      log.error('[IPC] Failed to stop CLI chat session:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('cli-chat:delete-session', (_event, { sessionId }: { sessionId: string }) => {
    try {
      const deleted = deleteCLISession(sessionId)
      return { success: deleted }
    } catch (error) {
      log.error('[IPC] Failed to delete CLI chat session:', error)
      return { success: false, error: String(error) }
    }
  })

  // Reminder handlers
  ipcMain.handle('reminder:get-all', () => {
    return getAllReminders()
  })

  ipcMain.handle('reminder:add', async (_event, { content, cronExpression, targetType, targetId, description }: { content: string; cronExpression: string; targetType: 'user' | 'group'; targetId: string; description?: string }) => {
    try {
      const reminder = await addReminder(content, cronExpression, targetType, targetId, description)
      return { success: true, reminder }
    } catch (error) {
      log.error('Failed to add reminder:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('reminder:remove', async (_event, id: string) => {
    try {
      const success = await removeReminder(id)
      return { success }
    } catch (error) {
      log.error('Failed to remove reminder:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('reminder:update', async (_event, { id, updates }: { id: string; updates: Partial<{ content?: string; cronExpression?: string; enabled?: boolean }> }) => {
    try {
      const reminder = await updateReminder(id, updates)
      return { success: true, reminder }
    } catch (error) {
      log.error('Failed to update reminder:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('reminder:toggle', async (_event, id: string) => {
    try {
      const reminder = getReminderService().getReminder(id)
      if (!reminder) {
        return { success: false, error: 'Reminder not found' }
      }
      const updated = await updateReminder(id, { enabled: !reminder.enabled })
      return { success: true, reminder: updated }
    } catch (error) {
      log.error('Failed to toggle reminder:', error)
      return { success: false, error: String(error) }
    }
  })

  log.info('IPC handlers registered')
}

// Process Bridge IPC handlers
function setupProcessBridgeHandlers(): void {
  // Start a process in terminal - 支持AI意图
  ipcMain.handle('process:start-in-terminal', async (_event, { command, cwd, terminalId, aiPrompt }: { command: string; cwd: string; terminalId: string; aiPrompt?: string }) => {
    try {
      const result = await processBridge.startProcess(command, cwd, terminalId, aiPrompt)
      return result
    } catch (error) {
      log.error('Failed to start process in terminal:', error)
      return { processId: '', success: false, error: String(error) }
    }
  })

  // Stop a process
  ipcMain.handle('process:stop', async (_event, { processId }: { processId: string }) => {
    try {
      const result = await processBridge.stopProcess(processId)
      return result
    } catch (error) {
      log.error('Failed to stop process:', error)
      return { success: false, error: String(error) }
    }
  })

  // Restart a process
  ipcMain.handle('process:restart', async (_event, { processId }: { processId: string }) => {
    try {
      const result = await processBridge.restartProcess(processId)
      return result
    } catch (error) {
      log.error('Failed to restart process:', error)
      return { processId: '', success: false, error: String(error) }
    }
  })

  // Get all running processes
  ipcMain.handle('process:list', async () => {
    try {
      const processes = processBridge.getAllProcesses()
      return processes
    } catch (error) {
      log.error('Failed to list processes:', error)
      return []
    }
  })

  // Check if command should run in terminal
  ipcMain.handle('process:should-run-in-terminal', (_event, { command }: { command: string }) => {
    return processBridge.shouldRunInTerminal(command)
  })

  // 获取AI意图上下文
  ipcMain.handle('process:get-ai-intent', async (_event, { processId }: { processId: string }) => {
    try {
      return processBridge.getAIIntentContext(processId)
    } catch (error) {
      log.error('Failed to get AI intent:', error)
      return undefined
    }
  })

  // 获取项目AI历史
  ipcMain.handle('process:get-ai-history', async (_event, { cwd }: { cwd: string }) => {
    try {
      // Return empty array as this method doesn't exist on processBridge
      // This is a placeholder for future AI history tracking
      return []
    } catch (error) {
      log.error('Failed to get AI history:', error)
      return []
    }
  })

  log.info('Process bridge handlers registered')
}

// Feishu WebSocket handlers
function setupFeishuWebSocketHandlers(): void {
  // 启动飞书 WebSocket 连接
  ipcMain.handle('feishu:ws:start', async (_event, config: FeishuConfig) => {
    try {
      const wsService = await initFeishuWebSocketService(
        config,
        async (event) => {
          // 保存当前飞书会话上下文
          const message = event?.message
          if (message?.chat_id) {
            currentFeishuContext = {
              chatId: message.chat_id,
              chatType: message.chat_type === 'p2p' ? 'p2p' : 'group'
            }
            log.info(`[FeishuContext] Updated: chatId=${message.chat_id}, chatType=${currentFeishuContext.chatType}`)
          }
          
          // 将接收到的消息发送到渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('feishu:ws:message', event)
          }
          // 不返回确认消息，由渲染进程处理完 AI 回复后主动发送
          return null
        },
        (status) => {
          // 将状态变化发送到渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('feishu:ws:status', status)
          }
        }
      )
      
      const success = await wsService.start()
      log.info(`[IPC] Feishu WebSocket started: ${success}`)
      return { success }
    } catch (error) {
      log.error('[IPC] Failed to start Feishu WebSocket:', error)
      return { success: false, error: String(error) }
    }
  })

  // 停止飞书 WebSocket 连接
  ipcMain.handle('feishu:ws:stop', async () => {
    try {
      const wsService = getFeishuWebSocketService()
      if (wsService) {
        await wsService.stop()
        log.info('[IPC] Feishu WebSocket stopped')
      }
      return { success: true }
    } catch (error) {
      log.error('[IPC] Failed to stop Feishu WebSocket:', error)
      return { success: false, error: String(error) }
    }
  })

  // 获取 WebSocket 连接状态
  ipcMain.handle('feishu:ws:status', () => {
    const wsService = getFeishuWebSocketService()
    if (wsService) {
      return { success: true, status: wsService.status }
    }
    return { success: false, status: null }
  })

  // 发送消息到飞书
  ipcMain.handle('feishu:ws:send', async (_event, { content, chatId, chatType }: { content: string; chatId: string; chatType: 'group' | 'p2p' }) => {
    try {
      const wsService = getFeishuWebSocketService()
      if (!wsService) {
        log.error('[IPC] WebSocket service not initialized')
        return { success: false, error: 'WebSocket service not initialized' }
      }
      
      log.info('[IPC] Sending Feishu message:', { chatId, chatType, contentLength: content.length })
      const result = await wsService.sendMessage(content, chatId, chatType)
      log.info('[IPC] Send message result:', result)
      return result
    } catch (error) {
      log.error('[IPC] Failed to send Feishu message:', error)
      return { success: false, error: String(error) }
    }
  })

  // 回复飞书消息
  ipcMain.handle('feishu:ws:reply', async (_event, { content, messageId, chatId, chatType }: { content: string; messageId: string; chatId: string; chatType: 'group' | 'p2p' }) => {
    try {
      const wsService = getFeishuWebSocketService()
      if (!wsService) {
        log.error('[IPC] WebSocket service not initialized')
        return { success: false, error: 'WebSocket service not initialized' }
      }
      
      log.info('[IPC] Replying Feishu message:', { messageId, chatId, chatType })
      const result = await wsService.replyMessage(messageId, chatId, content, chatType)
      log.info('[IPC] Reply message result:', result)
      return result
    } catch (error) {
      log.error('[IPC] Failed to reply Feishu message:', error)
      return { success: false, error: String(error) }
    }
  })

  log.info('Feishu WebSocket handlers registered')
}

// Conversation storage handlers - TRAE风格项目级对话存储
function setupConversationHandlers(): void {
  const CONVERSATION_DIR = '.smp-code/conversations'
  const SETTINGS_FILE = '.smp-code/settings.json'

  // 确保对话目录存在
  const ensureConversationDir = (projectPath: string) => {
    const dir = join(projectPath, CONVERSATION_DIR)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  // 保存对话
  ipcMain.handle('conversation:save', async (_event, { projectPath, sessionId, messages, sessionTitle }: { 
    projectPath: string
    sessionId: string
    messages: any[]
    sessionTitle?: string
  }) => {
    try {
      if (!projectPath) {
        return { success: false, error: 'No project path provided' }
      }

      const dir = ensureConversationDir(projectPath)
      const filePath = join(dir, `${sessionId}.json`)
      
      log.info(`[conversation:save] Saving to ${filePath}, messages count: ${messages.length}`)
      
      const data = {
        sessionId,
        title: sessionTitle || `会话 ${new Date().toLocaleString()}`,
        messages,
        updatedAt: new Date().toISOString()
      }
      
      const jsonData = JSON.stringify(data, null, 2)
      log.info(`[conversation:save] JSON data length: ${jsonData.length} bytes, messages in data: ${data.messages.length}`)
      
      writeFileSync(filePath, jsonData, 'utf-8')
      
      // 验证文件是否写入成功
      if (existsSync(filePath)) {
        const stats = statSync(filePath)
        log.info(`[conversation:save] File saved successfully: ${filePath}, size: ${stats.size} bytes`)
        
        // 读取文件验证内容
        const savedContent = readFileSync(filePath, 'utf-8')
        const savedData = JSON.parse(savedContent)
        log.info(`[conversation:save] Verified: messages in file: ${savedData.messages.length}`)
      } else {
        log.error(`[conversation:save] File not found after write: ${filePath}`)
      }
      
      return { success: true }
    } catch (error) {
      log.error('Failed to save conversation:', error)
      return { success: false, error: String(error) }
    }
  })

  // 加载对话
  ipcMain.handle('conversation:load', async (_event, { projectPath, sessionId }: { 
    projectPath: string
    sessionId: string
  }) => {
    try {
      if (!projectPath) {
        return { success: false, error: 'No project path provided', messages: [] }
      }

      const filePath = join(projectPath, CONVERSATION_DIR, `${sessionId}.json`)
      
      if (!existsSync(filePath)) {
        return { success: true, messages: [] }
      }
      
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      log.info(`Conversation loaded from ${filePath}`)
      return { success: true, messages: data.messages || [], title: data.title }
    } catch (error) {
      log.error('Failed to load conversation:', error)
      return { success: false, error: String(error), messages: [] }
    }
  })

  // 加载所有会话列表
  ipcMain.handle('conversation:list-sessions', async (_event, { projectPath }: { projectPath: string }) => {
    try {
      if (!projectPath) {
        return { success: true, sessions: [] }
      }

      const dir = join(projectPath, CONVERSATION_DIR)
      
      if (!existsSync(dir)) {
        return { success: true, sessions: [] }
      }

      const files = await readdirAsync(dir)
      const sessions = []
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = join(dir, file)
            const data = JSON.parse(readFileSync(filePath, 'utf-8'))
            sessions.push({
              id: data.sessionId,
              title: data.title || `会话 ${data.updatedAt || file}`,
              updatedAt: data.updatedAt,
              messageCount: data.messages?.length || 0
            })
          } catch (e) {
            log.error(`Failed to parse session file ${file}:`, e)
          }
        }
      }
      
      // 按更新时间排序
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      
      return { success: true, sessions }
    } catch (error) {
      log.error('Failed to list sessions:', error)
      return { success: false, error: String(error), sessions: [] }
    }
  })

  // 删除会话
  ipcMain.handle('conversation:delete-session', async (_event, { projectPath, sessionId }: { 
    projectPath: string
    sessionId: string
  }) => {
    try {
      if (!projectPath) {
        return { success: false, error: 'No project path provided' }
      }

      const filePath = join(projectPath, CONVERSATION_DIR, `${sessionId}.json`)
      
      if (existsSync(filePath)) {
        await unlinkAsync(filePath)
        log.info(`Session deleted: ${filePath}`)
      }
      
      return { success: true }
    } catch (error) {
      log.error('Failed to delete session:', error)
      return { success: false, error: String(error) }
    }
  })

  // 自动保存所有会话
  ipcMain.handle('conversation:auto-save-all', async (_event, { projectPath, sessions }: { 
    projectPath: string
    sessions: any[]
  }) => {
    try {
      if (!projectPath) {
        return { success: false, error: 'No project path provided' }
      }

      const dir = ensureConversationDir(projectPath)
      
      for (const session of sessions) {
        const filePath = join(dir, `${session.id}.json`)
        const data = {
          sessionId: session.id,
          title: session.title || `会话 ${new Date().toLocaleString()}`,
          messages: session.messages || [],
          updatedAt: new Date().toISOString()
        }
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      }
      
      log.info(`All sessions auto-saved to ${dir}`)
      return { success: true }
    } catch (error) {
      log.error('Failed to auto-save sessions:', error)
      return { success: false, error: String(error) }
    }
  })

  log.info('Conversation storage handlers registered')
}

// 初始化 CLI 注册表
function initializeCLIRegistries(): void {
  // 注册内置命令
  commandRegistry.register({
    name: 'help',
    description: 'Show help information',
    sourceHint: 'builtin',
    responsibility: 'Provide help and documentation',
    execute: async () => ({
      success: true,
      handled: true,
      message: 'Available commands: help, version, status, clear. Use --help for more details.'
    })
  })

  commandRegistry.register({
    name: 'version',
    description: 'Show version information',
    sourceHint: 'builtin',
    responsibility: 'Display application version',
    execute: async () => ({
      success: true,
      handled: true,
      message: `SMP Code v${app.getVersion() || '0.1.0'}`
    })
  })

  commandRegistry.register({
    name: 'clear',
    description: 'Clear the screen',
    sourceHint: 'builtin',
    responsibility: 'Clear terminal output',
    execute: async () => ({
      success: true,
      handled: true,
      message: '\x1Bc' // ANSI clear screen
    })
  })

  commandRegistry.register({
    name: 'pwd',
    description: 'Print working directory',
    sourceHint: 'builtin',
    responsibility: 'Show current working directory',
    execute: async (_prompt, context) => ({
      success: true,
      handled: true,
      message: context.cwd
    })
  })

  // 注册内置工具
  toolRegistry.register({
    name: 'echo',
    description: 'Echo a message',
    sourceHint: 'builtin',
    responsibility: 'Echo input back to the user',
    parameters: {
      message: {
        type: 'string',
        description: 'The message to echo',
        required: true
      }
    },
    required: ['message'],
    execute: async (args) => ({
      success: true,
      output: String(args.message || ''),
      data: { echoed: args.message }
    })
  })

  toolRegistry.register({
    name: 'read_file',
    description: 'Read file contents',
    sourceHint: 'builtin',
    responsibility: 'Read the contents of a file',
    parameters: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
        required: true
      }
    },
    required: ['path'],
    execute: async (args, context) => {
      try {
        const fs = require('fs')
        const path = require('path')
        const filePath = path.resolve(context.cwd, String(args.path))
        const content = fs.readFileSync(filePath, 'utf-8')
        return {
          success: true,
          output: content,
          data: { path: filePath, size: content.length }
        }
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'write_file',
    description: 'Write content to a file',
    sourceHint: 'builtin',
    responsibility: 'Write content to a file',
    parameters: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
        required: true
      },
      content: {
        type: 'string',
        description: 'The content to write',
        required: true
      }
    },
    required: ['path', 'content'],
    execute: async (args, context) => {
      try {
        const path = require('path')
        const filePath = path.resolve(context.cwd, String(args.path))
        writeFileService(filePath, String(args.content))  // Use unified function to trigger watchers
        return {
          success: true,
          output: `File written: ${filePath}`,
          data: { path: filePath }
        }
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'execute_bash',
    description: 'Execute a bash command',
    sourceHint: 'builtin',
    responsibility: 'Execute bash commands in the terminal',
    parameters: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
        required: true
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds',
        required: false
      }
    },
    required: ['command'],
    execute: async (args, context) => {
      // 在严格模式下拒绝
      if (context.permissionMode === 'strict') {
        return {
          success: false,
          output: '',
          error: 'bash execution is gated in strict permission mode'
        }
      }

      try {
        const { execSync } = require('child_process')
        const command = String(args.command)
        const timeout = (args.timeout as number) || 30000
        const output = execSync(command, {
          cwd: context.cwd,
          encoding: 'utf-8',
          timeout,
          stdio: ['pipe', 'pipe', 'pipe']
        })
        return {
          success: true,
          output: output,
          data: { command, cwd: context.cwd }
        }
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'list_directory',
    description: 'List files and directories in a given path',
    sourceHint: 'builtin',
    responsibility: 'List the contents of a directory, including files and subdirectories',
    parameters: {
      path: {
        type: 'string',
        description: 'The directory path to list (default: current directory)',
        required: false
      }
    },
    required: [],
    execute: async (args, context) => {
      try {
        const fs = require('fs')
        const path = require('path')
        const dirPath = args.path ? path.resolve(context.cwd, String(args.path)) : context.cwd
        
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        const result = entries.map((entry: { name: string; isDirectory: () => boolean; isFile: () => boolean }) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory()
        }))
        
        return {
          success: true,
          output: JSON.stringify(result, null, 2),
          data: { path: dirPath, count: result.length }
        }
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'search_files',
    description: 'Find files matching a pattern',
    sourceHint: 'builtin',
    responsibility: 'Find files using glob patterns',
    parameters: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match',
        required: true
      }
    },
    required: ['pattern'],
    execute: async (args, context) => {
      try {
        const glob = require('glob')
        const pattern = String(args.pattern)
        const files = glob.sync(pattern, { cwd: context.cwd })
        return {
          success: true,
          output: files.join('\n'),
          data: { pattern, matches: files.length, files }
        }
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error)
        }
      }
    }
  })

  // 注册浏览网页工具
  toolRegistry.register({
    name: 'browse_website',
    description: 'Open a website URL and extract its content for analysis. Use this when you need to read web pages, documentation, or any online content. The tool will load the page in a hidden browser, wait for JavaScript to execute, and extract the main text content. Supports both http and https URLs.',
    sourceHint: 'builtin',
    responsibility: 'Open a website URL and extract its content for analysis',
    parameters: {
      url: {
        type: 'string',
        description: 'The URL to open. Can be a full URL (https://example.com) or just the domain (example.com). Both http and https protocols are supported.',
        required: true
      },
      wait_for_selector: {
        type: 'string',
        description: 'Optional CSS selector to wait for before extracting content. Useful for pages that load content dynamically. Example: ".article-content" or "#main-content"',
        required: false
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait for page load in milliseconds. Default is 30000 (30 seconds). Increase for slow-loading pages.',
        required: false
      },
      max_length: {
        type: 'number',
        description: 'Maximum length of content to return in characters. Default is 50000. Content exceeding this limit will be truncated.',
        required: false
      }
    },
    required: ['url'],
    execute: async (args, context) => {
      try {
        const url = String(args.url)
        const waitForSelector = args.wait_for_selector ? String(args.wait_for_selector) : undefined
        const timeout = args.timeout ? Number(args.timeout) : undefined
        const maxLength = args.max_length ? Number(args.max_length) : undefined

        log.info(`[browse_website] Opening URL: ${url}`)

        const result = await browseWebsite(url, {
          waitForSelector,
          timeout,
          maxLength
        })

        if (result.success) {
          const contentLength = result.metadata?.contentLength || result.content.length
          const output = `[浏览网页成功] ${result.title || '无标题'}\n\nURL: ${result.url}\n内容长度: ${contentLength} 字符\n\n内容摘要:\n${result.content.substring(0, 2000)}${result.content.length > 2000 ? '\n\n...(内容已截断)' : ''}`
          return {
            success: true,
            output,
            data: result
          }
        } else {
          return {
            success: false,
            output: '',
            error: result.error || 'Unknown error'
          }
        }
      } catch (error) {
        log.error(`[browse_website] Error:`, error)
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  })

  // 注册定时提醒工具
  toolRegistry.register({
    name: 'add_reminder',
    description: 'Add a scheduled reminder that will send messages via Feishu at specified times. Supports natural language time expressions like "every day at 9am", "workdays at 9am", "every Monday at 9am". The reminder will be sent to the current Feishu chat by default.',
    sourceHint: 'builtin',
    responsibility: 'Create scheduled reminders to send messages at specific times',
    parameters: {
      content: {
        type: 'string',
        description: 'The reminder message content to send',
        required: true
      },
      time_expression: {
        type: 'string',
        description: 'When to send the reminder. Examples: "every day at 9am", "workdays at 9am", "every Monday at 9am", "0 9 * * *" (cron format)',
        required: true
      },
      description: {
        type: 'string',
        description: 'Optional description or notes for this reminder',
        required: false
      }
    },
    required: ['content', 'time_expression'],
    execute: async (args, context) => {
      try {
        const content = String(args.content)
        const timeExpression = String(args.time_expression)
        const description = args.description ? String(args.description) : undefined

        log.info(`[add_reminder] Creating reminder: ${content}`)

        // 使用当前飞书会话上下文，如果没有则报错
        if (!currentFeishuContext.chatId) {
          return {
            success: false,
            output: '',
            error: 'No active Feishu chat context. Please use this command from a Feishu conversation.'
          }
        }

        const targetType = currentFeishuContext.chatType === 'p2p' ? 'user' : 'group'
        const targetId = currentFeishuContext.chatId

        // 解析时间表达式
        let cronExpression = timeExpression
        let displayTime = timeExpression
        let isOneTime = false
        const parsed = parseNaturalLanguageToCron(timeExpression)
        if (parsed) {
          cronExpression = parsed.cron
          displayTime = parsed.description
          isOneTime = parsed.isOneTime || false
          log.info(`[add_reminder] Parsed time expression: ${parsed.description}, isOneTime: ${isOneTime}`)
        }

        // 创建提醒
        const reminder = await addReminder(
          content,
          cronExpression,
          targetType,
          targetId,
          description,
          isOneTime
        )

        const output = `✅ 提醒已创建\n\nID: ${reminder.id}\n内容: ${reminder.content}\n时间: ${displayTime}\n目标: ${targetType === 'user' ? '私聊' : '群聊'}`

        return {
          success: true,
          output,
          data: reminder
        }
      } catch (error) {
        log.error(`[add_reminder] Error:`, error)
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'list_reminders',
    description: 'List all scheduled reminders.',
    sourceHint: 'builtin',
    responsibility: 'Show all scheduled reminders',
    parameters: {},
    required: [],
    execute: async () => {
      try {
        const reminders = getAllReminders()
        
        if (reminders.length === 0) {
          return {
            success: true,
            output: '暂无定时提醒'
          }
        }

        const reminderList = reminders.map(r => {
          const status = r.enabled ? '✅' : '⏸️'
          const lastTriggered = r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString('zh-CN') : '从未'
          return `${status} ${r.content}\n   ID: ${r.id}\n   Cron: ${r.cronExpression}\n   目标: ${r.targetType} (${r.targetId})\n   已触发: ${r.triggerCount} 次\n   上次触发: ${lastTriggered}`
        }).join('\n\n')

        return {
          success: true,
          output: `📋 定时提醒列表 (${reminders.length} 个)\n\n${reminderList}`
        }
      } catch (error) {
        log.error(`[list_reminders] Error:`, error)
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  })

  toolRegistry.register({
    name: 'remove_reminder',
    description: 'Remove a scheduled reminder by its ID.',
    sourceHint: 'builtin',
    responsibility: 'Delete a scheduled reminder',
    parameters: {
      reminder_id: {
        type: 'string',
        description: 'The ID of the reminder to remove',
        required: true
      }
    },
    required: ['reminder_id'],
    execute: async (args) => {
      try {
        const id = String(args.reminder_id)
        const success = await removeReminder(id)

        if (success) {
          return {
            success: true,
            output: `✅ 提醒已删除: ${id}`
          }
        } else {
          return {
            success: false,
            output: '',
            error: `提醒不存在: ${id}`
          }
        }
      } catch (error) {
        log.error(`[remove_reminder] Error:`, error)
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  })

  log.info(`CLI registries initialized: ${commandRegistry.getAll().length} commands, ${toolRegistry.getAll().length} tools`)
}

// 检查是否以 CLI 模式运行
function isCLIMode(): boolean {
  // 获取所有参数（包括 Electron 内部参数）
  const args = process.argv
  
  // 检查是否是打包后的应用启动
  // 打包后的应用：process.argv[0] 是 Electron 可执行文件，process.argv[1] 是主脚本
  // 开发模式：process.argv 可能包含更多参数
  const isPackaged = app.isPackaged
  
  // 如果是打包后的应用且没有额外的命令行参数，则是 GUI 模式
  if (isPackaged && args.length <= 2) {
    return false
  }
  
  // 获取用户传入的参数（排除 Electron 内部参数）
  const userArgs = args.slice(2)
  
  // 如果没有用户参数，则是 GUI 模式
  if (userArgs.length === 0) {
    return false
  }
  
  // 如果包含 --cli 参数或明确的子命令，则启用 CLI 模式
  return userArgs.includes('--cli') || 
         userArgs.includes('chat') || 
         userArgs.includes('run') || 
         userArgs.includes('exec') ||
         userArgs.includes('status') ||
         userArgs.includes('config') ||
         userArgs.includes('commands') ||
         userArgs.includes('tools') ||
         userArgs.includes('session') ||
         userArgs.includes('route')
}

// 运行 CLI 模式
async function runCLIMode(): Promise<void> {
  log.info('Starting CLI mode...')
  
  // 移除 --cli 参数
  const args = process.argv.slice(2).filter(arg => arg !== '--cli')
  
  // 初始化 CLI 注册表
  initializeCLIRegistries()
  
  // 动态导入 CLI 程序（避免在 GUI 模式下初始化）
  try {
    const { getCLIProgram } = await import('./cli/cli-entry')
    const cliProgram = getCLIProgram()
    await cliProgram.parseAsync(args.length > 0 ? args : ['--help'])
  } catch (error) {
    log.error('CLI error:', error)
    console.error('Error:', error)
    process.exit(1)
  }
  
  // 清理并退出
  runtimeEngine.cleanup()
  process.exit(0)
}

// App lifecycle
app.whenReady().then(async () => {
  log.info('App ready, initializing...')

  // 检查是否以 CLI 模式运行
  if (isCLIMode()) {
    await runCLIMode()
    return
  }

  // Start API server
  try {
    await startApiServer()
    log.info('API server started')
  } catch (error) {
    log.error('Failed to start API server:', error)
  }

  // 初始化 CLI 注册表（GUI 模式下也初始化，以便 IPC 调用）
  initializeCLIRegistries()

  setupIpcHandlers()
  createWindow()

  // Initialize terminal service after window is created
  // Note: createWindow() sets mainWindow, so we check it here
  if (mainWindow) {
    initTerminalService(mainWindow)
    processBridge.setWindow(mainWindow)
    log.info('Terminal service initialized')
  } else {
    log.error('Failed to initialize terminal service: mainWindow is null')
  }

  // Initialize tool executor
  log.info('[Main] Initializing tool executor...')
  try {
    initializeToolExecutor()
    log.info('[Main] Tool executor initialized successfully')
  } catch (error) {
    log.error('[Main] Failed to initialize tool executor:', error)
  }

  // Setup process bridge IPC handlers
  setupProcessBridgeHandlers()
  
  // Setup Feishu WebSocket handlers
  setupFeishuWebSocketHandlers()
  
  // Setup conversation storage handlers
  setupConversationHandlers()
  
  // Initialize reminder service
  log.info('[Main] Initializing reminder service...')
  try {
    await initReminderService()
    log.info('[Main] Reminder service initialized successfully')
  } catch (error) {
    log.error('[Main] Failed to initialize reminder service:', error)
  }
  
  createTray()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  log.info('[Main] Application before-quit event triggered')
  isQuitting = true
  
  // ✅ 修复：按照正确顺序清理所有资源，防止崩溃
  try {
    // 1. 停止全局快捷键
    globalShortcut.unregisterAll()
    log.info('[Main] Global shortcuts unregistered')
    
    // 2. 停止所有CLI会话（防止递归调用继续）
    cleanupCLISessions()
    log.info('[Main] CLI sessions cleaned up')
    
    // 3. 停止所有文件监听器
    stopAllWatchers()
    log.info('[Main] File watchers stopped')
    
    // 4. 清理所有进程和终端
    processBridge.cleanupAll()
    log.info('[Main] Process bridge cleaned up')
    
    // 5. 清理终端服务
    cleanupTerminals()
    log.info('[Main] Terminals cleaned up')
    
    // 6. 停止API服务器
    stopApiServer()
    log.info('[Main] API server stopped')
    
    log.info('[Main] All resources cleaned up successfully')
  } catch (error) {
    log.error('[Main] Error during cleanup:', error)
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})