import { useState, useEffect } from 'react'
import { Clock, Trash2, Play, Pause, RefreshCw, Calendar, Target, Zap, History, AlertCircle, Repeat } from 'lucide-react'

export interface Reminder {
  id: string
  content: string
  cronExpression: string
  targetType: 'user' | 'group'
  targetId: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastTriggeredAt?: number
  triggerCount: number
  description?: string
  isOneTime?: boolean
  scheduleType?: 'daily' | 'workday' | 'today' | 'weekly' | 'hourly' | 'custom'
}

const SCHEDULE_TYPE_MAP: Record<string, { label: string; color: string }> = {
  daily: { label: '每天', color: '#4ade80' },
  workday: { label: '工作日', color: '#60a5fa' },
  today: { label: '当天', color: '#fbbf24' },
  weekly: { label: '每周', color: '#a78bfa' },
  hourly: { label: '每小时', color: '#f472b6' },
  custom: { label: '自定义', color: '#94a3b8' }
}

function ReminderPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReminders = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await window.api?.reminder?.getAll()
      setReminders(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('[ReminderPanel] Failed to fetch reminders:', err)
      setError('获取定时任务失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReminders()
  }, [])

  const handleRemove = async (id: string) => {
    try {
      const result = await window.api?.reminder?.remove(id)
      if (result?.success) {
        setReminders(prev => prev.filter(r => r.id !== id))
      } else {
        setError(result?.error || '删除定时任务失败')
      }
    } catch (err) {
      console.error('[ReminderPanel] Failed to remove reminder:', err)
      setError('删除定时任务失败')
    }
  }

  const handleToggle = async (id: string) => {
    try {
      const result = await window.api?.reminder?.toggle(id)
      if (result?.success && result.reminder) {
        setReminders(prev => prev.map(r => r.id === id ? result.reminder : r))
      } else {
        setError(result?.error || '切换状态失败')
      }
    } catch (err) {
      console.error('[ReminderPanel] Failed to toggle reminder:', err)
      setError('切换状态失败')
    }
  }

  const formatCronExpression = (cron: string): string => {
    const parts = cron.split(' ')
    if (parts.length !== 5) return cron

    const [minute, hour, day, month, weekday] = parts
    
    let result = ''
    
    // 处理时间部分
    if (hour !== '*' || minute !== '*') {
      if (hour === '*') {
        result += `每${minute !== '*' ? minute + '分钟' : '小时'}`
      } else {
        const displayHour = parseInt(hour) > 12 ? `${parseInt(hour) - 12} PM` : `${hour} AM`
        result += `${hour}:${minute.padStart(2, '0')}`
      }
    }
    
    // 处理日期部分
    if (day !== '*') {
      if (result) result += ' '
      result += `每月${day}日`
    }
    
    // 处理星期部分
    if (weekday !== '*' && weekday !== '?') {
      if (result) result += ' '
      const dayMap: Record<string, string> = {
        '0': '周日', '1': '周一', '2': '周二', '3': '周三',
        '4': '周四', '5': '周五', '6': '周六',
        '1-5': '工作日', '1-6': '工作日+周六'
      }
      result += dayMap[weekday] || `周${weekday}`
    }
    
    if (result) return result
    return '每分钟'
  }

  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return '从未'
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60))
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60))
        return minutes <= 0 ? '刚刚' : `${minutes}分钟前`
      }
      return `${hours}小时前`
    } else if (days === 1) {
      return '昨天'
    } else if (days < 7) {
      return `${days}天前`
    }
    return date.toLocaleDateString('zh-CN')
  }

  const getStatusColor = (enabled: boolean) => {
    return enabled ? 'var(--reminder-active)' : 'var(--reminder-disabled)'
  }

  return (
    <div className="reminder-panel">
      {/* Header */}
      <div className="reminder-panel-header">
        <div className="reminder-panel-header-left">
          <div className="reminder-panel-icon">
            <Clock size={16} />
          </div>
          <span className="reminder-panel-title">定时任务</span>
          <span className="reminder-panel-count">{reminders.length}</span>
        </div>
        <div className="reminder-panel-header-right">
          <button 
            className="reminder-action-btn refresh-btn" 
            onClick={fetchReminders}
            title="刷新列表"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="reminder-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button className="error-close" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Content */}
      <div className="reminder-panel-content">
        {loading ? (
          <div className="reminder-loading">
            <RefreshCw size={20} className="spin" />
            <span>加载中...</span>
          </div>
        ) : reminders.length === 0 ? (
          <div className="reminder-empty">
            <div className="empty-icon-wrap">
              <Clock size={48} />
            </div>
            <h3>暂无定时任务</h3>
            <p>在聊天窗口中使用自然语言创建定时提醒</p>
            <p className="empty-example">例如："帮我设置明天早上9点的提醒"</p>
          </div>
        ) : (
          <div className="reminder-list">
            {reminders.map((reminder, index) => (
              <div 
                key={reminder.id} 
                className={`reminder-card ${reminder.enabled ? 'active' : 'disabled'}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Card Header */}
                <div className="reminder-card-header">
                  <div className="reminder-status-dot" style={{ backgroundColor: getStatusColor(reminder.enabled) }} />
                  <div className="reminder-content-wrap">
                    <h4 className="reminder-title">{reminder.content}</h4>
                    <div className="reminder-badges">
                      {reminder.scheduleType && SCHEDULE_TYPE_MAP[reminder.scheduleType] && (
                        <span
                          className={`badge badge-schedule-type badge-${reminder.scheduleType}`}
                          style={{ color: SCHEDULE_TYPE_MAP[reminder.scheduleType].color, borderColor: SCHEDULE_TYPE_MAP[reminder.scheduleType].color }}
                        >
                          <Repeat size={10} />
                          {SCHEDULE_TYPE_MAP[reminder.scheduleType].label}
                        </span>
                      )}
                      {reminder.isOneTime && (
                        <span className="badge badge-one-time">
                          <Calendar size={10} />
                          一次性
                        </span>
                      )}
                      {reminder.enabled && (
                        <span className="badge badge-active">
                          <Zap size={10} />
                          运行中
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="reminder-actions">
                    <button 
                      className={`action-btn toggle-btn ${reminder.enabled ? 'pause' : 'play'}`}
                      onClick={() => handleToggle(reminder.id)}
                      title={reminder.enabled ? '暂停' : '启用'}
                    >
                      {reminder.enabled ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button 
                      className="action-btn delete-btn"
                      onClick={() => handleRemove(reminder.id)}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                <div className="reminder-card-body">
                  <div className="reminder-detail-row">
                    <Calendar size={14} className="detail-icon" />
                    <span className="detail-label">执行时间</span>
                    <span className="detail-value cron-value">{formatCronExpression(reminder.cronExpression)}</span>
                  </div>
                  <div className="reminder-detail-row">
                    <Target size={14} className="detail-icon" />
                    <span className="detail-label">目标</span>
                    <span className="detail-value">{reminder.targetType === 'user' ? '私聊' : '群聊'}</span>
                  </div>
                  <div className="reminder-detail-row">
                    <Zap size={14} className="detail-icon" />
                    <span className="detail-label">已触发</span>
                    <span className="detail-value">{reminder.triggerCount} 次</span>
                  </div>
                  <div className="reminder-detail-row">
                    <History size={14} className="detail-icon" />
                    <span className="detail-label">上次触发</span>
                    <span className="detail-value">{formatTime(reminder.lastTriggeredAt)}</span>
                  </div>
                  {reminder.description && (
                    <div className="reminder-description">
                      <span className="detail-label">备注</span>
                      <span className="detail-value">{reminder.description}</span>
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="reminder-card-footer">
                  <span className="reminder-id">{reminder.id.slice(0, 8)}...</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="reminder-panel-footer">
        <span className="footer-text">共 {reminders.length} 个定时任务</span>
      </div>
    </div>
  )
}

export default ReminderPanel