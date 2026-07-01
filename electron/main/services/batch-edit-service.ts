/**
 * Batch Edit Service - 批量文件编辑服务
 * 支持一次编辑多个文件，统一预览和应用
 * 参考 VS Code 的多文件编辑和 Composer 模式
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import log from 'electron-log'
import { generateDiff, FileDiff } from './diff-service'

// 批量编辑项
export interface BatchEditItem {
  id: string
  filePath: string
  oldContent: string
  newContent: string
  diff: FileDiff
  status: 'pending' | 'applied' | 'failed' | 'cancelled'
  error?: string
}

// 批量编辑会话
export interface BatchEditSession {
  id: string
  projectPath: string
  description: string
  timestamp: number
  items: BatchEditItem[]
  status: 'pending' | 'applying' | 'completed' | 'cancelled'
  appliedCount: number
  failedCount: number
}

// 会话存储
const sessions = new Map<string, BatchEditSession>()

/**
 * 创建批量编辑会话
 */
export function createBatchEditSession(
  projectPath: string,
  description: string,
  edits: Array<{ filePath: string; oldContent: string; newContent: string }>
): BatchEditSession {
  const id = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const items: BatchEditItem[] = edits.map((edit, index) => ({
    id: `${id}-item-${index}`,
    filePath: edit.filePath,
    oldContent: edit.oldContent,
    newContent: edit.newContent,
    diff: generateDiff(edit.oldContent, edit.newContent, edit.filePath),
    status: 'pending'
  }))
  
  const session: BatchEditSession = {
    id,
    projectPath,
    description,
    timestamp: Date.now(),
    items,
    status: 'pending',
    appliedCount: 0,
    failedCount: 0
  }
  
  sessions.set(id, session)
  
  // 清理旧会话（保留最近 10 个）
  const sortedSessions = Array.from(sessions.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
  
  if (sortedSessions.length > 10) {
    for (const [key] of sortedSessions.slice(10)) {
      sessions.delete(key)
    }
  }
  
  log.info(`[BatchEdit] Created session: ${id} with ${items.length} files`)
  return session
}

/**
 * 获取会话
 */
export function getBatchEditSession(id: string): BatchEditSession | null {
  return sessions.get(id) || null
}

/**
 * 应用单个编辑项
 */
export async function applyBatchEditItem(
  sessionId: string,
  itemId: string
): Promise<boolean> {
  const session = sessions.get(sessionId)
  if (!session) {
    log.error(`[BatchEdit] Session not found: ${sessionId}`)
    return false
  }
  
  const item = session.items.find(i => i.id === itemId)
  if (!item) {
    log.error(`[BatchEdit] Item not found: ${itemId}`)
    return false
  }
  
  if (item.status === 'applied') {
    log.warn(`[BatchEdit] Item already applied: ${itemId}`)
    return true
  }
  
  try {
    const fullPath = path.join(session.projectPath, item.filePath)
    
    // 验证文件没有被外部修改
    const currentContent = await fs.readFile(fullPath, 'utf-8')
    if (currentContent !== item.oldContent) {
      item.status = 'failed'
      item.error = 'File has been modified externally'
      session.failedCount++
      log.error(`[BatchEdit] File modified externally: ${item.filePath}`)
      return false
    }
    
    // 应用编辑
    await fs.writeFile(fullPath, item.newContent, 'utf-8')
    item.status = 'applied'
    session.appliedCount++
    
    log.info(`[BatchEdit] Applied item: ${itemId} - ${item.filePath}`)
    return true
    
  } catch (error) {
    item.status = 'failed'
    item.error = error instanceof Error ? error.message : String(error)
    session.failedCount++
    log.error(`[BatchEdit] Failed to apply item: ${itemId}`, error)
    return false
  }
}

/**
 * 应用整个会话的所有编辑
 */
export async function applyBatchEditSession(sessionId: string): Promise<{
  success: boolean
  applied: number
  failed: number
  total: number
}> {
  const session = sessions.get(sessionId)
  if (!session) {
    log.error(`[BatchEdit] Session not found: ${sessionId}`)
    return { success: false, applied: 0, failed: 0, total: 0 }
  }
  
  session.status = 'applying'
  
  for (const item of session.items) {
    if (item.status === 'pending') {
      await applyBatchEditItem(sessionId, item.id)
    }
  }
  
  session.status = session.failedCount > 0 ? 'completed' : 'completed'
  
  log.info(`[BatchEdit] Session ${sessionId} completed: ${session.appliedCount} applied, ${session.failedCount} failed`)
  
  return {
    success: session.failedCount === 0,
    applied: session.appliedCount,
    failed: session.failedCount,
    total: session.items.length
  }
}

/**
 * 取消单个编辑项
 */
export function cancelBatchEditItem(sessionId: string, itemId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  
  const item = session.items.find(i => i.id === itemId)
  if (!item) return false
  
  if (item.status === 'applied') {
    log.warn(`[BatchEdit] Cannot cancel already applied item: ${itemId}`)
    return false
  }
  
  item.status = 'cancelled'
  log.info(`[BatchEdit] Cancelled item: ${itemId}`)
  return true
}

/**
 * 取消整个会话
 */
export function cancelBatchEditSession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  
  for (const item of session.items) {
    if (item.status === 'pending') {
      item.status = 'cancelled'
    }
  }
  
  session.status = 'cancelled'
  log.info(`[BatchEdit] Cancelled session: ${sessionId}`)
  return true
}

