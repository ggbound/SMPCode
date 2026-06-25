/**
 * MemCoder - Git历史分析器
 * 从Git提交历史中提取意图-代码映射
 */

import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'
import simpleGit, { SimpleGit } from 'simple-git'
import { v4 as uuidv4 } from 'uuid'
import { AnalyzedCommit, IntentCodeMapping, CodeChange } from './types'
import { MemoryStore, getMemoryStore } from './memory-store'

export class GitHistoryAnalyzer {
  private projectPath: string
  private git: SimpleGit
  private memoryStore: MemoryStore

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.git = simpleGit(projectPath)
    this.memoryStore = getMemoryStore(projectPath)
  }

  // 分析最近的提交
  async analyzeRecentCommits(maxCount: number = 50): Promise<AnalyzedCommit[]> {
    try {
      log.info(`[MemCoder] Analyzing recent ${maxCount} commits...`)

      const logResult = await this.git.log({ maxCount })
      const analyzedCommits: AnalyzedCommit[] = []

      for (const commit of logResult.all) {
        const analyzed = await this.analyzeCommit(commit.hash)
        if (analyzed) {
          analyzedCommits.push(analyzed)
        }
      }

      log.info(`[MemCoder] Analyzed ${analyzedCommits.length} relevant commits`)
      return analyzedCommits
    } catch (error) {
      log.error('[MemCoder] Failed to analyze git history:', error)
      return []
    }
  }

  // 分析单个提交
  async analyzeCommit(hash: string): Promise<AnalyzedCommit | null> {
    try {
      // 获取提交信息
      const commitLog = await this.git.show([hash, '--stat'])
      const commitData = await this.git.show([hash, '--pretty=format:%H|%an|%ad|%s', '--date=iso'])

      const parts = commitData.split('|')
      if (parts.length < 4) return null

      // 获取变更的文件和差异
      const diff = await this.git.diff([`${hash}^..${hash}`])

      // 解析变更
      const changes = await this.parseDiff(hash, diff)

      // 过滤掉低价值的提交
      if (!this.isRelevantCommit(changes, parts[3])) {
        return null
      }

      // 提取意图（从提交信息推断）
      const intent = this.extractIntent(parts[3], changes)

      const analyzed: AnalyzedCommit = {
        hash: parts[0],
        message: parts[3],
        author: parts[1],
        date: parts[2],
        intent,
        changes,
        isRelevant: true,
        extractedAt: Date.now()
      }

      // 转换为映射并存储
      const mapping = this.commitToMapping(analyzed)
      this.memoryStore.addMapping(mapping)

      return analyzed
    } catch (error) {
      log.error(`[MemCoder] Failed to analyze commit ${hash}:`, error)
      return null
    }
  }

  // 解析diff获取变更
  private async parseDiff(hash: string, diff: string): Promise<CodeChange[]> {
    const changes: CodeChange[] = []

    // 简单的diff解析
    const lines = diff.split('\n')
    let currentFile: string | null = null
    let currentChange: CodeChange | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // 文件变更标记
      if (line.startsWith('diff --git')) {
        if (currentFile && currentChange) {
          changes.push(currentChange)
        }

        const match = line.match(/diff --git a\/(.+) b\/(.+)/)
        if (match) {
          currentFile = match[2]

          // 尝试获取文件内容
          let oldContent: string | undefined
          let newContent: string | undefined

          try {
            oldContent = await this.getFileAtCommit(currentFile, `${hash}^`)
          } catch { /* 忽略 */ }

          try {
            newContent = await this.getFileAtCommit(currentFile, hash)
          } catch { /* 忽略 */ }

          currentChange = {
            filePath: currentFile,
            changeType: 'modify',
            oldContent,
            newContent,
            diff: '',
            description: ''
          }
        }
      } else if (line.startsWith('new file')) {
        if (currentChange) currentChange.changeType = 'create'
      } else if (line.startsWith('deleted file')) {
        if (currentChange) currentChange.changeType = 'delete'
      } else if (line.startsWith('rename from')) {
        if (currentChange) currentChange.changeType = 'rename'
      }

      // 收集diff内容
      if (currentChange && (line.startsWith('+') || line.startsWith('-') || line.startsWith('@@'))) {
        currentChange.diff += line + '\n'
      }
    }

    if (currentFile && currentChange) {
      changes.push(currentChange)
    }

    return changes
  }

  // 获取提交时的文件内容
  private async getFileAtCommit(filePath: string, hash: string): Promise<string | undefined> {
    try {
      return await this.git.show([`${hash}:${filePath}`])
    } catch {
      return undefined
    }
  }

  // 判断提交是否有价值
  private isRelevantCommit(changes: CodeChange[], message: string): boolean {
    // 过滤掉只有配置文件变更的提交
    const configFiles = changes.filter(c =>
      c.filePath.includes('.json') ||
      c.filePath.includes('.lock') ||
      c.filePath.includes('node_modules') ||
      c.filePath.includes('dist/') ||
      c.filePath.includes('build/')
    )

    if (configFiles.length === changes.length && changes.length > 0) {
      return false
    }

    // 过滤掉合并提交
    if (message.startsWith('Merge') || message.startsWith('merge')) {
      return false
    }

    // 过滤掉单个字符变更
    if (changes.length === 1) {
      const change = changes[0]
      if (change.oldContent && change.newContent) {
        const oldLen = change.oldContent.length
        const newLen = change.newContent.length
        if (Math.abs(oldLen - newLen) <= 2) {
          return false
        }
      }
    }

    return true
  }

  // 从提交信息和变更中提取意图
  private extractIntent(message: string, changes: CodeChange[]): string {
    let intent = message.trim()

    // 补充文件变更信息
    if (changes.length > 0) {
      const fileList = changes.slice(0, 5).map(c => c.filePath).join(', ')
      const moreText = changes.length > 5 ? `, and ${changes.length - 5} more` : ''

      intent += `\nFiles affected: ${fileList}${moreText}`

      // 添加变更类型摘要
      const changeTypes = new Set(changes.map(c => c.changeType))
      intent += `\nChanges: ${Array.from(changeTypes).join(', ')}`
    }

    return intent
  }

  // 转换为意图-代码映射
  private commitToMapping(commit: AnalyzedCommit): IntentCodeMapping {
    return {
      id: uuidv4(),
      intent: commit.intent,
      codeChanges: commit.changes,
      commitHash: commit.hash,
      projectPath: this.projectPath,
      createdAt: commit.extractedAt,
      confidence: 0.7, // 初始置信度
      usageCount: 0
    }
  }

  // 从工作区变更中学习（未提交的变更）
  async learnFromWorkingCopy(intent: string, files: string[]): Promise<IntentCodeMapping | null> {
    try {
      const changes: CodeChange[] = []

      for (const filePath of files) {
        const fullPath = path.join(this.projectPath, filePath)
        if (fs.existsSync(fullPath)) {
          const newContent = fs.readFileSync(fullPath, 'utf-8')
          let oldContent: string | undefined

          try {
            oldContent = await this.git.show([`HEAD:${filePath}`])
          } catch {
            // 文件是新创建的
          }

          changes.push({
            filePath,
            changeType: oldContent ? 'modify' : 'create',
            oldContent,
            newContent,
            description: intent
          })
        }
      }

      const mapping: IntentCodeMapping = {
        id: uuidv4(),
        intent,
        codeChanges: changes,
        projectPath: this.projectPath,
        createdAt: Date.now(),
        confidence: 0.8, // 用户明确提供的意图，置信度更高
        usageCount: 0
      }

      this.memoryStore.addMapping(mapping)
      log.info(`[MemCoder] Learned from working copy: ${intent}`)
      return mapping
    } catch (error) {
      log.error('[MemCoder] Failed to learn from working copy:', error)
      return null
    }
  }
}

// 分析器缓存
const analyzers = new Map<string, GitHistoryAnalyzer>()

export function getGitAnalyzer(projectPath: string): GitHistoryAnalyzer {
  let analyzer = analyzers.get(projectPath)
  if (!analyzer) {
    analyzer = new GitHistoryAnalyzer(projectPath)
    analyzers.set(projectPath, analyzer)
  }
  return analyzer
}
