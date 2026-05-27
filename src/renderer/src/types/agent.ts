/**
 * Kilo Code 风格 Agent 模式系统
 * 参考: https://kilocode.ai
 * 
 * 设计理念:
 * - 多模式 Agent: Code/Architect/Debug/Ask/Custom
 * - 每个模式有专门的系统提示词和工具集
 * - 简洁高效的交互方式
 */

// Agent 模式类型
export type AgentMode = 'code' | 'architect' | 'debug' | 'ask' | 'custom'

// Agent 模式配置
export interface AgentModeConfig {
  id: AgentMode
  name: string
  description: string
  icon: string
  color: string
  gradient: string
  systemPrompt: string
  allowedTools: string[]
  features: AgentFeature[]
}

// Agent 功能特性
export type AgentFeature = 
  | 'code_edit'      // 代码编辑
  | 'file_read'      // 文件读取
  | 'file_write'     // 文件写入
  | 'search'         // 搜索
  | 'terminal'       // 终端命令
  | 'browser'        // 浏览器操作
  | 'mcp'            // MCP 工具
  | 'planning'       // 规划能力
  | 'debugging'      // 调试能力

// Agent 状态
export interface AgentState {
  mode: AgentMode
  isActive: boolean
  context: AgentContext
  memory: AgentMemory
}

// Agent 上下文
export interface AgentContext {
  currentFile?: string
  currentProject?: string
  selectedCode?: string
  recentFiles: string[]
  recentCommands: string[]
}

// Agent 记忆
export interface AgentMemory {
  preferences: Record<string, unknown>
  patterns: string[]
  lastActions: AgentAction[]
}

// Agent 动作
export interface AgentAction {
  type: 'tool_call' | 'file_edit' | 'command' | 'response'
  timestamp: number
  description: string
  result?: unknown
}

// 工具调用状态
export type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// Kilo 风格工具调用
export interface KiloToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: ToolStatus
  timestamp: number
  duration?: number
  result?: unknown
  error?: string
}

// 消息块类型（流式响应）
export type MessageBlockType = 
  | 'text'           // 普通文本
  | 'thinking'       // 思考过程
  | 'tool_call'      // 工具调用
  | 'tool_result'    // 工具结果
  | 'code'           // 代码块
  | 'file_tree'      // 文件树
  | 'diff'           // 代码差异

// 消息块
export interface MessageBlock {
  id: string
  type: MessageBlockType
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}

// Kilo 风格消息
export interface KiloMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  blocks: MessageBlock[]
  toolCalls: KiloToolCall[]
  timestamp: number
  isStreaming: boolean
  mode: AgentMode
}

// 流式响应块
export interface StreamBlock {
  type: 'content' | 'tool_call' | 'tool_result' | 'done' | 'error'
  data: unknown
  timestamp: number
}

// Agent 模式配置映射
export const AGENT_MODE_CONFIGS: Record<AgentMode, AgentModeConfig> = {
  code: {
    id: 'code',
    name: 'Code',
    description: '编写、重构和交付生产级代码',
    icon: 'Code2',
    color: '#3b82f6',
    gradient: 'from-blue-500 to-cyan-500',
    systemPrompt: `你是一个专业的代码助手。专注于编写高质量、可维护的代码。
你可以读取文件、搜索代码、编辑文件和执行命令。
始终遵循最佳实践，编写清晰的代码和注释。`,
    allowedTools: ['read_file', 'write_to_file', 'apply_diff', 'search_files', 'execute_command'],
    features: ['code_edit', 'file_read', 'file_write', 'search', 'terminal']
  },
  architect: {
    id: 'architect',
    name: 'Architect',
    description: '规划复杂功能，在写代码前提供结构化指导',
    icon: 'Compass',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-pink-500',
    systemPrompt: `你是一个软件架构师。专注于系统设计、技术选型和架构规划。
在写代码前，先分析需求、设计架构、规划实现步骤。
提供清晰的设计文档和实现路线图。`,
    allowedTools: ['read_file', 'search_files', 'list_files'],
    features: ['file_read', 'search', 'planning']
  },
  debug: {
    id: 'debug',
    name: 'Debug',
    description: '快速识别和修复 Bug',
    icon: 'Bug',
    color: '#ef4444',
    gradient: 'from-red-500 to-orange-500',
    systemPrompt: `你是一个调试专家。专注于识别、分析和修复代码中的 Bug。
仔细阅读错误信息，追踪问题根源，提供修复方案。
解释问题原因和修复思路。`,
    allowedTools: ['read_file', 'search_files', 'execute_command', 'apply_diff'],
    features: ['file_read', 'search', 'terminal', 'debugging']
  },
  ask: {
    id: 'ask',
    name: 'Ask',
    description: '回答关于代码库的问题',
    icon: 'MessageCircle',
    color: '#10b981',
    gradient: 'from-green-500 to-emerald-500',
    systemPrompt: `你是一个代码知识助手。回答用户关于代码库的问题。
可以搜索代码、读取文件来提供准确的答案。
保持回答简洁、准确、有帮助。`,
    allowedTools: ['read_file', 'search_files', 'list_files'],
    features: ['file_read', 'search']
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    description: '自定义 Agent 模式',
    icon: 'Settings',
    color: '#6b7280',
    gradient: 'from-gray-500 to-slate-500',
    systemPrompt: '自定义模式，根据用户需求配置。',
    allowedTools: [],
    features: []
  }
}

// 工具配置 - Kilo 风格
export const TOOL_CONFIG: Record<string, {
  label: string
  icon: string
  color: string
  bgColor: string
  borderColor: string
  description: string
}> = {
  // 文件读取相关
  read_file: {
    label: '读取文件',
    icon: 'FileText',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    description: '读取文件内容'
  },
  file_read: {
    label: '读取文件',
    icon: 'FileText',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    description: '读取文件内容'
  },
  // 文件写入相关
  write_to_file: {
    label: '写入文件',
    icon: 'FileEdit',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    description: '创建或覆盖文件'
  },
  file_write: {
    label: '写入文件',
    icon: 'FileEdit',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    description: '创建或覆盖文件'
  },
  apply_diff: {
    label: '应用修改',
    icon: 'GitPullRequest',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
    borderColor: 'rgba(139, 92, 246, 0.3)',
    description: '应用代码差异'
  },
  search_files: {
    label: '搜索文件',
    icon: 'Search',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    description: '搜索代码和文件'
  },
  list_files: {
    label: '列出文件',
    icon: 'FolderTree',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
    description: '列出目录内容'
  },
  list_directory: {
    label: '列出目录',
    icon: 'FolderTree',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
    description: '列出目录内容'
  },
  execute_command: {
    label: '执行命令',
    icon: 'Terminal',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    description: '执行终端命令'
  },
  browser_action: {
    label: '浏览器操作',
    icon: 'Globe',
    color: '#ec4899',
    bgColor: 'rgba(236, 72, 153, 0.1)',
    borderColor: 'rgba(236, 72, 153, 0.3)',
    description: '浏览器自动化'
  },
  ask_followup_question: {
    label: '追问',
    icon: 'HelpCircle',
    color: '#6366f1',
    bgColor: 'rgba(99, 102, 241, 0.1)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    description: '向用户提问'
  },
  attempt_completion: {
    label: '完成任务',
    icon: 'CheckCircle',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
    description: '标记任务完成'
  }
}
