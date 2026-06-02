/**
 * Document Model - VSCode-style 文档模型
 * 每个打开的文件对应一个文档实例，管理内容和状态
 */

import { EventEmitter } from 'events'

// 文档保存状态
export type DocumentSaveState = 'saved' | 'unsaved' | 'saving' | 'conflict'

// 文档内容版本
export interface DocumentVersion {
  content: string
  timestamp: number
  source: 'disk' | 'user' | 'external'
}

// 文档配置选项
export interface DocumentOptions {
  path: string
  name: string
  language?: string
  isPreview?: boolean
}

/**
 * Document - 文档模型类
 * 
 * VSCode 风格的文档管理：
 * - 跟踪原始内容（磁盘内容）
 * - 跟踪编辑内容（用户修改）
 * - 检测外部修改（AI 操作等）
 * - 处理冲突
 */
export class Document extends EventEmitter {
  // 文档标识
  readonly id: string
  readonly path: string
  readonly name: string
  readonly language: string
  
  // 内容状态
  private diskContent: string = ''      // 磁盘上的内容
  private editedContent: string = ''    // 用户编辑的内容
  private externalContent: string = ''  // 外部修改的内容（AI 等）
  
  // 状态
  private _isDirty: boolean = false
  private _isPreview: boolean = true
  private _saveState: DocumentSaveState = 'saved'
  private _hasConflict: boolean = false
  private _lastModified: number = Date.now()
  private _version: number = 1
  
  // 自动保存定时器
  private autoSaveTimer: NodeJS.Timeout | null = null
  private autoSaveDelay: number = 1000  // 1秒自动保存延迟

  constructor(options: DocumentOptions) {
    super()
    this.id = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.path = options.path
    this.name = options.name
    this.language = options.language || this.detectLanguage(options.path)
    this._isPreview = options.isPreview ?? true
  }

  // ============ Getters ============

  get content(): string {
    // 如果有冲突，返回用户编辑的内容
    if (this._hasConflict) {
      return this.editedContent
    }
    // 否则返回编辑内容（如果有）或磁盘内容
    return this.editedContent !== '' ? this.editedContent : this.diskContent
  }

  get diskVersion(): string {
    return this.diskContent
  }

  get editedVersion(): string {
    return this.editedContent
  }

  get isDirty(): boolean {
    return this._isDirty
  }

  get isPreview(): boolean {
    return this._isPreview
  }

  get saveState(): DocumentSaveState {
    return this._saveState
  }

  get hasConflict(): boolean {
    return this._hasConflict
  }

  get lastModified(): number {
    return this._lastModified
  }

  get version(): number {
    return this._version
  }

  // ============ 内容管理 ============

  /**
   * 设置磁盘内容（文件加载或保存后）
   */
  setDiskContent(content: string): void {
    const oldContent = this.diskContent
    this.diskContent = content
    
    // 如果没有用户编辑，同步编辑内容
    if (!this._isDirty) {
      this.editedContent = content
    }
    
    // 检查是否与编辑内容冲突
    if (this._isDirty && content !== oldContent) {
      this.externalContent = content
      this.checkConflict()
    }
    
    this._lastModified = Date.now()
    this._version++
    this.emit('contentChanged', { source: 'disk', version: this._version })
  }

  /**
   * 设置编辑内容（用户编辑）
   */
  setEditedContent(content: string): void {
    this.editedContent = content
    this._isDirty = content !== this.diskContent
    this._isPreview = false  // 用户编辑后不再是预览模式
    
    if (this._isDirty) {
      this._saveState = 'unsaved'
      this.scheduleAutoSave()
    } else {
      this._saveState = 'saved'
    }
    
    this._lastModified = Date.now()
    this.emit('contentChanged', { source: 'user', version: this._version })
  }

  /**
   * 设置外部内容（AI 操作等）
   * 这会触发冲突检测
   */
  setExternalContent(content: string): void {
    this.externalContent = content
    
    // 如果有未保存的编辑，标记为冲突
    if (this._isDirty) {
      this.checkConflict()
    } else {
      // 没有未保存的编辑，直接更新
      this.diskContent = content
      this.editedContent = content
      this._saveState = 'saved'
      this._lastModified = Date.now()
      this._version++
      this.emit('contentChanged', { source: 'external', version: this._version })
    }
  }

