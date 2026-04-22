import { useState, useCallback } from 'react'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isDirty: boolean
  isPreview?: boolean
  isPinned?: boolean
  language?: string
}

/**
 * 标签页管理 Hook
 * 处理标签页的预览模式、固定、拖拽排序等功能
 */
export function useTabManagement() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [previewTabId, setPreviewTabId] = useState<string | null>(null)

  // 添加标签页
  const addTab = useCallback((tab: Tab, isPreview = true) => {
    setTabs(prev => {
      // 检查是否已存在
      const existingIndex = prev.findIndex(t => t.path === tab.path)
      if (existingIndex >= 0) {
        // 已存在，切换到该标签
        const updated = [...prev]
        updated[existingIndex] = { ...tab, isPreview }
        return updated
      }

      // 如果是预览模式，替换现有的预览标签
      if (isPreview && previewTabId) {
        const previewIndex = prev.findIndex(t => t.id === previewTabId)
        if (previewIndex >= 0) {
          const updated = [...prev]
          updated[previewIndex] = { ...tab, isPreview: true }
          return updated
        }
      }

      // 添加新标签
      return [...prev, { ...tab, isPreview }]
    })
    setActiveTabId(tab.id)
    if (isPreview) {
      setPreviewTabId(tab.id)
    }
  }, [previewTabId])

  // 固定标签页（双击或编辑后）
  const pinTab = useCallback((tabId: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId ? { ...tab, isPreview: false, isPinned: true } : tab
    ))
    if (previewTabId === tabId) {
      setPreviewTabId(null)
    }
  }, [previewTabId])

  // 关闭标签页
  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const updated = prev.filter(t => t.id !== tabId)
      // 如果关闭的是活动标签，切换到下一个
      if (tabId === activeTabId && updated.length > 0) {
        const currentIndex = prev.findIndex(t => t.id === tabId)
        const newIndex = Math.min(currentIndex, updated.length - 1)
        setActiveTabId(updated[newIndex].id)
      } else if (updated.length === 0) {
        setActiveTabId(null)
      }
      return updated
    })
    if (previewTabId === tabId) {
      setPreviewTabId(null)
    }
  }, [activeTabId, previewTabId])

  // 关闭其他标签页
  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs(prev => prev.filter(t => t.id === tabId))
    setActiveTabId(tabId)
    setPreviewTabId(null)
  }, [])

  // 关闭右侧标签页
  const closeTabsToRight = useCallback((tabId: string) => {
    setTabs(prev => {
      const index = prev.findIndex(t => t.id === tabId)
      if (index === -1) return prev
      const updated = prev.slice(0, index + 1)
      if (updated.every(t => t.id !== activeTabId)) {
        setActiveTabId(tabId)
      }
      return updated
    })
  }, [activeTabId])

  // 关闭左侧标签页
  const closeTabsToLeft = useCallback((tabId: string) => {
    setTabs(prev => {
      const index = prev.findIndex(t => t.id === tabId)
      if (index === -1) return prev
      const updated = prev.slice(index)
      if (updated.every(t => t.id !== activeTabId)) {
        setActiveTabId(tabId)
      }
      return updated
    })
  }, [activeTabId])

  // 关闭所有标签页
  const closeAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
    setPreviewTabId(null)
  }, [])

  // 拖拽排序
  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      const updated = [...prev]
      const [moved] = updated.splice(fromIndex, 1)
      updated.splice(toIndex, 0, moved)
      return updated
    })
  }, [])

  // 更新标签页内容
  const updateTabContent = useCallback((tabId: string, content: string) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, content, isDirty: true } : tab
    ))
    // 编辑后自动固定预览标签
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.isPreview) {
      pinTab(tabId)
    }
  }, [tabs, pinTab])

  // 保存标签页
  const saveTab = useCallback((tabId: string) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, isDirty: false } : tab
    ))
  }, [])

  // 获取活动标签
  const activeTab = tabs.find(t => t.id === activeTabId) || null

  return {
    tabs,
    activeTabId,
    activeTab,
    previewTabId,
    addTab,
    pinTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeAllTabs,
    reorderTabs,
    updateTabContent,
    saveTab,
    setActiveTabId,
  }
}

export default useTabManagement
