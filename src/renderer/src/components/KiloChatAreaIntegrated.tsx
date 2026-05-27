/**
 * Kilo Code 风格聊天区域（集成版）
 * 与现有消息系统兼容的 Kilo 风格组件
 */

import { memo, useCallback, useRef, useEffect, useState } from 'react'
import { Send, Square, Paperclip, Loader2 } from 'lucide-react'
import { ModeSelector } from './ModeSelector'
import { KiloMessage } from './KiloMessage'
import { AgentMode, KiloMessage as KiloMessageType, KiloToolCall, MessageBlock } from '../types/agent'
import type { Message, ImageContent } from '../store'

interface KiloChatAreaIntegratedProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (content: string, images?: ImageContent[]) => void
  onStopGeneration?: () => void
  chatMode?: 'agent' | 'chat'
  onChatModeChange?: (mode: 'agent' | 'chat') => void
}

// 转换现有消息格式为 Kilo 格式
function convertToKiloMessage(message: Message, index: number, total: number): KiloMessageType {
  const isLast = index === total - 1
  
  // 转换工具调用
  const toolCalls: KiloToolCall[] = message.toolCalls?.map(tc => ({
    id: tc.id,
    name: tc.name,
    args: tc.args,
    status: tc.status,
    timestamp: tc.timestamp,
    duration: tc.duration,
    result: tc.result
  })) || []

  // 转换消息块
  const blocks: MessageBlock[] = []
  
  // 如果有思考步骤，添加为 thinking 块
  if (message.steps && message.steps.length > 0) {
    const thinkingContent = message.steps.map(step => 
      `**${step.title}**${step.content ? '\n' + step.content : ''}`
    ).join('\n\n')
    
    blocks.push({
      id: `thinking-${message.timestamp || index}`,
      type: 'thinking',
      content: thinkingContent,
      timestamp: message.timestamp || Date.now()
    })
  }

  return {
    id: `msg-${index}`,
    role: message.role as 'user' | 'assistant' | 'system',
    content: message.content,
    blocks,
    toolCalls,
    timestamp: message.timestamp || Date.now(),
    isStreaming: message.isStreaming ?? false,
    mode: 'code' // 默认使用 code 模式
  }
}

export const KiloChatAreaIntegrated = memo(function KiloChatAreaIntegrated({
  messages,
  isLoading,
  onSendMessage,
  onStopGeneration,
  chatMode = 'agent',
  onChatModeChange
}: KiloChatAreaIntegratedProps) {
  const [input, setInput] = useState('')
  const [selectedImages, setSelectedImages] = useState<ImageContent[]>([])
  const [currentMode, setCurrentMode] = useState<AgentMode>('code')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // 转换消息为 Kilo 格式
  const kiloMessages = messages.map((msg, index) => 
    convertToKiloMessage(msg, index, messages.length)
  )

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 处理模式切换
  const handleModeChange = useCallback((mode: AgentMode) => {
    setCurrentMode(mode)
    // 同步到 chatMode
    if (mode === 'ask') {
      onChatModeChange?.('chat')
    } else {
      onChatModeChange?.('agent')
    }
  }, [onChatModeChange])

  // 发送消息
  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return
    onSendMessage(input.trim(), selectedImages.length > 0 ? selectedImages : undefined)
    setInput('')
    setSelectedImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isLoading, onSendMessage, selectedImages])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // 自动调整高度
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }, [])

  // 处理文件选择
  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1]
          if (base64) {
            setSelectedImages(prev => [...prev, {
              type: 'image',
              data: base64,
              mimeType: file.type,
              name: file.name
            }])
          }
        }
        reader.readAsDataURL(file)
      }
    })
    e.target.value = ''
  }, [])

  // 移除已选择的图片
  const removeImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div className="kilo-chat-area">
      {/* 顶部工具栏 */}
      <div className="kilo-chat-header">
        <ModeSelector 
          currentMode={currentMode} 
          onModeChange={handleModeChange} 
        />
      </div>

      {/* 消息列表 */}
      <div className="kilo-messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="kilo-empty-state">
            <div className="kilo-empty-icon">
              <Loader2 size={48} className="kilo-spin-slow" />
            </div>
            <h3 className="kilo-empty-title">开始对话</h3>
            <p className="kilo-empty-desc">
              选择上方模式，开始与 AI 助手对话
            </p>
            <div className="kilo-mode-hints">
              <div className="kilo-mode-hint">
                <span className="kilo-mode-hint-icon code">💻</span>
                <span>Code - 编写代码</span>
              </div>
              <div className="kilo-mode-hint">
                <span className="kilo-mode-hint-icon architect">📐</span>
                <span>Architect - 架构设计</span>
              </div>
              <div className="kilo-mode-hint">
                <span className="kilo-mode-hint-icon debug">🐛</span>
                <span>Debug - 调试代码</span>
              </div>
              <div className="kilo-mode-hint">
                <span className="kilo-mode-hint-icon ask">💬</span>
                <span>Ask - 问答咨询</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="kilo-messages-list">
            {kiloMessages.map((message, index) => (
              <KiloMessage 
                key={message.id}
                message={message}
                isLast={index === kiloMessages.length - 1}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部输入区域 */}
      <div className="kilo-input-area">
        {/* 已选择的图片预览 */}
        {selectedImages.length > 0 && (
          <div className="kilo-image-preview-bar">
            {selectedImages.map((img, index) => (
              <div key={index} className="kilo-image-preview-item">
                <img 
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name || `Image ${index + 1}`}
                />
                <button 
                  className="kilo-image-remove"
                  onClick={() => removeImage(index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="kilo-input-container">
          <button 
            className="kilo-attach-button" 
            title="添加附件"
            onClick={handleFileSelect}
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <textarea
            ref={textareaRef}
            className="kilo-textarea"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            disabled={isLoading}
          />
          {isLoading ? (
            <button 
              className="kilo-stop-button"
              onClick={onStopGeneration}
              title="停止生成"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button 
              className={`kilo-send-button ${!input.trim() ? 'disabled' : ''}`}
              onClick={handleSend}
              disabled={!input.trim()}
              title="发送消息"
            >
              <Send size={18} />
            </button>
          )}
        </div>
        <div className="kilo-input-footer">
          <span className="kilo-input-hint">
            按 Enter 发送，Shift + Enter 换行
          </span>
        </div>
      </div>
    </div>
  )
})
