/**
 * useConversationBase - 对话基础 Hook
 * 提供 Chat/Agent 模式共享的基础功能
 */

import { useRef, useCallback, useEffect } from 'react'
import { useStore, type Message } from '../store'
import { executeTool } from '../services/tool-client'
import { parseToolCalls as parseToolCallsUtil, cleanToolCallBlocks as cleanToolCallBlocksUtil } from '../utils/toolParser'

// CLI Chat 流式响应块类型 - 共享类型定义
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
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
}

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
  id?: string  // 工具调用 ID，用于 tool_call_id
}

export interface ConversationResult {
  success: boolean
  error?: string
}

export interface ConversationOptions {
  providerApiKey: string
  providerApiUrl?: string
  model: string
  currentCwd: string
  projectPath: string | null
  currentSession: string | null
  localSessions: Array<{ id: string; title?: string }>
}

// 工具名称映射
export const TOOL_NAME_MAP: Record<string, string> = {
  'BashTool': 'execute_bash',
  'bash_tool': 'execute_bash',
  'bash': 'execute_bash',
  'ReadFileTool': 'read_file',
  'read_file_tool': 'read_file',
  'WriteFileTool': 'write_file',
  'write_file_tool': 'write_file',
  'EditFileTool': 'edit_file',
  'edit_file_tool': 'edit_file',
  'ListDirectoryTool': 'list_directory',
  'list_directory_tool': 'list_directory',
  'list_directory': 'list_directory',
  'SearchCodeTool': 'search_files',  // ✅ 修复：统一使用 search_files
  'search_code_tool': 'search_files',
  'search_code': 'search_files',  // 兼容旧名称
  'DeleteFileTool': 'delete_file',
  'delete_file_tool': 'delete_file',
  'delete_file': 'delete_file',
  'GlobTool': 'search_files',
  'glob_tool': 'search_files',
  'glob': 'search_files',
  'file_read': 'read_file',
  'file_write': 'write_file',
  'file_edit': 'edit_file',
  'read_file': 'read_file',
  'write_file': 'write_file',
  'edit_file': 'edit_file',
  'search_files': 'search_files',  // ✅ 修复：直接使用正确名称
  'execute_bash': 'execute_bash',
  'CheckPortTool': 'check_port',
  'check_port_tool': 'check_port',
  'check_port': 'check_port',
  'KillProcessTool': 'kill_process',
  'kill_process_tool': 'kill_process',
  'kill_process': 'kill_process',
  'FindProcessTool': 'find_process',
  'find_process_tool': 'find_process',
  'find_process': 'find_process',
}

/**
 * 解析工具调用 - 使用共享模块实现
 */
export function parseToolCalls(text: string): ToolCall[] | null {
  const result = parseToolCallsUtil(text)
  return result?.map(tc => ({ tool: tc.tool, arguments: tc.arguments, id: tc.id })) || null
}

/**
 * 清理工具调用代码块 - 使用共享模块实现
 */
export function cleanToolCallBlocks(content: string): string {
  return cleanToolCallBlocksUtil(content)
}

/**
 * IPC API 类型定义
 */
export interface CliChatAPI {
  createSession: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  // ✅ 修复：content 支持 string 或 多模态数组
  sendMessage: (sessionId: string, message: string, messages?: Array<{ 
    role: string; 
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> 
  }>) => Promise<{ success: boolean; error?: string }>
  onStreamChunk: (callback: (event: unknown, data: { sessionId: string; chunk: StreamChunk }) => void) => () => void
  stopSession?: (sessionId: string) => Promise<{ success: boolean }>
  deleteSession?: (sessionId: string) => Promise<{ success: boolean }>
}

export interface WindowAPI {
  cliChat?: CliChatAPI
  saveConversation?: (projectPath: string, sessionId: string, messages: Message[], title?: string) => Promise<void>
}

/**
 * 获取 IPC API
 */
export function getIPCApi(): { cliChat?: CliChatAPI; saveConversation?: Function } | null {
  const win = window as unknown as { api?: WindowAPI }
  return win.api || null
}

/**
 * useConversationBase - 基础 Hook
 */
