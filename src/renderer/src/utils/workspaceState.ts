/**
 * Workspace State Manager
 * 用于持久化保存每个项目的工作区状态
 * 包括：展开的目录、打开的文件、选中的文件等
 */

const STORAGE_KEY_PREFIX = 'smp-code-workspace-'

export interface WorkspaceState {
  // 展开的目录路径列表
  expandedPaths: string[]
  // 打开的文件标签页
  openTabs: Array<{
    path: string
    name: string
    type: 'file' | 'diff' | 'browser'
    browserUrl?: string
  }>
  // 当前激活的标签页ID
  activeTabId: string | null
  // 选中的文件路径
  selectedFilePath: string | null
  // 当前活动侧边栏
  activeActivity: 'explorer' | 'search' | 'git' | 'reminders' | 'mcp-skill' | 'feishu' | 'memcoder' | 'settings'
  // 保存时间戳
  timestamp: number
}

/**
 * 生成存储键名
 */
function getStorageKey(projectPath: string): string {
  // 使用项目路径的 base64 编码作为键名，避免路径中的特殊字符
  // 这样可以确保不同路径不会产生冲突
  const encoded = btoa(encodeURIComponent(projectPath))
  return `${STORAGE_KEY_PREFIX}${encoded}`
}

/**
 * 保存工作区状态
 */
export function saveWorkspaceState(projectPath: string, state: Omit<WorkspaceState, 'timestamp'>): void {
  try {
    const key = getStorageKey(projectPath)
    const data: WorkspaceState = {
      ...state,
      timestamp: Date.now()
    }
    localStorage.setItem(key, JSON.stringify(data))
    console.log('[WorkspaceState] Saved state for:', projectPath)
  } catch (error) {
    console.error('[WorkspaceState] Failed to save state:', error)
  }
}

/**
 * 加载工作区状态
 */
export function loadWorkspaceState(projectPath: string): WorkspaceState | null {
  try {
    const key = getStorageKey(projectPath)
    const data = localStorage.getItem(key)
    if (data) {
      const state = JSON.parse(data) as WorkspaceState
      return state
    }
  } catch (error) {
    console.error('[WorkspaceState] Failed to load state:', error)
  }
  return null
}

/**
 * 清除工作区状态
 */
export function clearWorkspaceState(projectPath: string): void {
  try {
    const key = getStorageKey(projectPath)
    localStorage.removeItem(key)
    console.log('[WorkspaceState] Cleared state for:', projectPath)
  } catch (error) {
    console.error('[WorkspaceState] Failed to clear state:', error)
  }
}

/**
 * 获取所有保存的工作区状态
 */
export function getAllWorkspaceStates(): Array<{ path: string; state: WorkspaceState }> {
  const states: Array<{ path: string; state: WorkspaceState }> = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const data = localStorage.getItem(key)
        if (data) {
          try {
            const state = JSON.parse(data) as WorkspaceState
            // 从哈希反推路径是不可能的，所以这里只返回状态
            // 实际使用时应该通过其他方式关联路径
            states.push({ path: key, state })
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (error) {
    console.error('[WorkspaceState] Failed to get all states:', error)
  }
  return states
}

/**
 * 清理过期的工作区状态（超过30天未访问）
 */
export function cleanupExpiredWorkspaceStates(maxAgeDays: number = 30): void {
  try {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
    const now = Date.now()
    
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const data = localStorage.getItem(key)
        if (data) {
          try {
            const state = JSON.parse(data) as WorkspaceState
            if (now - state.timestamp > maxAge) {
              localStorage.removeItem(key)
              console.log('[WorkspaceState] Removed expired state:', key)
            }
          } catch {
            // 解析错误，删除
            localStorage.removeItem(key)
          }
        }
      }
    }
  } catch (error) {
    console.error('[WorkspaceState] Failed to cleanup expired states:', error)
  }
}
