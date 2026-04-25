import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { t } from '../i18n'

interface TerminalProps {
  isVisible: boolean
  projectPath?: string | null
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

const Terminal = forwardRef<TerminalRef, TerminalProps>(({ isVisible, projectPath }, ref) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [hasError, setHasError] = useState<string | null>(null)
  const [runningProcesses, setRunningProcesses] = useState<RunningProcess[]>([])
  const [showProcessPanel, setShowProcessPanel] = useState(false)
  const [showAIHistoryPanel, setShowAIHistoryPanel] = useState(false)
  const [aiHistory, setAIHistory] = useState<AIIntentContext[]>([])
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const sessionsRef = useRef<TerminalSession[]>([])
  const initializedRef = useRef(false)
  const processDataBuffer = useRef<Map<string, string[]>>(new Map())

  // Expose executeCommand method via ref - 支持AI提示
  useImperativeHandle(ref, () => ({
    executeCommand: executeCommandInTerminal
  }))

  // Keep ref in sync with state
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  // Load running processes
  useEffect(() => {
    if (isVisible && window.api?.getRunningProcesses) {
      window.api.getRunningProcesses().then(processes => {
        setRunningProcesses(processes)
      })
    }
  }, [isVisible])

  // Load AI历史
  useEffect(() => {
    if (isVisible && projectPath && window.api?.getProjectAIHistory) {
      window.api.getProjectAIHistory(projectPath).then(history => {
        // 转换历史记录格式以匹配 AIIntentContext 类型
        const now = new Date().toISOString()
        const convertedHistory: AIIntentContext[] = history.map((h, index) => ({
          intentId: `history-${index}`,
          originalPrompt: h.prompt,
          taskType: h.taskType,
          projectContext: {
            name: projectPath.split('/').pop() || '',
            path: projectPath
          },
          expectedOutcome: '',
          createdAt: h.timestamp,
          lastAccessedAt: now,
          accessCount: 1
        }))
        setAIHistory(convertedHistory)
      })
    }
  }, [isVisible, projectPath])

  // Listen for process events
  useEffect(() => {
    if (!window.api) return

    const removeStartedListener = window.api.onProcessStarted((_, data) => {
      console.log('[Terminal] Process started:', data.processId, data.command, 'terminalId:', data.terminalId, 'taskType:', data.taskType)
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
          console.log('[Terminal] Auto-creating terminal for process:', terminalId)
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
      if (data.terminalId === 'any') {
        // Write to active terminal using activeSessionId
        const activeSession = sessionsRef.current.find(s => s.id === activeSessionId)
        if (activeSession?.xterm) {
          activeSession.xterm.write(data.data)
        }
      } else {
        const session = sessionsRef.current.find(s => s.id === data.terminalId)
        if (session?.xterm) {
          session.xterm.write(data.data)
        }
      }
    })

    const removeExitListener = window.api.onProcessExit((_, data) => {
      setRunningProcesses(prev => prev.map(p =>
        p.id === data.processId ? { ...p, isRunning: false } : p
      ))
      if (data.terminalId === 'any') {
        const activeSession = sessionsRef.current.find(s => s.id === activeSessionId)
        if (activeSession?.xterm) {
          activeSession.xterm.write(`\r\n--- Process exited with code ${data.exitCode} ---\r\n`)
        }
      } else {
        const session = sessionsRef.current.find(s => s.id === data.terminalId)
        if (session?.xterm) {
          session.xterm.write(`\r\n--- Process exited with code ${data.exitCode} ---\r\n`)
        }
      }
    })

    const removeErrorListener = window.api.onProcessError((_, data) => {
      setRunningProcesses(prev => prev.map(p =>
        p.id === data.processId ? { ...p, isRunning: false } : p
      ))
      if (data.terminalId === 'any') {
        const activeSession = sessionsRef.current.find(s => s.id === activeSessionId)
        if (activeSession?.xterm) {
          activeSession.xterm.write(`\r\n[Error] ${data.error}\r\n`)
        }
      } else {
        const session = sessionsRef.current.find(s => s.id === data.terminalId)
        if (session?.xterm) {
          session.xterm.write(`\r\n[Error] ${data.error}\r\n`)
        }
      }
    })

    // Listen for terminal create requests from main process
    const removeCreateListener = window.api.onTerminalCreateRequest((_, data) => {
      console.log('[Terminal] Received terminal create request:', data)
      // Check if terminal already exists
      const existingSession = sessionsRef.current.find(s => s.id === data.id)
      if (!existingSession) {
        createTerminalForProcess(data.id, data.title || 'Process', data.cwd || '')
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
      console.log('[Terminal] Already creating, waiting...')
      // Wait a bit and retry
      setTimeout(() => createTerminalForProcess(terminalId, commandType, cwd), 100)
      return
    }
    
    console.log('[Terminal] Creating process terminal:', terminalId, 'for', commandType, 'task:', taskType)
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
      console.log('[Terminal] Process terminal created:', result)
      
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
      console.log('[Terminal] Already creating, skipping...')
      return
    }
    
    // Use provided cwd or fall back to projectPath
    const targetCwd = cwd || projectPath
    console.log('[Terminal] Creating new terminal...', targetCwd ? `with cwd: ${targetCwd}` : 'with default cwd')
    setIsCreating(true)
    setHasError(null)

    try {
      if (!window.api?.createTerminal) {
        throw new Error('Terminal API not available. Please check if the app is running in Electron.')
      }
      
      // Pass targetCwd as cwd if available
      const options = targetCwd ? { cwd: targetCwd } : undefined
      const result = await window.api.createTerminal(options)
      console.log('[Terminal] Terminal created:', result)
      
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
        
        console.log('[Terminal] Initializing xterm for session:', session.id)
        
        try {
          const xterm = new XTerm({
            fontSize: 14,
            fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, "Courier New", monospace, "Apple Color Emoji"',
            theme: {
              // Modern dark theme based on Dracula/One Dark
              background: '#282c34',
              foreground: '#abb2bf',
              cursor: '#528bff',
              selectionBackground: '#3e4451',
              selectionForeground: '#abb2bf',
              black: '#282c34',
              red: '#e06c75',
              green: '#98c379',
              yellow: '#e5c07b',
              blue: '#61afef',
              magenta: '#c678dd',
              cyan: '#56b6c2',
              white: '#abb2bf',
              brightBlack: '#5c6370',
              brightRed: '#ff6b7a',
              brightGreen: '#a5e075',
              brightYellow: '#f5d78e',
              brightBlue: '#6cb8ff',
              brightMagenta: '#d282e8',
              brightCyan: '#66c8d4',
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
          xterm.loadAddon(new WebLinksAddon())

          // Open terminal in container
          xterm.open(container)
          
          // Fit terminal to container
          fitAddon.fit()

          // Handle input from user
          xterm.onData((data) => {
            // Check for Ctrl+C (\x03) - interrupt running process
            if (data === '\x03' || data === '\u0003') {
              console.log('[Terminal] Ctrl+C detected, checking for running processes')
              // Use a closure to capture current runningProcesses value
              // We need to get the latest state from the DOM or use a ref
              // For now, query the process panel if visible or use IPC to check
              window.api.getRunningProcesses().then(processes => {
                // Get all running processes - 'any' means broadcast to all terminals
                const processesForThisTerminal = processes.filter(
                  (p: RunningProcess) => p.isRunning && (!p.terminalId || p.terminalId === 'any' || p.terminalId === session.id)
                )
                if (processesForThisTerminal.length > 0) {
                  // Stop the most recent process
                  const processToStop = processesForThisTerminal[processesForThisTerminal.length - 1]
                  console.log('[Terminal] Stopping process:', processToStop.id, processToStop.command)
                  window.api.stopProcess(processToStop.id)
                  xterm.write('\r\n^C\r\n')
                } else {
                  // No running process, send Ctrl+C to PTY normally
                  window.api.writeTerminal(session.id, data)
                }
              })
              return
            }
            window.api.writeTerminal(session.id, data)
          })

          // Update session with xterm instance
          setSessions(prev => prev.map(s => 
            s.id === session.id ? { ...s, xterm, fitAddon } : s
          ))

          // Initial resize to sync with PTY - use xterm's actual dimensions after fit
          window.api.resizeTerminal(session.id, xterm.cols, xterm.rows)

          // Focus the terminal
          xterm.focus()
          
          console.log('[Terminal] xterm initialized for session:', session.id)
        } catch (error) {
          console.error('[Terminal] Failed to initialize xterm:', error)
        }
      }
    })
  }, [sessions])

  // Handle terminal data from main process
  useEffect(() => {
    console.log('[Terminal] Setting up terminal data listener')
    const removeListener = window.api.onTerminalData((_, { id, data }) => {
      const session = sessionsRef.current.find(s => s.id === id)
      if (session?.xterm) {
        session.xterm.write(data)
      }
    })

    return () => {
      console.log('[Terminal] Removing terminal data listener')
      removeListener()
    }
  }, [])

  // Handle terminal exit
  useEffect(() => {
    console.log('[Terminal] Setting up terminal exit listener')
    const removeListener = window.api.onTerminalExit((_, { id }) => {
      setSessions(prev => prev.filter(s => s.id !== id))
      if (activeSessionId === id) {
        const remaining = sessionsRef.current.filter(s => s.id !== id)
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
      }
    })

    return () => {
      console.log('[Terminal] Removing terminal exit listener')
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
        window.api.resizeTerminal(activeSession.id, activeSession.xterm.cols, activeSession.xterm.rows)
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
      console.log('[Terminal] Component visible, creating initial terminal')
      initializedRef.current = true
      if (sessions.length === 0 && !isCreating) {
        createTerminal()
      }
    }
  }, [isVisible]) // Only depend on isVisible

  // When projectPath changes, close existing terminals and create new one with new path
  useEffect(() => {
    if (isVisible && projectPath && initializedRef.current) {
      console.log('[Terminal] Project path changed to:', projectPath)
      // Close all existing terminals
      sessions.forEach(session => {
        window.api.killTerminal(session.id).catch((err: Error) => {
          console.error('[Terminal] Failed to kill terminal:', err)
        })
      })
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
    try {
      await window.api.killTerminal(id)
    } catch (error) {
      console.error('[Terminal] Failed to kill terminal:', error)
    }
    setSessions(prev => prev.filter(s => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id)
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
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
      const result = await window.api.startProcessInTerminal(command, targetCwd, targetTerminalId, aiPrompt)
      if (result.success) {
        console.log(`[Terminal] Started process ${result.processId} for command: ${command}`)
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

  // 获取任务类型图标
  const getTaskTypeIcon = (taskType?: string) => {
    const icons: Record<string, string> = {
      'dev-server': '🚀',
      'build': '🔨',
      'test': '🧪',
      'production-server': '🌐',
      'docker-deploy': '🐳',
      'deploy': '📦',
      'install': '📥',
      'command': '⚡'
    }
    return icons[taskType || 'command'] || '⚡'
  }

  // 获取任务类型标签
  const getTaskTypeLabel = (taskType?: string) => {
    const labels: Record<string, string> = {
      'dev-server': 'Dev Server',
      'build': 'Build',
      'test': 'Test',
      'production-server': 'Server',
      'docker-deploy': 'Docker',
      'deploy': 'Deploy',
      'install': 'Install',
      'command': 'Command'
    }
    return labels[taskType || 'command'] || 'Command'
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
                {session.aiIntent ? getTaskTypeIcon(session.aiIntent.taskType) : '⚡'}
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
          <button className="terminal-action-btn" title={t('splitTerminal') || 'Split Terminal'} disabled>
            ⧉
          </button>
          <button 
            className="terminal-action-btn" 
            title="AI History"
            onClick={() => setShowAIHistoryPanel(!showAIHistoryPanel)}
          >
            🤖
          </button>
          <button 
            className="terminal-action-btn" 
            title={t('killTerminal') || 'Kill Terminal'}
            onClick={() => activeSessionId && closeTerminal(activeSessionId)}
            disabled={!activeSessionId}
          >
            🗑
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
                <button className="btn btn-primary" onClick={() => createTerminal()}>
                  {t('openNewTerminal') || 'Open New Terminal'}
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
                      {getTaskTypeIcon(process.taskType)} {process.command}
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

      {/* AI History Panel */}
      {showAIHistoryPanel && (
        <div className="ai-history-panel">
          <div className="ai-history-panel-header">
            <span className="ai-history-panel-title">🤖 AI 任务历史</span>
            <button className="ai-history-panel-close" onClick={() => setShowAIHistoryPanel(false)}>×</button>
          </div>
          <div className="ai-history-list">
            {aiHistory.length === 0 ? (
              <div className="ai-history-empty">暂无 AI 任务历史</div>
            ) : (
              aiHistory.map(intent => (
                <div key={intent.intentId} className="ai-history-item">
                  <div className="ai-history-header">
                    <span className="ai-history-icon">{getTaskTypeIcon(intent.taskType)}</span>
                    <span className="ai-history-type">{getTaskTypeLabel(intent.taskType)}</span>
                    <span className="ai-history-count">复用 {intent.accessCount} 次</span>
                  </div>
                  <div className="ai-history-prompt">{intent.originalPrompt}</div>
                  <div className="ai-history-meta">
                    <span>项目: {intent.projectContext.name}</span>
                    <span>类型: {intent.projectContext.type}</span>
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
