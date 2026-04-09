/**
 * Permission Management for Tools
 */

import { ToolPermissionContext, PermissionDenial } from './types'

export class ToolPermissionContextImpl implements ToolPermissionContext {
  deniedTools: string[] = []
  deniedPrefixes: string[] = []

  static fromIterables(
    deniedTools: string[] = [],
    deniedPrefixes: string[] = []
  ): ToolPermissionContextImpl {
    const context = new ToolPermissionContextImpl()
    context.deniedTools = deniedTools.map(t => t.toLowerCase())
    context.deniedPrefixes = deniedPrefixes.map(p => p.toLowerCase())
    return context
    }

  blocks(toolName: string): boolean {
    const lowerName = toolName.toLowerCase()
    
    // Check exact match
    if (this.deniedTools.includes(lowerName)) {
      return true
    }
    
    // Check prefix match
    for (const prefix of this.deniedPrefixes) {
      if (lowerName.startsWith(prefix)) {
        return true
      }
    }
    
    return false
  }
}

export function inferPermissionDenials(
  toolNames: string[],
  context: ToolPermissionContext
): PermissionDenial[] {
  const denials: PermissionDenial[] = []
  
  for (const toolName of toolNames) {
    // Auto-deny destructive bash commands
    if (toolName.toLowerCase().includes('bash') || 
        toolName.toLowerCase().includes('shell')) {
      if (context.blocks(toolName)) {
        denials.push({
          toolName,
          reason: 'Destructive shell execution remains gated'
        })
      }
    }
  }
  
  return denials
}
