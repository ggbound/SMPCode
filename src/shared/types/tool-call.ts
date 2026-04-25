/**
 * 工具调用类型定义
 * 参考 claw-code 项目架构设计
 */

/** 工具调用状态 */
export type ToolCallStatus =
  | 'pending'      // 等待执行
  | 'executing'    // 执行中
  | 'completed'    // 执行成功
  | 'failed'       // 执行失败
  | 'cancelled'    // 已取消

/** 工具调用记录 */
export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  startTime: number
  endTime?: number
  executionTime?: number
  result?: string
  error?: string
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  success: boolean
  output: string
  error?: string
  metadata?: {
    executionTime?: number
    [key: string]: unknown
  }
}

/** 工具定义 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requiredPermission: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/** 工具调用请求 */
export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
  cwd?: string
}

/** 工具状态更新事件 */
export interface ToolStatusEvent {
  type: 'started' | 'completed' | 'failed' | 'cancelled'
  callId: string
  toolName: string
  timestamp: number
  result?: ToolExecutionResult
  error?: string
}
