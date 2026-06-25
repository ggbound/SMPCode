/**
 * MemCoder 类型定义（渲染进程）
 * 复制自 electron 端以避免跨文件夹导入问题
 */

export interface IntentCodeMapping {
  id: string
  intent: string
  codeChanges: CodeChange[]
  commitHash?: string
  projectPath: string
  createdAt: number
  verifiedAt?: number
  confidence: number
  usageCount: number
}

export interface CodeChange {
  filePath: string
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  oldContent?: string
  newContent?: string
  diff?: string
  description?: string
}

export interface AnalyzedCommit {
  hash: string
  message: string
  author: string
  date: string
  intent: string
  changes: CodeChange[]
  isRelevant: boolean
  extractedAt: number
}

export interface ProjectMemory {
  projectPath: string
  mappings: IntentCodeMapping[]
  projectPatterns: ProjectPattern[]
  lastUpdated: number
  version: number
}

export interface ProjectPattern {
  id: string
  type: 'coding' | 'architecture' | 'workflow'
  description: string
  examples: string[]
  files: string[]
  discoveredAt: number
}

export interface FeedbackRecord {
  id: string
  mappingId: string
  type: 'approve' | 'reject' | 'modify'
  feedback: string
  correctedCode?: string
  createdAt: number
}

export interface MemCoderConfig {
  enabled: boolean
  autoAnalyze: boolean
  maxMappings: number
  minConfidence: number
  analyzeOnStartup: boolean
  maxCommitHistory: number
}
