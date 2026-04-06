import * as fs from 'fs'
import { join } from 'path'
import log from 'electron-log'

// Types
export interface Tool {
  name: string
  source_hint: string
  responsibility: string
  status?: string
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
let cachedTools: Tool[] = []

/**
 * Get the correct resources path for both dev and production environments
 * The resources directory is always at a fixed relative location from __dirname
 * - Dev: project_root/resources (4 levels up from electron/main/services)
 * - Production: app/resources (2 levels up from out/main)
 */
function getResourcesPath(): string {
  // Try development path first (4 levels up from electron/main/services)
  const devPath = join(__dirname, '../../../../resources')
  const devReferencePath = join(devPath, 'reference_data', 'tools_snapshot.json')

  if (fs.existsSync(devReferencePath)) {
    return devPath
  }

  // Production path (2 levels up from out/main to reach app/resources)
  return join(__dirname, '../../resources')
}

/**
 * Tools Service - Manages tool data from reference files
 */
export class ToolsService {
  private resourcesPath: string

  constructor() {
    this.resourcesPath = getResourcesPath()
    this.loadTools()
  }

  /**
   * Load tools from reference data
   */
  private loadTools(): void {
    try {
      const toolsPath = join(this.resourcesPath, 'reference_data', 'tools_snapshot.json')
      
      if (fs.existsSync(toolsPath)) {
        const data = fs.readFileSync(toolsPath, 'utf-8')
        cachedTools = JSON.parse(data)
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
   * Get all tools
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
   * Search tools by query
   */
  search(query: ToolQuery): ToolSearchResult {
    let results = [...cachedTools]
    const limit = query.limit || 20
    const searchQuery = query.query?.toLowerCase() || ''

    if (searchQuery) {
      results = results.filter(tool =>
        tool.name.toLowerCase().includes(searchQuery) ||
        tool.source_hint.toLowerCase().includes(searchQuery) ||
        tool.responsibility?.toLowerCase().includes(searchQuery)
      )
    }

    return {
      count: results.length,
      tools: results.slice(0, limit)
    }
  }

  /**
   * Get tool by exact name
   */
  getByName(name: string): Tool | undefined {
    return cachedTools.find(tool => tool.name.toLowerCase() === name.toLowerCase())
  }

  /**
   * Get tools by category (by source_hint prefix)
   */
  getByCategory(category: string, limit: number = 20): Tool[] {
    const lowerCategory = category.toLowerCase()
    return cachedTools
      .filter(tool => tool.source_hint.toLowerCase().includes(lowerCategory))
      .slice(0, limit)
  }

  /**
   * Get tools that match a pattern in name
   */
  getByPattern(pattern: RegExp, limit: number = 20): Tool[] {
    return cachedTools
      .filter(tool => pattern.test(tool.name))
      .slice(0, limit)
  }

  /**
   * Reload tools from disk
   */
  reload(): void {
    this.loadTools()
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
 * Search tools (convenience function)
 */
export function searchTools(query: ToolQuery): ToolSearchResult {
  return getToolsService().search(query)
}

/**
 * Get tool by name (convenience function)
 */
export function getToolByName(name: string): Tool | undefined {
  return getToolsService().getByName(name)
}

export default {
  ToolsService,
  getToolsService,
  getAllTools,
  searchTools,
  getToolByName
}