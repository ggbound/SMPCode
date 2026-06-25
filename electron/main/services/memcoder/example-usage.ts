/**
 * MemCoder 使用示例
 * 展示如何集成到现有代码中
 */

import { getMemCoder } from './index'
import log from 'electron-log'

// 示例1：初始化MemCoder
export async function initializeMemCoderExample(projectPath: string) {
  log.info('[MemCoder Example] Initializing...')

  const memCoder = getMemCoder(projectPath)

  // 初始化（会自动分析Git历史）
  await memCoder.initialize()

  // 获取统计信息
  const stats = memCoder.getStats()
  log.info('[MemCoder Example] Stats:', stats)

  return memCoder
}

// 示例2：增强系统提示
export function enhancePromptExample(memCoder: ReturnType<typeof getMemCoder>, basePrompt: string) {
  const enhancedPrompt = memCoder.getEnhancedPrompt(basePrompt)
  log.info('[MemCoder Example] Enhanced prompt length:', enhancedPrompt.length)
  return enhancedPrompt
}

// 示例3：搜索相关历史
export function searchHistoryExample(memCoder: ReturnType<typeof getMemCoder>, query: string) {
  const results = memCoder.searchHistory(query, 5)
  log.info(`[MemCoder Example] Found ${results.length} relevant mappings for:`, query)
  return results
}

// 示例4：获取相关上下文
export function getRelevantContextExample(memCoder: ReturnType<typeof getMemCoder>, userQuery: string) {
  const context = memCoder.getRelevantContext(userQuery, 3)
  log.info('[MemCoder Example] Relevant context:', context)
  return context
}

// 示例5：从用户操作中学习
export async function learnFromUserExample(memCoder: ReturnType<typeof getMemCoder>, intent: string, files: string[]) {
  const mapping = await memCoder.learnFromWork(intent, files)
  if (mapping) {
    log.info('[MemCoder Example] Learned new mapping:', mapping.id)
  }
  return mapping
}

// 示例6：提供反馈
export function provideFeedbackExample(memCoder: ReturnType<typeof getMemCoder>, mappingId: string, isGood: boolean) {
  memCoder.provideFeedback(
    mappingId,
    isGood ? 'approve' : 'reject',
    isGood ? 'This was helpful!' : 'Not quite right...'
  )
  log.info('[MemCoder Example] Feedback recorded')
}

// 示例7：获取建议
export function getSuggestionsExample(memCoder: ReturnType<typeof getMemCoder>, query: string) {
  const suggestions = memCoder.getSuggestions(query)
  log.info('[MemCoder Example] Suggestions:', suggestions)
  return suggestions
}

// 完整的对话流程示例
export async function completeWorkflowExample(projectPath: string, userQuery: string) {
  log.info('[MemCoder Example] Starting complete workflow...')

  // 1. 初始化
  const memCoder = await initializeMemCoderExample(projectPath)

  // 2. 构建基础提示
  const basePrompt = 'You are a helpful coding assistant...'

  // 3. 增强提示（包含项目记忆）
  const enhancedPrompt = enhancePromptExample(memCoder, basePrompt)

  // 4. 获取相关历史
  const relevantContext = getRelevantContextExample(memCoder, userQuery)

  // 5. 组合完整提示
  const fullPrompt = `${enhancedPrompt}\n${relevantContext}`

  // 6. 获取建议
  const suggestions = getSuggestionsExample(memCoder, userQuery)

  log.info('[MemCoder Example] Workflow complete!')

  return {
    fullPrompt,
    suggestions
  }
}
