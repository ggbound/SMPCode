import * as pty from 'node-pty'
import { ipcMain, BrowserWindow, app } from 'electron'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

export interface TerminalSession {
  id: string
  name: string
  pty: pty.IPty
  createdAt: Date
  outputBuffer: string[]  // 存储终端输出
  onDataCallbacks: Set<(data: string) => void>  // 数据监听回调
}

const terminals = new Map<string, TerminalSession>()
let windowRef: BrowserWindow | null = null

function getShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: [] }
  }
  
  // On macOS, try common shells
  if (process.platform === 'darwin') {
    const possibleShells = [
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/usr/local/bin/zsh',
      '/usr/local/bin/bash',
      '/opt/homebrew/bin/zsh',
      '/opt/homebrew/bin/bash'
    ]

    for (const shell of possibleShells) {
      if (shell && existsSync(shell)) {
        log.info(`Using macOS shell: ${shell}`)
        return { command: shell, args: [] }
      }
    }

    // Last resort fallback
    log.warn('No shell found, falling back to /bin/zsh')
    return { command: '/bin/zsh', args: [] }
  }
  
  // Linux: Try common shell paths
  const possibleShells = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/zsh',
    '/usr/bin/bash'
  ]
  
  for (const shell of possibleShells) {
    if (shell && existsSync(shell)) {
      log.info(`Using shell: ${shell}`)
      return { command: shell, args: [] }
    }
  }

  // Fallback to bash if nothing found
  log.warn('No shell found, falling back to /bin/bash')
  return { command: '/bin/bash', args: [] }
}

function getSafeCwd(cwd?: string): string {
  // Use provided cwd if it exists and is valid
  if (cwd && existsSync(cwd)) {
    return cwd
  }
  
  // Try process.cwd()
  try {
    const pcwd = process.cwd()
    if (existsSync(pcwd)) {
      return pcwd
    }
  } catch (e) {
    // ignore
  }
  
  // Fallback to home directory
  const home = homedir()
  if (home && existsSync(home)) {
    return home
  }
  
  // Last resort
  return '/'
}

