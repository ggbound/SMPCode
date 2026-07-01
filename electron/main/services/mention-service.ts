/**
 * Mention Service - @ 符号引用服务
 * 支持 @file、@symbol、@code 等引用格式
 * 参考 Cursor 的 @ 符号功能
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import log from 'electron-log'
import { getCodeIndexService } from './code-index'

// 引用类型
export type MentionType = 'file' | 'symbol' | 'directory' | 'code'

// 引用项
export interface MentionItem {
  id: string
  type: MentionType
  name: string
  path: string
  description?: string
  icon?: string
}

// 解析后的引用
export interface ParsedMention {
  type: MentionType
  query: string
  fullMatch: string
  start: number
  end: number
}

// 引用上下文
export interface MentionContext {
  files: string[]
  symbols: string[]
  content: string
}

/**
 * 解析消息中的 @ 引用
 */
export function parseMentions(message: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  
  // @file - 引用文件
  // @symbol - 引用符号
  // @dir 或 @folder - 引用目录
  // @code - 引用代码块
  const mentionRegex = /@(file|symbol|dir|folder|code)?\s*([^\s@]+)/g
  
  let match
  while ((match = mentionRegex.exec(message)) !== null) {
    const type = (match[1] || 'auto') as MentionType | 'auto'
    const query = match[2]
    const fullMatch = match[0]
    const start = match.index
    const end = start + fullMatch.length
    
    // 自动检测类型
    let detectedType: MentionType = 'file'
    if (type === 'auto') {
      // 根据查询内容猜测类型
      if (query.includes('/') || query.includes('\\') || query.endsWith('.ts') || query.endsWith('.js') || query.endsWith('.vue') || query.endsWith('.php')) {
        detectedType = 'file'
      } else if (query[0] === query[0]?.toUpperCase()) {
        detectedType = 'symbol'  // 大写开头可能是类名
      } else {
        detectedType = 'symbol'  // 默认搜索符号
      }
    } else if (type === 'directory') {
      detectedType = 'directory'
    } else {
      detectedType = type as MentionType
    }
    
    mentions.push({
      type: detectedType,
      query,
      fullMatch,
      start,
      end
    })
  }
  
  return mentions
}

/**
 * 搜索可引用的项目
 */
export async function searchMentions(
  projectPath: string,
  query: string,
  type?: MentionType
): Promise<MentionItem[]> {
  const results: MentionItem[] = []
  
  try {
    // 初始化代码索引
    const codeIndex = getCodeIndexService(projectPath)
    await codeIndex.initialize()
    
    if (!type || type === 'file') {
      // 搜索文件
      const files = await searchFiles(projectPath, query)
      results.push(...files.map(f => ({
        id: `file:${f}`,
        type: 'file' as MentionType,
        name: path.basename(f),
        path: f,
        description: f,
        icon: '📄'
      })))
    }
    
    if (!type || type === 'symbol') {
      // 搜索符号
      const symbols = codeIndex.searchSymbols(query)
      results.push(...symbols.slice(0, 10).map(s => ({
        id: `symbol:${s.id}`,
        type: 'symbol' as MentionType,
        name: s.name,
        path: s.filePath,
        description: `${s.type} in ${path.basename(s.filePath)}:${s.line}`,
        icon: s.type === 'function' ? '🔧' : s.type === 'class' ? '🏗️' : '📝'
      })))
    }
    
    if (!type || type === 'directory') {
      // 搜索目录
      const dirs = await searchDirectories(projectPath, query)
      results.push(...dirs.map(d => ({
        id: `dir:${d}`,
        type: 'directory' as MentionType,
        name: path.basename(d) || d,
        path: d,
        description: d,
        icon: '📁'
      })))
    }
    
  } catch (error) {
    log.error('[MentionService] Failed to search mentions:', error)
  }
  
  return results.slice(0, 20)  // 最多返回 20 个结果
}

/**
 * 搜索文件
 */
async function searchFiles(projectPath: string, query: string): Promise<string[]> {
  const results: string[] = []
  const lowerQuery = query.toLowerCase()
  
  try {
    // 使用代码索引获取所有文件
    const codeIndex = getCodeIndexService(projectPath)
    const summary = codeIndex.getProjectSummary()
    
    // 遍历所有文件
    for (const [filePath] of (codeIndex as any).index?.files || []) {
      if (filePath.toLowerCase().includes(lowerQuery)) {
        results.push(filePath)
      }
    }
    
    // 如果没有索引，使用简单的 glob
    if (results.length === 0) {
      const { glob } = await import('glob')
      const files = await glob(`**/*${query}*`, {
        cwd: projectPath,
        absolute: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**']
      })
      results.push(...files.slice(0, 20))
    }
    
  } catch (error) {
    log.error('[MentionService] Failed to search files:', error)
  }
  
  return results.slice(0, 10)
}

