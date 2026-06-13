/**
 * 流式对话页面 - 展示新的 AI Coding 交互设计
 * 
 * 特性：
 * 1. 流式消息显示
 * 2. 内联工具调用卡片
 * 3. 实时状态更新
 * 4. 简洁的界面设计
 */

import { useRef, useEffect, useCallback } from 'react'
import { StreamingMessage } from '../components/StreamingMessage'
import { useStreamingAgent } from '../hooks/useStreamingAgent'
import { useKiloStore } from '../store/kiloStore'
import { Send, Square, RotateCcw, Trash2, Bot } from 'lucide-react'

interface StreamingChatPageProps {
  cwd: string
  model: string
}

export function StreamingChatPage({ cwd, model }: StreamingChatPageProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  
  const { 
    messages, 
    isGenerating, 
    currentMessageId,
    sendMessage, 
    stopGeneration,
    clearMessages 
  } = useStreamingAgent({ cwd, model })
  
  const { input, setInput } = useKiloStore()
  
  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])
  
  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating) return
    
    const content = input.trim()
    setInput('')
    await sendMessage(content)
  }, [input, isGenerating, sendMessage, setInput])
  
  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])
  
  // 清空对话
  const handleClear = useCallback(() => {
    if (confirm('确定要清空所有消息吗？')) {
      clearMessages()
    }
  }, [clearMessages])
  
  return (
    <div className="streaming-chat-page" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#1e1e1e',
      color: '#e2e8f0'
    }}>
      {/* 头部 */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        backgroundColor: '#252526'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Bot size={20} style={{ color: '#3b82f6' }} />
          <span style={{ fontWeight: 500 }}>AI 助手</span>
          <span style={{ 
            fontSize: '12px', 
            color: 'rgba(255,255,255,0.5)',
            padding: '2px 8px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: '4px'
          }}>
            Agent Mode
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleClear}
            disabled={messages.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
              opacity: messages.length === 0 ? 0.5 : 1,
              fontSize: '13px'
            }}
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </header>
      
      {/* 消息列表 */}
      <main style={{
        flex: 1,
        overflow: 'auto',
        padding: '20px'
      }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'rgba(255,255,255,0.3)'
          }}>
            <Bot size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <p style={{ fontSize: '16px', marginBottom: '8px' }}>
              开始一个新的对话
            </p>
            <p style={{ fontSize: '13px' }}>
              输入消息与 AI 助手交流
            </p>
          </div>
        ) : (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {messages.map((message, index) => (
              <StreamingMessage
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>
      
      {/* 输入区域 */}
      <footer style={{
        padding: '16px 20px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        backgroundColor: '#252526'
      }}>
        <div style={{
          display: 'flex',
          gap: '12px',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <div style={{
            flex: 1,
            position: 'relative',
            backgroundColor: '#1e1e1e',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isGenerating ? 'AI 正在思考...' : '输入消息...'}
              disabled={isGenerating}
              style={{
                width: '100%',
                minHeight: '52px',
                maxHeight: '200px',
                padding: '14px 16px',
                border: 'none',
                borderRadius: '12px',
                backgroundColor: 'transparent',
                color: '#e2e8f0',
                fontSize: '14px',
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit'
              }}
              rows={1}
            />
          </div>
          
          {isGenerating ? (
            <button
              onClick={stopGeneration}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: '#ef4444',
                color: 'white',
                cursor: 'pointer'
              }}
            >
              <Square size={20} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: input.trim() ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                color: 'white',
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s'
              }}
            >
              <Send size={20} />
            </button>
          )}
        </div>
        
        {/* 提示文字 */}
        <div style={{
          textAlign: 'center',
          marginTop: '8px',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.3)'
        }}>
          按 Enter 发送，Shift + Enter 换行
        </div>
      </footer>
    </div>
  )
}

export default StreamingChatPage
