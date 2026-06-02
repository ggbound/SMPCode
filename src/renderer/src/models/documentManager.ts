/**
 * Document Manager - VSCode-style 文档管理器
 * 统一管理所有打开的文档，处理文档生命周期
 */

import { EventEmitter } from 'events'
import Document, { DocumentOptions, DocumentSaveState, DocumentVersion } from './document'
import { fileService } from '../services/fileService'

// 持久化状态接口
export interface DocumentsState {
  documents: Array<{
    path: string
    name: string
    language: string
    content: string
    isDirty: boolean
    isPreview: boolean
    lastModified: number
    version: number
  }>
  activeDocumentPath: string | null
  timestamp: number
}

// 存储键前缀
const STORAGE_KEY_PREFIX = 'smp-code-documents-'

/**
 * DocumentManager - 文档管理器
 * 
 * 单例模式，全局统一管理所有打开的文档
 */
class DocumentManager extends EventEmitter {
  private static instance: DocumentManager
  private documents: Map<string, Document> = new Map()  // path -> Document
  private activeDocumentPath: string | null = null
  private projectPath: string | null = null
  private saveTimer: NodeJS.Timeout | null = null

  // 单例获取
  static getInstance(): DocumentManager {
    if (!DocumentManager.instance) {
      DocumentManager.instance = new DocumentManager()
    }
    return DocumentManager.instance
  }

  private constructor() {
    super()
    this.setupFileWatcher()
  }

  /**
   * 设置当前项目路径
   */
  setProjectPath(path: string | null) {
    if (this.projectPath !== path) {
      // 保存旧项目状态
      if (this.projectPath) {
        this.saveState(this.projectPath)
      }

      // 清空当前文档
      this.documents.clear()
      this.activeDocumentPath = null

      this.projectPath = path

      // 加载新项目状态
      if (path) {
        this.loadState(path)
      }

      this.emit('projectChanged', { path })
    }
  }

  /**
   * 获取当前项目路径
   */
  getProjectPath(): string | null {
    return this.projectPath
  }

  // ============ 文档操作 ============

  /**
   * 打开文档
   * 
   * @param filePath 文件路径
   * @param content 文件内容（可选，如果不提供则从磁盘读取）
   * @param options 额外选项
   * @returns 文档实例
   */
  async openDocument(
    filePath: string,
    content?: string,
    options: Partial<DocumentOptions> = {}
  ): Promise<Document> {
    // 检查是否已打开
    const existingDoc = this.documents.get(filePath)
    if (existingDoc) {
      this.setActiveDocument(filePath)
      return existingDoc
    }

    // 读取文件内容
    let fileContent = content
    if (fileContent === undefined) {
      try {
        fileContent = await fileService.readFile(filePath)
      } catch (error) {
        console.error('[DocumentManager] Failed to read file:', filePath, error)
        fileContent = ''
      }
    }

    // 创建新文档
    const doc = new Document({
      path: filePath,
      name: options.name || filePath.split('/').pop() || filePath,
      language: options.language,
      isPreview: options.isPreview ?? true  // 默认预览模式
    })

    // 设置内容
    doc.setDiskContent(fileContent)

    // 监听文档事件
    this.setupDocumentListeners(doc)

    // 添加到管理器
    this.documents.set(filePath, doc)
    this.setActiveDocument(filePath)

    this.emit('documentOpened', { path: filePath, document: doc })
    this.scheduleSave()

    return doc
  }

  /**
   * 关闭文档
   * 
   * @param filePath 文件路径
   * @param force 是否强制关闭（忽略未保存的更改）
   * @returns 是否成功关闭
   */
  closeDocument(filePath: string, force: boolean = false): boolean {
    const doc = this.documents.get(filePath)
    if (!doc) return false

    // 检查未保存的更改
    if (doc.isDirty && !force) {
      this.emit('unsavedChanges', { path: filePath, document: doc })
      return false
    }

    // 移除监听
    doc.removeAllListeners()

    // 从管理器移除
    this.documents.delete(filePath)

    // 更新活动文档
    if (this.activeDocumentPath === filePath) {
      const remainingDocs = this.getAllDocuments()
      this.activeDocumentPath = remainingDocs.length > 0 
        ? remainingDocs[remainingDocs.length - 1].path 
        : null
    }

    this.emit('documentClosed', { path: filePath })
    this.scheduleSave()

    return true
  }

