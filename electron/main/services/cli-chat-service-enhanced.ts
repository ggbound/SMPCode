/**
 * CLI Chat Service Enhanced - 增强版 CLI 对话服务
 * 集成任务状态管理和断点续传功能
 */

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import {
  taskStateManager,
  TaskState,
  TaskExecutionStatus,
  TaskResumeContext,
  createTask,
  getTask,
  getTaskBySessionId,
  prepareResumeContext,
  getResumableTasks
} from './task-state-manager'
import {
  streamChatMessage,
  type Message as LLMMessage
} from './llm-service'
import { toolRegistry } from '../cli/tool-registry'
import { loadConfig } from '../config-service'
import { BrowserWindow } from 'electron'

// 重新导出类型
export type { TaskState, TaskResumeContext, TaskExecutionStatus }

// 增强版会话接口
interface EnhancedCLISession {
  id: string
  mode: 'chat' | 'agent'
  cwd: string
  messages: LLMMessage[]
  isStreaming: boolean
  abortController?: AbortController
  
  // 新增：关联的任务状态
  taskId?: string
  // 新增：当前迭代计数
  iterationCount: number
  // 新增：是否处于恢复模式
  isResuming: boolean
}

// 会话存储
const sessions = new Map<string, EnhancedCLISession>()

// 流式响应块
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'resume_info'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: Record<string, unknown> | string
  }
  toolResult?: {
    toolCallId: string
    success: boolean
    output: string
    error?: string
  }
  error?: string
  resumeInfo?: {
    taskId: string
    description: string
    progress: string
    canResume: boolean
  }
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

// 获取主窗口
function getMainWindow(): BrowserWindow | null {
  const { BrowserWindow } = require('electron')
  return BrowserWindow.getAllWindows()[0] || null
}

// 发送流式数据到渲染进程
function sendStreamToRenderer(sessionId: string, chunk: StreamChunk): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cli-chat:stream', { sessionId, chunk })
  }
}

/**
 * 创建增强版 CLI 会话
 * 自动关联或创建任务状态
 */
export function createEnhancedSession(
  mode: 'chat' | 'agent',
  cwd: string,
  initialPrompt?: string,
  options?: {
    resumeTaskId?: string  // 指定要恢复的任务 ID
    maxIterations?: number
  }
): { sessionId: string; taskId?: string; isResuming: boolean; resumeContext?: TaskResumeContext } {
  const sessionId = uuidv4()
  
  let taskState: TaskState | undefined
  let isResuming = false
  let resumeContext: TaskResumeContext | null = null
  
  // 如果指定了恢复任务 ID
  if (options?.resumeTaskId) {
    resumeContext = prepareResumeContext(options.resumeTaskId)
    if (resumeContext) {
      taskState = resumeContext.taskState
      isResuming = true
      
      // 更新任务状态为运行中
      taskStateManager.updateTaskStatus(
        taskState.id,
        TaskExecutionStatus.RUNNING,
        { sessionId }
      )
      
      log.info(`[CLIChatServiceEnhanced] Resuming task: ${taskState.id} for session: ${sessionId}`)
    }
  }
  
  // 如果是新任务且有初始提示
  if (!taskState && initialPrompt && mode === 'agent') {
    taskState = createTask(
      sessionId,
      mode,
      cwd,
      initialPrompt,
      options?.maxIterations
    )
    taskStateManager.updateTaskStatus(taskState.id, TaskExecutionStatus.RUNNING)
    log.info(`[CLIChatServiceEnhanced] Created new task: ${taskState.id} for session: ${sessionId}`)
  }
  
  const session: EnhancedCLISession = {
    id: sessionId,
    mode,
    cwd,
    messages: [],
    isStreaming: false,
    taskId: taskState?.id,
    iterationCount: isResuming ? (taskState?.currentIteration || 0) : 0,
    isResuming
  }
  
  // 如果是恢复模式，预填充消息
  if (resumeContext) {
    session.messages = resumeContext.resumeMessages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content
    }))
  }
  
  sessions.set(sessionId, session)
  
  return {
    sessionId,
    taskId: taskState?.id,
    isResuming,
    resumeContext: resumeContext || undefined
  }
}

