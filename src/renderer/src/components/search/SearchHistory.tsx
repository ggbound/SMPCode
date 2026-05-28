import React, { useState, useRef, useEffect } from 'react'
import { useSearchStore } from '../../stores/searchStore'
import type { ISearchHistoryEntry } from '../../types/search'
import { t } from '../../i18n'
import { History, X, Trash2 } from 'lucide-react'

export function SearchHistory() {
  const { searchHistory, loadFromHistory, clearHistory } = useSearchStore()
  const [showHistory, setShowHistory] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowHistory(false)
      }
    }
    
    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showHistory])
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return date.toLocaleDateString()
  }
  
  const handleLoadHistory = (entry: ISearchHistoryEntry) => {
    loadFromHistory(entry)
    setShowHistory(false)
  }
  
  return (
    <div className="search-history-header-container" ref={containerRef}>
      <button
        className={`vscode-panel-action-btn history-icon-btn ${showHistory ? 'active' : ''}`}
        onClick={() => setShowHistory(!showHistory)}
        title={t('searchHistory')}
      >
        <History size={16} />
      </button>
      
      {showHistory && (
        <div className="history-dropdown-panel">
          <div className="history-dropdown-header">
            <span className="history-dropdown-title">{t('searchHistory')}</span>
            <div className="history-header-actions">
              {searchHistory.length > 0 && (
                <button 
                  className="history-clear-btn"
                  onClick={() => {
                    clearHistory()
                    setShowHistory(false)
                  }}
                  title="清空历史"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button 
                className="history-close-btn"
                onClick={() => setShowHistory(false)}
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          
          {searchHistory.length > 0 ? (
            <div className="history-dropdown-list">
              {searchHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="history-item"
                  onClick={() => handleLoadHistory(entry)}
                >
                  <div className="history-item-main">
                    <span className="history-query">{entry.query.contentPattern}</span>
                    <span className="history-count">{entry.resultCount}</span>
                  </div>
                  <span className="history-time">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-dropdown-empty">
              暂无搜索历史
            </div>
          )}
        </div>
      )}
    </div>
  )
}
