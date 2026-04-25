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
    const child = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
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
