import { useState, useRef, useEffect, useCallback, useMemo, type RefObject } from 'react'
import type { Message, Command, ProviderConfig, ModelConfig, ImageContent } from '../store'
import { t } from '../i18n'
import { TimeoutPrompt } from './TimeoutPrompt'
import { MessageItem } from './MessageItem'

interface ChatAreaProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string, images?: ImageContent[]) => void
  onStopGeneration?: () => void
  messagesEndRef?: RefObject<HTMLDivElement | null>
  commands?: Command[]
  permissionMode?: string
  inputTokens?: number
  outputTokens?: number
  providers?: ProviderConfig[]
  model?: string
  onModelChange?: (model: string) => void
  onContinueExecution?: () => void
  showContinueButton?: boolean
  onContinueTimeout?: () => void
  onStopTimeout?: () => void
  isTimeout?: boolean
  timeoutMessageIndex?: number | null
  chatMode?: 'agent' | 'chat'
  onChatModeChange?: (mode: 'agent' | 'chat') => void
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
  onModelChange,
  onContinueExecution,
  showContinueButton,
  onContinueTimeout,
  onStopTimeout,
  isTimeout = false,
  timeoutMessageIndex = null,
  chatMode = 'agent',
  onChatModeChange
}: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [selectedImages, setSelectedImages] = useState<ImageContent[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  const [showChatModeSelector, setShowChatModeSelector] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const chatModeSelectorRef = useRef<HTMLDivElement>(null)

  // 使用 useMemo 缓存消息渲染，避免输入时重复计算
  const messageList = useMemo(() => {
    return messages
  }, [messages])

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
      if (chatModeSelectorRef.current && !chatModeSelectorRef.current.contains(event.target as Node)) {
        setShowChatModeSelector(false)
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
    if ((input.trim() || selectedImages.length > 0) && !isLoading) {
      onSendMessage(input, selectedImages.length > 0 ? selectedImages : undefined)
      setInput('')
      setSelectedImages([])
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

  // 已知支持视觉的模型 ID 模式（自动检测）
  const VISION_MODEL_PATTERNS = [
    /gpt-4.*vision/i,
    /gpt-4o/i,
    /claude-3/i,
    /qwen.*vl/i,
    /kimi/i,
    /glm-4v/i,
    /gemini.*pro.*vision/i,
    /llava/i,
    /vision/i,
    /multimodal/i
  ]

  // 检查模型 ID 是否匹配已知的视觉模型模式
  const isKnownVisionModel = useCallback((modelId: string): boolean => {
    return VISION_MODEL_PATTERNS.some(pattern => pattern.test(modelId))
  }, [])

  // 检查当前模型是否支持图片
  const currentModelSupportsVision = useCallback(() => {
    if (!model) return false

    // 首先检查是否是已知的视觉模型
    if (isKnownVisionModel(model)) {
      return true
    }

    // 否则检查配置中的 supportsVision 标志
    if (!providers) return false
    for (const provider of providers) {
      if (!provider.enabled) continue
      const foundModel = provider.models.find(m => m.id === model)
      if (foundModel) {
        return foundModel.supportsVision === true
      }
    }
    return false
  }, [model, providers, isKnownVisionModel])

  // 处理图片选择
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    // 检查模型是否支持图片
    if (!currentModelSupportsVision()) {
      alert(t('modelNotSupportVision') || '当前模型不支持图片，请在设置中选择一个支持视觉的模型（如 GPT-4V、Claude 3、Qwen-VL 等）')
      e.target.value = ''
      return
    }

    Array.from(files).forEach(file => {
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        console.warn('Non-image file skipped:', file.name)
        return
      }

      // 检查文件大小（限制 10MB）
      if (file.size > 10 * 1024 * 1024) {
        alert(t('imageTooLarge') || '图片大小不能超过 10MB')
        return
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        if (result) {
          // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
          const base64Data = result.split(',')[1]
          const mimeType = file.type

          const newImage: ImageContent = {
            type: 'image',
            data: base64Data,
            mimeType,
            name: file.name
          }

          setSelectedImages(prev => [...prev, newImage])
        }
      }
      reader.readAsDataURL(file)
    })

    // 清空 input 以便可以再次选择相同文件
    e.target.value = ''
  }, [currentModelSupportsVision])

  // 移除已选择的图片
  const removeImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 触发文件选择
  const triggerImageUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // 处理粘贴事件（支持截图粘贴）
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    let hasImage = false

    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      // 检查是否是图片类型
      if (item.type.startsWith('image/')) {
        hasImage = true

        // 检查模型是否支持图片
        if (!currentModelSupportsVision()) {
          alert(t('modelNotSupportVision') || '当前模型不支持图片，请在设置中选择一个支持视觉的模型（如 GPT-4V、Claude 3、Qwen-VL 等）')
          e.preventDefault()
          return
        }

        const file = item.getAsFile()
        if (!file) continue

        // 检查文件大小（限制 10MB）
        if (file.size > 10 * 1024 * 1024) {
          alert(t('imageTooLarge') || '图片大小不能超过 10MB')
          e.preventDefault()
          return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
          const result = event.target?.result as string
          if (result) {
            // 提取 base64 数据
            const base64Data = result.split(',')[1]
            const mimeType = file.type

            const newImage: ImageContent = {
              type: 'image',
              data: base64Data,
              mimeType,
              name: `截图_${new Date().toLocaleTimeString()}.png`
            }

            setSelectedImages(prev => [...prev, newImage])
          }
        }
        reader.readAsDataURL(file)

        // 阻止默认粘贴行为（防止图片内容被粘贴到 textarea）
        e.preventDefault()
      }
    }

    // 如果没有图片，允许正常粘贴文本
  }, [currentModelSupportsVision])

  return (
    <div className="chat-area">
      <div
        ref={messagesContainerRef}
        className="messages-container"
        onScroll={handleScroll}
      >
        {messageList.length === 0 ? (
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
          messageList.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <MessageItem
                msg={msg}
                index={idx}
                onContinueTimeout={onContinueTimeout}
                onStopTimeout={onStopTimeout}
                isTimeoutMessage={idx === timeoutMessageIndex}
              />
              {/* Show continue button for messages that need action */}
              {msg.role === 'assistant' && msg.needsAction === 'continue' && onContinueExecution && (
                <div className="continue-action-container">
                  <button
                    className="continue-button"
                    onClick={onContinueExecution}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner-small" />
                        继续执行中...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                        继续执行
                      </>
                    )}
                  </button>
                </div>
              )}
              {/* Timeout prompt for non-builder messages */}
              {msg.role === 'assistant' && isTimeout && idx === timeoutMessageIndex && (
                <TimeoutPrompt
                  onContinue={onContinueTimeout}
                  onStop={onStopTimeout}
                />
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
        {/* 图片预览区域 - 独立一行在输入框上方 */}
        {selectedImages.length > 0 && (
          <div className="image-preview-container" style={{
            display: 'flex',
            gap: '6px',
            padding: '6px 12px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            borderRadius: '8px 8px 0 0',
            overflowX: 'auto',
            overflowY: 'hidden',
            flexWrap: 'nowrap',
            alignItems: 'center',
            minHeight: '44px',
            maxHeight: '52px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--border-color) transparent'
          }}>
            {selectedImages.map((img, index) => (
              <div key={index} className="image-preview-item" style={{
                position: 'relative',
                display: 'flex',
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div style={{ position: 'relative' }}>
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.name || `Image ${index + 1}`}
                    title={img.name || `图片 ${index + 1}`}
                    style={{
                      width: '36px',
                      height: '36px',
                      objectFit: 'cover',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'block',
                      border: '1px solid var(--border-color)'
                    }}
                    onClick={() => {
                      // 点击可查看大图
                      const newWindow = window.open()
                      if (newWindow) {
                        newWindow.document.write(`<img src="data:${img.mimeType};base64,${img.data}" style="max-width:100%;height:auto;" />`)
                      }
                    }}
                  />
                  <button
                    onClick={() => removeImage(index)}
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: 'var(--error-color, #ef4444)',
                      color: 'white',
                      border: '1.5px solid var(--bg-tertiary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      lineHeight: '1',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                      zIndex: 10,
                      transition: 'all 0.15s ease',
                      padding: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.15)'
                      e.currentTarget.style.background = '#dc2626'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)'
                      e.currentTarget.style.background = 'var(--error-color, #ef4444)'
                    }}
                    title={t('removeImage') || '移除图片'}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
            placeholder={t('inputPlaceholder') || '规划与编程，@添加上下文，/使用命令，粘贴图片'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isLoading}
            rows={3}
          />
        </div>

        {/* Toolbar */}
        <div className="input-toolbar">
          <div className="toolbar-left">
            {/* Chat Mode Selector - Styled like model selector */}
            <div className="chat-mode-selector-container" ref={chatModeSelectorRef} style={{ position: 'relative', marginRight: '8px' }}>
              <button
                type="button"
                className="toolbar-btn chat-mode-selector-btn"
                onClick={() => setShowChatModeSelector(!showChatModeSelector)}
                title={chatMode === 'agent' ? '智能体模式 - 可调用工具' : '智能问答模式 - 纯对话'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  fontSize: '13px',
                  maxWidth: '140px',
                  minWidth: '100px'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  {chatMode === 'agent' ? (
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  ) : (
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  )}
                </svg>
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: '1'
                }}>{chatMode === 'agent' ? '智能体' : '智能问答'}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{
                  transform: showChatModeSelector ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  flexShrink: 0
                }}>
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              
              {showChatModeSelector && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  minWidth: '140px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 100
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      onChatModeChange?.('chat')
                      setShowChatModeSelector(false)
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      textAlign: 'left',
                      border: 'none',
                      background: chatMode === 'chat' ? 'var(--bg-tertiary)' : 'transparent',
                      color: chatMode === 'chat' ? 'var(--accent-color)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>智能问答</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChatModeChange?.('agent')
                      setShowChatModeSelector(false)
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      textAlign: 'left',
                      border: 'none',
                      background: chatMode === 'agent' ? 'var(--bg-tertiary)' : 'transparent',
                      color: chatMode === 'agent' ? 'var(--accent-color)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    <span>智能体</span>
                  </button>
                </div>
              )}
            </div>

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
              className={`toolbar-btn ${selectedImages.length > 0 ? 'has-images' : ''}`}
              onClick={triggerImageUpload}
              title={t('addImage') || '添加图片'}
              style={selectedImages.length > 0 ? { color: 'var(--accent-color)' } : undefined}
            >
              <svg className="toolbar-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              {selectedImages.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--accent-color)',
                  color: 'white',
                  fontSize: '10px',
                  padding: '2px 5px',
                  borderRadius: '10px',
                  minWidth: '16px',
                  textAlign: 'center'
                }}>
                  {selectedImages.length}
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
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


    </div>
  )
}

export default ChatArea