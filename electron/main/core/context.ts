/**
 * Port Context - Workspace Context Building
 */

import { PortContext } from './types'
import * as fs from 'fs'
import * as path from 'path'

export function buildPortContext(cwd?: string): PortContext {
  const workingDir = cwd || process.cwd()
  
  // Count Python files in workspace (for compatibility with Python port)
  let pythonFileCount = 0
  try {
    const entries = fs.readdirSync(workingDir)
    for (const entry of entries) {
      if (entry.endsWith('.py')) {
        pythonFileCount++
      }
    }
  } catch {
    // Ignore errors
  }
  
  // Check if archive is available
  const archiveAvailable = fs.existsSync(path.join(workingDir, '.claude', 'archive'))
  
  return {
    pythonFileCount,
    archiveAvailable,
    cwd: workingDir
  }
}

export function renderContext(context: PortContext): string {
  return [
    `- Python files: ${context.pythonFileCount}`,
    `- Archive available: ${context.archiveAvailable}`,
    `- Working directory: ${context.cwd}`
  ].join('\n')
}
