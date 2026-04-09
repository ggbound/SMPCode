/**
 * 运行时引擎
 * 处理 CLI 会话、路由和回合管理
 */

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { commandRegistry, CommandContext, CommandResult } from './command-registry'
import { toolRegistry, ToolContext, ToolResult, PermissionDenial } from './tool-registry'

export interface RuntimeSession {
  id: string
  prompt: string
  cwd: string
  createdAt: Date
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  commandResults: CommandResult[]
  toolResults: ToolResult[]
  permissionDenials: PermissionDenial[]
  inputTokens: number
  outputTokens: number
  stopReason?: string
}

export interface RuntimeConfig {
  maxTurns: number
  maxBudgetTokens: number
  permissionMode: 'strict' | 'moderate' | 'permissive'
  compactAfterTurns: number
}

export interface TurnResult {
  prompt: string
  output: string
  matchedCommands: string[]
  matchedTools: string[]
  permissionDenials: PermissionDenial[]
  inputTokens: number
  outputTokens: number
  stopReason: string
}

export interface RoutedMatch {
  kind: 'command' | 'tool'
  name: string
  sourceHint: string
  score: number
}

class RuntimeEngine {
  private sessions: Map<string, RuntimeSession> = new Map()
  private config: RuntimeConfig

  constructor(config: Partial<RuntimeConfig> = {}) {
    this.config = {
      maxTurns: 8,
      maxBudgetTokens: 2000,
      permissionMode: 'moderate',
      compactAfterTurns: 12,
      ...config
    }
  }

  /**
   * 创建新会话
   */
  createSession(prompt: string, cwd: string): RuntimeSession {
    const session: RuntimeSession = {
      id: uuidv4(),
      prompt,
      cwd,
      createdAt: new Date(),
      messages: [],
      commandResults: [],
      toolResults: [],
      permissionDenials: [],
      inputTokens: 0,
      outputTokens: 0
    }
    this.sessions.set(session.id, session)
    log.info(`[RuntimeEngine] Created session: ${session.id}`)
    return session
  }

