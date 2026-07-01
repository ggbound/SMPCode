/**
 * Operation History Service - 操作历史服务
 * 实现撤销/重做功能，记录所有文件操作
 * 参考 VS Code、Claude Code 的撤销机制
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import log from 'electron-log'
import { createHash } from 'crypto'
import { writeFile as writeFileService } from './files-service'

// 操作类型
export type OperationType = 
  | 'file_edit' 
  | 'file_write' 
  | 'file_delete' 
  | 'file_create'
  | 'file_append'

// 操作记录
export interface Operation {
  id: string
  type: OperationType
  timestamp: number
  filePath: string
  projectPath: string
  // 操作前的状态
  oldContent?: string
  oldHash?: string
  // 操作后的状态
  newContent?: string
  newHash?: string
  // 元数据
  metadata?: {
    description?: string
    toolName?: string
    aiMessage?: string
  }
}

// 操作历史栈
interface HistoryStack {
  operations: Operation[]
  currentIndex: number  // 当前位置，用于撤销/重做
  maxSize: number       // 最大历史记录数
}

// 项目历史存储
const projectHistories = new Map<string, HistoryStack>()

// 默认最大历史记录数
const DEFAULT_MAX_HISTORY = 100

/**
 * 获取或创建项目历史栈
 */
function getHistoryStack(projectPath: string): HistoryStack {
  if (!projectHistories.has(projectPath)) {
    projectHistories.set(projectPath, {
      operations: [],
      currentIndex: -1,
      maxSize: DEFAULT_MAX_HISTORY
    })
  }
  return projectHistories.get(projectPath)!
}

/**
 * 记录操作
 */
export async function recordOperation(
  projectPath: string,
  type: OperationType,
  filePath: string,
  oldContent?: string,
  newContent?: string,
  metadata?: Operation['metadata']
): Promise<Operation> {
  const stack = getHistoryStack(projectPath)
  
  // 如果当前位置不在栈顶，删除当前位置之后的所有操作（重做历史）
  if (stack.currentIndex < stack.operations.length - 1) {
    stack.operations = stack.operations.slice(0, stack.currentIndex + 1)
  }
  
  // 计算哈希
  const oldHash = oldContent ? createHash('md5').update(oldContent).digest('hex') : undefined
  const newHash = newContent ? createHash('md5').update(newContent).digest('hex') : undefined
  
  const operation: Operation = {
    id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    timestamp: Date.now(),
    filePath,
    projectPath,
    oldContent,
    oldHash,
    newContent,
    newHash,
    metadata
  }
  
  // 添加到历史栈
  stack.operations.push(operation)
  stack.currentIndex++
  
  // 限制历史记录大小
  if (stack.operations.length > stack.maxSize) {
    stack.operations.shift()
    stack.currentIndex--
  }
  
  log.info(`[OperationHistory] Recorded ${type} on ${filePath}`)
  return operation
}

/**
 * 撤销操作
 */
export async function undo(projectPath: string): Promise<Operation | null> {
  const stack = getHistoryStack(projectPath)
  
  if (stack.currentIndex < 0) {
    log.warn('[OperationHistory] Nothing to undo')
    return null
  }
  
  const operation = stack.operations[stack.currentIndex]
  
  try {
    const fullPath = path.join(projectPath, operation.filePath)
    
    switch (operation.type) {
      case 'file_edit':
      case 'file_write':
      case 'file_append':
        if (operation.oldContent !== undefined) {
          writeFileService(fullPath, operation.oldContent)
          log.info(`[OperationHistory] Undid ${operation.type} on ${operation.filePath}`)
        }
        break
        
      case 'file_delete':
        if (operation.oldContent !== undefined) {
          writeFileService(fullPath, operation.oldContent)
          log.info(`[OperationHistory] Restored deleted file ${operation.filePath}`)
        }
        break
        
      case 'file_create':
        await fs.unlink(fullPath)
        log.info(`[OperationHistory] Deleted created file ${operation.filePath}`)
        break
    }
    
    stack.currentIndex--
    return operation
    
  } catch (error) {
    log.error(`[OperationHistory] Failed to undo operation:`, error)
    return null
  }
}

