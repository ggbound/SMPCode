/**
 * 消息项组件 - 优化版本
 * 使用 React.memo 避免不必要的重渲染
 */

import { memo, useState, useCallback } from 'react'
import type { Message, ImageContent } from '../store'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MonacoCodeHighlight from './CodeBlock'
import { t } from '../i18n'
import BuilderMessage from './BuilderMessage'

// 图片画廊组件
const ImageGallery = memo(function ImageGallery({ images }: { images: ImageContent[] }) {
  if (!images || images.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '8px',
      marginBottom: '8px'
    }}>
      {images.map((img, index) => (
        <div
          key={index}
          style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            maxWidth: images.length === 1 ? '300px' : '150px'
          }}
          onClick={() => {
            // 点击可查看大图
            const newWindow = window.open()
            if (newWindow) {
              newWindow.document.write(`<img src="data:${img.mimeType};base64,${img.data}" style="max-width:100%;height:auto;" />`)
            }
          }}
        >
          <img
            src={`data:${img.mimeType};base64,${img.data}`}
            alt={img.name || `Image ${index + 1}`}
            style={{
              width: '100%',
              height: 'auto',
              maxHeight: images.length === 1 ? '300px' : '150px',
              objectFit: 'cover',
              display: 'block'
            }}
          />
          {img.name && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              color: 'white',
              fontSize: '10px',
              padding: '4px 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {img.name}
            </div>
          )}
        </div>
      ))}
    </div>
  )
})

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
        <div className="user-message-bubble">
          {msg.content}
          <ImageGallery images={msg.images || []} />
        </div>
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
          rehypePlugins={[rehypeRaw]}
          components={{
            pre: ({ children }) => {
              const codeElement = children as React.ReactElement<{
                className?: string
                children?: React.ReactNode
              }>
              const className = codeElement?.props?.className || ''
              const languageMatch = /language-(\w+)/.exec(className || '')
              // MonacoCodeHighlight 内部会处理语言标准化
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
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
                    <MonacoCodeHighlight
                      code={contentStr}
                      language={language}
                      showLineNumbers={true}
                      maxHeight={500}
                    />
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
