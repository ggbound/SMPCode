/**
 * 消息项组件 - 优化版本
 * 使用 React.memo 避免不必要的重渲染
 */

import { memo, useState, useCallback } from 'react'
import type { Message } from '../store'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { t } from '../i18n'
import BuilderMessage from './BuilderMessage'

interface MessageItemProps {
  msg: Message
  index: number
  onContinueTimeout?: () => void
  onStopTimeout?: () => void
  isTimeoutMessage: boolean
}

// 使用 memo 包裹组件，只有当 props 变化时才重新渲染
export const MessageItem = memo(function MessageItem({
  msg,
  index,
  onContinueTimeout,
  onStopTimeout,
  isTimeoutMessage
}: MessageItemProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = useCallback(async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text)
      if (id) {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      }
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  // 用户消息
  if (msg.role === 'user') {
    return (
      <div className="user-message-wrapper">
        <div className="user-message-bubble">{msg.content}</div>
      </div>
    )
  }

  // Builder 模式消息
  if (msg.isBuilder) {
    return (
      <div className="assistant-message-wrapper">
        <BuilderMessage
          message={msg}
          onContinue={isTimeoutMessage ? onContinueTimeout : undefined}
          onStop={isTimeoutMessage ? onStopTimeout : undefined}
        />
      </div>
    )
  }

  // 普通 AI 消息
  return (
    <div className="assistant-message-wrapper">
      <div className="assistant-message-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => {
              const codeElement = children as React.ReactElement<{
                className?: string
                children?: React.ReactNode
              }>
              const className = codeElement?.props?.className || ''
              const languageMatch = /language-(\w+)/.exec(className || '')
              const language = languageMatch ? languageMatch[1] : 'text'
              const codeContent = codeElement?.props?.children || ''
              const codeId = `${index}-${language}-${String(codeContent).slice(0, 20)}`
              const isCopied = copiedId === codeId

              if (!codeContent || String(codeContent).trim().length === 0) {
                return null
              }

              const contentStr = String(codeContent)

              // 检查是否是目录树
              const isDirectoryTree =
                /[├└│─]/.test(contentStr) ||
                /^\s*├──|^\s*└──|^\s*│/.test(contentStr)

              // 检查是否是 Markdown
              const looksLikeMarkdown =
                /^\s*#{1,6}\s+/.test(contentStr) ||
                /^\s*[-*+]\s+/.test(contentStr) ||
                /^\s*\d+\.\s+/.test(contentStr) ||
                /^\s*\[.+\]\(.+\)/.test(contentStr) ||
                /^\s*\*\*.+\*\*/.test(contentStr) ||
                /^\s*__.+__/.test(contentStr)

              if (looksLikeMarkdown && language === 'text') {
                return (
                  <div className="markdown-content-wrapper">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {contentStr}
                    </ReactMarkdown>
                  </div>
                )
              }

              if (isDirectoryTree) {
                return (
                  <div className="code-block-wrapper">
                    <div className="code-block-header">
                      <span className="code-language">目录结构</span>
                      <button
                        onClick={() => copyToClipboard(contentStr, codeId)}
                        className={`copy-button ${isCopied ? 'copied' : ''}`}
                      >
                        {isCopied ? t('copied') : t('copy')}
                      </button>
                    </div>
                    <div className="code-block-content">
                      <pre
                        style={{
                          margin: 0,
                          padding: '16px',
                          background: '#1e1e1e',
                          fontSize: '13px',
                          lineHeight: '1.6',
                          overflow: 'auto'
                        }}
                      >
                        {contentStr}
                      </pre>
                    </div>
                  </div>
                )
              }

              return (
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-language">
                      {language === 'text' ? '代码' : language}
                    </span>
                    <button
                      onClick={() => copyToClipboard(contentStr, codeId)}
                      className={`copy-button ${isCopied ? 'copied' : ''}`}
                    >
                      {isCopied ? t('copied') : t('copy')}
                    </button>
                  </div>
                  <div className="code-block-content">
                    <SyntaxHighlighter
                      language={language}
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '16px',
                        fontSize: '13px',
                        lineHeight: '1.6'
                      }}
                    >
                      {contentStr}
                    </SyntaxHighlighter>
                  </div>
                </div>
              )
            },
            code: ({ children, className }) => {
              const languageMatch = /language-(\w+)/.exec(className || '')
              const language = languageMatch ? languageMatch[1] : ''
              const isInline = !language

              if (isInline) {
                return (
                  <code
                    style={{
                      background: 'var(--bg-tertiary)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '0.9em',
                      fontFamily: 'monospace'
                    }}
                  >
                    {children}
                  </code>
                )
              }

              return <code className={className}>{children}</code>
            }
          }}
        >
          {msg.content}
        </ReactMarkdown>
      </div>
    </div>
  )
})

export default MessageItem
