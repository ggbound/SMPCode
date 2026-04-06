import { useState, useRef, useEffect, useCallback, type RefObject } from 'react'
import type { Message, Command, ProviderConfig, ModelConfig } from '../store'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { t } from '../i18n'

interface ChatAreaProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string) => void
  onStopGeneration?: () => void
  messagesEndRef?: RefObject<HTMLDivElement | null>
  commands?: Command[]
  permissionMode?: string
  inputTokens?: number
  outputTokens?: number
  providers?: ProviderConfig[]
  model?: string
  onModelChange?: (model: string) => void
}

function ChatArea({
  messages,
  isLoading,
  onSendMessage,
  onStopGeneration,
  messagesEndRef,
  commands = [],
  permissionMode = 'read-only',
  inputTokens = 0,
  outputTokens = 0,
  providers = [],
  model = '',
  onModelChange
}: ChatAreaProps) {
  const [input, setInput] = useState('')

  // Map permission mode to translation
  const getPermissionLabel = (mode: string): string => {
    switch (mode) {
      case 'read-only': return t('readOnlyMode')
      case 'workspace-write': return t('workspaceWriteMode')
      case 'danger-full-access': return t('fullAccessMode')
      default: return mode
    }
  }
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([])
  const [showModelSelector, setShowModelSelector] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Get all enabled models from providers
  const getEnabledModels = useCallback(() => {
    const models: { id: string; name: string; provider: string }[] = []
    providers.filter(p => p.enabled).forEach(provider => {
      provider.models.forEach(m => {
        models.push({ id: m.id, name: m.name, provider: provider.name })
      })
    })
    return models
  }, [providers])

  // Auto-select first model if no model is selected
  useEffect(() => {
    if (!model && providers.length > 0) {
      const enabledModels = getEnabledModels()
      if (enabledModels.length > 0) {
        onModelChange?.(enabledModels[0].id)
      }
    }
  }, [model, providers, onModelChange, getEnabledModels])

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter commands when input changes
  useEffect(() => {
    if (input.startsWith('/')) {
      const query = input.slice(1).toLowerCase()
      const filtered = commands.filter(cmd =>
        cmd.name.toLowerCase().includes(query)
      ).slice(0, 10)
      setFilteredCommands(filtered)
      setShowCommandPalette(filtered.length > 0)
      setSelectedIndex(0)
    } else {
      setShowCommandPalette(false)
    }
  }, [input, commands])

  // Track scroll state
  const scrollStateRef = useRef({
    isAtBottom: true,
    lastScrollHeight: 0,
    lastMessageCount: 0
  })

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback((immediate = false) => {
    const container = messagesContainerRef.current
    if (!container) return

    const targetScroll = container.scrollHeight - container.clientHeight

    if (immediate) {
      container.scrollTop = targetScroll
    } else {
      // Use smooth scrolling only for user-initiated scrolls
      container.scrollTo({ top: targetScroll, behavior: 'auto' })
    }
  }, [])

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    scrollStateRef.current.isAtBottom = distanceFromBottom < 30
  }, [])

  // Auto-scroll effect - runs when messages change
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const currentMessageCount = messages.length
    const lastMessage = messages[messages.length - 1]
    const isNewMessage = currentMessageCount > scrollStateRef.current.lastMessageCount

    // Always scroll on new message
    if (isNewMessage) {
      // Small delay to let DOM update
      requestAnimationFrame(() => {
        scrollToBottom(true)
      })
    }
    // For streaming, only scroll if user is at bottom
    else if (lastMessage?.role === 'assistant' && isLoading && scrollStateRef.current.isAtBottom) {
      scrollToBottom(true)
    }

    scrollStateRef.current.lastMessageCount = currentMessageCount
  }, [messages, isLoading, scrollToBottom])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      onSendMessage(input)
      setInput('')
      setShowCommandPalette(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommandPalette) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const selected = filteredCommands[selectedIndex]
        if (selected) {
          setInput(`/${selected.name} `)
          setShowCommandPalette(false)
        }
        return
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleCommandClick = (cmd: Command) => {
    setInput(`/${cmd.name} `)
    setShowCommandPalette(false)
    textareaRef.current?.focus()
  }

  // Copy code to clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text)
      if (id) {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      }
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="chat-area">
      <div
        ref={messagesContainerRef}
        className="messages-container"
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)'
          }}>
            <h2 style={{ marginBottom: '8px' }}>{t('welcomeTitle')}</h2>
            <p>{t('welcomeDesc')}</p>
            <p style={{ fontSize: '12px', marginTop: '16px' }}>
              {t('welcomeTip')}
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              {msg.role === 'user' ? (
                // User message - right aligned with bubble
                <div className="user-message-wrapper">
                  <div className="user-message-bubble">
                    {msg.content}
                  </div>
                </div>
              ) : (
                // Assistant message - left aligned with thinking tags
                <div className="assistant-message-wrapper">
                  <div className="assistant-message-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children, ...props }) => {
                          const codeElement = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>
                          const className = codeElement?.props?.className || ''
                          const language = className.replace('language-', '') || 'text'
                          const codeContent = codeElement?.props?.children || ''
                          const codeId = `${language}-${String(codeContent).slice(0, 20)}`
                          const isCopied = copiedId === codeId

                          return (
                            <div className="code-block-wrapper">
                              <div className="code-block-header">
                                <span className="code-language">{language}</span>
                                <button
                                  onClick={() => copyToClipboard(String(codeContent), codeId)}
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
                                    background: '#1e1e1e',
                                    fontSize: '13px',
                                    lineHeight: '1.6',
                                    minWidth: 'fit-content',
                                    borderRadius: '0'
                                  }}
                                  showLineNumbers={true}
                                  lineNumberStyle={{
                                    color: '#6e7681',
                                    fontSize: '12px',
                                    minWidth: '2.5em'
                                  }}
                                >
                                  {String(codeContent).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              </div>
                            </div>
                          )
                        },
                        code: ({ children, className }) => {
                          const isInline = !className
                          return isInline ? (
                            <code className="inline-code">{children}</code>
                          ) : (
                            <code>{children}</code>
                          )
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          // Only show loading spinner if the last message is not from assistant
          // (streaming mode adds an assistant message that gets filled progressively)
          (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') && (
            <div className="message assistant">
              <div className="message-avatar">AI</div>
              <div className="message-content">
                <div className="spinner" />
              </div>
            </div>
          )
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area with Toolbar */}
      <form className="input-area" onSubmit={handleSubmit}>
        <div className="input-container" style={{ position: 'relative' }}>
          {showCommandPalette && filteredCommands.length > 0 && (
            <div className="command-palette-dropdown" style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              maxHeight: '200px',
              overflowY: 'auto',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              marginBottom: '8px',
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}>
              {filteredCommands.map((cmd, idx) => (
                <div
                  key={cmd.name}
                  className={`command-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleCommandClick(cmd)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    backgroundColor: idx === selectedIndex ? 'var(--accent-color)' : 'transparent',
                    color: idx === selectedIndex ? 'white' : 'var(--text-primary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>/{cmd.name}</div>
                  {cmd.responsibility && (
                    <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px' }}>
                      {cmd.responsibility.replace('Command module mirrored from archived TypeScript path ', '').replace('commands/', '')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="message-input"
            placeholder={t('inputPlaceholder') || '规划与编程，@添加上下文，/使用命令'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={3}
          />
        </div>

        {/* Toolbar */}
        <div className="input-toolbar">
          <div className="toolbar-left">
            {/* Model Selector - Moved to toolbar */}
            {providers.length > 0 && (
              <div className="model-selector-container" ref={modelSelectorRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="toolbar-btn model-selector-btn"
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  title={getEnabledModels().find(m => m.id === model)?.name || model || t('selectModel') || '选择模型'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '13px',
                    maxWidth: '400px',
                    minWidth: '120px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="9" y1="21" x2="9" y2="9"></line>
                  </svg>
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: '1'
                  }}>{getEnabledModels().find(m => m.id === model)?.name || model || t('selectModel') || '选择模型'}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{
                    transform: showModelSelector ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    flexShrink: 0
                  }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                
                {showModelSelector && (
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: '4px',
                    minWidth: '200px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 100
                  }}>
                    {providers.filter(p => p.enabled).map(provider => (
                      <div key={provider.id}>
                        <div style={{
                          padding: '8px 12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-tertiary)',
                          borderBottom: '1px solid var(--border-color)'
                        }}>
                          {provider.name}
                        </div>
                        {provider.models.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              onModelChange?.(m.id)
                              setShowModelSelector(false)
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              padding: '10px 12px',
                              textAlign: 'left',
                              background: model === m.id ? 'var(--accent-color)' : 'transparent',
                              color: model === m.id ? 'white' : 'var(--text-primary)',
                              border: 'none',
                              borderBottom: '1px solid var(--border-color)',
                              cursor: 'pointer',
                              fontSize: '13px'
                            }}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    ))}
                    {getEnabledModels().length === 0 && (
                      <div style={{
                        padding: '12px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '13px'
                      }}>
                        {t('noModelsAvailable') || '没有可用的模型'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Context Button */}
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setInput(prev => prev + '@')}
              title={t('addContext') || '添加上下文'}
            >
              <span className="toolbar-icon">@</span>
            </button>

            {/* Image Button */}
            <button
              type="button"
              className="toolbar-btn"
              title={t('addImage') || '添加图片'}
            >
              <svg className="toolbar-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </button>
          </div>

          <div className="toolbar-right">
            {isLoading ? (
              <button
                type="button"
                className="toolbar-btn stop-btn"
                onClick={onStopGeneration}
                title={t('stopGeneration') || '停止生成'}
              >
                <svg className="toolbar-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                className="toolbar-btn send-btn"
                disabled={!input.trim()}
                title={t('send') || '发送'}
              >
                <svg className="toolbar-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Status Bar */}
      <div className="chat-status-bar">
        <div className="status-left">
          <span className="status-item" title={`${t('permission')}: ${permissionMode}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span className="status-value">{getPermissionLabel(permissionMode)}</span>
          </span>
        </div>
        <div className="status-right">
          <span className="status-item" title={`${t('in')}: ${inputTokens}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            <span className="status-value">{inputTokens}</span>
          </span>
          <span className="status-item" title={`${t('out')}: ${outputTokens}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
              <polyline points="17 18 23 18 23 12"></polyline>
            </svg>
            <span className="status-value">{outputTokens}</span>
          </span>
          <span className="status-item" title={`${t('total')}: ${inputTokens + outputTokens}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span className="status-value">{inputTokens + outputTokens}</span>
          </span>
          <span className="status-item" title={`${t('estCost')}: $${((inputTokens + outputTokens) * 0.003).toFixed(4)}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            <span className="status-value">${((inputTokens + outputTokens) * 0.003).toFixed(4)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default ChatArea