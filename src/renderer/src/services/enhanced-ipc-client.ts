/**
 * Enhanced IPC Client - 增强型 IPC 客户端
 * 提供统一的 IPC 调用接口，自动错误处理、重试、类型安全
 */

import {
  wrapIPCCall,
  safeIPCCall,
  validateIPCApi,
  getUserFriendlyErrorMessage,
  ErrorType,
  AppError,
  type IPCResult
} from './error-handler'
import type { Message } from '../store'

// CLI Chat Stream Chunk 类型
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: string
  }
  toolResult?: {
    toolCallId: string
    success: boolean
    output: string
    error?: string
  }
  error?: string
}

// 会话信息
export interface SessionInfo {
  id: string
  title?: string
  updatedAt?: string
  messageCount?: number
}

// Git 状态
export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  modified: string[]
  added: string[]
  deleted: string[]
  untracked: string[]
  conflicted: string[]
  isClean: boolean
}

// 终端信息
export interface TerminalInfo {
  id: string
  name: string
  cwd?: string
  active?: boolean
}

// 搜索结果
export interface SearchResult {
  file: string
  line: number
  column: number
  text: string
}

// ==================== Config APIs ====================

export async function getConfig(): Promise<{
  apiKey: string
  model: string
  defaultModel: string
  permissionMode: string
  providers: any[]
} | null> {
  return safeIPCCall(
    () => (window as any).api?.getConfig?.(),
    'getConfig',
    null
  )
}

export async function saveAllConfig(config: Record<string, unknown>): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.saveAllConfig?.(config),
    'saveAllConfig',
    false
  )
}

// ==================== Session APIs ====================

export async function listSessions(projectPath: string): Promise<{ success: boolean; sessions?: SessionInfo[]; error?: string }> {
  return safeIPCCall(
    () => (window as any).api?.listSessions?.(projectPath),
    'listSessions',
    { success: false, error: 'API not available' }
  )
}

export async function loadConversation(projectPath: string, sessionId: string): Promise<{ success: boolean; messages?: Message[]; error?: string }> {
  return safeIPCCall(
    () => (window as any).api?.loadConversation?.(projectPath, sessionId),
    'loadConversation',
    { success: false, error: 'API not available' }
  )
}

export async function saveConversation(
  projectPath: string,
  sessionId: string,
  messages: Message[],
  title?: string
): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.saveConversation?.(projectPath, sessionId, messages, title),
    'saveConversation',
    false
  )
}

export async function deleteSession(projectPath: string, sessionId: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.deleteSession?.(projectPath, sessionId),
    'deleteSession',
    false
  )
}

// ==================== CLI Chat APIs ====================

export async function createChatSession(
  mode: 'chat' | 'agent',
  cwd: string,
  initialPrompt?: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return safeIPCCall(
    () => (window as any).api?.cliChat?.createSession?.(mode, cwd, initialPrompt),
    'createChatSession',
    { success: false, error: 'CLI Chat not available' }
  )
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
  messages?: Array<{ role: string; content: string }>
): Promise<{ success: boolean; error?: string }> {
  return safeIPCCall(
    () => (window as any).api?.cliChat?.sendMessage?.(sessionId, message, messages),
    'sendChatMessage',
    { success: false, error: 'CLI Chat not available' }
  )
}

export async function stopChatSession(sessionId: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.cliChat?.stopSession?.(sessionId),
    'stopChatSession',
    false
  )
}

export async function deleteChatSession(sessionId: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.cliChat?.deleteSession?.(sessionId),
    'deleteChatSession',
    false
  )
}

export function onChatStreamChunk(
  callback: (data: { sessionId: string; chunk: StreamChunk }) => void
): () => void {
  const api = (window as any).api?.cliChat
  if (!api?.onStreamChunk) {
    console.warn('[EnhancedIPC] cliChat.onStreamChunk not available')
    return () => {}
  }

  return api.onStreamChunk((event: unknown, data: { sessionId: string; chunk: StreamChunk }) => {
    callback(data)
  })
}

// ==================== Tool APIs ====================

export async function executeTool(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return safeIPCCall(
    () => (window as any).api?.executeTool?.(callId, toolName, args, cwd),
    'executeTool',
    { success: false, error: 'Tool execution not available' }
  )
}

export async function getCommands(): Promise<Array<{ name: string; responsibility: string; source_hint?: string }>> {
  return safeIPCCall(
    () => (window as any).api?.getCommands?.(),
    'getCommands',
    []
  )
}

