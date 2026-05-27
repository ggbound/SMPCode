/**
 * 对话核心类型定义
 * 参考 claw-code 架构设计
 */

export enum MessageRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool'
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  toolUse?: {
    id: string
    name: string
    input: string
  }
  toolResult?: {
    toolUseId: string
    toolName: string
    output: string
    isError: boolean
  }
}

export interface ConversationMessage {
  role: MessageRole
  content: string
  blocks?: ContentBlock[]
  toolCallId?: string
  toolName?: string
  timestamp?: number
}

export interface Session {
  id: string
  messages: ConversationMessage[]
  cwd: string
  mode: 'chat' | 'agent'
  createdAt: number
  updatedAt: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  output: string
  isError: boolean
}

export enum AssistantEventType {
  TextDelta = 'text_delta',
  ToolUse = 'tool_use',
  ToolResult = 'tool_result',
  Usage = 'usage',
  MessageStop = 'message_stop',
  Error = 'error'
}

export interface AssistantEvent {
  type: AssistantEventType
  textDelta?: string
  toolUse?: ToolCall
  toolResult?: ToolResult
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  error?: string
}

export interface TurnResult {
  messages: ConversationMessage[]
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
  stopReason: 'completed' | 'max_iterations' | 'error' | 'user_abort'
}

export interface ConversationConfig {
  maxIterations: number
  maxContextMessages: number
  systemPrompt: string
}
