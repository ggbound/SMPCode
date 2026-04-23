import React, { useState } from 'react'
import { useSearchStore } from '../../stores/searchStore'
import type { IFileMatch, ISearchMatch } from '../../types/search'
import { t } from '../../i18n'

interface SearchResultsViewProps {
  projectPath: string | null
  onFileClick?: (filePath: string, line: number) => void
}

export function SearchResultsView({ projectPath, onFileClick }: SearchResultsViewProps) {
  const { result, expandedFiles, expandFile, collapseFile } = useSearchStore()
  const [selectedLine, setSelectedLine] = useState<{filePath: string, line: number} | null>(null)
  
  if (!result || result.fileMatches.length === 0) {
    return <SearchPlaceholder />
  }
  
  return (
    <div className="search-results-view">
      {/* 结果统计 */}
      <div className="search-results-header">
        <span>{result.totalMatches} {t('resultsIn')} {result.totalFiles} {t('files')}</span>
      </div>
      
      {/* 文件列表 */}
      <div className="search-results-tree">
        {result.fileMatches.map((fileMatch) => (
          <FileMatchItem
            key={fileMatch.filePath}
            fileMatch={fileMatch}
            isExpanded={expandedFiles.has(fileMatch.filePath)}
            projectPath={projectPath}
            selectedLine={selectedLine}
            setSelectedLine={setSelectedLine}
            onToggle={() => {
              if (expandedFiles.has(fileMatch.filePath)) {
                collapseFile(fileMatch.filePath)
              } else {
                expandFile(fileMatch.filePath)
              }
            }}
            onFileClick={onFileClick}
          />
        ))}
      </div>
      
      {/* 限制提示 */}
      {result.limitHit && (
        <div className="search-limit-message">
          {t('searchLimitHit')}
        </div>
      )}
    </div>
  )
}

interface FileMatchItemProps {
  fileMatch: IFileMatch
  isExpanded: boolean
  projectPath: string | null
  selectedLine: {filePath: string, line: number} | null
  setSelectedLine: (line: {filePath: string, line: number} | null) => void
  onToggle: () => void
  onFileClick?: (filePath: string, line: number) => void
}

function FileMatchItem({ fileMatch, isExpanded, projectPath, selectedLine, setSelectedLine, onToggle, onFileClick }: FileMatchItemProps) {
  // 计算相对路径
  const relativePath = projectPath && fileMatch.filePath.startsWith(projectPath)
    ? fileMatch.filePath.substring(projectPath.length + 1)
    : fileMatch.filePath
  
  return (
    <div className="file-match-item">
      {/* 文件头部 */}
      <div className="file-match-header" onClick={onToggle} title={fileMatch.filePath}>
        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
        <FileIcon language={fileMatch.languageId} />
        <span className="file-path">{relativePath}</span>
        <span className="match-count">{fileMatch.matchCount}</span>
      </div>
      
      {/* 匹配行 */}
      {isExpanded && (
        <div className="file-match-lines">
          {fileMatch.matches.map((match, idx) => {
            const isSelected = selectedLine?.filePath === match.filePath && selectedLine?.line === match.line
            return (
              <MatchLineItem
                key={idx}
                match={match}
                isSelected={isSelected}
                onClick={() => {
              console.log('[Search] FileMatchItem onClick handler called')
              setSelectedLine({ filePath: match.filePath, line: match.line })
              console.log('[Search] Calling onFileClick with:', match.filePath, match.line)
              onFileClick?.(match.filePath, match.line)
            }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface MatchLineItemProps {
  match: ISearchMatch
  isSelected: boolean
  onClick?: () => void
}

function MatchLineItem({ match, isSelected, onClick }: MatchLineItemProps) {
  // 高亮显示匹配内容
  const renderHighlightedContent = (content: string, matchText: string) => {
    const parts = content.split(new RegExp(`(${escapeRegex(matchText)})`, 'gi'))
    
    return (
      <span className="line-content">
        {parts.map((part, i) => 
          part.toLowerCase() === matchText.toLowerCase() ? (
            <mark key={i} className="search-match">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    )
  }
  
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  
  const handleClick = (e: React.MouseEvent) => {
    console.log('[Search] ===== MatchLineItem clicked =====')
    console.log('[Search] Event target:', e.target)
    console.log('[Search] Event currentTarget:', e.currentTarget)
    console.log('[Search] Match data:', {
      filePath: match.filePath,
      line: match.line,
      match: match.match
    })
    e.stopPropagation()
    console.log('[Search] Calling onClick callback')
    onClick?.()
  }
  
  return (
    <div 
      className={`match-line-item ${isSelected ? 'selected' : ''}`} 
      onClick={handleClick}
      title={`跳转到第 ${match.line} 行`}
    >
      <span className="line-number">{match.line}</span>
      {renderHighlightedContent(match.preview, match.match)}
    </div>
  )
}

function FileIcon({ language }: { language: string }) {
  // 语言图标映射 - 与detectLanguage保持一致
  const icons: Record<string, string> = {
    javascript: 'JS',
    typescript: 'TS',
    python: 'PY',
    java: 'JV',
    c: 'C',
    cpp: 'C++',
    go: 'GO',
    rust: 'RS',
    ruby: 'RB',
    php: 'PHP',
    csharp: 'CS',
    swift: 'SW',
    kotlin: 'KT',
    scala: 'SC',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'LESS',
    json: '{}',
    xml: 'XML',
    yaml: 'YML',
    markdown: 'MD',
    bash: 'SH',
    sql: 'SQL',
    vue: 'VUE',
    svelte: 'SV',
    plaintext: 'TXT'
  }
  
  return <span className="file-icon">{icons[language] || '?'}</span>
}

function SearchPlaceholder() {
  return (
    <div className="search-placeholder">
      <div className="search-placeholder-icon">🔍</div>
      <div>{t('noResultsFound')}</div>
    </div>
  )
}
