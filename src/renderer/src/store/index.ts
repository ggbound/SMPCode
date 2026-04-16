import { create } from 'zustand'

export interface Session {
  id: string
  createdAt: string
  messageCount: number
  projectPath?: string // 关联的项目文件夹路径
  title?: string // 会话标题
}

// TRAE风格：思考步骤
export interface Step {
  id: string
  title: string
  content?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  duration?: number
  // 新增：步骤编号和总数
  stepNumber?: number
  totalSteps?: number
  // 新增：操作类型描述
  action?: string
  // 新增：工具调用详情
  toolName?: string
  toolArgs?: Record<string, any>
}

// TRAE风格：工具调用
export interface ToolCall {
  id: string
  name: string
  args: Record<string, any>
  result?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  duration?: number
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  needsAction?: 'continue' // 标记消息需要用户操作（如继续执行）
  steps?: Step[]           // TRAE风格：思考步骤
  toolCalls?: ToolCall[]   // TRAE风格：工具调用链
  isStreaming?: boolean    // 是否流式输出中
  isBuilder?: boolean      // TRAE Builder模式消息
  thinkingSteps?: Array<{   // Builder模式思考步骤
    type: 'search' | 'analysis' | 'code' | 'command' | 'result'
    title: string
    content?: string
    filePath?: string
    language?: string
    status?: 'pending' | 'running' | 'completed' | 'failed'
  }>
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
  currentProjectPath: string | null // 当前打开的项目路径
  
  // New: commands and tools
  commands: Command[]
  tools: Tool[]
  routeMatches: RouteMatch[]
  
  // Model providers configuration
  providers: ProviderConfig[]
  
  // TRAE风格：流式消息状态
  streamingMessageId: string | null
  
  // Chat mode: 'agent' for tool-enabled chat, 'chat' for simple Q&A
  chatMode: 'agent' | 'chat'
  
  setApiKey: (apiKey: string) => void
  setModel: (model: string) => void
  setDefaultModel: (model: string) => void
  setPermissionMode: (mode: string) => void
  setProviders: (providers: ProviderConfig[]) => void
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  selectSession: (id: string) => void
  updateSessionTitle: (id: string, title: string) => void
  deleteSession: (id: string) => void
  addMessage: (message: Message) => void
  updateMessage: (index: number, message: Partial<Message>) => void
  clearMessages: () => void
  setMessages: (messages: Message[]) => void
  clearMessageActions: () => void
  updateTokens: (input: number, output: number) => void
  setCommands: (commands: Command[]) => void
  setTools: (tools: Tool[]) => void
  setRouteMatches: (matches: RouteMatch[]) => void
  setCurrentProjectPath: (path: string | null) => void
  setChatMode: (mode: 'agent' | 'chat') => void
  
  // TRAE风格：步骤和工具调用管理
  addStepToMessage: (messageIndex: number, step: Step) => void
  updateStepStatus: (messageIndex: number, stepId: string, status: Step['status']) => void
  addToolCallToMessage: (messageIndex: number, toolCall: ToolCall) => void
  updateToolCallStatus: (messageIndex: number, toolCallId: string, status: ToolCall['status']) => void
  
  // TRAE风格：流式消息控制
  startStreaming: (messageId: string) => void
  stopStreaming: () => void
  
  // 添加迭代消息（用于显示执行进度）
  addIterationMessage: (content: string, needsAction?: boolean) => void
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
  currentProjectPath: null,

  // New: commands and tools
  commands: [],
  tools: [],
  routeMatches: [],

  // Model providers configuration - empty by default, user must configure
  providers: [],
  
  // TRAE风格：流式消息状态
  streamingMessageId: null,
  
  // Chat mode: default to 'chat' for simple Q&A
  chatMode: 'chat',

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
  
  updateSessionTitle: (id, title) => set((state) => ({
    sessions: state.sessions.map(s => s.id === id ? { ...s, title } : s)
  })),
  
  deleteSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
    currentSession: state.currentSession === id ? null : state.currentSession
  })),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, { ...message, timestamp: Date.now() }]
  })),
  
  updateMessage: (index, message) => set((state) => ({
    messages: state.messages.map((msg, i) => i === index ? { ...msg, ...message } : msg)
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
  setRouteMatches: (routeMatches) => set({ routeMatches }),
  
  setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),
  setChatMode: (chatMode) => set({ chatMode }),
  
  // TRAE风格：步骤和工具调用管理
  addStepToMessage: (messageIndex, step) => set((state) => ({
    messages: state.messages.map((msg, i) => 
      i === messageIndex 
        ? { ...msg, steps: [...(msg.steps || []), step] }
        : msg
    )
  })),
  
  updateStepStatus: (messageIndex, stepId, status) => set((state) => ({
    messages: state.messages.map((msg, i) => 
      i === messageIndex && msg.steps
        ? { 
            ...msg, 
            steps: msg.steps.map(s => 
              s.id === stepId ? { ...s, status, duration: Date.now() - s.timestamp } : s
            )
          }
        : msg
    )
  })),
  
  addToolCallToMessage: (messageIndex, toolCall) => set((state) => ({
    messages: state.messages.map((msg, i) => 
      i === messageIndex 
        ? { ...msg, toolCalls: [...(msg.toolCalls || []), toolCall] }
        : msg
    )
  })),
  
  updateToolCallStatus: (messageIndex, toolCallId, status) => set((state) => ({
    messages: state.messages.map((msg, i) => 
      i === messageIndex && msg.toolCalls
        ? { 
            ...msg, 
            toolCalls: msg.toolCalls.map(t => 
              t.id === toolCallId ? { ...t, status, duration: Date.now() - t.timestamp } : t
            )
          }
        : msg
    )
  })),
  
  // TRAE风格：流式消息控制
  startStreaming: (streamingMessageId) => set({ streamingMessageId }),
  stopStreaming: () => set({ streamingMessageId: null }),
  
  // 添加迭代消息（用于显示执行进度）
  addIterationMessage: (content, needsAction = false) => {
    let newIndex = -1
    set((state) => {
      newIndex = state.messages.length
      return {
        messages: [...state.messages, { 
          role: 'assistant', 
          content, 
          isBuilder: true,
          timestamp: Date.now(),
          needsAction: needsAction ? 'continue' : undefined
        }]
      }
    })
    return newIndex
  }
}))