export async function getTools(): Promise<Array<{ name: string; responsibility: string; source_hint?: string }>> {
  return safeIPCCall(
    () => (window as any).api?.getTools?.(),
    'getTools',
    []
  )
}

// ==================== File System APIs ====================

export async function selectFolder(): Promise<string | null> {
  return safeIPCCall(
    () => (window as any).api?.selectFolder?.(),
    'selectFolder',
    null
  )
}

export async function openFile(): Promise<string | null> {
  return safeIPCCall(
    () => (window as any).api?.openFile?.(),
    'openFile',
    null
  )
}

export async function showSaveDialog(options?: Electron.SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }> {
  return safeIPCCall(
    () => (window as any).api?.showSaveDialog?.(options),
    'showSaveDialog',
    { canceled: true }
  )
}

export async function startWatchingDirectory(dirPath: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.fsWatch?.(dirPath),
    'fsWatch',
    false
  )
}

export async function stopWatchingDirectory(dirPath: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.fsUnwatch?.(dirPath),
    'fsUnwatch',
    false
  )
}

export function onFileChange(
  callback: (data: { eventType: string; filename: string; dirPath: string }) => void
): () => void {
  const api = (window as any).api
  if (!api?.onFileChange) {
    console.warn('[EnhancedIPC] onFileChange not available')
    return () => {}
  }

  return api.onFileChange((event: unknown, data: { eventType: string; filename: string; dirPath: string }) => {
    callback(data)
  })
}

// ==================== Terminal APIs ====================

export async function createTerminal(options?: { name?: string; cwd?: string; id?: string }): Promise<TerminalInfo | null> {
  return safeIPCCall(
    () => (window as any).api?.createTerminal?.(options),
    'createTerminal',
    null
  )
}

export async function writeTerminal(id: string, data: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.writeTerminal?.(id, data),
    'writeTerminal',
    false
  )
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.resizeTerminal?.(id, cols, rows),
    'resizeTerminal',
    false
  )
}

export async function killTerminal(id: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.killTerminal?.(id),
    'killTerminal',
    false
  )
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  return safeIPCCall(
    () => (window as any).api?.listTerminals?.(),
    'listTerminals',
    []
  )
}

export async function renameTerminal(id: string, name: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.renameTerminal?.(id, name),
    'renameTerminal',
    false
  )
}

export function onTerminalData(
  callback: (data: { id: string; data: string }) => void
): () => void {
  const api = (window as any).api
  if (!api?.onTerminalData) {
    return () => {}
  }

  return api.onTerminalData((event: unknown, data: { id: string; data: string }) => {
    callback(data)
  })
}

export function onTerminalExit(
  callback: (data: { id: string; exitCode: number }) => void
): () => void {
  const api = (window as any).api
  if (!api?.onTerminalExit) {
    return () => {}
  }

  return api.onTerminalExit((event: unknown, data: { id: string; exitCode: number }) => {
    callback(data)
  })
}

// ==================== Git APIs ====================

export async function getGitStatus(repoPath: string): Promise<GitStatus | null> {
  return safeIPCCall(
    () => (window as any).api?.gitStatus?.(repoPath),
    'gitStatus',
    null
  )
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.gitIsRepo?.(dirPath),
    'gitIsRepo',
    false
  )
}

export async function findGitRoot(startPath: string): Promise<string | null> {
  return safeIPCCall(
    () => (window as any).api?.gitFindRoot?.(startPath),
    'gitFindRoot',
    null
  )
}

export async function getGitFileStatus(repoPath: string, filePath: string): Promise<string> {
  return safeIPCCall(
    () => (window as any).api?.gitFileStatus?.(repoPath, filePath),
    'gitFileStatus',
    'unknown'
  )
}

export async function getGitCommits(repoPath: string, count = 10): Promise<Array<{
  hash: string
  message: string
  author: string
  date: string
}>> {
  return safeIPCCall(
    () => (window as any).api?.gitCommits?.(repoPath, count),
    'gitCommits',
    []
  )
}

export async function getFileDiff(repoPath: string, filePath: string, staged = false): Promise<string> {
  return safeIPCCall(
    () => (window as any).api?.gitDiff?.(repoPath, filePath, staged),
    'gitDiff',
    ''
  )
}

export async function getGitStashList(repoPath: string): Promise<Array<{
  index: number
  hash: string
  message: string
}>> {
  return safeIPCCall(
    () => (window as any).api?.gitStashList?.(repoPath),
    'gitStashList',
    []
  )
}

export async function getGitBranches(repoPath: string): Promise<string[]> {
  return safeIPCCall(
    () => (window as any).api?.gitBranches?.(repoPath),
    'gitBranches',
    []
  )
}

