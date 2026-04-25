/**
 * 工具调用客户端 - 前端渲染进程
 * 参考 claw-code 架构：通过 IPC 与主进程通信
 */

import { v4 as uuidv4 } from 'uuid'
import { useToolStore, getToolStore } from '../store/toolStore'
import type {
  ToolCallRecord,
  ToolExecutionResult,
  ToolStatusEvent
} from '../../../shared/types/tool-call'

// ============ 初始化 IPC 监听 ============

let isInitialized = false

export function initializeToolClient(): void {
  if (isInitialized) {
    console.log('[ToolClient] Already initialized, skipping')
    return
  }
  isInitialized = true

  console.log('[ToolClient] Initializing tool client...')
  console.log('[ToolClient] window.api:', window.api)
  console.log('[ToolClient] onToolStatusChanged available:', !!window.api?.onToolStatusChanged)

  // 监听工具状态变化事件
  if (window.api?.onToolStatusChanged) {
    window.api.onToolStatusChanged((event: unknown, data: ToolStatusEvent) => {
      console.log('[ToolClient] ========== Received Tool Status Event ==========')
      console.log('[ToolClient] Event type:', data.type)
      console.log('[ToolClient] Call ID:', data.callId)
      console.log('[ToolClient] Tool name:', data.toolName)
      console.log('[ToolClient] Full data:', JSON.stringify(data, null, 2))
      
      const store = getToolStore()
      console.log('[ToolClient] Calling store.handleStatusEvent...')
      store.handleStatusEvent(data)
      
      // 验证 store 状态
      const state = useToolStore.getState()
      console.log('[ToolClient] Store calls count:', state.calls.size)
      console.log('[ToolClient] Store active calls:', state.activeCalls().length)
    })
    console.log('[ToolClient] Tool client initialized successfully')
  } else {
    console.error('[ToolClient] ERROR: onToolStatusChanged not available!')
    console.error('[ToolClient] window.api keys:', window.api ? Object.keys(window.api) : 'window.api is undefined')
  }
}

// ============ 工具执行 ============

/**
 * 执行工具调用
 * 1. 在 store 中创建调用记录
 * 2. 通过 IPC 调用主进程执行
 * 3. 等待执行结果
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  options: { cwd?: string } = {}
): Promise<ToolExecutionResult> {
  // 确保已初始化
  initializeToolClient()

  const callId = uuidv4()
  const cwd = options.cwd || '/'

  // 在 store 中添加调用记录
  const store = getToolStore()
  store.addCall({
    id: callId,
    name: toolName,
    arguments: args,
    status: 'executing',
    startTime: Date.now()
  })

  console.log(`[ToolClient] Executing tool: ${toolName} (id: ${callId})`)

  try {
    // 通过 IPC 调用主进程
    if (!window.api?.executeTool) {
      throw new Error('executeTool IPC not available')
    }

    const result = await window.api.executeTool(callId, toolName, args, cwd)
    console.log(`[ToolClient] Tool ${toolName} completed:`, result.success)
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[ToolClient] Tool ${toolName} failed:`, errorMessage)

    // 更新 store 中的错误状态
    store.updateCallStatus(callId, 'failed', undefined, errorMessage)

    return {
      success: false,
      output: '',
      error: errorMessage
    }
  }
}

/**
 * 批量执行工具调用
 */
export async function executeTools(
  calls: Array<{ toolName: string; args: Record<string, unknown> }>,
  options: { cwd?: string; stopOnError?: boolean } = {}
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = []

  for (const call of calls) {
    const result = await executeTool(call.toolName, call.args, options)
    results.push(result)

    if (!result.success && options.stopOnError !== false) {
      break
    }
  }

  return results
}

// ============ 状态查询 ============

export function getActiveCalls(): ToolCallRecord[] {
  return getToolStore().activeCalls()
}

export function getAllCalls(): ToolCallRecord[] {
  return getToolStore().allCalls()
}

export function clearHistory(): void {
  getToolStore().clearHistory()
}

// ============ Hook ============

export function useToolCalls() {
  return useToolStore()
}
