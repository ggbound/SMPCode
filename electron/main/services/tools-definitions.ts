/**
 * 工具定义和类型
 * 提供 LLM 函数调用所需的工具定义
 */

import {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolParameter,
  ToolExecutor,
  ExecutionContext,
  ToolExecutionResult,
  createSuccessResult,
  createErrorResult
} from './tools-core'
import { browseWebsite } from './browser-tool-service'

// Simple tool registry
class ToolRegistry {
  private tools: Map<string, ToolExecutor> = new Map()

  register(tool: ToolExecutor): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolExecutor | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolExecutor[] {
    return Array.from(this.tools.values())
  }

  count(): number {
    return this.tools.size
  }

  toOpenAIDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => {
      // 清理参数定义，移除 required 字段（OpenAI API 要求 required 在 parameters 级别）
      const properties: Record<string, Omit<ToolParameter, 'required'>> = {}
      for (const [key, param] of Object.entries(tool.parameters)) {
        properties[key] = {
          type: param.type,
          description: param.description,
          ...(param.enum && { enum: param.enum }),
          ...(param.default !== undefined && { default: param.default })
        }
      }
      
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties,
            required: tool.required
          }
        }
      }
    })
  }
}

export const toolRegistry = new ToolRegistry()

import * as fs from 'fs'
import * as path from 'path'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'
import { getCurrentWorkingDirectory } from './command-executor'
import { processBridge } from './process-terminal-bridge'
import { writeFile, appendFile } from './files-service'  // Import unified file functions
import { BrowserWindow } from 'electron'

const execAsync = promisify(exec)

/**
 * 发送文件操作事件到前端
 */
function notifyFileOperation(operation: 'writing' | 'editing' | 'creating', filePath: string) {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-operation-notification', {
        operation,
        path: filePath,
        timestamp: Date.now()
      })
    }
  } catch (error) {
    log.warn('[tools-definitions] Failed to notify file operation:', error)
  }
}

/**
 * 获取适合当前平台的 shell
 */
function getPlatformShell(): string {
  if (process.platform === 'win32') {
    // Windows: Try PowerShell first, fallback to cmd.exe
    const possibleShells = [
      process.env.COMSPEC,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\powershell.exe',
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
      'powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'cmd.exe'
    ]
    for (const shell of possibleShells) {
      if (shell && require('fs').existsSync(shell)) {
        return shell
      }
    }
    return 'cmd.exe'
  }
  // macOS/Linux
  return process.env.SHELL || '/bin/zsh'
}

/**
 * 使用 spawn 执行命令（更可靠，支持大输出和更好的错误处理）
 */
