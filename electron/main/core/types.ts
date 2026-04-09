/**
 * Core Types for Port Architecture
 * Based on claw-code/src Python implementation
 */

// ============ Base Models ============

export interface PortingModule {
  name: string
  responsibility: string
  sourceHint: string
  status: 'mirrored' | 'pending' | 'completed'
}

export interface PortingBacklog {
  title: string
  modules: PortingModule[]
}

// ============ Command Types ============

export interface CommandExecution {
  name: string
  sourceHint: string
  prompt: string
  handled: boolean
  message: string
}

// ============ Tool Types ============

export interface ToolExecution {
  name: string
  sourceHint: string
  payload: string
  handled: boolean
  message: string
}

export interface ToolPermissionContext {
  deniedTools: string[]
  deniedPrefixes: string[]
  blocks(toolName: string): boolean
}

// ============ Runtime Types ============

export interface RoutedMatch {
  kind: 'command' | 'tool'
  name: string
  sourceHint: string
  score: number
}

export interface PortContext {
  pythonFileCount: number
  archiveAvailable: boolean
  cwd: string
}

export interface WorkspaceSetup {
  pythonVersion: string
  implementation: string
  platformName: string
  testCommand: string
}

export interface SetupReport {
  setup: WorkspaceSetup
  startupSteps: string[]
}

export interface HistoryEntry {
  type: string
  message: string
  timestamp: number
}

export interface HistoryLog {
  entries: HistoryEntry[]
  add(type: string, message: string): void
  asMarkdown(): string
}

// ============ Query Engine Types ============

export interface QueryEngineConfig {
  maxTurns: number
  maxBudgetTokens: number
  compactAfterTurns: number
  structuredOutput: boolean
  structuredRetryLimit: number
}

export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  addTurn(prompt: string, output: string): UsageSummary
}

export interface PermissionDenial {
  toolName: string
  reason: string
}

export interface TurnResult {
  prompt: string
  output: string
  matchedCommands: string[]
  matchedTools: string[]
  permissionDenials: PermissionDenial[]
  usage: UsageSummary
  stopReason: 'completed' | 'max_turns_reached' | 'max_budget_reached' | 'error'
}

export interface RuntimeSession {
  prompt: string
  context: PortContext
  setup: WorkspaceSetup
  setupReport: SetupReport
  systemInitMessage: string
  history: HistoryLog
  routedMatches: RoutedMatch[]
  turnResult: TurnResult
  commandExecutionMessages: string[]
  toolExecutionMessages: string[]
  streamEvents: Record<string, unknown>[]
  persistedSessionPath: string
  asMarkdown(): string
}

// ============ Session Store Types ============

export interface StoredSession {
  sessionId: string
  messages: string[]
  inputTokens: number
  outputTokens: number
  createdAt: number
  updatedAt: number
}

// ============ Transcript Types ============

export interface TranscriptStore {
  entries: string[]
  flushed: boolean
  append(entry: string): void
  compact(limit: number): void
  replay(): string[]
  flush(): void
}

// ============ Port Manifest Types ============

export interface PortManifest {
  topLevelModules: Array<{
    name: string
    fileCount: number
    notes: string
  }>
  toMarkdown(): string
}

// ============ Stream Event Types ============

export type StreamEvent =
  | { type: 'message_start'; sessionId: string; prompt: string }
  | { type: 'command_match'; commands: string[] }
  | { type: 'tool_match'; tools: string[] }
  | { type: 'permission_denial'; denials: string[] }
  | { type: 'message_delta'; text: string }
  | { type: 'message_stop'; usage: { inputTokens: number; outputTokens: number }; stopReason: string; transcriptSize: number }
  | { type: 'tool_call'; tool: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: { success: boolean; output: string; error?: string } }

// ============ API Types ============

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  model?: string
  stream?: boolean
  sessionId?: string
}

export interface ChatResponse {
  content: string
  toolCalls?: Array<{ tool: string; arguments: Record<string, unknown> }>
  usage?: { inputTokens: number; outputTokens: number }
  sessionId?: string
}

// ============ Execution Registry Types ============

export interface CommandExecutor {
  name: string
  execute(prompt: string): string
}

export interface ToolExecutor {
  name: string
  execute(payload: string): string
}

export interface ExecutionRegistry {
  commands: Map<string, CommandExecutor>
  tools: Map<string, ToolExecutor>
  registerCommand(executor: CommandExecutor): void
  registerTool(executor: ToolExecutor): void
  getCommand(name: string): CommandExecutor | undefined
  getTool(name: string): ToolExecutor | undefined
}
