/**
 * 工具执行器
 * 提供统一的工具执行接口，支持中间件、验证和错误处理
 */

import log from 'electron-log'
import {
  ToolExecutionResult,
  ToolCall,
  ToolResult,
  ExecutionContext,
  ToolExecutor,
  MiddlewareContext,
  ToolMiddleware,
  toolRegistry,
  executeToolWithMiddleware,
  createExecutionContext,
  validateToolArgs,
  toToolResult,
  parseToolCallsFromText,
  createSuccessResult,
  createErrorResult,
  ToolCallBuilder
} from './tools-core'

// 导出核心类型
export type {
  ToolExecutionResult,
  ToolCall,
  ToolResult,
  ExecutionContext,
  ToolExecutor,
  MiddlewareContext,
  ToolMiddleware
}

// 导出核心函数
export {
  toolRegistry,
  executeToolWithMiddleware,
  createExecutionContext,
  validateToolArgs,
  toToolResult,
  parseToolCallsFromText,
  createSuccessResult,
  createErrorResult,
  ToolCallBuilder
}

// ============ 工具执行服务 ============

export interface ToolExecutionOptions {
  cwd: string
  sessionId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

/**
 * 执行单个工具
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  options: ToolExecutionOptions
): Promise<ToolExecutionResult> {
  const context = createExecutionContext(options.cwd, {
    sessionId: options.sessionId,
    userId: options.userId,
    metadata: options.metadata
  })

  return executeToolWithMiddleware(name, args, context)
}

/**
 * 批量执行工具调用
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  options: ToolExecutionOptions
): Promise<ToolResult[]> {
  const context = createExecutionContext(options.cwd, {
    sessionId: options.sessionId,
    userId: options.userId,
    metadata: options.metadata
  })

  const results: ToolResult[] = []

  for (const toolCall of toolCalls) {
    try {
      // 解析参数
      let args: Record<string, unknown>
      if (typeof toolCall.function.arguments === 'string') {
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch (e) {
          results.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: toolCall.function.name,
            content: `Error: Failed to parse tool arguments: ${String(e)}`
          })
          continue
        }
      } else {
        args = toolCall.function.arguments
      }

      // 执行工具
      const result = await executeToolWithMiddleware(toolCall.function.name, args, context)

      results.push(toToolResult(toolCall.id, toolCall.function.name, result))
    } catch (error) {
      results.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolCall.function.name,
        content: `Error executing tool: ${String(error)}`
      })
    }
  }

  return results
}

/**
 * 从文本解析并执行工具调用
 */
export async function executeToolCallsFromText(
  text: string,
  options: ToolExecutionOptions
): Promise<{ results: ToolResult[]; toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> }> {
  const parsedCalls = parseToolCallsFromText(text)

  if (parsedCalls.length === 0) {
    return { results: [], toolCalls: [] }
  }

  // 转换为 ToolCall 格式
  const toolCalls: ToolCall[] = parsedCalls.map((call, index) => ({
    id: `call_${index + 1}_${Date.now()}`,
    type: 'function',
    function: {
      name: call.tool,
      arguments: call.arguments
    }
  }))

  const results = await executeToolCalls(toolCalls, options)

  return { results, toolCalls: parsedCalls }
}

// ============ 中间件 ============

/**
 * 日志中间件
 */
export const loggingMiddleware: ToolMiddleware = async (context, next) => {
  const startTime = Date.now()
  log.info(`[ToolExecution] Starting ${context.toolName}`, {
    args: context.args,
    cwd: context.executionContext.cwd,
    requestId: context.executionContext.requestId
  })

  try {
    const result = await next()
    const duration = Date.now() - startTime

    log.info(`[ToolExecution] Completed ${context.toolName}`, {
      success: result.success,
      duration,
      requestId: context.executionContext.requestId
    })

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    log.error(`[ToolExecution] Failed ${context.toolName}`, {
      error: String(error),
      duration,
      requestId: context.executionContext.requestId
    })
    throw error
  }
}

/**
 * 验证中间件
 */
export const validationMiddleware: ToolMiddleware = async (context, next) => {
  const tool = toolRegistry.get(context.toolName)

  if (!tool) {
    return createErrorResult(`Unknown tool: ${context.toolName}`)
  }

  // 验证参数
  const validation = validateToolArgs(context.toolName, context.args, tool)
  if (!validation.valid) {
    return createErrorResult(`Validation failed: ${validation.errors.join(', ')}`)
  }

  return next()
}

/**
 * 错误处理中间件
 */
export const errorHandlingMiddleware: ToolMiddleware = async (context, next) => {
  try {
    return await next()
  } catch (error) {
    log.error(`[ToolExecution] Unhandled error in ${context.toolName}:`, error)
    return createErrorResult(`Unexpected error: ${String(error)}`)
  }
}

/**
 * 结果格式化中间件
 */
export const formattingMiddleware: ToolMiddleware = async (context, next) => {
  const result = await next()

  // 如果输出太长，进行截断
  const MAX_OUTPUT_LENGTH = 100000
  if (result.output && result.output.length > MAX_OUTPUT_LENGTH) {
    return {
      ...result,
      output: result.output.substring(0, MAX_OUTPUT_LENGTH) + '\n\n[Output truncated due to length]'
    }
  }

  return result
}

// ============ 初始化 ============

/**
 * 初始化工具执行器
 */
export function initializeToolExecutor(): void {
  // 注册默认中间件
  toolRegistry.use(errorHandlingMiddleware)
  toolRegistry.use(validationMiddleware)
  toolRegistry.use(loggingMiddleware)
  toolRegistry.use(formattingMiddleware)

  log.info('[ToolExecutor] Initialized with default middlewares')
}

/**
 * 重置工具执行器
 */
export function resetToolExecutor(): void {
  toolRegistry.clear()
  initializeToolExecutor()
}

// 自动初始化
initializeToolExecutor()
