/**
 * Task State Manager - 任务状态管理器
 * 实现任务持久化、检查点和断点续传功能
 * 
 * 核心概念：
 * - TaskCheckpoint: 任务检查点，记录关键里程碑
 * - TaskState: 完整任务状态，支持从中断点恢复
 * - TaskContext: 任务上下文，包含执行所需的所有信息
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'

// 任务状态文件存储目录
const TASK_STATE_DIR = path.join(app.getPath('userData'), 'task-states')

// 检查点类型
export enum CheckpointType {
  START = 'start',           // 任务开始
  TOOL_CALL = 'tool_call',   // 工具调用前
  TOOL_RESULT = 'tool_result', // 工具调用后
  ITERATION_START = 'iteration_start', // 迭代开始
  ITERATION_END = 'iteration_end',   // 迭代结束
  FILE_OPERATION = 'file_operation', // 文件操作
  COMPLETED = 'completed',   // 任务完成
  ERROR = 'error'            // 任务错误
}

// 工具调用记录
export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  timestamp: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  duration?: number
}

// 任务检查点
export interface TaskCheckpoint {
  id: string
  type: CheckpointType
  timestamp: number
  description: string
  // 检查点时的消息历史（快照）
  messagesSnapshot: Array<{
    role: string
    content: string
    tool_call_id?: string
    name?: string
  }>
  // 检查点时的工具调用状态
  toolCallsSnapshot: ToolCallRecord[]
  // 迭代计数
  iterationCount: number
  // 额外元数据
  metadata?: Record<string, unknown>
}

// 任务执行状态
export enum TaskExecutionStatus {
  PENDING = 'pending',       // 等待执行
  RUNNING = 'running',       // 执行中
  PAUSED = 'paused',         // 用户暂停
  INTERRUPTED = 'interrupted', // 中断（如程序崩溃）
  COMPLETED = 'completed',   // 完成
  ERROR = 'error'            // 错误
}

// 完整任务状态
export interface TaskState {
  // 基本信息
  id: string
  sessionId: string
  mode: 'chat' | 'agent'
  cwd: string
  
  // 任务描述
  description: string
  originalPrompt: string
  
  // 执行状态
  status: TaskExecutionStatus
  
  // 消息历史（完整）
  messages: Array<{
    role: string
    content: string
    timestamp?: number
    tool_call_id?: string
    name?: string
  }>
  
  // 工具调用链
  toolCalls: ToolCallRecord[]
  
  // 检查点历史
  checkpoints: TaskCheckpoint[]
  
  // 当前迭代计数
  currentIteration: number
  maxIterations: number
  
  // Token 使用
  inputTokens: number
  outputTokens: number
  
  // 时间戳
  createdAt: number
  updatedAt: number
  completedAt?: number
  
  // 恢复相关信息
  lastCheckpointId?: string
  canResume: boolean
  resumePoint?: {
    iteration: number
    messageIndex: number
    toolCallIndex: number
  }
  
  // 执行统计
  statistics: {
    totalToolCalls: number
    successfulToolCalls: number
    failedToolCalls: number
    fileOperations: number
    searchOperations: number
  }
}

// 任务恢复上下文
export interface TaskResumeContext {
  taskState: TaskState
  // 恢复后的初始消息
  resumeMessages: Array<{
    role: string
    content: string
    tool_call_id?: string
    name?: string
  }>
  // 恢复提示
  resumePrompt: string
  // 是否可以从检查点完全恢复
  canFullyRestore: boolean
  // 部分恢复时需要补充的上下文
  missingContext?: string
}

/**
 * 确保任务状态目录存在
 */
function ensureTaskStateDir(): void {
  if (!fs.existsSync(TASK_STATE_DIR)) {
    fs.mkdirSync(TASK_STATE_DIR, { recursive: true })
    log.info(`[TaskStateManager] Created task state directory: ${TASK_STATE_DIR}`)
  }
}

/**
 * 任务状态管理器类
 */
export class TaskStateManager {
  private activeTasks: Map<string, TaskState> = new Map()
  
  constructor() {
    ensureTaskStateDir()
    this.loadAllTaskStates()
  }
  
