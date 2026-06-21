import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Plus } from 'lucide-react'
import { t } from '../i18n'

interface TerminalProps {
  isVisible: boolean
  projectPath?: string | null
  onOpenUrl?: (url: string) => void
}

// AI意图上下文
interface AIIntentContext {
  intentId: string
  originalPrompt: string
  taskType: string
  projectContext: {
    name: string
    path: string
    type?: string
  }
  expectedOutcome: string
  createdAt: string
  lastAccessedAt: string
  accessCount: number
}

export interface TerminalRef {
  executeCommand: (command: string, cwd?: string, aiPrompt?: string) => Promise<void>
}

interface RunningProcess {
  id: string
  command: string
  isRunning: boolean
  startTime: string
  cwd: string
  terminalId?: string
  // AI意图相关
  aiIntent?: AIIntentContext
  reused?: boolean
  taskType?: string
}

interface TerminalSession {
  id: string
  name: string
  xterm: XTerm | null
  fitAddon: FitAddon | null
  isActive: boolean
  isProcessTerminal?: boolean
  processCommand?: string
  aiIntent?: AIIntentContext
}

// Window API 类型在 env.d.ts 中全局声明

const Terminal = forwardRef<TerminalRef, TerminalProps>(({ isVisible, projectPath, onOpenUrl }, ref) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [hasError, setHasError] = useState<string | null>(null)
  const [runningProcesses, setRunningProcesses] = useState<RunningProcess[]>([])
  const [showProcessPanel, setShowProcessPanel] = useState(false)
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const sessionsRef = useRef<TerminalSession[]>([])
  // 性能优化：使用Map替代数组查找，O(1)复杂度
  const sessionsMapRef = useRef<Map<string, TerminalSession>>(new Map())
  const initializedRef = useRef(false)
  const processDataBuffer = useRef<Map<string, string[]>>(new Map())

  // Expose executeCommand method via ref - 支持AI提示
  useImperativeHandle(ref, () => ({
    executeCommand: executeCommandInTerminal
  }))

  // Keep ref in sync with state
  useEffect(() => {
    sessionsRef.current = sessions
    // 同步更新Map
    sessionsMapRef.current.clear()
    sessions.forEach(session => {
      sessionsMapRef.current.set(session.id, session)
    })
  }, [sessions])

  // Load running processes
  useEffect(() => {
    if (isVisible && window.api?.getRunningProcesses) {
      window.api.getRunningProcesses().then(processes => {
        setRunningProcesses(processes)
      })
    }
  }, [isVisible])

  // Listen for process events
  useEffect(() => {
    if (!window.api) return

    const removeStartedListener = window.api.onProcessStarted((_, data) => {
      setRunningProcesses(prev => {
        // Avoid duplicate entries
        if (prev.find(p => p.id === data.processId)) {
          return prev
        }
        return [...prev, {
          id: data.processId,
          command: data.command,
          isRunning: true,
          startTime: new Date().toISOString(),
          cwd: data.cwd,
          terminalId: data.terminalId || 'any',
          taskType: data.taskType
        }]
      })
      
      // Auto-create terminal for dedicated terminal IDs (e.g., "terminal-server:npm-dev")
      if (data.terminalId && data.terminalId.startsWith('terminal-')) {
        const terminalId = data.terminalId
        // Check if terminal already exists
        const existingSession = sessionsRef.current.find(s => s.id === terminalId)
        if (!existingSession) {
          // Extract command type from terminalId (e.g., "server:npm-dev" from "terminal-server:npm-dev")
          const commandType = terminalId.replace('terminal-', '')
          createTerminalForProcess(terminalId, commandType, data.cwd, data.taskType)
        }
      }
      
      // Note: Command is already shown by zsh shell itself, no need to write it again
      // This avoids duplicate command display in terminal
    })

    const removeDataListener = window.api.onProcessData((_, data) => {
      // Handle 'any' terminalId (broadcast to all) or specific terminalId
      // 性能优化：使用Map查找
      if (data.terminalId === 'any') {
        // Write to active terminal using activeSessionId
        const activeSession = sessionsMapRef.current.get(activeSessionId || '')
        if (activeSession?.xterm) {
          activeSession.xterm.write(data.data)
        }
      } else {
        const session = sessionsMapRef.current.get(data.terminalId)
        if (session?.xterm) {
          session.xterm.write(data.data)
        }
      }
    })

    const removeExitListener = window.api.onProcessExit((_, data) => {
      setRunningProcesses(prev => prev.map(p =>
        p.id === data.processId ? { ...p, isRunning: false } : p
      ))
      // 性能优化：使用Map查找
      if (data.terminalId === 'any') {
        const activeSession = sessionsMapRef.current.get(activeSessionId || '')
        if (activeSession?.xterm) {
          activeSession.xterm.write(`\r\n--- Process exited with code ${data.exitCode} ---\r\n`)
        }
      } else {
        const session = sessionsMapRef.current.get(data.terminalId)
        if (session?.xterm) {
          session.xterm.write(`\r\n--- Process exited with code ${data.exitCode} ---\r\n`)
        }
      }
    })

    const removeErrorListener = window.api.onProcessError((_, data) => {
      setRunningProcesses(prev => prev.map(p =>
        p.id === data.processId ? { ...p, isRunning: false } : p
      ))
      // 性能优化：使用Map查找
      if (data.terminalId === 'any') {
        const activeSession = sessionsMapRef.current.get(activeSessionId || '')
        if (activeSession?.xterm) {
          activeSession.xterm.write(`\r\n[Error] ${data.error}\r\n`)
        }
      } else {
        const session = sessionsMapRef.current.get(data.terminalId)
        if (session?.xterm) {
          session.xterm.write(`\r\n[Error] ${data.error}\r\n`)
        }
      }
    })

    // Listen for terminal create requests from main process
    const removeCreateListener = window.api.onTerminalCreateRequest(async (_, data) => {
      // Check if terminal already exists - 性能优化：使用Map查找
      const existingSession = sessionsMapRef.current.get(data.id)
      if (!existingSession) {
        // 等待终端创建完成
        await createTerminalForProcess(data.id, data.title || 'Process', data.cwd || '')
      } else {
      }
    })

    return () => {
      removeStartedListener()
      removeDataListener()
      removeExitListener()
      removeErrorListener()
      removeCreateListener()
    }
  }, [activeSessionId])

  // Create a terminal specifically for a process (with fixed ID) - 支持AI意图
  const createTerminalForProcess = useCallback(async (terminalId: string, commandType: string, cwd: string, taskType?: string) => {
    if (isCreating) {
      // Wait a bit and retry
      setTimeout(() => createTerminalForProcess(terminalId, commandType, cwd), 100)
      return
    }
    
    setIsCreating(true)
    setHasError(null)

    try {
      if (!window.api?.createTerminal) {
        throw new Error('Terminal API not available.')
      }
      
      // Create terminal with specific ID and name showing the command type
      const displayName = commandType.replace(':', ' - ')
      const options = { 
        id: terminalId,  // Use custom ID for process routing
        name: displayName,
        cwd: cwd 
      }
      const result = await window.api.createTerminal(options)
      
      // Use the terminalId as the session ID for process routing
      const session: TerminalSession = {
        id: terminalId,
        name: displayName,
        xterm: null,
        fitAddon: null,
        isActive: true,
        isProcessTerminal: true,
        processCommand: commandType
      }
      setSessions(prev => [...prev, session])
      setActiveSessionId(terminalId)
    } catch (error) {
      console.error('[Terminal] Failed to create process terminal:', error)
      setHasError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsCreating(false)
    }
  }, [isCreating])

  // Create a new terminal session
  const createTerminal = useCallback(async (cwd?: string) => {
    if (isCreating) {
      return
    }
    
    // Use provided cwd or fall back to projectPath
    const targetCwd = cwd || projectPath
    setIsCreating(true)
    setHasError(null)

    try {
      if (!window.api?.createTerminal) {
        throw new Error('Terminal API not available. Please check if the app is running in Electron.')
      }
      
      // Pass targetCwd as cwd if available
      const options = targetCwd ? { cwd: targetCwd } : undefined
      const result = await window.api.createTerminal(options)
      
      const session: TerminalSession = {
        id: result.id,
        name: result.name,
        xterm: null,
        fitAddon: null,
        isActive: false
      }
      setSessions(prev => [...prev, session])
      setActiveSessionId(result.id)
    } catch (error) {
      console.error('[Terminal] Failed to create terminal:', error)
      setHasError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsCreating(false)
    }
  }, [isCreating, projectPath])

  // Initialize xterm for a session - runs when sessions change
  useEffect(() => {
    sessions.forEach(session => {
      if (!session.xterm && containerRefs.current.has(session.id)) {
        const container = containerRefs.current.get(session.id)
        if (!container) return
        
        
        try {
          const xterm = new XTerm({
            fontSize: 14,
            fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, "Courier New", monospace, "Apple Color Emoji"',
            theme: {
              // VS Code 默认深色主题
              background: '#1e1e1e',  // VS Code 编辑器背景色
              foreground: '#d4d4d4',  // VS Code 默认前景色
              cursor: '#aeafad',        // VS Code 光标颜色
              selectionBackground: '#264f78',  // VS Code 选中背景色
              selectionForeground: '#ffffff',
              black: '#1e1e1e',
              red: '#f44747',
              green: '#4ec9b0',
              yellow: '#dcdcaa',
              blue: '#569cd6',
              magenta: '#c586c0',
              cyan: '#4ec9b0',
              white: '#d4d4d4',
              brightBlack: '#808080',
              brightRed: '#f44747',
              brightGreen: '#4ec9b0',
              brightYellow: '#dcdcaa',
              brightBlue: '#569cd6',
              brightMagenta: '#c586c0',
              brightCyan: '#4ec9b0',
              brightWhite: '#ffffff'
            },
            cursorStyle: 'bar',
            cursorBlink: true,
            cursorWidth: 2,
            allowProposedApi: true,
            scrollback: 10000,
            lineHeight: 1.2,
            letterSpacing: 0.5,
            // Enable screen reader support
            screenReaderMode: false
          })

          const fitAddon = new FitAddon()
          xterm.loadAddon(fitAddon)
          
          // 使用 WebLinksAddon 并自定义链接点击行为
          const webLinksAddon = new WebLinksAddon(
            (event: MouseEvent, uri: string) => {
              // 阻止默认行为，在编辑器内打开浏览器
              event.preventDefault()
              if (onOpenUrl) {
                onOpenUrl(uri)
              } else {
                // 如果没有提供回调，使用默认行为
                window.open(uri, '_blank')
              }
            }
          )
          xterm.loadAddon(webLinksAddon)

          // Open terminal in container
          xterm.open(container)
          
          // Fit terminal to container
          fitAddon.fit()

          // Handle input from user
          xterm.onData((data) => {
            // Check for Ctrl+C (\x03) - interrupt running process
            if (data === '\x03' || data === '\u0003') {
              // Use a closure to capture current runningProcesses value
              // We need to get the latest state from the DOM or use a ref
              // For now, query the process panel if visible or use IPC to check
              if (window.api?.getRunningProcesses) {
                window.api.getRunningProcesses().then(processes => {
                  // Get all running processes - 'any' means broadcast to all terminals
                  const processesForThisTerminal = processes.filter(
                    (p: RunningProcess) => p.isRunning && (!p.terminalId || p.terminalId === 'any' || p.terminalId === session.id)
                  )
                  if (processesForThisTerminal.length > 0) {
                    // Stop the most recent process
                    const processToStop = processesForThisTerminal[processesForThisTerminal.length - 1]
                    if (window.api?.stopProcess) {
                      window.api.stopProcess(processToStop.id)
                    }
                    xterm.write('\r\n^C\r\n')
                  } else {
                    // No running process, send Ctrl+C to PTY normally
                    if (window.api?.writeTerminal) {
                      window.api.writeTerminal(session.id, data)
                    }
                  }
                })
              }
              return
            }
            if (window.api?.writeTerminal) {
              window.api.writeTerminal(session.id, data)
            }
          })

          // Update session with xterm instance
          setSessions(prev => prev.map(s => 
            s.id === session.id ? { ...s, xterm, fitAddon } : s
          ))

          // Flush buffered data to the newly initialized xterm
          const bufferedData = terminalDataBufferRef.current.get(session.id)
          if (bufferedData && bufferedData.length > 0) {
            bufferedData.forEach(chunk => xterm.write(chunk))
            terminalDataBufferRef.current.delete(session.id)
          }

          // Initial resize to sync with PTY - use xterm's actual dimensions after fit
          if (window.api?.resizeTerminal) {
            window.api.resizeTerminal(session.id, xterm.cols, xterm.rows)
          }

          // Focus the terminal
          xterm.focus()
          
        } catch (error) {
          console.error('[Terminal] Failed to initialize xterm:', error)
        }
      }
    })
  }, [sessions])

  // Terminal data buffer for each session (stores data received before xterm is initialized)
  const terminalDataBufferRef = useRef<Map<string, string[]>>(new Map())

  // Handle terminal data from main process
  useEffect(() => {
    if (!window.api?.onTerminalData) {
      console.warn('[Terminal] window.api.onTerminalData is not available')
      return
    }
    
    const removeListener = window.api.onTerminalData((_, { id, data }) => {
      // 性能优化：使用Map查找，O(1)复杂度
      const session = sessionsMapRef.current.get(id)
      if (session?.xterm) {
        // xterm已初始化，直接写入
        session.xterm.write(data)
      } else {
        // xterm未初始化，缓冲数据
        if (!terminalDataBufferRef.current.has(id)) {
          terminalDataBufferRef.current.set(id, [])
        }
        terminalDataBufferRef.current.get(id)?.push(data)
      }
    })

    return () => {
      removeListener()
    }
  }, [])

  // Handle terminal exit
  useEffect(() => {
    if (!window.api?.onTerminalExit) {
      console.warn('[Terminal] window.api.onTerminalExit is not available')
      return
    }
    
    const removeListener = window.api.onTerminalExit((_, { id }) => {
      
      // 从sessions中移除
      setSessions(prev => {
        const updated = prev.filter(s => s.id !== id)
        return updated
      })
      
      // 如果退出的是活动终端，切换到其他终端
      setSessions(prev => {
        const remaining = prev.filter(s => s.id !== id)
        if (activeSessionId === id && remaining.length > 0) {
          setActiveSessionId(remaining[0].id)
        } else if (remaining.length === 0) {
          setActiveSessionId(null)
        }
        return remaining
      })
    })

    return () => {
      removeListener()
    }
  }, [activeSessionId])

  // Resize handling
  useEffect(() => {
    const handleResize = () => {
      const activeSession = sessions.find(s => s.id === activeSessionId)
      if (activeSession?.xterm && activeSession?.fitAddon) {
        activeSession.fitAddon.fit()
        // Use xterm's actual dimensions after fit
        if (window.api?.resizeTerminal) {
          window.api.resizeTerminal(activeSession.id, activeSession.xterm.cols, activeSession.xterm.rows)
        }
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [sessions, activeSessionId])

  // Focus active terminal when switching tabs
  useEffect(() => {
    if (isVisible && activeSessionId) {
      const session = sessions.find(s => s.id === activeSessionId)
      if (session?.xterm) {
        setTimeout(() => session.xterm?.focus(), 50)
      }
    }
  }, [isVisible, activeSessionId, sessions])

  // Create initial terminal - only once when component becomes visible
  useEffect(() => {
    if (isVisible && !initializedRef.current) {
      initializedRef.current = true
      if (sessions.length === 0 && !isCreating) {
        createTerminal()
      }
    }
  }, [isVisible]) // Only depend on isVisible

  // When projectPath changes, close existing terminals and create new one with new path
  useEffect(() => {
    if (isVisible && projectPath && initializedRef.current) {
      // Close all existing terminals
      if (window.api?.killTerminal) {
        const api = window.api
        sessions.forEach(session => {
          api.killTerminal!(session.id).catch((err: Error) => {
            console.error('[Terminal] Failed to kill terminal:', err)
          })
        })
      }
      // Clear sessions and create new terminal with new path
      setSessions([])
      setActiveSessionId(null)
      if (!isCreating) {
        // Create new terminal with current projectPath
        // Use a ref to capture the current projectPath value
        const currentPath = projectPath
        setTimeout(() => createTerminal(currentPath), 100)
      }
    }
  }, [projectPath, isVisible])

  const closeTerminal = async (id: string) => {
    
    // 先更新UI状态（立即反馈给用户）
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id)
      return updated
    })
    
    // 如果关闭的是活动终端，切换到其他终端
    if (activeSessionId === id) {
      setSessions(prev => {
        const remaining = prev.filter(s => s.id !== id)
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id)
        } else {
          setActiveSessionId(null)
        }
        return remaining
      })
    }
    
    // 异步kill终端（不阻塞UI）
    try {
      if (window.api?.killTerminal) {
        // 添加超时机制，避免无限等待
        const killPromise = window.api.killTerminal(id)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Kill terminal timeout')), 5000)
        )
        
        await Promise.race([killPromise, timeoutPromise])
      }
    } catch (error) {
      console.error('[Terminal] Failed to kill terminal:', error)
      // 即使kill失败，也需要清理前端状态
      // 注意：后端会在terminal:exit事件中自动清理
    }
  }

  // Execute command in terminal - 支持AI提示
  const executeCommandInTerminal = async (command: string, cwd?: string, aiPrompt?: string) => {
    if (!activeSessionId) {
      // Create a new terminal first
      await createTerminal()
      // Wait for terminal to be created
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    const targetCwd = cwd || projectPath || process.cwd()
    const targetTerminalId = activeSessionId

    if (!targetTerminalId) {
      console.error('[Terminal] No active terminal to execute command')
      return
    }

    try {
      if (!window.api?.startProcessInTerminal) {
        throw new Error('startProcessInTerminal API not available')
      }
      const result = await window.api.startProcessInTerminal(command, targetCwd, targetTerminalId, aiPrompt)
      if (result.success) {
        // Command will be written by onProcessStarted listener, no need to write here
      } else {
        console.error('[Terminal] Failed to start process:', result.error)
      }
    } catch (error) {
      console.error('[Terminal] Error executing command in terminal:', error)
    }
  }

  // Stop a process
  const stopProcess = async (processId: string) => {
    try {
      if (!window.api?.stopProcess) {
        throw new Error('stopProcess API not available')
      }
      const result = await window.api.stopProcess(processId)
      if (result.success) {
        setRunningProcesses(prev => prev.map(p =>
          p.id === processId ? { ...p, isRunning: false } : p
        ))
      }
    } catch (error) {
      console.error('[Terminal] Failed to stop process:', error)
    }
  }

  // Restart a process
  const restartProcess = async (processId: string) => {
    try {
      if (!window.api?.restartProcess) return
      const result = await window.api.restartProcess(processId)
      if (result.success) {
        setRunningProcesses(prev => prev.filter(p => p.id !== processId))
        // New process will be added via onProcessStarted event
      }
    } catch (error) {
      console.error('[Terminal] Failed to restart process:', error)
    }
  }

  // Format duration
  const formatDuration = (startTime: string) => {
    const start = new Date(startTime)
    const now = new Date()
    const diff = Math.floor((now.getTime() - start.getTime()) / 1000)
    const minutes = Math.floor(diff / 60)
    const seconds = diff % 60
    return `${minutes}m ${seconds}s`
  }

  if (!isVisible) return null

  return (
    <div className="terminal-panel">
      {/* Terminal Tabs - VS Code style */}
      <div className="terminal-tabs-container">
        <div className="terminal-tabs">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`terminal-tab ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span className="tab-icon">
                ⚡
              </span>
              <span className="tab-name">{session.name}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(session.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-actions">
          <button 
            className="terminal-action-btn" 
            onClick={() => createTerminal()}
            title={t('newTerminal') || 'New Terminal'}
            disabled={isCreating}
          >
            +
          </button>
        </div>
      </div>

      {/* Terminal Content Area */}
      <div className="terminal-content">
        {hasError ? (
          <div className="terminal-empty">
            <div className="terminal-empty-content">
              <p style={{ color: '#ef4444' }}>{t('terminalError') || 'Error'}: {hasError}</p>
              <button className="btn btn-primary" onClick={() => createTerminal()}>
                {t('retry') || 'Retry'}
              </button>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="terminal-empty">
            <div className="terminal-empty-content">
              <p>{isCreating ? (t('creatingTerminal') || 'Creating terminal...') : (t('noActiveTerminals') || 'No active terminals')}</p>
              {!isCreating && (
                <button className="terminal-open-btn" onClick={() => createTerminal()}>
                  <Plus size={18} />
                  <span>{t('openNewTerminal') || '打开新终端'}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          sessions.map(session => (
            <div
              key={session.id}
              ref={(el) => {
                if (el) containerRefs.current.set(session.id, el)
              }}
              className={`terminal-instance ${session.id === activeSessionId ? 'active' : ''}`}
              style={{ display: session.id === activeSessionId ? 'block' : 'none' }}
            />
          ))
        )}
      </div>

      {/* Process Management Panel */}
      {showProcessPanel && (
        <div className="process-panel">
          <div className="process-panel-header">
            <span className="process-panel-title">{t('runningProcesses') || 'Running Processes'}</span>
            <button className="process-panel-close" onClick={() => setShowProcessPanel(false)}>×</button>
          </div>
          <div className="process-list">
            {runningProcesses.length === 0 ? (
              <div className="process-empty">{t('noRunningProcesses') || 'No running processes'}</div>
            ) : (
              runningProcesses.map(process => (
                <div key={process.id} className={`process-item ${process.isRunning ? 'running' : 'stopped'}`}>
                  <div className="process-info">
                    <div className="process-command">
                      {process.command}
                      {process.reused && <span className="reused-badge">↻ 复用</span>}
                    </div>
                    <div className="process-meta">
                      <span className="process-cwd">{process.cwd}</span>
                      <span className="process-duration">{formatDuration(process.startTime)}</span>
                      <span className={`process-status ${process.isRunning ? 'running' : 'stopped'}`}>
                        {process.isRunning ? (t('running') || 'Running') : (t('stopped') || 'Stopped')}
                      </span>
                    </div>
                  </div>
                  <div className="process-actions">
                    {process.isRunning ? (
                      <button
                        className="process-btn stop"
                        onClick={() => stopProcess(process.id)}
                        title={t('stopProcess') || 'Stop'}
                      >
                        ⏹
                      </button>
                    ) : (
                      <button
                        className="process-btn restart"
                        onClick={() => restartProcess(process.id)}
                        title={t('restartProcess') || 'Restart'}
                      >
                        🔄
                      </button>
                    )}
                    <button
                      className="process-btn focus"
                      onClick={() => {
                        if (process.terminalId) {
                          setActiveSessionId(process.terminalId)
                        }
                      }}
                      title={t('focusTerminal') || 'Focus Terminal'}
                    >
                      📍
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
})

Terminal.displayName = 'Terminal'

export default Terminal
