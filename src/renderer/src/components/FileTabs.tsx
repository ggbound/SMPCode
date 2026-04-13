import { useState, useRef, useEffect } from 'react'
import { t } from '../i18n'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isDirty: boolean
  isPreview?: boolean
  language?: string
}

interface FileTabsProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabCloseOthers: (tabId: string) => void
  onTabCloseAll: () => void
  onTabCloseToRight: (tabId: string) => void
  onTabCloseToLeft: (tabId: string) => void
}

// Get file icon based on extension
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    'js': '📜',
    'ts': '📘',
    'tsx': '⚛️',
    'jsx': '⚛️',
    'py': '🐍',
    'json': '📋',
    'md': '📝',
    'css': '🎨',
    'scss': '🎨',
    'sass': '🎨',
    'less': '🎨',
    'html': '🌐',
    'htm': '🌐',
    'txt': '📄',
    'xml': '📄',
    'yaml': '⚙️',
    'yml': '⚙️',
    'toml': '⚙️',
    'ini': '⚙️',
    'conf': '⚙️',
    'config': '⚙️',
    'sh': '🔧',
    'bash': '🔧',
    'zsh': '🔧',
    'rs': '🦀',
    'go': '🔵',
    'java': '☕',
    'kt': '🔷',
    'c': '🔷',
    'cpp': '🔷',
    'cc': '🔷',
    'cxx': '🔷',
    'h': '🔷',
    'hpp': '🔷',
    'hh': '🔷',
    'rb': '💎',
    'php': '🐘',
    'swift': '🦉',
    'sql': '🗃️',
    'dockerfile': '🐳',
    'vue': '💚',
    'svelte': '🧡',
    'astro': '🚀',
    'wasm': '⚡',
    'lock': '🔒',
    'gitignore': '🚫',
    'env': '🔐',
  }
  
  const baseName = filename.toUpperCase()
  for (const [key, icon] of Object.entries(iconMap)) {
    if (baseName.includes(key.toUpperCase())) {
      return icon
    }
  }
  
  return iconMap[ext || ''] || '📄'
}

function FileTabs({ 
  tabs, 
  activeTabId, 
  onTabSelect, 
  onTabClose,
  onTabCloseOthers,
  onTabCloseAll,
  onTabCloseToRight,
  onTabCloseToLeft
}: FileTabsProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollLeft, setShowScrollLeft] = useState(false)
  const [showScrollRight, setShowScrollRight] = useState(false)

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Check scroll buttons visibility
  useEffect(() => {
    const container = tabsContainerRef.current
    if (!container) return

    const checkScroll = () => {
      setShowScrollLeft(container.scrollLeft > 0)
      setShowScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth)
    }

    checkScroll()
    container.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)

    return () => {
      container.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [tabs])

  // Scroll tabs
  const scrollTabs = (direction: 'left' | 'right') => {
    const container = tabsContainerRef.current
    if (!container) return
    
    const scrollAmount = 200
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }

  // Handle tab context menu
  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }

  // Handle tab close with middle click
  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) { // Middle click
      e.preventDefault()
      onTabClose(tabId)
    }
  }

  // Get tab display name
  const getTabDisplayName = (tab: Tab): string => {
    if (tab.name) return tab.name
    const parts = tab.path.split('/')
    return parts[parts.length - 1] || tab.path
  }

  // Get tab tooltip
  const getTabTooltip = (tab: Tab): string => {
    return tab.path
  }

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="file-tabs-container">
      {/* Scroll left button */}
      {showScrollLeft && (
        <button 
          className="tabs-scroll-btn tabs-scroll-left"
          onClick={() => scrollTabs('left')}
        >
          ◀
        </button>
      )}

      {/* Tabs */}
      <div className="file-tabs" ref={tabsContainerRef}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const displayName = getTabDisplayName(tab)
          
          return (
            <div
              key={tab.id}
              className={`file-tab ${isActive ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''} ${tab.isPreview ? 'preview' : ''}`}
              onClick={() => onTabSelect(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              title={getTabTooltip(tab)}
            >
              <span className="tab-icon">{getFileIcon(tab.name)}</span>
              <span className="tab-name">{displayName}</span>
              {tab.isDirty && <span className="tab-dirty-indicator">●</span>}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                title={t('close')}
              >
                <span className="tab-close-icon">×</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Scroll right button */}
      {showScrollRight && (
        <button 
          className="tabs-scroll-btn tabs-scroll-right"
          onClick={() => scrollTabs('right')}
        >
          ▶
        </button>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="context-menu-item"
            onClick={() => {
              onTabClose(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            {t('close')}
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              onTabCloseOthers(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            {t('closeOthers')}
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              onTabCloseToRight(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            {t('closeToRight')}
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              onTabCloseToLeft(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            {t('closeToLeft')}
          </button>
          <div className="context-menu-divider" />
          <button 
            className="context-menu-item"
            onClick={() => {
              onTabCloseAll()
              setContextMenu(null)
            }}
          >
            {t('closeAll')}
          </button>
        </div>
      )}
    </div>
  )
}

export default FileTabs