  /**
   * 创建新任务
   */
  createTask(
    sessionId: string,
    mode: 'chat' | 'agent',
    cwd: string,
    originalPrompt: string,
    maxIterations: number = 25
  ): TaskState {
    const taskId = uuidv4()
    const now = Date.now()
    
    const taskState: TaskState = {
      id: taskId,
      sessionId,
      mode,
      cwd,
      description: this.generateTaskDescription(originalPrompt),
      originalPrompt,
      status: TaskExecutionStatus.PENDING,
      messages: [],
      toolCalls: [],
      checkpoints: [],
      currentIteration: 0,
      maxIterations,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: now,
      updatedAt: now,
      canResume: true,
      statistics: {
        totalToolCalls: 0,
        successfulToolCalls: 0,
        failedToolCalls: 0,
        fileOperations: 0,
        searchOperations: 0
      }
    }
    
    // 创建初始检查点
    this.addCheckpoint(taskState, CheckpointType.START, '任务开始', [{
      role: 'user',
      content: originalPrompt
    }])
    
    this.activeTasks.set(taskId, taskState)
    this.persistTaskState(taskState)
    
    log.info(`[TaskStateManager] Created task: ${taskId} for session: ${sessionId}`)
    return taskState
  }
  
  /**
   * 生成任务描述
   */
  private generateTaskDescription(prompt: string): string {
    // 提取前 100 个字符作为描述
    const cleanPrompt = prompt.replace(/\s+/g, ' ').trim()
    if (cleanPrompt.length <= 100) return cleanPrompt
    return cleanPrompt.substring(0, 100) + '...'
  }
  
  /**
   * 获取任务状态
   */
  getTask(taskId: string): TaskState | undefined {
    return this.activeTasks.get(taskId)
  }
  
  /**
   * 通过会话 ID 获取任务
   */
  getTaskBySessionId(sessionId: string): TaskState | undefined {
    return Array.from(this.activeTasks.values()).find(t => t.sessionId === sessionId)
  }
  
  /**
   * 更新任务状态
   */
  updateTaskStatus(
    taskId: string,
    status: TaskExecutionStatus,
    metadata?: Record<string, unknown>
  ): void {
    const task = this.activeTasks.get(taskId)
    if (!task) {
      log.warn(`[TaskStateManager] Task not found: ${taskId}`)
      return
    }
    
    task.status = status
    task.updatedAt = Date.now()
    
    if (status === TaskExecutionStatus.COMPLETED) {
      task.completedAt = Date.now()
      task.canResume = false
    }
    
    if (metadata) {
      Object.assign(task, metadata)
    }
    
    this.persistTaskState(task)
    log.debug(`[TaskStateManager] Updated task ${taskId} status to ${status}`)
  }
  
  /**
   * 添加消息到任务
   */
  addMessage(
    taskId: string,
    message: {
      role: string
      content: string
      tool_call_id?: string
      name?: string
    }
  ): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    
    task.messages.push({
      ...message,
      timestamp: Date.now()
    })
    task.updatedAt = Date.now()
    
