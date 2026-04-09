/**
 * 命令注册表
 * 管理 CLI 命令的注册、查询和执行
 */

import log from 'electron-log'

export interface CommandDefinition {
  name: string
  description: string
  sourceHint: string
  responsibility: string
  execute: (prompt: string, context: CommandContext) => Promise<CommandResult>
}

export interface CommandContext {
  cwd: string
  sessionId?: string
  config: Record<string, unknown>
}

export interface CommandResult {
  success: boolean
  message: string
  handled: boolean
  data?: unknown
}

class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map()

  /**
   * 注册命令
   */
  register(command: CommandDefinition): void {
    this.commands.set(command.name.toLowerCase(), command)
    log.info(`[CommandRegistry] Registered command: ${command.name}`)
  }

  /**
   * 注销命令
   */
  unregister(name: string): void {
    this.commands.delete(name.toLowerCase())
    log.info(`[CommandRegistry] Unregistered command: ${name}`)
  }

  /**
   * 获取命令
   */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase())
  }

  /**
   * 获取所有命令
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values())
  }

  /**
   * 检查命令是否存在
   */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  /**
   * 搜索命令
   */
  search(query: string, limit: number = 20): CommandDefinition[] {
    const needle = query.toLowerCase()
    const matches = this.getAll().filter(
      cmd =>
        cmd.name.toLowerCase().includes(needle) ||
        cmd.sourceHint.toLowerCase().includes(needle) ||
        cmd.responsibility.toLowerCase().includes(needle)
    )
    return matches.slice(0, limit)
  }

  /**
   * 路由提示到匹配的命令
   */
  routePrompt(prompt: string, limit: number = 5): Array<{ kind: string; name: string; score: number; sourceHint: string }> {
    const tokens = new Set(
      prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0)
    )

    const matches: Array<{ kind: string; name: string; score: number; sourceHint: string }> = []

    for (const cmd of this.getAll()) {
      const haystacks = [cmd.name.toLowerCase(), cmd.sourceHint.toLowerCase(), cmd.responsibility.toLowerCase()]
      let score = 0
      for (const token of Array.from(tokens)) {
        if (haystacks.some(h => h.includes(token))) {
          score += 1
        }
      }
      if (score > 0) {
        matches.push({ kind: 'command', name: cmd.name, score, sourceHint: cmd.sourceHint })
      }
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 执行命令
   */
  async execute(name: string, prompt: string, context: CommandContext): Promise<CommandResult> {
    const command = this.get(name)
    if (!command) {
      return {
        success: false,
        handled: false,
        message: `Unknown command: ${name}`
      }
    }

    try {
      return await command.execute(prompt, context)
    } catch (error) {
      log.error(`[CommandRegistry] Error executing command ${name}:`, error)
      return {
        success: false,
        handled: true,
        message: `Error executing command ${name}: ${String(error)}`
      }
    }
  }
}

// 全局命令注册表实例
export const commandRegistry = new CommandRegistry()

// 导出便捷函数
export function registerCommand(command: CommandDefinition): void {
  commandRegistry.register(command)
}

export function getCommand(name: string): CommandDefinition | undefined {
  return commandRegistry.get(name)
}

export function getAllCommands(): CommandDefinition[] {
  return commandRegistry.getAll()
}

export function executeCommand(name: string, prompt: string, context: CommandContext): Promise<CommandResult> {
  return commandRegistry.execute(name, prompt, context)
}
