/**
 * 标准化工具调用类型定义
 * 兼容 OpenAI/Anthropic Function Calling 标准
 */

// ============ 基础类型 ============

/**
 * JSON Schema 类型定义
 */
export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: (string | number)[]
  default?: unknown
  additionalProperties?: boolean
}

/**
 * 工具定义 - OpenAI 标准格式
 */
export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JSONSchema
  }
}

/**
 * 工具调用 - OpenAI 标准格式
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/**
 * 工具调用参数（已解析）
 */
export interface ParsedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
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

// ============ 执行上下文 ============

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

// ============ 执行状态 ============

/**
 * 工具调用状态
 */
export type ToolCallStatus = 
  | 'pending'      // 等待执行
  | 'validating'   // 验证参数
  | 'executing'    // 执行中
  | 'completed'    // 执行完成
  | 'failed'       // 执行失败
  | 'cancelled'    // 已取消
  | 'timeout'      // 执行超时

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: ToolExecutionResult
  startTime?: number
  endTime?: number
  executionTime?: number
  error?: string
}

/**
 * 工具调用链
 */
export interface ToolCallChain {
  id: string
  calls: ToolCallRecord[]
  startTime: number
  endTime?: number
  status: 'running' | 'completed' | 'failed'
}

// ============ 事件类型 ============

/**
 * 工具调用事件
 */
export interface ToolCallEvent {
  type: 'tool_call_start' | 'tool_call_end' | 'tool_call_error' | 'tool_call_progress'
  callId: string
  toolName: string
  timestamp: number
  data?: unknown
}

/**
 * 工具调用进度
 */
export interface ToolCallProgress {
  callId: string
  toolName: string
  status: ToolCallStatus
  progress?: number // 0-100
  message?: string
  timestamp: number
}

// ============ 配置选项 ============

/**
 * 工具执行选项
 */
export interface ToolExecutionOptions {
  cwd: string
  sessionId?: string
  userId?: string
  timeout?: number // 毫秒
  retries?: number
  metadata?: Record<string, unknown>
}

/**
 * 工具管理器配置
 */
export interface ToolManagerConfig {
  maxConcurrentCalls: number
  defaultTimeout: number
  enableRetry: boolean
  maxRetries: number
  enableConfirmation: boolean
  confirmationTools: string[] // 需要确认的工具列表
}

// ============ 消息格式 ============

/**
 * 支持工具调用的消息
 */
export interface ToolEnabledMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  name?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

// ============ 调试类型 ============

/**
 * 工具调用日志
 */
export interface ToolCallLog {
  id: string
  chainId: string
  callId: string
  toolName: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: number
  data?: unknown
}

/**
 * 执行统计
 */
export interface ToolExecutionStats {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  averageExecutionTime: number
  toolUsage: Record<string, number>
  recentErrors: Array<{
    toolName: string
    error: string
    timestamp: number
  }>
}

// ============ 工具定义导出 ============

/**
 * 内置工具名称
 */
export const BUILTIN_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'append_file',
  'list_directory',
  'delete_file',
  'execute_bash',
  'search_code',
  'get_running_processes',
  'stop_process',
  'restart_process'
] as const

export type BuiltinToolName = typeof BUILTIN_TOOLS[number]

/**
 * 文件操作工具
 */
export const FILE_OPERATION_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'append_file',
  'delete_file'
] as const

/**
 * 危险操作工具（需要确认）
 */
export const DANGEROUS_TOOLS = [
  'delete_file',
  'execute_bash',
  'stop_process'
] as const
