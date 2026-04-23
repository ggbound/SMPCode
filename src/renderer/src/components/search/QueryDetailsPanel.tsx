import React from 'react'
import { useSearchStore } from '../../stores/searchStore'
import { t } from '../../i18n'

export function QueryDetailsPanel() {
  const { query, setQuery, showQueryDetails, toggleQueryDetails } = useSearchStore()
  
  if (!showQueryDetails) {
    return (
      <button className="show-details-btn" onClick={toggleQueryDetails}>
        {t('showQueryDetails')}
      </button>
    )
  }
  
  return (
    <div className="query-details-panel">
      {/* 包含文件模式 */}
      <div className="pattern-input-row">
        <input
          className="pattern-input"
          value={query.includePattern || ''}
          onChange={(e) => setQuery({ includePattern: e.target.value })}
          placeholder={t('filesToInclude')}
          title={t('filesToIncludeHint')}
        />
      </div>
      
      {/* 排除文件模式 */}
      <div className="pattern-input-row">
        <input
          className="pattern-input"
          value={query.excludePattern || ''}
          onChange={(e) => setQuery({ excludePattern: e.target.value })}
          placeholder={t('filesToExclude')}
          title={t('filesToExcludeHint')}
        />
        {/* 使用.gitignore开关 */}
        <button
          className={`search-option-btn ${query.useIgnoreFiles !== false ? 'active' : ''}`}
          onClick={() => setQuery({ useIgnoreFiles: query.useIgnoreFiles === false })}
          title={t('useIgnoreFiles')}
        >
          ⊘
        </button>
      </div>
    </div>
  )
}