  /**
   * 关闭所有文档
   */
  closeAllDocuments(force: boolean = false): Array<{ path: string; saved: boolean }> {
    const results: Array<{ path: string; saved: boolean }> = []
    const paths = Array.from(this.documents.keys())

    for (const path of paths) {
      const saved = this.closeDocument(path, force)
      results.push({ path, saved })
    }

    return results
  }

  /**
   * 保存文档
   */
  async saveDocument(filePath: string): Promise<boolean> {
    const doc = this.documents.get(filePath)
    if (!doc) return false

    try {
      doc.markAsSaving()
      const content = doc.content
      await fileService.writeFile(filePath, content)
      doc.markAsSaved()
      
      this.emit('documentSaved', { path: filePath })
      this.scheduleSave()
      
      return true
    } catch (error) {
      console.error('[DocumentManager] Failed to save document:', filePath, error)
      return false
    }
  }

  /**
   * 保存所有文档
   */
  async saveAllDocuments(): Promise<Array<{ path: string; success: boolean }>> {
    const results: Array<{ path: string; success: boolean }> = []
    const docs = this.getAllDocuments()

    for (const doc of docs) {
      if (doc.isDirty) {
        const success = await this.saveDocument(doc.path)
        results.push({ path: doc.path, success })
      }
    }

    return results
  }

  // ============ 文档查询 ============

  /**
   * 获取文档
   */
  getDocument(filePath: string): Document | undefined {
    return this.documents.get(filePath)
  }

  /**
   * 获取所有文档
   */
  getAllDocuments(): Document[] {
    return Array.from(this.documents.values())
  }

  /**
   * 获取活动文档
   */
  getActiveDocument(): Document | null {
    if (!this.activeDocumentPath) return null
    return this.documents.get(this.activeDocumentPath) || null
  }

  /**
   * 获取活动文档路径
   */
  getActiveDocumentPath(): string | null {
    return this.activeDocumentPath
  }

  /**
   * 检查文档是否打开
   */
  isOpen(filePath: string): boolean {
    return this.documents.has(filePath)
  }

  /**
   * 检查是否有未保存的文档
   */
  hasUnsavedDocuments(): boolean {
    for (const doc of this.documents.values()) {
      if (doc.isDirty) return true
    }
    return false
  }

  /**
   * 获取未保存的文档列表
   */
  getUnsavedDocuments(): Document[] {
    return this.getAllDocuments().filter(doc => doc.isDirty)
  }

  // ============ 活动文档管理 ============

  /**
   * 设置活动文档
   */
  setActiveDocument(filePath: string | null): boolean {
    if (filePath === null) {
      this.activeDocumentPath = null
      this.emit('activeDocumentChanged', { path: null })
      return true
    }

    const doc = this.documents.get(filePath)
    if (!doc) return false

    this.activeDocumentPath = filePath
    this.emit('activeDocumentChanged', { path: filePath, document: doc })
    this.scheduleSave()
    
    return true
  }

  /**
   * 切换到下一个文档
   */
  nextDocument(): Document | null {
    const docs = this.getAllDocuments()
    if (docs.length === 0) return null

    const currentIndex = docs.findIndex(d => d.path === this.activeDocumentPath)
    const nextIndex = (currentIndex + 1) % docs.length
    const nextDoc = docs[nextIndex]
    
    this.setActiveDocument(nextDoc.path)
    return nextDoc
  }

  /**
   * 切换到上一个文档
   */
  previousDocument(): Document | null {
    const docs = this.getAllDocuments()
    if (docs.length === 0) return null

    const currentIndex = docs.findIndex(d => d.path === this.activeDocumentPath)
    const prevIndex = currentIndex <= 0 ? docs.length - 1 : currentIndex - 1
    const prevDoc = docs[prevIndex]
    
    this.setActiveDocument(prevDoc.path)
    return prevDoc
  }

  // ============ 文档事件处理 ============

