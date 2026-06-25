/**
 * MemCoder - 类型定义
 * 实现从Git历史中学习的长期记忆系统
 */

// ==================== 核心数据结构 ====================

// 意图-代码映射关系
export interface IntentCodeMapping {
  id: string
  intent: string              // 用户意图描述
  codeChanges: CodeChange[]   // 对应的代码变更
  commitHash?: string         // 对应的Git提交哈希
  projectPath: string         // 项目路径
  createdAt: number           // 创建时间戳
  verifiedAt?: number         // 人类验证时间
  confidence: number          // 置信度 (0-1)
  usageCount: number          // 使用次数
}

// 代码变更
export interface CodeChange {
  filePath: string
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  oldContent?: string
  newContent?: string
  diff?: string               // Git diff格式
  description?: string        // 变更描述
}

// Git提交分析结果
export interface AnalyzedCommit {
  hash: string
  message: string
  author: string
  date: string
  intent: string              // AI提取的意图
  changes: CodeChange[]
  isRelevant: boolean         // 是否是有价值的提交
  extractedAt: number
}

// 项目记忆
export interface ProjectMemory {
  projectPath: string
  mappings: IntentCodeMapping[]
  projectPatterns: ProjectPattern[]
  lastUpdated: number
  version: number
}

// 项目模式/规范
export interface ProjectPattern {
  id: string
  type: 'coding' | 'architecture' | 'workflow'
  description: string
  examples: string[]
  files: string[]            // 相关文件
  discoveredAt: number
}

// 反馈记录
export interface FeedbackRecord {
  id: string
  mappingId: string
  type: 'approve' | 'reject' | 'modify'
  feedback: string
  correctedCode?: string
  createdAt: number
}

// ==================== 配置 ====================

export interface MemCoderConfig {
  enabled: boolean
  autoAnalyze: boolean        // 自动分析Git历史
  maxMappings: number         // 最大映射数量
  minConfidence: number       // 最低置信度
  analyzeOnStartup: boolean   // 启动时分析
  maxCommitHistory: number    // 分析的最大提交数
}

export const DEFAULT_CONFIG: MemCoderConfig = {
  enabled: true,
  autoAnalyze: true,
  maxMappings: 1000,
  minConfidence: 0.6,
  analyzeOnStartup: true,
  maxCommitHistory: 100
}
