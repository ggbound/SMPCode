import { create } from 'zustand'

export interface Session {
  id: string
  createdAt: string
  messageCount: number
  projectPath?: string // 关联的项目文件夹路径
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  needsAction?: 'continue' // 标记消息需要用户操作（如继续执行）
}

export interface Command {
  name: string
  responsibility: string
  source_hint: string
}

export interface Tool {
  name: string
  responsibility: string
  source_hint: string
}

export interface RouteMatch {
  kind: 'command' | 'tool'
  name: string
  score: number
  source_hint: string
}

export interface ModelConfig {
  id: string
  name: string
  group?: string
}

export interface ProviderConfig {
  id: string
  name: string
  type: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  apiUrl: string
  enabled: boolean
  models: ModelConfig[]
}

interface AppState {
  apiKey: string
  model: string
  defaultModel: string
  permissionMode: string
  sessions: Session[]
  currentSession: string | null
  messages: Message[]
  inputTokens: number
  outputTokens: number
  
  // New: commands and tools
  commands: Command[]
  tools: Tool[]
  routeMatches: RouteMatch[]
  
  // Model providers configuration
  providers: ProviderConfig[]
  
  setApiKey: (apiKey: string) => void
  setModel: (model: string) => void
  setDefaultModel: (model: string) => void
  setPermissionMode: (mode: string) => void
  setProviders: (providers: ProviderConfig[]) => void
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  selectSession: (id: string) => void
  addMessage: (message: Message) => void
  clearMessages: () => void
  setMessages: (messages: Message[]) => void
  clearMessageActions: () => void
  updateTokens: (input: number, output: number) => void
  setCommands: (commands: Command[]) => void
  setTools: (tools: Tool[]) => void
  setRouteMatches: (matches: RouteMatch[]) => void
}

export const useStore = create<AppState>((set) => ({
  apiKey: '',
  model: '',
  defaultModel: '',
  permissionMode: 'workspace-write',
  sessions: [],
  currentSession: null,
  messages: [],
  inputTokens: 0,
  outputTokens: 0,

  // New: commands and tools
  commands: [],
  tools: [],
  routeMatches: [],

  // Model providers configuration - empty by default, user must configure
  providers: [],

  setApiKey: (apiKey) => set({ apiKey }),
  setModel: (model) => set({ model }),
  setDefaultModel: (defaultModel) => set({ defaultModel }),
  setPermissionMode: (permissionMode) => set({ permissionMode }),
  setProviders: (providers) => set({ providers }),
  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => set((state) => ({
    sessions: [...state.sessions, session],
    currentSession: session.id
  })),

  selectSession: (currentSession) => set({ currentSession }),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, { ...message, timestamp: Date.now() }]
  })),

  clearMessages: () => set({ messages: [], inputTokens: 0, outputTokens: 0 }),

  setMessages: (messages) => set({ messages }),

  // Clear needsAction flag from all messages (used when task is completed)
  clearMessageActions: () => set((state) => ({
    messages: state.messages.map(msg => ({
      ...msg,
      needsAction: undefined
    }))
  })),

  updateTokens: (input, output) => set((state) => ({
    inputTokens: state.inputTokens + input,
    outputTokens: state.outputTokens + output
  })),
  
  setCommands: (commands) => set({ commands }),
  setTools: (tools) => set({ tools }),
  setRouteMatches: (routeMatches) => set({ routeMatches })
}))