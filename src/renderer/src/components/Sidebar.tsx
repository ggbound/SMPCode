import { useStore } from '../store'
import { t } from '../i18n'
import { Folder } from 'lucide-react'

interface SidebarProps {
  onSessionSelect?: (projectPath: string | undefined) => void
  onOpenMCPSkillPanel?: () => void
}

function Sidebar({ onSessionSelect, onOpenMCPSkillPanel }: SidebarProps = {}) {
  const { sessions, currentSession, selectSession, addSession, setMessages } = useStore()

  const handleNewSession = async () => {
    try {
      const res = await fetch('http://localhost:3847/api/sessions', { method: 'POST' })
      const session = await res.json()
      addSession(session)
      selectSession(session.id)
      setMessages([])
      // Notify parent that no project is associated
      onSessionSelect?.(undefined)
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    try {
      // 加载会话详情（包含消息）
      const res = await fetch(`http://localhost:3847/api/sessions/${sessionId}`)
      if (res.ok) {
        const session = await res.json()
        selectSession(sessionId)
        // 加载该会话的消息
        setMessages(session.messages.map((msg: { role: 'user' | 'assistant'; content: string }) => ({
          role: msg.role,
          content: msg.content,
          timestamp: Date.now()
        })))
        // Notify parent about the project path
        onSessionSelect?.(session.projectPath)
      }
    } catch (error) {
      console.error('Failed to load session:', error)
    }
  }

  // Get folder name from path
  const getFolderName = (path: string | undefined) => {
    if (!path) return null
    const parts = path.split('/')
    return parts[parts.length - 1] || parts[parts.length - 2] || path
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t('sessions')}</span>
        <button className="btn btn-primary" onClick={handleNewSession}>
          {t('newSessionBtn')}
        </button>
      </div>
      <div className="session-list">
        {sessions.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {t('noSessions')}
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${currentSession === session.id ? 'active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
              title={session.projectPath || 'No project associated'}
            >
              <div style={{ fontWeight: 500, fontSize: '13px' }}>
                {t('sessionTitle')} {session.id.slice(0, 8)}
                {session.projectPath && (
                  <Folder size={12} style={{ 
                    marginLeft: '6px',
                    color: 'var(--accent-color)'
                  }} />
                )}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>
                {session.projectPath ? (
                  <span style={{ color: 'var(--accent-color)' }}>
                    {getFolderName(session.projectPath)}
                  </span>
                ) : (
                  new Date(session.createdAt).toLocaleDateString()
                )}
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* MCP & Skill 入口 */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">扩展</div>
        <button 
          className="sidebar-menu-item"
          onClick={onOpenMCPSkillPanel}
          title="配置 MCP Server 和 Skill"
        >
          <span className="sidebar-menu-icon">🔌</span>
          <span className="sidebar-menu-label">MCP & Skill</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar