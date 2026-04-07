import { EventEmitter } from 'events'
import { exec } from 'child_process'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { getTerminals, writeToTerminal, TerminalSession } from './terminal-service'

// Process types that should run in terminal
export const TERMINAL_PROCESS_PATTERNS = [
  /npm\s+(run|start|dev|serve)/i,
  /npm\s+run\s+\w+/i,
  /node\s+/i,
  /npx\s+/i,
  /yarn\s+(run|start|dev|serve)/i,
  /pnpm\s+(run|start|dev|serve)/i,
  /python\w*\s+/i,
  /pip\s+/i,
  /^java\s+/i,
  /^mvn\w*\s+/i,
  /^gradle\w*\s+/i,
  /^go\s+(run|build|test)/i,
  /^cargo\s+(run|build|test)/i,
  /^docker\s+(run|up|compose)/i,
  /^docker-compose\s+/i,
  /^\.\/\w+\.sh/i,
  /^bash\s+\w+\.sh/i,
  /^vite\s+/i,
  /^webpack\s+/i,
  /^next\s+/i,
  /^nuxt\s+/i,
  /^vue-cli-service\s+/i,
  /^react-scripts\s+/i,
  /^start\.sh/i,
  /^dev\.sh/i,
  /^run\.sh/i,
  /^server\.sh/i,
  /^\.\/start/i,
  /^\.\/dev/i,
  /^\.\/run/i,
  /^\.\/server/i
]

// AI意图上下文
export interface AIIntentContext {
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

export interface ManagedProcess {
  id: string
  command: string
  output: string[]
  isRunning: boolean
  startTime: string
  cwd: string
  terminalId?: string
  aiIntent?: AIIntentContext
  commandTypeKey: string
  port?: number  // 监听的端口，用于验证进程是否运行
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
  private commandTypeMap: Map<string, string> = new Map()
  private aiIntents: Map<string, AIIntentContext> = new Map()

  setWindow(window: BrowserWindow): void {
    this.windowRef = window
  }

  // 推断任务类型
  private inferTaskType(command: string): string {
    const cmd = command.toLowerCase()
    if (/npm\s+run\s+dev|vite|next\s+dev|nuxt\s+dev/.test(cmd)) return 'dev-server'
    if (/npm\s+run\s+build|vite\s+build|next\s+build/.test(cmd)) return 'build'
    if (/npm\s+test|jest|vitest|pytest/.test(cmd)) return 'test'
    if (/npm\s+run\s+start|serve/.test(cmd)) return 'production-server'
    if (/docker.*up|docker-compose/.test(cmd)) return 'docker-deploy'
    if (/pip\s+install|npm\s+install|yarn\s+install/.test(cmd)) return 'install'
    return 'command'
  }

  // 推断项目类型
  private inferProjectType(command: string): string {
    const cmd = command.toLowerCase()
    if (/npm|yarn|pnpm|node|vite|next|nuxt/.test(cmd)) return 'node'
    if (/python|pip|uvicorn|fastapi|flask/.test(cmd)) return 'python'
    if (/java|mvn|gradle/.test(cmd)) return 'java'
    if (/go\s+/.test(cmd)) return 'go'
    if (/cargo|rust/.test(cmd)) return 'rust'
    if (/docker/.test(cmd)) return 'docker'
    return 'unknown'
  }

  // 提取命令类型键
  private getCommandTypeKey(command: string, cwd: string): string {
    const projectName = cwd.split('/').pop() || cwd
    const commandPart = this.extractCommandPart(command)
    
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
    
    return `${projectName}:${commandPart.split(' ')[0]}`
  }

  // 提取实际命令部分
  private extractCommandPart(command: string): string {
    const cdMatch = command.match(/^cd\s+\S+\s*(&&|;|\n)\s*(.+)$/)
    if (cdMatch) {
      return cdMatch[2].trim()
    }
    return command.trim()
  }

  // 获取显示名称
  private getCommandDisplayName(command: string): string {
    const commandPart = this.extractCommandPart(command)
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
    
    const firstWord = commandPart.split(' ')[0]
    return projectName ? `${projectName} (${firstWord})` : firstWord
  }

