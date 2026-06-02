/**
 * File Service - VSCode-style 文件系统服务
 * 提供统一的文件系统操作接口，包括文件读写、监听、批量操作等
 */

import { EventEmitter } from 'events'

// API 基础 URL
const API_BASE = 'http://localhost:3847/api'

// 文件节点接口
export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isOpen?: boolean
  isLoading?: boolean
  gitStatus?: 'modified' | 'staged' | 'untracked' | 'conflicted' | null
}

// 文件变化事件类型
export type FileChangeEventType = 'create' | 'change' | 'rename' | 'delete'

// 文件变化事件
export interface FileChangeEvent {
  type: FileChangeEventType
  path: string
  oldPath?: string  // 用于 rename 事件
  isDirectory?: boolean
}

// 文件内容缓存
interface FileContentCache {
  content: string
  mtime: number
  version: number
}

/**
 * FileService - 文件系统服务
 * 单例模式，全局统一使用
 */
class FileService extends EventEmitter {
  private static instance: FileService
  private watchers: Map<string, boolean> = new Map()
  private contentCache: Map<string, FileContentCache> = new Map()
  private versionCounter: number = 0
  private currentProjectPath: string | null = null

  // 单例获取
  static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService()
    }
    return FileService.instance
  }

  private constructor() {
    super()
    this.setupFileWatcher()
  }

  /**
   * 设置当前项目路径
   */
  setProjectPath(path: string | null) {
    if (this.currentProjectPath && path !== this.currentProjectPath) {
      // 切换项目时停止旧项目的监听
      this.stopWatching(this.currentProjectPath)
    }
    this.currentProjectPath = path
    if (path) {
      this.startWatching(path)
    }
  }

  /**
   * 获取当前项目路径
   */
  getProjectPath(): string | null {
    return this.currentProjectPath
  }

  /**
   * 读取目录内容
   */
  async readDirectory(dirPath: string): Promise<FileNode[]> {
    try {
      const res = await fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(dirPath)}`)
      if (!res.ok) {
        throw new Error(`Failed to read directory: ${res.status}`)
      }
      const data = await res.json()
      return data.items || []
    } catch (error) {
      console.error('[FileService] Failed to read directory:', error)
      throw error
    }
  }

  /**
   * 读取文件内容
   */
  async readFile(filePath: string): Promise<string> {
    try {
      // 检查缓存
      const cached = this.contentCache.get(filePath)
      if (cached) {
        // 这里可以添加缓存验证逻辑（如检查文件修改时间）
        console.log('[FileService] Using cached content for:', filePath)
      }

      const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) {
        throw new Error(`Failed to read file: ${res.status}`)
      }
      const data = await res.json()
      const content = data.content || ''

      // 更新缓存
      this.contentCache.set(filePath, {
        content,
        mtime: Date.now(),
        version: ++this.versionCounter
      })

      return content
    } catch (error) {
      console.error('[FileService] Failed to read file:', error)
      throw error
    }
  }

  /**
   * 写入文件内容
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content })
      })
      if (!res.ok) {
        throw new Error(`Failed to write file: ${res.status}`)
      }

      // 更新缓存
      this.contentCache.set(filePath, {
        content,
        mtime: Date.now(),
        version: ++this.versionCounter
      })

      // 触发文件变化事件
      this.emit('fileChanged', {
        type: 'change',
        path: filePath,
        isDirectory: false
      } as FileChangeEvent)
    } catch (error) {
      console.error('[FileService] Failed to write file:', error)
      throw error
    }
  }

  /**
   * 创建目录
   */
  async createDirectory(dirPath: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/fs/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      })
      if (!res.ok) {
        throw new Error(`Failed to create directory: ${res.status}`)
      }

      this.emit('fileChanged', {
        type: 'create',
        path: dirPath,
        isDirectory: true
      } as FileChangeEvent)
    } catch (error) {
      console.error('[FileService] Failed to create directory:', error)
      throw error
    }
  }

  /**
   * 重命名文件/目录
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/fs/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
      })
      if (!res.ok) {
        throw new Error(`Failed to rename: ${res.status}`)
      }

      // 更新缓存
      const cached = this.contentCache.get(oldPath)
      if (cached) {
        this.contentCache.delete(oldPath)
        this.contentCache.set(newPath, cached)
      }

      this.emit('fileChanged', {
        type: 'rename',
        path: newPath,
        oldPath,
        isDirectory: false  // 需要根据实际情况判断
      } as FileChangeEvent)
    } catch (error) {
      console.error('[FileService] Failed to rename:', error)
      throw error
    }
  }

  /**
   * 删除文件/目录
   */
  async delete(path: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/fs/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      if (!res.ok) {
        throw new Error(`Failed to delete: ${res.status}`)
      }

      // 清除缓存
      this.contentCache.delete(path)

      this.emit('fileChanged', {
        type: 'delete',
        path
      } as FileChangeEvent)
    } catch (error) {
      console.error('[FileService] Failed to delete:', error)
      throw error
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/fs/exists?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) {
        return false
      }
      const data = await res.json()
      return data.exists || false
    } catch (error) {
      return false
    }
  }

  /**
   * 获取文件状态（修改时间等）
   */
  async getFileStat(filePath: string): Promise<{ mtime: number; size: number } | null> {
    try {
      const res = await fetch(`${API_BASE}/fs/stat?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) {
        return null
      }
      const data = await res.json()
      return {
        mtime: data.mtime || 0,
        size: data.size || 0
      }
    } catch (error) {
      return null
    }
  }

  /**
   * 批量读取文件
   */
  async readFiles(filePaths: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const promises = filePaths.map(async (path) => {
      try {
        const content = await this.readFile(path)
        results.set(path, content)
      } catch (error) {
        console.error(`[FileService] Failed to read file: ${path}`, error)
        results.set(path, '')
      }
    })
    await Promise.all(promises)
    return results
  }

  /**
   * 开始监听目录
   */
  startWatching(dirPath: string): void {
    if (this.watchers.has(dirPath)) {
      console.log('[FileService] Already watching:', dirPath)
      return
    }

    try {
      const api = (window as any).api
      if (api?.fsWatch) {
        api.fsWatch(dirPath)
        this.watchers.set(dirPath, true)
        console.log('[FileService] Started watching:', dirPath)
      }
    } catch (error) {
      console.error('[FileService] Failed to start watching:', error)
    }
  }

  /**
   * 停止监听目录
   */
  stopWatching(dirPath: string): void {
    try {
      const api = (window as any).api
      if (api?.fsUnwatch) {
        api.fsUnwatch(dirPath)
        this.watchers.delete(dirPath)
        console.log('[FileService] Stopped watching:', dirPath)
      }
    } catch (error) {
      console.error('[FileService] Failed to stop watching:', error)
    }
  }

  /**
   * 设置文件监听
   */
  private setupFileWatcher(): void {
    const api = (window as any).api
    if (api?.onFileChange) {
      api.onFileChange((_event: any, data: { eventType: string; filename: string; dirPath: string }) => {
        const filePath = `${data.dirPath}/${data.filename}`
        console.log('[FileService] File change event:', data.eventType, filePath)

        // 映射事件类型
        let eventType: FileChangeEventType
        switch (data.eventType) {
          case 'rename':
            eventType = 'create'  // rename 事件通常表示新文件创建
            break
          case 'change':
            eventType = 'change'
            // 清除缓存，下次读取时重新加载
            this.contentCache.delete(filePath)
            break
          default:
            eventType = 'change'
        }

        const event: FileChangeEvent = {
          type: eventType,
          path: filePath
        }

        this.emit('fileChanged', event)
      })
    }
  }

  /**
   * 获取缓存的文件内容
   */
  getCachedContent(filePath: string): string | undefined {
    const cached = this.contentCache.get(filePath)
    return cached?.content
  }

  /**
   * 更新缓存的文件内容（不写入磁盘）
   */
  updateCachedContent(filePath: string, content: string): void {
    this.contentCache.set(filePath, {
      content,
      mtime: Date.now(),
      version: ++this.versionCounter
    })
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.contentCache.clear()
  }

  /**
   * 获取文件版本号
   */
  getFileVersion(filePath: string): number {
    const cached = this.contentCache.get(filePath)
    return cached?.version || 0
  }
}

// 导出单例
export const fileService = FileService.getInstance()

// 导出类型
export default FileService
