/**
 * Tool Call Manager - 工具调用状态管理器
 * 追踪工具调用的完整生命周期，提供状态感知的重复检测
 */

import log from 'electron-log'

// 工具调用状态
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed'

// 工具调用记录
export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: string
  error?: string
  startTime?: number
  endTime?: number
  duration?: number
  // 迭代计数，用于区分同一轮对话内的调用
  iterationCount: number
  // 会话ID
  sessionId: string
  // 该工具调用被复用的次数（用于防止 completed 后无限循环）
  reuseCount: number
}

// 工具调用管理器
export class ToolCallManager {
  private records: Map<string, ToolCallRecord> = new Map()
  private sessionTools: Map<string, Set<string>> = new Map()

  /**
   * 生成工具调用指纹
   * 用于识别相同的工具调用
   */
  private generateFingerprint(name: string, args: Record<string, unknown>): string {
    // 对参数进行排序以确保一致性
    const sortedArgs = Object.keys(args).sort().reduce((acc, key) => {
      acc[key] = args[key]
      return acc
    }, {} as Record<string, unknown>)
    const fingerprint = `${name}:${JSON.stringify(sortedArgs)}`
    log.debug(`[ToolCallManager] Generated fingerprint: ${fingerprint}`)
    return fingerprint
  }

  /**
   * 注册工具调用（pending状态）
   * 返回是否已存在相同调用
   */
  registerToolCall(
    sessionId: string,
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    iterationCount: number
  ): { isDuplicate: boolean; existingRecord?: ToolCallRecord; newRecord: ToolCallRecord } {
    const fingerprint = this.generateFingerprint(name, args)
    const existing = this.findExistingToolCall(sessionId, fingerprint, iterationCount)

    const record: ToolCallRecord = {
      id: toolCallId,
      name,
      arguments: args,
      status: 'pending',
      iterationCount,
      sessionId,
      reuseCount: 0
    }

    this.records.set(toolCallId, record)

    // 记录会话关联
    if (!this.sessionTools.has(sessionId)) {
      this.sessionTools.set(sessionId, new Set())
    }
    this.sessionTools.get(sessionId)!.add(toolCallId)

    if (existing) {
      // ✅ 如果复用的是已完成的工具，递增复用计数，用于上层判断是否陷入循环
      if (existing.status === 'completed') {
        existing.reuseCount += 1
        log.warn(`[ToolCallManager] Duplicate completed tool call detected: ${name}, reuseCount: ${existing.reuseCount}`)
      } else {
        log.warn(`[ToolCallManager] Duplicate tool call detected: ${name}, existing status: ${existing.status}`)
      }
      return { isDuplicate: true, existingRecord: existing, newRecord: record }
    }

    log.debug(`[ToolCallManager] Registered tool call: ${name} (${toolCallId})`)
    return { isDuplicate: false, newRecord: record }
  }

  /**
   * 查找已存在的工具调用
   * 优先查找当前迭代中的调用，然后查找历史调用
   */
  private findExistingToolCall(
    sessionId: string,
    fingerprint: string,
    currentIteration: number
  ): ToolCallRecord | undefined {
    const sessionToolIds = this.sessionTools.get(sessionId)
    log.debug(`[ToolCallManager] findExistingToolCall: sessionId=${sessionId}, fingerprint=${fingerprint}, currentIteration=${currentIteration}, sessionToolCount=${sessionToolIds?.size || 0}`)
    if (!sessionToolIds) {
      log.debug(`[ToolCallManager] No session tools found for session ${sessionId}`)
      return undefined
    }

    let currentIterationMatch: ToolCallRecord | undefined
    let completedMatch: ToolCallRecord | undefined

    for (const toolId of sessionToolIds) {
      const record = this.records.get(toolId)
      if (!record) continue

      const recordFingerprint = this.generateFingerprint(record.name, record.arguments)
      log.debug(`[ToolCallManager] Comparing: recordFingerprint=${recordFingerprint}, targetFingerprint=${fingerprint}, match=${recordFingerprint === fingerprint}`)
      if (recordFingerprint !== fingerprint) continue

      // 同一轮迭代中的重复（最优先）
      if (record.iterationCount === currentIteration) {
        log.debug(`[ToolCallManager] Found current iteration match: ${record.id}`)
        currentIterationMatch = record
        break
      }

      // 已完成的调用（用于返回之前的结果）
      if (record.status === 'completed' && !completedMatch) {
        log.debug(`[ToolCallManager] Found completed match: ${record.id}`)
        completedMatch = record
      }
    }

    const result = currentIterationMatch || completedMatch
    log.debug(`[ToolCallManager] findExistingToolCall result: ${result ? `found ${result.id}` : 'not found'}`)
    return result
  }

