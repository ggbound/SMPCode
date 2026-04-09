/**
 * Tool System - Based on claw-code/src/tools.py
 */

import * as fs from 'fs'
import * as path from 'path'
import { PortingModule, ToolExecution, PortingBacklog, ToolPermissionContext } from './types'
import { createPortingModule, buildToolBacklog } from './models'

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '..', 'resources', 'reference_data', 'tools_snapshot.json')

let toolSnapshotCache: PortingModule[] | null = null

export function loadToolSnapshot(): PortingModule[] {
  if (toolSnapshotCache) {
    return toolSnapshotCache
  }
  
  try {
    const rawEntries = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'))
    const modules = rawEntries.map((entry: { name: string; responsibility: string; source_hint: string }) =>
      createPortingModule(
        entry.name,
        entry.responsibility,
        entry.source_hint,
        'mirrored'
      )
    )
    toolSnapshotCache = modules
    return modules
  } catch (error) {
    console.error('Failed to load tool snapshot:', error)
    return []
  }
}

export const PORTED_TOOLS: PortingModule[] = loadToolSnapshot()

export function getBuiltInToolNames(): Set<string> {
  return new Set(PORTED_TOOLS.map(module => module.name.toLowerCase()))
}

export function buildToolBacklogFromSnapshot(): PortingBacklog {
  return buildToolBacklog(PORTED_TOOLS)
}

export function getToolNames(): string[] {
  return PORTED_TOOLS.map(module => module.name)
}

export function getTool(name: string): PortingModule | null {
  const needle = name.toLowerCase()
  for (const module of PORTED_TOOLS) {
    if (module.name.toLowerCase() === needle) {
      return module
    }
  }
  return null
}

export function getTools(
  simpleMode = false,
  includeMcp = true,
  permissionContext?: ToolPermissionContext
): PortingModule[] {
  let tools = [...PORTED_TOOLS]
  
  // Filter by MCP if needed
  if (!includeMcp) {
    tools = tools.filter(module => !module.sourceHint.toLowerCase().includes('mcp'))
  }
  
  // Apply permission filtering
  if (permissionContext) {
    tools = tools.filter(module => !permissionContext.blocks(module.name))
  }
  
  // In simple mode, return only basic tools
  if (simpleMode) {
    const basicToolNames = ['read_file', 'write_file', 'edit_file', 'search_codebase', 'grep_code']
    tools = tools.filter(module => basicToolNames.includes(module.name.toLowerCase()))
  }
  
  return tools
}

export function findTools(query: string, limit = 20): PortingModule[] {
  const needle = query.toLowerCase()
  const matches = PORTED_TOOLS.filter(
    module =>
      module.name.toLowerCase().includes(needle) ||
      module.sourceHint.toLowerCase().includes(needle)
  )
  return matches.slice(0, limit)
}

export function executeTool(name: string, payload = ''): ToolExecution {
  const module = getTool(name)
  if (module === null) {
    return {
      name,
      sourceHint: '',
      payload,
      handled: false,
      message: `Unknown mirrored tool: ${name}`
    }
  }
  
  const action = `Mirrored tool '${module.name}' from ${module.sourceHint} would process payload ${JSON.stringify(payload)}.`
  return {
    name: module.name,
    sourceHint: module.sourceHint,
    payload,
    handled: true,
    message: action
  }
}

export function renderToolIndex(
  limit = 20,
  query?: string,
  simpleMode = false,
  includeMcp = true,
  permissionContext?: ToolPermissionContext
): string {
  let tools = getTools(simpleMode, includeMcp, permissionContext)
  
  if (query) {
    const needle = query.toLowerCase()
    tools = tools.filter(
      module =>
        module.name.toLowerCase().includes(needle) ||
        module.sourceHint.toLowerCase().includes(needle)
    )
  }
  
  const modules = tools.slice(0, limit)
  const lines = [`Tool entries: ${tools.length}`, '']
  
  if (query) {
    lines.push(`Filtered by: ${query}`, '')
  }
  
  for (const module of modules) {
    lines.push(`- ${module.name} — ${module.sourceHint}`)
  }
  
  return lines.join('\n')
}
