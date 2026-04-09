import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'

const execPromise = promisify(exec)

// Detect platform
const platform = process.platform
const isWindows = platform === 'win32'
const isMacOS = platform === 'darwin'
const isLinux = platform === 'linux'

// Get shell command based on platform
function getShellCommand(): string {
  if (isWindows) return 'cmd.exe'
  if (isMacOS) return '/bin/zsh'
  return '/bin/bash'
}

// Get shell args based on platform
function getShellArgs(command: string): string[] {
  if (isWindows) return ['/c', command]
  return ['-c', command]
}

// Current working directory tracking
let currentWorkingDirectory: string = process.cwd()

export function setCurrentWorkingDirectory(dir: string): void {
  currentWorkingDirectory = dir
}

export function getCurrentWorkingDirectory(): string {
  return currentWorkingDirectory
}

export interface CommandResult {
  success: boolean
  output: string
  error?: string
}

// Parse command arguments
function parseArgs(prompt: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes = false
  let quoteChar = ''

  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i]

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true
      quoteChar = char
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false
      quoteChar = ''
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    args.push(current)
  }

  return args
}

// Command implementations
export async function executeAddDir(args: string[]): Promise<CommandResult> {
  try {
    const dirName = args[0]
    if (!dirName) {
      return { success: false, output: '', error: 'Directory name is required' }
    }

    const targetPath = path.resolve(currentWorkingDirectory, dirName)

    if (fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Directory already exists: ${dirName}` }
    }

    fs.mkdirSync(targetPath, { recursive: true })
    return { success: true, output: `Created directory: ${targetPath}` }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executeClear(): Promise<CommandResult> {
  // Clear screen - just return success, UI will handle this
  return { success: true, output: 'Screen cleared' }
}

export async function executeLs(args: string[]): Promise<CommandResult> {
  try {
    const targetPath = args[0] ? path.resolve(currentWorkingDirectory, args[0]) : currentWorkingDirectory

    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Path does not exist: ${args[0] || '.'}` }
    }

    const stats = fs.statSync(targetPath)
    if (!stats.isDirectory()) {
      return { success: false, output: '', error: `Not a directory: ${args[0] || '.'}` }
    }

    const items = fs.readdirSync(targetPath)
    const output = items
      .filter(item => !item.startsWith('.') && item !== 'node_modules')
      .map(item => {
        const itemPath = path.join(targetPath, item)
        const itemStats = fs.statSync(itemPath)
        const type = itemStats.isDirectory() ? 'd' : '-'
        const size = itemStats.isFile() ? ` ${formatBytes(itemStats.size)}` : ''
        return `${type} ${item}${size}`
      }).join('\n')

    return { success: true, output: output || '(empty directory)' }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executePwd(): Promise<CommandResult> {
  return { success: true, output: currentWorkingDirectory }
}

export async function executeCd(args: string[]): Promise<CommandResult> {
  try {
    const dirName = args[0]
    if (!dirName) {
      return { success: false, output: '', error: 'Directory path is required' }
    }

    const targetPath = path.resolve(currentWorkingDirectory, dirName)

    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Directory does not exist: ${dirName}` }
    }

    const stats = fs.statSync(targetPath)
    if (!stats.isDirectory()) {
      return { success: false, output: '', error: `Not a directory: ${dirName}` }
    }

    currentWorkingDirectory = targetPath
    return { success: true, output: `Changed directory to: ${targetPath}` }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executeCat(args: string[]): Promise<CommandResult> {
  try {
    const filePath = args[0]
    if (!filePath) {
      return { success: false, output: '', error: 'File path is required' }
    }

    const targetPath = path.resolve(currentWorkingDirectory, filePath)

    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `File does not exist: ${filePath}` }
    }

    const stats = fs.statSync(targetPath)
    if (stats.isDirectory()) {
      return { success: false, output: '', error: `Is a directory: ${filePath}` }
    }

    const content = fs.readFileSync(targetPath, 'utf-8')
    return { success: true, output: content }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executeRm(args: string[]): Promise<CommandResult> {
  try {
    const target = args[0]
    if (!target) {
      return { success: false, output: '', error: 'Path is required' }
    }

    const targetPath = path.resolve(currentWorkingDirectory, target)

    if (!fs.existsSync(targetPath)) {
      return { success: false, output: '', error: `Path does not exist: ${target}` }
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

export async function executeTouch(args: string[]): Promise<CommandResult> {
  try {
    const fileName = args[0]
    if (!fileName) {
      return { success: false, output: '', error: 'File name is required' }
    }

    const targetPath = path.resolve(currentWorkingDirectory, fileName)

    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, '', 'utf-8')
      return { success: true, output: `Created file: ${targetPath}` }
    } else {
      // Update timestamp
      const now = new Date()
      fs.utimesSync(targetPath, now, now)
      return { success: true, output: `Updated timestamp: ${targetPath}` }
    }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executeBash(args: string[]): Promise<CommandResult> {
  try {
    const command = args.join(' ')
    if (!command) {
      return { success: false, output: '', error: 'Command is required' }
    }

    // Use platform-specific shell
    const shell = getShellCommand()
    const shellArgs = getShellArgs(command)

    log.info(`Executing on ${platform}: ${shell} ${shellArgs.join(' ')}`)

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

    log.info(`[executeBash] PATH: ${env.PATH}`)

    const { stdout, stderr } = await execPromise(`${shell} ${shellArgs.map(a => `"${a}"`).join(' ')}`, {
      cwd: currentWorkingDirectory,
      timeout: 60000,
      env
    })

    return {
      success: !stderr,
      output: stdout || '(no output)',
      error: stderr || undefined
    }
  } catch (error) {
    return { success: false, output: '', error: String(error) }
  }
}

export async function executeGit(args: string[]): Promise<CommandResult> {
  return executeBash(['git', ...args])
}

export async function executeNpm(args: string[]): Promise<CommandResult> {
  return executeBash(['npm', ...args])
}

// Mirrored commands that should be executed via bash
const MIRRORED_COMMANDS = [
  'agents', 'branch', 'btw', 'docker', 'build', 'test', 'deploy',
  'advisor', 'ant-trace', 'autofix-pr', 'backfill-sessions', 'break-cache',
  'bridge', 'bridge-kick', 'brief', 'bughunter', 'chrome', 'claw',
  'commit', 'config', 'context', 'cost', 'create-agent', 'create-skill',
  'dashboard', 'debug', 'diff', 'doctor', 'edit', 'explain', 'fetch',
  'fix', 'glob', 'grep', 'help', 'history', 'init', 'install', 'lint',
  'list', 'load', 'log', 'merge', 'migrate', 'mode', 'move', 'open',
  'optimize', 'patch', 'plan', 'plugin', 'port', 'preview', 'profile',
  'pr', 'push', 'query', 'read', 'refactor', 'release', 'remote',
  'rename', 'replace', 'report', 'review', 'run', 'save', 'search',
  'serve', 'session', 'set', 'setup', 'show', 'skill', 'start', 'status',
  'stop', 'sync', 'task', 'teleport', 'test', 'todo', 'tool', 'trace',
  'undo', 'update', 'upgrade', 'validate', 'verify', 'version', 'view',
  'watch', 'write'
]

// Check if a command is a mirrored command
function isMirroredCommand(name: string): boolean {
  return MIRRORED_COMMANDS.includes(name.toLowerCase())
}

// Main command executor
export async function executeCommand(commandName: string, prompt: string): Promise<CommandResult> {
  log.info(`Executing command: ${commandName}, prompt: ${prompt}`)

  // Parse arguments from prompt (remove the command name itself)
  const parts = parseArgs(prompt)
  const args = parts.slice(1) // Remove command name

  const lowerCommand = commandName.toLowerCase()

  switch (lowerCommand) {
    case 'add-dir':
      return executeAddDir(args)
    case 'clear':
    case 'cls':
      return executeClear()
    case 'ls':
    case 'dir':
      return executeLs(args)
    case 'pwd':
      return executePwd()
    case 'cd':
      return executeCd(args)
    case 'cat':
    case 'type':
      return executeCat(args)
    case 'rm':
    case 'del':
      return executeRm(args)
    case 'touch':
      return executeTouch(args)
    case 'bash':
    case 'sh':
    case 'cmd':
      return executeBash(args)
    case 'git':
      return executeGit(args)
    case 'npm':
      return executeNpm(args)
    default:
      // For mirrored commands, execute them as bash commands
      if (isMirroredCommand(commandName)) {
        log.info(`Executing mirrored command via bash: ${prompt}`)
        return executeBash(parts)
      }
      return {
        success: false,
        output: '',
        error: `Command "${commandName}" is not implemented yet. Available commands: add-dir, ls, pwd, cd, cat, rm, touch, clear, bash, git, npm, and mirrored commands (agents, branch, btw, etc.)`
      }
  }
}

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