/**
 * 获取会话
 */
export function getEnhancedSession(sessionId: string): EnhancedCLISession | undefined {
  return sessions.get(sessionId)
}

/**
 * 获取可恢复的任务列表
 */
export function getResumableTaskList(): Array<{
  id: string
  description: string
  status: TaskExecutionStatus
  progress: string
  updatedAt: number
  canResume: boolean
}> {
  return getResumableTasks().map(task => ({
    id: task.id,
    description: task.description,
    status: task.status,
    progress: `第 ${task.currentIteration}/${task.maxIterations} 轮迭代，${task.toolCalls.length} 个工具调用`,
    updatedAt: task.updatedAt,
    canResume: task.canResume
  }))
}

/**
 * 准备任务恢复
 */
export function prepareTaskResume(taskId: string): TaskResumeContext | null {
  return prepareResumeContext(taskId)
}

/**
 * 删除会话
 */
export function deleteEnhancedSession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  
  // 如果有关联任务，标记为中断
  if (session.taskId) {
    taskStateManager.markTaskInterrupted(session.taskId, '会话被删除')
  }
  
  if (session.abortController) {
    session.abortController.abort()
  }
  
  sessions.delete(sessionId)
  log.info(`[CLIChatServiceEnhanced] Deleted session: ${sessionId}`)
  return true
}

/**
 * 停止会话
 */
export function stopEnhancedSession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  
  // 标记任务为中断状态
  if (session.taskId) {
    taskStateManager.markTaskInterrupted(session.taskId, '用户停止')
  }
  
  if (session.abortController) {
    session.abortController.abort()
    session.isStreaming = false
  }
  
  log.info(`[CLIChatServiceEnhanced] Stopped session: ${sessionId}`)
  return true
}

/**
 * 构建系统提示词
 */
function buildSystemPrompt(mode: 'chat' | 'agent', cwd: string, isResuming: boolean = false): string {
  const systemInfo = `Operating System: ${process.platform}
Working Directory: ${cwd}`
  
  const basePrompt = `You are Claude Code, an AI coding assistant.

${systemInfo}

You have access to tools. Use them to complete tasks.

When user asks you to work with a file:
Step 1: Search for the file by name
<tool name="search_files" pattern="filename" search_type="filename"/>

Step 2: After finding the file, use the appropriate tool
<tool name="delete_file" path="/full/path/to/file"/>

Available tools:
- search_files: Find files by pattern or filename
- read_file: Read file contents
- delete_file: Delete a file
- write_file: Create or overwrite file
- edit_file: Edit specific lines in file
- list_directory: List directory contents
- execute_bash: Execute shell commands

CRITICAL RULES:
1. ALWAYS search first if you don't know the exact file path
2. Use XML format: <tool name="TOOL_NAME" param1="value1"/>
3. Wait for tool result before next step
4. Be concise, no explanations`

  if (isResuming) {
    return basePrompt + `

[系统提示：这是从检查点恢复的任务。请继续完成剩余的工作，不要重复已经执行过的操作。]`
  }
  
  return basePrompt
}

/**
 * 解析工具调用
 */
function parseToolCalls(content: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  
  // 匹配 <tool name="..." .../> 格式
  const toolRegex = /<tool\s+name="([^"]+)"([^\/>]*)\/>/g
  let match
  
  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1]
    const attrsContent = match[2]
    
    const args: Record<string, unknown> = {}
    const attrRegex = /(\w+)="([^"]*)"/g
    let attrMatch
    
    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      args[attrMatch[1]] = attrMatch[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
    }
    
    toolCalls.push({ name: toolName, arguments: args })
  }
  
  return toolCalls
}