  // 检查命令是否应在终端运行
  shouldRunInTerminal(command: string): boolean {
    const commandPart = this.extractCommandPart(command)
    return TERMINAL_PROCESS_PATTERNS.some(pattern => pattern.test(commandPart))
  }

  // 提取端口
  private extractPort(command: string): number | undefined {
    const portMatch = command.match(/:(\d+)/)
    return portMatch ? parseInt(portMatch[1]) : undefined
  }

  // 创建AI意图
  private createAIIntent(originalPrompt: string, command: string, cwd: string): AIIntentContext {
    const projectName = cwd.split('/').pop() || cwd
    const intent: AIIntentContext = {
      intentId: `intent-${uuidv4()}`,
      originalPrompt,
      taskType: this.inferTaskType(command),
      projectContext: {
        name: projectName,
        path: cwd,
        type: this.inferProjectType(command)
      },
      expectedOutcome: 'long-running-service',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0
    }
    this.aiIntents.set(intent.intentId, intent)
    return intent
  }

  // 启动进程
  async startProcess(
    command: string,
    cwd: string,
    terminalId?: string,
    aiPrompt?: string
  ): Promise<{ processId: string; success: boolean; error?: string; reused?: boolean }> {
    try {
      const commandTypeKey = this.getCommandTypeKey(command, cwd)
      log.info(`[ProcessBridge] Starting process: ${commandTypeKey}`)

      // 检查是否已有同类型进程在运行
      const existingProcessId = this.commandTypeMap.get(commandTypeKey)
      if (existingProcessId) {
        const existingProcess = this.processes.get(existingProcessId)
        if (existingProcess) {
          // 检查进程是否真的在运行
          const isRunning = await this.isProcessActuallyRunning(existingProcessId)
          if (isRunning) {
            log.info(`[ProcessBridge] Reusing existing process: ${existingProcessId}`)
            return { processId: existingProcessId, success: true, reused: true }
          } else {
            // 进程已停止，清理记录
            log.info(`[ProcessBridge] Cleaning up stopped process: ${existingProcessId}`)
            this.cleanupProcessRecord(existingProcessId)
          }
        } else {
          // 进程记录不存在但映射还在，清理映射
          this.commandTypeMap.delete(commandTypeKey)
        }
      }

      const processId = uuidv4()
      const port = this.extractPort(command)
      
      // 确定终端ID
      let targetTerminalId = terminalId
      const expectedTerminalId = `terminal-${commandTypeKey}`
      
      if (!targetTerminalId) {
        const terminals = getTerminals()
        
        if (terminals.has(expectedTerminalId)) {
          targetTerminalId = expectedTerminalId
          // 确保终端中的任何旧进程都已停止
          log.info(`[ProcessBridge] Reusing existing terminal: ${targetTerminalId}, stopping any existing process`)
          await this.stopTerminalProcess(targetTerminalId)
          // 额外等待确保终端准备就绪
          await new Promise(resolve => setTimeout(resolve, 800))
        } else if (this.windowRef && !this.windowRef.isDestroyed()) {
          this.windowRef.webContents.send('terminal:create', {
            id: expectedTerminalId,
            cwd: cwd,
            title: this.getCommandDisplayName(command)
          })
          targetTerminalId = expectedTerminalId
          // 等待终端创建完成
          await new Promise(resolve => setTimeout(resolve, 800))
        }
      }

      // 验证终端
      const terminals = getTerminals()
      if (!targetTerminalId || !terminals.has(targetTerminalId)) {
        return { processId: '', success: false, error: 'Failed to create terminal' }
      }

      // 再次检查是否有同类型进程在运行（防止并发启动）
      const doubleCheckProcessId = this.commandTypeMap.get(commandTypeKey)
      if (doubleCheckProcessId && doubleCheckProcessId !== processId) {
        const doubleCheckProcess = this.processes.get(doubleCheckProcessId)
        if (doubleCheckProcess) {
          const isRunning = await this.isProcessActuallyRunning(doubleCheckProcessId)
          if (isRunning) {
            log.info(`[ProcessBridge] Found running process during double-check: ${doubleCheckProcessId}`)
            return { processId: doubleCheckProcessId, success: true, reused: true }
          }
        }
      }

      // 创建进程记录
      const managedProcess: ManagedProcess = {
        id: processId,
        command: command,
        output: [`$ ${command}`, `Working directory: ${cwd}`, '---'],
        isRunning: true,
        startTime: new Date().toISOString(),
        cwd: cwd,
        terminalId: targetTerminalId,
        aiIntent: aiPrompt ? this.createAIIntent(aiPrompt, command, cwd) : undefined,
        commandTypeKey: commandTypeKey,
        port: port
      }

      this.processes.set(processId, managedProcess)
      this.commandTypeMap.set(commandTypeKey, processId)

      // 清理命令并执行
      const foregroundCommand = command
        .replace(/\s*>\s*[^&]+?\s*2>&1\s*&?\s*$/, '')
        .replace(/\s*>\s*[^&]+?\s*&?\s*$/, '')
        .replace(/\s*2>&1\s*&?\s*$/, '')
        .replace(/\s*&\s*$/, '')
        .trim()

      // 确保终端有干净的提示符
      writeToTerminal(targetTerminalId, '\n')
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // 发送命令
      log.info(`[ProcessBridge] Executing command in terminal: ${foregroundCommand}`)
      writeToTerminal(targetTerminalId, `${foregroundCommand}\n`)

      // 通知前端
      if (this.windowRef && !this.windowRef.isDestroyed()) {
        this.windowRef.webContents.send('process:started', {
          processId,
          command,
          cwd,
          terminalId: targetTerminalId,
          aiIntentId: managedProcess.aiIntent?.intentId,
          taskType: managedProcess.aiIntent?.taskType
        })
      }

      log.info(`[ProcessBridge] Process started: ${processId}`)
      return { processId, success: true, reused: false }

    } catch (error) {
      log.error('[ProcessBridge] Failed to start process:', error)
      return { processId: '', success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // 停止进程 - 确保真正停止
  async stopProcess(processId: string): Promise<{ success: boolean; error?: string; actuallyStopped?: boolean }> {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return { success: false, error: 'Process not found' }
    }

    if (!managedProcess.isRunning) {
      // 进程已标记为停止，清理记录
      this.cleanupProcessRecord(processId)
      return { success: true, actuallyStopped: true }
    }

    try {
      log.info(`[ProcessBridge] Stopping process: ${processId}, command: ${managedProcess.command}`)
      const { terminalId, port, cwd, command, commandTypeKey } = managedProcess

      // 1. 发送 Ctrl+C 尝试优雅停止
      if (terminalId) {
        const terminals = getTerminals()
        if (terminals.has(terminalId)) {
          log.info(`[ProcessBridge] Sending Ctrl+C to terminal: ${terminalId}`)
          // 发送多次 Ctrl+C
          for (let i = 0; i < 3; i++) {
            writeToTerminal(terminalId, '\x03')
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          writeToTerminal(terminalId, '\n')
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          log.warn(`[ProcessBridge] Terminal ${terminalId} not found during stop`)
        }
      }

      // 2. 如果指定了端口，检查端口是否仍被占用
      let actuallyStopped = true
      if (port) {
        const portInUse = await this.checkPortInUse(port)
        if (portInUse) {
          log.warn(`[ProcessBridge] Port ${port} still in use, force killing`)
          await this.killProcessByPort(port)
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // 再次检查端口
          const stillInUse = await this.checkPortInUse(port)
          actuallyStopped = !stillInUse
        }
      }

      // 3. 强制 kill 进程树
      await this.forceKillByCommand(command, cwd)
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 4. 验证进程是否真的停止（如果端口检查失败）
      if (port && actuallyStopped) {
        const stillInUse = await this.checkPortInUse(port)
        actuallyStopped = !stillInUse
      }

      // 更新状态 - 标记为停止
      managedProcess.isRunning = false
      managedProcess.output.push('\n--- Process stopped ---\n')
      
      // 从 commandTypeMap 中移除，允许后续启动新进程
      this.commandTypeMap.delete(commandTypeKey)
      log.info(`[ProcessBridge] Removed commandTypeKey mapping: ${commandTypeKey}`)

      log.info(`[ProcessBridge] Process ${processId} stopped: ${actuallyStopped}`)
      return { success: actuallyStopped, actuallyStopped }

    } catch (error) {
      log.error(`[ProcessBridge] Failed to stop process ${processId}:`, error)
      // 即使出错也标记为停止
      managedProcess.isRunning = false
      this.commandTypeMap.delete(managedProcess.commandTypeKey)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // 重启进程
  async restartProcess(processId: string): Promise<{ processId: string; success: boolean; error?: string }> {
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return { processId: '', success: false, error: 'Process not found' }
    }

    const { command, cwd, terminalId, aiIntent, commandTypeKey } = managedProcess

    // 1. 停止旧进程
    log.info(`[ProcessBridge] Restarting process ${processId}`)
    const stopResult = await this.stopProcess(processId)
    
    if (!stopResult.success) {
      log.error(`[ProcessBridge] Failed to stop process for restart:`, stopResult.error)
      // 即使停止失败也继续，尝试强制清理
    }

    // 2. 确保命令类型映射被清理
    this.commandTypeMap.delete(commandTypeKey)
    log.info(`[ProcessBridge] Deleted commandTypeKey for restart: ${commandTypeKey}`)
    
    // 3. 等待确保终端准备就绪
    await new Promise(resolve => setTimeout(resolve, 2500))

    // 4. 检查终端是否还存在
    const terminals = getTerminals()
    let targetTerminalId = terminalId
    
    if (targetTerminalId && !terminals.has(targetTerminalId)) {
      log.info(`[ProcessBridge] Terminal ${targetTerminalId} no longer exists, will create new`)
      targetTerminalId = undefined
    }

    // 5. 启动新进程
    log.info(`[ProcessBridge] Starting new process after restart: ${command}`)
    const result = await this.startProcess(
      command,
      cwd,
      targetTerminalId,
      aiIntent?.originalPrompt
    )

    if (result.success) {
      log.info(`[ProcessBridge] Restart successful, new process: ${result.processId}`)
    } else {
      log.error(`[ProcessBridge] Restart failed:`, result.error)
    }

    return result
  }

  // 获取所有进程
  getAllProcesses(): Array<{
    id: string
    command: string
    isRunning: boolean
    startTime: string
    cwd: string
    terminalId?: string
    aiIntent?: AIIntentContext
  }> {
    // 清理无效的进程记录
    this.cleanupInvalidProcesses()
    
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      command: p.command,
      isRunning: p.isRunning,
      startTime: p.startTime,
      cwd: p.cwd,
      terminalId: p.terminalId,
      aiIntent: p.aiIntent
    }))
  }

  // 获取进程输出
  getProcessOutput(processId: string): string[] | null {
    const managedProcess = this.processes.get(processId)
    return managedProcess ? managedProcess.output : null
  }

  // 获取特定进程
  getProcess(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId)
  }