    // 每 5 条消息自动保存
    if (task.messages.length % 5 === 0) {
      this.persistTaskState(task)
    }
  }
  
  /**
   * 记录工具调用
   */
  recordToolCall(
    taskId: string,
    toolCall: Omit<ToolCallRecord, 'timestamp' | 'status'>
  ): ToolCallRecord {
    const task = this.activeTasks.get(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    
    const record: ToolCallRecord = {
      ...toolCall,
      timestamp: Date.now(),
      status: 'pending'
    }
    
    task.toolCalls.push(record)
    task.statistics.totalToolCalls++
    
    // 分类统计
    const fileOperationTools = ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir']
    const searchTools = ['search_files', 'glob', 'grep']
    
    if (fileOperationTools.includes(toolCall.name)) {
      task.statistics.fileOperations++
    }
    if (searchTools.includes(toolCall.name)) {
      task.statistics.searchOperations++
    }
    
    // 创建检查点
    this.addCheckpoint(task, CheckpointType.TOOL_CALL, `调用工具: ${toolCall.name}`, task.messages, [record])
    
    this.persistTaskState(task)
    return record
  }
  
  /**
   * 更新工具调用结果
   */
  updateToolCallResult(
    taskId: string,
    toolCallId: string,
    result: string,
    error?: string
  ): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    
    const toolCall = task.toolCalls.find(tc => tc.id === toolCallId)
    if (!toolCall) return
    
    toolCall.status = error ? 'failed' : 'completed'
    toolCall.result = result
    toolCall.error = error
    toolCall.duration = Date.now() - toolCall.timestamp
    
    if (error) {
      task.statistics.failedToolCalls++
    } else {
      task.statistics.successfulToolCalls++
    }
    
    // 创建检查点
    this.addCheckpoint(task, CheckpointType.TOOL_RESULT, `工具完成: ${toolCall.name}`, task.messages, task.toolCalls)
    
    this.persistTaskState(task)
  }
  
  /**
   * 开始新迭代
   */
  startIteration(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    
    task.currentIteration++
    task.updatedAt = Date.now()
    
    this.addCheckpoint(
      task,
      CheckpointType.ITERATION_START,
      `开始第 ${task.currentIteration} 轮迭代`,
      task.messages,
      task.toolCalls
    )
    
    this.persistTaskState(task)
  }
  
  /**
   * 结束迭代
   */
  endIteration(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    
    this.addCheckpoint(
      task,
      CheckpointType.ITERATION_END,
      `完成第 ${task.currentIteration} 轮迭代`,
      task.messages,
      task.toolCalls
    )
    
    this.persistTaskState(task)
  }
  
  /**
   * 添加检查点
   */
  private addCheckpoint(
    task: TaskState,
    type: CheckpointType,
    description: string,
    messagesSnapshot: Array<{ role: string; content: string; tool_call_id?: string; name?: string }>,
    toolCallsSnapshot: ToolCallRecord[] = []
  ): TaskCheckpoint {
    const checkpoint: TaskCheckpoint = {
      id: uuidv4(),
      type,
      timestamp: Date.now(),
      description,
      messagesSnapshot: messagesSnapshot.map(m => ({ ...m })), // 深拷贝
      toolCallsSnapshot: toolCallsSnapshot.map(tc => ({ ...tc })), // 深拷贝
      iterationCount: task.currentIteration
    }
    
    task.checkpoints.push(checkpoint)
    task.lastCheckpointId = checkpoint.id
    
    // 限制检查点数量，保留最近 20 个
    if (task.checkpoints.length > 20) {
      task.checkpoints = task.checkpoints.slice(-20)
    }
    
    return checkpoint
  }
  
  /**
   * 持久化任务状态到文件
   */
  private persistTaskState(task: TaskState): void {
    try {
      const filePath = path.join(TASK_STATE_DIR, `${task.id}.json`)
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8')
    } catch (error) {
      log.error(`[TaskStateManager] Failed to persist task ${task.id}:`, error)
    }
  }
  
  /**
   * 从文件加载任务状态
   */
  private loadTaskState(taskId: string): TaskState | null {
    const filePath = path.join(TASK_STATE_DIR, `${taskId}.json`)
    
    if (!fs.existsSync(filePath)) {
      return null
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data as TaskState
    } catch (error) {
      log.error(`[TaskStateManager] Failed to load task ${taskId}:`, error)
      return null
    }
  }
  
  /**
   * 加载所有任务状态
   */
  private loadAllTaskStates(): void {
    try {
      if (!fs.existsSync(TASK_STATE_DIR)) return
      
      const files = fs.readdirSync(TASK_STATE_DIR)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskId = file.replace('.json', '')
          const task = this.loadTaskState(taskId)
          if (task) {
            // 只加载可以恢复的任务
            if (task.canResume && task.status !== TaskExecutionStatus.COMPLETED) {
              this.activeTasks.set(taskId, task)
            }
          }
        }
      }
      
      log.info(`[TaskStateManager] Loaded ${this.activeTasks.size} resumable tasks`)
    } catch (error) {
      log.error('[TaskStateManager] Failed to load task states:', error)
    }
  }
  
  /**
   * 准备任务恢复上下文
   */
  prepareResumeContext(taskId: string): TaskResumeContext | null {
    const task = this.activeTasks.get(taskId)
    if (!task) {
      log.warn(`[TaskStateManager] Cannot resume: task ${taskId} not found`)
      return null
    }
    
    if (!task.canResume) {
      log.warn(`[TaskStateManager] Cannot resume: task ${taskId} is not resumable`)
      return null
    }
    
    // 找到最后一个有意义的检查点
    const lastMeaningfulCheckpoint = this.findLastMeaningfulCheckpoint(task)
    
    if (!lastMeaningfulCheckpoint) {
      // 没有检查点，从开头恢复
      return {
        taskState: task,
        resumeMessages: [{ role: 'user', content: task.originalPrompt }],
        resumePrompt: task.originalPrompt,
        canFullyRestore: false
      }
    }
    
    // 构建恢复消息
    const resumeMessages = this.buildResumeMessages(task, lastMeaningfulCheckpoint)
    
    // 生成恢复提示
    const resumePrompt = this.generateResumePrompt(task, lastMeaningfulCheckpoint)
    
    return {
      taskState: task,
      resumeMessages,
      resumePrompt,
      canFullyRestore: true,
      missingContext: this.generateMissingContext(task, lastMeaningfulCheckpoint)
    }
  }
  
  /**
   * 找到最后一个有意义的检查点
   */
  private findLastMeaningfulCheckpoint(task: TaskState): TaskCheckpoint | null {
    // 从后往前找，跳过 START 和简单的 ITERATION_START
    for (let i = task.checkpoints.length - 1; i >= 0; i--) {
      const cp = task.checkpoints[i]
      if (cp.type === CheckpointType.TOOL_RESULT || 
          cp.type === CheckpointType.FILE_OPERATION ||
          (cp.type === CheckpointType.ITERATION_END && cp.iterationCount > 0)) {
        return cp
      }
    }
    
    // 如果没有找到，返回最后一个检查点
    return task.checkpoints[task.checkpoints.length - 1] || null
  }
  
  /**
   * 构建恢复消息
   */
  private buildResumeMessages(
    task: TaskState,
    checkpoint: TaskCheckpoint
  ): Array<{ role: string; content: string; tool_call_id?: string; name?: string }> {
    // 使用检查点的消息快照作为基础
    const messages = [...checkpoint.messagesSnapshot]
    
    // 添加恢复提示
    messages.push({
      role: 'system',
      content: `[系统提示：任务从中断点恢复。当前是第 ${checkpoint.iterationCount} 轮迭代，已执行 ${checkpoint.toolCallsSnapshot.length} 个工具调用。请继续完成剩余工作。]`
    })
    
    return messages
  }
  
  /**
   * 生成恢复提示
   */
  private generateResumePrompt(task: TaskState, checkpoint: TaskCheckpoint): string {
    const lines: string[] = [
      `[任务恢复]`,
      ``,
      `原始任务：${task.description}`,
      `当前进度：第 ${checkpoint.iterationCount}/${task.maxIterations} 轮迭代`,
      `已执行工具：${checkpoint.toolCallsSnapshot.length} 个`,
      ``
    ]
    
    // 列出最近的工具调用结果
    const recentTools = checkpoint.toolCallsSnapshot.slice(-5)
    if (recentTools.length > 0) {
      lines.push('最近的操作：')
      recentTools.forEach((tool, i) => {
        const status = tool.status === 'completed' ? '✅' : tool.status === 'failed' ? '❌' : '⏳'
        lines.push(`${i + 1}. ${status} ${tool.name}`)
      })
      lines.push('')
    }
    
    lines.push('请继续完成剩余的工作。')
    
    return lines.join('\n')
  }
  
  /**
   * 生成缺失的上下文
   */
  private generateMissingContext(task: TaskState, checkpoint: TaskCheckpoint): string {
    const lines: string[] = ['任务执行摘要：']
    
    // 统计信息
    lines.push(`- 总迭代数：${task.currentIteration}`)
    lines.push(`- 工具调用：${task.statistics.totalToolCalls} 次（成功 ${task.statistics.successfulToolCalls}，失败 ${task.statistics.failedToolCalls}）`)
    lines.push(`- 文件操作：${task.statistics.fileOperations} 次`)
    lines.push(`- 搜索操作：${task.statistics.searchOperations} 次`)
    lines.push('')
    
    // 最近的工具调用详情
    const recentTools = task.toolCalls.slice(-3)
    if (recentTools.length > 0) {
      lines.push('最近完成的操作：')
      recentTools.forEach(tool => {
        lines.push(`\n**${tool.name}**`)
        lines.push(`参数：${JSON.stringify(tool.arguments, null, 2).substring(0, 200)}`)
        if (tool.result) {
          lines.push(`结果：${tool.result.substring(0, 200)}${tool.result.length > 200 ? '...' : ''}`)
        }
      })
    }
    
    return lines.join('\n')
  }
  
  /**
   * 标记任务为可恢复
   */
  markTaskInterrupted(taskId: string, reason: string): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    
    task.status = TaskExecutionStatus.INTERRUPTED
    task.canResume = true
    task.updatedAt = Date.now()
    
    // 记录恢复点
    task.resumePoint = {
      iteration: task.currentIteration,
      messageIndex: task.messages.length - 1,
      toolCallIndex: task.toolCalls.length - 1
    }
    
    this.addCheckpoint(task, CheckpointType.ERROR, `任务中断: ${reason}`, task.messages, task.toolCalls)
    this.persistTaskState(task)
    
    log.info(`[TaskStateManager] Marked task ${taskId} as interrupted: ${reason}`)
  }
  
  /**
   * 获取所有可恢复的任务
   */
  getResumableTasks(): TaskState[] {
    return Array.from(this.activeTasks.values())
      .filter(t => t.canResume && t.status !== TaskExecutionStatus.COMPLETED)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  
  /**
   * 获取最近的任务
   */
  getRecentTasks(limit: number = 10): TaskState[] {
    return Array.from(this.activeTasks.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }
  
  /**
   * 删除任务
   */
  deleteTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId)
    if (!task) return false
    
    this.activeTasks.delete(taskId)
    
    try {
      const filePath = path.join(TASK_STATE_DIR, `${taskId}.json`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      log.info(`[TaskStateManager] Deleted task: ${taskId}`)
      return true
    } catch (error) {
      log.error(`[TaskStateManager] Failed to delete task ${taskId}:`, error)
      return false
    }
  }
  
  /**
   * 清理已完成的任务（保留最近 50 个）
   */
  cleanupCompletedTasks(): void {
    const completedTasks = Array.from(this.activeTasks.values())
      .filter(t => t.status === TaskExecutionStatus.COMPLETED)
      .sort((a, b) => b.completedAt! - a.completedAt!)
    
    // 保留最近 50 个
    const tasksToDelete = completedTasks.slice(50)
    
    for (const task of tasksToDelete) {
      this.deleteTask(task.id)
    }
    
    if (tasksToDelete.length > 0) {
      log.info(`[TaskStateManager] Cleaned up ${tasksToDelete.length} completed tasks`)
    }
  }
}

// 导出单例实例
export const taskStateManager = new TaskStateManager()

// 便捷函数
export function createTask(
  sessionId: string,
  mode: 'chat' | 'agent',
  cwd: string,
  originalPrompt: string,
  maxIterations?: number
): TaskState {
  return taskStateManager.createTask(sessionId, mode, cwd, originalPrompt, maxIterations)
}

export function getTask(taskId: string): TaskState | undefined {
  return taskStateManager.getTask(taskId)
}

export function getTaskBySessionId(sessionId: string): TaskState | undefined {
  return taskStateManager.getTaskBySessionId(sessionId)
}

export function prepareResumeContext(taskId: string): TaskResumeContext | null {
  return taskStateManager.prepareResumeContext(taskId)
}

export function getResumableTasks(): TaskState[] {
  return taskStateManager.getResumableTasks()
}
