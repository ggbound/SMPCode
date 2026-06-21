import React, { useState, useEffect } from 'react'
import { useSearchStore } from '../stores/searchStore'
import { t } from '../i18n'
import { ChevronDown, ChevronRight, RefreshCw, X, History, ArrowLeftRight } from 'lucide-react'
import '../styles/search.css'

interface SearchPanelProps {
  projectPath: string | null
  onFileClick?: (filePath: string, line: number) => void
}

function SearchPanel({ projectPath, onFileClick }: SearchPanelProps) {
  const { 
    performSearch, 
    clearResults, 
    query, 
    setQuery,
    showReplace, 
    toggleReplace,
    replaceString,
    setReplaceString,
    isSearching,
    result,
    expandedFiles,
    expandFile,
    collapseFile
  } = useSearchStore()
  
  const [showDetails, setShowDetails] = useState(false)
  
  const handleSearch = () => {
    if (projectPath) {
      performSearch(projectPath)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

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
  
  return (
    <div className="search-panel-v2">
      {/* 面板头部 */}
      <div className="search-panel-header">
        <span className="search-panel-title">搜索</span>
        <div className="search-panel-actions">
          <button className="search-panel-header-btn" title="搜索历史">
            <History size={14} />
          </button>
          {isSearching ? (
            <span className="search-panel-badge">搜索中...</span>
          ) : (
            <button className="search-panel-header-btn" title="刷新" onClick={handleSearch}>
              <RefreshCw size={14} />
            </button>
          )}
          <button 
            className={`search-panel-header-btn ${showReplace ? 'active' : ''}`}
            title={showReplace ? '隐藏替换' : '显示替换'}
            onClick={toggleReplace}
          >
            <ArrowLeftRight size={14} />
          </button>
          <button 
            className="search-panel-header-btn" 
            title="清除"
            onClick={clearResults}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      {/* 搜索输入区 */}
      <div className="search-inputs-area">
        {/* 搜索行 */}
        <div className="search-row">
          <input
            className="search-input-v2"
            value={query.contentPattern}
            onChange={(e) => setQuery({ contentPattern: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('searchPlaceholder') || '搜索...'}
          />
          <div className="search-actions-v2">
            <button
              className={`search-action-btn ${query.isCaseSensitive ? 'active' : ''}`}
              onClick={() => setQuery({ isCaseSensitive: !query.isCaseSensitive })}
              title="匹配大小写"
            >
              Aa
            </button>
            <button
              className={`search-action-btn ${query.isWholeWords ? 'active' : ''}`}
              onClick={() => setQuery({ isWholeWords: !query.isWholeWords })}
              title="全字匹配"
            >
              Ab
            </button>
            <button
              className={`search-action-btn ${showReplace ? 'active' : ''}`}
              onClick={toggleReplace}
              title="替换"
            >
              All
            </button>
          </div>
        </div>
        
        {/* 替换行（可选） */}
        {showReplace && (
          <div className="replace-row">
            <input
              className="replace-input-v2"
              value={replaceString}
              onChange={(e) => setReplaceString(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('replacePlaceholder') || '替换...'}
            />
          </div>
        )}
      </div>
      
      {/* 展开详情按钮 */}
      <button 
        className="expand-details-btn"
        onClick={() => setShowDetails(!showDetails)}
      >
        {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>显示查询详情</span>
      </button>
      
      {/* 查询详情面板 */}
      {showDetails && (
        <div className="query-details-v2">
          <div className="detail-row">
            <span className="detail-label">包含文件</span>
            <input 
              className="detail-input" 
              placeholder="例如: *.ts, *.tsx"
              value={query.includePattern || ''}
              onChange={(e) => setQuery({ includePattern: e.target.value })}
            />
          </div>
          <div className="detail-row">
            <span className="detail-label">排除文件</span>
            <input 
              className="detail-input" 
              placeholder="例如: node_modules, *.test.ts"
              value={query.excludePattern || ''}
              onChange={(e) => setQuery({ excludePattern: e.target.value })}
            />
          </div>
        </div>
      )}
      
      {/* 搜索结果 */}
      <div className="search-results-v2">
        {!result && query.contentPattern && !isSearching && (
          <div className="no-results">未找到结果</div>
        )}
        {!result && !query.contentPattern && (
          <div className="search-placeholder">输入搜索内容开始搜索</div>
        )}
        {result?.fileMatches?.map((fileMatch: any) => (
          <div key={fileMatch.filePath} className="file-match-group">
            <div 
              className="file-match-header"
              onClick={() => expandedFiles.has(fileMatch.filePath) ? collapseFile(fileMatch.filePath) : expandFile(fileMatch.filePath)}
            >
              <span className="file-match-name">{fileMatch.filePath}</span>
              <span className="file-match-count">{fileMatch.matchCount}</span>
            </div>
            {expandedFiles.has(fileMatch.filePath) && (
              <div className="file-match-matches">
                {fileMatch.matches.map((match: any, idx: number) => (
                  <div 
                    key={idx} 
                    className="search-result-item-v2"
                    onClick={() => onFileClick?.(match.filePath, match.line)}
                  >
                    <span className="result-line-number">{match.line}</span>
                    <span className="result-line-content">{match.preview}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SearchPanel
