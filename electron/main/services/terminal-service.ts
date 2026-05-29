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
  dataFlushTimer?: NodeJS.Timeout  // 批量发送定时器
  pendingData: string  // 待发送的数据缓冲区
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
      
      log.info(`[Terminal] Creating terminal with shell: ${shellConfig.command}, cwd: ${cwd}`)
      log.info(`[Terminal] Options received: ${JSON.stringify(options)}`)
      log.info(`[Terminal] process.env.SHELL: ${process.env.SHELL}`)
      
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
        // Strategy 1: Use detected shell (prefer zsh on macOS)
        () => {
          log.info(`Strategy 1: Spawning ${shellConfig.command} (system default shell)`)
          return pty.spawn(shellConfig.command, shellConfig.args.length > 0 ? shellConfig.args : ['-l'], spawnOptions)
        },
        // Strategy 2: Use /usr/bin/env with detected shell
        () => {
          log.info(`Strategy 2: Using /usr/bin/env ${shellConfig.command}`)
          return pty.spawn('/usr/bin/env', [shellConfig.command, '-l'], { ...spawnOptions })
        },
        // Strategy 3: Use /bin/zsh as fallback for macOS
        () => {
          log.info('Strategy 3: Falling back to /bin/zsh')
          return pty.spawn('/bin/zsh', ['-l'], spawnOptions)
        },
        // Strategy 4: Use /bin/bash as last fallback
        () => {
          log.info('Strategy 4: Falling back to /bin/bash')
          return pty.spawn('/bin/bash', ['-l'], spawnOptions)
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
        onDataCallbacks: new Set(),
        pendingData: ''  // 初始化待发送数据缓冲区
      }

      terminals.set(id, session)

      // ✅ 性能优化：定期清理过期的终端会话（防止内存泄漏）
      const MAX_TERMINALS = 50  // 最多保留50个终端
      if (terminals.size > MAX_TERMINALS) {
        // 删除最早的终端
        const oldestId = Array.from(terminals.keys())[0]
        const oldestSession = terminals.get(oldestId)
        if (oldestSession) {
          log.warn(`[Terminal] Terminal count exceeded ${MAX_TERMINALS}, removing oldest terminal: ${oldestId}`)
          try {
            oldestSession.pty.kill()
          } catch (error) {
            log.error(`[Terminal] Failed to kill oldest terminal:`, error)
          }
          terminals.delete(oldestId)
        }
      }

      // Handle data from PTY - 使用批量发送机制减少IPC调用频率
      const FLUSH_INTERVAL = 50 // 50ms批量发送一次
      
      ptyProcess.onData((data) => {
        // 存储输出到缓冲区
        session.outputBuffer.push(data)
        // 限制缓冲区大小，防止内存溢出
        if (session.outputBuffer.length > 10000) {
          session.outputBuffer = session.outputBuffer.slice(-5000)
        }
        // 触发回调（实时）
        session.onDataCallbacks.forEach(callback => callback(data))
        
        // 批量发送到前端（性能优化）
        session.pendingData += data
        
        if (!session.dataFlushTimer) {
          session.dataFlushTimer = setTimeout(() => {
            if (session.pendingData && windowRef && !windowRef.isDestroyed()) {
              windowRef.webContents.send('terminal:data', { 
                id: session.id, 
                data: session.pendingData 
              })
              session.pendingData = ''
            }
            session.dataFlushTimer = undefined
          }, FLUSH_INTERVAL)
        }
      })

      // Handle exit
      ptyProcess.onExit(({ exitCode }) => {
        // ✅ 性能优化：退出码 1 通常是正常终止（SIGTERM），降低日志级别
        if (exitCode === 1 || exitCode === null) {
          log.debug(`[Terminal] Terminal ${id} exited with code ${exitCode} (normal cleanup)`)
        } else {
          log.info(`[Terminal] Terminal ${id} exited with code ${exitCode}`)
        }
        if (windowRef && !windowRef.isDestroyed()) {
          windowRef.webContents.send('terminal:exit', { id, exitCode })
        }
        // 清理定时器
        if (session.dataFlushTimer) {
          clearTimeout(session.dataFlushTimer)
          session.dataFlushTimer = undefined
        }
        terminals.delete(id)
        
        // 性能优化：在下一个事件循环清理无效进程记录
        setImmediate(() => {
          try {
            // 动态导入避免循环依赖
            import('./process-terminal-bridge').then(({ processBridge }) => {
              if (processBridge) {
                processBridge.cleanupInvalidProcesses()
              }
            }).catch(err => {
              log.error(`[Terminal] Failed to cleanup processes:`, err)
            })
          } catch (error) {
            log.error(`[Terminal] Failed to import process-terminal-bridge:`, error)
          }
        })
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
      log.info(`[Terminal] Killing terminal: ${id}`)
      // 清理定时器
      if (session.dataFlushTimer) {
        clearTimeout(session.dataFlushTimer)
        session.dataFlushTimer = undefined
      }
      // kill PTY进程
      try {
        session.pty.kill()
      } catch (error) {
        log.error(`[Terminal] Failed to kill PTY for terminal ${id}:`, error)
      }
      terminals.delete(id)
      log.info(`[Terminal] Killed terminal ${id}`)
      
      // 注意：ProcessBridge的清理会在terminal:exit事件中自动触发
    } else {
      log.warn(`[Terminal] Terminal ${id} not found, already cleaned up`)
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
    log.info(`[Terminal] Writing ${data.length} bytes to terminal ${id}: ${JSON.stringify(data.substring(0, 100))}`)
    session.pty.write(data)
    return true
  }
  log.warn(`[Terminal] Terminal ${id} not found for writing`)
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
