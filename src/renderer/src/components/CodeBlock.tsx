import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
  maxHeight?: number
}

export function CodeBlock({ 
  code, 
  language,
  showLineNumbers = true,
  maxHeight = 400
}: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const lines = code.split('\n')

  return (
    <div className="code-block-container" style={{ position: 'relative' }}>
      {/* Header */}
      <div className="code-block-header">
        <span className="code-language">
          {language === 'text' || language === 'plaintext' ? '代码' : language.toUpperCase()}
        </span>
        <button
          onClick={handleCopy}
          className="code-block-action-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          {isCopied ? (
            <>
              <Check size={12} />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <div 
        className="code-block-content"
        style={{ 
          maxHeight: `${maxHeight}px`,
          overflow: 'auto',
          background: '#161b22'
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.6',
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            color: '#c9d1d9',
            overflowX: 'auto'
          }}
        >
          {showLineNumbers ? (
            <code>
              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '40px',
                      color: '#6e7681',
                      textAlign: 'right',
                      paddingRight: '16px',
                      userSelect: 'none',
                      flexShrink: 0
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ whiteSpace: 'pre' }}>{line}</span>
                </div>
              ))}
            </code>
          ) : (
            <code style={{ whiteSpace: 'pre' }}>{code}</code>
          )}
        </pre>
      </div>
    </div>
  )
}