/**
 * 搜索目录
 */
async function searchDirectories(projectPath: string, query: string): Promise<string[]> {
  const results: string[] = []
  const lowerQuery = query.toLowerCase()
  
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push(entry.name)
        }
      }
    }
    
  } catch (error) {
    log.error('[MentionService] Failed to search directories:', error)
  }
  
  return results
}

/**
 * 获取引用的内容
 */
export async function getMentionContent(
  projectPath: string,
  mention: ParsedMention
): Promise<string | null> {
  try {
    switch (mention.type) {
      case 'file': {
        const filePath = path.join(projectPath, mention.query)
        const content = await fs.readFile(filePath, 'utf-8')
        return `File: ${mention.query}\n\`\`\`\n${content}\n\`\`\``
      }
      
      case 'symbol': {
        const codeIndex = getCodeIndexService(projectPath)
        const symbols = codeIndex.searchSymbols(mention.query)
        const symbol = symbols.find(s => s.name === mention.query)
        
        if (symbol) {
          const fileContent = await fs.readFile(symbol.filePath, 'utf-8')
          const lines = fileContent.split('\n')
          const startLine = Math.max(0, symbol.line - 5)
          const endLine = Math.min(lines.length, symbol.line + 10)
          const context = lines.slice(startLine, endLine).join('\n')
          
          return `Symbol: ${symbol.name} (${symbol.type}) in ${path.basename(symbol.filePath)}:${symbol.line}\n\`\`\`\n${context}\n\`\`\``
        }
        return null
      }
      
      case 'directory': {
        const dirPath = path.join(projectPath, mention.query)
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        const files = entries
          .filter(e => !e.name.startsWith('.'))
          .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n')
        
        return `Directory: ${mention.query}\n${files}`
      }
      
      default:
        return null
    }
    
  } catch (error) {
    log.error(`[MentionService] Failed to get mention content:`, error)
    return null
  }
}

/**
 * 展开消息中的所有 @ 引用
 */
export async function expandMentions(
  projectPath: string,
  message: string
): Promise<{ expandedMessage: string; contexts: MentionContext }> {
  const mentions = parseMentions(message)
  let expandedMessage = message
  const contexts: MentionContext = {
    files: [],
    symbols: [],
    content: ''
  }
  
  // 从后往前替换，避免位置偏移
  for (let i = mentions.length - 1; i >= 0; i--) {
    const mention = mentions[i]
    const content = await getMentionContent(projectPath, mention)
    
    if (content) {
      // 替换 @ 引用为实际内容
      expandedMessage = 
        expandedMessage.substring(0, mention.start) + 
        `[${mention.query}]` + 
        expandedMessage.substring(mention.end)
      
      // 收集上下文
      contexts.content += `\n\n---\n${content}`
      
      if (mention.type === 'file') {
        contexts.files.push(mention.query)
      } else if (mention.type === 'symbol') {
        contexts.symbols.push(mention.query)
      }
    }
  }
  
  return { expandedMessage, contexts }
}

/**
 * 获取 @ 建议
 */
export async function getMentionSuggestions(
  projectPath: string,
  partialQuery: string,
  type?: MentionType
): Promise<MentionItem[]> {
  if (!partialQuery || partialQuery.length < 1) {
    // 返回最近使用的文件
    return getRecentFiles(projectPath)
  }
  
  return searchMentions(projectPath, partialQuery, type)
}

/**
 * 获取最近使用的文件
 */
async function getRecentFiles(projectPath: string): Promise<MentionItem[]> {
  const results: MentionItem[] = []
  
  try {
    // 获取代码索引中的文件
    const codeIndex = getCodeIndexService(projectPath)
    const summary = codeIndex.getProjectSummary()
    
    // 返回关键文件
    const keyFiles = ['package.json', 'README.md', 'tsconfig.json', '.gitignore']
    
    for (const file of keyFiles) {
      try {
        await fs.access(path.join(projectPath, file))
        results.push({
          id: `file:${file}`,
          type: 'file',
          name: file,
          path: file,
          description: 'Project file',
          icon: '📄'
        })
      } catch {
        // 文件不存在，跳过
      }
    }
    
    // 添加入口文件
    if (summary.mainEntry) {
      results.push({
        id: `file:${summary.mainEntry}`,
        type: 'file',
        name: path.basename(summary.mainEntry),
        path: summary.mainEntry,
        description: 'Main entry',
        icon: '🚀'
      })
    }
    
  } catch (error) {
    log.error('[MentionService] Failed to get recent files:', error)
  }
  
  return results.slice(0, 10)
}
