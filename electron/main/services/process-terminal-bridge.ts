import { EventEmitter } from 'events'
import { exec } from 'child_process'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow, ipcMain } from 'electron'
import { getTerminals, writeToTerminal, TerminalSession, onTerminalData, getTerminalOutput } from './terminal-service'

// Process types that should run in terminal
export const TERMINAL_PROCESS_PATTERNS = [
  /npm\s+(run|start|dev|serve)/i,
  /npm\s+run\s+\w+/i,
  /npm\s+(install|i|add|remove|uninstall|ci)/i,
  /node\s+/i,
  /npx\s+/i,
  /yarn\s+(run|start|dev|serve|install|add|remove)/i,
  /pnpm\s+(run|start|dev|serve|install|add|remove)/i,
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
  
  // ✅ 性能优化：定期清理过期进程（防止内存泄漏）
  private cleanupTimer: NodeJS.Timeout | null = null

  setWindow(window: BrowserWindow): void {
    // ✅ 核心修复：如果已经设置过窗口，先清理旧定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
      log.info('[ProcessBridge] Cleared existing cleanup timer')
    }
    
    this.windowRef = window
    
    // ✅ 启动定期清理任务（每小时清理一次）
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredProcesses()
    }, 60 * 60 * 1000)  // 1小时
    log.info('[ProcessBridge] Started periodic cleanup timer (every 1 hour)')
    
    // ✅ 防止定时器泄漏：监听窗口关闭事件
    window.on('closed', () => {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer)
        this.cleanupTimer = null
        log.info('[ProcessBridge] Cleanup timer cleared on window closed')
      }
    })
  }
  
  // ✅ 新增：清理所有资源（应用退出时调用）
  public dispose(): void {
    log.info('[ProcessBridge] Disposing all resources...')
    
    // 清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    
    // 清理所有进程
    for (const [id, process] of this.processes) {
      if (process.isRunning) {
        try {
          process.isRunning = false
          log.debug(`[ProcessBridge] Stopping process ${id} during dispose`)
        } catch (error) {
          log.error(`[ProcessBridge] Failed to stop process ${id}:`, error)
        }
      }
    }
    
    this.processes.clear()
    this.commandTypeMap.clear()
    this.aiIntents.clear()
    
    log.info('[ProcessBridge] All resources disposed')
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

  // 清理命令中的后台执行符号和重定向
  // 将所有命令转换为前台执行，便于在终端中监控
  private cleanCommand(command: string): string {
    // 移除末尾的 & (后台执行)
    let cleaned = command.replace(/\s*&\s*$/, '')
    
    // 移除输出重定向 > /path/to/file 或 >> /path/to/file
    cleaned = cleaned.replace(/\s*>>?\s*\/[^\s&]+/, '')
    
    // 移除错误重定向 2>&1
    cleaned = cleaned.replace(/\s*2>&1/, '')
    
    // 移除单独的 2> /path/to/file
    cleaned = cleaned.replace(/\s*2>\s*\/[^\s&]+/, '')
    
    // 清理多余的空格
    cleaned = cleaned.replace(/\s+/g, ' ').trim()
    
    return cleaned
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
    // ✅ 核心修复：所有命令都在终端中执行，保证环境一致性
    // 避免终端执行和后台执行环境不一致导致的命令找不到问题
    // 无论是什么命令，都统一在终端中执行
    const shouldRun = true
    
    if (!shouldRun) {
      // 保留原有的逻辑作为注释参考
      const commandPart = this.extractCommandPart(command)
      return TERMINAL_PROCESS_PATTERNS.some(pattern => pattern.test(commandPart))
    }
    
    return shouldRun
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
      // 清理命令：去除后台重定向符号，转换为前台执行
      const originalCommand = command
      const cleanedCommand = this.cleanCommand(command)
        
      if (originalCommand !== cleanedCommand) {
        log.debug(`[ProcessBridge] Command cleaned:`)
        log.debug(`  Original: ${originalCommand}`)
        log.debug(`  Cleaned:  ${cleanedCommand}`)
      }
        
      const commandTypeKey = this.getCommandTypeKey(cleanedCommand, cwd)
      log.info(`[ProcessBridge] Starting process: command="${cleanedCommand}"`)

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
            log.debug(`[ProcessBridge] Cleaning up stopped process: ${existingProcessId}`)
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
          // 性能优化：异步停止旧进程，不阻塞当前命令执行
          log.debug(`[ProcessBridge] Reusing existing terminal: ${targetTerminalId}, stopping old process asynchronously`)
          this.stopTerminalProcessAsync(targetTerminalId)  // 不await，异步执行
          // 减少等待时间，只等待100ms确保终端可用
          await new Promise(resolve => setTimeout(resolve, 100))
        } else if (this.windowRef && !this.windowRef.isDestroyed()) {
          // 发送事件到前端创建终端
          log.info(`[ProcessBridge] Creating new terminal: ${expectedTerminalId}`)
          this.windowRef.webContents.send('terminal:create', {
            id: expectedTerminalId,
            cwd: cwd,
            title: this.getCommandDisplayName(command)
          })
          targetTerminalId = expectedTerminalId
          // 性能优化：减少轮询间隔和最大等待时间
          log.debug(`[ProcessBridge] Waiting for terminal ${expectedTerminalId} to be created...`)
          let attempts = 0
          const maxAttempts = 20 // 减少到2秒（20 * 100ms）
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100))
            const terminals = getTerminals()
            if (terminals.has(expectedTerminalId)) {
              log.debug(`[ProcessBridge] Terminal ${expectedTerminalId} created after ${attempts * 100}ms`)
              // 减少xterm初始化等待时间
              await new Promise(resolve => setTimeout(resolve, 150))  // 从300ms减少到150ms
              log.debug(`[ProcessBridge] Ready to write command to terminal ${expectedTerminalId}`)
              break
            }
            attempts++
          }
          if (attempts >= maxAttempts) {
            log.warn(`[ProcessBridge] Terminal creation timeout for ${expectedTerminalId}, proceeding anyway`)
          }
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
            log.debug(`[ProcessBridge] Found running process during double-check: ${doubleCheckProcessId}`)
            return { processId: doubleCheckProcessId, success: true, reused: true }
          }
        }
      }

      // 创建进程记录
      const managedProcess: ManagedProcess = {
        id: processId,
        command: cleanedCommand,  // 存储清理后的命令
        output: [`$ ${cleanedCommand}`, `Working directory: ${cwd}`, '---'],
        isRunning: true,
        startTime: new Date().toISOString(),
        cwd: cwd,
        terminalId: targetTerminalId,
        aiIntent: aiPrompt ? this.createAIIntent(aiPrompt, cleanedCommand, cwd) : undefined,
        commandTypeKey: commandTypeKey,
        port: port
      }

      this.processes.set(processId, managedProcess)
      this.commandTypeMap.set(commandTypeKey, processId)

      // 注册终端输出监听
      if (targetTerminalId) {
        const unsubscribe = onTerminalData(targetTerminalId, (data) => {
          // 将终端输出添加到进程输出缓冲区
          managedProcess.output.push(data)
          // 限制缓冲区大小
          if (managedProcess.output.length > 10000) {
            managedProcess.output = managedProcess.output.slice(-5000)
          }
        })
        // 保存取消订阅函数以便后续清理
        ;(managedProcess as any).unsubscribeTerminal = unsubscribe
      }

      // 清理命令并执行（去除后台重定向，确保前台执行）
      const foregroundCommand = cleanedCommand
        .replace(/\s*>\s*[^&]+?\s*2>&1\s*&?\s*$/, '')
        .replace(/\s*>\s*[^&]+?\s*&?\s*$/, '')
        .replace(/\s*2>&1\s*&?\s*$/, '')
        .replace(/\s*&\s*$/, '')
        .trim()

      log.debug(`[ProcessBridge] About to write to terminal: ${targetTerminalId}`)
      log.debug(`[ProcessBridge] Command to execute: ${foregroundCommand}`)
      
      // 确保终端有干净的提示符 - 性能优化：减少等待时间
      writeToTerminal(targetTerminalId, '\n')
      await new Promise(resolve => setTimeout(resolve, 50))  // 从200ms减少到50ms
            
      // 发送命令
      log.debug(`[ProcessBridge] Executing command in terminal: ${foregroundCommand}`)
      writeToTerminal(targetTerminalId, `${foregroundCommand}\n`)

      // 通知前端
      if (this.windowRef && !this.windowRef.isDestroyed()) {
        this.windowRef.webContents.send('process:started', {
          processId,
          command: originalCommand,  // 发送原始命令用于显示
          cleanedCommand: foregroundCommand,  // 发送清理后的命令用于执行
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

  // 等待进程执行完成
  async waitForProcess(
    processId: string,
    timeoutMs: number = 30000  // ✅ 默认超时从120秒降到30秒
  ): Promise<{ success: boolean; output: string; exitCode?: number; error?: string }> {
    const startTime = Date.now()
    const managedProcess = this.processes.get(processId)
    
    if (!managedProcess) {
      return { success: false, output: '', error: 'Process not found' }
    }

    log.info(`[ProcessBridge] Waiting for process ${processId} to complete (timeout: ${timeoutMs}ms)`)

    // ✅ 性能优化：根据超时时间动态调整检查间隔
    // 短命令（≤10秒）：每100ms检查一次
    // 普通命令（10-60秒）：每500ms检查一次
    // 长命令（>60秒）：每1000ms检查一次
    let checkIntervalMs = 500
    if (timeoutMs <= 10000) {
      checkIntervalMs = 100  // 短命令快速响应
    } else if (timeoutMs > 60000) {
      checkIntervalMs = 1000  // 长命令减少检查频率
    }

    // ✅ 核心修复：使用Promise包装，避免无限循环导致的资源耗尽
    return new Promise((resolve) => {
      let checkInterval: NodeJS.Timeout | null = null
      let timeoutTimer: NodeJS.Timeout | null = null
      
      // 清理函数
      const cleanup = () => {
        if (checkInterval) {
          clearInterval(checkInterval)
          checkInterval = null
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }
      }
      
      // 检查进程状态的函数
      const checkProcessStatus = async () => {
        try {
          // 检查是否超时
          if (Date.now() - startTime > timeoutMs) {
            log.warn(`[ProcessBridge] Process ${processId} timed out after ${timeoutMs}ms`)
            cleanup()
            
            // 取消终端监听
            const unsubscribe = (managedProcess as any).unsubscribeTerminal
            if (unsubscribe) {
              unsubscribe()
            }
            
            resolve({ 
              success: false, 
              output: managedProcess.output.join('\n'), 
              error: `Process timed out after ${timeoutMs}ms`,
              exitCode: -1 
            })
            return
          }

          // 检查进程是否还在运行
          const isRunning = await this.isProcessActuallyRunning(processId)
          if (!isRunning) {
            cleanup()
            
            // 进程已结束，取消终端监听
            const unsubscribe = (managedProcess as any).unsubscribeTerminal
            if (unsubscribe) {
              unsubscribe()
              log.info(`[ProcessBridge] Unsubscribed terminal data for process ${processId}`)
            }
            
            // 进程已结束，获取退出码
            const exitCode = (managedProcess as any).exitCode ?? 0
            const output = managedProcess.output.join('\n')
            
            log.info(`[ProcessBridge] Process ${processId} completed with exit code ${exitCode}, output length: ${output.length}`)
            resolve({
              success: exitCode === 0,
              output: output || '(no output)',
              exitCode
            })
            return
          }
        } catch (error) {
          log.error(`[ProcessBridge] Error checking process status:`, error)
          cleanup()
          resolve({
            success: false,
            output: managedProcess.output.join('\n'),
            error: String(error),
            exitCode: -1
          })
        }
      }
      
      // ✅ 设置定时器，根据超时时间动态调整检查间隔
      checkInterval = setInterval(checkProcessStatus, checkIntervalMs)
      
      // ✅ 设置超时定时器
      timeoutTimer = setTimeout(() => {
        if (checkInterval) {
          checkProcessStatus()  // 最后一次检查
        }
      }, timeoutMs + 100)  // 稍微多一点时间，让checkProcessStatus处理超时
    })
  }

  // 获取AI意图上下文
  getAIIntentContext(processId: string): AIIntentContext | undefined {
    const process = this.processes.get(processId)
    return process?.aiIntent
  }

  // 清理所有进程
  cleanupAll(): void {
    log.info('[ProcessBridge] Cleaning up all processes and resources...')
    
    // ✅ 清理定时器（防止资源泄漏）
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
      log.info('[ProcessBridge] Cleanup timer cleared')
    }
    
    // 清理所有进程
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
    log.info('[ProcessBridge] All processes and resources cleaned up')
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
    
    // 检查终端是否还存在（关键修复）
    if (managedProcess.terminalId) {
      const terminals = getTerminals()
      if (!terminals.has(managedProcess.terminalId)) {
        log.info(`[ProcessBridge] isProcessActuallyRunning: terminal ${managedProcess.terminalId} not found, process ended`)
        // 终端不存在，说明进程已结束
        managedProcess.isRunning = false
        return false
      }
      
      // 终端存在，使用超时机制来判断进程是否完成
      // 对于没有端口的进程，使用启动时间来判断是否超时
      if (!(managedProcess as any)._startTimeForTimeout) {
        (managedProcess as any)._startTimeForTimeout = Date.now()
      }
      
      // 获取进程运行时间
      const runningTime = Date.now() - ((managedProcess as any)._startTimeForTimeout || Date.now())
      
      // 对于短命令（没有端口的服务），如果运行超过30秒，认为可能已经完成
      // 这是一个保守估计，实际应该通过检测终端输出来判断
      if (!managedProcess.port && runningTime > 30000) {
        log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} running for ${runningTime}ms without port, assuming completed`)
        managedProcess.isRunning = false
        ;(managedProcess as any).exitCode = 0
        return false
      }
      
      return managedProcess.isRunning
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

  // ✅ 公开方法：检查进程状态（供外部调用）
  public async checkProcessStatus(processId: string): Promise<{ isRunning: boolean; exitCode?: number }> {
    const isRunning = await this.isProcessActuallyRunning(processId)
    const process = this.processes.get(processId)
    const exitCode = process ? (process as any).exitCode : undefined
    return { isRunning, exitCode }
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

  // 性能优化：异步停止终端进程，不阻塞主线程
  private stopTerminalProcessAsync(terminalId: string): void {
    // 在后台异步执行，不await
    setImmediate(async () => {
      try {
        const terminals = getTerminals()
        if (!terminals.has(terminalId)) return

        log.debug(`[ProcessBridge] Async stopping processes in terminal: ${terminalId}`)

        // 减少Ctrl+C次数和等待时间
        for (let i = 0; i < 3; i++) {
          writeToTerminal(terminalId, '\x03')
          await new Promise(resolve => setTimeout(resolve, 200))  // 从400ms减少到200ms
        }
        
        // 发送 Enter 确保提示符出现
        writeToTerminal(terminalId, '\n')
        await new Promise(resolve => setTimeout(resolve, 300))  // 从600ms减少到300ms
        
        log.debug(`[ProcessBridge] Async finished stopping processes in terminal: ${terminalId}`)
      } catch (error) {
        log.error(`[ProcessBridge] Async stop process error:`, error)
      }
    })
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
  
  // ✅ 性能优化：清理过期进程（定期调用）
  private cleanupExpiredProcesses(): void {
    const now = Date.now()
    const MAX_PROCESS_AGE = 24 * 60 * 60 * 1000  // 24小时
    const cleanedCount = { processes: 0, intents: 0 }
    
    // 清理过期的进程记录
    for (const [id, process] of this.processes) {
      const processAge = now - new Date(process.startTime).getTime()
      if (!process.isRunning && processAge > MAX_PROCESS_AGE) {
        log.debug(`[ProcessBridge] Cleaning up expired process: ${id} (age: ${Math.round(processAge / 1000 / 60)}min)`)
        this.cleanupProcessRecord(id)
        cleanedCount.processes++
      }
    }
    
    // 清理过期的AI意图（24小时未访问）
    for (const [intentId, intent] of this.aiIntents) {
      if (intent.accessCount === 0 && 
          now - new Date(intent.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        this.aiIntents.delete(intentId)
        cleanedCount.intents++
      }
    }
    
    if (cleanedCount.processes > 0 || cleanedCount.intents > 0) {
      log.info(`[ProcessBridge] Periodic cleanup completed: ${cleanedCount.processes} processes, ${cleanedCount.intents} intents removed`)
    }
  }

  // 性能优化：清理无效进程记录（定期调用）
  public cleanupInvalidProcesses(): void {
    const terminals = getTerminals()
    const cleanedCount = { processes: 0, intents: 0 }
    
    for (const [id, process] of this.processes) {
      // 如果终端不存在但进程标记为运行，则清理
      if (process.terminalId && !terminals.has(process.terminalId) && process.isRunning) {
        log.warn(`[ProcessBridge] Cleaning up invalid process: ${id} (terminal ${process.terminalId} not found)`)
        process.isRunning = false
        this.cleanupProcessRecord(id)
        cleanedCount.processes++
      }
    }
    
    // 清理无效的 AI 意图
    for (const [intentId, intent] of this.aiIntents) {
      if (intent.accessCount === 0 && 
          Date.now() - new Date(intent.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        // 24小时未访问的意图，清理
        this.aiIntents.delete(intentId)
        cleanedCount.intents++
      }
    }
    
    if (cleanedCount.processes > 0 || cleanedCount.intents > 0) {
      log.info(`[ProcessBridge] Cleanup completed: ${cleanedCount.processes} processes, ${cleanedCount.intents} intents removed`)
    }
  }

  // 注册IPC handlers
  setupIPCListeners(): void {
    log.info('[ProcessBridge] Setting up IPC listeners')

    // process:start-in-terminal - 在终端中启动进程
    ipcMain.handle('process:start-in-terminal', async (_, { command, cwd, terminalId, aiPrompt }) => {
      try {
        log.info(`[ProcessBridge IPC] Received start-process request: command="${command}", cwd="${cwd}"`)
        const result = await this.startProcess(command, cwd, terminalId, aiPrompt)
        log.info(`[ProcessBridge IPC] Start process result: ${JSON.stringify(result)}`)
        return result
      } catch (error) {
        log.error(`[ProcessBridge IPC] Failed to start process:`, error)
        return { 
          processId: '', 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    })

    // process:stop - 停止进程
    ipcMain.handle('process:stop', async (_, { processId }) => {
      try {
        log.info(`[ProcessBridge IPC] Received stop-process request: ${processId}`)
        const result = await this.stopProcess(processId)
        log.info(`[ProcessBridge IPC] Stop process result: ${JSON.stringify(result)}`)
        return result
      } catch (error) {
        log.error(`[ProcessBridge IPC] Failed to stop process:`, error)
        return { 
          processId, 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    })

    // process:restart - 重启进程
    ipcMain.handle('process:restart', async (_, { processId }) => {
      try {
        log.info(`[ProcessBridge IPC] Received restart-process request: ${processId}`)
        const result = await this.restartProcess(processId)
        log.info(`[ProcessBridge IPC] Restart process result: ${JSON.stringify(result)}`)
        return result
      } catch (error) {
        log.error(`[ProcessBridge IPC] Failed to restart process:`, error)
        return { 
          processId, 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    })

    // process:list - 获取所有进程
    ipcMain.handle('process:list', async () => {
      try {
        return this.getAllProcesses()
      } catch (error) {
        log.error(`[ProcessBridge IPC] Failed to list processes:`, error)
        return []
      }
    })

    // process:should-run-in-terminal - 检查命令是否应该在终端运行
    ipcMain.handle('process:should-run-in-terminal', (_, { command }) => {
      try {
        return this.shouldRunInTerminal(command)
      } catch (error) {
        log.error(`[ProcessBridge IPC] Failed to check should-run-in-terminal:`, error)
        return false
      }
    })

    log.info('[ProcessBridge] IPC listeners setup completed')
  }
}

export const processBridge = new ProcessTerminalBridge()
