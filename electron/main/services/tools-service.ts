/**
 * Tools Service - Simplified version
 * Provides tool metadata from PORTED_TOOLS
 */

import { getTools, PORTED_TOOLS } from '../core/tools'

// Tool interface for API compatibility
export interface Tool {
  name: string
  source_hint: string
  responsibility: string
  status?: 'mirrored' | 'pending' | 'completed'
}

export interface ToolQuery {
  query?: string
  limit?: number
}

export interface ToolSearchResult {
  count: number
  tools: Tool[]
}

// Singleton instance
let instance: ToolsService | null = null

/**
 * Tools Service - Provides tool metadata
 */
export class ToolsService {
  /**
   * Get all tools
   */
  getAll(): Tool[] {
    return getTools().map(tool => ({
      name: tool.name,
      source_hint: tool.sourceHint,
      responsibility: tool.responsibility,
      status: 'mirrored' as const
    }))
  }

  /**
   * Get tool count
   */
  getCount(): number {
    return PORTED_TOOLS.length
  }

  /**
   * Get tool by exact name
   */
  getByName(name: string): Tool | undefined {
    const needle = name.toLowerCase()
    const tool = PORTED_TOOLS.find(t => t.name.toLowerCase() === needle)
    if (!tool) return undefined
    return {
      name: tool.name,
      source_hint: tool.sourceHint,
      responsibility: tool.responsibility,
      status: 'mirrored' as const
    }
  }

  /**
   * Search tools by query
   */
  search(query: ToolQuery): ToolSearchResult {
    const limit = query.limit || 20
    const searchQuery = query.query?.toLowerCase() || ''

    const tools = this.getAll()
    const results = searchQuery
      ? tools.filter(
          tool =>
            tool.name.toLowerCase().includes(searchQuery) ||
            tool.source_hint.toLowerCase().includes(searchQuery) ||
            tool.responsibility.toLowerCase().includes(searchQuery)
        )
      : tools

    return {
      count: results.length,
      tools: results.slice(0, limit)
    }
  }
}

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
  const result = getToolsService().search({ query, limit })
  return result.tools
}

/**
 * Get tool names (convenience function)
 */
export function getToolNames(): string[] {
  return PORTED_TOOLS.map(tool => tool.name)
}

/**
 * Render tool index (convenience function)
 */
export function renderToolIndex(limit = 20, query?: string): string {
  const result = getToolsService().search({ query, limit })
  const lines = [`Tool entries: ${result.count}`, '']

  if (query) {
    lines.push(`Filtered by: ${query}`, '')
  }

  lines.push(...result.tools.map(tool => `- ${tool.name} — ${tool.source_hint}`))
  return lines.join('\n')
}

export default {
  ToolsService,
  getToolsService,
  getAllTools,
  getToolByName,
  findTools,
  getToolNames,
  renderToolIndex
}