export function useConversationBase() {
  const abortControllerRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const streamHandlerRef = useRef<((event: unknown, data: { sessionId: string; chunk: StreamChunk }) => void) | null>(null)
  const { addMessage, updateTokens } = useStore()

  /**
   * 更新最后一条助手消息
   */
  const updateLastMessage = useCallback((content: string) => {
    const state = useStore.getState()
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content }
        useStore.setState({ messages: msgs })
        break
      }
    }
  }, [])

  /**
   * 保存对话到会话
   */
  const saveConversation = useCallback(async (
    projectPath: string,
    sessionId: string,
    messages: Message[],
    title?: string
  ) => {
    try {
      const api = getIPCApi()
      if (api?.saveConversation) {
        await api.saveConversation(projectPath, sessionId, messages, title)
      }
    } catch (e) {
      console.error('Failed to save conversation:', e)
    }
  }, [])

  /**
   * 执行单个工具调用
   */
  const executeToolCall = useCallback(async (
    toolCall: ToolCall,
    cwd: string
  ): Promise<{ success: boolean; result: string }> => {
    try {
      // 映射工具名称
      const mappedToolName = TOOL_NAME_MAP[toolCall.tool] || toolCall.tool
      const result = await executeTool(mappedToolName, toolCall.arguments, { cwd })
      return {
        success: result.success,
        result: result.output || result.error || 'No output'
      }
    } catch (error) {
      return { success: false, result: String(error) }
    }
  }, [])

  /**
   * 检查是否为文件操作工具
   */
  const isFileOperationTool = useCallback((toolName: string): boolean => {
    const fileOperationTools = ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir']
    const mappedName = TOOL_NAME_MAP[toolName] || toolName
    return fileOperationTools.includes(mappedName)
  }, [])

  /**
   * 触发文件资源管理器刷新
   */
  const triggerFileRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('file-operation-completed'))
  }, [])

  /**
   * 停止生成
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (sessionIdRef.current) {
      const api = getIPCApi()
      if (api?.cliChat?.stopSession) {
        api.cliChat.stopSession(sessionIdRef.current)
      }
    }
  }, [])

  /**
   * 创建 CLI 会话
   */
  const createSession = useCallback(async (
    mode: 'chat' | 'agent',
    cwd: string,
    initialPrompt?: string
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    const api = getIPCApi()
    if (!api?.cliChat?.createSession) {
      return { success: false, error: 'CLI Chat IPC API not available' }
    }
    const result = await api.cliChat.createSession(mode, cwd, initialPrompt)
    if (result.success && result.sessionId) {
      sessionIdRef.current = result.sessionId
    }
    return result
  }, [])

  /**
   * 发送消息
   */
  const sendMessage = useCallback(async (
    sessionId: string,
    message: string,
    messages?: Array<{ role: string; content: string }>
  ): Promise<{ success: boolean; error?: string }> => {
    const api = getIPCApi()
    if (!api?.cliChat?.sendMessage) {
      return { success: false, error: 'CLI Chat sendMessage not available' }
    }
    return await api.cliChat.sendMessage(sessionId, message, messages)
  }, [])

  /**
   * 设置流式响应监听
   */
  const setupStreamListener = useCallback((
    sessionId: string,
    onChunk: (chunk: StreamChunk) => void
  ): (() => void) => {
    const api = getIPCApi()
    if (!api?.cliChat?.onStreamChunk) {
      return () => {}
    }

    const handler = (_event: unknown, data: { sessionId: string; chunk: StreamChunk }) => {
      if (data.sessionId === sessionId) {
        onChunk(data.chunk)
      }
    }

    streamHandlerRef.current = handler
    return api.cliChat.onStreamChunk(handler)
  }, [])

  /**
   * 清理会话
   */
  const cleanupSession = useCallback(() => {
    if (sessionIdRef.current) {
      const api = getIPCApi()
      if (api?.cliChat?.deleteSession) {
        api.cliChat.deleteSession(sessionIdRef.current)
      }
      sessionIdRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSession()
    }
  }, [cleanupSession])

  return {
    // Refs
    abortControllerRef,
    sessionIdRef,
    // Actions
    addMessage,
    updateTokens,
    updateLastMessage,
    saveConversation,
    executeToolCall,
    isFileOperationTool,
    triggerFileRefresh,
    stopGeneration,
    createSession,
    sendMessage,
    setupStreamListener,
    cleanupSession
  }
}

export default useConversationBase
