import React, { useEffect } from 'react'
import { useSearchStore } from '../stores/searchStore'
import { SearchWidget } from './search/SearchWidget'
import { QueryDetailsPanel } from './search/QueryDetailsPanel'
import { SearchResultsView } from './search/SearchResultsView'
import { SearchHistory } from './search/SearchHistory'
import { t } from '../i18n'

interface SearchPanelProps {
  projectPath: string | null
  onFileClick?: (filePath: string, line: number) => void
}

function SearchPanel({ projectPath, onFileClick }: SearchPanelProps) {
  const { performSearch, clearResults, query, toggleReplace, showReplace } = useSearchStore()
  
  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        // 聚焦搜索框的逻辑可以在这里添加
      }
      
      // Escape: 清除搜索
      if (e.key === 'Escape' && query.contentPattern) {
        clearResults()
      }
    }
    
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [query.contentPattern, clearResults])
  
  const handleSearch = () => {
    if (projectPath) {
      performSearch(projectPath)
    }
  }
  
  return (
    <div className="search-panel">
      {/* 搜索Widget */}
      <SearchWidget onSearch={handleSearch} />
      
      {/* 查询详情面板 */}
      <QueryDetailsPanel />
      
      {/* 搜索操作栏 */}
      <div className="search-actions-bar">
        <button
          className="toggle-replace-btn"
          onClick={toggleReplace}
          title={showReplace ? '隐藏替换' : '显示替换'}
        >
          ⇄
        </button>
        <SearchHistory />
        <button 
          className="clear-results-btn" 
          onClick={clearResults}
          title={t('clearResults')}
        >
          {t('clear')}
        </button>
      </div>
      
      {/* 搜索结果 */}
      <SearchResultsView projectPath={projectPath} onFileClick={onFileClick} />
    </div>
  )
}

export default SearchPanel
