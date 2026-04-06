import { EventEmitter } from 'events'
import { spawn, ChildProcess, exec } from 'child_process'
import * as path from 'path'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { getTerminals, writeToTerminal } from './terminal-service'

// Process types that should run in terminal
export const TERMINAL_PROCESS_PATTERNS = [
  // Node.js - match anywhere in command (for compound commands like "cd && npm run")
  /npm\s+(run|start|dev|serve)/i,
  /npm\s+run\s+\w+/i,
  /node\s+/i,
  /npx\s+/i,
  /yarn\s+(run|start|dev|serve)/i,
  /pnpm\s+(run|start|dev|serve)/i,
  // Python
  /python\w*\s+/i,
  /pip\s+/i,
  // Java
  /^java\s+/i,
  /^mvn\w*\s+/i,
  /^gradle\w*\s+/i,
  // Go
  /^go\s+(run|build|test)/i,
  // Rust
  /^cargo\s+(run|build|test)/i,
  // Docker
  /^docker\s+(run|up|compose)/i,
  /^docker-compose\s+/i,
  // Shell scripts
  /^\.\/\w+\.sh/i,
  /^bash\s+\w+\.sh/i,
  // Other dev servers
  /^vite\s+/i,
  /^webpack\s+/i,
  /^next\s+/i,
  /^nuxt\s+/i,
  /^vue-cli-service\s+/i,
  /^react-scripts\s+/i,
  // Custom scripts
  /^start\.sh/i,
  /^dev\.sh/i,
  /^run\.sh/i,
  /^server\.sh/i,
  /^\.\/start/i,
  /^\.\/dev/i,
  /^\.\/run/i,
  /^\.\/server/i
]

export interface ManagedProcess {
  id: string
  command: string
  process?: ChildProcess  // Optional - only used when spawning directly
  output: string[]
  isRunning: boolean
  startTime: string
  cwd: string
  terminalId?: string  // Associated terminal session ID
}

export interface ProcessEvent {
  processId: string
  type: 'data' | 'exit' | 'error' | 'start'
  data?: string
  exitCode?: number
  error?: string
}