  /**
   * 设置文档事件监听
   */
  private setupDocumentListeners(doc: Document): void {
    // 内容变化
    doc.on('contentChanged', (event) => {
      this.emit('documentContentChanged', {
        path: doc.path,
        document: doc,
        source: event.source,
        version: event.version
      })
    })

    // 冲突检测
    doc.on('conflictDetected', (event) => {
      this.emit('documentConflict', {
        path: doc.path,
        document: doc,
        diskContent: event.diskContent,
        editedContent: event.editedContent
      })
    })

    // 冲突解决
    doc.on('conflictResolved', (event) => {
      this.emit('documentConflictResolved', {
        path: doc.path,
        document: doc,
        strategy: event.strategy
      })
    })

    // 自动保存请求
    doc.on('autoSave', () => {
      this.saveDocument(doc.path)
    })

    // 保存完成
    doc.on('saved', () => {
      this.emit('documentSaved', { path: doc.path })
    })
  }

  /**
   * 设置文件系统监听
   */
  private setupFileWatcher(): void {
    fileService.on('fileChanged', (event) => {
      if (event.type === 'change' && this.isOpen(event.path)) {
        this.handleExternalFileChange(event.path)
      }
    })
  }

  /**
   * 处理外部文件变化
   */
  private async handleExternalFileChange(filePath: string): Promise<void> {
    const doc = this.documents.get(filePath)
    if (!doc) return

    try {
      // 读取新内容
      const newContent = await fileService.readFile(filePath)
      
      // 更新文档外部内容（触发冲突检测）
      doc.setExternalContent(newContent)
      
      this.emit('externalFileChanged', {
        path: filePath,
        document: doc,
        content: newContent
      })
    } catch (error) {
      console.error('[DocumentManager] Failed to handle external change:', filePath, error)
    }
  }

  // ============ 持久化 ============

  /**
   * 保存状态到 localStorage
   */
  private saveState(projectPath: string): void {
    try {
      const key = this.getStorageKey(projectPath)
      const state: DocumentsState = {
        documents: this.getAllDocuments().map(doc => ({
          path: doc.path,
          name: doc.name,
          language: doc.language,
          content: doc.diskVersion,  // 只保存磁盘版本
          isDirty: doc.isDirty,
          isPreview: doc.isPreview,
          lastModified: doc.lastModified,
          version: doc.version
        })),
        activeDocumentPath: this.activeDocumentPath,
        timestamp: Date.now()
      }
      localStorage.setItem(key, JSON.stringify(state))
      console.log('[DocumentManager] State saved:', state.documents.length, 'documents')
    } catch (error) {
      console.error('[DocumentManager] Failed to save state:', error)
    }
  }

  /**
   * 从 localStorage 加载状态
   */
  private loadState(projectPath: string): void {
    try {
      const key = this.getStorageKey(projectPath)
      const data = localStorage.getItem(key)
      if (!data) return

      const state = JSON.parse(data) as DocumentsState
      
      // 恢复文档（只恢复非预览模式的文档）
      for (const docData of state.documents) {
        if (!docData.isPreview) {
          const doc = new Document({
            path: docData.path,
            name: docData.name,
            language: docData.language,
            isPreview: false
          })
          doc.setDiskContent(docData.content)
          this.setupDocumentListeners(doc)
          this.documents.set(docData.path, doc)
        }
      }

      // 恢复活动文档
      if (state.activeDocumentPath && this.documents.has(state.activeDocumentPath)) {
        this.activeDocumentPath = state.activeDocumentPath
      }

      console.log('[DocumentManager] State loaded:', this.documents.size, 'documents')
      this.emit('stateLoaded', { documentCount: this.documents.size })
    } catch (error) {
      console.error('[DocumentManager] Failed to load state:', error)
    }
  }

  /**
   * 生成存储键
   */
  private getStorageKey(projectPath: string): string {
    let hash = 0
    for (let i = 0; i < projectPath.length; i++) {
      const char = projectPath.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${STORAGE_KEY_PREFIX}${hash}`
  }

  /**
   * 调度保存
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      if (this.projectPath) {
        this.saveState(this.projectPath)
      }
    }, 300)
  }

  /**
   * 立即保存
   */
  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    if (this.projectPath) {
      this.saveState(this.projectPath)
    }
  }

  /**
   * 清除状态
   */
  clearState(): void {
    if (this.projectPath) {
      const key = this.getStorageKey(this.projectPath)
      localStorage.removeItem(key)
    }
  }
}

// 导出单例
export const documentManager = DocumentManager.getInstance()

// 导出类型
export type { DocumentSaveState, DocumentOptions, DocumentVersion }
export { Document }
export default DocumentManager