/**
 * 执行工具调用
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
  sessionId: string,
  taskId?: string
): Promise<{ success: boolean; output: string; error?: string; toolCallId?: string }> {
  const toolCallId = uuidv4()
  
  // 记录工具调用到任务状态
  if (taskId) {
    taskStateManager.recordToolCall(taskId, {
      id: toolCallId,
      name: toolName,
      arguments: args
    })
  }
  
  const tool = toolRegistry.get(toolName)
  if (!tool) {
    const error = `Tool not found: ${toolName}`
    if (taskId) {
      taskStateManager.updateToolCallResult(taskId, toolCallId, '', error)
    }
    return { success: false, output: '', error, toolCallId }
  }
  
  const permission = toolRegistry.isAllowed(toolName)
  if (!permission.allowed) {
    const error = `Permission denied: ${permission.reason}`
    if (taskId) {
      taskStateManager.updateToolCallResult(taskId, toolCallId, '', error)
    }
    return { success: false, output: '', error, toolCallId }
  }
  
  try {
    const result = await toolRegistry.execute(toolName, args, {
      cwd,
      permissionMode: 'moderate'
    })
    
    // 更新工具调用结果
    if (taskId) {
      taskStateManager.updateToolCallResult(
        taskId,
        toolCallId,
        result.output || '',
        result.error
      )
    }
    
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      toolCallId
    }
  } catch (error) {
    const errorMsg = String(error)
    if (taskId) {
      taskStateManager.updateToolCallResult(taskId, toolCallId, '', errorMsg)
    }
    return { success: false, output: '', error: errorMsg, toolCallId }
  }
}

/**
 * 发送流式消息（增强版）
 * 支持任务状态跟踪和断点续传
 */