/**
 * 重做操作
 */
export async function redo(projectPath: string): Promise<Operation | null> {
  const stack = getHistoryStack(projectPath)
  
  if (stack.currentIndex >= stack.operations.length - 1) {
    log.warn('[OperationHistory] Nothing to redo')
    return null
  }
  
  const operation = stack.operations[stack.currentIndex + 1]
  
  try {
    const fullPath = path.join(projectPath, operation.filePath)
    
    switch (operation.type) {
      case 'file_edit':
      case 'file_write':
      case 'file_append':
        if (operation.newContent !== undefined) {
          writeFileService(fullPath, operation.newContent)
          log.info(`[OperationHistory] Redid ${operation.type} on ${operation.filePath}`)
        }
        break
        
      case 'file_delete':
        await fs.unlink(fullPath)
        log.info(`[OperationHistory] Redid delete on ${operation.filePath}`)
        break
        
      case 'file_create':
        if (operation.newContent !== undefined) {
          writeFileService(fullPath, operation.newContent)
          log.info(`[OperationHistory] Redid create on ${operation.filePath}`)
        }
        break
    }
    
    stack.currentIndex++
    return operation
    
  } catch (error) {
    log.error(`[OperationHistory] Failed to redo operation:`, error)
    return null
  }
}

/**
 * 获取操作历史
 */
export function getHistory(projectPath: string): Operation[] {
  const stack = getHistoryStack(projectPath)
  return [...stack.operations]
}

/**
 * 获取当前位置
 */
export function getCurrentIndex(projectPath: string): number {
  const stack = getHistoryStack(projectPath)
  return stack.currentIndex
}

/**
 * 是否可以撤销
 */
export function canUndo(projectPath: string): boolean {
  const stack = getHistoryStack(projectPath)
  return stack.currentIndex >= 0
}

/**
 * 是否可以重做
 */
export function canRedo(projectPath: string): boolean {
  const stack = getHistoryStack(projectPath)
  return stack.currentIndex < stack.operations.length - 1
}

/**
 * 清空历史
 */
export function clearHistory(projectPath: string): void {
  projectHistories.delete(projectPath)
  log.info(`[OperationHistory] Cleared history for ${projectPath}`)
}

/**
 * 获取最近的操作
 */
export function getRecentOperations(projectPath: string, count: number = 10): Operation[] {
  const stack = getHistoryStack(projectPath)
  const start = Math.max(0, stack.currentIndex - count + 1)
  return stack.operations.slice(start, stack.currentIndex + 1)
}

/**
 * 获取撤销栈描述
 */
export function getUndoDescription(projectPath: string): string | null {
  const stack = getHistoryStack(projectPath)
  if (stack.currentIndex < 0) return null
  
  const op = stack.operations[stack.currentIndex]
  const typeNames: Record<OperationType, string> = {
    'file_edit': '编辑',
    'file_write': '写入',
    'file_delete': '删除',
    'file_create': '创建',
    'file_append': '追加'
  }
  
  return `${typeNames[op.type]} ${path.basename(op.filePath)}`
}

/**
 * 获取重做栈描述
 */
export function getRedoDescription(projectPath: string): string | null {
  const stack = getHistoryStack(projectPath)
  if (stack.currentIndex >= stack.operations.length - 1) return null
  
  const op = stack.operations[stack.currentIndex + 1]
  const typeNames: Record<OperationType, string> = {
    'file_edit': '编辑',
    'file_write': '写入',
    'file_delete': '删除',
    'file_create': '创建',
    'file_append': '追加'
  }
  
  return `${typeNames[op.type]} ${path.basename(op.filePath)}`
}
