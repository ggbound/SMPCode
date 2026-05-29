import React from 'react'
import { ChevronRight, ChevronUp, X, FilePlus, FileMinus, Ban } from 'lucide-react'
import { useSearchStore } from '../../stores/searchStore'
import { t } from '../../i18n'

export function QueryDetailsPanel() {
  const { query, setQuery, showQueryDetails, toggleQueryDetails } = useSearchStore()
  
  if (!showQueryDetails) {
    return (
      <button className="show-details-btn" onClick={toggleQueryDetails}>
        <span className="btn-icon">
          <ChevronRight size={14} />
        </span>
        <span>{t('showQueryDetails')}</span>
      </button>
    )
  }
  
  return (
    <div className="query-details-panel">
      {/* 面板头部 - 点击可收起 */}
      <div className="panel-header" onClick={toggleQueryDetails} style={{ cursor: 'pointer' }}>
        <span className="panel-title">{t('searchOptions')}</span>
        <button 
          className="panel-close" 
          onClick={(e) => { e.stopPropagation(); toggleQueryDetails(); }}
          title={t('hideQueryDetails')}
        >
          <ChevronUp size={14} />
        </button>
      </div>
      
      {/* 包含文件模式 */}
      <div className="pattern-input-row">
        <FilePlus size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          className="pattern-input"
          value={query.includePattern || ''}
          onChange={(e) => setQuery({ includePattern: e.target.value })}
          placeholder={t('filesToInclude')}
          title={t('filesToIncludeHint')}
        />
      </div>
      <div className="input-hint">{t('filesToIncludeHint')}</div>
      
      {/* 排除文件模式 */}
      <div className="pattern-input-row">
        <FileMinus size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          className="pattern-input"
          value={query.excludePattern || ''}
          onChange={(e) => setQuery({ excludePattern: e.target.value })}
          placeholder={t('filesToExclude')}
          title={t('filesToExcludeHint')}
        />
        {/* 使用.gitignore开关 */}
        <button
          className={`ignore-btn ${query.useIgnoreFiles !== false ? 'active' : ''}`}
          onClick={() => setQuery({ useIgnoreFiles: query.useIgnoreFiles === false })}
          title={t('useIgnoreFiles')}
        >
          <Ban size={12} />
        </button>
      </div>
      <div className="input-hint">{t('filesToExcludeHint')}</div>
    </div>
  )
}