export async function sendEnhancedMessageStream(
  sessionId: string,
  message: string,
  options?: {
    onChunk?: (chunk: StreamChunk) => void
    maxIterations?: number
  }
): Promise<{ success: boolean; error?: string; taskCompleted?: boolean }> {
  const session = sessions.get(sessionId)
  if (!session) {
    return { success: false, error: `Session not found: ${sessionId}` }
  }
  
  const config = loadConfig()
  if (!config.apiKey) {
    return { success: false, error: 'API key not configured' }
  }
  
  // 获取关联的任务
  const task = session.taskId ? getTask(session.taskId) : undefined
  
  // 如果是恢复模式，发送恢复信息
  if (session.isResuming && task) {
    const resumeChunk: StreamChunk = {
      type: 'resume_info',
      resumeInfo: {
        taskId: task.id,
        description: task.description,
        progress: `第 ${task.currentIteration}/${task.maxIterations} 轮迭代，${task.toolCalls.length} 个工具调用`,
        canResume: task.canResume
      }
    }
    sendStreamToRenderer(sessionId, resumeChunk)
    options?.onChunk?.(resumeChunk)
    
    // 重置恢复标志
    session.isResuming = false
  }
  
  // 开始新迭代
  if (task) {
    taskStateManager.startIteration(task.id)
    session.iterationCount++
  }
  
  session.isStreaming = true
  session.abortController = new AbortController()
  
  try {
    // 构建消息历史
    if (session.messages.length === 0) {
      session.messages.push({
        role: 'system',
        content: buildSystemPrompt(session.mode, session.cwd, session.isResuming)
      })
    }
    
    session.messages.push({ role: 'user', content: message })
    
    // 记录消息到任务状态
    if (task) {
      taskStateManager.addMessage(task.id, { role: 'user', content: message })
    }
    
    // 获取工具定义
    const tools = session.mode === 'agent'
      ? toolRegistry.getAll().map(tool => ({
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
      : undefined
    
    // 发送流式请求
    const stream = await streamChatMessage({
      apiKey: config.apiKey,
      model: config.model || config.defaultModel || 'claude-3-5-sonnet',
      messages: session.messages,
      tools,
      apiUrl: config.providers?.[0]?.apiUrl
    })
    
    let fullContent = ''
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []
    
    // 处理流式响应
    for await (const chunk of stream) {
      if (session.abortController.signal.aborted) {
        break
      }
      
      // 处理内容增量
      if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta as { text?: string } | undefined
        if (delta?.text) {
          const textChunk: StreamChunk = {
            type: 'text',
            content: delta.text
          }
          fullContent += delta.text
          sendStreamToRenderer(sessionId, textChunk)
          options?.onChunk?.(textChunk)
        }
      }
      
      // 处理工具调用
      if (chunk.type === 'tool_use') {
        const toolCallChunk: StreamChunk = {
          type: 'tool_call',
          toolCall: {
            id: (chunk.id as string) || uuidv4(),
            name: (chunk.name as string) || '',
            arguments: (chunk.input as Record<string, unknown>) || {}
          }
        }
        toolCalls.push({ 
          name: (chunk.name as string) || '', 
          arguments: (chunk.input as Record<string, unknown>) || {} 
        })
        sendStreamToRenderer(sessionId, toolCallChunk)
        options?.onChunk?.(toolCallChunk)
      }
    }
    
    // 解析文本中的工具调用（兼容模式）
    const parsedToolCalls = parseToolCalls(fullContent)
    if (parsedToolCalls.length > 0) {
      toolCalls = [...toolCalls, ...parsedToolCalls]
    }
    
    // 执行工具调用
    if (toolCalls.length > 0 && session.mode === 'agent') {
      for (const toolCall of toolCalls) {
        const result = await executeToolCall(
          toolCall.name,
          toolCall.arguments,
          session.cwd,
          sessionId,
          session.taskId
        )
        
        const toolResultChunk: StreamChunk = {
          type: 'tool_result',
          toolResult: {
            toolCallId: result.toolCallId || uuidv4(),
            success: result.success,
            output: result.output,
            error: result.error
          }
        }
        
        sendStreamToRenderer(sessionId, toolResultChunk)
        options?.onChunk?.(toolResultChunk)
      }
    }
    
    // 更新消息历史
    session.messages.push({ role: 'assistant', content: fullContent })
    
    // 记录助手消息到任务状态
    if (task) {
      taskStateManager.addMessage(task.id, { role: 'assistant', content: fullContent })
      taskStateManager.endIteration(task.id)
    }
    
    // 发送完成信号
    const doneChunk: StreamChunk = { type: 'done' }
    sendStreamToRenderer(sessionId, doneChunk)
    options?.onChunk?.(doneChunk)
    
    session.isStreaming = false
    
    // 检查是否完成任务
    const taskCompleted = !fullContent.includes('<tool') && 
                          !fullContent.includes('```json') &&
                          toolCalls.length === 0
    
    if (taskCompleted && task) {
      taskStateManager.updateTaskStatus(task.id, TaskExecutionStatus.COMPLETED)
    }
    
    return { success: true, taskCompleted }
    
  } catch (error) {
    const errorMsg = String(error)
    log.error('[CLIChatServiceEnhanced] Error:', error)
    
    // 标记任务为错误状态
    if (task) {
      taskStateManager.updateTaskStatus(task.id, TaskExecutionStatus.ERROR, { error: errorMsg })
    }
    
    const errorChunk: StreamChunk = {
      type: 'error',
      error: errorMsg
    }
    sendStreamToRenderer(sessionId, errorChunk)
    options?.onChunk?.(errorChunk)
    
    session.isStreaming = false
    return { success: false, error: errorMsg }
  }
}

/**
 * 清理所有会话
 */
export function cleanupEnhancedSessions(): void {
  for (const [sessionId, session] of sessions) {
    // 标记所有任务为中断
    if (session.taskId) {
      taskStateManager.markTaskInterrupted(session.taskId, '应用关闭')
    }
    
    if (session.abortController) {
      try {
        session.abortController.abort()
      } catch (error) {
        log.debug(`[CLIChatServiceEnhanced] Error during cleanup: ${error}`)
      }
    }
  }
  sessions.clear()
  log.info('[CLIChatServiceEnhanced] Cleaned up all sessions')
}

// 导出便捷函数
export {
  taskStateManager,
  getTask,
  getTaskBySessionId
}
