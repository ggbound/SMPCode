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
  X as XIcon,
  Image as ImageIcon
} from 'lucide-react'
import { ImageContent } from '../store/kiloStore'
import { ModeSelector } from '../components/ModeSelector'
import { ModelSelector } from '../components/ModelSelector'
import { KiloMessageInline } from '../components/KiloMessageInline'
import { useKiloConversation } from '../hooks/useKiloConversation'
import { useKiloStore, KiloSession } from '../store/kiloStore'
import { useStore as useMainStore, type Session as MainSession } from '../store'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import { v4 as uuidv4 } from 'uuid'

interface Provider {
  id: string
  name: string
  enabled: boolean
  models: { id: string; name: string; supportsVision?: boolean }[]
}

interface KiloPageProps {
  apiKey: string
  model: string
  providers: Provider[]
  projectPath?: string
  onModelChange?: (modelId: string) => void
  onOpenUrl?: (url: string) => void
}

export default function KiloPage({ apiKey, model, providers, projectPath, onModelChange, onOpenUrl }: KiloPageProps) {
  const [showSidebar, setShowSidebar] = useState(false)
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState<ImageContent[]>([])
  const [previewImage, setPreviewImage] = useState<ImageContent | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // 会话重命名状态
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [, setTimeTrigger] = useState(0) // 用于触发时间更新
  
  const store = useKiloStore()
  const mainStore = useMainStore()
  const conversation = useKiloConversation({ apiKey, model, projectPath })
  
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
  
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  
  // 定期更新会话列表时间显示
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTrigger(prev => prev + 1)
    }, 60000) // 每分钟更新一次
    return () => clearInterval(timer)
  }, [])

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
        // 同时清空 mainStore 的会话数据，避免显示其他项目的会话
        mainStore.setSessions([])
        
        const result = await window.api.listSessions(projectPath)
        if (result.success && result.sessions) {
          // 过滤掉空会话（0条消息），避免显示大量无用的"新对话"
          // 同时清理磁盘上的空会话文件
          const sessionsToLoad: typeof result.sessions = []
          const emptySessionIds: string[] = []
          
          for (const s of result.sessions) {
            // 过滤掉飞书相关的会话（标题为"飞书专用对话"或 ID 以"feishu-"开头）
            if (s.title === '飞书专用对话' || s.id.startsWith('feishu-')) {
              console.log('[KiloPage] Skipping Feishu session:', s.id, s.title)
              continue
            }
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
          
          // ✅ 修复：合并内存中的会话（保留未保存到磁盘的会话）
          const memorySessions = store.sessions.filter(s => 
            // 保留内存中独有的会话（未保存到磁盘）
            !loadedSessions.some(ls => ls.id === s.id) && s.messageCount > 0
          )
          const allSessions = [...loadedSessions, ...memorySessions]
          
          // ✅ 修复：按 updatedAt 降序排序（最新的在前面）
          allSessions.sort((a, b) => b.updatedAt - a.updatedAt)
          
          // ✅ 修复：直接设置整个列表，避免 addSession 破坏排序
          store.setSessions(allSessions)
          
          console.log('[KiloPage] Loaded sessions from disk:', loadedSessions.length, 'Memory sessions:', memorySessions.length, 'Total:', allSessions.length)
          
          // ✅ 修复：同步到主 store，确保 Sidebar 能显示所有会话（包括飞书会话）
          const mainSessions: MainSession[] = sessionsToLoad.map(s => ({
            id: s.id,
            title: s.title,
            createdAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date(s.updatedAt).toISOString(),
            messageCount: s.messageCount,
            projectPath: projectPath
          }))
          mainStore.setSessions(mainSessions)
          console.log('[KiloPage] Synced sessions to main store:', mainSessions.length)
          
          // 如果有会话，设置当前会话为第一个（最新的）
          if (loadedSessions.length > 0) {
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
                  isStreaming: false,
                  usage: msg.usage,
                  images: msg.images  // ✅ 添加图片字段
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
  
  // 监听飞书会话更新事件，自动刷新会话列表
  useEffect(() => {
    const handleFeishuSessionUpdate = (event: CustomEvent<{ sessionId: string }>) => {
      const { sessionId } = event.detail
      console.log('[KiloPage] Feishu session updated, sessionId:', sessionId)
      
      // 延迟一点执行，确保文件已写入
      setTimeout(() => {
        if (projectPath && window.api?.listSessions) {
          window.api.listSessions(projectPath).then(result => {
            if (result.success && result.sessions) {
              // 过滤掉空会话
              const sessionsToLoad = result.sessions.filter((s: { messageCount: number }) => s.messageCount > 0)
              
              // 获取当前 store 中的会话（保留现有会话）
              const currentSessions = store.sessions
              const currentSessionIds = new Set(currentSessions.map(s => s.id))
              
              // 转换为 KiloSession 格式，只添加新会话或更新现有会话
              const updatedSessions: KiloSession[] = [...currentSessions]
              
              for (const s of sessionsToLoad) {
                const updatedAtTime = typeof s.updatedAt === 'string' 
                  ? new Date(s.updatedAt).getTime() 
                  : s.updatedAt
                
                const sessionData: KiloSession = {
                  id: s.id,
                  title: s.title,
                  createdAt: updatedAtTime,
                  updatedAt: updatedAtTime,
                  messageCount: s.messageCount,
                  mode: 'code' as AgentMode
                }
                
                const existingIndex = updatedSessions.findIndex(es => es.id === s.id)
                if (existingIndex >= 0) {
                  // 更新现有会话
                  updatedSessions[existingIndex] = sessionData
                } else {
                  // 添加新会话
                  updatedSessions.push(sessionData)
                }
              }
              
              // 合并内存中的会话（保留未保存到磁盘的会话）
              const memorySessions = store.sessions.filter(s => 
                !updatedSessions.some(us => us.id === s.id) && s.messageCount > 0
              )
              const allSessions = [...updatedSessions, ...memorySessions]
              
              // 按时间排序
              allSessions.sort((a, b) => b.updatedAt - a.updatedAt)
              
              // 更新 store（合并而不是替换）
              store.setSessions(allSessions)
              
              // 同步到主 store
              const mainSessions: MainSession[] = allSessions.map(s => ({
                id: s.id,
                title: s.title,
                createdAt: new Date(s.updatedAt).toISOString(),
                messageCount: s.messageCount,
                projectPath: projectPath
              }))
              mainStore.setSessions(mainSessions)
              
              console.log('[KiloPage] Sessions merged after Feishu update:', allSessions.length, 'From disk:', sessionsToLoad.length, 'From memory:', memorySessions.length)
              
              // 如果当前正在查看飞书会话，自动刷新消息列表
              const currentSessionId = store.currentSession
              if (currentSessionId === sessionId) {
                console.log('[KiloPage] Auto-refreshing Feishu session messages:', sessionId)
                // 重新加载会话消息
                if (window.api?.loadConversation) {
                  window.api.loadConversation(projectPath, sessionId).then(result => {
                    if (result.success && result.messages) {
                      store.clearMessages()
                      result.messages.forEach((msg: any) => {
                        store.addMessage({
                          id: msg.id || uuidv4(),
                          role: msg.role,
                          content: msg.content,
                          timestamp: msg.timestamp || Date.now(),
                          mode: 'ask',
                          isStreaming: false,
                          usage: msg.usage,
                          images: msg.images
                        })
                      })
                      console.log('[KiloPage] Feishu session messages refreshed:', result.messages.length)
                    }
                  }).catch(err => {
                    console.error('[KiloPage] Failed to refresh Feishu session messages:', err)
                  })
                }
              }
            }
          }).catch(err => {
            console.error('[KiloPage] Failed to reload sessions:', err)
          })
        }
      }, 500)
    }
    
    window.addEventListener('feishu:session-updated', handleFeishuSessionUpdate as EventListener)
    return () => window.removeEventListener('feishu:session-updated', handleFeishuSessionUpdate as EventListener)
  }, [projectPath, store, mainStore])
  
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
    
    // ✅ 修复：如果正在生成中，禁止创建新会话
    if (conversation.isGenerating) {
      console.log('[KiloPage] Cannot create new session while generating')
      alert('请等待当前对话完成后再创建新会话')
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
    
    // ✅ 修复：如果正在生成中，禁止切换会话
    if (conversation.isGenerating) {
      console.log('[KiloPage] Cannot switch session while generating')
      // 可以在这里添加提示，比如 toast 或 alert
      alert('请等待当前对话完成后再切换会话')
      return
    }
    
    // 先保存当前会话的消息（如果不是飞书会话）
    const currentSessionId = store.currentSession
    if (currentSessionId && store.messages.length > 0 && window.api?.saveConversation) {
      const currentSession = store.sessions.find(s => s.id === currentSessionId)
      if (currentSession && currentSession.title !== '飞书专用对话' && !currentSessionId.startsWith('feishu-session-')) {
        console.log('[KiloPage] Saving current session before switch:', currentSessionId)
        try {
          const messagesToSave = store.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            mode: m.mode,
            blocks: m.blocks,
            toolCalls: m.toolCalls,
            reasoning: m.reasoning,
            usage: m.usage,
            images: m.images  // ✅ 添加图片字段
          }))
          console.log('[KiloPage] Saving messages with usage:', messagesToSave.map(m => ({ id: m.id, usage: m.usage })))
          await window.api.saveConversation(projectPath, currentSessionId, messagesToSave, currentSession.title)
          console.log('[KiloPage] Current session saved before switch')
        } catch (err) {
          console.error('[KiloPage] Failed to save current session before switch:', err)
        }
      }
    }
    
    const session = store.sessions.find(s => s.id === sessionId)
    
    // 检查是否是飞书会话，如果是则以只读模式加载
    if (session?.title === '飞书专用对话') {
      console.log('[KiloPage] Loading Feishu session in read-only mode:', sessionId)
      
      // ✅ 关键修复：设置当前会话为飞书会话，但添加特殊标记
      // 这样保存逻辑可以正确识别并跳过保存
      store.setCurrentSession(sessionId)
      
      // 加载飞书会话消息（简单格式转换）
      if (window.api?.loadConversation) {
        try {
          const result = await window.api.loadConversation(projectPath, sessionId)
          if (result.success && result.messages) {
            store.clearMessages()
            result.messages.forEach((msg: any) => {
              // 飞书消息格式：{ role, content, timestamp }
              // 转换为 KiloMessage 格式，但不添加 Kilo 特有字段
              store.addMessage({
                id: msg.id || uuidv4(),
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp || Date.now(),
                mode: 'ask', // 飞书对话使用 ask 模式（只读）
                isStreaming: false,
                usage: msg.usage,
                images: msg.images
              })
            })
          } else {
            store.clearMessages()
          }
        } catch (error) {
          console.error('Failed to load Feishu conversation:', error)
          store.clearMessages()
        }
      }
      return
    }
    
    store.setCurrentSession(sessionId)
    
    // 加载普通会话消息
    if (window.api?.loadConversation) {
      try {
        const result = await window.api.loadConversation(projectPath, sessionId)
        if (result.success && result.messages) {
          store.clearMessages()
          result.messages.forEach((msg: any) => {
            // 清理 toolCalls 数据，过滤掉格式错误的条目
            let cleanedToolCalls = msg.toolCalls
            if (Array.isArray(msg.toolCalls)) {
              cleanedToolCalls = msg.toolCalls.filter((tc: any) => {
                // 确保 toolCall 有必要的字段且格式正确
                return tc && 
                       typeof tc === 'object' && 
                       typeof tc.name === 'string' && 
                       tc.name.length > 0 &&
                       tc.args && typeof tc.args === 'object'
              })
            }
            
            // 构建完整的消息对象（与后端 LLMMessage 兼容）
            store.addMessage({
              id: msg.id || uuidv4(),
              role: msg.role,
              content: msg.content,  // 统一格式：string | MessageContentPart[]
              timestamp: msg.timestamp || Date.now(),
              mode: msg.mode || 'code',
              blocks: msg.blocks,
              toolCalls: cleanedToolCalls,
              reasoning: msg.reasoning,
              isStreaming: false,
              usage: msg.usage,
              images: msg.images,  // 图片内容
              tool_call_id: msg.tool_call_id,  // 后端格式工具调用ID
              tool_calls: msg.tool_calls,  // 后端格式工具调用数组
              name: msg.name  // 工具名称
            })
          })
          console.log('[KiloPage] Loaded messages with content format:', result.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            contentIsArray: Array.isArray(m.content),
            hasImages: !!m.images?.length
          })))
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
            reasoning: m.reasoning,
            usage: m.usage,
            images: m.images
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
  
  // 处理图片文件选择
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        if (base64) {
          const image: ImageContent = {
            type: 'image',
            data: base64,
            mimeType: file.type,
            name: file.name
          }
          console.log('[KiloPage] Adding image to attachedImages:', { name: file.name, dataLength: base64.length })
          setAttachedImages(prev => {
            const newImages = [...prev, image]
            console.log('[KiloPage] attachedImages after update:', { length: newImages.length })
            return newImages
          })
        }
      }
      reader.readAsDataURL(file)
    })

    // 重置 input
    e.target.value = ''
  }, [])

  // 处理粘贴事件（支持截图粘贴）
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // 如果模型不支持视觉，不处理图片粘贴
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
              const image: ImageContent = {
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

  // 删除已附加的图片
  const removeAttachedImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 发送消息
  const handleSend = useCallback(() => {
    if ((!input.trim() && attachedImages.length === 0) || conversation.isGenerating) return
    console.log('[KiloPage] handleSend called:', {
      inputLength: input.trim().length,
      attachedImagesLength: attachedImages.length,
      attachedImages: attachedImages.map(img => ({ name: img.name, dataLength: img.data?.length || 0 }))
    })
    conversation.sendMessage(input.trim(), attachedImages)
    setInput('')
    setAttachedImages([])
  }, [input, attachedImages, conversation])
  
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
  
  // ✅ 修复：同步消息到 mainStore，确保 App.tsx 的自动保存能获取 usage 数据
  // 使用消息长度和最后一条消息的 ID 作为依赖，避免无限循环
  // 注意：只在当前项目路径匹配且有当前会话时才同步，避免会话错乱
  // ⚠️ 暂时禁用：可能导致数据错乱，使用 KiloPage 自己的保存逻辑
  // const lastMessageId = kiloMessages.length > 0 ? kiloMessages[kiloMessages.length - 1]?.id : null
  // useEffect(() => {
  //   // 只在有当前会话且项目路径匹配时才同步
  //   if (kiloMessages.length > 0 && store.currentSession && projectPath) {
  //     // 将 KiloMessage 转换为 Message 格式（只同步必要字段）
  //     const mainMessages = kiloMessages.map(km => ({
  //       role: km.role as 'user' | 'assistant' | 'system',
  //       content: km.content,
  //       timestamp: km.timestamp,
  //       isStreaming: km.isStreaming,
  //       usage: km.usage
  //     }))
  //     mainStore.setMessages(mainMessages as any)
  //       // 同时同步当前会话 ID，确保 App.tsx 保存到正确的会话
  //       mainStore.selectSession(store.currentSession)
  //   }
  // }, [lastMessageId, kiloMessages.length, store.currentSession, projectPath])
  
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
          <button 
            className="kilo-new-chat-btn-modern" 
            onClick={() => createSession()}
            disabled={conversation.isGenerating}
            style={{ 
              opacity: conversation.isGenerating ? 0.5 : 1,
              cursor: conversation.isGenerating ? 'not-allowed' : 'pointer'
            }}
          >
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
                    className={`kilo-session-item-modern ${session.id === store.currentSession ? 'active' : ''} ${conversation.isGenerating ? 'disabled' : ''}`}
                    onClick={() => handleSwitchSession(session.id)}
                    style={{ 
                      opacity: conversation.isGenerating ? 0.5 : 1,
                      cursor: conversation.isGenerating ? 'not-allowed' : 'pointer'
                    }}
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
                          {/* ✅ 单行布局：标题+时间 在左侧，按钮在右侧 */}
                          <div className="kilo-session-item-info">
                            <div className="kilo-session-item-title">
                              {session.title}
                            </div>
                            <div className="kilo-session-item-time">
                              {formatTime(session.updatedAt)}
                            </div>
                          </div>
                          {/* ✅ 编辑和删除按钮 */}
                          <div className="kilo-session-item-actions">
                            <button 
                              className="kilo-session-action-btn"
                              title={conversation.isGenerating ? '请等待对话完成' : '重命名'}
                              disabled={conversation.isGenerating}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (conversation.isGenerating) {
                                  alert('请等待当前对话完成后再编辑会话')
                                  return
                                }
                                startRenameSession(session, e)
                              }}
                              style={{ 
                                opacity: conversation.isGenerating ? 0.3 : 1,
                                cursor: conversation.isGenerating ? 'not-allowed' : 'pointer'
                              }}
                            >
                              <Edit3 size={12} />
                            </button>
                            <button 
                              className="kilo-session-action-btn kilo-session-action-btn--delete"
                              title={conversation.isGenerating ? '请等待对话完成' : '删除'}
                              disabled={conversation.isGenerating}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (conversation.isGenerating) {
                                  alert('请等待当前对话完成后再删除会话')
                                  return
                                }
                                if (confirm(`确定要删除对话「${session.title}」吗？`)) {
                                  handleDeleteSession(session.id, e)
                                }
                              }}
                              style={{ 
                                opacity: conversation.isGenerating ? 0.3 : 1,
                                cursor: conversation.isGenerating ? 'not-allowed' : 'pointer'
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
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
            {/* 清空按钮已移除 */}
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
                  onOpenUrl={onOpenUrl}
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
            {/* 图片预览区域 */}
            {attachedImages.length > 0 && (
              <div className="kilo-image-preview-container">
                {attachedImages.map((image, index) => (
                  <div key={index} className="kilo-image-preview-item" onClick={() => setPreviewImage(image)}>
                    <img 
                      src={image.data} 
                      alt={image.name || 'attached image'}
                      className="kilo-image-preview-thumb"
                      title="点击查看大图"
                    />
                    <button 
                      className="kilo-image-remove-btn"
                      onClick={(e) => { e.stopPropagation(); removeAttachedImage(index); }}
                      title="删除图片"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* 文本输入区域 */}
            <div className="kilo-input-wrapper">
              <textarea
                className="kilo-textarea-modern"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
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
                {/* 图片上传按钮 - 仅在支持视觉的模型显示 */}
                {supportsVision() && (
                  <>
                    <button 
                      className="kilo-image-upload-btn"
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
                    className={`kilo-send-btn ${(!input.trim() && attachedImages.length === 0) ? 'disabled' : ''}`}
                    onClick={handleSend}
                    disabled={!input.trim() && attachedImages.length === 0}
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
      
      {/* 图片预览弹窗 */}
      {previewImage && (
        <div className="kilo-image-preview-modal" onClick={() => setPreviewImage(null)}>
          <div className="kilo-image-preview-content" onClick={(e) => e.stopPropagation()}>
            <img 
              src={previewImage.data} 
              alt={previewImage.name || 'preview'}
              className="kilo-image-preview-large"
            />
            <button 
              className="kilo-image-preview-close"
              onClick={() => setPreviewImage(null)}
              title="关闭"
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
