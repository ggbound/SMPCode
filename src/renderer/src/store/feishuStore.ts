/**
 * Feishu Store - 飞书专用状态管理
 * 
 * 完全独立的存储，与普通会话分开
 */

import { create } from 'zustand'
import { AgentMode } from '../types/agent'

// 内容块类型
export type FeishuContentBlockType = 'text' | 'tool_call' | 'tool_result' | 'thinking'

// 基础内容块
export interface FeishuBaseContentBlock {
  id: string
  type: FeishuContentBlockType
  timestamp: number
}

// 文本内容块
export interface FeishuTextBlock extends FeishuBaseContentBlock {
  type: 'text'
  content: string
}

// 工具调用内容块
export interface FeishuToolCallBlock extends FeishuBaseContentBlock {
  type: 'tool_call'
  toolCall: FeishuToolCall
}

// 工具结果内容块
export interface FeishuToolResultBlock extends FeishuBaseContentBlock {
  type: 'tool_result'
  toolCallId: string
  result: unknown
  error?: string
}

// 思考过程内容块
export interface FeishuThinkingBlock extends FeishuBaseContentBlock {
  type: 'thinking'
  content: string
}

// 联合内容块类型
export type FeishuContentBlock = FeishuTextBlock | FeishuToolCallBlock | FeishuToolResultBlock | FeishuThinkingBlock

// 图片内容
export interface FeishuImageContent {
  type: 'image'
  data: string
  mimeType: string
  name?: string
}

// 消息内容部分
export type FeishuMessageContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

// 工具调用
export interface FeishuToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  timestamp: number
  duration?: number
  result?: unknown
  error?: string
}

// 飞书消息
export interface FeishuMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | FeishuMessageContentPart[]
  timestamp: number
  isStreaming?: boolean
  mode?: AgentMode
  blocks?: FeishuContentBlock[]
  toolCalls?: FeishuToolCall[]
  reasoning?: string
  isReasoningCollapsed?: boolean
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  images?: FeishuImageContent[]
  tool_call_id?: string
  tool_calls?: any[]
  name?: string
}

// 飞书会话
export interface FeishuSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  mode: AgentMode
}

// 飞书状态
interface FeishuState {
  // 当前会话
  currentSession: string | null
  sessions: FeishuSession[]
  
  // 消息
  messages: FeishuMessage[]
  
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
  setSessions: (sessions: FeishuSession[]) => void
  addSession: (session: FeishuSession) => void
  updateSession: (id: string, updates: Partial<FeishuSession>) => void
  deleteSession: (id: string) => void
  clearAllSessions: () => void
  
  addMessage: (message: FeishuMessage) => void
  updateMessage: (id: string, updates: Partial<FeishuMessage>) => void
  deleteMessage: (id: string) => void
  setMessages: (messages: FeishuMessage[]) => void
  clearMessages: () => void
  
  setCurrentMode: (mode: AgentMode) => void
  
  setInput: (input: string) => void
  setIsGenerating: (isGenerating: boolean) => void
  
  startStreaming: (messageId: string) => void
  stopStreaming: () => void
  
  // 错误处理
  setError: (error: string | null, errorType?: 'model' | 'network' | 'api' | 'unknown') => void
  clearError: () => void
  
  // 工具调用
  addToolCall: (messageId: string, toolCall: FeishuToolCall) => void
  updateToolCall: (messageId: string, toolCallId: string, updates: Partial<FeishuToolCall>) => void
  
  // 内容块操作
  addContentBlock: (messageId: string, block: FeishuContentBlock) => void
  updateContentBlock: (messageId: string, blockId: string, updates: Partial<FeishuContentBlock>) => void
  appendTextToLastBlock: (messageId: string, text: string) => void
}

export const useFeishuStore = create<FeishuState>((set, get) => ({
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
  
  setSessions: (sessions) => set({ sessions }),
  
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
    currentSession: session.id
  })),
  
  updateSession: (id, updates) => set((state) => ({
    sessions: state.sessions.map(s => 
      s.id === id ? { ...s, ...updates, updatedAt: updates.updatedAt !== undefined ? updates.updatedAt : s.updatedAt } : s
    )
  })),
  
  deleteSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
    currentSession: state.currentSession === id ? null : state.currentSession
  })),
  
  clearAllSessions: () => set({ sessions: [], currentSession: null }),
  
  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message]
    }))
  },
  
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === id ? { ...m, ...updates } as FeishuMessage : m
    )
  })),
  
  deleteMessage: (id) => set((state) => ({
    messages: state.messages.filter(m => m.id !== id)
  })),
  
  setMessages: (messages) => set({ messages }),
  
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
  
  setError: (error, errorType = 'unknown') => set({ 
    error,
    errorType: error ? errorType : null
  }),
  
  clearError: () => set({ error: null, errorType: null }),
  
  addToolCall: (messageId, toolCall) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === messageId 
        ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
        : m
    )
  })),
  
  updateToolCall: (messageId, toolCallId, updates) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === messageId && m.toolCalls
        ? {
            ...m,
            toolCalls: m.toolCalls.map(tc => 
              tc.id === toolCallId ? { ...tc, ...updates } : tc
            )
          }
        : m
    )
  })),
  
  addContentBlock: (messageId, block) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === messageId 
        ? { ...m, blocks: [...(m.blocks || []), block] }
        : m
    )
  })),
  
  updateContentBlock: (messageId, blockId, updates) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === messageId && m.blocks
        ? {
            ...m,
            blocks: m.blocks.map(b => 
              b.id === blockId ? { ...b, ...updates } : b
            ) as FeishuContentBlock[]
          }
        : m
    )
  })),
  
  appendTextToLastBlock: (messageId, text) => set((state) => {
    const message = state.messages.find(m => m.id === messageId)
    if (!message) return state
    
    // 如果没有 blocks，创建一个
    if (!message.blocks || message.blocks.length === 0) {
      return {
        messages: state.messages.map(m => 
          m.id === messageId 
            ? {
                ...m,
                blocks: [{
                  id: `text-${Date.now()}`,
                  type: 'text',
                  content: text,
                  timestamp: Date.now()
                } as FeishuTextBlock]
              }
            : m
        )
      }
    }
    
    const lastBlock = message.blocks[message.blocks.length - 1]
    
    // 如果最后一个 block 是 text 类型，追加内容
    if (lastBlock.type === 'text') {
      return {
        messages: state.messages.map(m => 
          m.id === messageId 
            ? {
                ...m,
                blocks: m.blocks?.map((b, idx) => 
                  idx === m.blocks!.length - 1 && b.type === 'text'
                    ? { ...b, content: (b as FeishuTextBlock).content + text }
                    : b
                ) as FeishuContentBlock[]
              }
            : m
        )
      }
    }
    
    // 如果最后一个 block 不是 text 类型（如 tool_call），追加一个新的 text block
    return {
      messages: state.messages.map(m => 
        m.id === messageId 
          ? {
              ...m,
              blocks: [...(m.blocks || []), {
                id: `text-${Date.now()}`,
                type: 'text',
                content: text,
                timestamp: Date.now()
              } as FeishuTextBlock]
            }
          : m
      )
    }
  }),
}))