  // 获取AI意图上下文
  getAIIntentContext(processId: string): AIIntentContext | undefined {
    const process = this.processes.get(processId)
    return process?.aiIntent
  }

  // 清理所有进程
  cleanupAll(): void {
    for (const [id, managedProcess] of this.processes) {
      if (managedProcess.isRunning && managedProcess.terminalId) {
        this.stopProcess(id).catch(err => {
          log.error(`[ProcessBridge] Failed to cleanup process ${id}:`, err)
        })
      }
    }
    this.processes.clear()
    this.commandTypeMap.clear()
    this.aiIntents.clear()
    log.info('[ProcessBridge] All processes cleaned up')
  }

  // 发送输入到进程
  sendInput(processId: string, input: string): boolean {
    const managedProcess = this.processes.get(processId)
    if (!managedProcess?.isRunning || !managedProcess.terminalId) {
      return false
    }
    return writeToTerminal(managedProcess.terminalId, input)
  }

  // ============ 私有辅助方法 ============

  // 检查进程是否真正在运行
  private async isProcessActuallyRunning(processId: string): Promise<boolean> {
    const managedProcess = this.processes.get(processId)
    if (!managedProcess) {
      log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} not found`)
      return false
    }
    
    // 首先检查进程标记
    if (!managedProcess.isRunning) {
      log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} isRunning=false`)
      return false
    }
    
