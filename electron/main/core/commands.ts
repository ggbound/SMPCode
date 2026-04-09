/**
 * Command System - Based on claw-code/src/commands.py
 */

import * as fs from 'fs'
import * as path from 'path'
import { PortingModule, CommandExecution, PortingBacklog } from './types'
import { createPortingModule, buildCommandBacklog } from './models'

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', '..', 'resources', 'reference_data', 'commands_snapshot.json')

let commandSnapshotCache: PortingModule[] | null = null

export function loadCommandSnapshot(): PortingModule[] {
  if (commandSnapshotCache) {
    return commandSnapshotCache
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
    commandSnapshotCache = modules
    return modules
  } catch (error) {
    console.error('Failed to load command snapshot:', error)
    return []
  }
}

export const PORTED_COMMANDS: PortingModule[] = loadCommandSnapshot()

export function getBuiltInCommandNames(): Set<string> {
  return new Set(PORTED_COMMANDS.map(module => module.name.toLowerCase()))
}

export function buildCommandBacklogFromSnapshot(): PortingBacklog {
  return buildCommandBacklog(PORTED_COMMANDS)
}

export function getCommandNames(): string[] {
  return PORTED_COMMANDS.map(module => module.name)
}

export function getCommand(name: string): PortingModule | null {
  const needle = name.toLowerCase()
  for (const module of PORTED_COMMANDS) {
    if (module.name.toLowerCase() === needle) {
      return module
    }
  }
  return null
}

export function getCommands(
  cwd?: string,
  includePluginCommands = true,
  includeSkillCommands = true
): PortingModule[] {
  let commands = [...PORTED_COMMANDS]
  
  if (!includePluginCommands) {
    commands = commands.filter(module => !module.sourceHint.toLowerCase().includes('plugin'))
  }
  
  if (!includeSkillCommands) {
    commands = commands.filter(module => !module.sourceHint.toLowerCase().includes('skills'))
  }
  
  return commands
}

export function findCommands(query: string, limit = 20): PortingModule[] {
  const needle = query.toLowerCase()
  const matches = PORTED_COMMANDS.filter(
    module =>
      module.name.toLowerCase().includes(needle) ||
      module.sourceHint.toLowerCase().includes(needle)
  )
  return matches.slice(0, limit)
}

export function executeCommand(name: string, prompt = ''): CommandExecution {
  const module = getCommand(name)
  if (module === null) {
    return {
      name,
      sourceHint: '',
      prompt,
      handled: false,
      message: `Unknown mirrored command: ${name}`
    }
  }
  
  const action = `Mirrored command '${module.name}' from ${module.sourceHint} would handle prompt ${JSON.stringify(prompt)}.`
  return {
    name: module.name,
    sourceHint: module.sourceHint,
    prompt,
    handled: true,
    message: action
  }
}

export function renderCommandIndex(limit = 20, query?: string): string {
  const modules = query ? findCommands(query, limit) : PORTED_COMMANDS.slice(0, limit)
  const lines = [`Command entries: ${PORTED_COMMANDS.length}`, '']
  
  if (query) {
    lines.push(`Filtered by: ${query}`, '')
  }
  
  for (const module of modules) {
    lines.push(`- ${module.name} — ${module.sourceHint}`)
  }
  
  return lines.join('\n')
}
