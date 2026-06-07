import { useState, useEffect } from 'react'
import { Clock, Trash2, Play, Pause, RefreshCw, Calendar, Target, Zap, History, AlertCircle, Repeat, Plus } from 'lucide-react'
import '../styles/vscode-sidebar.css'
import './reminder-panel.css'

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

  const getStatusColor = (enabled: boolean) => enabled ? '#22c55e' : '#6e6e6e'

  const formatCronExpression = (cron: string): string => {
    const parts = cron.split(' ')
    if (parts.length !== 5) return cron

    const [minute, hour, day, month, weekday] = parts
    
    let result = ''
    
    if (hour !== '*' || minute !== '*') {
      if (hour === '*') {
        result += `每${minute !== '*' ? minute + '分钟' : '小时'}`
      } else {
        result += `${hour}:${minute.padStart(2, '0')}`
      }
    }
    
    if (day !== '*') {
      if (result) result += ' '
      result += `${day}日`
    }
    
    if (month !== '*') {
      if (result) result += ' '
      result += `${month}月`
    }
    
    if (weekday !== '*') {
      if (result) result += ' '
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      result += weekdays[parseInt(weekday)]
    }
    
    return result || '自定义'
  }

  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return '从未'
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
    <div className="vscode-sidebar-panel reminder-panel">
      {/* Header */}
      <div className="vscode-panel-header">
        <div className="vscode-panel-header-left">
          <span className="vscode-panel-title">定时任务</span>
        </div>
        <div className="vscode-panel-actions">
          <button
            className="vscode-panel-action-btn"
            onClick={fetchReminders}
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="vscode-panel-content reminder-panel-content">
        {loading ? (
          <div className="reminder-panel-loading">加载中...</div>
        ) : error ? (
          <div className="reminder-panel-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : reminders.length === 0 ? (
          <div className="reminder-panel-empty">
            <Clock size={48} />
            <p>暂无定时任务</p>
            <span>点击上方 + 按钮添加</span>
          </div>
        ) : (
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className={`reminder-item ${!reminder.enabled ? 'disabled' : ''}`}
              >
                {/* Status Dot */}
                <div 
                  className="reminder-item-status" 
                  style={{ backgroundColor: getStatusColor(reminder.enabled) }}
                />
                
                {/* Content */}
                <div className="reminder-item-content">
                  <div className="reminder-item-header">
                    <span className="reminder-item-title">{reminder.content}</span>
                    {reminder.scheduleType && SCHEDULE_TYPE_MAP[reminder.scheduleType] && (
                      <span className="reminder-item-badge">
                        {SCHEDULE_TYPE_MAP[reminder.scheduleType].label}
                      </span>
                    )}
                  </div>
                  <div className="reminder-item-meta">
                    {formatCronExpression(reminder.cronExpression)} · 
                    {reminder.targetType === 'user' ? '私聊' : '群聊'} · 
                    已触发 {reminder.triggerCount} 次
                  </div>
                </div>

                {/* Actions */}
                <div className="reminder-item-actions">
                  <button
                    className="reminder-item-action-btn"
                    onClick={() => handleToggle(reminder.id)}
                    title={reminder.enabled ? '暂停' : '启用'}
                  >
                    {reminder.enabled ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    className="reminder-item-action-btn delete"
                    onClick={() => handleRemove(reminder.id)}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReminderPanel
