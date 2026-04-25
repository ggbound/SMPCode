/**
 * Tools Core - Simplified version
 * Provides type definitions and utility functions for tool execution
 * 
 * Note: This module does NOT export toolRegistry.
 * - For CLI tool registry, import from './cli/tool-registry'
 * - For service tool registry, import from './tools-definitions'
 * - For executor tool registry, use getToolRegistry() from './tool-executor'
 */

import log from 'electron-log'

// ============ 核心类型定义 ============

export interface ToolParameter {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  default?: unknown
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, ToolParameter>
      required: string[]
    }
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string | Record<string, unknown>
  }
}

export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: string
  metadata?: {
    executionTime?: number
    toolName?: string
    timestamp?: string
    [key: string]: unknown
  }
}

export interface ToolResult {
  tool_call_id: string
  role: 'tool'
  name: string
  content: string
}

export interface ExecutionContext {
  cwd: string
  sessionId?: string
  userId?: string
  requestId: string
  startTime: number
  metadata?: Record<string, unknown>
}

export interface ToolExecutor {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  required: string[]
  execute: (args: Record<string, unknown>, context: ExecutionContext) => Promise<ToolExecutionResult>
}

// ============ 参数验证 ============

export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  executor: ToolExecutor
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // 检查必需参数
  for (const required of executor.required) {
    if (!(required in args) || args[required] === undefined || args[required] === null) {
      errors.push(`Missing required parameter: ${required}`)
    }
  }

  // 验证参数类型
  for (const [key, value] of Object.entries(args)) {
    const paramDef = executor.parameters[key]
    if (!paramDef) {
      errors.push(`Unknown parameter: ${key}`)
      continue
    }

    // 类型检查
    if (paramDef.type === 'string' && typeof value !== 'string') {
      errors.push(`Parameter ${key} must be a string`)
    } else if (paramDef.type === 'number' && typeof value !== 'number') {
      errors.push(`Parameter ${key} must be a number`)
    } else if (paramDef.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Parameter ${key} must be a boolean`)
    } else if (paramDef.type === 'array' && !Array.isArray(value)) {
      errors.push(`Parameter ${key} must be an array`)
    } else if (paramDef.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push(`Parameter ${key} must be an object`)
    }

    // 枚举检查
    if (paramDef.enum && !paramDef.enum.includes(String(value))) {
      errors.push(`Parameter ${key} must be one of: ${paramDef.enum.join(', ')}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============ 结果格式化 ============

export function formatToolResult(result: ToolExecutionResult): string {
  if (result.success) {
    return result.output
  }
  return `Error: ${result.error || 'Unknown error'}`
}

export function toToolResult(toolCallId: string, toolName: string, result: ToolExecutionResult): ToolResult {
  return {
    tool_call_id: toolCallId,
    role: 'tool',
    name: toolName,
    content: formatToolResult(result)
  }
}

// ============ 工具调用解析 ============

export function parseToolCallsFromText(text: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = []

  // 方法 1: JSON 代码块
  const codeBlockCalls = parseCodeBlocks(text)
  toolCalls.push(...codeBlockCalls)

  // 方法 2: 内联 JSON
  const inlineCalls = parseInlineJSON(text)
  toolCalls.push(...inlineCalls)

  // 去重
  const seen = new Set<string>()
  return toolCalls.filter(tc => {
    const key = `${tc.tool}:${JSON.stringify(tc.arguments)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseCodeBlocks(text: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = []
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g

  let match
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const blockContent = match[1].trim()

    // 尝试解析整个块
    try {
      const parsed = JSON.parse(blockContent)
      if (isValidToolCall(parsed)) {
        calls.push({ tool: parsed.tool, arguments: parsed.arguments })
        continue
      }
    } catch (e) {
      // 不是单个 JSON，尝试按行解析
    }

    // 按行解析
    const lines = blockContent.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (isValidToolCall(parsed)) {
          calls.push({ tool: parsed.tool, arguments: parsed.arguments })
        }
      } catch (e) {
        // 尝试提取 JSON 对象
        const jsonMatch = extractJSONObject(trimmed)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch)
            if (isValidToolCall(parsed)) {
              calls.push({ tool: parsed.tool, arguments: parsed.arguments })
            }
          } catch (e2) {
            // Ignore
          }
        }
      }
    }
  }

  return calls
}

function parseInlineJSON(text: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = []
  const jsonObjectRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g

  let match
  while ((match = jsonObjectRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0])
      if (isValidToolCall(parsed)) {
        calls.push({ tool: parsed.tool, arguments: parsed.arguments })
      }
    } catch (e) {
      // Ignore
    }
  }

  return calls
}

function isValidToolCall(obj: unknown): obj is { tool: string; arguments: Record<string, unknown> } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tool' in obj &&
    typeof (obj as Record<string, unknown>).tool === 'string' &&
    'arguments' in obj &&
    typeof (obj as Record<string, unknown>).arguments === 'object' &&
    (obj as Record<string, unknown>).arguments !== null
  )
}

function extractJSONObject(text: string): string | null {
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) return null

  let braceCount = 0
  let inString = false
  let escapeNext = false

  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') braceCount++
      else if (char === '}') {
        braceCount--
        if (braceCount === 0) {
          return text.substring(jsonStart, i + 1)
        }
      }
    }
  }

  return null
}

// ============ 便捷函数 ============

export function createExecutionContext(
  cwd: string,
  options?: { sessionId?: string; userId?: string; metadata?: Record<string, unknown> }
): ExecutionContext {
  return {
    cwd,
    sessionId: options?.sessionId,
    userId: options?.userId,
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    startTime: Date.now(),
    metadata: options?.metadata
  }
}

export function createSuccessResult(output: string, metadata?: Record<string, unknown>): ToolExecutionResult {
  return {
    success: true,
    output,
    metadata
  }
}

export function createErrorResult(error: string, output = '', metadata?: Record<string, unknown>): ToolExecutionResult {
  return {
    success: false,
    output,
    error,
    metadata
  }
}

// ============ 中间件支持 ============

export interface ToolMiddleware {
  name: string
  execute: (
    toolName: string,
    args: Record<string, unknown>,
    context: ExecutionContext,
    next: () => Promise<ToolExecutionResult>
  ) => Promise<ToolExecutionResult>
}

const middlewares: ToolMiddleware[] = []

/**
 * 注册中间件
 */
export function useMiddleware(middleware: ToolMiddleware): void {
  middlewares.push(middleware)
  log.info(`[ToolsCore] Registered middleware: ${middleware.name}`)
}

/**
 * 执行带中间件的工具调用
 */
export async function executeToolWithMiddleware(
  toolName: string,
  args: Record<string, unknown>,
  context: ExecutionContext,
  executor: (args: Record<string, unknown>, context: ExecutionContext) => Promise<ToolExecutionResult>
): Promise<ToolExecutionResult> {
  if (middlewares.length === 0) {
    return executor(args, context)
  }

  // 构建中间件链
  let index = -1

  const dispatch = async (): Promise<ToolExecutionResult> => {
    index++
    if (index >= middlewares.length) {
      return executor(args, context)
    }

    const middleware = middlewares[index]
    try {
      return await middleware.execute(toolName, args, context, dispatch)
    } catch (error) {
      log.error(`[ToolsCore] Middleware ${middleware.name} failed:`, error)
      return createErrorResult(`Middleware ${middleware.name} failed: ${String(error)}`)
    }
  }

  return dispatch()
}
