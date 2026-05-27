/**
 * Kilo Code 风格页面
 * 完全复刻 Kilo Code 的界面和交互
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { 
  PanelLeft, 
  Plus,
  MessageSquare,
  Trash2,
  Send,
  Square,
  AlertCircle,
  X,
  Edit3,
  Check,
  X as XIcon
} from 'lucide-react'
import { ModeSelector } from '../components/ModeSelector'
import { ModelSelector } from '../components/ModelSelector'
import { KiloMessageInline } from '../components/KiloMessageInline'
import { useKiloConversation } from '../hooks/useKiloConversation'
import { useKiloStore, KiloSession } from '../store/kiloStore'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'

interface Provider {
  id: string
  name: string
  enabled: boolean
  models: { id: string; name: string }[]
}

interface KiloPageProps {
  apiKey: string
  model: string
  providers: Provider[]
  projectPath?: string
  onModelChange?: (modelId: string) => void
}

export default function KiloPage({ apiKey, model, providers, projectPath, onModelChange }: KiloPageProps) {
  const [showSidebar, setShowSidebar] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // 会话重命名状态
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  
  const store = useKiloStore()
  const conversation = useKiloConversation({ apiKey, model, projectPath })
  
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  
  // 从项目目录加载会话列表
  useEffect(() => {
    const loadSessions = async () => {
      if (!projectPath || !window.api?.listSessions) return
      
      setIsLoadingSessions(true)
      try {
        // 切换项目时，先清空 store 中的会话数据
        store.clearAllSessions()
        store.setCurrentSession(null)
        store.clearMessages()
        
        const result = await window.api.listSessions(projectPath)
        if (result.success && result.sessions) {
          // 过滤掉空会话（0条消息），避免显示大量无用的"新对话"
          // 同时清理磁盘上的空会话文件
          const sessionsToLoad: typeof result.sessions = []
          const emptySessionIds: string[] = []
          
          for (const s of result.sessions) {
            if (s.messageCount > 0) {
              sessionsToLoad.push(s)
            } else {
              // 收集空会话 ID，稍后删除
              emptySessionIds.push(s.id)
            }
          }
          
          // 清理磁盘上的空会话文件
          if (emptySessionIds.length > 0 && window.api?.deleteSession) {
            for (const sessionId of emptySessionIds) {
              try {
                await window.api.deleteSession(projectPath, sessionId)
                console.log(`Cleaned up empty session: ${sessionId}`)
              } catch (error) {
                console.error(`Failed to delete empty session ${sessionId}:`, error)
              }
            }
          }
          
          // 将加载的会话转换为 KiloSession 格式
          const loadedSessions: KiloSession[] = sessionsToLoad.map(s => {
            // 确保正确解析时间戳
            const updatedAtTime = typeof s.updatedAt === 'string' 
              ? new Date(s.updatedAt).getTime() 
              : s.updatedAt
            
            return {
              id: s.id,
              title: s.title,
              createdAt: updatedAtTime,
              updatedAt: updatedAtTime,
              messageCount: s.messageCount,
              mode: 'code' as AgentMode
            }
          })
          
          // 更新 store 中的会话列表（只添加当前项目的会话）
          loadedSessions.forEach(session => {
            store.addSession(session)
          })
          
          // 如果有会话，加载第一个（最新的）
          if (loadedSessions.length > 0) {
            // 按 updatedAt 降序排序，选择最新的会话
            loadedSessions.sort((a, b) => b.updatedAt - a.updatedAt)
            const latestSession = loadedSessions[0]
            
            store.setCurrentSession(latestSession.id)
            // 加载消息
            const msgResult = await window.api.loadConversation(projectPath, latestSession.id)
            if (msgResult.success && msgResult.messages) {
              store.clearMessages()
              msgResult.messages.forEach((msg: any) => {
                store.addMessage({
                  id: msg.id || uuidv4(),
                  role: msg.role,
                  content: msg.content,
                  timestamp: msg.timestamp || Date.now(),
                  mode: msg.mode || 'code',
                  blocks: msg.blocks,
                  toolCalls: msg.toolCalls,
                  reasoning: msg.reasoning,
                  isStreaming: false
                })
              })
            }
          }
        }
      } catch (error) {
        console.error('Failed to load sessions:', error)
      } finally {
        setIsLoadingSessions(false)
      }
    }
    
    loadSessions()
  }, [projectPath])
  
  // 初始化时创建默认会话 - 只有在加载完成后且没有会话时才创建
  useEffect(() => {
    if (!isLoadingSessions && store.sessions.length === 0 && projectPath) {
      createSession('新对话')
    }
  }, [projectPath, isLoadingSessions, store.sessions.length])
  
  // 创建新会话
  const createSession = useCallback(async (title?: string) => {
    if (!projectPath) {
      alert('请先打开一个项目')
      return
    }
    
    // 不立即创建会话，而是标记为“准备创建”
    // 只有当用户发送第一条消息时，才真正创建并保存会话
    // 这样可以避免产生无用的空会话
    
    // 清空当前消息，准备开始新对话
    store.clearMessages()
    store.setCurrentSession(null)
    
    // 返回 null 表示尚未创建会话
    return null
  }, [store, projectPath])
  
  // 删除会话
  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!projectPath) return
    
    // 从项目目录删除
    if (window.api?.deleteSession) {
      try {
        await window.api.deleteSession(projectPath, sessionId)
      } catch (error) {
        console.error('Failed to delete session:', error)
      }
    }
    
    store.deleteSession(sessionId)
  }, [store, projectPath])
  
  // 切换会话
  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (!projectPath) return
    
    store.setCurrentSession(sessionId)
    
    // 加载会话消息
    if (window.api?.loadConversation) {
      try {
        const result = await window.api.loadConversation(projectPath, sessionId)
        if (result.success && result.messages) {
          store.clearMessages()
          result.messages.forEach((msg: any) => {
            store.addMessage({
              id: msg.id || uuidv4(),
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp || Date.now(),
              mode: msg.mode || 'code',
              blocks: msg.blocks,
              toolCalls: msg.toolCalls,
              reasoning: msg.reasoning,
              isStreaming: false
            })
          })
        } else {
          store.clearMessages()
        }
      } catch (error) {
        console.error('Failed to load conversation:', error)
        store.clearMessages()
      }
    }
  }, [store, projectPath])
  
  // 开始重命名会话
  const startRenameSession = useCallback((session: KiloSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
  }, [])
  
  // 确认重命名
  const confirmRenameSession = useCallback(async () => {
    if (!editingSessionId || !editingTitle.trim()) {
      setEditingSessionId(null)
      return
    }
    
    store.updateSession(editingSessionId, { title: editingTitle.trim() })
    
    // 保存到项目目录
    if (projectPath && window.api?.saveConversation) {
      try {
        const session = store.sessions.find(s => s.id === editingSessionId)
        if (session) {
          const messages = store.messages.filter(m => m.id).map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            mode: m.mode,
            blocks: m.blocks,
            toolCalls: m.toolCalls,
            reasoning: m.reasoning
          }))
          await window.api.saveConversation(projectPath, editingSessionId, messages, editingTitle.trim())
        }
      } catch (error) {
        console.error('Failed to rename session:', error)
      }
    }
    
    setEditingSessionId(null)
    setEditingTitle('')
  }, [editingSessionId, editingTitle, store, projectPath])
  
  // 取消重命名
  const cancelRenameSession = useCallback(() => {
    setEditingSessionId(null)
    setEditingTitle('')
  }, [])
  
  // 切换模式
  const handleModeChange = useCallback((mode: AgentMode) => {
    store.setCurrentMode(mode)
    if (store.currentSession) {
      store.updateSession(store.currentSession, { mode })
    }
  }, [store])
  
  // 清空当前会话
  const handleClearChat = useCallback(() => {
    store.clearMessages()
  }, [store])
  
  // 发送消息
  const handleSend = useCallback(() => {
    if (!input.trim() || conversation.isGenerating) return
    conversation.sendMessage(input.trim())
    setInput('')
  }, [input, conversation])
  
  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])
  
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
  
  // 转换消息格式
  const kiloMessages = conversation.messages.map((msg, index) => ({
    ...msg,
    isStreaming: msg.isStreaming ?? false,
    mode: msg.mode || store.currentMode
  }))
  
  // ==================== 自动滚动逻辑 ====================
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabledRef = useRef(true)
  const previousMessagesLengthRef = useRef(0)
  const previousLastMessageIdRef = useRef<string>('')
  
  // 检测是否在底部
  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return true
    const { scrollTop, scrollHeight, clientHeight } = container
    return scrollHeight - scrollTop - clientHeight < 50 // 50px 阈值
  }, [])
  
  // 滚动到底部
  const scrollToBottom = useCallback((immediate = false) => {
    const container = scrollContainerRef.current
    if (!container) return
    
    const targetScrollTop = container.scrollHeight - container.clientHeight
    
    if (immediate) {
      container.scrollTop = targetScrollTop
    } else {
      container.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      })
    }
  }, [])
  
  // 处理滚动事件
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    // 如果用户向上滚动超过阈值，禁用自动滚动
    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    
    // 只有当用户明确向上滚动且不在底部时才禁用
    if (distanceFromBottom > 100) {
      isAutoScrollEnabledRef.current = false
    } else if (distanceFromBottom < 50) {
      // 如果用户滚动回底部，重新启用自动滚动
      isAutoScrollEnabledRef.current = true
    }
  }, [])
  
  // 监听消息变化 - 新消息到达时滚动
  useEffect(() => {
    const currentLength = kiloMessages.length
    const lastMessage = kiloMessages[currentLength - 1]
    
    // 如果有新消息
    if (currentLength > previousMessagesLengthRef.current) {
      previousMessagesLengthRef.current = currentLength
      if (lastMessage) {
        previousLastMessageIdRef.current = lastMessage.id
      }
      // 新消息到达时强制滚动到底部
      setTimeout(() => scrollToBottom(false), 50)
      isAutoScrollEnabledRef.current = true
    }
  }, [kiloMessages.length, scrollToBottom])
  
  // 监听最后一条消息的内容变化（流式输出）
  useEffect(() => {
    const lastMessage = kiloMessages[kiloMessages.length - 1]
    if (!lastMessage) return
    
    // 只在 AI 生成内容时自动滚动
    if (conversation.isGenerating && isAutoScrollEnabledRef.current) {
      // 使用 requestAnimationFrame 确保在渲染完成后滚动
      requestAnimationFrame(() => {
        scrollToBottom(true) // 流式输出时用即时滚动，更流畅
      })
    }
  })
  
  // 当开始生成时重置自动滚动状态
  useEffect(() => {
    if (conversation.isGenerating) {
      isAutoScrollEnabledRef.current = true
      scrollToBottom(true)
    }
  }, [conversation.isGenerating, scrollToBottom])
  
  return (
    <div className="kilo-page">
      {/* 悬浮抽屉式侧边栏 */}
      <aside className={`kilo-sidebar-drawer ${showSidebar ? 'open' : ''}`}>
        {/* 遮罩层 - 点击关闭 */}
        {showSidebar && (
          <div className="kilo-sidebar-overlay" onClick={() => setShowSidebar(false)} />
        )}
        
        {/* 新建会话按钮 */}
        <div className="kilo-sidebar-header">
          <button className="kilo-new-chat-btn-modern" onClick={() => createSession()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>新对话</span>
          </button>
        </div>
        
        <div className="kilo-sessions-list">
          {store.sessions.length === 0 ? (
            <div className="kilo-empty-drawer">
              <div className="kilo-empty-drawer-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3 className="kilo-empty-drawer-title">暂无对话</h3>
              <p className="kilo-empty-drawer-desc">点击上方"新对话"开始与 AI 协作</p>
            </div>
          ) : (
            <>
              <div className="kilo-section-title">历史记录</div>
              <div className="kilo-sessions-list-items">
                {store.sessions.map(session => (
                  <div
                    key={session.id}
                    className={`kilo-session-item-modern ${session.id === store.currentSession ? 'active' : ''}`}
                    onClick={() => handleSwitchSession(session.id)}
                  >
                    <div className="kilo-session-item-content">
                      {editingSessionId === session.id ? (
                        <div className="kilo-session-edit-modern">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                confirmRenameSession()
                              } else if (e.key === 'Escape') {
                                cancelRenameSession()
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                          <button onClick={(e) => { e.stopPropagation(); confirmRenameSession(); }}>
                            <Check size={14} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); cancelRenameSession(); }}>
                            <XIcon size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="kilo-session-item-title">
                            {session.title}
                          </div>
                          <div className="kilo-session-item-time">
                            {formatTime(session.updatedAt)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
      
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
          </div>
          
          <div className="kilo-header-right">
            {conversation.messages.length > 0 && (
              <button className="kilo-clear-btn" onClick={handleClearChat}>
                <Trash2 size={16} />
                <span>清空</span>
              </button>
            )}
          </div>
        </header>
        
        {/* 全局错误提示 */}
        {store.error && (
          <div className="kilo-error-banner">
            <div className="kilo-error-content">
              <AlertCircle size={18} className="kilo-error-icon" />
              <div className="kilo-error-message">
                <span className="kilo-error-title">
                  {store.errorType === 'model' && '模型不支持'}
                  {store.errorType === 'network' && '网络错误'}
                  {store.errorType === 'api' && 'API 错误'}
                  {store.errorType === 'unknown' && '发生错误'}
                </span>
                <span className="kilo-error-detail">{store.error}</span>
              </div>
            </div>
            <button 
              className="kilo-error-close"
              onClick={() => store.clearError()}
            >
              <X size={16} />
            </button>
          </div>
        )}
        
        {/* 消息列表 */}
        <div className="kilo-messages-wrapper" ref={scrollContainerRef} onScroll={handleScroll}>
          {conversation.messages.length === 0 ? (
            <div className="kilo-empty-state">
              <h3>开始对话</h3>
              <p>选择上方模式，开始与 AI 助手对话</p>
              <div className="kilo-mode-hints">
                <div className="kilo-mode-hint">
                  <span>💻 Code - 编写代码</span>
                </div>
                <div className="kilo-mode-hint">
                  <span>📐 Architect - 架构设计</span>
                </div>
                <div className="kilo-mode-hint">
                  <span>🐛 Debug - 调试代码</span>
                </div>
                <div className="kilo-mode-hint">
                  <span>💬 Ask - 问答咨询</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="kilo-messages-list">
              {kiloMessages.map((message, index) => (
                <KiloMessageInline 
                  key={message.id}
                  message={message}
                  isLast={index === kiloMessages.length - 1}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        
        {/* 输入区域 */}
        <div className="kilo-input-area">
          {/* 输入框容器 */}
          <div className="kilo-input-box">
            {/* 文本输入区域 */}
            <div className="kilo-input-wrapper">
              <textarea
                className="kilo-textarea-modern"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`${AGENT_MODE_CONFIGS[store.currentMode].description}...`}
                rows={3}
                disabled={conversation.isGenerating}
              />
            </div>
            
            {/* 底部工具栏 */}
            <div className="kilo-input-toolbar">
              <div className="kilo-toolbar-left">
                <ModeSelector 
                  currentMode={store.currentMode}
                  onModeChange={handleModeChange}
                />
                <ModelSelector
                  providers={providers}
                  currentModel={model}
                  onModelChange={onModelChange || (() => {})}
                />
              </div>
              
              <div className="kilo-toolbar-right">
                {conversation.isGenerating ? (
                  <button 
                    className="kilo-send-btn kilo-stop-btn"
                    onClick={conversation.stopGeneration}
                    title="停止生成"
                  >
                    <Square size={18} fill="currentColor" />
                  </button>
                ) : (
                  <button 
                    className={`kilo-send-btn ${!input.trim() ? 'disabled' : ''}`}
                    onClick={handleSend}
                    disabled={!input.trim()}
                    title="发送"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