    // 检查终端是否还存在
    if (managedProcess.terminalId) {
      const terminals = getTerminals()
      if (!terminals.has(managedProcess.terminalId)) {
        log.info(`[ProcessBridge] isProcessActuallyRunning: terminal ${managedProcess.terminalId} not found`)
        return false
      }
    }
    
    // 如果有端口，检查端口是否被占用
    if (managedProcess.port) {
      const portInUse = await this.checkPortInUse(managedProcess.port)
      log.info(`[ProcessBridge] isProcessActuallyRunning: port ${managedProcess.port} in use = ${portInUse}`)
      return portInUse
    }
    
    // 没有端口，只能通过 isRunning 标记和终端存在性判断
    return managedProcess.isRunning
  }

  // 停止终端中的进程
  private async stopTerminalProcess(terminalId: string): Promise<void> {
    const terminals = getTerminals()
    if (!terminals.has(terminalId)) return

    log.info(`[ProcessBridge] Stopping processes in terminal: ${terminalId}`)

    // 发送 Ctrl+C 多次，尝试优雅停止
    for (let i = 0; i < 5; i++) {
      writeToTerminal(terminalId, '\x03')
      await new Promise(resolve => setTimeout(resolve, 400))
    }
    
    // 发送 Enter 确保提示符出现
    writeToTerminal(terminalId, '\n')
    await new Promise(resolve => setTimeout(resolve, 600))
    
    // 再次发送 Ctrl+C 确保任何残留进程都被停止
    for (let i = 0; i < 3; i++) {
      writeToTerminal(terminalId, '\x03')
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    
    log.info(`[ProcessBridge] Finished stopping processes in terminal: ${terminalId}`)
  }

  // 检查端口是否被占用
  private async checkPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCmd = `lsof -i :${port} | grep LISTEN`
      exec(checkCmd, (error, stdout) => {
        resolve(!error && stdout.length > 0)
      })
    })
  }

  // 通过端口 kill 进程
  private async killProcessByPort(port: number): Promise<void> {
    return new Promise((resolve) => {
      const killCmd = `lsof -i :${port} | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true`
      exec(killCmd, () => resolve())
    })
  }

  // 通过命令和目录强制 kill
  private async forceKillByCommand(command: string, cwd: string): Promise<void> {
    const commandPart = this.extractCommandPart(command)
    const mainCmd = commandPart.split(' ')[0]
    const projectName = cwd.split('/').pop() || ''
    
    return new Promise((resolve) => {
      // 尝试多种方式 kill
      const killCmds = [
        `pkill -f "${mainCmd}.*${projectName}" 2>/dev/null || true`,
        `pkill -f "node.*${projectName}" 2>/dev/null || true`,
        `pkill -f "npm.*${projectName}" 2>/dev/null || true`
      ]
      
      let completed = 0
      killCmds.forEach(cmd => {
        exec(cmd, () => {
          completed++
          if (completed === killCmds.length) resolve()
        })
      })
    })
  }

  // 清理进程记录
  private cleanupProcessRecord(processId: string): void {
    const managedProcess = this.processes.get(processId)
    if (!managedProcess) return

    // 从 commandTypeMap 中移除
    for (const [key, pid] of this.commandTypeMap.entries()) {
      if (pid === processId) {
        this.commandTypeMap.delete(key)
        break
      }
    }

    // 从 processes 中移除
    this.processes.delete(processId)
    
    // 清理 AI 意图
    if (managedProcess.aiIntent) {
      this.aiIntents.delete(managedProcess.aiIntent.intentId)
    }

    log.info(`[ProcessBridge] Cleaned up process record: ${processId}`)
  }

  // 清理无效进程记录
  private cleanupInvalidProcesses(): void {
    const terminals = getTerminals()
    
    for (const [id, process] of this.processes) {
      // 如果终端不存在但进程标记为运行，则清理
      if (process.terminalId && !terminals.has(process.terminalId) && process.isRunning) {
        process.isRunning = false
        this.cleanupProcessRecord(id)
      }
    }
  }
}

export const processBridge = new ProcessTerminalBridge()
