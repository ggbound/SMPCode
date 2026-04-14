import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeBlockProps {
  code: string
  language: string
  filePath?: string
  showLineNumbers?: boolean
  maxHeight?: number
}

export function CodeBlock({ 
  code, 
  language = 'typescript', 
  filePath,
  showLineNumbers = true,
  maxHeight = 400
}: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  
  const lines = code.split('\n')
  const hasOverflow = lines.length > 20 || code.length > 1000
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  // 语言显示名称映射
  const languageLabels: Record<string, string> = {
    'ts': 'TypeScript',
    'tsx': 'TypeScript React',
    'js': 'JavaScript',
    'jsx': 'JavaScript React',
    'py': 'Python',
    'java': 'Java',
    'go': 'Go',
    'rs': 'Rust',
    'cpp': 'C++',
    'c': 'C',
    'cs': 'C#',
    'php': 'PHP',
    'rb': 'Ruby',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'scala': 'Scala',
    'sh': 'Shell',
    'bash': 'Bash',
    'zsh': 'Zsh',
    'ps1': 'PowerShell',
    'sql': 'SQL',
    'json': 'JSON',
    'yaml': 'YAML',
    'yml': 'YAML',
    'xml': 'XML',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'less': 'LESS',
    'md': 'Markdown',
    'dockerfile': 'Dockerfile',
    'makefile': 'Makefile',
    'cmake': 'CMake',
    'vim': 'Vim',
    'lua': 'Lua',
    'perl': 'Perl',
    'r': 'R',
    'matlab': 'MATLAB',
    'groovy': 'Groovy',
    'gradle': 'Gradle',
    'dart': 'Dart',
    'flutter': 'Flutter',
    'vue': 'Vue',
    'svelte': 'Svelte',
    'angular': 'Angular',
    'solidity': 'Solidity',
    'vyper': 'Vyper',
    'move': 'Move',
    'cairo': 'Cairo',
    'rust': 'Rust',
    'text': 'Text',
    'plaintext': 'Plain Text'
  }
  
  const displayLanguage = languageLabels[language.toLowerCase()] || language.toUpperCase()
  
  return (
    <div className="code-block-container">
      {/* 头部 */}
      <div className="code-block-header">
        <div className="code-block-meta">
          <span className="code-block-language">{displayLanguage}</span>
          {filePath && (
            <span className="code-block-filepath">{filePath}</span>
          )}
        </div>
        <div className="code-block-actions">
          {hasOverflow && (
            <button 
              className="code-block-action-btn"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? '收起' : '展开'}
            </button>
          )}
          <button 
            className="code-block-action-btn"
            onClick={handleCopy}
          >
            {isCopied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>已复制</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* 代码内容 */}
      <div 
        className="code-block-content"
        style={{ 
          maxHeight: isExpanded ? 'none' : `${maxHeight}px`,
          overflow: isExpanded ? 'auto' : 'hidden'
        }}
      >
        <SyntaxHighlighter
          language={language.toLowerCase()}
          style={vscDarkPlus}
          showLineNumbers={showLineNumbers}
          lineNumberStyle={{
            minWidth: '3em',
            paddingRight: '1em',
            color: '#6e7681',
            fontSize: '12px'
          }}
          customStyle={{
            margin: 0,
            padding: '16px',
            background: '#161b22',
            fontSize: '13px',
            lineHeight: '1.6',
            borderRadius: '0 0 8px 8px'
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
      
      {/* 展开遮罩 */}
      {!isExpanded && hasOverflow && (
        <div className="code-block-expand-mask">
          <button 
            className="code-block-expand-btn"
            onClick={() => setIsExpanded(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <span>展开全部</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default CodeBlock
