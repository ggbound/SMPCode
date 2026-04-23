/**
 * Code Block Component
 * 
 * Uses react-syntax-highlighter for syntax highlighting.
 */

import { useState } from 'react'
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import atomOneDark from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark'
import { LANGUAGE_TO_LABEL } from '../utils/languageMap'

// Import commonly used languages
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/hljs/scss'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java'
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby'
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown'
import plaintext from 'react-syntax-highlighter/dist/esm/languages/hljs/plaintext'

// Register languages
const registerLanguages = () => {
  SyntaxHighlighter.registerLanguage('javascript', javascript)
  SyntaxHighlighter.registerLanguage('js', javascript)
  SyntaxHighlighter.registerLanguage('typescript', typescript)
  SyntaxHighlighter.registerLanguage('ts', typescript)
  SyntaxHighlighter.registerLanguage('python', python)
  SyntaxHighlighter.registerLanguage('py', python)
  SyntaxHighlighter.registerLanguage('css', css)
  SyntaxHighlighter.registerLanguage('scss', scss)
  SyntaxHighlighter.registerLanguage('json', json)
  SyntaxHighlighter.registerLanguage('html', xml)
  SyntaxHighlighter.registerLanguage('xml', xml)
  SyntaxHighlighter.registerLanguage('bash', bash)
  SyntaxHighlighter.registerLanguage('shell', bash)
  SyntaxHighlighter.registerLanguage('sh', bash)
  SyntaxHighlighter.registerLanguage('java', java)
  SyntaxHighlighter.registerLanguage('c', c)
  SyntaxHighlighter.registerLanguage('cpp', cpp)
  SyntaxHighlighter.registerLanguage('csharp', csharp)
  SyntaxHighlighter.registerLanguage('go', go)
  SyntaxHighlighter.registerLanguage('rust', rust)
  SyntaxHighlighter.registerLanguage('ruby', ruby)
  SyntaxHighlighter.registerLanguage('php', php)
  SyntaxHighlighter.registerLanguage('sql', sql)
  SyntaxHighlighter.registerLanguage('yaml', yaml)
  SyntaxHighlighter.registerLanguage('markdown', markdown)
  SyntaxHighlighter.registerLanguage('md', markdown)
  SyntaxHighlighter.registerLanguage('plaintext', plaintext)
  SyntaxHighlighter.registerLanguage('text', plaintext)
  
  // Vue uses XML (HTML) as fallback - highlightjs-vue has compatibility issues
  SyntaxHighlighter.registerLanguage('vue', xml)
  SyntaxHighlighter.registerLanguage('svelte', xml)
}

registerLanguages()

// Normalize language name
const normalizeLanguage = (lang: string): string => {
  const mapping: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'sh': 'bash',
    'shell': 'bash',
    'text': 'plaintext',
    'cs': 'csharp',
    'yml': 'yaml'
  }
  return mapping[lang.toLowerCase()] || lang.toLowerCase()
}

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
  
  const normalizedLanguage = normalizeLanguage(language)
  const displayLanguage = LANGUAGE_TO_LABEL[normalizedLanguage] || language.toUpperCase()
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  return (
    <div className="code-block-container">
      {/* Header */}
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
      
      {/* Code content */}
      <div 
        className="code-block-content"
        style={{ 
          maxHeight: isExpanded ? 'none' : `${maxHeight}px`,
          overflow: isExpanded ? 'auto' : 'hidden'
        }}
      >
        <SyntaxHighlighter
          language={normalizedLanguage}
          style={atomOneDark}
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
      
      {/* Expand mask */}
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
