/**
 * 工具实现 - 后端主进程
 * 参考 claw-code 架构：每个工具独立实现，统一返回格式
 */

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'
import log from 'electron-log'
import type { ToolExecutionResult } from '../../../src/shared/types/tool-call'
import { getAllReminders } from './reminder-service'

const execAsync = promisify(exec)

// ============ 文件操作工具 ============

export async function executeReadFile(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const filePath = args.path as string
  const offset = args.offset as number | undefined
  const limit = args.limit as number | undefined

  if (!filePath) {
    return { success: false, output: '', error: 'Path is required' }
  }

  try {
    const fullPath = resolve(cwd, filePath)
    let content = await readFile(fullPath, 'utf-8')

    // 处理 offset 和 limit
    const lines = content.split('\n')
    const startLine = offset || 0
    const endLine = limit ? startLine + limit : lines.length
    content = lines.slice(startLine, endLine).join('\n')

    return {
      success: true,
      output: content,
      metadata: { path: fullPath, lines: lines.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function executeWriteFile(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const filePath = args.path as string
  const content = args.content as string

  if (!filePath) {
    return { success: false, output: '', error: 'Path is required' }
  }

  if (content === undefined) {
    return { success: false, output: '', error: 'Content is required' }
  }

  try {
    const fullPath = resolve(cwd, filePath)
    const dir = dirname(fullPath)

    // 确保目录存在
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await writeFile(fullPath, content, 'utf-8')

    return {
      success: true,
      output: `File written successfully: ${filePath}`,
      metadata: { path: fullPath, size: content.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function executeEditFile(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const filePath = args.path as string
  const oldString = args.old_string as string
  const newString = args.new_string as string

  if (!filePath || oldString === undefined || newString === undefined) {
    return { success: false, output: '', error: 'Path, old_string, and new_string are required' }
  }

  try {
    const fullPath = resolve(cwd, filePath)
    const content = await readFile(fullPath, 'utf-8')

    if (!content.includes(oldString)) {
      return { success: false, output: '', error: 'Old string not found in file' }
    }

    const newContent = content.replace(oldString, newString)
    await writeFile(fullPath, newContent, 'utf-8')

    return {
      success: true,
      output: `File edited successfully: ${filePath}`,
      metadata: { path: fullPath }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function executeDeleteFile(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const filePath = args.path as string

  if (!filePath) {
    return { success: false, output: '', error: 'Path is required' }
  }

  try {
    const fullPath = resolve(cwd, filePath)
    await rm(fullPath, { recursive: true, force: true })

    return {
      success: true,
      output: `File deleted successfully: ${filePath}`,
      metadata: { path: fullPath }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============ 目录操作工具 ============

export async function executeListDirectory(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const dirPath = (args.path as string) || '.'

  try {
    const fullPath = resolve(cwd, dirPath)
    const entries = await readdir(fullPath, { withFileTypes: true })

    const result = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory()
    }))

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      metadata: { path: fullPath, count: result.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============ Bash 执行工具 ============

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
      if (shell && existsSync(shell)) {
        return shell
      }
    }
    return 'cmd.exe'
  }
  // macOS/Linux
  return process.env.SHELL || '/bin/zsh'
}

export async function executeBash(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const command = args.command as string
  const timeout = (args.timeout as number) || 120000

  if (!command) {
    return { success: false, output: '', error: 'Command is required' }
  }

  return new Promise((resolve) => {
    // 使用用户的 shell 并继承环境变量
    const userShell = getPlatformShell()
    const child = spawn(command, [], {
      cwd,
      shell: userShell,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' }
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout

    // 设置超时
    timeoutId = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        success: false,
        output: stdout,
        error: `Command timed out after ${timeout}ms`
      })
    }, timeout)

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeoutId)
      const success = code === 0
      resolve({
        success,
        output: stdout,
        error: stderr || undefined,
        metadata: { exitCode: code }
      })
    })

    child.on('error', (error) => {
      clearTimeout(timeoutId)
      resolve({
        success: false,
        output: stdout,
        error: error.message
      })
    })
  })
}

// ============ 搜索工具 ============

export async function executeSearchFiles(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const pattern = (args.pattern as string) || (args.query as string)
  const path = (args.path as string) || '.'

  if (!pattern) {
    return { success: false, output: '', error: 'Pattern is required' }
  }

  try {
    // 使用 grep 进行搜索
    const { stdout } = await execAsync(
      `grep -r -n "${pattern.replace(/"/g, '\\"')}" "${path}" 2>/dev/null || true`,
      { cwd, timeout: 30000 }
    )

    const lines = stdout.trim().split('\n').filter(Boolean)
    const results = lines.map(line => {
      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (match) {
        return { file: match[1], line: parseInt(match[2], 10), content: match[3] }
      }
      return { file: line, line: 0, content: '' }
    })

    return {
      success: true,
      output: JSON.stringify(results.slice(0, 50), null, 2),
      metadata: { count: results.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============ 端口和进程管理工具 ============

export async function executeCheckPort(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const port = args.port as number

  if (!port || typeof port !== 'number') {
    return { success: false, output: '', error: 'Port number is required' }
  }

  try {
    // 使用 lsof 检查端口
    const { stdout, stderr } = await execAsync(
      `lsof -i :${port} -P -n | grep LISTEN || true`,
      { cwd, timeout: 10000 }
    )

    const lines = stdout.trim().split('\n').filter(Boolean)

    if (lines.length === 0) {
      return {
        success: true,
        output: JSON.stringify({
          port,
          occupied: false,
          message: `Port ${port} is available`
        }, null, 2),
        metadata: { port, occupied: false }
      }
    }

    // 解析进程信息
    const processes = lines.map(line => {
      const parts = line.trim().split(/\s+/)
      return {
        command: parts[0],
        pid: parseInt(parts[1], 10),
        user: parts[2],
        fd: parts[3],
        type: parts[4],
        device: parts[5],
        size: parts[6],
        node: parts[7],
        name: parts[8]
      }
    })

    return {
      success: true,
      output: JSON.stringify({
        port,
        occupied: true,
        processes,
        message: `Port ${port} is occupied by ${processes.length} process(es)`
      }, null, 2),
      metadata: { port, occupied: true, processCount: processes.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function executeKillProcess(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const pid = args.pid as number
  const signal = (args.signal as string) || 'SIGTERM'

  if (!pid || typeof pid !== 'number') {
    return { success: false, output: '', error: 'PID is required' }
  }

  try {
    process.kill(pid, signal as NodeJS.Signals)

    return {
      success: true,
      output: `Process ${pid} killed successfully with signal ${signal}`,
      metadata: { pid, signal }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function executeFindProcess(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  const name = args.name as string
  const port = args.port as number

  if (!name && !port) {
    return { success: false, output: '', error: 'Name or port is required' }
  }

  try {
    let command: string

    if (port) {
      // 通过端口查找进程
      command = `lsof -i :${port} -P -n -t || true`
    } else {
      // 通过名称查找进程
      command = `pgrep -f "${name.replace(/"/g, '\\"')}" || true`
    }

    const { stdout } = await execAsync(command, { cwd, timeout: 10000 })
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number)

    if (pids.length === 0) {
      return {
        success: true,
        output: JSON.stringify({
          found: false,
          message: name ? `No process found with name: ${name}` : `No process found using port: ${port}`
        }, null, 2),
        metadata: { found: false }
      }
    }

    // 获取进程详细信息
    const processes = await Promise.all(
      pids.map(async (pid) => {
        try {
          const { stdout: psOutput } = await execAsync(
            `ps -p ${pid} -o pid,ppid,comm,args | tail -n 1`,
            { cwd, timeout: 5000 }
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

    return {
      success: true,
      output: JSON.stringify({
        found: true,
        processes,
        message: `Found ${processes.length} process(es)`
      }, null, 2),
      metadata: { found: true, count: processes.length }
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============ 定时任务工具 ============

export async function executeListReminders(
  _args: Record<string, unknown>,
  _cwd: string
): Promise<ToolExecutionResult> {
  try {
    const reminders = getAllReminders()
    
    if (reminders.length === 0) {
      return {
        success: true,
        output: JSON.stringify({
          message: '暂无定时提醒',
          count: 0,
          reminders: []
        }, null, 2)
      }
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

    return {
      success: true,
      output: JSON.stringify({
        message: `找到 ${reminders.length} 个定时提醒`,
        count: reminders.length,
        reminders: reminderList
      }, null, 2)
    }
  } catch (error) {
    log.error(`[executeListReminders] Error:`, error)
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
