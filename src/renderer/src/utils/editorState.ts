/**
 * Editor State Manager - VSCode-style
 * 统一管理编辑器状态，包括打开的文件、编辑内容、光标位置等
 */

import type { Tab } from '../components/FileTabs'

const EDITOR_STATE_KEY = 'smp-code-editor-state'

export interface EditorState {
  // 打开的标签页
  tabs: Array<{
    id: string
    path: string
    name: string
    content: string
    isDirty: boolean
    isPreview?: boolean
    language?: string
    lastModified?: number
    isBrowser?: boolean
    browserUrl?: string
    isDiff?: boolean
    diffCommitHash?: string
  }>
  // 当前激活的标签页ID
  activeTabId: string | null
  // 选中的文件路径
  selectedFilePath: string | null
  // 最后更新时间
  timestamp: number
}

// 内存中的编辑器状态
class EditorStateManager {
  private tabs: Map<string, Tab> = new Map() // path -> Tab
  private activeTabId: string | null = null
  private selectedFilePath: string | null = null
  private projectPath: string | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private contentCache: Map<string, string> = new Map() // path -> edited content

  // 设置当前项目
  setProjectPath(path: string | null) {
    if (this.projectPath !== path) {
      // 保存旧项目状态
      if (this.projectPath) {
        this.saveToStorage(this.projectPath)
      }
      
      this.projectPath = path
      this.tabs.clear()
      this.contentCache.clear()
      this.activeTabId = null
      this.selectedFilePath = null
      
      // 加载新项目状态
      if (path) {
        this.loadFromStorage(path)
      }
    }
  }

  // 打开文件
  openFile(path: string, content: string, name: string, language: string): Tab {
    // 检查是否已打开
    const existingTab = this.tabs.get(path)
    if (existingTab) {
      this.activeTabId = existingTab.id
      this.selectedFilePath = path
      this.scheduleSave()
      return existingTab
    }

    // 创建新标签
    const newTab: Tab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      path,
      name,
      content,
      isDirty: false,
      isPreview: true,
      language
    }

    this.tabs.set(path, newTab)
    this.contentCache.set(path, content)
    this.activeTabId = newTab.id
    this.selectedFilePath = path
    this.scheduleSave()
    
