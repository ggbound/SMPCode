/**
 * Tools Executor - Simplified version
 * Provides tool execution using the new tool-executor
 */

import log from 'electron-log'
import {
  ToolCall,
  ToolResult,
  ExecutionContext,
  createExecutionContext,
  toToolResult
} from './tools-core'
import { executeTool } from './tool-executor'

export interface ToolExecutionOptions {
  cwd: string
  sessionId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

/**
 * Execute single tool call
 */
export async function executeToolCall(
  toolCall: ToolCall,
  options: ToolExecutionOptions
): Promise<ToolResult> {
  const context = createExecutionContext(options.cwd, {
    sessionId: options.sessionId,
    userId: options.userId,
    metadata: options.metadata
  })

  try {
    // Parse arguments
    let args: Record<string, unknown>
    if (typeof toolCall.function.arguments === 'string') {
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch (e) {
        return {
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.function.name,
          content: `Error: Failed to parse tool arguments: ${String(e)}`
        }
      }
    } else {
      args = toolCall.function.arguments
    }

    // Execute using new tool-executor
    const result = await executeTool(
      toolCall.id,
      toolCall.function.name,
      args,
      options.cwd
    )

    return toToolResult(toolCall.id, toolCall.function.name, result)
  } catch (error) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolCall.function.name,
      content: `Error executing tool: ${String(error)}`
    }
  }
}

/**
 * Execute multiple tool calls
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  options: ToolExecutionOptions
): Promise<ToolResult[]> {
  const results: ToolResult[] = []

  for (const toolCall of toolCalls) {
    const result = await executeToolCall(toolCall, options)
    results.push(result)
  }

  return results
}