  /**
   * 更新工具调用状态为 running
   */
  markAsRunning(toolCallId: string): void {
    const record = this.records.get(toolCallId)
    if (record) {
      record.status = 'running'
      record.startTime = Date.now()
      log.debug(`[ToolCallManager] Tool call ${toolCallId} (${record.name}) is now running`)
    }
  }

  /**
   * 更新工具调用状态为 completed
   */
  markAsCompleted(toolCallId: string, result: string): void {
    const record = this.records.get(toolCallId)
    if (record) {
      record.status = 'completed'
      record.result = result
      record.endTime = Date.now()
      if (record.startTime) {
        record.duration = record.endTime - record.startTime
      }
      log.debug(`[ToolCallManager] Tool call ${toolCallId} (${record.name}) completed in ${record.duration}ms`)
    }
  }

  /**
   * 更新工具调用状态为 failed
   */
  markAsFailed(toolCallId: string, error: string): void {
    const record = this.records.get(toolCallId)
    if (record) {
      record.status = 'failed'
      record.error = error
      record.endTime = Date.now()
      log.debug(`[ToolCallManager] Tool call ${toolCallId} (${record.name}) failed: ${error}`)
    }
  }

  /**
   * 获取工具调用记录
   */
  getRecord(toolCallId: string): ToolCallRecord | undefined {
    return this.records.get(toolCallId)
  }

  /**
   * 获取会话中所有工具调用
   */
  getSessionToolCalls(sessionId: string): ToolCallRecord[] {
    const toolIds = this.sessionTools.get(sessionId)
    if (!toolIds) return []
    return Array.from(toolIds)
      .map((id: string) => this.records.get(id))
      .filter((record): record is ToolCallRecord => record !== undefined)
  }

  /**
   * 获取当前迭代中的工具调用
   */
  getCurrentIterationToolCalls(sessionId: string, iterationCount: number): ToolCallRecord[] {
    return this.getSessionToolCalls(sessionId).filter(r => r.iterationCount === iterationCount)
  }

  /**
   * 清理会话的所有记录
   */
  clearSession(sessionId: string): void {
    const toolIds = this.sessionTools.get(sessionId)
    if (toolIds) {
      toolIds.forEach(id => this.records.delete(id))
      this.sessionTools.delete(sessionId)
      log.debug(`[ToolCallManager] Cleared ${toolIds.size} tool calls for session ${sessionId}`)
    }
  }

  /**
   * 获取状态报告
   * 用于调试和日志
   */
  getStatusReport(sessionId: string): string {
    const tools = this.getSessionToolCalls(sessionId)
    const byStatus = {
      pending: tools.filter(t => t.status === 'pending').length,
      running: tools.filter(t => t.status === 'running').length,
      completed: tools.filter(t => t.status === 'completed').length,
      failed: tools.filter(t => t.status === 'failed').length
    }
    return `Session ${sessionId}: ${tools.length} total (pending=${byStatus.pending}, running=${byStatus.running}, completed=${byStatus.completed}, failed=${byStatus.failed})`
  }
}

// 全局单例
export const toolCallManager = new ToolCallManager()
