import { useStore } from '../store'
import { t } from '../i18n'

function Sidebar() {
  const { sessions, currentSession, selectSession, addSession, setMessages } = useStore()

  const handleNewSession = async () => {
    try {
      const res = await fetch('http://localhost:3847/api/sessions', { method: 'POST' })
      const session = await res.json()
      addSession(session)
      selectSession(session.id)
      setMessages([])
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
      }
    } catch (error) {
      console.error('Failed to load session:', error)
    }
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
            >
              <div style={{ fontWeight: 500, fontSize: '13px' }}>
                {t('sessionTitle')} {session.id.slice(0, 8)}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>
                {new Date(session.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

export default Sidebar