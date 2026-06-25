/**
 * MemCoder - 记忆存储服务
 * 负责项目记忆的持久化和检索
 */

import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'
import { ProjectMemory, IntentCodeMapping, ProjectPattern, FeedbackRecord, DEFAULT_CONFIG, MemCoderConfig } from './types'

// 记忆存储目录
const MEMORY_DIR_NAME = '.smp-code'
const MEMORY_FILE_NAME = 'project-memory.json'
const FEEDBACK_FILE_NAME = 'feedback.json'
const CONFIG_FILE_NAME = 'memcoder-config.json'

export class MemoryStore {
  private projectPath: string
  private memoryDir: string
  private memoryPath: string
  private feedbackPath: string
  private configPath: string
  private memory: ProjectMemory | null = null
  private feedback: FeedbackRecord[] = []
  private config: MemCoderConfig

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.memoryDir = path.join(projectPath, MEMORY_DIR_NAME)
    this.memoryPath = path.join(this.memoryDir, MEMORY_FILE_NAME)
    this.feedbackPath = path.join(this.memoryDir, FEEDBACK_FILE_NAME)
    this.configPath = path.join(this.memoryDir, CONFIG_FILE_NAME)
    this.config = { ...DEFAULT_CONFIG }

    this.ensureMemoryDir()
    this.loadConfig()
    this.loadMemory()
    this.loadFeedback()
  }

  // 确保记忆目录存在
  private ensureMemoryDir(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true })
      log.info(`[MemCoder] Created memory directory: ${this.memoryDir}`)
    }
  }

  // 加载配置
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8')
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(data) }
        log.info(`[MemCoder] Config loaded:`, this.config)
      }
    } catch (error) {
      log.error('[MemCoder] Failed to load config:', error)
    }
  }

  // 保存配置
  saveConfig(): void {
    try {
      this.ensureMemoryDir()
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
      log.info(`[MemCoder] Config saved`)
    } catch (error) {
      log.error('[MemCoder] Failed to save config:', error)
    }
  }

  // 获取配置
  getConfig(): MemCoderConfig {
    return { ...this.config }
  }

  // 更新配置
  updateConfig(updates: Partial<MemCoderConfig>): void {
    this.config = { ...this.config, ...updates }
    this.saveConfig()
  }

  // 加载项目记忆
  private loadMemory(): void {
    try {
      if (fs.existsSync(this.memoryPath)) {
        const data = fs.readFileSync(this.memoryPath, 'utf-8')
        const parsed = JSON.parse(data) as unknown
        if (parsed && typeof parsed === 'object' && 'mappings' in parsed) {
          this.memory = parsed as ProjectMemory
          log.info(`[MemCoder] Memory loaded: ${this.memory.mappings.length} mappings`)
        } else {
          throw new Error('Invalid memory data')
        }
      } else {
        // 初始化空记忆
        this.memory = {
          projectPath: this.projectPath,
          mappings: [],
          projectPatterns: [],
          lastUpdated: Date.now(),
          version: 1
        }
        this.saveMemory()
      }
    } catch (error) {
      log.error('[MemCoder] Failed to load memory:', error)
      // 初始化空记忆
      this.memory = {
        projectPath: this.projectPath,
        mappings: [],
        projectPatterns: [],
        lastUpdated: Date.now(),
        version: 1
      }
    }
  }

  // 保存项目记忆
  private saveMemory(): void {
    if (!this.memory) return

    try {
      this.ensureMemoryDir()
      this.memory.lastUpdated = Date.now()
      this.memory.version += 1
      fs.writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2))
      log.info(`[MemCoder] Memory saved: ${this.memory.mappings.length} mappings`)
    } catch (error) {
      log.error('[MemCoder] Failed to save memory:', error)
    }
  }

  // 加载反馈记录
  private loadFeedback(): void {
    try {
      if (fs.existsSync(this.feedbackPath)) {
        const data = fs.readFileSync(this.feedbackPath, 'utf-8')
        const parsed = JSON.parse(data) as unknown
        if (Array.isArray(parsed)) {
          this.feedback = parsed as FeedbackRecord[]
          log.info(`[MemCoder] Feedback loaded: ${this.feedback.length} records`)
        }
      }
    } catch (error) {
      log.error('[MemCoder] Failed to load feedback:', error)
    }
  }

  // 保存反馈记录
  private saveFeedback(): void {
    try {
      this.ensureMemoryDir()
      fs.writeFileSync(this.feedbackPath, JSON.stringify(this.feedback, null, 2))
      log.info(`[MemCoder] Feedback saved: ${this.feedback.length} records`)
    } catch (error) {
      log.error('[MemCoder] Failed to save feedback:', error)
    }
  }

  // ==================== 公共方法 ====================

  // 获取项目记忆
  getMemory(): ProjectMemory | null {
    return this.memory ? { ...this.memory } : null
  }

  // 添加意图-代码映射
  addMapping(mapping: IntentCodeMapping): void {
    if (!this.memory) return

    // 检查是否已存在
    const existingIndex = this.memory.mappings.findIndex(m => m.id === mapping.id)
    if (existingIndex >= 0) {
      this.memory.mappings[existingIndex] = mapping
    } else {
      this.memory.mappings.push(mapping)

      // 限制映射数量
      if (this.memory.mappings.length > this.config.maxMappings) {
        // 删除使用最少、置信度最低的映射
        this.memory.mappings.sort((a, b) => {
          const scoreA = a.usageCount * a.confidence
          const scoreB = b.usageCount * b.confidence
          return scoreA - scoreB
        })
        this.memory.mappings = this.memory.mappings.slice(-this.config.maxMappings)
      }
    }

    this.saveMemory()
  }

  // 批量添加映射
  addMappings(mappings: IntentCodeMapping[]): void {
    if (!this.memory) return

    for (const mapping of mappings) {
      const existingIndex = this.memory.mappings.findIndex(m => m.id === mapping.id)
      if (existingIndex >= 0) {
        this.memory.mappings[existingIndex] = mapping
      } else {
        this.memory.mappings.push(mapping)
      }
    }

    // 限制映射数量
    if (this.memory.mappings.length > this.config.maxMappings) {
      this.memory.mappings.sort((a, b) => {
        const scoreA = a.usageCount * a.confidence
        const scoreB = b.usageCount * b.confidence
        return scoreA - scoreB
      })
      this.memory.mappings = this.memory.mappings.slice(-this.config.maxMappings)
    }

    this.saveMemory()
  }

  // 搜索相关映射
  searchMappings(query: string, limit: number = 5): IntentCodeMapping[] {
    if (!this.memory || this.memory.mappings.length === 0) return []

    const queryLower = query.toLowerCase()

    // 简单的文本匹配搜索
    const results = this.memory.mappings
      .filter(m => m.confidence >= this.config.minConfidence)
      .map(mapping => {
        // 计算相关性分数
        let score = 0
        const intentLower = mapping.intent.toLowerCase()

        if (intentLower.includes(queryLower)) score += 10
        if (mapping.codeChanges.some(c => c.filePath.toLowerCase().includes(queryLower))) score += 5

        // 使用次数加分
        score += mapping.usageCount * 2

        return { mapping, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => {
        // 增加使用计数
        item.mapping.usageCount += 1
        return item.mapping
      })

    if (results.length > 0) {
      this.saveMemory()
    }

    return results
  }

  // 验证映射
  verifyMapping(mappingId: string): void {
    if (!this.memory) return

    const mapping = this.memory.mappings.find(m => m.id === mappingId)
    if (mapping) {
      mapping.verifiedAt = Date.now()
      mapping.confidence = Math.min(1, mapping.confidence + 0.2)
      this.saveMemory()
    }
  }

  // 添加项目模式
  addPattern(pattern: ProjectPattern): void {
    if (!this.memory) return

    const existingIndex = this.memory.projectPatterns.findIndex(p => p.id === pattern.id)
    if (existingIndex >= 0) {
      this.memory.projectPatterns[existingIndex] = pattern
    } else {
      this.memory.projectPatterns.push(pattern)
    }

    this.saveMemory()
  }

  // 获取项目模式
  getPatterns(): ProjectPattern[] {
    return this.memory?.projectPatterns || []
  }

  // 添加反馈
  addFeedback(feedback: FeedbackRecord): void {
    this.feedback.push(feedback)
    this.saveFeedback()

    // 根据反馈更新映射
    if (this.memory) {
      const mapping = this.memory.mappings.find(m => m.id === feedback.mappingId)
      if (mapping) {
        if (feedback.type === 'approve') {
          mapping.confidence = Math.min(1, mapping.confidence + 0.2)
        } else if (feedback.type === 'reject') {
          mapping.confidence = Math.max(0, mapping.confidence - 0.15)
        }
        this.saveMemory()
      }
    }
  }

  // 获取反馈列表
  getFeedback(): FeedbackRecord[] {
    return [...this.feedback]
  }

  // 清空反馈
  clearFeedback(): void {
    this.feedback = []
    this.saveFeedback()
  }

  // 获取统计信息
  getStats(): {
    mappingsCount: number
    patternsCount: number
    feedbackCount: number
    lastUpdated: number
  } {
    return {
      mappingsCount: this.memory?.mappings.length || 0,
      patternsCount: this.memory?.projectPatterns.length || 0,
      feedbackCount: this.feedback.length,
      lastUpdated: this.memory?.lastUpdated || 0
    }
  }

  // 清空记忆
  clearMemory(): void {
    this.memory = {
      projectPath: this.projectPath,
      mappings: [],
      projectPatterns: [],
      lastUpdated: Date.now(),
      version: 1
    }
    this.saveMemory()
  }
}

// 项目记忆存储实例缓存
const memoryStores = new Map<string, MemoryStore>()

export function getMemoryStore(projectPath: string): MemoryStore {
  let store = memoryStores.get(projectPath)
  if (!store) {
    store = new MemoryStore(projectPath)
    memoryStores.set(projectPath, store)
  }
  return store
}

export function clearMemoryStoreCache(): void {
  memoryStores.clear()
}
