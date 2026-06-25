/**
 * MemCoder - 上下文构建器
 * 用于构建包含长期记忆的AI提示上下文
 */

import log from 'electron-log'
import { IntentCodeMapping, ProjectPattern } from './types'
import { MemoryStore, getMemoryStore } from './memory-store'

export class ContextBuilder {
  private projectPath: string
  private memoryStore: MemoryStore

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.memoryStore = getMemoryStore(projectPath)
  }

  // 构建包含项目记忆的系统提示
  buildSystemPrompt(basePrompt: string): string {
    const parts: string[] = [basePrompt]

    // 添加项目模式
    const patterns = this.memoryStore.getPatterns()
    if (patterns.length > 0) {
      parts.push('\n=== PROJECT PATTERNS ===')
      parts.push('This project follows these patterns:')
      for (const pattern of patterns) {
        parts.push(`\n- ${pattern.description}`)
        if (pattern.examples.length > 0) {
          parts.push('  Examples:')
          for (const example of pattern.examples.slice(0, 2)) {
            parts.push(`    ${example}`)
          }
        }
      }
    }

    // 添加使用统计
    const stats = this.memoryStore.getStats()
    if (stats.mappingsCount > 0) {
      parts.push(`\n=== PROJECT MEMORY ===`)
      parts.push(`This project has ${stats.mappingsCount} learned patterns from git history.`)
      parts.push(`Use them to align with project conventions.`)
    }

    return parts.join('\n')
  }

  // 为用户查询构建相关上下文
  buildRelevantContext(query: string, limit: number = 3): string {
    const mappings = this.memoryStore.searchMappings(query, limit)

    if (mappings.length === 0) {
      return ''
    }

    const parts: string[] = ['\n=== RELEVANT PROJECT HISTORY ===']
    parts.push('Here are similar tasks from this project\'s history:')

    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i]
      parts.push(`\n--- Example ${i + 1} ---`)
      parts.push(`Intent: ${mapping.intent}`)

      // 添加变更文件列表
      const files = mapping.codeChanges.map(c => c.filePath).join(', ')
      parts.push(`Files: ${files}`)

      // 添加置信度信息
      const verifiedText = mapping.verifiedAt ? ' (Human-verified)' : ''
      parts.push(`Confidence: ${Math.round(mapping.confidence * 100)}%${verifiedText}`)
    }

    parts.push('\nUse these as reference, but adapt to current needs.')
    return parts.join('\n')
  }

  // 获取完整的项目记忆摘要
  getMemorySummary(): string {
    const stats = this.memoryStore.getStats()
    const mappings = this.memoryStore.getMemory()?.mappings || []

    const parts: string[] = ['=== PROJECT MEMORY SUMMARY ===']
    parts.push(`Total mappings: ${stats.mappingsCount}`)
    parts.push(`Project patterns: ${stats.patternsCount}`)
    parts.push(`Feedback records: ${stats.feedbackCount}`)

    // 最常用的映射
    const mostUsed = [...mappings]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5)

    if (mostUsed.length > 0) {
      parts.push('\nMost used patterns:')
      for (const mapping of mostUsed) {
        const shortIntent = mapping.intent.length > 100
          ? mapping.intent.substring(0, 100) + '...'
          : mapping.intent
        parts.push(`- ${shortIntent} (${mapping.usageCount} uses)`)
      }
    }

    return parts.join('\n')
  }

  // 获取建议的代码变更（基于历史模式）
  getSuggestedChanges(query: string): {
    files: string[]
    patterns: string[]
  } {
    const mappings = this.memoryStore.searchMappings(query, 5)

    const files = new Set<string>()
    const patterns = new Set<string>()

    for (const mapping of mappings) {
      for (const change of mapping.codeChanges) {
        files.add(change.filePath)

        // 简单的模式识别
        if (change.filePath.includes('components/')) {
          patterns.add('Create/modify components')
        }
        if (change.filePath.includes('utils/') || change.filePath.includes('helpers/')) {
          patterns.add('Update utility functions')
        }
        if (change.filePath.includes('types/') || change.filePath.includes('interfaces/')) {
          patterns.add('Update type definitions')
        }
      }
    }

    return {
      files: Array.from(files),
      patterns: Array.from(patterns)
    }
  }
}

// 构建器缓存
const builders = new Map<string, ContextBuilder>()

export function getContextBuilder(projectPath: string): ContextBuilder {
  let builder = builders.get(projectPath)
  if (!builder) {
    builder = new ContextBuilder(projectPath)
    builders.set(projectPath, builder)
  }
  return builder
}
