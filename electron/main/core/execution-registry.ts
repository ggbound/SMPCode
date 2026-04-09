/**
 * Execution Registry - Based on claw-code/src/execution_registry.py
 */

import { CommandExecutor, ToolExecutor } from './types'

export class ExecutionRegistry {
  commands: Map<string, CommandExecutor> = new Map()
  tools: Map<string, ToolExecutor> = new Map()

  registerCommand(executor: CommandExecutor): void {
    this.commands.set(executor.name.toLowerCase(), executor)
  }

  registerTool(executor: ToolExecutor): void {
    this.tools.set(executor.name.toLowerCase(), executor)
  }

  getCommand(name: string): CommandExecutor | undefined {
    return this.commands.get(name.toLowerCase())
  }

  getTool(name: string): ToolExecutor | undefined {
    return this.tools.get(name.toLowerCase())
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  hasTool(name: string): boolean {
    return this.tools.has(name.toLowerCase())
  }

  unregisterCommand(name: string): boolean {
    return this.commands.delete(name.toLowerCase())
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name.toLowerCase())
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys())
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  clear(): void {
    this.commands.clear()
    this.tools.clear()
  }
}

// Singleton instance
let globalRegistry: ExecutionRegistry | null = null

export function buildExecutionRegistry(): ExecutionRegistry {
  if (!globalRegistry) {
    globalRegistry = new ExecutionRegistry()
  }
  return globalRegistry
}

export function resetExecutionRegistry(): ExecutionRegistry {
  globalRegistry = new ExecutionRegistry()
  return globalRegistry
}

// Create a simple command executor
export function createCommandExecutor(
  name: string,
  executeFn: (prompt: string) => string
): CommandExecutor {
  return {
    name,
    execute: executeFn
  }
}

// Create a simple tool executor
export function createToolExecutor(
  name: string,
  executeFn: (payload: string) => string
): ToolExecutor {
  return {
    name,
    execute: executeFn
  }
}
