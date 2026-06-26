/**
 * FeishuPanel - 飞书对话面板（使用文件存储）
 * 
 * 存储位置：~/.smp-code/feishu/conversations/
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { 
  Send, 
  Bot, 
  MessageSquare, 
  Plus, 
  Trash2, 
  Edit3, 
  Check,
  X,
  MoreHorizontal,
  AlertCircle,
  Square,
  Link as LinkIcon,
  Unlink,
  Image as ImageIcon
} from 'lucide-react'
import { KiloMessageInline } from './KiloMessageInline'
import { ModeSelector } from './ModeSelector'
import { ModelSelector } from './ModelSelector'
import { useFeishuStore, FeishuSession, FeishuMessage, FeishuImageContent } from '../store/feishuStore'
import { useFeishuConversation } from '../hooks/useFeishuConversation'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'
import '../styles/feishuPanel.css'

interface Provider {
  id: string
  name: string
  enabled: boolean
  models: { id: string; name: string; supportsVision?: boolean }[]
}

interface FeishuPanelProps {
  apiKey: string
  model: string
  providers: Provider[]
  projectPath?: string
  onModelChange?: (modelId: string) => void
}

// 格式化时间函数
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

// 实时时间显示组件 - 直接从会话消息获取最新时间
const TimeDisplay = memo(({ sessionId, keyRefresh, projectPath }: { sessionId: string, keyRefresh?: number, projectPath?: string }) => {
  const [displayTime, setDisplayTime] = useState('刚刚')
  
  // 获取会话最后一条消息的时间
  const fetchLastMessageTime = useCallback(async () => {
    if (!projectPath || !window.api?.feishu?.loadConversation) return
    
    try {
      const result = await window.api.feishu.loadConversation(projectPath, sessionId)
      if (result.success && result.messages && result.messages.length > 0) {
        const lastMsg = result.messages[result.messages.length - 1]
        if (lastMsg.timestamp) {
          setDisplayTime(formatTime(lastMsg.timestamp))
          return
        }
      }
    } catch (err) {
      console.error('[TimeDisplay] Failed to load last message time:', err)
    }
  }, [sessionId, projectPath])
  
  // 当 keyRefresh 变化或组件挂载时，获取时间
  useEffect(() => {
    fetchLastMessageTime()
  }, [fetchLastMessageTime, keyRefresh])
  
  // 每分钟刷新一次
  useEffect(() => {
    const timer = setInterval(() => {
      fetchLastMessageTime()
    }, 60000) // 每分钟更新一次
    
    return () => clearInterval(timer)
  }, [fetchLastMessageTime])
  
  return <span>{displayTime}</span>
})

export default function FeishuPanel({ apiKey, model, providers, projectPath, onModelChange }: FeishuPanelProps) {
  // 飞书连接状态
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  
  // UI 状态
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [showMenuFor, setShowMenuFor] = useState<string | null>(null)
  const [attachedImages, setAttachedImages] = useState<FeishuImageContent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0) // 用于侧边栏时间刷新
  const [showScrollButton, setShowScrollButton] = useState(false) // 用于控制滚动按钮显示
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Store
  const store = useFeishuStore()
  
  // 使用 FeishuConversation hook 进行 AI 对话
  const conversation = useFeishuConversation({ apiKey, model, projectPath })
  
  // 当前会话
  const currentSession = store.sessions.find(s => s.id === store.currentSession)

  // 判断当前模型是否支持视觉
  const supportsVision = useCallback(() => {
    for (const provider of providers) {
      if (!provider.enabled) continue
      const foundModel = provider.models.find(m => m.id === model)
      if (foundModel) {
        return foundModel.supportsVision === true
      }
    }
    return false
  }, [providers, model])

  // ========== 文件存储 ==========
  
  // 保存会话列表到文件
  const saveSessionsToFile = useCallback(async (sessions: FeishuSession[]) => {
    if (!projectPath) return
    try {
      await window.api?.feishu?.saveSessions?.(projectPath, sessions)
    } catch (e) {
      console.error('Failed to save feishu sessions:', e)
    }
  }, [projectPath])
  
  // 保存消息到文件
  const saveMessagesToFile = useCallback(async (sessionId: string, messages: FeishuMessage[], title?: string) => {
    if (!projectPath) return
    try {
      await window.api?.feishu?.saveConversation?.(projectPath, sessionId, messages, title)
    } catch (e) {
      console.error('Failed to save feishu messages:', e)
    }
  }, [projectPath])
  
  // 从文件加载会话列表
  const loadSessionsFromFile = useCallback(async () => {
    if (!projectPath) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      console.log('[FeishuPanel] Loading sessions from:', projectPath)
      const result = await window.api?.feishu?.listSessions?.(projectPath)
      console.log('[FeishuPanel] Sessions loaded:', result)
      if (result?.success && result.sessions) {
        // 加载每个会话的最后一条消息时间
        const sessions: FeishuSession[] = []
        
        for (const s of result.sessions) {
          let lastMessageTime: number | null = null
          
          if (window.api?.feishu?.loadConversation) {
            try {
              const msgResult = await window.api.feishu.loadConversation(projectPath, s.id)
              if (msgResult.success && msgResult.messages && msgResult.messages.length > 0) {
                const lastMsg = msgResult.messages[msgResult.messages.length - 1]
                lastMessageTime = lastMsg.timestamp
              }
            } catch (e) {
              console.error(`[FeishuPanel] Failed to load messages for session ${s.id}:`, e)
            }
          }
          
          // 如果有最后一条消息的时间，就用它，否则用文件更新时间
          const updatedAt = lastMessageTime !== null 
            ? lastMessageTime 
            : new Date(s.updatedAt).getTime()
          
          sessions.push({
            id: s.id,
            title: s.title,
            createdAt: new Date(s.createdAt).getTime(),
            updatedAt: updatedAt,
            messageCount: s.messageCount,
            mode: 'ask'
          })
        }
        
        // 使用函数式更新避免依赖 store
        const currentStore = useFeishuStore.getState()
        currentStore.setSessions(sessions)
        
        // 如果有会话，加载第一个
        if (sessions.length > 0 && !currentStore.currentSession) {
          currentStore.setCurrentSession(sessions[0].id)
          await loadMessagesFromFile(sessions[0].id)
        }
      }
    } catch (e) {
      console.error('[FeishuPanel] Failed to load feishu sessions:', e)
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])
  
  // 从文件加载消息
  const loadMessagesFromFile = useCallback(async (sessionId: string) => {
    if (!projectPath) return
    try {
      console.log('[FeishuPanel] Loading messages for session:', sessionId)
      const result = await window.api?.feishu?.loadConversation?.(projectPath, sessionId)
      console.log('[FeishuPanel] Messages loaded:', result)
      if (result?.success && result.messages) {
        const messages: FeishuMessage[] = result.messages.map((m: any) => ({
          id: m.id || uuidv4(),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now(),
          mode: m.mode || 'ask',
          isStreaming: false,
          blocks: m.blocks,
          toolCalls: m.toolCalls,
          reasoning: m.reasoning,
          usage: m.usage,
          images: m.images
        }))
        
        // 使用函数式更新避免依赖 store
        const currentStore = useFeishuStore.getState()
        currentStore.setMessages(messages)
        
        // 同步到 conversation
        syncMessagesToConversation(messages)
      } else {
        const currentStore = useFeishuStore.getState()
        currentStore.clearMessages()
        conversation.clearMessages()
      }
    } catch (e) {
      console.error('[FeishuPanel] Failed to load feishu messages:', e)
      const currentStore = useFeishuStore.getState()
      currentStore.clearMessages()
      conversation.clearMessages()
    }
  }, [projectPath])
  
  // 删除会话文件
  const deleteSessionFile = useCallback(async (sessionId: string) => {
    if (!projectPath) return
    try {
      await window.api?.feishu?.deleteSession?.(projectPath, sessionId)
    } catch (e) {
      console.error('Failed to delete feishu session:', e)
    }
  }, [projectPath])
  
  // 同步消息到 conversation
  const syncMessagesToConversation = useCallback((messages: FeishuMessage[]) => {
    conversation.clearMessages()
    messages.forEach(msg => {
      conversation.addMessage({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        mode: msg.mode || 'ask',
        isStreaming: false,
        blocks: msg.blocks,
        toolCalls: msg.toolCalls,
        reasoning: msg.reasoning,
        usage: msg.usage,
        images: msg.images
      })
    })
  }, [conversation])
  
  // 初始加载
  useEffect(() => {
    if (projectPath) {
      loadSessionsFromFile()
    }
  }, [projectPath, loadSessionsFromFile])
  
  // 会话变化时自动保存
  useEffect(() => {
    if (projectPath && store.sessions.length > 0) {
      saveSessionsToFile(store.sessions)
    }
  }, [store.sessions, projectPath, saveSessionsToFile])

  // ========== 飞书连接相关 ==========

  const checkConnection = useCallback(async () => {
    try {
      const status = await window.api?.feishu?.getWebSocketStatus?.()
      setIsConnected(status?.success || false)
      if (status?.success) {
        setConnectionError(null)
      }
    } catch (error) {
      setIsConnected(false)
    }
  }, [])

  // 自动监控飞书连接状态
  useEffect(() => {
    // 初始检查连接状态
    checkConnection()

    // 每 5 秒检查一次连接状态
    const interval = setInterval(() => {
      checkConnection()
    }, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [checkConnection])

  const handleConnect = useCallback(async () => {
    setIsConnecting(true)
    setConnectionError(null)
    
    try {
      const configStr = localStorage.getItem('feishu-config')
      if (!configStr) {
        setConnectionError('请先配置飞书应用信息')
        setIsConnecting(false)
        return
      }
      
      const config = JSON.parse(configStr)
      if (!config.appId || !config.appSecret) {
        setConnectionError('飞书配置不完整')
        setIsConnecting(false)
        return
      }

      const result = await window.api?.feishu?.startWebSocket?.(config)
      if (result?.success) {
        setIsConnected(true)
      } else {
        setConnectionError(result?.error || '连接失败')
      }
    } catch (error) {
      setConnectionError('连接出错: ' + String(error))
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    try {
      await window.api?.feishu?.stopWebSocket?.()
      setIsConnected(false)
    } catch (error) {
      console.error('Failed to disconnect:', error)
    }
  }, [])

  // ========== 会话相关 ==========

  const handleNewChat = useCallback(() => {
    if (conversation.isGenerating) {
      alert('请等待当前对话完成')
      return
    }
    
    const sessionId = uuidv4()
    const session: FeishuSession = {
      id: sessionId,
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      mode: store.currentMode
    }
    
    store.addSession(session)
    store.setCurrentSession(sessionId)
    store.clearMessages()
    conversation.clearMessages()
    setAttachedImages([])
  }, [conversation.isGenerating, store, conversation])

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('确定要删除这个会话吗？')) {
      store.deleteSession(sessionId)
      await deleteSessionFile(sessionId)
      setShowMenuFor(null)
    }
  }, [store, deleteSessionFile])

  const startRename = useCallback((session: FeishuSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
    setShowMenuFor(null)
  }, [])

  const confirmRename = useCallback(async () => {
    if (editingTitle.trim() && editingSessionId) {
      store.updateSession(editingSessionId, { title: editingTitle.trim() })
      // 更新文件中的标题
      const session = store.sessions.find(s => s.id === editingSessionId)
      if (session && projectPath) {
        const messages = store.messages
        await saveMessagesToFile(editingSessionId, messages, editingTitle.trim())
      }
    }
    setEditingSessionId(null)
    setEditingTitle('')
  }, [editingTitle, editingSessionId, store, projectPath, saveMessagesToFile])

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (conversation.isGenerating) {
      alert('请等待当前对话完成')
      return
    }
    
    // 保存当前会话的消息
    if (store.currentSession && store.messages.length > 0) {
      const currentSession = store.sessions.find(s => s.id === store.currentSession)
      await saveMessagesToFile(store.currentSession, store.messages, currentSession?.title)
    }
    
    store.setCurrentSession(sessionId)
    await loadMessagesFromFile(sessionId)
    setAttachedImages([])
  }, [conversation.isGenerating, store, saveMessagesToFile, loadMessagesFromFile])

  // ========== 消息相关 ==========

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation.messages])

  // 监听生成结束，自动保存消息到文件
  const wasGeneratingRef = useRef(false)
  // 跟踪当前 AI 响应需要回复给飞书的上下文
  const pendingFeishuReplyRef = useRef<{
    chatId: string
    chatType: 'group' | 'p2p'
    messageId: string
  } | null>(null)
  
  useEffect(() => {
    // 当 isGenerating 从 true 变为 false 时（即生成结束）保存
    if (wasGeneratingRef.current && !conversation.isGenerating) {
      if (store.currentSession && store.messages.length > 0) {
        const currentSession = store.sessions.find(s => s.id === store.currentSession)
        console.log('[FeishuPanel] Auto-saving messages after generation:', store.currentSession)
        saveMessagesToFile(store.currentSession, store.messages, currentSession?.title)
        
        // 如果存在待回复的飞书消息，将最后一条 AI 消息发回飞书
        if (pendingFeishuReplyRef.current) {
          const { chatId, chatType, messageId } = pendingFeishuReplyRef.current
          // 获取最后一条 assistant 消息的内容
          const lastAssistantMsg = [...store.messages].reverse().find(m => m.role === 'assistant')
          if (lastAssistantMsg) {
            const replyContent = typeof lastAssistantMsg.content === 'string' 
              ? lastAssistantMsg.content 
              : ''
            if (replyContent.trim()) {
              console.log('[FeishuPanel] Replying to Feishu:', { chatId, chatType, messageId, contentLength: replyContent.length })
              window.api?.feishu?.replyMessage?.(replyContent, messageId, chatId, chatType)
                .then((result: any) => {
                  console.log('[FeishuPanel] Feishu reply result:', result)
                })
                .catch((err: any) => {
                  console.error('[FeishuPanel] Failed to reply to Feishu:', err)
                })
            }
          }
          pendingFeishuReplyRef.current = null
        }
      }
    }
    wasGeneratingRef.current = conversation.isGenerating
  }, [conversation.isGenerating, store.currentSession, store.messages, store.sessions, saveMessagesToFile])
  
  // 监听飞书消息事件
  useEffect(() => {
    const handleFeishuMessage = (_event: any, feishuEvent: any) => {
      console.log('[FeishuPanel] Received Feishu message:', feishuEvent)
      
      // 解析飞书消息
      const message = feishuEvent?.message
      if (!message) return
      
      const chatId = message.chat_id
      const chatType = message.chat_type as 'group' | 'p2p'
      const messageId = message.message_id
      const messageContent = message.content
      
      if (!chatId || !messageContent) return
      
      // 解析消息内容（飞书消息内容是 JSON 字符串）
      let textContent = ''
      try {
        const parsed = typeof messageContent === 'string' ? JSON.parse(messageContent) : messageContent
        textContent = parsed.text || parsed.content || ''
      } catch {
        textContent = String(messageContent)
      }
      
      if (!textContent.trim()) {
        console.log('[FeishuPanel] Empty Feishu message, skipping')
        return
      }
      
      console.log('[FeishuPanel] Processing Feishu message:', textContent)
      
      // 如果当前正在生成，跳过
      if (conversation.isGenerating) {
        console.warn('[FeishuPanel] Currently generating, skipping Feishu message')
        return
      }
      
      // 设置回复上下文
      pendingFeishuReplyRef.current = {
        chatId,
        chatType,
        messageId
      }
      
      // 将飞书消息作为用户输入发给 AI（使用当前打开的会话）
      conversation.sendMessage(textContent, [])
    }
    
    // 订阅飞书消息事件
    const unsubscribe = window.api?.feishu?.onMessage?.(handleFeishuMessage)
    
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [conversation])

  // 发送消息
  const handleSend = useCallback(async () => {
    if ((!conversation.input.trim() && attachedImages.length === 0) || conversation.isGenerating) return

    // 发送消息到 AI
    conversation.sendMessage(conversation.input.trim(), attachedImages)
    setAttachedImages([])
    
    // 保存消息到文件
    if (store.currentSession) {
      const currentSession = store.sessions.find(s => s.id === store.currentSession)
      await saveMessagesToFile(store.currentSession, store.messages, currentSession?.title)
    }
  }, [conversation, attachedImages, store, saveMessagesToFile])

  // 停止生成
  const handleStopGeneration = useCallback(() => {
    conversation.stopGeneration()
  }, [conversation])

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // 处理图片选择
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        if (base64) {
          const image: FeishuImageContent = {
            type: 'image',
            data: base64,
            mimeType: file.type,
            name: file.name
          }
          setAttachedImages(prev => [...prev, image])
        }
      }
      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }, [])

  // 删除已附加的图片
  const removeAttachedImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 处理粘贴事件
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!supportsVision()) return
    
    const items = e.clipboardData?.items
    if (!items) return

    Array.from(items).forEach(item => {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const base64 = event.target?.result as string
            if (base64) {
              const image: FeishuImageContent = {
                type: 'image',
                data: base64,
                mimeType: file.type,
                name: `pasted-image-${Date.now()}.png`
              }
              setAttachedImages(prev => [...prev, image])
            }
          }
          reader.readAsDataURL(file)
        }
      }
    })
  }, [supportsVision])

  // 切换模式
  const handleModeChange = useCallback((mode: AgentMode) => {
    store.setCurrentMode(mode)
    if (store.currentSession) {
      store.updateSession(store.currentSession, { mode })
    }
  }, [store])

  // 清空当前会话
  const handleClearChat = useCallback(async () => {
    store.clearMessages()
    conversation.clearMessages()
    if (store.currentSession && projectPath) {
      await deleteSessionFile(store.currentSession)
    }
  }, [store, conversation, deleteSessionFile])

  // 初始检查连接
  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  // 侧边栏时间刷新（当组件可能显示时）
  useEffect(() => {
    setSidebarRefreshKey(prev => prev + 1)
  }, [])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // 如果点击的不是下拉菜单内部，则关闭菜单
      if (!target.closest('.feishu-session-dropdown') && !target.closest('.feishu-session-menu-btn')) {
        setShowMenuFor(null)
      }
    }

    if (showMenuFor) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showMenuFor])

  // 转换消息格式给 KiloMessageInline
  const displayMessages = conversation.messages.map((msg, index) => ({
    ...msg,
    isStreaming: msg.isStreaming ?? false,
    mode: msg.mode || store.currentMode
  }))

  // ========== 滚动处理 ==========
  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return true
    const { scrollTop, scrollHeight, clientHeight } = container
    return scrollHeight - scrollTop - clientHeight < 50
  }, [])

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

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    
    if (distanceFromBottom > 100) {
      setShowScrollButton(true)
    } else if (distanceFromBottom < 50) {
      setShowScrollButton(false)
    }
  }, [])

  return (
    <div className="feishu-panel">
      {/* 主体区域 */}
      <div className="feishu-body">
        {/* 区域2：左侧边栏 */}
        <div className="feishu-sidebar">
          {/* 面板头部：飞书对话 + 连接状态 */}
          <div className="feishu-panel-header">
            <span className="feishu-panel-title">飞书对话</span>
            <div className="feishu-panel-actions">
              <div className={`feishu-status-dot ${isConnected ? 'connected' : 'disconnected'}`} title={isConnected ? '已连接' : '未连接'} />
              {isConnected ? (
                <button 
                  className="feishu-panel-btn" 
                  onClick={handleDisconnect} 
                  disabled={conversation.isGenerating}
                  title="断开连接"
                >
                  <Unlink size={14} />
                </button>
              ) : (
                <button 
                  className="feishu-panel-btn" 
                  onClick={handleConnect}
                  disabled={isConnecting || conversation.isGenerating}
                  title={isConnecting ? '连接中...' : '连接飞书'}
                >
                  <LinkIcon size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 新对话按钮 */}
          <div className="feishu-sidebar-header">
            <button 
              className="feishu-new-chat-btn" 
              onClick={handleNewChat}
              disabled={conversation.isGenerating || isLoading}
            >
              <Plus size={16} />
              <span>新对话</span>
            </button>
          </div>

          {/* 历史对话 */}
          <div className="feishu-sidebar-content">
            <div className="feishu-sidebar-section-title">历史对话</div>
            {isLoading ? (
              <div className="feishu-loading">加载中...</div>
            ) : (
              <div className="feishu-sessions-list">
                {store.sessions.length === 0 ? (
                  <div className="feishu-empty-sessions">
                    <MessageSquare size={32} />
                    <p>暂无对话</p>
                  </div>
                ) : (
                  store.sessions.map(session => (
                    <div
                      key={session.id}
                      className={`feishu-session-item ${session.id === store.currentSession ? 'active' : ''} ${conversation.isGenerating ? 'disabled' : ''}`}
                      onClick={() => {
                        if (conversation.isGenerating) return
                        handleSwitchSession(session.id)
                      }}
                    >
                      {editingSessionId === session.id ? (
                        <div className="feishu-session-edit">
                          <input
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmRename()
                              if (e.key === 'Escape') {
                                setEditingSessionId(null)
                                setEditingTitle('')
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                          <button onClick={(e) => { e.stopPropagation(); confirmRename(); }}>
                            <Check size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="feishu-session-info">
                            <span className="feishu-session-title">{session.title}</span>
                            <span className="feishu-session-time"><TimeDisplay sessionId={session.id} keyRefresh={sidebarRefreshKey} projectPath={projectPath} /></span>
                          </div>
                          <button 
                            className="feishu-session-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowMenuFor(showMenuFor === session.id ? null : session.id)
                            }}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          
                          {showMenuFor === session.id && (
                            <div className="feishu-session-dropdown">
                              <button onClick={(e) => startRename(session, e)}>
                                <Edit3 size={12} />
                                <span>重命名</span>
                              </button>
                              <button onClick={(e) => handleDeleteSession(session.id, e)}>
                                <Trash2 size={12} />
                                <span>删除</span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* 区域3：主对话区域 */}
        <div className="feishu-main">
          {store.currentSession ? (
            <>
              {/* 顶部工具栏 */}
              <div className="feishu-chat-header">
                <div className="feishu-chat-header-left">
                  <span className="feishu-chat-title">{currentSession?.title || '新对话'}</span>
                </div>
              </div>

              {/* 全局错误提示 */}
              {conversation.error && (
                <div className="feishu-error-banner">
                  <div className="feishu-error-content">
                    <AlertCircle size={18} className="feishu-error-icon" />
                    <div className="feishu-error-message">
                      <span className="feishu-error-title">错误</span>
                      <span className="feishu-error-detail">{conversation.error}</span>
                    </div>
                  </div>
                  <button 
                    className="feishu-error-close"
                    onClick={() => conversation.clearError?.()}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* 消息列表 */}
              <div className="feishu-messages-container" ref={scrollContainerRef} onScroll={handleScroll}>
                {conversation.messages.length === 0 ? (
                  <div className="feishu-empty-chat">
                    <Bot size={64} />
                    <h3>开始对话</h3>
                    <p>选择下方模式，开始与 AI 助手对话</p>
                    <div className="feishu-mode-hints">
                      <div className="feishu-mode-hint">
                        <span>💻 Code - 编写代码</span>
                      </div>
                      <div className="feishu-mode-hint">
                        <span>📐 Architect - 架构设计</span>
                      </div>
                      <div className="feishu-mode-hint">
                        <span>🐛 Debug - 调试代码</span>
                      </div>
                      <div className="feishu-mode-hint">
                        <span>💬 Ask - 问答咨询</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="feishu-messages-list">
                    {displayMessages.map((message, index) => (
                      <KiloMessageInline 
                        key={message.id}
                        message={message as any}
                        isLast={index === displayMessages.length - 1}
                      />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              
              {/* 滚动到底部按钮 */}
              <div className="feishu-scroll-button-wrapper">
                <button 
                  className={`feishu-scroll-button ${showScrollButton ? 'show' : ''}`}
                  onClick={() => scrollToBottom(false)}
                  title="滚动到底部"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              </div>

              {/* 输入区域 */}
              <div className="feishu-input-section">
                {/* 图片预览 */}
                {attachedImages.length > 0 && (
                  <div className="feishu-image-preview-container">
                    {attachedImages.map((image, index) => (
                      <div key={index} className="feishu-image-preview-item">
                        <img 
                          src={image.data} 
                          alt={image.name || 'attached image'}
                          className="feishu-image-preview-thumb"
                        />
                        <button 
                          className="feishu-image-remove-btn"
                          onClick={() => removeAttachedImage(index)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 输入框 */}
                <div className="feishu-input-box">
                  <textarea
                    value={conversation.input}
                    onChange={(e) => conversation.setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={`${AGENT_MODE_CONFIGS[store.currentMode].description}...`}
                    disabled={conversation.isGenerating}
                    rows={3}
                  />
                </div>
                
                {/* 底部工具栏 */}
                <div className="feishu-input-toolbar">
                  <div className="feishu-toolbar-left">
                    <ModeSelector 
                      currentMode={store.currentMode}
                      onModeChange={handleModeChange}
                    />
                    <ModelSelector
                      providers={providers}
                      currentModel={model}
                      onModelChange={onModelChange || (() => {})}
                    />
                    {/* 图片上传按钮 */}
                    {supportsVision() && (
                      <>
                        <button 
                          className="feishu-image-upload-btn"
                          onClick={() => fileInputRef.current?.click()}
                          title="上传图片"
                          disabled={conversation.isGenerating}
                        >
                          <ImageIcon size={18} />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageSelect}
                          style={{ display: 'none' }}
                        />
                      </>
                    )}
                  </div>
                  
                  <div className="feishu-toolbar-right">
                    {conversation.isGenerating ? (
                      <button 
                        className="feishu-send-btn stop"
                        onClick={handleStopGeneration}
                      >
                        <Square size={16} fill="currentColor" />
                        <span>停止</span>
                      </button>
                    ) : (
                      <button 
                        className={`feishu-send-btn ${(!conversation.input.trim() && attachedImages.length === 0) ? 'disabled' : ''}`}
                        onClick={handleSend}
                        disabled={!conversation.input.trim() && attachedImages.length === 0}
                      >
                        <Send size={16} />
                        <span>发送</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="feishu-no-session">
              <Bot size={64} />
              <h3>点击"新对话"开始聊天</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
