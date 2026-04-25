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
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters,
          required: tool.required
        }
      }
    }))
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

const execPromise = promisify(exec)

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
 * 使用 spawn 执行命令（更可靠，支持大输出和更好的错误处理）
 */
function spawnPromise(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // 使用 shell 执行命令，确保管道和重定向正常工作
    const child = spawn(command, [], {
      cwd,
      env,
      shell: true,  // 使用 shell 执行，支持管道、重定向等
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

      // Check for duplicate command within dedup window
      const lastExecution = recentCommands.get(commandKey)
      if (lastExecution && (now - lastExecution) < COMMAND_DEDUP_WINDOW) {
        // Check if there's a running process with similar command in the same directory
        const runningProcesses = processBridge.getAllProcesses().filter(p => {
          if (!p.isRunning || !p.terminalId) return false
          // Check if the process is running in the same directory
          return p.cwd === cwd
        })

        if (runningProcesses.length > 0) {
          log.warn(`Duplicate command detected and process is running, skipping: ${command}`)
          return createSuccessResult(
            `Command is already running (duplicate detected). Process ID: ${runningProcesses[0].id}`,
            { processId: runningProcesses[0].id, duplicate: true }
          )
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

      log.info(`Executing bash command: ${command} in ${cwd} (base: ${baseCwd})`)

      // Check if command should run in terminal
      const shouldRunInTerminal = processBridge.shouldRunInTerminal(command)

      // 检测是否包含后台运行符 &
      const isBackgroundCommand = /&\s*$/.test(command.trim()) || /&\s*\n/.test(command)

      // 检测是否是长运行的开发服务器类命令（不应该等待进程结束）
      const isDevServerCommand = /npm\s+run\s+(dev|serve|start)|vite|next\s+dev|nuxt\s+dev|vue-cli-service\s+serve/i.test(command)

      if (shouldRunInTerminal && !isBackgroundCommand) {
        const result = await processBridge.startProcess(command, cwd)
        if (result.success) {
          // 对于开发服务器类命令，不等待进程完成，立即返回
          if (isDevServerCommand) {
            log.info(`[execute_bash] Dev server command started, not waiting for completion: ${result.processId}`)
            // 等待一小段时间收集初始输出
            await new Promise(resolve => setTimeout(resolve, 3000))
            const initialOutput = processBridge.getProcessOutput(result.processId)
            const outputText = initialOutput ? initialOutput.join('\n') : 'Process started in terminal'
            return createSuccessResult(
              `Development server started in terminal.\n\nInitial output:\n${outputText}`,
              { processId: result.processId, terminal: true, devServer: true }
            )
          }

          // 等待进程执行完成（对于非开发服务器命令）
          log.info(`[execute_bash] Waiting for process ${result.processId} to complete...`)
          const waitResult = await processBridge.waitForProcess(result.processId, 120000)

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

      // 对于后台命令或短命令，使用直接执行方式
      if (isBackgroundCommand) {
        log.info(`[execute_bash] Background command detected, executing directly: ${command.substring(0, 100)}`)
      }

      // For short commands, execute directly
      // Build PATH environment variable with common directories
      const pathDirs = [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        `${process.env.HOME}/.local/bin`,
        `${process.env.HOME}/bin`,
        `${process.env.HOME}/.npm-global/bin`,
        '/usr/local/share/npm/bin',
        process.env.PATH || ''
      ].filter(Boolean)

      const env = {
        ...process.env,
        PATH: pathDirs.join(':')
      }

      log.info(`[execute_bash] Direct execution: command="${command}", cwd="${cwd}"`)
      log.info(`[execute_bash] Direct execution PATH: ${env.PATH}`)

      try {
        // 使用 spawnPromise 替代 execPromise，更可靠
        const { stdout, stderr, exitCode } = await spawnPromise(command, cwd, env)
        log.info(`[execute_bash] Direct execution completed: exitCode=${exitCode}, stdout="${stdout?.substring(0, 200)}", stderr="${stderr?.substring(0, 200)}"`)

        if (exitCode !== 0) {
          return createErrorResult(
            `Command failed with exit code ${exitCode}: ${stderr || stdout || 'Unknown error'}`,
            stdout
          )
        }

        return createSuccessResult(stdout || '(no output)', { stderr: stderr || undefined, exitCode })
      } catch (execError: any) {
        log.error(`[execute_bash] Direct execution failed:`, execError)
        return createErrorResult(
          execError.message || String(execError),
          ''
        )
      }
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
  description: 'Search for files by pattern in the project using grep. Use this to find specific files or content across multiple files. Best for: finding where a function is defined, finding all usages of a variable, searching for specific patterns.',
  parameters: {
    pattern: patternParam,
    path: searchPathParam
  },
  required: ['pattern'],
  execute: async (args, context): Promise<ToolExecutionResult> => {
    try {
      // Support both 'pattern' and 'query' as parameter names for compatibility
      const pattern = (args.pattern as string) || (args.query as string)
      
      if (!pattern) {
        return createErrorResult('Missing required parameter: pattern (or query)')
      }
      
      const searchPath = args.path as string | undefined
      const targetPath = searchPath ? path.resolve(context.cwd, searchPath) : context.cwd

      if (!fs.existsSync(targetPath)) {
        return createErrorResult(`Path does not exist: ${searchPath || '.'}`)
      }

      // Escape special shell characters and use single quotes for the pattern
      // This handles quotes, backslashes, and other special regex characters
      const escapedPattern = pattern.replace(/'/g, "'\"'\"'").replace(/\\/g, '\\\\')
      
      const { stdout, stderr } = await execPromise(
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

      return createSuccessResult(files.join('\n'), { matchCount: files.length })
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

// ============ 注册所有工具 ============

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

  log.info(`[ToolDefinitions] Registered ${toolRegistry.count()} tools`)
}

// ============ 导出 ============

// 导出类型
export type { ToolDefinition, ToolCall, ToolResult, ToolParameter, ToolExecutor, ExecutionContext, ToolExecutionResult }

// 导出工具定义数组（OpenAI 格式）
export const CODE_TOOLS: ToolDefinition[] = toolRegistry.toOpenAIDefinitions()

// 导出便捷函数（toolRegistry 已在上面定义）

// 工具名称映射（支持大驼峰命名向后兼容）
const TOOL_NAME_MAP: Record<string, string> = {
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
function normalizeToolName(name: string): string {
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