  /**
   * 检查冲突
   */
  private checkConflict(): void {
    // 如果外部内容与编辑内容不同，则存在冲突
    if (this.externalContent !== this.editedContent && this.externalContent !== '') {
      this._hasConflict = true
      this._saveState = 'conflict'
      this.emit('conflictDetected', {
        diskContent: this.externalContent,
        editedContent: this.editedContent
      })
    }
  }

  /**
   * 解决冲突 - 保留本地编辑
   */
  resolveConflictKeepLocal(): void {
    this._hasConflict = false
    this.externalContent = ''
    this._saveState = 'unsaved'
    this.emit('conflictResolved', { strategy: 'keepLocal' })
  }

  /**
   * 解决冲突 - 使用外部内容
   */
  resolveConflictUseExternal(): void {
    this._hasConflict = false
    this.diskContent = this.externalContent
    this.editedContent = this.externalContent
    this.externalContent = ''
    this._isDirty = false
    this._saveState = 'saved'
    this._version++
    this.emit('conflictResolved', { strategy: 'useExternal' })
    this.emit('contentChanged', { source: 'external', version: this._version })
  }

  /**
   * 解决冲突 - 合并内容（简单实现：保留本地）
   */
  resolveConflictMerge(): void {
    // TODO: 实现真正的合并逻辑
    this.resolveConflictKeepLocal()
  }

  // ============ 保存管理 ============

  /**
   * 标记为已保存
   */
  markAsSaved(): void {
    this.diskContent = this.editedContent
    this._isDirty = false
    this._saveState = 'saved'
    this._hasConflict = false
    this.externalContent = ''
    this._lastModified = Date.now()
    this.emit('saved')
  }

  /**
   * 标记为保存中
   */
  markAsSaving(): void {
    this._saveState = 'saving'
    this.emit('saving')
  }

  /**
   * 转换为预览模式
   */
  makePreview(): void {
    this._isPreview = true
  }

  /**
   * 固定文档（退出预览模式）
   */
  pin(): void {
    this._isPreview = false
  }

  // ============ 自动保存 ============

  /**
   * 设置自动保存延迟
   */
  setAutoSaveDelay(delay: number): void {
    this.autoSaveDelay = delay
  }

  /**
   * 启用/禁用自动保存
   */
  enableAutoSave(enabled: boolean): void {
    if (!enabled && this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }

  /**
   * 调度自动保存
   */
  private scheduleAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer)
    }
    
    this.autoSaveTimer = setTimeout(() => {
      if (this._isDirty && !this._hasConflict) {
        this.emit('autoSave')
      }
    }, this.autoSaveDelay)
  }

  /**
   * 取消自动保存
   */
  cancelAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }

  // ============ 工具方法 ============

  /**
   * 检测文件语言
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'less': 'less',
      'vue': 'vue',
      'json': 'json',
      'xml': 'xml',
      'svg': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'ini',
      'ini': 'ini',
      'md': 'markdown',
      'markdown': 'markdown',
      'py': 'python',
      'pyw': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cxx': 'cpp',
      'cc': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      'phtml': 'php',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'sql': 'sql',
      'lua': 'lua',
      'r': 'r',
      'perl': 'perl',
      'pl': 'perl',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'dart': 'dart',
      'graphql': 'graphql',
      'gql': 'graphql',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'cmake': 'cmake'
    }
    
    return langMap[ext] || 'plaintext'
  }

  /**
   * 获取文件扩展名
   */
  getExtension(): string {
    return this.path.split('.').pop()?.toLowerCase() || ''
  }

  /**
   * 获取文件名（不含路径）
   */
  getFileName(): string {
    return this.path.split('/').pop() || this.name
  }

  /**
   * 获取目录路径
   */
  getDirectory(): string {
    const lastSlash = this.path.lastIndexOf('/')
    return lastSlash > 0 ? this.path.substring(0, lastSlash) : ''
  }

  /**
   * 序列化为 JSON
   */
  toJSON(): object {
    return {
      id: this.id,
      path: this.path,
      name: this.name,
      language: this.language,
      content: this.diskContent,
      isDirty: this._isDirty,
      isPreview: this._isPreview,
      lastModified: this._lastModified,
      version: this._version
    }
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON(data: any): Document {
    const doc = new Document({
      path: data.path,
      name: data.name,
      language: data.language,
      isPreview: data.isPreview
    })
    doc.setDiskContent(data.content || '')
    doc._isDirty = data.isDirty || false
    doc._lastModified = data.lastModified || Date.now()
    doc._version = data.version || 1
    return doc
  }
}

export default Document
