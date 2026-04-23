import React from 'react'

interface MatchHighlighterProps {
  content: string
  match: string
  filePath?: string
}

export function MatchHighlighter({ content, match }: MatchHighlighterProps) {
  // 转义正则特殊字符
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  
  // 分割并高亮匹配部分
  const parts = content.split(new RegExp(`(${escapeRegex(match)})`, 'gi'))
  
  return (
    <span className="match-highlighter">
      {parts.map((part, i) => 
        part.toLowerCase() === match.toLowerCase() ? (
          <mark key={i} className="search-match">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}
