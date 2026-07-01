/**
 * Diff Service - 文件差异服务
 * 生成统一 diff 格式，支持预览和应用
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import log from 'electron-log'

// 差异块
export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

// 差异行
export interface DiffLine {
  type: 'context' | 'addition' | 'deletion'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
}

// 文件差异
export interface FileDiff {
  path: string
  oldContent: string
  newContent: string
  hunks: DiffHunk[]
  stats: {
    additions: number
    deletions: number
    changes: number
  }
}

// 待应用的编辑
export interface PendingEdit {
  id: string
  path: string
  oldContent: string
  newContent: string
  timestamp: number
  applied: boolean
}

// 存储待应用的编辑
const pendingEdits = new Map<string, PendingEdit>()

/**
 * 生成两个文本的差异
 */
export function generateDiff(oldContent: string, newContent: string, filePath: string = ''): FileDiff {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  
  let oldLineNum = 1
  let newLineNum = 1
  
  // 使用 Myers 算法的简化版本
  const { changes } = computeLCS(oldLines, newLines)
  
  let additions = 0
  let deletions = 0
  
  for (const change of changes) {
    // 开始新 hunk
    if (!currentHunk || change.oldIndex - currentHunk.oldStart > 7) {
      if (currentHunk) {
        hunks.push(currentHunk)
      }
      currentHunk = {
        oldStart: Math.max(1, change.oldIndex - 3),
        oldLines: 0,
        newStart: Math.max(1, change.newIndex - 3),
        newLines: 0,
        lines: []
      }
    }
    
    // 添加上下文行
    const contextStart = Math.max(0, change.oldIndex - 3)
    const contextEnd = Math.min(oldLines.length, change.oldIndex)
    
    for (let i = contextStart; i < contextEnd; i++) {
      if (currentHunk.lines.length === 0 || 
          currentHunk.lines[currentHunk.lines.length - 1].type !== 'context' ||
          currentHunk.lines[currentHunk.lines.length - 1].oldLineNumber !== i + 1) {
        currentHunk.lines.push({
          type: 'context',
          oldLineNumber: i + 1,
          newLineNumber: i + 1 - contextStart + currentHunk.newStart,
          content: oldLines[i]
        })
        currentHunk.oldLines++
        currentHunk.newLines++
      }
    }
    
    // 添加变更行
    if (change.type === 'deletion') {
      currentHunk.lines.push({
        type: 'deletion',
        oldLineNumber: change.oldIndex + 1,
        content: oldLines[change.oldIndex]
      })
      currentHunk.oldLines++
      deletions++
    } else if (change.type === 'addition') {
      currentHunk.lines.push({
        type: 'addition',
        newLineNumber: change.newIndex + 1,
        content: newLines[change.newIndex]
      })
      currentHunk.newLines++
      additions++
    }
  }
  
  if (currentHunk) {
    hunks.push(currentHunk)
  }
  
  return {
    path: filePath,
    oldContent,
    newContent,
    hunks,
    stats: {
      additions,
      deletions,
      changes: additions + deletions
    }
  }
}

/**
 * 计算最长公共子序列 (简化版 Myers 算法)
 */
function computeLCS(oldLines: string[], newLines: string[]): {
  changes: Array<{ type: 'deletion' | 'addition'; oldIndex: number; newIndex: number }>
} {
  const changes: Array<{ type: 'deletion' | 'addition'; oldIndex: number; newIndex: number }> = []
  
  // 使用动态规划找到差异
  const m = oldLines.length
  const n = newLines.length
  
  // 如果完全相同
  if (m === n && oldLines.every((line, i) => line === newLines[i])) {
    return { changes: [] }
  }
  
  // 简化：逐行比较
  let oldIdx = 0
  let newIdx = 0
  
  while (oldIdx < m || newIdx < n) {
    if (oldIdx < m && newIdx < n && oldLines[oldIdx] === newLines[newIdx]) {
      // 相同行
      oldIdx++
      newIdx++
    } else if (newIdx < n && (oldIdx >= m || !newLines.slice(newIdx).includes(oldLines[oldIdx]))) {
      // 新增行
      changes.push({ type: 'addition', oldIndex: oldIdx, newIndex: newIdx })
      newIdx++
    } else if (oldIdx < m) {
      // 删除行
      changes.push({ type: 'deletion', oldIndex: oldIdx, newIndex: newIdx })
      oldIdx++
    } else {
      break
    }
  }
  
  return { changes }
}

