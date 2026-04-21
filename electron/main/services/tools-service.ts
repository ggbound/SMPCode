/**
 * Tools Service - Based on claw-code/src/tools.py
 * Manages tool data from reference files with execution capabilities
 */

import * as fs from 'fs'
import { join } from 'path'
import log from 'electron-log'

// ============ Types ============

export interface Tool {
  name: string
  source_hint: string
  responsibility: string
  status?: 'mirrored' | 'pending' | 'completed'
}

export interface ToolExecution {
  name: string
  source_hint: string
  payload: string
  handled: boolean
  message: string
}

export interface ToolQuery {
  query?: string
  limit?: number
}

export interface ToolSearchResult {
  count: number
  tools: Tool[]
}

// ============ Tool Registry ============

// Singleton instance
let instance: ToolsService | null = null
let cachedTools: Tool[] = []

/**
 * Get the correct resources path for both dev and production environments
 */
function getResourcesPath(): string {
  const devPath = join(__dirname, '../../../../resources')
  const devReferencePath = join(devPath, 'reference_data', 'tools_snapshot.json')

  if (fs.existsSync(devReferencePath)) {
    return devPath
  }

  return join(__dirname, '../../resources')
}

/**
 * Tools Service - Manages tool data from reference files
 * Aligned with claw-code/src/tools.py implementation
 */
export class ToolsService {
  private resourcesPath: string

  constructor() {
    this.resourcesPath = getResourcesPath()
    this.loadTools()
  }

  /**
   * Load tools from reference data (equivalent to load_tool_snapshot in Python)
   */
  private loadTools(): void {
    try {
      const toolsPath = join(this.resourcesPath, 'reference_data', 'tools_snapshot.json')

      if (fs.existsSync(toolsPath)) {
        const data = fs.readFileSync(toolsPath, 'utf-8')
        const rawEntries = JSON.parse(data)
        // Map to Tool interface with mirrored status (like PortingModule in Python)
        cachedTools = rawEntries.map((entry: { name: string; responsibility: string; source_hint: string }) => ({
          name: entry.name,
          responsibility: entry.responsibility,
          source_hint: entry.source_hint,
          status: 'mirrored' as const
        }))
        log.info(`ToolsService: Loaded ${cachedTools.length} tools`)
      } else {
        log.warn('ToolsService: tools_snapshot.json not found')
        cachedTools = []
      }
    } catch (error) {
      log.error('ToolsService: Failed to load tools:', error)
      cachedTools = []
    }
  }

  /**
   * Get all tools (equivalent to PORTED_TOOLS in Python)
   */
  getAll(): Tool[] {
    return cachedTools
  }

  /**
   * Get tool count
   */
  getCount(): number {
    return cachedTools.length
  }

  /**
   * Get tool names list (equivalent to tool_names in Python)
   */
  getToolNames(): string[] {
    return cachedTools.map(tool => tool.name)
  }

  /**
   * Get tool by exact name (equivalent to get_tool in Python)
   */
  getByName(name: string): Tool | undefined {
    const needle = name.toLowerCase()
    return cachedTools.find(tool => tool.name.toLowerCase() === needle)
  }

  /**
   * Find tools by query (equivalent to find_tools in Python)
   */
  findTools(query: string, limit = 20): Tool[] {
    const needle = query.toLowerCase()
    const matches = cachedTools.filter(
      tool =>
        tool.name.toLowerCase().includes(needle) ||
        tool.source_hint.toLowerCase().includes(needle)
    )
    return matches.slice(0, limit)
  }

  /**
   * Search tools by query
   */
  search(query: ToolQuery): ToolSearchResult {
    const limit = query.limit || 20
    const searchQuery = query.query?.toLowerCase() || ''

    const results = searchQuery
      ? this.findTools(searchQuery, limit)
      : cachedTools.slice(0, limit)

    return {
      count: results.length,
      tools: results
    }
  }

  /**
   * Get tools by category (by source_hint prefix)
   */
  getByCategory(category: string, limit = 20): Tool[] {
    const lowerCategory = category.toLowerCase()
    return cachedTools
      .filter(tool => tool.source_hint.toLowerCase().includes(lowerCategory))
      .slice(0, limit)
  }

  /**
   * Get tools that match a pattern in name
   */
  getByPattern(pattern: RegExp, limit = 20): Tool[] {
    return cachedTools
      .filter(tool => pattern.test(tool.name))
      .slice(0, limit)
  }

  /**
   * Execute tool (equivalent to execute_tool in Python)
   */
  execute(name: string, payload = ''): ToolExecution {
    const tool = this.getByName(name)
    if (!tool) {
      return {
        name,
        source_hint: '',
        payload,
        handled: false,
        message: `Unknown mirrored tool: ${name}`
      }
    }

    const action = `Mirrored tool '${tool.name}' from ${tool.source_hint} would handle payload ${JSON.stringify(payload)}.`
    return {
      name: tool.name,
      source_hint: tool.source_hint,
      payload,
      handled: true,
      message: action
    }
  }

  /**
   * Render tool index (equivalent to render_tool_index in Python)
   */
  renderToolIndex(limit = 20, query?: string): string {
    const tools = query ? this.findTools(query, limit) : cachedTools.slice(0, limit)
    const lines = [`Tool entries: ${cachedTools.length}`, '']

    if (query) {
      lines.push(`Filtered by: ${query}`, '')
    }

    lines.push(...tools.map(tool => `- ${tool.name} — ${tool.source_hint}`))
    return lines.join('\n')
  }

  /**
   * Reload tools from disk
   */
  reload(): void {
    this.loadTools()
  }
}

// ============ Convenience Functions ============

/**
 * Get singleton instance
 */
export function getToolsService(): ToolsService {
  if (!instance) {
    instance = new ToolsService()
  }
  return instance
}

/**
 * Get all tools (convenience function)
 */
export function getAllTools(): Tool[] {
  return getToolsService().getAll()
}

/**
 * Get tool by name (convenience function)
 */
export function getToolByName(name: string): Tool | undefined {
  return getToolsService().getByName(name)
}

/**
 * Find tools (convenience function)
 */
export function findTools(query: string, limit = 20): Tool[] {
  return getToolsService().findTools(query, limit)
}

/**
 * Execute tool (convenience function)
 */
export function executeTool(name: string, payload = ''): ToolExecution {
  return getToolsService().execute(name, payload)
}

/**
 * Get tool names (convenience function)
 */
export function getToolNames(): string[] {
  return getToolsService().getToolNames()
}

/**
 * Render tool index (convenience function)
 */
export function renderToolIndex(limit = 20, query?: string): string {
  return getToolsService().renderToolIndex(limit, query)
}

export default {
  ToolsService,
  getToolsService,
  getAllTools,
  getToolByName,
  findTools,
  executeTool,
  getToolNames,
  renderToolIndex
}