import { useState, useEffect } from 'react'
import { Plus, MoreVertical, Edit2, Trash2 } from 'lucide-react'
import type { Session } from '../store'

interface SessionBarProps {
  sessions: Session[]
  currentSession: string | null
  projectPath: string | null
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
}

export function SessionBar({
  sessions,
  currentSession,
  projectPath,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession
}: SessionBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
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

  // 按时间从新到旧排序
  const sortedSessions = [...sessions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <>
      <div className="session-bar">
        {/* 新建会话按钮 */}
        <button 
          className="session-bar-new-btn"
          onClick={onCreateSession}
          title="新建会话"
        >
          <Plus size={14} />
          <span>新建</span>
        </button>

        {/* 分隔线 */}
        <div className="session-bar-divider" />

        {/* 会话列表 */}
        {!projectPath ? (
          <div className="session-bar-empty">
            <span>请先打开项目</span>
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="session-bar-empty">
            <span>暂无会话</span>
          </div>
        ) : (
          <div className="session-bar-list">
            {sortedSessions.map((session) => (
              <div
                key={session.id}
                className={`session-bar-item ${currentSession === session.id ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
                onContextMenu={(e) => handleContextMenu(e, session.id)}
              >
                {editingId === session.id ? (
                  <input
                    type="text"
                    className="session-bar-edit-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={confirmRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="session-bar-title">
                      {session.title || `会话 ${session.id.slice(0, 8)}`}
                    </span>
                    <span className="session-bar-time">
                      {formatDate(session.createdAt)}
                    </span>
                  </>
                )}
              </div>
            ))}
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
            onClick={(e) => {
              e.stopPropagation()
              const session = sessions.find(s => s.id === contextMenu.sessionId)
              if (session) startRename(session)
            }}
          >
            <Edit2 size={12} />
            <span>重命名</span>
          </div>
          <div 
            className="session-context-item delete"
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(contextMenu.sessionId)
            }}
          >
            <Trash2 size={12} />
            <span>删除</span>
          </div>
        </div>
      )}
    </>
  )
}

export default SessionBar