function spawnPromise(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // 使用用户的 shell 执行命令，确保环境变量正确
    const userShell = getPlatformShell()
    const child = spawn(command, [], {
      cwd,
      env: { ...process.env, ...env },  // 合并系统环境变量和传入的环境变量
      shell: userShell,  // 使用用户的 shell（如 zsh）
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode || 0 })
    })

    child.on('error', (error) => {
      reject(error)
    })

    // 设置超时
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Command timed out after 60s: ${command}`))
    }, 60000)

    child.on('close', () => {
      clearTimeout(timeout)
    })
  })
}

// ============ 参数定义 ============

const pathParam: ToolParameter = {
  type: 'string',
  description: 'The absolute path to the file or directory',
  required: true
}

const contentParam: ToolParameter = {
  type: 'string',
  description: 'The complete content to write to the file',
  required: true
}

const oldStringParam: ToolParameter = {
  type: 'string',
  description: 'The exact text to find and replace (must match exactly including whitespace)',
  required: true
}

const newStringParam: ToolParameter = {
  type: 'string',
  description: 'The new text to replace the old_string with',
  required: true
}

const commandParam: ToolParameter = {
  type: 'string',
  description: 'The bash command to execute',
  required: true
}

const patternParam: ToolParameter = {
  type: 'string',
  description: 'The regex pattern or search query to find (e.g., "export const postApi", "function handleClick", "import React")',
  required: true
}

const searchPathParam: ToolParameter = {
  type: 'string',
  description: 'The directory path to search in (optional, defaults to current working directory)',
  required: false
}

const searchTypeParam: ToolParameter = {
  type: 'string',
  description: 'The type of search to perform. Use "content" to search file contents (default), or "filename" to search for files by name',
  enum: ['content', 'filename'],
  required: false,
  default: 'content'
}

const processIdParam: ToolParameter = {
  type: 'string',
  description: 'The process ID of the process to manage',
  required: true
}

// ============ 工具执行器实现 ============

// Track recently executed commands to prevent duplicates
const recentCommands = new Map<string, number>()
const COMMAND_DEDUP_WINDOW = 5000 // 5 seconds

/**
 * Extract working directory from command if it starts with "cd"
 */
function extractCwdFromCommand(command: string, defaultCwd: string): string {
  const cdMatch = command.match(/^cd\s+(\S+)\s*(&&|;|\n)/)
  if (cdMatch) {
    const extractedPath = cdMatch[1]
    if (extractedPath.startsWith('/')) {
      return extractedPath
    }
    return path.resolve(defaultCwd, extractedPath)
  }
  return defaultCwd
}

// 文件大小限制 (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024

// 默认读取行数限制（防止返回过多内容）
const DEFAULT_MAX_LINES = 100
const MAX_OUTPUT_LENGTH = 50000  // 最大输出字符数

/**
 * Read File Tool
 */
const readFileTool: ToolExecutor = {
  name: 'read_file',
  description: 'Read the contents of a file at the specified path. Use this to examine existing code before editing. Supports offset and limit for large files. Best practice: Always read a file before modifying it to understand its structure and content.',
  parameters: {
    path: pathParam,
    offset: {
      type: 'number',
      description: 'The line offset to start reading from (0-based). Use this to read specific sections of large files.',
      required: false
    },
    limit: {
      type: 'number',
      description: 'The maximum number of lines to read. Default is 100 lines. Use larger values for big files.',
      required: false
    }
  },
  required: ['path'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const filePath = args.path as string
      const offset = args.offset as number | undefined
      const limit = args.limit as number | undefined
      const targetPath = path.resolve(context.cwd, filePath)

      log.info(`[read_file] Reading file: ${targetPath}, offset: ${offset}, limit: ${limit}`)

      if (!fs.existsSync(targetPath)) {
        log.warn(`[read_file] File does not exist: ${targetPath}`)
        return createErrorResult(`File does not exist: ${filePath}`)
      }

      const stats = fs.statSync(targetPath)
      if (stats.isDirectory()) {
        return createErrorResult(`Path is a directory: ${filePath}`)
      }

      // Check file size
      if (stats.size > MAX_FILE_SIZE) {
        log.warn(`[read_file] File too large: ${stats.size} bytes, max: ${MAX_FILE_SIZE}`)
        return createErrorResult(`File is too large (${stats.size} bytes). Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB. Use offset and limit parameters to read partial content.`)
      }

      // Read file content
      let content = fs.readFileSync(targetPath, 'utf-8')
      
      // 始终按行处理，确保不会返回过多内容
      const lines = content.split('\n')
      const totalLines = lines.length
      
      // 如果没有指定参数，使用默认值限制行数
      const startLine = offset || 0
      const lineLimit = limit !== undefined ? limit : DEFAULT_MAX_LINES
      const endLine = Math.min(startLine + lineLimit, totalLines)
      
      const limitedLines = lines.slice(startLine, endLine)
      content = limitedLines.join('\n')
      
      // 进一步限制输出长度
      if (content.length > MAX_OUTPUT_LENGTH) {
        content = content.substring(0, MAX_OUTPUT_LENGTH) + '\n\n... (内容已截断，使用 offset 和 limit 参数读取更多内容)'
      }
      
      const isPartial = endLine < totalLines
      
      return createSuccessResult(content, { 
        filePath: targetPath, 
        size: stats.size,
        startLine: startLine + 1,  // Convert to 1-based
        endLine: endLine,
        totalLines: totalLines,
        isPartial: isPartial,
        hasMore: isPartial
      })
    } catch (error) {
      log.error(`[read_file] Error reading file:`, error)
      return createErrorResult(String(error))
    }
  }
}

/**
 * Write File Tool
 */
const writeFileTool: ToolExecutor = {
  name: 'write_file',
  description: 'Create a new file or overwrite an existing file with the specified content. Use this to create new files or completely replace file contents. Warning: This will overwrite existing files without confirmation.',
  parameters: {
    path: pathParam,
    content: contentParam
  },
  required: ['path', 'content'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const filePath = args.path as string
      const content = args.content as string
      const targetPath = path.resolve(context.cwd, filePath)

      // Notify frontend of file operation
      const isNewFile = !fs.existsSync(targetPath)
      notifyFileOperation(isNewFile ? 'creating' : 'writing', targetPath)

      // Use unified writeFile function to trigger file watchers
      writeFile(targetPath, content)

      return createSuccessResult(`File written successfully: ${targetPath}`, { filePath: targetPath })
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Edit File Tool
 */
const editFileTool: ToolExecutor = {
  name: 'edit_file',
  description: 'Replace specific text in a file with new text. Use this for targeted modifications when you only need to change part of a file. CRITICAL: The old_string must match EXACTLY (including whitespace, indentation, and line breaks) for the replacement to work. Best practice: Always read the file first to get the exact text.',
  parameters: {
    path: pathParam,
    old_string: oldStringParam,
    new_string: newStringParam
  },
  required: ['path', 'old_string', 'new_string'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const filePath = args.path as string
      const oldString = args.old_string as string
      const newString = args.new_string as string
      const targetPath = path.resolve(context.cwd, filePath)

      // Ensure parent directory exists
      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      // If file doesn't exist, create it with new_string content
      if (!fs.existsSync(targetPath)) {
        notifyFileOperation('creating', targetPath)
        writeFile(targetPath, newString)
        return createSuccessResult(`File created (did not exist): ${targetPath}`, { filePath: targetPath, created: true })
      }

      // Notify frontend of file edit operation
      notifyFileOperation('editing', targetPath)

      let content = fs.readFileSync(targetPath, 'utf-8')

      // Try exact match first
      if (content.includes(oldString)) {
        content = content.replace(oldString, newString)
        writeFile(targetPath, content)
        return createSuccessResult(`File edited successfully: ${targetPath}`, { filePath: targetPath })
      }

      // If exact match fails, try normalized match (handle whitespace differences)
      const normalizedOld = oldString.replace(/\s+/g, ' ').trim()
      const normalizedContent = content.replace(/\s+/g, ' ')
      
      if (normalizedContent.includes(normalizedOld)) {
        // Find the actual text in the original content
        // This is a best-effort attempt to find similar text
        const lines = oldString.split('\n')
        const firstLine = lines[0].trim()
        const lastLine = lines[lines.length - 1].trim()
        
        // Try to find by first and last line
        const contentLines = content.split('\n')
        let startIdx = -1
        let endIdx = -1
        
        for (let i = 0; i < contentLines.length; i++) {
          if (contentLines[i].trim() === firstLine && startIdx === -1) {
            startIdx = i
          }
          if (contentLines[i].trim() === lastLine && startIdx !== -1) {
            endIdx = i
            break
          }
        }
        
        if (startIdx !== -1 && endIdx !== -1) {
          const actualOldString = contentLines.slice(startIdx, endIdx + 1).join('\n')
          content = content.replace(actualOldString, newString)
          writeFile(targetPath, content)
          return createSuccessResult(`File edited successfully (with whitespace normalization): ${targetPath}`, { filePath: targetPath })
        }
      }

      // Build detailed error message with suggestions
      let errorMsg = `Could not find the exact text to replace in ${filePath}.\n\n`
      errorMsg += `The text must match exactly including whitespace, indentation, and line breaks.\n\n`
      errorMsg += `Looking for (${oldString.length} characters):\n`
      errorMsg += `---\n${oldString.substring(0, 200)}${oldString.length > 200 ? '...' : ''}\n---\n\n`
      
      // Show file preview
      const preview = content.substring(0, 500)
      errorMsg += `File content preview (${content.length} characters total):\n`
      errorMsg += `---\n${preview}${content.length > 500 ? '...' : ''}\n---\n\n`
      errorMsg += `Suggestion: Use read_file to get the exact text including all whitespace.`
      
      return createErrorResult(errorMsg)
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Append File Tool
 * For large file writing, use write_file to create initial file, then append_file to add content
 */
const appendFileTool: ToolExecutor = {
  name: 'append_file',
  description: 'Append content to the end of an existing file. Use this to add content to large files without rewriting the entire file. If the file does not exist, it will be created. Best for: adding log entries, adding new functions to the end of files, building large files incrementally.',
  parameters: {
    path: pathParam,
    content: contentParam
  },
  required: ['path', 'content'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const filePath = args.path as string
      const content = args.content as string
      const targetPath = path.resolve(context.cwd, filePath)

      // Ensure parent directory exists
      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      // Append content to file (create if doesn't exist) - use unified function to trigger watchers
      appendFile(targetPath, content)
      
      const action = fs.existsSync(targetPath) ? 'Appended to' : 'Created'
      return createSuccessResult(`${action} file: ${targetPath}`, { filePath: targetPath })
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * List Directory Tool
 */
const listDirectoryTool: ToolExecutor = {
  name: 'list_directory',
  description: 'List the contents of a directory. Use this to explore the project structure and find files. Best practice: Use this before read_file to understand the project layout and locate relevant files.',
  parameters: {
    path: pathParam
  },
  required: ['path'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const dirPath = args.path as string
      const targetPath = path.resolve(context.cwd, dirPath)

      if (!fs.existsSync(targetPath)) {
        return createErrorResult(`Directory does not exist: ${dirPath}`)
      }

      const stats = fs.statSync(targetPath)
      if (!stats.isDirectory()) {
        return createErrorResult(`Path is not a directory: ${dirPath}`)
      }

      const items = fs.readdirSync(targetPath)
      const output = items
        .filter(item => !item.startsWith('.') && item !== 'node_modules')
        .map(item => {
          const itemPath = path.join(targetPath, item)
          const itemStats = fs.statSync(itemPath)
          return itemStats.isDirectory() ? `${item}/` : item
        })
        .join('\n')

      return createSuccessResult(output || '(empty directory)', { dirPath: targetPath, itemCount: items.length })
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Delete File Tool
 */
const deleteFileTool: ToolExecutor = {
  name: 'delete_file',
  description: 'Delete a file or directory at the specified path. Use this to remove files or directories that are no longer needed. Warning: This action is permanent and cannot be undone. Use with caution.',
  parameters: {
    path: pathParam
  },
  required: ['path'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const filePath = args.path as string
      const targetPath = path.resolve(context.cwd, filePath)

      if (!fs.existsSync(targetPath)) {
        return createErrorResult(`Path does not exist: ${filePath}`)
      }

      const stats = fs.statSync(targetPath)
      if (stats.isDirectory()) {
        fs.rmdirSync(targetPath, { recursive: true })
        return createSuccessResult(`Removed directory: ${targetPath}`, { path: targetPath, type: 'directory' })
      } else {
        fs.unlinkSync(targetPath)
        return createSuccessResult(`Removed file: ${targetPath}`, { path: targetPath, type: 'file' })
      }
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Execute Bash Tool
 */
const executeBashTool: ToolExecutor = {
  name: 'execute_bash',
  description: 'Execute a bash/shell command. Use this to run commands like npm install, git operations, build commands, etc. Commands run in an integrated terminal. Long-running commands like "npm run dev" will start in the background and return immediately.',
  parameters: {
    command: commandParam
  },
  required: ['command'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const command = args.command as string
      // 使用传入的 context.cwd 而不是全局的 getCurrentWorkingDirectory()
      const baseCwd = context?.cwd || getCurrentWorkingDirectory()
      const cwd = extractCwdFromCommand(command, baseCwd)
      const commandKey = `${cwd}:${command}`
      const now = Date.now()

      // ✅ 修复：改进去重逻辑，只在进程真正运行时才跳过
      const lastExecution = recentCommands.get(commandKey)
      if (lastExecution && (now - lastExecution) < COMMAND_DEDUP_WINDOW) {
        // 检查是否有正在运行的相同命令进程
        const allProcesses = processBridge.getAllProcesses()
        const runningProcess = allProcesses.find(p => {
          if (!p.isRunning || !p.terminalId) return false
          // 检查是否是相同命令和相同目录
          return p.cwd === cwd && p.command === command
        })

        if (runningProcess) {
          // ✅ 修复：检查进程是否真的在运行（不是卡死状态）
          const processStatus = await processBridge.checkProcessStatus(runningProcess.id)
          
          // 如果进程还在运行，才跳过
          if (processStatus.isRunning) {
            log.info(`[execute_bash] Command already running, skipping: ${command}`)
            return createSuccessResult(
              `Command is already running. Process ID: ${runningProcess.id}`,
              { processId: runningProcess.id, duplicate: true, skipped: true }
            )
          } else {
            // 进程已经退出，允许重新执行
            log.warn(`[execute_bash] Previous process exited, allowing re-execution: ${command}`)
            // 不清理 recentCommands，让新的执行记录覆盖
          }
        }
      }

      // Record this command execution
      recentCommands.set(commandKey, now)

      // Clean up old entries
      for (const [key, timestamp] of recentCommands.entries()) {
        if (now - timestamp > COMMAND_DEDUP_WINDOW) {
          recentCommands.delete(key)
        }
      }


      // Check if command should run in terminal
      const shouldRunInTerminal = processBridge.shouldRunInTerminal(command)
      
      // 检测是否包含后台运行符 &
      const isBackgroundCommand = /&\s*$/.test(command.trim()) || /&\s*\n/.test(command)
      
      // 检测是否是长运行的开发服务器类命令（不应该等待进程结束）
      const isDevServerCommand = /npm\s+run\s+(dev|serve|start)|vite|next\s+dev|nuxt\s+dev|vue-cli-service\s+serve|php\s+artisan\s+serve/i.test(command)
      
      // ✅ 核心修复：所有命令都在终端中执行，保证环境一致性
      // 无论是否是后台命令，都在终端中执行，避免环境不一致问题
      if (shouldRunInTerminal) {
        const result = await processBridge.startProcess(command, cwd)
        if (result.success) {
          // 对于开发服务器类命令，等待足够时间让进程启动并输出结果
          if (isDevServerCommand) {
                  
            // ✅ 增加等待时间到10秒，让进程有足够时间启动和输出
            // PHP/NPM项目启动通常需要5-8秒
            const waitTime = 10000
            await new Promise(resolve => setTimeout(resolve, waitTime))
                  
            // ✅ 获取实际终端输出（包括stdout和stderr）
            const initialOutput = processBridge.getProcessOutput(result.processId)
            const outputText = initialOutput && initialOutput.length > 0 
              ? initialOutput.join('\n') 
              : '(no output yet)'
                  
            // ✅ 检查进程是否还在运行
            const processStatus = await processBridge.checkProcessStatus(result.processId)
            const isStillRunning = processStatus.isRunning
                  
                  
            // ✅ 如果进程已经退出，说明启动失败，返回错误
            if (!isStillRunning) {
              const exitCode = processStatus.exitCode ?? -1
              log.error(`[execute_bash] Dev server process exited early with code ${exitCode}`)
              return createErrorResult(
                `Development server failed to start. Process exited with code ${exitCode}.\n\nOutput:\n${outputText}`, 
                outputText,
                { processId: result.processId, terminal: true, exitCode, failed: true }
              )
            }
                  
            // ✅ 进程还在运行，说明启动成功，返回实际输出
            return createSuccessResult(
              `Development server is running in terminal.\n\nStartup output:\n${outputText}\n\n✅ Server is running and ready.`, 
              { processId: result.processId, terminal: true, devServer: true, running: true }
            )
          }
      
          // ✅ 性能优化：根据命令类型设置不同的超时时间，避免长时间占用资源
          // 短命令（检查类）：5秒，普通命令：30秒，长命令：60秒
          let timeoutMs = 30000  // 默认30秒
          
          if (/ps |top |which |whereis |ls |cat |grep |find |head |tail |wc |echo |pwd |whoami/i.test(command)) {
            timeoutMs = 5000  // 检查类命令只需要5秒
          } else if (/npm run build|vite build|webpack|tsc |python.*compile|javac/i.test(command)) {
            timeoutMs = 60000  // 编译类命令需要60秒
          }
          
          const waitResult = await processBridge.waitForProcess(result.processId, timeoutMs)
      
          if (waitResult.success) {
            return createSuccessResult(
              waitResult.output,
              { processId: result.processId, terminal: true, exitCode: waitResult.exitCode }
            )
          } else {
            return createErrorResult(
              waitResult.error || 'Process execution failed',
              waitResult.output
            )
          }
        } else {
          return createErrorResult(`Failed to start process in terminal: ${result.error}`)
        }
      }

      // ✅ 所有命令都在终端中执行，不再使用直接执行方式
      // 这样可以保证所有命令在相同的环境中执行，避免环境不一致问题
      log.warn(`[execute_bash] Command should not run in terminal: ${command}`)
      return createErrorResult(
        `This command cannot be executed. Please use the integrated terminal instead.`,
        '',
        { shouldRunInTerminal: false }
      )
    } catch (error: any) {
      return createErrorResult(
        error.message || String(error),
        ''
      )
    }
  }
}

/**
 * Search Files Tool
 */
const searchCodeTool: ToolExecutor = {
  name: 'search_files',
  description: 'Search for files by pattern in the project. Use "content" mode (default) to search file contents with grep, or "filename" mode to search for files by name. Best for: finding where a function is defined, finding all usages of a variable, searching for specific patterns, or finding files by name.',
  parameters: {
    pattern: patternParam,
    path: searchPathParam,
    search_type: searchTypeParam
  },
  required: ['pattern'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      // Support both 'pattern' and 'query' as parameter names for compatibility
      const pattern = (args.pattern as string) || (args.query as string)
      const searchType = (args.search_type as string) || 'content'
      
      if (!pattern) {
        return createErrorResult('Missing required parameter: pattern (or query)')
      }
      
      const searchPath = args.path as string | undefined
      const targetPath = searchPath ? path.resolve(context.cwd, searchPath) : context.cwd

      if (!fs.existsSync(targetPath)) {
        return createErrorResult(`Path does not exist: ${searchPath || '.'}`)
      }

      // ✅ 修复：支持文件名搜索
      if (searchType === 'filename') {
        // 使用 find 命令搜索文件名（不限制文件类型）
        const { stdout, stderr } = await execAsync(
          `find "${targetPath}" -type f -name "*${pattern.replace(/"/g, '\\"')}*" 2>/dev/null | head -50`,
          { timeout: 30000 }
        )

        if (stderr && !stdout) {
          return createErrorResult(stderr)
        }

        const files = stdout.trim().split('\n').filter(f => f)
        if (files.length === 0) {
          return createSuccessResult('No files found matching the pattern')
        }

        return createSuccessResult(files.join('\n'), { matchCount: files.length, searchType: 'filename' })
      }

      // 默认：使用 grep 搜索文件内容
      // Escape special shell characters and use single quotes for the pattern
      // This handles quotes, backslashes, and other special regex characters
      const escapedPattern = pattern.replace(/'/g, "'\"'\"'").replace(/\\/g, '\\\\')
      
      const { stdout, stderr } = await execAsync(
        `grep -r '${escapedPattern}' "${targetPath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.java" --include="*.go" --include="*.rs" -l 2>/dev/null || true`,
        { timeout: 30000 }
      )

      if (stderr && !stdout) {
        return createErrorResult(stderr)
      }

      const files = stdout.trim().split('\n').filter(f => f)
      if (files.length === 0) {
        return createSuccessResult('No matches found')
      }

      return createSuccessResult(files.join('\n'), { matchCount: files.length, searchType: 'content' })
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Get Running Processes Tool
 */
