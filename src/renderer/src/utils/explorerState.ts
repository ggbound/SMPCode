/**
 * Explorer State Manager - VSCode-style
 * 独立管理资源管理器的视图状态，与文件数据分离
 */

const EXPLORER_STATE_KEY = 'smp-code-explorer-state'

export interface ExplorerViewState {
  // 展开的目录路径集合 (Set 的序列化形式)
  expandedPaths: string[]
  // 选中的文件路径
  selectedPath: string | null
  // 最后更新时间
  timestamp: number
}

// 内存中的状态（运行时）
class ExplorerStateManager {
  private expandedPaths: Set<string> = new Set()
  private selectedPath: string | null = null
  private projectPath: string | null = null
  private saveTimer: NodeJS.Timeout | null = null

  // 设置当前项目路径
  setProjectPath(path: string | null) {
    if (this.projectPath !== path) {
      // 切换项目时保存旧项目的状态
      if (this.projectPath) {
        this.saveToStorage(this.projectPath)
      }
      
      this.projectPath = path
      this.expandedPaths.clear()
      this.selectedPath = null
      
      // 加载新项目的状态
      if (path) {
        this.loadFromStorage(path)
      }
    }
  }

  // 检查目录是否展开
  isExpanded(path: string): boolean {
    return this.expandedPaths.has(path)
  }

  // 展开目录
  expand(path: string) {
    this.expandedPaths.add(path)
    this.scheduleSave()
  }

  // 折叠目录
  collapse(path: string) {
    this.expandedPaths.delete(path)
    this.scheduleSave()
  }

  // 切换展开状态
  toggle(path: string): boolean {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path)
      this.scheduleSave()
      return false
    } else {
      this.expandedPaths.add(path)
      this.scheduleSave()
      return true
    }
  }

  // 获取所有展开的路径
  getExpandedPaths(): string[] {
    return Array.from(this.expandedPaths)
  }

  // 设置选中的路径
  setSelectedPath(path: string | null) {
    this.selectedPath = path
    this.scheduleSave()
  }

  // 获取选中的路径
  getSelectedPath(): string | null {
    return this.selectedPath
  }

  // 延迟保存，避免频繁写入
  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      if (this.projectPath) {
        this.saveToStorage(this.projectPath)
      }
    }, 300) // 300ms 延迟
  }

  // 保存到 localStorage
  private saveToStorage(projectPath: string) {
    try {
      const key = this.getStorageKey(projectPath)
      const state: ExplorerViewState = {
        expandedPaths: Array.from(this.expandedPaths),
        selectedPath: this.selectedPath,
        timestamp: Date.now()
      }
      localStorage.setItem(key, JSON.stringify(state))
      console.log('[ExplorerState] Saved:', state.expandedPaths.length, 'expanded directories')
    } catch (error) {
      console.error('[ExplorerState] Failed to save:', error)
    }
  }

  // 从 localStorage 加载
  private loadFromStorage(projectPath: string) {
    try {
      const key = this.getStorageKey(projectPath)
      const data = localStorage.getItem(key)
      if (data) {
        const state = JSON.parse(data) as ExplorerViewState
        this.expandedPaths = new Set(state.expandedPaths || [])
        this.selectedPath = state.selectedPath || null
        console.log('[ExplorerState] Loaded:', this.expandedPaths.size, 'expanded directories')
      }
    } catch (error) {
      console.error('[ExplorerState] Failed to load:', error)
      this.expandedPaths = new Set()
      this.selectedPath = null
    }
  }

  // 生成存储键
  private getStorageKey(projectPath: string): string {
    // 使用路径的 hash 作为键
    let hash = 0
    for (let i = 0; i < projectPath.length; i++) {
      const char = projectPath.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转为 32bit 整数
    }
    return `${EXPLORER_STATE_KEY}-${hash}`
  }

  // 清除当前项目的状态
  clear() {
    this.expandedPaths.clear()
    this.selectedPath = null
    if (this.projectPath) {
      const key = this.getStorageKey(this.projectPath)
      localStorage.removeItem(key)
    }
  }
}

// 导出单例
export const explorerState = new ExplorerStateManager()
