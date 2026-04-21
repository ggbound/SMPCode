/**
 * Commands Service - Based on claw-code/src/commands.py
 * Manages command data from reference files with execution capabilities
 */

import * as fs from 'fs'
import { join } from 'path'
import log from 'electron-log'

// ============ Types ============

export interface Command {
  name: string
  source_hint: string
  responsibility: string
  status?: 'mirrored' | 'pending' | 'completed'
}

export interface CommandExecution {
  name: string
  source_hint: string
  prompt: string
  handled: boolean
  message: string
}

export interface CommandQuery {
  query?: string
  limit?: number
}

export interface CommandSearchResult {
  count: number
  commands: Command[]
}

// ============ Command Registry ============

// Singleton instance
let instance: CommandsService | null = null
let cachedCommands: Command[] = []

/**
 * Get the correct resources path for both dev and production environments
 */
function getResourcesPath(): string {
  const devPath = join(__dirname, '../../../../resources')
  const devReferencePath = join(devPath, 'reference_data', 'commands_snapshot.json')

  if (fs.existsSync(devReferencePath)) {
    return devPath
  }

  return join(__dirname, '../../resources')
}

/**
 * Commands Service - Manages command data from reference files
 * Aligned with claw-code/src/commands.py implementation
 */
export class CommandsService {
  private resourcesPath: string

  constructor() {
    this.resourcesPath = getResourcesPath()
    this.loadCommands()
  }

  /**
   * Load commands from reference data (equivalent to load_command_snapshot in Python)
   */
  private loadCommands(): void {
    try {
      const commandsPath = join(this.resourcesPath, 'reference_data', 'commands_snapshot.json')

      if (fs.existsSync(commandsPath)) {
        const data = fs.readFileSync(commandsPath, 'utf-8')
        const rawEntries = JSON.parse(data)
        // Map to Command interface with mirrored status (like PortingModule in Python)
        cachedCommands = rawEntries.map((entry: { name: string; responsibility: string; source_hint: string }) => ({
          name: entry.name,
          responsibility: entry.responsibility,
          source_hint: entry.source_hint,
          status: 'mirrored' as const
        }))
        log.info(`CommandsService: Loaded ${cachedCommands.length} commands`)
      } else {
        log.warn('CommandsService: commands_snapshot.json not found')
        cachedCommands = []
      }
    } catch (error) {
      log.error('CommandsService: Failed to load commands:', error)
      cachedCommands = []
    }
  }

  /**
   * Get all commands (equivalent to PORTED_COMMANDS in Python)
   */
  getAll(): Command[] {
    return cachedCommands
  }

  /**
   * Get command count
   */
  getCount(): number {
    return cachedCommands.length
  }

  /**
   * Get built-in command names (equivalent to built_in_command_names in Python)
   */
  getBuiltInCommandNames(): Set<string> {
    return new Set(cachedCommands.map(cmd => cmd.name.toLowerCase()))
  }

  /**
   * Get command names list (equivalent to command_names in Python)
   */
  getCommandNames(): string[] {
    return cachedCommands.map(cmd => cmd.name)
  }

  /**
   * Get command by exact name (equivalent to get_command in Python)
   */
  getByName(name: string): Command | undefined {
    const needle = name.toLowerCase()
    return cachedCommands.find(cmd => cmd.name.toLowerCase() === needle)
  }

  /**
   * Get commands with optional filtering (equivalent to get_commands in Python)
   */
  getCommands(
    includePluginCommands = true,
    includeSkillCommands = true
  ): Command[] {
    let commands = [...cachedCommands]

    if (!includePluginCommands) {
      commands = commands.filter(cmd => !cmd.source_hint.toLowerCase().includes('plugin'))
    }

    if (!includeSkillCommands) {
      commands = commands.filter(cmd => !cmd.source_hint.toLowerCase().includes('skills'))
    }

    return commands
  }

  /**
   * Find commands by query (equivalent to find_commands in Python)
   */
  findCommands(query: string, limit = 20): Command[] {
    const needle = query.toLowerCase()
    const matches = cachedCommands.filter(
      cmd =>
        cmd.name.toLowerCase().includes(needle) ||
        cmd.source_hint.toLowerCase().includes(needle)
    )
    return matches.slice(0, limit)
  }

  /**
   * Search commands by query
   */
  search(query: CommandQuery): CommandSearchResult {
    const limit = query.limit || 20
    const searchQuery = query.query?.toLowerCase() || ''

    const results = searchQuery
      ? this.findCommands(searchQuery, limit)
      : cachedCommands.slice(0, limit)

    return {
      count: results.length,
      commands: results
    }
  }

  /**
   * Get commands by prefix
   */
  getByPrefix(prefix: string, limit = 10): Command[] {
    const lowerPrefix = prefix.toLowerCase()
    return cachedCommands
      .filter(cmd => cmd.name.toLowerCase().startsWith(lowerPrefix))
      .slice(0, limit)
  }

  /**
   * Execute command (equivalent to execute_command in Python)
   */
  execute(name: string, prompt = ''): CommandExecution {
    const cmd = this.getByName(name)
    if (!cmd) {
      return {
        name,
        source_hint: '',
        prompt,
        handled: false,
        message: `Unknown mirrored command: ${name}`
      }
    }

    const action = `Mirrored command '${cmd.name}' from ${cmd.source_hint} would handle prompt ${JSON.stringify(prompt)}.`
    return {
      name: cmd.name,
      source_hint: cmd.source_hint,
      prompt,
      handled: true,
      message: action
    }
  }

  /**
   * Render command index (equivalent to render_command_index in Python)
   */
  renderCommandIndex(limit = 20, query?: string): string {
    const commands = query ? this.findCommands(query, limit) : cachedCommands.slice(0, limit)
    const lines = [`Command entries: ${cachedCommands.length}`, '']

    if (query) {
      lines.push(`Filtered by: ${query}`, '')
    }

    lines.push(...commands.map(cmd => `- ${cmd.name} — ${cmd.source_hint}`))
    return lines.join('\n')
  }

  /**
   * Reload commands from disk
   */
  reload(): void {
    this.loadCommands()
  }
}

// ============ Convenience Functions ============

/**
 * Get singleton instance
 */
export function getCommandsService(): CommandsService {
  if (!instance) {
    instance = new CommandsService()
  }
  return instance
}

/**
 * Get all commands (convenience function)
 */
export function getAllCommands(): Command[] {
  return getCommandsService().getAll()
}

/**
 * Get command by name (convenience function)
 */
export function getCommandByName(name: string): Command | undefined {
  return getCommandsService().getByName(name)
}

/**
 * Find commands (convenience function)
 */
export function findCommands(query: string, limit = 20): Command[] {
  return getCommandsService().findCommands(query, limit)
}

/**
 * Execute command (convenience function)
 */
export function executeCommand(name: string, prompt = ''): CommandExecution {
  return getCommandsService().execute(name, prompt)
}

/**
 * Get command names (convenience function)
 */
export function getCommandNames(): string[] {
  return getCommandsService().getCommandNames()
}

/**
 * Render command index (convenience function)
 */
export function renderCommandIndex(limit = 20, query?: string): string {
  return getCommandsService().renderCommandIndex(limit, query)
}

export default {
  CommandsService,
  getCommandsService,
  getAllCommands,
  getCommandByName,
  findCommands,
  executeCommand,
  getCommandNames,
  renderCommandIndex
}