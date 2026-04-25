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
  lastModified?: number  // Timestamp for external content changes
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

// VSCode-style file icon component for tabs
const FileIcon = ({ filename }: { filename: string }) => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const name = filename.toLowerCase()
  
  // Special file names
  if (name === 'package.json' || name === 'package-lock.json') {
    return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#CB3837"/><text x="8" y="11" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">npm</text></svg>
  }
  if (name === '.gitignore') {
    return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#F05032"/><path d="M8 5V11M5 8H11" stroke="white" strokeWidth="1.5"/></svg>
  }
  if (name === 'readme.md') {
    return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1" fill="#42A5F5"/><path d="M4 4H12M4 7H12M4 10H9" stroke="white" strokeWidth="1"/></svg>
  }
  if (name === '.env') {
    return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="8" rx="1" fill="#FFCA28"/><text x="8" y="10" textAnchor="middle" fill="#333" fontSize="5" fontWeight="bold">ENV</text></svg>
  }
  if (name === 'tsconfig.json') {
    return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#3178C6"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">TS</text></svg>
  }
  
  // Extension-based icons
  switch (ext) {
    case 'js':
    case 'mjs':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#F7DF1E"/><text x="8" y="10" textAnchor="middle" fill="#333" fontSize="6" fontWeight="bold">JS</text></svg>
    case 'ts':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#3178C6"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">TS</text></svg>
    case 'tsx':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#3178C6"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">TSX</text></svg>
    case 'jsx':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#61DAFB"/><text x="8" y="10" textAnchor="middle" fill="#333" fontSize="5" fontWeight="bold">JSX</text></svg>
    case 'py':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#3776AB"/><path d="M6 6H10M6 10H10" stroke="#FFD43B" strokeWidth="1.5"/></svg>
    case 'json':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#6B8E23"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">JSON</text></svg>
    case 'md':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1" fill="#42A5F5"/><text x="8" y="9" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">MD</text></svg>
    case 'css':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#264DE4"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">CSS</text></svg>
    case 'scss':
    case 'sass':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#CC6699"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">SCSS</text></svg>
    case 'html':
    case 'htm':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#E34F26"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">HTML</text></svg>
    case 'vue':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#41B883"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">VUE</text></svg>
    case 'go':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#00ADD8"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">GO</text></svg>
    case 'rs':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#DEA584"/><text x="8" y="10" textAnchor="middle" fill="#333" fontSize="6" fontWeight="bold">RS</text></svg>
    case 'java':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#B07219"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">JAVA</text></svg>
    case 'php':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#4F5D95"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">PHP</text></svg>
    case 'rb':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#701516"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">RB</text></svg>
    case 'sh':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#89E051"/><text x="8" y="10" textAnchor="middle" fill="#333" fontSize="6" fontWeight="bold">SH</text></svg>
    case 'yaml':
    case 'yml':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#CB171E"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">YML</text></svg>
    case 'dockerfile':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#2496ED"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="4" fontWeight="bold">DOCKER</text></svg>
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" fill="#26A69A"/><text x="8" y="10" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">IMG</text></svg>
    default:
      return <svg className="tab-file-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1" fill="#9E9E9E"/></svg>
  }
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
    return (
      <div className="file-tabs-container">
        {/* Empty tabs placeholder to maintain layout */}
        <div className="file-tabs" style={{ opacity: 0, pointerEvents: 'none' }}>
          <div className="file-tab" style={{ visibility: 'hidden' }}>
            <span className="tab-icon"></span>
            <span className="tab-name">placeholder</span>
          </div>
        </div>
      </div>
    )
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
              <span className="tab-icon"><FileIcon filename={tab.name} /></span>
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