  /**
   * 获取会话
   */
  getSession(id: string): RuntimeSession | undefined {
    return this.sessions.get(id)
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): RuntimeSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * 路由提示到匹配的命令和工具
   */
  routePrompt(prompt: string, limit: number = 5): RoutedMatch[] {
    const commandMatches = commandRegistry.routePrompt(prompt, limit)
    const toolMatches = toolRegistry.routePrompt(prompt, limit)

    // 合并并按分数排序
    const allMatches: RoutedMatch[] = [
      ...commandMatches.map(m => ({ ...m, kind: 'command' as const })),
      ...toolMatches.map(m => ({ ...m, kind: 'tool' as const }))
    ]

    return allMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 执行单个回合
   */
  async executeTurn(sessionId: string, prompt: string): Promise<TurnResult> {
    const session = this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // 检查最大回合数
    if (session.messages.length >= this.config.maxTurns) {
      return {
        prompt,
        output: `Max turns (${this.config.maxTurns}) reached`,
        matchedCommands: [],
        matchedTools: [],
        permissionDenials: [],
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        stopReason: 'max_turns_reached'
      }
    }

    // 路由提示
    const matches = this.routePrompt(prompt, 5)
    const commandNames = matches.filter(m => m.kind === 'command').map(m => m.name)
    const toolNames = matches.filter(m => m.kind === 'tool').map(m => m.name)

    // 执行匹配的命令
    const commandContext: CommandContext = {
      cwd: session.cwd,
      sessionId: session.id,
      config: {}
    }

    for (const name of commandNames) {
      const result = await commandRegistry.execute(name, prompt, commandContext)
      session.commandResults.push(result)
    }

    // 执行匹配的工具（简化版，实际应该解析参数）
    const toolContext: ToolContext = {
      cwd: session.cwd,
      sessionId: session.id,
      permissionMode: this.config.permissionMode
    }

    const permissionDenials: PermissionDenial[] = []
    for (const name of toolNames) {
      const permission = toolRegistry.isAllowed(name)
      if (!permission.allowed) {
        permissionDenials.push({ toolName: name, reason: permission.reason! })
        continue
      }

      // 这里简化处理，实际应该解析参数
      const result = await toolRegistry.execute(name, {}, toolContext)
      session.toolResults.push(result)
    }

    session.permissionDenials.push(...permissionDenials)

    // 构建输出
    const outputLines: string[] = [
      `Prompt: ${prompt}`,
      `Matched commands: ${commandNames.join(', ') || 'none'}`,
      `Matched tools: ${toolNames.join(', ') || 'none'}`,
      `Permission denials: ${permissionDenials.length}`
    ]

    // 添加命令执行结果
    for (const result of session.commandResults.slice(-commandNames.length)) {
      if (result.handled) {
        outputLines.push(`[Command] ${result.message}`)
      }
    }

    // 添加工具执行结果
    for (const result of session.toolResults.slice(-toolNames.length)) {
      outputLines.push(`[Tool] ${result.success ? 'Success' : 'Failed'}: ${result.output || result.error}`)
    }

    const output = outputLines.join('\n')

    // 更新会话
    session.messages.push({ role: 'user', content: prompt })
    session.messages.push({ role: 'assistant', content: output })
    session.inputTokens += prompt.length / 4
    session.outputTokens += output.length / 4

    // 检查预算
    const totalTokens = session.inputTokens + session.outputTokens
    const stopReason = totalTokens > this.config.maxBudgetTokens ? 'max_budget_reached' : 'completed'
    session.stopReason = stopReason

    // 压缩消息历史
    this.compactSessionIfNeeded(session)

    return {
      prompt,
      output,
      matchedCommands: commandNames,
      matchedTools: toolNames,
      permissionDenials,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      stopReason
    }
  }

  /**
   * 运行多回合循环
   */
  async runTurnLoop(prompt: string, cwd: string, maxTurns?: number): Promise<TurnResult[]> {
    const session = this.createSession(prompt, cwd)
    const results: TurnResult[] = []
    const turns = maxTurns || this.config.maxTurns

    for (let i = 0; i < turns; i++) {
      const turnPrompt = i === 0 ? prompt : `${prompt} [turn ${i + 1}]`
      const result = await this.executeTurn(session.id, turnPrompt)
      results.push(result)

      if (result.stopReason !== 'completed') {
        break
      }
    }

    return results
  }

  /**
   * 压缩会话消息历史
   */
  private compactSessionIfNeeded(session: RuntimeSession): void {
    if (session.messages.length > this.config.compactAfterTurns) {
      // 保留系统消息和最近的消息
      const systemMessages = session.messages.filter(m => m.role === 'system')
      const recentMessages = session.messages.slice(-this.config.compactAfterTurns)
      session.messages = [...systemMessages, ...recentMessages]
      log.info(`[RuntimeEngine] Compacted session ${session.id}`)
    }
  }

  /**
   * 渲染会话摘要
   */
  renderSessionSummary(sessionId: string): string {
    const session = this.getSession(sessionId)
    if (!session) {
      return `Session not found: ${sessionId}`
    }

    const lines: string[] = [
      '# Runtime Session',
      '',
      `Session ID: ${session.id}`,
      `Prompt: ${session.prompt}`,
      `Working Directory: ${session.cwd}`,
      `Created At: ${session.createdAt.toISOString()}`,
      '',
      '## Statistics',
      `- Messages: ${session.messages.length}`,
      `- Command Executions: ${session.commandResults.length}`,
      `- Tool Executions: ${session.toolResults.length}`,
      `- Permission Denials: ${session.permissionDenials.length}`,
      `- Input Tokens: ${session.inputTokens}`,
      `- Output Tokens: ${session.outputTokens}`,
      `- Stop Reason: ${session.stopReason || 'N/A'}`,
      ''
    ]

    if (session.permissionDenials.length > 0) {
      lines.push('## Permission Denials')
      for (const denial of session.permissionDenials) {
        lines.push(`- ${denial.toolName}: ${denial.reason}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * 删除会话
   */
  deleteSession(id: string): boolean {
    const deleted = this.sessions.delete(id)
    if (deleted) {
      log.info(`[RuntimeEngine] Deleted session: ${id}`)
    }
    return deleted
  }

  /**
   * 清理所有会话
   */
  cleanup(): void {
    this.sessions.clear()
    log.info('[RuntimeEngine] Cleaned up all sessions')
  }
}

// 导出运行时引擎实例
export const runtimeEngine = new RuntimeEngine()

// 导出便捷函数
export function createSession(prompt: string, cwd: string): RuntimeSession {
  return runtimeEngine.createSession(prompt, cwd)
}

export function getSession(id: string): RuntimeSession | undefined {
  return runtimeEngine.getSession(id)
}

export function executeTurn(sessionId: string, prompt: string): Promise<TurnResult> {
  return runtimeEngine.executeTurn(sessionId, prompt)
}

export function runTurnLoop(prompt: string, cwd: string, maxTurns?: number): Promise<TurnResult[]> {
  return runtimeEngine.runTurnLoop(prompt, cwd, maxTurns)
}