/**
 * 获取会话统计
 */
export function getBatchEditStats(sessionId: string): {
  total: number
  pending: number
  applied: number
  failed: number
  cancelled: number
} | null {
  const session = sessions.get(sessionId)
  if (!session) return null
  
  return {
    total: session.items.length,
    pending: session.items.filter(i => i.status === 'pending').length,
    applied: session.items.filter(i => i.status === 'applied').length,
    failed: session.items.filter(i => i.status === 'failed').length,
    cancelled: session.items.filter(i => i.status === 'cancelled').length
  }
}

/**
 * 获取所有会话
 */
export function getAllBatchEditSessions(): BatchEditSession[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * 删除会话
 */
export function deleteBatchEditSession(sessionId: string): boolean {
  const deleted = sessions.delete(sessionId)
  if (deleted) {
    log.info(`[BatchEdit] Deleted session: ${sessionId}`)
  }
  return deleted
}

/**
 * 从 AI 响应解析批量编辑
 */
export function parseBatchEditsFromAIResponse(
  projectPath: string,
  response: string
): Array<{ filePath: string; oldContent: string; newContent: string }> | null {
  const edits: Array<{ filePath: string; oldContent: string; newContent: string }> = []
  
  // 匹配格式：
  // FILE: path/to/file.ts
  // ```
  // old content
  // ```
  // ->
  // ```
  // new content
  // ```
  
  const fileBlockRegex = /FILE:\s*(.+?)\n```(\w+)?\n([\s\S]*?)```\s*->\s*```(\w+)?\n([\s\S]*?)```/g
  
  let match
  while ((match = fileBlockRegex.exec(response)) !== null) {
    const filePath = match[1].trim()
    const oldContent = match[3]
    const newContent = match[5]
    
    edits.push({ filePath, oldContent, newContent })
  }
  
  // 如果没有匹配到，尝试另一种格式
  if (edits.length === 0) {
    // 格式：### File: path/to/file.ts
    // ```
    // content
    // ```
    const altRegex = /###?\s*File:\s*(.+?)\n```(\w+)?\n([\s\S]*?)```/g
    
    while ((match = altRegex.exec(response)) !== null) {
      const filePath = match[1].trim()
      const newContent = match[3]
      
      // 尝试读取旧内容
      try {
        const fullPath = path.join(projectPath, filePath)
        const oldContent = fs.readFile(fullPath, 'utf-8').toString()
        edits.push({ filePath, oldContent, newContent })
      } catch {
        // 文件可能不存在，跳过
        edits.push({ filePath, oldContent: '', newContent })
      }
    }
  }
  
  return edits.length > 0 ? edits : null
}
