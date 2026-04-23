import React, { useState } from 'react'
import { useSearchStore } from '../../stores/searchStore'
import type { ISearchHistoryEntry } from '../../types/search'
import { t } from '../../i18n'

export function SearchHistory() {
  const { searchHistory, loadFromHistory } = useSearchStore()
  const [showHistory, setShowHistory] = useState(false)
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return date.toLocaleDateString()
  }
  
  return (
    <div className="search-history-container">
      <button
        className="history-toggle"
        onClick={() => setShowHistory(!showHistory)}
        title={t('searchHistory')}
      >
        🕐
      </button>
      
      {showHistory && searchHistory.length > 0 && (
        <div className="history-dropdown">
          {searchHistory.map((entry) => (
            <div
              key={entry.id}
              className="history-item"
              onClick={() => {
                loadFromHistory(entry)
                setShowHistory(false)
              }}
            >
              <span className="history-query">{entry.query.contentPattern}</span>
              <span className="history-count">{entry.resultCount} {t('results')}</span>
              <span className="history-time">
                {formatTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