export function initTerminalService(mainWindow: BrowserWindow): void {
  windowRef = mainWindow

  // Create new terminal
  ipcMain.handle('terminal:create', async (_, options?: { name?: string; cwd?: string; id?: string }) => {
    try {
      // Use provided id or generate new one
      const id = options?.id || uuidv4()
      const shellConfig = getShell()
      const cwd = getSafeCwd(options?.cwd)
      
      log.info(`Creating terminal with command: ${shellConfig.command}, args: ${JSON.stringify(shellConfig.args)}, cwd: ${cwd}`)
      
      // Verify shell exists
      if (!existsSync(shellConfig.command)) {
        throw new Error(`Shell not found: ${shellConfig.command}`)
      }

      // Prepare environment
      const env = { ...process.env } as { [key: string]: string }
      
      // Ensure PATH includes common directories
      const pathDirs = [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        '/opt/homebrew/bin',
        join(homedir(), '.local', 'bin'),
        join(homedir(), 'bin')
      ]
      
      const currentPath = env.PATH || ''
      const newPath = [...pathDirs, ...currentPath.split(':')].filter(Boolean).join(':')
      env.PATH = newPath
      
      log.info(`Creating PTY with cwd: ${cwd}, shell: ${shellConfig.command}`)

      // Use a simpler spawn configuration to avoid posix_spawnp issues on macOS
      const spawnOptions: pty.IPtyForkOptions = {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env
      }

      // On macOS, try without args first to avoid posix_spawnp issues
      let ptyProcess: pty.IPty | undefined
      let lastError: Error | null = null
      
      // Try multiple strategies in order of preference
      const spawnStrategies = [
        // Strategy 1: Use /usr/bin/env with bash (most compatible)
        () => {
          log.info('Strategy 1: Using /usr/bin/env bash')
          return pty.spawn('/usr/bin/env', ['bash'], { ...spawnOptions })
        },
        // Strategy 2: Use detected shell without args
        () => {
          log.info(`Strategy 2: Spawning ${shellConfig.command} without args`)
          return pty.spawn(shellConfig.command, [], spawnOptions)
        },
        // Strategy 3: Use /bin/bash as fallback
        () => {
          log.info('Strategy 3: Falling back to /bin/bash')
          return pty.spawn('/bin/bash', [], spawnOptions)
        },
        // Strategy 4: Use /bin/sh as last resort
        () => {
          log.info('Strategy 4: Falling back to /bin/sh')
          return pty.spawn('/bin/sh', [], spawnOptions)
        }
      ]
      
      for (const strategy of spawnStrategies) {
        try {
          ptyProcess = strategy()
          log.info('Terminal spawned successfully')
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          log.warn(`Spawn strategy failed: ${lastError.message}`)
        }
      }
      
      if (!ptyProcess) {
        throw new Error(`Failed to spawn terminal after trying all strategies. Last error: ${lastError?.message}`)
      }

      const session: TerminalSession = {
        id,
        name: options?.name || `Terminal ${terminals.size + 1}`,
        pty: ptyProcess,
        createdAt: new Date(),
        outputBuffer: [],
        onDataCallbacks: new Set()
      }

      terminals.set(id, session)

      // Handle data from PTY
      ptyProcess.onData((data) => {
        // 存储输出到缓冲区
        session.outputBuffer.push(data)
        // 限制缓冲区大小，防止内存溢出
        if (session.outputBuffer.length > 10000) {
          session.outputBuffer = session.outputBuffer.slice(-5000)
        }
        // 触发回调
        session.onDataCallbacks.forEach(callback => callback(data))
        // 发送到前端
        if (windowRef && !windowRef.isDestroyed()) {
          windowRef.webContents.send('terminal:data', { id, data })
        }
      })

      // Handle exit
      ptyProcess.onExit(({ exitCode }) => {
        log.info(`Terminal ${id} exited with code ${exitCode}`)
        if (windowRef && !windowRef.isDestroyed()) {
          windowRef.webContents.send('terminal:exit', { id, exitCode })
        }
        terminals.delete(id)
      })

      log.info(`Created terminal ${id} with shell ${shellConfig.command}`)
      return { id, name: session.name }
    } catch (error) {
      log.error('Failed to create terminal:', error)
      throw error
    }
  })

  // Write to terminal
  ipcMain.handle('terminal:write', async (_, { id, data }: { id: string; data: string }) => {
    const session = terminals.get(id)
    if (session) {
      session.pty.write(data)
    }
  })

  // Resize terminal
  ipcMain.handle('terminal:resize', async (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const session = terminals.get(id)
    if (session) {
      session.pty.resize(cols, rows)
    }
  })

  // Kill terminal
  ipcMain.handle('terminal:kill', async (_, { id }: { id: string }) => {
    const session = terminals.get(id)
    if (session) {
      session.pty.kill()
      terminals.delete(id)
      log.info(`Killed terminal ${id}`)
    }
  })

  // Get all terminals
  ipcMain.handle('terminal:list', async () => {
    return Array.from(terminals.values()).map(t => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt
    }))
  })

  // Rename terminal
  ipcMain.handle('terminal:rename', async (_, { id, name }: { id: string; name: string }) => {
    const session = terminals.get(id)
    if (session) {
      session.name = name
    }
  })
}

export function cleanupTerminals(): void {
  for (const [id, session] of terminals) {
    try {
      session.pty.kill()
      log.info(`Cleaned up terminal ${id}`)
    } catch (error) {
      log.error(`Failed to cleanup terminal ${id}:`, error)
    }
  }
  terminals.clear()
}

// Export function to get all terminals
export function getTerminals(): Map<string, TerminalSession> {
  return terminals
}

// Export function to write to a specific terminal
export function writeToTerminal(id: string, data: string): boolean {
  const session = terminals.get(id)
  if (session) {
    session.pty.write(data)
    return true
  }
  return false
}

// Export function to get terminal output buffer
export function getTerminalOutput(id: string): string[] | null {
  const session = terminals.get(id)
  if (session) {
    return session.outputBuffer
  }
  return null
}

// Export function to register data callback for a terminal
export function onTerminalData(id: string, callback: (data: string) => void): (() => void) | null {
  const session = terminals.get(id)
  if (session) {
    session.onDataCallbacks.add(callback)
    // Return unsubscribe function
    return () => {
      session.onDataCallbacks.delete(callback)
    }
  }
  return null
}

// Export function to clear terminal output buffer
export function clearTerminalOutput(id: string): boolean {
  const session = terminals.get(id)
  if (session) {
    session.outputBuffer = []
    return true
  }
  return false
}
