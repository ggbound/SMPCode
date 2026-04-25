/**
 * 工具执行器 - 后端主进程
 * 负责执行记录管理和事件通知，实际执行委托给 tool-manager
 */

import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import log from 'electron-log'
import type {
  ToolCallRecord,
  ToolCallStatus,
  ToolExecutionResult,
  ToolStatusEvent
} from '../../../src/shared/types/tool-call'
import { toolManager } from './tool-manager'

// ============ 执行记录管理 ============

const callRecords: Map<string, ToolCallRecord> = new Map()
const activeCalls: Set<string> = new Set()

function createCallRecord(id: string, name: string, args: Record<string, unknown>): ToolCallRecord {
  const record: ToolCallRecord = {
    id,
    name,
    arguments: args,
    status: 'pending',
    startTime: Date.now()
  }
  callRecords.set(id, record)
  return record
}

function updateCallStatus(
  id: string,
  status: ToolCallStatus,
  result?: ToolExecutionResult
): void {
  const record = callRecords.get(id)
  if (!record) return

  record.status = status
  record.endTime = Date.now()
  record.executionTime = record.endTime - record.startTime

  if (result) {
    if (result.success) {
      record.result = result.output
    } else {
      record.error = result.error
    }
  }
}

// ============ 事件通知 ============

async function notifyFrontend(event: ToolStatusEvent): Promise<void> {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow || mainWindow.isDestroyed()) {
      log.warn(`[ToolExecutor] No active window for notification`)
      return
    }

    if (mainWindow.webContents.isDestroyed() || mainWindow.webContents.isCrashed()) {
      log.warn(`[ToolExecutor] WebContents not available`)
      return
    }

    mainWindow.webContents.send('tool-status-changed', event)
    log.debug(`[ToolExecutor] Notified frontend: ${event.type} - ${event.callId}`)
  } catch (error) {
    log.error(`[ToolExecutor] Failed to notify frontend:`, error)
  }
}

// ============ 工具执行 ============

export async function executeTool(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecutionResult> {
  log.info(`[ToolExecutor] ========== Tool Execution Start ==========`)
  log.info(`[ToolExecutor] Call ID: ${callId}`)
  log.info(`[ToolExecutor] Tool name: ${toolName}`)
  log.info(`[ToolExecutor] Arguments:`, JSON.stringify(args, null, 2))
  log.info(`[ToolExecutor] Working directory: ${cwd}`)
  
  // 创建执行记录
  createCallRecord(callId, toolName, args)
  activeCalls.add(callId)
  log.info(`[ToolExecutor] Call record created, active calls: ${activeCalls.size}`)

  // 通知前端开始执行
  log.info(`[ToolExecutor] Notifying frontend: started`)
  notifyFrontend({
    type: 'started',
    callId,
    toolName,
    timestamp: Date.now()
  })

  try {
    // 使用统一的工具管理器执行
    log.info(`[ToolExecutor] Delegating to toolManager.execute()`)
    const result = await toolManager.execute(callId, toolName, args, cwd)

    log.info(`[ToolExecutor] Tool execution result: success=${result.success}`)
    
    // 更新状态
    updateCallStatus(callId, result.success ? 'completed' : 'failed', result)
    activeCalls.delete(callId)
    log.info(`[ToolExecutor] Call record updated, active calls: ${activeCalls.size}`)

    // 通知前端执行完成
    log.info(`[ToolExecutor] Notifying frontend: ${result.success ? 'completed' : 'failed'}`)
    notifyFrontend({
      type: result.success ? 'completed' : 'failed',
      callId,
      toolName,
      timestamp: Date.now(),
      result
    })

    log.info(`[ToolExecutor] ========== Tool Execution End ==========`)
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error(`[ToolExecutor] Tool execution failed:`, error)
    
    const failedResult: ToolExecutionResult = {
      success: false,
      output: '',
      error: errorMessage
    }

    // 更新状态
    updateCallStatus(callId, 'failed', failedResult)
    activeCalls.delete(callId)
    log.info(`[ToolExecutor] Call record updated (failed), active calls: ${activeCalls.size}`)

    // 通知前端执行失败
    log.info(`[ToolExecutor] Notifying frontend: failed`)
    notifyFrontend({
      type: 'failed',
      callId,
      toolName,
      timestamp: Date.now(),
      error: errorMessage
    })

    log.info(`[ToolExecutor] ========== Tool Execution End ==========`)
    return failedResult
  }
}

// ============ IPC 处理 ============

export function setupToolExecutorIPC(): void {
  // 执行工具调用
  ipcMain.handle('tool:execute', async (
    _event: IpcMainInvokeEvent,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    cwd: string
  ) => {
    return executeTool(callId, toolName, args, cwd)
  })

  // 获取执行记录
  ipcMain.handle('tool:get-records', () => {
    return Array.from(callRecords.values())
  })

  // 获取活跃调用
  ipcMain.handle('tool:get-active', () => {
    return Array.from(activeCalls).map(id => callRecords.get(id)).filter(Boolean)
  })

  // 清除历史记录
  ipcMain.handle('tool:clear-history', () => {
    callRecords.clear()
    activeCalls.clear()
    log.info('[ToolExecutor] History cleared')
  })

  log.info('[ToolExecutor] IPC handlers registered')
}

// ============ 初始化 ============

export function initializeToolExecutor(): void {
  log.info('[ToolExecutor] Starting initialization...')
  
  try {
    // 初始化工具管理器
    log.info('[ToolExecutor] Initializing tool manager...')
    toolManager.initialize()
    log.info('[ToolExecutor] Tool manager initialized')
    
    // 设置 IPC
    log.info('[ToolExecutor] Setting up IPC handlers...')
    setupToolExecutorIPC()
    log.info('[ToolExecutor] IPC handlers set up')
    
    log.info('[ToolExecutor] Initialized successfully')
  } catch (error) {
    log.error('[ToolExecutor] Failed to initialize:', error)
    throw error
  }
}
