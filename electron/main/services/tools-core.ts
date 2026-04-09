/**
 * 工具调用核心架构
 * 提供统一的工具接口、执行上下文和结果类型定义
 */

import log from 'electron-log'

// ============ 核心类型定义 ============

/**
 * 工具参数定义
 */
export interface ToolParameter {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  default?: unknown
}

/**
 * 工具定义
 */
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

/**
 * 工具调用
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string | Record<string, unknown>
  }
}

/**
 * 工具执行结果
 */
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

/**
 * 工具结果（返回给 LLM 的格式）
 */
export interface ToolResult {
  tool_call_id: string
  role: 'tool'
  name: string
  content: string
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  cwd: string
  sessionId?: string
  userId?: string
  requestId: string
  startTime: number
  metadata?: Record<string, unknown>
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  required: string[]
  execute: (args: Record<string, unknown>, context: ExecutionContext) => Promise<ToolExecutionResult>
}

// ============ 工具注册表 ============

class ToolRegistry {
  private tools: Map<string, ToolExecutor> = new Map()
  private middlewares: ToolMiddleware[] = []

  /**
   * 注册工具
   */
  register(tool: ToolExecutor): void {
    this.tools.set(tool.name, tool)
    log.info(`[ToolRegistry] Registered tool: ${tool.name}`)
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    this.tools.delete(name)
    log.info(`[ToolRegistry] Unregistered tool: ${name}`)
  }

  /**
   * 获取工具
   */
  get(name: string): ToolExecutor | undefined {
    return this.tools.get(name)
  }

  /**
   * 获取所有工具
   */
  getAll(): ToolExecutor[] {
    return Array.from(this.tools.values())
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取工具数量
   */
  count(): number {
    return this.tools.size
  }

  /**
   * 转换为 OpenAI 格式的工具定义
   */
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

  /**
   * 添加中间件
   */
  use(middleware: ToolMiddleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * 获取中间件
   */
  getMiddlewares(): ToolMiddleware[] {
    return [...this.middlewares]
  }

  /**
   * 清空所有工具和中间件
   */
  clear(): void {
    this.tools.clear()
    this.middlewares = []
  }
}

// 全局工具注册表实例
export const toolRegistry = new ToolRegistry()

// ============ 中间件系统 ============

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  toolName: string
  args: Record<string, unknown>
  executionContext: ExecutionContext
  result?: ToolExecutionResult
}

/**
 * 工具中间件
 */
export type ToolMiddleware = (
  context: MiddlewareContext,
  next: () => Promise<ToolExecutionResult>
) => Promise<ToolExecutionResult>

/**
 * 执行工具（带中间件支持）
 */
export async function executeToolWithMiddleware(
  toolName: string,
  args: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolExecutionResult> {
  const tool = toolRegistry.get(toolName)

  if (!tool) {
    return {
      success: false,
      output: '',
      error: `Unknown tool: ${toolName}`,
      metadata: {
        toolName,
        timestamp: new Date().toISOString()
      }
    }
  }

  const middlewares = toolRegistry.getMiddlewares()
  const middlewareContext: MiddlewareContext = {
    toolName,
    args,
    executionContext: context
  }

  // 构建中间件链
  let index = 0
  const executeNext = async (): Promise<ToolExecutionResult> => {
    if (index < middlewares.length) {
      const middleware = middlewares[index++]
      return middleware(middlewareContext, executeNext)
    }
    // 执行实际工具
    const startTime = Date.now()
    const result = await tool.execute(args, context)
    const executionTime = Date.now() - startTime

    return {
      ...result,
      metadata: {
        ...result.metadata,
        executionTime,
        toolName,
        timestamp: new Date().toISOString()
      }
    }
  }

  return executeNext()
}

// ============ 参数验证 ============

/**
 * 验证工具参数
 */
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

/**
 * 格式化工具结果为 LLM 可读的格式
 */
export function formatToolResult(result: ToolExecutionResult): string {
  if (result.success) {
    return result.output
  }
  return `Error: ${result.error || 'Unknown error'}`
}

/**
 * 将工具执行结果转换为 ToolResult 格式
 */
export function toToolResult(toolCallId: string, toolName: string, result: ToolExecutionResult): ToolResult {
  return {
    tool_call_id: toolCallId,
    role: 'tool',
    name: toolName,
    content: formatToolResult(result)
  }
}

// ============ 工具调用解析 ============

/**
 * 从文本中解析工具调用
 * 支持多种格式：
 * 1. 特殊格式：<|tool_calls_section_begin|>...<|tool_calls_section_end|>
 * 2. JSON 代码块：```json ... ```
 * 3. 内联 JSON：{"tool": "name", "arguments": {...}}
 */
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

/**
 * 解析 JSON 代码块
 */
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

/**
 * 解析内联 JSON
 */
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

/**
 * 检查是否为有效的工具调用
 */
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

/**
 * 提取 JSON 对象字符串（支持嵌套大括号）
 */
function extractJSONObject(text: string): string | null {
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) return null
  
  // 使用栈来找到匹配的闭括号
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

// ============ 工具调用构建器 ============

/**
 * 工具调用构建器
 */
export class ToolCallBuilder {
  private toolCalls: ToolCall[] = []
  private idCounter = 0

  /**
   * 添加工具调用
   */
  add(toolName: string, args: Record<string, unknown>): this {
    this.toolCalls.push({
      id: `call_${++this.idCounter}_${Date.now()}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(args)
      }
    })
    return this
  }

  /**
   * 构建工具调用数组
   */
  build(): ToolCall[] {
    return [...this.toolCalls]
  }

  /**
   * 清空
   */
  clear(): this {
    this.toolCalls = []
    this.idCounter = 0
    return this
  }
}

// ============ 导出便捷函数 ============

/**
 * 创建执行上下文
 */
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

/**
 * 创建工具执行结果
 */
export function createSuccessResult(output: string, metadata?: Record<string, unknown>): ToolExecutionResult {
  return {
    success: true,
    output,
    metadata
  }
}

/**
 * 创建工具执行错误结果
 */
export function createErrorResult(error: string, output = '', metadata?: Record<string, unknown>): ToolExecutionResult {
  return {
    success: false,
    output,
    error,
    metadata
  }
}