/**
 * 生成统一 diff 格式字符串
 */
export function formatUnifiedDiff(diff: FileDiff): string {
  const lines: string[] = []
  lines.push(`--- a/${diff.path}`)
  lines.push(`+++ b/${diff.path}`)
  
  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    
    for (const line of hunk.lines) {
      switch (line.type) {
        case 'context':
          lines.push(` ${line.content}`)
          break
        case 'addition':
          lines.push(`+${line.content}`)
          break
        case 'deletion':
          lines.push(`-${line.content}`)
          break
      }
    }
  }
  
  return lines.join('\n')
}

/**
 * 创建待应用的编辑
 */
export function createPendingEdit(
  filePath: string,
  oldContent: string,
  newContent: string
): PendingEdit {
  const id = `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const edit: PendingEdit = {
    id,
    path: filePath,
    oldContent,
    newContent,
    timestamp: Date.now(),
    applied: false
  }
  
  pendingEdits.set(id, edit)
  
  // 清理旧编辑（保留最近 50 个）
  const sortedEdits = Array.from(pendingEdits.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
  
  if (sortedEdits.length > 50) {
    for (const [key] of sortedEdits.slice(50)) {
      pendingEdits.delete(key)
    }
  }
  
  log.info(`[DiffService] Created pending edit: ${id} for ${filePath}`)
  return edit
}

/**
 * 应用待处理的编辑
 */
export async function applyEdit(editId: string, cwd: string): Promise<boolean> {
  const edit = pendingEdits.get(editId)
  if (!edit) {
    log.error(`[DiffService] Edit not found: ${editId}`)
    return false
  }
  
  if (edit.applied) {
    log.warn(`[DiffService] Edit already applied: ${editId}`)
    return false
  }
  
  try {
    const fullPath = path.join(cwd, edit.path)
    
    // 验证文件没有被外部修改
    const currentContent = await fs.readFile(fullPath, 'utf-8')
    if (currentContent !== edit.oldContent) {
      log.error(`[DiffService] File changed since edit was created: ${edit.path}`)
      return false
    }
    
    // 应用编辑
    await fs.writeFile(fullPath, edit.newContent, 'utf-8')
    edit.applied = true
    
    log.info(`[DiffService] Applied edit: ${editId} to ${edit.path}`)
    return true
    
  } catch (error) {
    log.error(`[DiffService] Failed to apply edit: ${editId}`, error)
    return false
  }
}

/**
 * 取消待处理的编辑
 */
export function cancelEdit(editId: string): boolean {
  const edit = pendingEdits.get(editId)
  if (!edit) {
    return false
  }
  
  if (edit.applied) {
    log.warn(`[DiffService] Cannot cancel already applied edit: ${editId}`)
    return false
  }
  
  pendingEdits.delete(editId)
  log.info(`[DiffService] Cancelled edit: ${editId}`)
  return true
}

/**
 * 获取待处理的编辑
 */
export function getPendingEdit(editId: string): PendingEdit | null {
  return pendingEdits.get(editId) || null
}

/**
 * 获取所有待处理的编辑
 */
export function getAllPendingEdits(): PendingEdit[] {
  return Array.from(pendingEdits.values())
    .filter(edit => !edit.applied)
    .sort((a, b) => b.timestamp - a.timestamp)
}