class ProcessTerminalBridge extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map()
  private windowRef: BrowserWindow | null = null
  // Track command types to their process IDs for reuse
  private commandTypeMap: Map<string, string> = new Map()

  setWindow(window: BrowserWindow): void {
    this.windowRef = window
  }

  // Generate a command type key for grouping similar commands
  getCommandTypeKey(command: string, cwd: string): string {
    // Extract the project name from cwd (last directory)
    const projectName = cwd.split('/').pop() || cwd
    
    // Extract the actual command part (after cd ... && or cd ... ;)
    const commandPart = this.extractCommandPart(command)
    
    // Detect command type based on patterns
    if (/npm\s+run\s+dev|npm\s+run\s+serve|npm\s+run\s+start/i.test(commandPart)) {
      return `${projectName}:npm-dev`
    }
    if (/npm\s+run\s+\w+/i.test(commandPart)) {
      const match = commandPart.match(/npm\s+run\s+(\w+)/i)
      return `${projectName}:npm-${match?.[1] || 'run'}`
    }
    if (/vite/i.test(commandPart)) {
      return `${projectName}:vite`
    }
    if (/node\s+.*server|ts-node.*server|node\s+dist\/index/i.test(commandPart)) {
      return `${projectName}:server`
    }
    if (/docker.*up|docker-compose.*up/i.test(commandPart)) {
      return `${projectName}:docker`
    }
    if (/python.*manage\.py.*runserver|flask.*run|uvicorn|fastapi/i.test(commandPart)) {
      return `${projectName}:python-server`
    }
    
    // Default: use full command as key
    return `${projectName}:${commandPart.split(' ')[0]}`
  }

  // Extract the actual command part (after cd ... && or cd ... ;)
  private extractCommandPart(command: string): string {
    // Match patterns like "cd /path && command" or "cd /path; command"
    const cdMatch = command.match(/^cd\s+\S+\s*(&&|;|\n)\s*(.+)$/)
    if (cdMatch) {
      return cdMatch[2].trim()
    }
    return command.trim()
  }

  // Get a display name for the command (for terminal title)
  private getCommandDisplayName(command: string): string {
    const commandPart = this.extractCommandPart(command)
    
    // Extract project name from command if possible
    const projectMatch = command.match(/cd\s+(?:.*?\/)*([^/]+)\s*&&/)
    const projectName = projectMatch ? projectMatch[1] : ''
    
    if (/npm\s+run\s+dev|vite/i.test(commandPart)) {
      return projectName ? `${projectName} (dev)` : 'Dev Server'
    }
    if (/npm\s+run\s+start|npm\s+run\s+serve/i.test(commandPart)) {
      return projectName ? `${projectName} (start)` : 'Start Server'
    }
    if (/node.*server|ts-node.*server/i.test(commandPart)) {
      return projectName ? `${projectName} (server)` : 'Server'
    }
    if (/docker.*up/i.test(commandPart)) {
      return 'Docker'
    }
    
    // Default: first word
    const firstWord = commandPart.split(' ')[0]
    return projectName ? `${projectName} (${firstWord})` : firstWord
  }

  // Check if a command should run in terminal
  shouldRunInTerminal(command: string): boolean {
    const commandPart = this.extractCommandPart(command)
    return TERMINAL_PROCESS_PATTERNS.some(pattern => pattern.test(commandPart))
  }

  // Start a process that will output to terminal
  async startProcess(
    command: string,
    cwd: string,
    terminalId?: string
  ): Promise<{ processId: string; success: boolean; error?: string; commandTypeKey?: string }> {
    try {
      // Generate command type key for grouping
      const commandTypeKey = this.getCommandTypeKey(command, cwd)
      log.info(`[ProcessBridge] Command type key: ${commandTypeKey}`)

      // Check if there's an existing process of the same type that is still running
      const existingProcessId = this.commandTypeMap.get(commandTypeKey)
      if (existingProcessId) {
        const existingProcess = this.processes.get(existingProcessId)
        if (existingProcess && existingProcess.isRunning) {
          // Check if the terminal still exists
          const terminals = getTerminals()
          if (existingProcess.terminalId && terminals.has(existingProcess.terminalId)) {
            log.info(`[ProcessBridge] Found existing running process for ${commandTypeKey}, returning existing`)
            return {
              processId: existingProcessId,
              success: true,
              commandTypeKey
            }
          } else {
            // Terminal no longer exists, clean up the stale process entry
            log.info(`[ProcessBridge] Found existing process for ${commandTypeKey} but terminal ${existingProcess.terminalId} no longer exists, will recreate`)
            existingProcess.isRunning = false
            this.commandTypeMap.delete(commandTypeKey)
          }
        }
      }

      const processId = uuidv4()
      // Map this process to its command type
      this.commandTypeMap.set(commandTypeKey, processId)

      // For long-running commands, check if a terminal already exists for this command type
      // If yes, reuse it; if no, create a new one
      let targetTerminalId = terminalId
      const expectedTerminalId = `terminal-${commandTypeKey}`
      
      if (!targetTerminalId) {
        const terminals = getTerminals()
        
        // Check if a terminal already exists for this command type
        if (terminals.has(expectedTerminalId)) {
          targetTerminalId = expectedTerminalId
          log.info(`[ProcessBridge] Reusing existing terminal: ${targetTerminalId}`)
        } else {
          // Request renderer to create a new terminal
          if (this.windowRef && !this.windowRef.isDestroyed()) {
            this.windowRef.webContents.send('terminal:create', {
              id: expectedTerminalId,
              cwd: cwd,
              title: this.getCommandDisplayName(command)
            })
            targetTerminalId = expectedTerminalId
            log.info(`[ProcessBridge] Requested new terminal creation: ${expectedTerminalId}`)
            
            // Wait a bit for terminal to be created
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      }
      
      // Verify terminal exists
      const terminals = getTerminals()
      if (!targetTerminalId || !terminals.has(targetTerminalId)) {
        return {
          processId: '',
          success: false,
          error: 'Failed to create terminal. Please try again.',
          commandTypeKey
        }
      }
      
      log.info(`[ProcessBridge] Using terminal: ${targetTerminalId}`)
      log.info(`[ProcessBridge] Writing command to terminal: ${command} in ${cwd}`)

      // Create a managed process entry (without actual ChildProcess)
      // The command will run in the terminal via PTY
      const managedProcess: ManagedProcess = {
        id: processId,
        command: command,
        process: null as any,
        output: [`$ ${command}`, `Working directory: ${cwd}`, '---'],
        isRunning: true,
        startTime: new Date().toISOString(),
        cwd: cwd,
        terminalId: targetTerminalId
      }

      this.processes.set(processId, managedProcess)

      // Clean up command for foreground execution
      // Remove background execution (&) and output redirections (> file 2>&1)
      let foregroundCommand = command
        // Remove output redirections: > file 2>&1 or > file (handle paths with slashes)
        .replace(/\s*>\s*[^&]+?\s*2>&1\s*&?\s*$/, '')
        .replace(/\s*>\s*[^&]+?\s*&?\s*$/, '')
        // Remove standalone 2>&1
        .replace(/\s*2>&1\s*&?\s*$/, '')
        // Remove trailing &
        .replace(/\s*&\s*$/, '')
        .trim()
      
      log.info(`[ProcessBridge] Original command: ${command}`)
      log.info(`[ProcessBridge] Cleaned command for foreground: ${foregroundCommand}`)

      // Write command to terminal - run in foreground
      writeToTerminal(targetTerminalId, `${foregroundCommand}\r`)

      // Buffer for output to reduce IPC calls and improve formatting
      let outputBuffer = ''
      let lastOutputTime = Date.now()
      const BUFFER_TIMEOUT = 30 // ms - shorter for more responsive display

      // ANSI color codes for highlighting
      const colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        dim: '\x1b[2m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
        brightRed: '\x1b[91m',
        brightGreen: '\x1b[92m',
        brightYellow: '\x1b[93m',
        brightBlue: '\x1b[94m',
        brightMagenta: '\x1b[95m'
      }

      // Highlight important patterns in output
      const highlightOutput = (text: string): string => {
        return text
          // Highlight errors
          .replace(/(\[?ERROR\]?|\[?Error\]?|error:|Error:)/g, `${colors.brightRed}$1${colors.reset}`)
          // Highlight warnings
          .replace(/(\[?WARN\]?|\[?Warn\]?|warning:|Warning:)/g, `${colors.brightYellow}$1${colors.reset}`)
          // Highlight success/info
          .replace(/(\[?INFO\]?|\[?Info\]?|✓|✔|success|Success)/g, `${colors.brightGreen}$1${colors.reset}`)
          // Highlight URLs
          .replace(/(http[s]?:\/\/[^\s]+)/g, `${colors.brightBlue}$1${colors.reset}`)
          // Highlight file paths
          .replace(/(\/[^\s]+\.(js|ts|json|md|py|java|go|rs|cpp|c|h|jsx|tsx|vue|css|scss|less|html|xml|yml|yaml|sh|bash|zsh))/g, `${colors.cyan}$1${colors.reset}`)
          // Highlight npm/yarn commands
          .replace(/(npm|yarn|pnpm|npx)\s+/g, `${colors.brightMagenta}$1${colors.reset} `)
          // Highlight server start messages
          .replace(/(🚀|server running|listening on|started on)/gi, `${colors.brightGreen}$1${colors.reset}`)
      }

      const flushOutputBuffer = () => {
        if (outputBuffer.length === 0) return
        
        const text = outputBuffer
        outputBuffer = ''
        
        // Check for error patterns that indicate the command failed
        const errorPatterns = [
          /Error: Cannot find module/i,
          /MODULE_NOT_FOUND/i,
          /command not found/i,
          /npm ERR!/i,
          /error:.*failed/i,
          /Error:.*failed/i
        ]
        
        const hasError = errorPatterns.some(pattern => pattern.test(text))
        if (hasError && managedProcess.isRunning) {
          log.warn(`[ProcessBridge] Detected error in process ${processId} output, marking as potentially failed`)
          // Don't immediately mark as stopped, but add a flag that it may have failed
          // The actual exit detection is tricky with PTY
        }
        
        // Normalize line endings and ensure proper formatting
        let normalizedText = text.replace(/\r?\n/g, '\r\n')
        
        // Apply syntax highlighting
        normalizedText = highlightOutput(normalizedText)
        
        managedProcess.output.push(normalizedText)
        this.emit('process:data', { processId, data: normalizedText })

        if (this.windowRef && !this.windowRef.isDestroyed()) {
          this.windowRef.webContents.send('terminal:process-data', {
            terminalId: terminalId || 'any',
            processId,
            data: normalizedText
          })
        }
      }

      // Since the command runs in the terminal via PTY, we don't need to handle
      // stdout/stderr here. The terminal will display the output directly.
      // We just need to track that the process is "running" in our registry.
      
      log.info(`[ProcessBridge] Command written to terminal ${targetTerminalId}: ${command}`)

      // Notify renderer that process started
      if (this.windowRef && !this.windowRef.isDestroyed()) {
        this.windowRef.webContents.send('process:started', {
          processId,
          command,
          cwd,
          terminalId: terminalId || 'any'
        })
      }

      return { processId, success: true }
    } catch (error) {
      log.error('[ProcessBridge] Failed to start process:', error)
      return {
        processId: '',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Stop a process
  async stopProcess(processId: string): Promise<{ success: boolean; error?: string; actuallyStopped?: boolean }> {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return { success: false, error: 'Process not found' }
    }

    if (!managedProcess.isRunning) {
      return { success: true, actuallyStopped: true }
    }

    try {
      log.info(`[ProcessBridge] Stopping process ${processId}`)
      
      // Since the process runs in the terminal, send Ctrl+C to stop it
      const terminalId = managedProcess.terminalId
      let terminalExists = false
      
      if (terminalId) {
        // Check if terminal still exists
        const terminals = getTerminals()
        terminalExists = terminals.has(terminalId)
        
        if (terminalExists) {
          // Send Ctrl+C (\x03) to the terminal - send twice for ts-node-dev
          // First Ctrl+C stops the node process, second stops ts-node-dev itself
          writeToTerminal(terminalId, '\x03')
          log.info(`[ProcessBridge] Sent first Ctrl+C to terminal ${terminalId}`)
          
          // Wait a bit and send second Ctrl+C for ts-node-dev
          await new Promise(resolve => setTimeout(resolve, 300))
          writeToTerminal(terminalId, '\x03')
          log.info(`[ProcessBridge] Sent second Ctrl+C to terminal ${terminalId}`)
          
          // Send a third one just to be sure (some processes need it)
          await new Promise(resolve => setTimeout(resolve, 300))
          writeToTerminal(terminalId, '\x03')
          log.info(`[ProcessBridge] Sent third Ctrl+C to terminal ${terminalId}`)
        } else {
          log.warn(`[ProcessBridge] Terminal ${terminalId} no longer exists, process may have already exited`)
          managedProcess.isRunning = false
          managedProcess.output.push('\n--- Process already stopped (terminal closed) ---\n')
          return { success: true, actuallyStopped: true }
        }
      }

      // Wait for process to actually stop (give it time to handle the signal)
      // We'll check if the terminal is still active and outputting
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // Check if terminal still exists after the delay
      const terminals = getTerminals()
      const terminalStillExists = terminalId ? terminals.has(terminalId) : false
      
      // Mark process as stopped in our registry
      managedProcess.isRunning = false
      managedProcess.output.push('\n--- Process stopped by user ---\n')
      
      // Clean up commandTypeMap entry for this process
      for (const [key, pid] of this.commandTypeMap.entries()) {
        if (pid === processId) {
          this.commandTypeMap.delete(key)
          log.info(`[ProcessBridge] Cleaned up command type mapping: ${key}`)
          break
        }
      }
      
      // Note: We can't be 100% sure the process actually stopped due to PTY limitations
      // But we return actuallyStopped: true if the terminal is still there (command was sent)
      // or false if terminal disappeared unexpectedly
      return { 
        success: true, 
        actuallyStopped: terminalStillExists || !terminalExists 
      }
    } catch (error) {
      log.error(`[ProcessBridge] Failed to stop process ${processId}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  // Restart a process
  async restartProcess(processId: string): Promise<{ processId: string; success: boolean; error?: string }> {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return { processId: '', success: false, error: 'Process not found' }
    }

    // Check if the terminal still exists
    const terminals = getTerminals()
    let terminalId = managedProcess.terminalId
    
    if (terminalId && !terminals.has(terminalId)) {
      log.info(`[ProcessBridge] Terminal ${terminalId} no longer exists, will create new terminal for restart`)
      terminalId = undefined
    }

    // Stop existing process (now async)
    await this.stopProcess(processId)
    
    // Wait a bit for cleanup (additional wait since stopProcess already waits)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Start new process with same command and cwd
    return this.startProcess(
      managedProcess.command,
      managedProcess.cwd,
      terminalId
    )
  }

  // Get all processes
  getAllProcesses(): Array<{
    id: string
    command: string
    isRunning: boolean
    startTime: string
    cwd: string
    terminalId?: string
  }> {
    const terminals = getTerminals()
    const activeProcesses: Array<{
      id: string
      command: string
      isRunning: boolean
      startTime: string
      cwd: string
      terminalId?: string
    }> = []
    
    for (const [id, p] of this.processes) {
      // Check if the associated terminal still exists
      if (p.terminalId && !terminals.has(p.terminalId)) {
        // Terminal no longer exists, mark process as not running
        if (p.isRunning) {
          p.isRunning = false
          log.info(`[ProcessBridge] Process ${id} marked as stopped - terminal ${p.terminalId} no longer exists`)
        }
        // Clean up commandTypeMap entry
        for (const [key, pid] of this.commandTypeMap.entries()) {
          if (pid === id) {
            this.commandTypeMap.delete(key)
            log.info(`[ProcessBridge] Cleaned up command type mapping: ${key}`)
            break
          }
        }
      }
      
      activeProcesses.push({
        id: p.id,
        command: p.command,
        isRunning: p.isRunning,
        startTime: p.startTime,
        cwd: p.cwd,
        terminalId: p.terminalId
      })
    }
    
    return activeProcesses
  }

  // Get process output
  getProcessOutput(processId: string): string[] | null {
    const managedProcess = this.processes.get(processId)
    return managedProcess ? managedProcess.output : null
  }

  // Get a specific process
  getProcess(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId)
  }

  // Clean up stopped processes
  cleanupProcess(processId: string): boolean {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return false
    }

    if (managedProcess.isRunning) {
      return false
    }

    this.processes.delete(processId)
    return true
  }

  // Clean up all processes
  cleanupAll(): void {
    for (const [id, managedProcess] of this.processes) {
      if (managedProcess.isRunning && managedProcess.process) {
        try {
          managedProcess.process.kill('SIGTERM')
        } catch (error) {
          log.error(`[ProcessBridge] Failed to kill process ${id}:`, error)
        }
      }
    }
    this.processes.clear()
    this.commandTypeMap.clear()
    log.info('[ProcessBridge] All processes and command type mappings cleaned up')
  }

  // Send input to a process (for interactive processes)
  sendInput(processId: string, input: string): boolean {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess || !managedProcess.isRunning) {
      return false
    }

    // If there's a terminal, write to terminal instead
    if (managedProcess.terminalId) {
      return writeToTerminal(managedProcess.terminalId, input)
    }

    // Fallback to process stdin if available
    if (managedProcess.process?.stdin) {
      try {
        managedProcess.process.stdin.write(input)
        return true
      } catch (error) {
        log.error(`[ProcessBridge] Failed to send input to process ${processId}:`, error)
      }
    }
    return false
  }

  // Parse command into cmd and args
  private parseCommand(command: string): { cmd: string; args: string[] } {
    // For shell execution, we pass the whole command as an argument to the shell
    if (process.platform === 'win32') {
      return { cmd: 'cmd.exe', args: ['/c', command] }
    }
    return { cmd: process.env.SHELL || '/bin/bash', args: ['-c', command] }
  }
}

// Export singleton instance
export const processBridge = new ProcessTerminalBridge()
