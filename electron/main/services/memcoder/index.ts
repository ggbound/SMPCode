/**
 * MemCoder - 主入口
 * 整合所有MemCoder功能，提供统一的API
 */

import log from 'electron-log'
import { MemoryStore, getMemoryStore } from './memory-store'
import { GitHistoryAnalyzer, getGitAnalyzer } from './git-history-analyzer'
import { ContextBuilder, getContextBuilder } from './context-builder'
import { IntentCodeMapping, FeedbackRecord, MemCoderConfig } from './types'

export class MemCoder {
  private projectPath: string
  private memoryStore: MemoryStore
  private gitAnalyzer: GitHistoryAnalyzer
  private contextBuilder: ContextBuilder
  private initialized: boolean = false

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.memoryStore = getMemoryStore(projectPath)
    this.gitAnalyzer = getGitAnalyzer(projectPath)
    this.contextBuilder = getContextBuilder(projectPath)
  }

  // 初始化（可选的Git历史分析）
  async initialize(): Promise<void> {
    if (this.initialized) return

    const config = this.memoryStore.getConfig()

    if (config.enabled && config.analyzeOnStartup) {
      log.info('[MemCoder] Initializing...')
      
      try {
        await this.gitAnalyzer.analyzeRecentCommits(config.maxCommitHistory)
        this.initialized = true
        log.info('[MemCoder] Initialized successfully')
      } catch (error) {
        log.error('[MemCoder] Initialization failed:', error)
      }
    }
  }

  // 获取配置
  getConfig(): MemCoderConfig {
    return this.memoryStore.getConfig()
  }

  // 更新配置
  updateConfig(config: Partial<MemCoderConfig>): void {
    this.memoryStore.updateConfig(config)
  }

  // 启用/禁用
  setEnabled(enabled: boolean): void {
    this.memoryStore.updateConfig({ enabled })
  }

  // 分析Git历史
  async analyzeGitHistory(maxCommits: number = 50): Promise<number> {
    const commits = await this.gitAnalyzer.analyzeRecentCommits(maxCommits)
    return commits.length
  }

  // 从工作区学习
  async learnFromWork(intent: string, files: string[]): Promise<IntentCodeMapping | null> {
    return this.gitAnalyzer.learnFromWorkingCopy(intent, files)
  }

  // 搜索相关的历史模式
  searchHistory(query: string, limit: number = 5): IntentCodeMapping[] {
    return this.memoryStore.searchMappings(query, limit)
  }

  // 获取增强的系统提示
  getEnhancedPrompt(basePrompt: string): string {
    return this.contextBuilder.buildSystemPrompt(basePrompt)
  }

  // 获取相关历史上下文
  getRelevantContext(query: string, limit: number = 3): string {
    return this.contextBuilder.buildRelevantContext(query, limit)
  }

  // 提供反馈
  provideFeedback(mappingId: string, type: 'approve' | 'reject' | 'modify', feedback: string): void {
    const record: FeedbackRecord = {
      id: crypto.randomUUID(),
      mappingId,
      type,
      feedback,
      createdAt: Date.now()
    }
    this.memoryStore.addFeedback(record)

    if (type === 'approve') {
      this.memoryStore.verifyMapping(mappingId)
    }
  }

  // 获取统计信息
  getStats() {
    return this.memoryStore.getStats()
  }

  // 获取记忆摘要
  getMemorySummary(): string {
    return this.contextBuilder.getMemorySummary()
  }

  // 获取建议的变更
  getSuggestions(query: string) {
    return this.contextBuilder.getSuggestedChanges(query)
  }

  // 获取反馈列表
  getFeedback() {
    return this.memoryStore.getFeedback()
  }

  // 导出记忆数据
  exportMemory() {
    return this.memoryStore.getMemory()
  }

  // 清空记忆
  clearMemory(): void {
    this.memoryStore.clearMemory()
  }
}

// 实例缓存
const memCoders = new Map<string, MemCoder>()

export function getMemCoder(projectPath: string): MemCoder {
  let memCoder = memCoders.get(projectPath)
  if (!memCoder) {
    memCoder = new MemCoder(projectPath)
    memCoders.set(projectPath, memCoder)
  }
  return memCoder
}

export * from './types'
export { MemoryStore, getMemoryStore } from './memory-store'
export { GitHistoryAnalyzer, getGitAnalyzer } from './git-history-analyzer'
export { ContextBuilder, getContextBuilder } from './context-builder'
