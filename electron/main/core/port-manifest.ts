/**
 * Port Manifest - Workspace Information
 */

import { PortManifest } from './types'
import * as fs from 'fs'
import * as path from 'path'

export interface ManifestModule {
  name: string
  fileCount: number
  notes: string
}

export class PortManifestImpl implements PortManifest {
  topLevelModules: ManifestModule[] = []

  constructor() {
    this.buildFromWorkspace()
  }

  private buildFromWorkspace(): void {
    // Scan the core directory for modules
    const coreDir = path.resolve(__dirname)
    if (fs.existsSync(coreDir)) {
      const entries = fs.readdirSync(coreDir)
      for (const entry of entries) {
        const entryPath = path.join(coreDir, entry)
        const stat = fs.statSync(entryPath)
        if (stat.isFile() && entry.endsWith('.ts')) {
          this.topLevelModules.push({
            name: entry.replace('.ts', ''),
            fileCount: 1,
            notes: 'Core module'
          })
        }
      }
    }
  }

  toMarkdown(): string {
    const lines = [
      '# Port Manifest',
      '',
      `## Top Level Modules (${this.topLevelModules.length})`,
      ''
    ]
    
    for (const module of this.topLevelModules) {
      lines.push(`- ${module.name}: ${module.fileCount} files - ${module.notes}`)
    }
    
    return lines.join('\n')
  }
}

export function buildPortManifest(): PortManifest {
  return new PortManifestImpl()
}
