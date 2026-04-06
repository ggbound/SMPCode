// Tool executor for LLM function calling
import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'
import { getCurrentWorkingDirectory } from './command-executor'
import { processBridge } from './process-terminal-bridge'

const execPromise = promisify(exec)

// Track recently executed commands to prevent duplicates
const recentCommands = new Map<string, number>()
const COMMAND_DEDUP_WINDOW = 5000 // 5 seconds

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: string
}

// Execute read_file tool
export async function executeReadFile(filePath: string): Promise<ToolExecutionResult> {
  try {
    const targetPath = path.resolve(getCurrentWorkingDirectory(), filePath)
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `File does not exist: ${filePath}` }
    }
    
    const stats = fs.statSync(targetPath)
    if (stats.isDirectory()) {
      return { success: false, output: '', error: `Path is a directory: ${filePath}` }
    }
    
    const content = fs.readFileSync(targetPath, 'utf-8')
    return { success: true, output: content }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute write_file tool
export async function executeWriteFile(filePath: string, content: string): Promise<ToolExecutionResult> {
  try {
    const targetPath = path.resolve(getCurrentWorkingDirectory(), filePath)
    
    // Ensure parent directory exists
    const parentDir = path.dirname(targetPath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    
    fs.writeFileSync(targetPath, content, 'utf-8')
    return { success: true, output: `File written successfully: ${targetPath}` }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute edit_file tool
export async function executeEditFile(
  filePath: string, 
  oldString: string, 
  newString: string
): Promise<ToolExecutionResult> {
  try {
    const targetPath = path.resolve(getCurrentWorkingDirectory(), filePath)
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `File does not exist: ${filePath}` }
    }
    
    let content = fs.readFileSync(targetPath, 'utf-8')
    
    if (!content.includes(oldString)) {
      return { 
        success: false, 
        output: '', 
        error: `Could not find the exact text to replace in ${filePath}. The text must match exactly including whitespace.` 
      }
    }
    
    content = content.replace(oldString, newString)
    fs.writeFileSync(targetPath, content, 'utf-8')
    return { success: true, output: `File edited successfully: ${targetPath}` }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute list_directory tool
export async function executeListDirectory(dirPath: string): Promise<ToolExecutionResult> {
  try {
    const targetPath = path.resolve(getCurrentWorkingDirectory(), dirPath)
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Directory does not exist: ${dirPath}` }
    }
    
    const stats = fs.statSync(targetPath)
    if (!stats.isDirectory()) {
      return { success: false, output: '', error: `Path is not a directory: ${dirPath}` }
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
    
    return { success: true, output: output || '(empty directory)' }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute delete_file tool
export async function executeDeleteFile(filePath: string): Promise<ToolExecutionResult> {
  try {
    const targetPath = path.resolve(getCurrentWorkingDirectory(), filePath)
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Path does not exist: ${filePath}` }
    }
    
    const stats = fs.statSync(targetPath)
    if (stats.isDirectory()) {
      fs.rmdirSync(targetPath, { recursive: true })
      return { success: true, output: `Removed directory: ${targetPath}` }
    } else {
      fs.unlinkSync(targetPath)
      return { success: true, output: `Removed file: ${targetPath}` }
    }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Extract working directory from command if it starts with "cd"
function extractCwdFromCommand(command: string, defaultCwd: string): string {
  // Match patterns like "cd /path && command" or "cd /path; command"
  const cdMatch = command.match(/^cd\s+(\S+)\s*(&&|;|\n)/)
  if (cdMatch) {
    const extractedPath = cdMatch[1]
    // Resolve relative to default cwd if needed
    if (extractedPath.startsWith('/')) {
      return extractedPath
    }
    return path.resolve(defaultCwd, extractedPath)
  }
  return defaultCwd
}

// Execute execute_bash tool
export async function executeExecuteBash(command: string): Promise<ToolExecutionResult> {
  const baseCwd = getCurrentWorkingDirectory()
  // Extract actual working directory from command (e.g., "cd /path && npm run dev")
  const cwd = extractCwdFromCommand(command, baseCwd)
  const commandKey = `${cwd}:${command}`
  const now = Date.now()
  
  // Check for duplicate command within dedup window
  // But only skip if there's actually a running process for this command type
  const lastExecution = recentCommands.get(commandKey)
  if (lastExecution && (now - lastExecution) < COMMAND_DEDUP_WINDOW) {
    // Check if there's actually a running process for this command
    const commandTypeKey = processBridge.getCommandTypeKey(command, cwd)
    const runningProcesses = processBridge.getAllProcesses().filter(p => 
      p.isRunning && p.terminalId === `terminal-${commandTypeKey}`
    )
    
    if (runningProcesses.length > 0) {
      log.warn(`Duplicate command detected and process is running, skipping: ${command}`)
      return {
        success: true,
        output: `Command is already running (duplicate detected). Process ID: ${runningProcesses[0].id}`,
      }
    } else {
      // Process not actually running, allow re-execution
      log.info(`Command was recently executed but process not running, allowing re-execution: ${command}`)
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

  // Check if command should run in terminal (long-running processes)
  const shouldRunInTerminal = processBridge.shouldRunInTerminal(command)

  if (shouldRunInTerminal) {
    // Start process in terminal - it will run asynchronously
    const result = await processBridge.startProcess(command, cwd)
    if (result.success) {
      return {
        success: true,
        output: `Started process in terminal (PID: ${result.processId}). Command: ${command}`,
      }
    } else {
      return {
        success: false,
        output: '',
        error: `Failed to start process in terminal: ${result.error}`
      }
    }
  }

  // For short commands, execute directly and return output
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    })

    return {
      success: true,
      output: stdout || '(no output)',
      error: stderr || undefined
    }
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message || String(error)
    }
  }
}

// Execute search_code tool
export async function executeSearchCode(pattern: string, searchPath?: string): Promise<ToolExecutionResult> {
  try {
    const targetPath = searchPath 
      ? path.resolve(getCurrentWorkingDirectory(), searchPath)
      : getCurrentWorkingDirectory()
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Path does not exist: ${searchPath || '.'}` }
    }
    
    // Use grep to search for the pattern
    const { stdout, stderr } = await execPromise(
      `grep -r "${pattern.replace(/"/g, '\\"')}" "${targetPath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.java" --include="*.go" --include="*.rs" -l 2>/dev/null || true`,
      { timeout: 30000 }
    )
    
    if (stderr && !stdout) {
      return { success: false, output: '', error: stderr }
    }
    
    const files = stdout.trim().split('\n').filter(f => f)
    if (files.length === 0) {
      return { success: true, output: 'No matches found' }
    }
    
    return { success: true, output: files.join('\n') }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute get_running_processes tool
export async function executeGetRunningProcesses(): Promise<ToolExecutionResult> {
  try {
    const processes = processBridge.getAllProcesses()
    const runningProcesses = processes.filter(p => p.isRunning)
    
    if (runningProcesses.length === 0) {
      return { success: true, output: 'No running processes found' }
    }
    
    const output = runningProcesses.map(p => {
      const startTime = new Date(p.startTime).toLocaleString()
      return `Process ID: ${p.id}\nCommand: ${p.command}\nWorking Directory: ${p.cwd}\nStarted: ${startTime}\nTerminal ID: ${p.terminalId || 'N/A'}\n---`
    }).join('\n')
    
    return { success: true, output }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute stop_process tool
export async function executeStopProcess(processId: string): Promise<ToolExecutionResult> {
  try {
    if (!processId) {
      return { success: false, output: '', error: 'Process ID is required' }
    }
    
    const result = await processBridge.stopProcess(processId)
    
    if (result.success) {
      // Check if we actually stopped the process or if it was already stopped
      if (result.actuallyStopped) {
        return { success: true, output: `Process ${processId} stopped successfully` }
      } else {
        return { 
          success: true, 
          output: `Stop signal sent to process ${processId}, but could not verify if process actually stopped. Please check the terminal to confirm.` 
        }
      }
    } else {
      return { success: false, output: '', error: result.error || 'Failed to stop process' }
    }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Execute restart_process tool
export async function executeRestartProcess(processId: string): Promise<ToolExecutionResult> {
  try {
    if (!processId) {
      return { success: false, output: '', error: 'Process ID is required' }
    }
    
    const result = await processBridge.restartProcess(processId)
    
    if (result.success) {
      return { success: true, output: `Process ${processId} restarted successfully. New process ID: ${result.processId}` }
    } else {
      return { success: false, output: '', error: result.error || 'Failed to restart process' }
    }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

// Main tool executor
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  log.info(`Executing tool: ${name} with args:`, args)
  
  switch (name) {
    case 'read_file':
      return executeReadFile(args.path as string)
    case 'write_file':
      return executeWriteFile(args.path as string, args.content as string)
    case 'edit_file':
      return executeEditFile(args.path as string, args.old_string as string, args.new_string as string)
    case 'delete_file':
      return executeDeleteFile(args.path as string)
    case 'list_directory':
      return executeListDirectory(args.path as string)
    case 'execute_bash':
      return executeExecuteBash(args.command as string)
    case 'search_code':
      return executeSearchCode(args.pattern as string, args.path as string | undefined)
    case 'get_running_processes':
      return executeGetRunningProcesses()
    case 'stop_process':
      return executeStopProcess(args.process_id as string)
    case 'restart_process':
      return executeRestartProcess(args.process_id as string)
    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` }
  }
}
