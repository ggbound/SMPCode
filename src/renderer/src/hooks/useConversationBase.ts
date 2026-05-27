/**
 * useConversationBase - 对话基础 Hook
 * 提供 Chat/Agent 模式共享的基础功能
 */

import { useRef, useCallback, useEffect } from 'react'
import { useStore, type Message } from '../store'
import { executeTool } from '../services/tool-client'

// CLI Chat 流式响应块类型 - 共享类型定义
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

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
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
  'SearchCodeTool': 'search_code',
  'search_code_tool': 'search_code',
  'search_code': 'search_code',
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
  'search_files': 'search_code',
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
 * 解析工具调用 - 共享实现
 */
export function parseToolCalls(text: string): ToolCall[] | null {
  const toolCalls: ToolCall[] = []

  // Method 1: Parse <tool_code> XML format
  const toolCodeRegex = /<tool_code>[\s\S]*?<tool\s+name="([^"]+)"([\s\S]*?)(?:\/>|<\/tool>)[\s\S]*?(?:<\/tool_code>|$)/g
  const toolCodeMatches = Array.from(text.matchAll(toolCodeRegex))

  for (const match of toolCodeMatches) {
    const toolName = match[1]
    let attrsContent = match[2]
    attrsContent = attrsContent.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const args: Record<string, unknown> = {}
    const attrRegex = /(\w+)="((?:[^"\\]|\\.)*)"/g
    let attrMatch
    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      const attrName = attrMatch[1]
      let attrValue = attrMatch[2]
      attrValue = attrValue.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
      if (attrName !== 'name') {
        args[attrName] = attrValue
      }
    }
    if (toolName && Object.keys(args).length > 0) {
      toolCalls.push({ tool: toolName, arguments: args })
    }
  }

  // Method 2: Parse MiniMax XML format
  const xmlToolCallRegex = /<minimax:tool_call>[\s\S]*?<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>[\s\S]*?<\/minimax:tool_call>/g
  const xmlMatches = Array.from(text.matchAll(xmlToolCallRegex))

  for (const match of xmlMatches) {
    const toolName = match[1]
    const paramsContent = match[2]
    const args: Record<string, unknown> = {}
    const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g
    const paramMatches = Array.from(paramsContent.matchAll(paramRegex))

    for (const paramMatch of paramMatches) {
      const paramName = paramMatch[1]
      const paramValue = paramMatch[2].trim()
      args[paramName] = paramValue
    }

    if (toolName && Object.keys(args).length > 0) {
      toolCalls.push({ tool: toolName, arguments: args })
    }
  }

  // Method 3: Parse JSON format from code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
  const matches = Array.from(text.matchAll(codeBlockRegex))

  for (const match of matches) {
    let blockContent = match[1].trim()

    // Try to fix incomplete JSON
    const openBraces = (blockContent.match(/\{/g) || []).length
    const closeBraces = (blockContent.match(/\}/g) || []).length
    if (openBraces > closeBraces) {
      blockContent += '}'.repeat(openBraces - closeBraces)
    }

    if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
      try {
        const parsed = JSON.parse(blockContent)
        if (parsed.tool && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
          continue
        }
      } catch (e) {
        // Not valid JSON, try line by line
      }
    }

    // Infer tool from fields
    try {
      const parsed = JSON.parse(blockContent)
      let inferredTool: string | null = null
      if (parsed.command !== undefined) inferredTool = 'execute_bash'
      else if (parsed.path !== undefined && parsed.content !== undefined) inferredTool = 'write_file'
      else if (parsed.path !== undefined && parsed.old_string !== undefined) inferredTool = 'edit_file'
      else if (parsed.path !== undefined) inferredTool = 'read_file'
      else if (parsed.query !== undefined) inferredTool = 'search_code'

      if (inferredTool) {
        toolCalls.push({ tool: inferredTool, arguments: parsed })
        continue
      }
    } catch (e) {
      // Not JSON
    }

    // Try line by line parsing
    const lines = blockContent.split('\n').filter(line => line.trim())
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim())
        if (parsed.tool && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
        }
      } catch (e) {
        // Ignore
      }
    }
  }

  return toolCalls.length > 0 ? toolCalls : null
}

/**
 * 清理工具调用代码块 - 共享实现
 */
export function cleanToolCallBlocks(content: string): string {
  let cleaned = content
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
  const matches = Array.from(content.matchAll(codeBlockRegex))

  for (const match of matches) {
    const blockContent = match[1].trim()
    const fullBlock = match[0]
    const hasToolPattern = blockContent.includes('"tool"') ||
      blockContent.includes('"tool_calls"') ||
      (blockContent.includes('"name"') && blockContent.includes('"arguments"'))

    if (hasToolPattern) {
      cleaned = cleaned.replace(fullBlock, '')
    }
  }

  // Remove XML tool calls
  const toolCodeRegex = /<tool_code>[\s\S]*?<tool\s+name="[^"]+"[\s\S]*?(?:\/>|<\/tool>)[\s\S]*?(?:<\/tool_code>|$)/g
  const toolCodeMatches = Array.from(cleaned.matchAll(toolCodeRegex))
  for (const match of toolCodeMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  const minimaxToolRegex = /<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g
  const minimaxMatches = Array.from(cleaned.matchAll(minimaxToolRegex))
  for (const match of minimaxMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  // Remove thinking tags
  const thinkRegex = /<thinking>[\s\S]*?<\/thinking>/g
  const thinkMatches = Array.from(cleaned.matchAll(thinkRegex))
  for (const match of thinkMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  return cleaned.trim()
}

/**
 * IPC API 类型定义
 */
export interface CliChatAPI {
  createSession: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  sendMessage: (sessionId: string, message: string, messages?: Array<{ role: string; content: string }>) => Promise<{ success: boolean; error?: string }>
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
