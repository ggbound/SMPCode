import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, shell, dialog, nativeTheme } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, existsSync, readFile, writeFileSync, mkdirSync, readdir, unlink } from 'fs'
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
import { 
  getGitStatus,
  isGitRepository,
  findGitRoot,
  getFileStatus,
  getRecentCommits,
  getBranches
} from './services/git-service'
import { 
  watchDirectory,
  unwatchDirectory,
  stopAllWatchers,
  getGitIgnorePatterns
} from './services/files-service'
import { searchFiles } from './services/search-service'

// Configure logging
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
      sandbox: false
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
      label: '会话',
      submenu: [
        { label: '新建会话', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('new-session') },
        { label: '打开会话', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('open-session') }
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
      label: 'Copilot',
      submenu: [
        { label: '触发内联编辑', accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('copilot-inline-edit') },
        { label: '解释选中代码', accelerator: 'CmdOrCtrl+Shift+E', click: () => mainWindow?.webContents.send('copilot-explain') },
        { label: '重构选中代码', accelerator: 'CmdOrCtrl+Alt+R', click: () => mainWindow?.webContents.send('copilot-refactor') },
        { type: 'separator' },
        { label: '切换 Copilot', accelerator: 'CmdOrCtrl+Shift+C', click: () => mainWindow?.webContents.send('copilot-toggle') },
        { label: '接受补全', accelerator: 'Tab', click: () => mainWindow?.webContents.send('copilot-accept') },
        { label: '取消补全', accelerator: 'Esc', click: () => mainWindow?.webContents.send('copilot-dismiss') }
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
          click: async () => { await shell.openExternal('https://github.com/instructkr/claw-code') }
        },
        {
          label: '报告问题',
          click: async () => { await shell.openExternal('https://github.com/instructkr/claw-code/issues') }
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

  // File watching handlers
  ipcMain.handle('fs:watch', (_event, dirPath: string) => {
    return watchDirectory(dirPath, (eventType, filename) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:change', { eventType, filename, dirPath })
      }
    })
  })

  ipcMain.handle('fs:unwatch', (_event, dirPath: string) => {
    return unwatchDirectory(dirPath)
  })

  ipcMain.handle('fs:get-gitignore', (_event, dirPath: string) => {
    return getGitIgnorePatterns(dirPath)
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
      
      const data = {
        sessionId,
        title: sessionTitle || `会话 ${new Date().toLocaleString()}`,
        messages,
        updatedAt: new Date().toISOString()
      }
      
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      log.info(`Conversation saved to ${filePath}`)
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
    name: 'file_read',
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
    name: 'file_write',
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
        const fs = require('fs')
        const path = require('path')
        const filePath = path.resolve(context.cwd, String(args.path))
        fs.writeFileSync(filePath, String(args.content), 'utf-8')
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
    name: 'bash',
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
    name: 'glob',
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

  // Setup process bridge IPC handlers
  setupProcessBridgeHandlers()
  
  // Setup conversation storage handlers
  setupConversationHandlers()
  
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
  isQuitting = true
  globalShortcut.unregisterAll()
  cleanupTerminals()
  processBridge.cleanupAll()
  stopApiServer()
  stopAllWatchers()
  log.info('Application quitting')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})