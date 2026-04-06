import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, shell, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, readFile } from 'fs'
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

// Configure logging
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('Application starting...')

// Global exception handler
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
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
        { label: 'About SMP Code', role: 'about' },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('open-settings') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit() } }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Toggle DevTools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Session',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-session') },
        { label: 'New Session (Global)', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('new-session') }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => { await shell.openExternal('https://github.com/instructkr/claw-code') }
        },
        {
          label: 'Report Issue',
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

  // Route prompt handler
  ipcMain.handle('route-prompt', (_event, prompt: string) => {
    // Simple routing based on keywords
    const commands = ['add-dir', 'agents', 'branch', 'btw', 'git', 'npm', 'docker', 'build', 'test', 'deploy']
    const tools = ['bash', 'file', 'glob', 'grep', 'edit', 'write', 'read', 'mcp']

    const matches: Array<{ kind: string; name: string; score: number }> = []
    const lowerPrompt = prompt.toLowerCase()

    // Check commands
    for (const cmd of commands) {
      if (lowerPrompt.includes(cmd)) {
        matches.push({ kind: 'command', name: cmd, score: 1 })
      }
    }

    // Check tools
    for (const tool of tools) {
      if (lowerPrompt.includes(tool)) {
        matches.push({ kind: 'tool', name: tool, score: 1 })
      }
    }

    return matches.slice(0, 5)
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

  // File dialog handlers
  ipcMain.handle('show-open-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(mainWindow, options)
  })

  ipcMain.handle('show-save-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: undefined }
    return dialog.showSaveDialog(mainWindow, options)
  })

  // Select folder handler
  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Folder'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  log.info('IPC handlers registered')
}

// Process Bridge IPC handlers
function setupProcessBridgeHandlers(): void {
  // Start a process in terminal
  ipcMain.handle('process:start-in-terminal', async (_event, { command, cwd, terminalId }: { command: string; cwd: string; terminalId: string }) => {
    try {
      const result = await processBridge.startProcess(command, cwd, terminalId)
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

  log.info('Process bridge handlers registered')
}

// App lifecycle
app.whenReady().then(async () => {
  log.info('App ready, initializing...')

  // Start API server
  try {
    await startApiServer()
    log.info('API server started')
  } catch (error) {
    log.error('Failed to start API server:', error)
  }

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
  log.info('Application quitting')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})