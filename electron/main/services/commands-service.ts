import * as fs from 'fs'
import { join } from 'path'
import log from 'electron-log'

// Types
export interface Command {
  name: string
  source_hint: string
  responsibility: string
  status?: string
}

export interface CommandQuery {
  query?: string
  limit?: number
}

export interface CommandSearchResult {
  count: number
  commands: Command[]
}

// Singleton instance
let instance: CommandsService | null = null
let cachedCommands: Command[] = []

/**
 * Get the correct resources path for both dev and production environments
 * The resources directory is always at a fixed relative location from __dirname
 * - Dev: project_root/resources (4 levels up from electron/main/services)
 * - Production: app/resources (2 levels up from out/main)
 */
function getResourcesPath(): string {
  // Try development path first (4 levels up from electron/main/services)
  const devPath = join(__dirname, '../../../../resources')
  const devReferencePath = join(devPath, 'reference_data', 'commands_snapshot.json')

  if (fs.existsSync(devReferencePath)) {
    return devPath
  }

  // Production path (2 levels up from out/main to reach app/resources)
  return join(__dirname, '../../resources')
}

/**
 * Commands Service - Manages command data from reference files
 */
export class CommandsService {
  private resourcesPath: string

  constructor() {
    this.resourcesPath = getResourcesPath()
    this.loadCommands()
  }

  /**
   * Load commands from reference data
   */
  private loadCommands(): void {
    try {
      const commandsPath = join(this.resourcesPath, 'reference_data', 'commands_snapshot.json')
      
      if (fs.existsSync(commandsPath)) {
        const data = fs.readFileSync(commandsPath, 'utf-8')
        cachedCommands = JSON.parse(data)
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
   * Get all commands
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
   * Search commands by query
   */
  search(query: CommandQuery): CommandSearchResult {
    let results = [...cachedCommands]
    const limit = query.limit || 20
    const searchQuery = query.query?.toLowerCase() || ''

    if (searchQuery) {
      results = results.filter(cmd =>
        cmd.name.toLowerCase().includes(searchQuery) ||
        cmd.source_hint.toLowerCase().includes(searchQuery) ||
        cmd.responsibility?.toLowerCase().includes(searchQuery)
      )
    }

    return {
      count: results.length,
      commands: results.slice(0, limit)
    }
  }

  /**
   * Get command by exact name
   */
  getByName(name: string): Command | undefined {
    return cachedCommands.find(cmd => cmd.name.toLowerCase() === name.toLowerCase())
  }

  /**
   * Get commands by prefix
   */
  getByPrefix(prefix: string, limit: number = 10): Command[] {
    const lowerPrefix = prefix.toLowerCase()
    return cachedCommands
      .filter(cmd => cmd.name.toLowerCase().startsWith(lowerPrefix))
      .slice(0, limit)
  }

  /**
   * Reload commands from disk
   */
  reload(): void {
    this.loadCommands()
  }
}

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
 * Search commands (convenience function)
 */
export function searchCommands(query: CommandQuery): CommandSearchResult {
  return getCommandsService().search(query)
}

/**
 * Get command by name (convenience function)
 */
export function getCommandByName(name: string): Command | undefined {
  return getCommandsService().getByName(name)
}

export default {
  CommandsService,
  getCommandsService,
  getAllCommands,
  searchCommands,
  getCommandByName
}