const getRunningProcessesTool: ToolExecutor = {
  name: 'get_running_processes',
  description: 'Get a list of all currently running processes managed by the application. Use this to check which services are running and get their process IDs for management.',
  parameters: {},
  required: [],
  execute: async (): Promise<ToolExecutionResult> => {
    try {
      const processes = processBridge.getAllProcesses()
      const runningProcesses = processes.filter(p => p.isRunning)

      if (runningProcesses.length === 0) {
        return createSuccessResult('No running processes found')
      }

      const output = runningProcesses.map(p => {
        const startTime = new Date(p.startTime).toLocaleString()
        return `Process ID: ${p.id}\nCommand: ${p.command}\nWorking Directory: ${p.cwd}\nStarted: ${startTime}\nTerminal ID: ${p.terminalId || 'N/A'}\n---`
      }).join('\n')

      return createSuccessResult(output, { processCount: runningProcesses.length })
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Stop Process Tool
 */
const stopProcessTool: ToolExecutor = {
  name: 'stop_process',
  description: 'Stop a running process by its process ID. Use this to terminate specific services or processes that were started through the application.',
  parameters: {
    process_id: processIdParam
  },
  required: ['process_id'],
  execute: async (args): Promise<ToolExecutionResult> => {
    try {
      const processId = args.process_id as string

      if (!processId) {
        return createErrorResult('Process ID is required')
      }

      const result = await processBridge.stopProcess(processId)

      if (result.success) {
        if (result.actuallyStopped) {
          return createSuccessResult(`Process ${processId} stopped successfully`, { processId })
        } else {
          return createSuccessResult(
            `Stop signal sent to process ${processId}, but could not verify if process actually stopped. Please check the terminal to confirm.`,
            { processId, verified: false }
          )
        }
      } else {
        return createErrorResult(result.error || 'Failed to stop process', '', { processId })
      }
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Restart Process Tool
 */
const restartProcessTool: ToolExecutor = {
  name: 'restart_process',
  description: 'Restart a running process by its process ID. This will stop the process and start it again. Use this to restart services after code changes.',
  parameters: {
    process_id: processIdParam
  },
  required: ['process_id'],
  execute: async (args): Promise<ToolExecutionResult> => {
    try {
      const processId = args.process_id as string

      if (!processId) {
        return createErrorResult('Process ID is required')
      }

      const result = await processBridge.restartProcess(processId)

      if (result.success) {
        return createSuccessResult(
          `Process ${processId} restarted successfully. New process ID: ${result.processId}`,
          { oldProcessId: processId, newProcessId: result.processId }
        )
      } else {
        return createErrorResult(result.error || 'Failed to restart process', '', { processId })
      }
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

// ============ 端口和进程管理工具 ============

/**
 * Check Port Tool
 */
const checkPortTool: ToolExecutor = {
  name: 'check_port',
  description: 'Check if a network port is occupied by any process. Returns process information if occupied, or indicates availability if free. Use this before starting services to avoid port conflicts.',
  parameters: {
    port: {
      type: 'number',
      description: 'The port number to check (e.g., 3000, 5173, 8080)'
    }
  },
  required: ['port'],
  execute: async (args): Promise<ToolExecutionResult> => {
    try {
      const port = args.port as number

      if (!port || typeof port !== 'number') {
        return createErrorResult('Port number is required')
      }

      let stdout = ''
      try {
        // 先尝试获取所有使用端口的进程
        const result = await execAsync(
          `lsof -i :${port} -P -n 2>/dev/null || true`,
          { timeout: 10000 }
        )
        stdout = result.stdout
      } catch (execError) {
        // lsof 可能不存在或需要权限，尝试使用 netstat
        try {
          const result = await execAsync(
            `netstat -anv 2>/dev/null | grep ".${port} " | grep LISTEN || true`,
            { timeout: 10000 }
          )
          stdout = result.stdout
        } catch (netstatError) {
          // 如果都失败了，假设端口可用
          return createSuccessResult(
            JSON.stringify({
              port,
              occupied: false,
              message: `Port ${port} appears to be available (could not verify with lsof/netstat)`
            }, null, 2),
            { port, occupied: false }
          )
        }
      }

      // 过滤 LISTEN 状态的进程
      const lines = stdout.split('\n').filter(line => line.includes('LISTEN'))

      if (lines.length === 0) {
        return createSuccessResult(
          JSON.stringify({
            port,
            occupied: false,
            message: `Port ${port} is available`
          }, null, 2),
          { port, occupied: false }
        )
      }

      // 解析进程信息
      const processes = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        // lsof 格式: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        if (parts.length >= 9) {
          return {
            command: parts[0],
            pid: parseInt(parts[1], 10) || 0,
            user: parts[2],
            fd: parts[3],
            type: parts[4],
            device: parts[5],
            size: parts[6],
            node: parts[7],
            name: parts[8]
          }
        }
        return null
      }).filter(Boolean)

      if (processes.length === 0) {
        return createSuccessResult(
          JSON.stringify({
            port,
            occupied: false,
            message: `Port ${port} is available`
          }, null, 2),
          { port, occupied: false }
        )
      }

      return createSuccessResult(
        JSON.stringify({
          port,
          occupied: true,
          processes,
          message: `Port ${port} is occupied by ${processes.length} process(es)`
        }, null, 2),
        { port, occupied: true, processCount: processes.length }
      )
    } catch (error) {
      // 即使出错也返回成功，但标记为无法验证
      return createSuccessResult(
        JSON.stringify({
          port: args.port,
          occupied: false,
          message: `Port ${args.port} appears to be available (check failed: ${String(error)})`
        }, null, 2),
        { port: args.port, occupied: false, error: String(error) }
      )
    }
  }
}

/**
 * Kill Process Tool
 */
const killProcessTool: ToolExecutor = {
  name: 'kill_process',
  description: 'Terminate a process by its PID (Process ID). Use SIGTERM for graceful shutdown or SIGKILL for force kill. Use this after finding a process with find_process or check_port.',
  parameters: {
    pid: {
      type: 'number',
      description: 'The process ID (PID) to terminate'
    },
    signal: {
      type: 'string',
      description: 'Signal to send: SIGTERM (graceful, default) or SIGKILL (force)',
      enum: ['SIGTERM', 'SIGKILL']
    }
  },
  required: ['pid'],
  execute: async (args): Promise<ToolExecutionResult> => {
    try {
      const pid = args.pid as number
      const signal = (args.signal as string) || 'SIGTERM'

      if (!pid || typeof pid !== 'number') {
        return createErrorResult('PID is required')
      }

      process.kill(pid, signal as NodeJS.Signals)

      return createSuccessResult(
        `Process ${pid} killed successfully with signal ${signal}`,
        { pid, signal }
      )
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

/**
 * Find Process Tool
 */
const findProcessTool: ToolExecutor = {
  name: 'find_process',
  description: 'Find processes by name or port. Returns process details including PID, command, and arguments. Use this to locate processes before killing them.',
  parameters: {
    name: {
      type: 'string',
      description: 'Process name to search for (e.g., "node", "python")'
    },
    port: {
      type: 'number',
      description: 'Port number to search for'
    }
  },
  required: [],
  execute: async (args): Promise<ToolExecutionResult> => {
    try {
      const name = args.name as string
      const port = args.port as number

      if (!name && !port) {
        return createErrorResult('Name or port is required')
      }

      let command: string

      if (port) {
        command = `lsof -i :${port} -P -n -t || true`
      } else {
        command = `pgrep -f "${name.replace(/"/g, '\\"')}" || true`
      }

      const { stdout } = await execAsync(command, { timeout: 10000 })
      const pids = stdout.trim().split('\n').filter(Boolean).map(Number)

      if (pids.length === 0) {
        return createSuccessResult(
          JSON.stringify({
            found: false,
            message: name ? `No process found with name: ${name}` : `No process found using port: ${port}`
          }, null, 2),
          { found: false }
        )
      }

      const processes = await Promise.all(
        pids.map(async (pid) => {
          try {
            const { stdout: psOutput } = await execAsync(
              `ps -p ${pid} -o pid,ppid,comm,args | tail -n 1`,
              { timeout: 5000 }
            )
            const parts = psOutput.trim().split(/\s+/)
            return {
              pid,
              ppid: parseInt(parts[1], 10),
              command: parts[2],
              args: parts.slice(3).join(' ')
            }
          } catch {
            return { pid, command: 'unknown', args: '' }
          }
        })
      )

      return createSuccessResult(
        JSON.stringify({
          found: true,
          processes,
          message: `Found ${processes.length} process(es)`
        }, null, 2),
        { found: true, count: processes.length }
      )
    } catch (error) {
      return createErrorResult(String(error))
    }
  }
}

// ============ 浏览器工具 ============

/**
 * Browse Website Tool
 * 打开网页并获取内容
 */
const browseWebsiteTool: ToolExecutor = {
  name: 'browse_website',
  description: 'Open a website URL and extract its content for analysis. Use this when you need to read web pages, documentation, or any online content. The tool will load the page in a hidden browser, wait for JavaScript to execute, and extract the main text content. Supports both http and https URLs.',
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
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      const url = args.url as string
      const waitForSelector = args.wait_for_selector as string | undefined
      const timeout = args.timeout as number | undefined
      const maxLength = args.max_length as number | undefined

      log.info(`[browse_website] Opening URL: ${url}`)

      const result = await browseWebsite(url, {
        waitForSelector,
        timeout,
        maxLength
      })

      if (!result.success) {
        return createErrorResult(result.error || 'Failed to browse website')
      }

      // 格式化输出
      const output = `Title: ${result.title || 'N/A'}
URL: ${result.url}
Load Time: ${result.metadata?.loadTime}ms
Content Length: ${result.metadata?.contentLength} characters
Has JavaScript: ${result.metadata?.hasJavaScript}

--- Content ---
${result.content}`

      return createSuccessResult(output, {
        title: result.title,
        url: result.url,
        loadTime: result.metadata?.loadTime,
        contentLength: result.metadata?.contentLength,
        hasJavaScript: result.metadata?.hasJavaScript
      })
    } catch (error) {
      log.error(`[browse_website] Error:`, error)
      return createErrorResult(String(error))
    }
  }
}

// ============ 定时任务工具 ============

const listRemindersTool: ToolExecutor = {
  name: 'list_reminders',
  description: 'List all scheduled reminders/tasks. Use this when user asks to check scheduled tasks or reminders.',
  parameters: {},
  required: [],
  execute: async (): Promise<ToolExecutionResult> => {
    try {
      // 动态导入避免循环依赖
      const { getAllReminders } = await import('./reminder-service')
      const reminders = getAllReminders()
      
      if (reminders.length === 0) {
        return createSuccessResult(
          JSON.stringify({
            message: '暂无定时提醒',
            count: 0,
            reminders: []
          }, null, 2),
          { count: 0 }
        )
      }

      const reminderList = reminders.map(r => ({
        id: r.id,
        content: r.content,
        cronExpression: r.cronExpression,
        targetType: r.targetType,
        targetId: r.targetId,
        enabled: r.enabled,
        triggerCount: r.triggerCount,
        lastTriggeredAt: r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString('zh-CN') : '从未',
        createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : ''
      }))

      return createSuccessResult(
        JSON.stringify({
          message: `找到 ${reminders.length} 个定时提醒`,
          count: reminders.length,
          reminders: reminderList
        }, null, 2),
        { count: reminders.length }
      )
    } catch (error) {
      log.error(`[list_reminders] Error:`, error)
      return createErrorResult(String(error))
    }
  }
}

// ============ 注册所有工具 ============

import { toolManager } from './tool-manager'

export function registerAllTools(): void {
  toolRegistry.register(readFileTool)
  toolRegistry.register(writeFileTool)
  toolRegistry.register(editFileTool)
  toolRegistry.register(appendFileTool)
  toolRegistry.register(listDirectoryTool)
  toolRegistry.register(deleteFileTool)
  toolRegistry.register(executeBashTool)
  toolRegistry.register(searchCodeTool)
  toolRegistry.register(getRunningProcessesTool)
  toolRegistry.register(stopProcessTool)
  toolRegistry.register(restartProcessTool)
  toolRegistry.register(checkPortTool)
  toolRegistry.register(killProcessTool)
  toolRegistry.register(findProcessTool)
  toolRegistry.register(browseWebsiteTool)
  toolRegistry.register(listRemindersTool)

  // 注册 MCP 工具
  const mcpDefinitions = toolManager.getMcpToolDefinitions()
  for (const { serverId, tools } of mcpDefinitions) {
    for (const tool of tools) {
      const mcpToolName = `mcp:${serverId}:${tool.name}`
      const mcpTool: ToolExecutor = {
        name: mcpToolName,
        description: `[MCP] ${tool.description || 'MCP tool from ' + serverId}`,
        parameters: tool.inputSchema?.properties || {},
        required: tool.inputSchema?.required || [],
        execute: async (args: Record<string, unknown>, _context: ExecutionContext): Promise<ToolExecutionResult> => {
          // 实际执行在 tool-manager.ts 中处理
          return { success: true, output: '' }
        }
      }
      toolRegistry.register(mcpTool)
      log.info(`[ToolDefinitions] Registered MCP tool: ${mcpToolName}`)
    }
  }

  // 刷新 CODE_TOOLS 数组
  refreshCodeTools()

  log.info(`[ToolDefinitions] Registered ${toolRegistry.count()} tools`)
}

// ============ 导出 ============

// 导出类型
export type { ToolDefinition, ToolCall, ToolResult, ToolParameter, ToolExecutor, ExecutionContext, ToolExecutionResult }

// 导出工具定义数组（OpenAI 格式）- 动态获取
export function getCodeTools(): ToolDefinition[] {
  return toolRegistry.toOpenAIDefinitions()
}

// 为了保持向后兼容，仍然导出 CODE_TOOLS，但它只是 getCodeTools() 的引用
export const CODE_TOOLS: ToolDefinition[] = []

// 刷新工具定义（在 MCP 服务器连接后调用）
export function refreshCodeTools(): void {
  const tools = toolRegistry.toOpenAIDefinitions()
  // 更新 CODE_TOOLS 数组内容
  CODE_TOOLS.length = 0
  CODE_TOOLS.push(...tools)
  log.info(`[ToolDefinitions] Refreshed CODE_TOOLS with ${tools.length} tools`)
}

// 导出便捷函数（toolRegistry 已在上面定义）

// 工具名称映射（支持别名和向后兼容）
const TOOL_NAME_MAP: Record<string, string> = {
  // 别名映射
  'bash': 'execute_bash',  // bash -> execute_bash
  'shell': 'execute_bash', // shell -> execute_bash
  'cmd': 'execute_bash',   // cmd -> execute_bash
  'terminal': 'execute_bash', // terminal -> execute_bash
  
  // 大驼峰命名向后兼容
  'FileWriteTool': 'write_file',
  'FileReadTool': 'read_file',
  'FileEditTool': 'edit_file',
  'FileAppendTool': 'append_file',
  'ListDirectoryTool': 'list_directory',
  'DeleteFileTool': 'delete_file',
  'BashTool': 'execute_bash',
  'SearchCodeTool': 'search_code',
  'GetRunningProcessesTool': 'get_running_processes',
  'StopProcessTool': 'stop_process',
  'RestartProcessTool': 'restart_process'
}

// 参数名映射（支持大驼峰参数向后兼容）
const PARAMETER_NAME_MAP: Record<string, string> = {
  'file_path': 'path',
  'old_string': 'old_string',
  'new_string': 'new_string',
  'content': 'content',
  'command': 'command',
  'timeout': 'timeout',
  'pattern': 'pattern',
  'path': 'path'
}

/**
 * 转换工具名称（支持向后兼容）
 */
export function normalizeToolName(name: string): string {
  return TOOL_NAME_MAP[name] || name
}

/**
 * 转换参数名（支持向后兼容）
 */
function normalizeParameters(args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const normalizedKey = PARAMETER_NAME_MAP[key] || key
    normalized[normalizedKey] = value
  }
  return normalized
}

// 注意：工具执行已迁移到 tool-manager.ts
// 如需执行工具，请使用: import { executeTool } from './tool-executor'
