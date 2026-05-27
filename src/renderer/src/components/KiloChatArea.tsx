/**
 * Kilo Code 风格聊天区域
 * 参考: https://kilocode.ai
 * 
 * 特点:
 * - 顶部模式选择器
 * - 简洁的消息列表
 * - 流式响应支持
 * - 底部输入区域
 */

import { memo, useCallback, useRef, useEffect, useState } from 'react'
import { Send, Square, Paperclip, Loader2 } from 'lucide-react'
import { ModeSelector } from './ModeSelector'
import { KiloMessage } from './KiloMessage'
import { AgentMode, KiloMessage as KiloMessageType } from '../types/agent'

interface KiloChatAreaProps {
  messages: KiloMessageType[]
  currentMode: AgentMode
  onModeChange: (mode: AgentMode) => void
  onSendMessage: (content: string) => void
  onStopGeneration?: () => void
  isGenerating?: boolean
  placeholder?: string
}

export const KiloChatArea = memo(function KiloChatArea({
  messages,
  currentMode,
  onModeChange,
  onSendMessage,
  onStopGeneration,
  isGenerating = false,
  placeholder = '输入消息...'
}: KiloChatAreaProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 发送消息
  const handleSend = useCallback(() => {
    if (!input.trim() || isGenerating) return
    onSendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isGenerating, onSendMessage])

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

  return (
    <div className="kilo-chat-area">
      {/* 顶部工具栏 */}
      <div className="kilo-chat-header">
        <ModeSelector 
          currentMode={currentMode} 
          onModeChange={onModeChange} 
        />
      </div>

      {/* 消息列表 */}
      <div className="kilo-messages-container">
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
            {messages.map((message, index) => (
              <KiloMessage 
                key={message.id} 
                message={message}
                isLast={index === messages.length - 1}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部输入区域 */}
      <div className="kilo-input-area">
        <div className="kilo-input-container">
          <button className="kilo-attach-button" title="添加附件">
            <Paperclip size={18} />
          </button>
          <textarea
            ref={textareaRef}
            className="kilo-textarea"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isGenerating}
          />
          {isGenerating ? (
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
