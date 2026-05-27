/**
 * Kilo Code 风格主应用组件
 * 完全复刻 Kilo Code 的界面布局
 */

import { memo, useCallback, useEffect, useState } from 'react'
import { 
  PanelLeft, 
  Plus,
  MessageSquare,
  Trash2
} from 'lucide-react'
import { ModeSelector } from './ModeSelector'
import { KiloMessage } from './KiloMessage'
import type { KiloMessage as KiloMessageType } from '../store/kiloStore'
import { useKiloConversation } from '../hooks/useKiloConversation'
import { useKiloStore } from '../store/kiloStore'
import { AgentMode } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'

interface KiloAppProps {
  apiKey: string
  model: string
  projectPath?: string
}

export const KiloApp = memo(function KiloApp({ apiKey, model, projectPath }: KiloAppProps) {
  const [showSidebar, setShowSidebar] = useState(false)
  
  const store = useKiloStore()
  const conversation = useKiloConversation({ apiKey, model, projectPath })
  
  // 初始化时创建默认会话
  useEffect(() => {
    if (store.sessions.length === 0) {
      conversation.createSession('New Chat')
    }
  }, [])
  
  // 创建新会话
  const handleNewChat = useCallback(() => {
    conversation.createSession()
  }, [conversation])
  
  // 删除会话
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    conversation.deleteSession(sessionId)
  }, [conversation])
  
  // 切换模式
  const handleModeChange = useCallback((mode: AgentMode) => {
    conversation.setCurrentMode(mode)
    if (store.currentSession) {
      store.updateSession(store.currentSession, { mode })
    }
  }, [conversation, store])
  
  // 清空当前会话
  const handleClearChat = useCallback(() => {
    conversation.clearCurrentSession()
  }, [conversation])
  
  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
    
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  
  return (
    <div className="kilo-app">
      {/* 侧边栏 */}
      {showSidebar && (
        <aside className="kilo-sidebar">
          <div className="kilo-sidebar-header">
            <button className="kilo-new-chat-btn" onClick={handleNewChat}>
              <Plus size={16} />
              <span>新对话</span>
            </button>
          </div>
          
          <div className="kilo-sessions-list">
            {store.sessions.map(session => (
              <div
                key={session.id}
                className={`kilo-session-item ${session.id === store.currentSession ? 'active' : ''}`}
                onClick={() => conversation.switchSession(session.id)}
              >
                <MessageSquare size={16} className="kilo-session-icon" />
                <div className="kilo-session-info">
                  <span className="kilo-session-title">{session.title}</span>
                  <span className="kilo-session-meta">
                    {formatTime(session.updatedAt)} · {session.messageCount} 条消息
                  </span>
                </div>
                <button 
                  className="kilo-session-delete"
                  onClick={(e) => handleDeleteSession(session.id, e)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          
        </aside>
      )}
      
      {/* 主内容区 */}
      <main className="kilo-main">
        {/* 顶部工具栏 */}
        <header className="kilo-header">
          <div className="kilo-header-left">
            <button 
              className="kilo-toggle-sidebar"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              <PanelLeft size={18} />
            </button>
            <ModeSelector 
              currentMode={conversation.currentMode}
              onModeChange={handleModeChange}
            />
          </div>
          
          <div className="kilo-header-right">
            {store.messages.length > 0 && (
              <button className="kilo-clear-btn" onClick={handleClearChat}>
                <Trash2 size={16} />
                <span>清空</span>
              </button>
            )}
          </div>
        </header>
        
        {/* 消息列表 */}
        <div className="kilo-messages-wrapper">
          <div className="kilo-messages-list">
            {conversation.messages.map((message, index) => (
              <KiloMessage 
                key={message.id}
                message={message as unknown as import('../types/agent').KiloMessage}
                isLast={index === conversation.messages.length - 1}
              />
            ))}
          </div>
        </div>
        
        {/* 输入区域 */}
        <div className="kilo-input-area">
          <div className="kilo-input-container">
            <textarea
              className="kilo-textarea"
              value={conversation.input}
              onChange={(e) => conversation.setInput(e.target.value)}
              placeholder={`${AGENT_MODE_CONFIGS[conversation.currentMode].description}...`}
              rows={1}
              disabled={conversation.isGenerating}
            />
            {conversation.isGenerating ? (
              <button className="kilo-stop-button" onClick={conversation.stopGeneration}>
                停止
              </button>
            ) : (
              <button 
                className="kilo-send-button"
                onClick={() => conversation.sendMessage(conversation.input)}
                disabled={!conversation.input.trim()}
              >
                发送
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
})

// 导入 AGENT_MODE_CONFIGS
import { AGENT_MODE_CONFIGS } from '../types/agent'
