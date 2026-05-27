import { useState, useEffect, useCallback } from 'react'
import type { Session } from '../store'

interface SessionSidebarProps {
  sessions: Session[]
  currentSession: string | null
  projectPath: string | null
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  isOpen: boolean
  onToggle: () => void
}

export function SessionSidebar({
  sessions,
  currentSession,
  projectPath,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  isOpen,
  onToggle
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)

  // 加载项目会话列表
  const loadProjectSessions = useCallback(async () => {
    if (!projectPath || !window.api?.listSessions) return
    
    try {
      const result = await window.api.listSessions(projectPath)
      if (result.success && result.sessions) {
        // 会话列表通过props传入，这里可以触发父组件更新
        console.log('Loaded sessions:', result.sessions)
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }, [projectPath])

  useEffect(() => {
    loadProjectSessions()
  }, [loadProjectSessions])

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // 开始重命名
  const startRename = (session: Session) => {
    setEditingId(session.id)
    setEditTitle(session.title || `会话 ${session.id.slice(0, 8)}`)
    setContextMenu(null)
  }

  // 确认重命名
  const confirmRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim())
      setEditingId(null)
      setEditTitle('')
    }
  }

  // 取消重命名
  const cancelRename = () => {
    setEditingId(null)
    setEditTitle('')
  }

  // 处理删除
  const handleDelete = (sessionId: string) => {
    if (confirm('确定要删除这个会话吗？')) {
      onDeleteSession(sessionId)
    }
    setContextMenu(null)
  }

  // 格式化日期
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      
      // 小于1小时
      if (diff < 60 * 60 * 1000) {
        const minutes = Math.floor(diff / (60 * 1000))
        return minutes < 1 ? '刚刚' : `${minutes}分钟前`
      }
      // 小于24小时
      if (diff < 24 * 60 * 60 * 1000) {
        const hours = Math.floor(diff / (60 * 60 * 1000))
        return `${hours}小时前`
      }
      // 小于7天
      if (diff < 7 * 24 * 60 * 60 * 1000) {
        const days = Math.floor(diff / (24 * 60 * 60 * 1000))
        return `${days}天前`
      }
      
      return date.toLocaleDateString()
    } catch {
      return dateStr
    }
  }

  return (
    <>
      {/* 切换按钮 */}
      <button 
        className="session-sidebar-toggle"
        onClick={onToggle}
        title={isOpen ? '收起会话列表' : '展开会话列表'}
      >
        {isOpen ? '◀' : '▶'}
      </button>

      {/* 侧边栏 */}
      <div className={`session-sidebar ${isOpen ? 'open' : 'closed'}`}>
        {/* 新建会话按钮 */}
        <div className="session-sidebar-header">
          <button 
            className="session-new-btn-modern"
            onClick={onCreateSession}
            title="新建会话"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>新对话</span>
          </button>
        </div>

        <div className="session-sidebar-content">
          {!projectPath ? (
            <div className="session-empty-modern">
              <div className="session-empty-icon-wrapper">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 3h18v18H3z"/>
                  <path d="M9 9h6v6H9z"/>
                  <path d="M3 9h2v6H3z"/>
                  <path d="M19 9h2v6h-2z"/>
                </svg>
              </div>
              <h3 className="session-empty-title">与 Agent 协作</h3>
              <p className="session-empty-desc">端到端执行常规开发任务，支持使用配置的MCP</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="session-empty-modern">
              <div className="session-empty-icon-wrapper">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3 className="session-empty-title">暂无对话</h3>
              <p className="session-empty-desc">点击上方"新对话"开始与 AI 协作</p>
            </div>
          ) : (
            <>
              <div className="session-section-title">历史记录</div>
              <div className="session-list-modern">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item-modern ${currentSession === session.id ? 'active' : ''}`}
                    onClick={() => onSelectSession(session.id)}
                    onContextMenu={(e) => handleContextMenu(e, session.id)}
                  >
                    <div className="session-item-content">
                      {editingId === session.id ? (
                        <input
                          type="text"
                          className="session-edit-input-modern"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={confirmRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmRename()
                            if (e.key === 'Escape') cancelRename()
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <div className="session-item-title">
                            {session.title || `会话 ${session.id.slice(0, 8)}`}
                          </div>
                          <div className="session-item-time">
                            {formatDate(session.createdAt)}
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

        {projectPath && (
          <div className="session-sidebar-footer">
            <span className="project-path" title={projectPath}>
              📁 {projectPath.split('/').pop()}
            </span>
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div 
          className="session-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div 
            className="session-context-item"
            onClick={() => {
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) startRename(session)
            }}
          >
            重命名
          </div>
          <div 
            className="session-context-item delete"
            onClick={() => handleDelete(contextMenu.sessionId)}
          >
            删除
          </div>
        </div>
      )}
    </>
  )
}

export default SessionSidebar