    return newTab
  }

  // 关闭文件
  closeFile(path: string): Tab | null {
    const tab = this.tabs.get(path)
    if (!tab) return null

    this.tabs.delete(path)
    this.contentCache.delete(path)

    // 更新激活标签
    if (this.activeTabId === tab.id) {
      const remainingTabs = Array.from(this.tabs.values())
      if (remainingTabs.length > 0) {
        this.activeTabId = remainingTabs[remainingTabs.length - 1].id
        this.selectedFilePath = remainingTabs[remainingTabs.length - 1].path
      } else {
        this.activeTabId = null
        this.selectedFilePath = null
      }
    }

    this.scheduleSave()
    return tab
  }

  // 更新文件内容（来自外部如 AI 操作）
  updateFileContent(path: string, content: string): boolean {
    const tab = this.tabs.get(path)
    if (!tab) return false

    // 更新标签内容
    tab.content = content
    tab.lastModified = Date.now()
    
    // 如果用户没有未保存的编辑，也更新缓存
    const cachedContent = this.contentCache.get(path)
    if (!tab.isDirty || cachedContent === tab.content) {
      this.contentCache.set(path, content)
      tab.isDirty = false
    }

    this.scheduleSave()
    return true
  }

  // 更新编辑内容（用户编辑）
  updateEditedContent(path: string, content: string) {
    const tab = this.tabs.get(path)
    if (!tab) return

    this.contentCache.set(path, content)
    tab.isDirty = content !== tab.content
    tab.isPreview = false // 用户编辑后不再是预览模式
    
    this.scheduleSave()
  }

  // 保存文件
  saveFile(path: string): boolean {
    const tab = this.tabs.get(path)
    if (!tab) return false

    const editedContent = this.contentCache.get(path)
    if (editedContent !== undefined) {
      tab.content = editedContent
      tab.isDirty = false
      tab.lastModified = Date.now()
      this.scheduleSave()
      return true
    }
    return false
  }

  // 获取所有标签
  getTabs(): Tab[] {
    return Array.from(this.tabs.values())
  }

  // 获取标签
  getTab(path: string): Tab | undefined {
    return this.tabs.get(path)
  }

  // 获取编辑内容
  getEditedContent(path: string): string | undefined {
    return this.contentCache.get(path)
  }

  // 设置激活标签
  setActiveTab(tabId: string) {
    const tab = Array.from(this.tabs.values()).find(t => t.id === tabId)
    if (tab) {
      this.activeTabId = tabId
      this.selectedFilePath = tab.path
      this.scheduleSave()
    }
  }

  // 获取激活标签
  getActiveTab(): Tab | null {
    if (!this.activeTabId) return null
    return Array.from(this.tabs.values()).find(t => t.id === this.activeTabId) || null
  }

  // 获取激活标签ID
  getActiveTabId(): string | null {
    return this.activeTabId
  }

  // 获取选中文件路径
  getSelectedFilePath(): string | null {
    return this.selectedFilePath
  }

  // 延迟保存
  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      if (this.projectPath) {
        this.saveToStorage(this.projectPath)
      }
    }, 300)
  }

  // 立即保存
  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    if (this.projectPath) {
      this.saveToStorage(this.projectPath)
    }
  }

  // 保存到 localStorage
  private saveToStorage(projectPath: string) {
    try {
      const key = this.getStorageKey(projectPath)
      const state: EditorState = {
        tabs: Array.from(this.tabs.values()).map(tab => ({
          id: tab.id,
          path: tab.path,
          name: tab.name,
          content: tab.content,
          isDirty: tab.isDirty,
          isPreview: tab.isPreview ?? false,
          language: tab.language ?? 'plaintext',
          lastModified: tab.lastModified,
          isBrowser: tab.isBrowser,
          browserUrl: tab.browserUrl,
          isDiff: tab.isDiff,
          diffCommitHash: tab.diffCommitHash
        })),
        activeTabId: this.activeTabId,
        selectedFilePath: this.selectedFilePath,
        timestamp: Date.now()
      }
      localStorage.setItem(key, JSON.stringify(state))
      console.log('[EditorState] Saved:', state.tabs.length, 'tabs')
    } catch (error) {
      console.error('[EditorState] Failed to save:', error)
    }
  }

  // 从 localStorage 加载
  private loadFromStorage(projectPath: string) {
    try {
      const key = this.getStorageKey(projectPath)
      const data = localStorage.getItem(key)
      if (data) {
        const state = JSON.parse(data) as EditorState
        
        // 恢复标签
        for (const tabData of state.tabs) {
          const tab: Tab = {
            id: tabData.id,
            path: tabData.path,
            name: tabData.name,
            content: tabData.content,
            isDirty: tabData.isDirty,
            isPreview: tabData.isPreview,
            language: tabData.language,
            lastModified: tabData.lastModified
          }
          this.tabs.set(tab.path, tab)
          this.contentCache.set(tab.path, tab.content)
        }
        
        this.activeTabId = state.activeTabId
        this.selectedFilePath = state.selectedFilePath
        
        console.log('[EditorState] Loaded:', this.tabs.size, 'tabs')
      }
    } catch (error) {
      console.error('[EditorState] Failed to load:', error)
    }
  }

  // 生成存储键
  private getStorageKey(projectPath: string): string {
    let hash = 0
    for (let i = 0; i < projectPath.length; i++) {
      const char = projectPath.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${EDITOR_STATE_KEY}-${hash}`
  }

  // 清除当前项目状态
  clear() {
    this.tabs.clear()
    this.contentCache.clear()
    this.activeTabId = null
    this.selectedFilePath = null
    if (this.projectPath) {
      const key = this.getStorageKey(this.projectPath)
      localStorage.removeItem(key)
    }
  }
}

// 导出单例
export const editorState = new EditorStateManager()