// ==================== Search APIs ====================

export async function executeSearch(options: {
  query: string
  path: string
  includePattern?: string
  excludePattern?: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWords?: boolean
  maxResults?: number
  useIgnoreFiles?: boolean
}): Promise<{ results: SearchResult[]; totalCount: number }> {
  return safeIPCCall(
    () => (window as any).api?.executeSearch?.(options),
    'executeSearch',
    { results: [], totalCount: 0 }
  )
}

// ==================== Process APIs ====================

export async function startProcessInTerminal(
  command: string,
  cwd: string,
  terminalId: string,
  aiPrompt?: string
): Promise<{ processId: string; aiIntentId?: string } | null> {
  return safeIPCCall(
    () => (window as any).api?.startProcessInTerminal?.(command, cwd, terminalId, aiPrompt),
    'startProcessInTerminal',
    null
  )
}

export async function stopProcess(processId: string): Promise<boolean> {
  return safeIPCCall(
    () => (window as any).api?.stopProcess?.(processId),
    'stopProcess',
    false
  )
}

export async function getRunningProcesses(): Promise<Array<{
  processId: string
  command: string
  cwd: string
  terminalId?: string
}>> {
  return safeIPCCall(
    () => (window as any).api?.getRunningProcesses?.(),
    'getRunningProcesses',
    []
  )
}

// ==================== Window APIs ====================

export function minimizeWindow(): void {
  ;(window as any).api?.minimizeWindow?.()
}

export function maximizeWindow(): void {
  ;(window as any).api?.maximizeWindow?.()
}

export function closeWindow(): void {
  ;(window as any).api?.closeWindow?.()
}

// ==================== Event Listeners ====================

export function onFileOperation(
  callback: (data: { operation: 'writing' | 'editing' | 'creating'; path: string; timestamp: number }) => void
): () => void {
  const api = (window as any).api
  if (!api?.onFileOperation) {
    return () => {}
  }

  return api.onFileOperation((event: unknown, data: { operation: 'writing' | 'editing' | 'creating'; path: string; timestamp: number }) => {
    callback(data)
  })
}

export function onToolStatusChanged(
  callback: (data: {
    type: string
    callId: string
    toolName: string
    timestamp: number
    result?: unknown
    error?: string
  }) => void
): () => void {
  const api = (window as any).api
  if (!api?.onToolStatusChanged) {
    return () => {}
  }

  return api.onToolStatusChanged((event: unknown, data: {
    type: string
    callId: string
    toolName: string
    timestamp: number
    result?: unknown
    error?: string
  }) => {
    callback(data)
  })
}

// ==================== Validation ====================

export { validateIPCApi, getUserFriendlyErrorMessage, ErrorType, AppError }

// ==================== Health Check ====================

export async function healthCheck(): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = []

  // 验证 IPC API
  const validation = validateIPCApi()
  if (!validation.valid) {
    issues.push(...validation.missing.map(m => `Missing API: ${m}`))
  }

  // 测试关键 API
  try {
    const config = await getConfig()
    if (!config) {
      issues.push('Config API not responding')
    }
  } catch (e) {
    issues.push(`Config API error: ${String(e)}`)
  }

  return {
    healthy: issues.length === 0,
    issues
  }
}

// 默认导出
export default {
  // Config
  getConfig,
  saveAllConfig,
  // Sessions
  listSessions,
  loadConversation,
  saveConversation,
  deleteSession,
  // CLI Chat
  createChatSession,
  sendChatMessage,
  stopChatSession,
  deleteChatSession,
  onChatStreamChunk,
  // Tools
  executeTool,
  getCommands,
  getTools,
  // File System
  selectFolder,
  openFile,
  showSaveDialog,
  startWatchingDirectory,
  stopWatchingDirectory,
  onFileChange,
  // Terminal
  createTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  listTerminals,
  renameTerminal,
  onTerminalData,
  onTerminalExit,
  // Git
  getGitStatus,
  isGitRepo,
  findGitRoot,
  getGitFileStatus,
  getGitCommits,
  getFileDiff,
  getGitStashList,
  getGitBranches,
  // Search
  executeSearch,
  // Process
  startProcessInTerminal,
  stopProcess,
  getRunningProcesses,
  // Window
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  // Events
  onFileOperation,
  onToolStatusChanged,
  // Validation
  validateIPCApi,
  getUserFriendlyErrorMessage,
  ErrorType,
  AppError,
  // Health
  healthCheck
}
