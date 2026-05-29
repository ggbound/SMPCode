/**
 * Kilo Code 风格状态管理
 * 完全复刻 Kilo Code 的架构设计
 * 
 * 核心特性：
 * - 消息流由多个内容块组成（文本、工具调用、工具结果交错）
 * - 支持内联工具调用显示
 * - 实时流式更新
 */

import { create } from 'zustand'
import { AgentMode } from '../types/agent'

// 内容块类型
export type ContentBlockType = 'text' | 'tool_call' | 'tool_result' | 'thinking'

// 基础内容块
export interface BaseContentBlock {
  id: string
  type: ContentBlockType
  timestamp: number
}

// 文本内容块
export interface TextBlock extends BaseContentBlock {
  type: 'text'
  content: string
}

// 工具调用内容块
export interface ToolCallBlock extends BaseContentBlock {
  type: 'tool_call'
  toolCall: KiloToolCall
}

// 工具结果内容块
export interface ToolResultBlock extends BaseContentBlock {
  type: 'tool_result'
  toolCallId: string
  result: unknown
  error?: string
}

// 思考过程内容块
export interface ThinkingBlock extends BaseContentBlock {
  type: 'thinking'
  content: string
}

// 联合内容块类型
export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | ThinkingBlock

// Kilo Code 风格消息
export interface KiloMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
  mode?: AgentMode
  // 内容块数组（支持内联工具调用）
  blocks?: ContentBlock[]
  // 工具调用（向后兼容）
  toolCalls?: KiloToolCall[]
  // 思考过程（可折叠）
  reasoning?: string
  // 是否折叠思考过程
  isReasoningCollapsed?: boolean
}

// Kilo Code 风格工具调用
export interface KiloToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  duration?: number
  result?: unknown
  error?: string
}

// Kilo Code 风格会话
export interface KiloSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  mode: AgentMode
}

// Kilo Code 风格状态
interface KiloState {
  // 当前会话
  currentSession: string | null
  sessions: KiloSession[]
  
  // 消息
  messages: KiloMessage[]
  
  // 当前模式
  currentMode: AgentMode
  
  // 输入状态
  input: string
  isGenerating: boolean
  
  // 流式消息 ID
  streamingMessageId: string | null
  
  // 错误状态
  error: string | null
  errorType: 'model' | 'network' | 'api' | 'unknown' | null
  
  // Actions
  setCurrentSession: (id: string | null) => void
  setSessions: (sessions: KiloSession[]) => void
  addSession: (session: KiloSession) => void
  updateSession: (id: string, updates: Partial<KiloSession>) => void
  deleteSession: (id: string) => void
  clearAllSessions: () => void
  
  addMessage: (message: KiloMessage) => void
  updateMessage: (id: string, updates: Partial<KiloMessage>) => void
  deleteMessage: (id: string) => void
  clearMessages: () => void
  
  setCurrentMode: (mode: AgentMode) => void
  
  setInput: (input: string) => void
  setIsGenerating: (isGenerating: boolean) => void
  
  startStreaming: (messageId: string) => void
  stopStreaming: () => void
  
  // 错误处理
  setError: (error: string | null, errorType?: 'model' | 'network' | 'api' | 'unknown') => void
  clearError: () => void
  
  // 添加工具调用到消息
  addToolCall: (messageId: string, toolCall: KiloToolCall) => void
  updateToolCall: (messageId: string, toolCallId: string, updates: Partial<KiloToolCall>) => void
  
  // 内容块操作（支持内联工具调用）
  addContentBlock: (messageId: string, block: ContentBlock) => void
  updateContentBlock: (messageId: string, blockId: string, updates: Partial<ContentBlock>) => void
  appendTextToLastBlock: (messageId: string, text: string) => void
}

export const useKiloStore = create<KiloState>((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  currentMode: 'code',
  input: '',
  isGenerating: false,
  streamingMessageId: null,
  error: null,
  errorType: null,
  
  setCurrentSession: (id) => set({ currentSession: id }),
  
  // ✅ 新增：直接设置整个会话列表（用于加载时保持排序）
  setSessions: (sessions) => set({ sessions }),
  
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
    currentSession: session.id
  })),
  
  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map(s => 
      s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
    )
  })),
  
  deleteSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
    currentSession: state.currentSession === id ? null : state.currentSession
  })),
  
  clearAllSessions: () => set({ sessions: [], currentSession: null }),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === id ? { ...m, ...updates } : m
    )
  })),
  
  deleteMessage: (id) => set((state) => ({
    messages: state.messages.filter(m => m.id !== id)
  })),
  
  clearMessages: () => set({ messages: [] }),
  
  setCurrentMode: (mode) => set({ currentMode: mode }),
  
  setInput: (input) => set({ input }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  
  startStreaming: (messageId) => set({ 
    streamingMessageId: messageId,
    isGenerating: true 
  }),
  
  stopStreaming: () => set({ 
    streamingMessageId: null,
    isGenerating: false 
  }),
  
  setError: (error, errorType = 'unknown') => set({ error, errorType }),
  clearError: () => set({ error: null, errorType: null }),
  
  addToolCall: (messageId, toolCall) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== messageId) return m
      // 检查是否已存在相同 ID 的工具调用
      const existingCalls = m.toolCalls || []
      if (existingCalls.some(tc => tc.id === toolCall.id)) {
        return m // 已存在，不添加
      }
      return { ...m, toolCalls: [...existingCalls, toolCall] }
    })
  })),
  
  updateToolCall: (messageId, toolCallId, updates) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== messageId || !m.toolCalls) return m
      return {
        ...m,
        toolCalls: m.toolCalls.map(tc => 
          tc.id === toolCallId ? { ...tc, ...updates } : tc
        )
      }
    })
  })),
  
  // 添加内容块到消息
  addContentBlock: (messageId, block) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== messageId) return m
      const existingBlocks = m.blocks || []
      return { ...m, blocks: [...existingBlocks, block] }
    })
  })),
  
  // 更新内容块
  updateContentBlock: (messageId, blockId, updates) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== messageId || !m.blocks) return m
      return {
        ...m,
        blocks: m.blocks.map(b => 
          b.id === blockId ? { ...b, ...updates } : b
        )
      }
    })
  })),
  
  // 追加文本到最后一个文本块
  appendTextToLastBlock: (messageId, text) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== messageId || !m.blocks || m.blocks.length === 0) {
        // 如果没有 blocks，创建一个文本块
        if (m.id === messageId) {
          const newBlock: TextBlock = { 
            id: crypto.randomUUID(), 
            type: 'text', 
            content: text, 
            timestamp: Date.now() 
          }
          return {
            ...m,
            blocks: [newBlock]
          }
        }
        return m
      }
      
      const lastBlock = m.blocks[m.blocks.length - 1]
      if (lastBlock.type === 'text') {
        // 更新最后一个文本块
        return {
          ...m,
          blocks: m.blocks.map((b, idx) => 
            idx === m.blocks!.length - 1 && b.type === 'text'
              ? { ...b, content: (b as TextBlock).content + text }
              : b
          )
        }
      } else {
        // 最后一个不是文本块，添加新文本块
        const newBlock: TextBlock = { 
          id: crypto.randomUUID(), 
          type: 'text', 
          content: text, 
          timestamp: Date.now() 
        }
        return {
          ...m,
          blocks: [...m.blocks, newBlock]
        }
      }
    })
  }))
}))
