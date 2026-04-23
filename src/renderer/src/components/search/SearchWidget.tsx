import React from 'react'
import { useSearchStore } from '../../stores/searchStore'
import { t } from '../../i18n'

interface SearchWidgetProps {
  onSearch: () => void
}

export function SearchWidget({ onSearch }: SearchWidgetProps) {
  const { query, setQuery, isSearching, showReplace, replaceString, setReplaceString } = useSearchStore()

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch()
    }
  }

  return (
    <div className="search-widget">
      {/* 搜索输入行 */}
      <div className="search-input-row">
        <div className="search-input-wrapper">
          <input
            className="search-input"
            value={query.contentPattern}
            onChange={(e) => setQuery({ contentPattern: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={t('searchPlaceholder')}
          />
          
          {/* 搜索选项按钮 */}
          <div className="search-options">
            <button
              className={`search-option-btn ${query.isRegex ? 'active' : ''}`}
              onClick={() => setQuery({ isRegex: !query.isRegex })}
              title={t('useRegex')}
            >
              .*
            </button>
            <button
              className={`search-option-btn ${query.isCaseSensitive ? 'active' : ''}`}
              onClick={() => setQuery({ isCaseSensitive: !query.isCaseSensitive })}
              title={t('matchCase')}
            >
              Aa
            </button>
            <button
              className={`search-option-btn ${query.isWholeWords ? 'active' : ''}`}
              onClick={() => setQuery({ isWholeWords: !query.isWholeWords })}
              title={t('matchWholeWord')}
            >
              W
            </button>
          </div>
        </div>
        
        {/* 搜索中指示器 - 移到wrapper外部 */}
        {isSearching && <div className="search-indicator">{t('searching')}</div>}
      </div>
      
      {/* 替换输入行(可选) */}
      {showReplace && (
        <div className="replace-input-row">
          <input
            className="replace-input"
            value={replaceString}
            onChange={(e) => setReplaceString(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('replacePlaceholder')}
          />
          <button className="replace-all-btn" disabled>
            {t('replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
