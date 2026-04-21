/**
 * Execution Registry - Based on claw-code/src/execution_registry.py
 * Provides unified access to mirrored commands and tools
 */

import {
  CommandsService,
  Command,
  CommandExecution,
  getCommandsService
} from './commands-service'
import {
  ToolsService,
  Tool,
  ToolExecution,
  getToolsService
} from './tools-service'

// ============ Mirrored Command ============

export interface MirroredCommand {
  name: string
  sourceHint: string
  execute: (prompt: string) => CommandExecution
}

export function createMirroredCommand(command: Command): MirroredCommand {
  return {
    name: command.name,
    sourceHint: command.source_hint,
    execute: (prompt: string): CommandExecution => {
      return getCommandsService().execute(command.name, prompt)
    }
  }
}

// ============ Mirrored Tool ============

export interface MirroredTool {
  name: string
  sourceHint: string
  execute: (payload: string) => ToolExecution
}

export function createMirroredTool(tool: Tool): MirroredTool {
  return {
    name: tool.name,
    sourceHint: tool.source_hint,
    execute: (payload: string): ToolExecution => {
      return getToolsService().execute(tool.name, payload)
    }
  }
}

// ============ Execution Registry ============

export interface ExecutionRegistry {
  commands: MirroredCommand[]
  tools: MirroredTool[]

  /**
   * Get command by name
   */
  getCommand(name: string): MirroredCommand | undefined

  /**
   * Get tool by name
   */
  getTool(name: string): MirroredTool | undefined

  /**
   * Check if command exists
   */
  hasCommand(name: string): boolean

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean
}

class ExecutionRegistryImpl implements ExecutionRegistry {
  private _commands: Map<string, MirroredCommand> = new Map()
  private _tools: Map<string, MirroredTool> = new Map()

  constructor() {
    this.buildRegistry()
  }

  private buildRegistry(): void {
    // Build command registry
    const commands = getCommandsService().getAll()
    for (const cmd of commands) {
      const mirrored = createMirroredCommand(cmd)
      this._commands.set(cmd.name.toLowerCase(), mirrored)
    }

    // Build tool registry
    const tools = getToolsService().getAll()
    for (const tool of tools) {
      const mirrored = createMirroredTool(tool)
      this._tools.set(tool.name.toLowerCase(), mirrored)
    }
  }

  get commands(): MirroredCommand[] {
    return Array.from(this._commands.values())
  }

  get tools(): MirroredTool[] {
    return Array.from(this._tools.values())
  }

  getCommand(name: string): MirroredCommand | undefined {
    return this._commands.get(name.toLowerCase())
  }

  getTool(name: string): MirroredTool | undefined {
    return this._tools.get(name.toLowerCase())
  }

  hasCommand(name: string): boolean {
    return this._commands.has(name.toLowerCase())
  }

  hasTool(name: string): boolean {
    return this._tools.has(name.toLowerCase())
  }

  /**
   * Reload registry from services
   */
  reload(): void {
    this._commands.clear()
    this._tools.clear()
    this.buildRegistry()
  }
}

// Singleton instance
let registryInstance: ExecutionRegistryImpl | null = null

/**
 * Build execution registry (equivalent to build_execution_registry in Python)
 */
export function buildExecutionRegistry(): ExecutionRegistry {
  if (!registryInstance) {
    registryInstance = new ExecutionRegistryImpl()
  }
  return registryInstance
}

/**
 * Get execution registry singleton
 */
export function getExecutionRegistry(): ExecutionRegistry {
  return buildExecutionRegistry()
}

/**
 * Reload execution registry
 */
export function reloadExecutionRegistry(): void {
  if (registryInstance) {
    registryInstance.reload()
  }
}

export default {
  buildExecutionRegistry,
  getExecutionRegistry,
  reloadExecutionRegistry,
  createMirroredCommand,
  createMirroredTool
}
