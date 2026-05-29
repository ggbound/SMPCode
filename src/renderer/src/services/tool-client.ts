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
  
  if (!window.api) {
    console.error('[ToolClient] ERROR: window.api is undefined!')
    console.error('[ToolClient] This usually means the preload script was not loaded correctly.')
    console.error('[ToolClient] Check if the preload script path is correct in BrowserWindow configuration.')
    return
  }
  
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
    console.error('[ToolClient] window.api keys:', Object.keys(window.api))
  }
}

// ============ 工具执行 ============

/**
 * 在终端中执行 bash 命令
 * 使用 startProcessInTerminal API 发送到内置终端执行
 */
async function executeBashInTerminal(
  command: string,
  cwd: string,
  callId: string
): Promise<ToolExecutionResult> {
  console.log(`[ToolClient] Executing bash in terminal: ${command}`)
  
  if (!window.api?.startProcessInTerminal) {
    throw new Error('startProcessInTerminal API not available')
  }

  try {
    // 注意：不传递 terminalId，让主进程自动生成并创建终端
    // 主进程会发送 terminal:create 事件给前端
    const result = await window.api.startProcessInTerminal(
      command,
      cwd,
      undefined,  // 不指定terminalId，让主进程创建
      `AI 执行: ${command}`
    )

    if (result.success) {
      console.log(`[ToolClient] Process started in terminal: ${result.processId}`)
      
      // 对于长期运行的命令（如开发服务器），立即返回成功
      // 不需要等待命令完成，让终端自己管理进程生命周期
      // 前端可以通过 process:started 事件和终端输出监控进程状态
      return {
        success: true,
        output: `命令已在终端中启动，正在运行...\n\n进程ID: ${result.processId}\n\n提示：\n- 可以在终端面板中查看实时输出\n- 使用 kill ${result.processId} 停止进程\n- 或在进程面板中管理此进程`,
        error: undefined
      }
    } else {
      return {
        success: false,
        output: '',
        error: result.error || 'Failed to start process in terminal'
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[ToolClient] Failed to execute bash in terminal:`, errorMessage)
    return {
      success: false,
      output: '',
      error: errorMessage
    }
  }
}

/**
 * 执行工具调用
 * 1. 在 store 中创建调用记录
 * 2. 通过 IPC 调用主进程执行
 * 3. 等待执行结果
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  options: { cwd?: string; useTerminal?: boolean } = {}
): Promise<ToolExecutionResult> {
  // 确保已初始化
  initializeToolClient()

  const callId = uuidv4()
  const cwd = options.cwd || '/'

  // CRITICAL: Log tool call details
  console.log(`[ToolClient] ========== Tool Call Start ==========`)
  console.log(`[ToolClient] Tool name: ${toolName}`)
  console.log(`[ToolClient] Arguments type:`, typeof args)
  console.log(`[ToolClient] Arguments keys:`, args ? Object.keys(args) : 'null')
  console.log(`[ToolClient] Arguments:`, JSON.stringify(args, null, 2))
  console.log(`[ToolClient] Working directory: ${cwd}`)
  
  // Validate execute_bash arguments
  if (toolName === 'execute_bash') {
    if (!args || !args.command) {
      const errorMsg = `Command is required for execute_bash tool. Received args: ${JSON.stringify(args)}`
      console.error(`[ToolClient] ${errorMsg}`)
      return { success: false, output: '', error: errorMsg }
    }
    console.log(`[ToolClient] ✅ execute_bash command validated:`, args.command)
  }

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
    // 对于 execute_bash 工具（及其别名），默认使用终端执行
    const isBashTool = toolName === 'execute_bash' || toolName === 'bash' || toolName === 'shell' || toolName === 'cmd' || toolName === 'terminal'
    
    if (isBashTool && options.useTerminal !== false) {
      const command = args.command as string
      console.log(`[ToolClient] Detected bash tool (${toolName}), executing in terminal`)
      const result = await executeBashInTerminal(command, cwd, callId)
      
      // 更新 store 状态
      if (result.success) {
        store.updateCallStatus(callId, 'completed', result.output)
      } else {
        store.updateCallStatus(callId, 'failed', undefined, result.error)
      }
      
      return result
    }
    
    // 其他工具通过 IPC 调用主进程
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
