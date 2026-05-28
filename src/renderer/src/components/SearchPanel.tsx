import React, { useEffect } from 'react'
import { useSearchStore } from '../stores/searchStore'
import { SearchWidget } from './search/SearchWidget'
import { QueryDetailsPanel } from './search/QueryDetailsPanel'
import { SearchResultsView } from './search/SearchResultsView'
import { SearchHistory } from './search/SearchHistory'
import { t } from '../i18n'
import { RefreshCw, X, ArrowLeftRight, History } from 'lucide-react'
import '../styles/vscode-sidebar.css'

interface SearchPanelProps {
  projectPath: string | null
  onFileClick?: (filePath: string, line: number) => void
}

function SearchPanel({ projectPath, onFileClick }: SearchPanelProps) {
  const { performSearch, clearResults, query, toggleReplace, showReplace, isSearching } = useSearchStore()
  
  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
      }
      
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
    <div className="vscode-sidebar-panel search-panel">
      {/* 标题栏 - VSCode 风格 */}
      <div className="vscode-panel-header">
        <div className="vscode-panel-header-left">
          <span className="vscode-panel-title">搜索</span>
        </div>
        <div className="vscode-panel-actions">
          {/* 搜索历史按钮 */}
          <SearchHistory />
          {isSearching ? (
            <span className="search-indicator-header">{t('searching')}</span>
          ) : (
            <button className="vscode-panel-action-btn" title="刷新" onClick={handleSearch}>
              <RefreshCw size={16} />
            </button>
          )}
          <button 
            className="vscode-panel-action-btn" 
            title={showReplace ? '隐藏替换' : '显示替换'}
            onClick={toggleReplace}
          >
            <ArrowLeftRight size={16} />
          </button>
          <button 
            className="vscode-panel-action-btn" 
            title={t('clearResults')}
            onClick={clearResults}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      
      {/* 内容区域 */}
      <div className="vscode-panel-content">
        {/* 搜索Widget */}
        <SearchWidget onSearch={handleSearch} />
        
        {/* 查询详情面板 */}
        <QueryDetailsPanel />
        
        {/* 搜索结果 */}
        <SearchResultsView projectPath={projectPath} onFileClick={onFileClick} />
      </div>
    </div>
  )
}

export default SearchPanel
