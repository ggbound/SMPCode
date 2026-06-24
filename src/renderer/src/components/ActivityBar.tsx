import { useState, type ReactNode } from 'react'
import { File, Search, Settings, GitBranch, Clock, Plug, MessageSquare, Lock } from 'lucide-react'
import { t } from '../i18n'

export type ActivityBarItem =
  | 'explorer'
  | 'search'
  | 'git'
  | 'reminders'
  | 'mcp-skill'
  | 'feishu'
  | 'settings'

interface ActivityBarProps {
  activeItem: ActivityBarItem
  onItemClick: (item: ActivityBarItem) => void
  hasProjectPath: boolean
}

function ActivityBar({ activeItem, onItemClick, hasProjectPath }: ActivityBarProps) {
  const [hoveredItem, setHoveredItem] = useState<ActivityBarItem | null>(null)

  const activities: { id: ActivityBarItem; icon: ReactNode; label: string; disabled?: boolean }[] = [
    { id: 'explorer', icon: <File size={16} />, label: t('explorer') || 'Explorer' },
    { id: 'search', icon: <Search size={16} />, label: 'Search', disabled: !hasProjectPath },
    { id: 'git', icon: <GitBranch size={16} />, label: 'Git', disabled: !hasProjectPath },
    { id: 'reminders', icon: <Clock size={16} />, label: '定时任务', disabled: !hasProjectPath },
    { id: 'mcp-skill', icon: <Plug size={16} />, label: 'MCP & Skill', disabled: !hasProjectPath },
    { id: 'feishu', icon: <MessageSquare size={16} />, label: '飞书', disabled: !hasProjectPath },
    { id: 'settings', icon: <Settings size={16} />, label: t('settings') || 'Settings', disabled: !hasProjectPath },
  ]

  const bottomActivities: { id: ActivityBarItem; icon: ReactNode; label: string; disabled?: boolean }[] = []

  const handleItemClick = (item: ActivityBarItem, disabled: boolean) => {
    if (disabled) {
      return // 禁用的项不触发点击
    }
    
    // Settings 按钮特殊处理：打开设置模态框
    if (item === 'settings') {
      onItemClick(item)
      return
    }
    // VS Code 风格：点击已激活的项不会关闭侧边栏，而是保持当前状态
    // 只有点击不同的项才会切换
    if (activeItem !== item) {
      onItemClick(item)
    }
  }

  return (
    <div className="activity-bar">
      {/* Top activities */}
      <div className="activity-bar-items">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className={`activity-bar-item ${activeItem === activity.id ? 'active' : ''} ${hoveredItem === activity.id ? 'hovered' : ''} ${activity.disabled ? 'disabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleItemClick(activity.id, activity.disabled || false)
            }}
            onMouseEnter={() => {
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              setHoveredItem(null)
            }}
            title={activity.disabled ? '请先打开文件夹' : activity.label}
            style={{ zIndex: 1001, position: 'relative' }}
          >
            <span className="activity-icon">
              {activity.disabled ? <Lock size={16} /> : activity.icon}
            </span>
            {/* Active indicator */}
            {activeItem === activity.id && (
              <div className="activity-indicator" />
            )}
          </div>
        ))}
      </div>

      {/* Bottom activities */}
      <div className="activity-bar-items activity-bar-bottom">
        {bottomActivities.map((activity) => (
          <div
            key={activity.id}
            className={`activity-bar-item ${activeItem === activity.id ? 'active' : ''} ${hoveredItem === activity.id ? 'hovered' : ''} ${activity.disabled ? 'disabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleItemClick(activity.id, activity.disabled || false)
            }}
            onMouseEnter={() => {
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              setHoveredItem(null)
            }}
            title={activity.disabled ? '请先打开文件夹' : activity.label}
            style={{ zIndex: 1000, position: 'relative' }}
          >
            <span className="activity-icon">
              {activity.disabled ? <Lock size={16} /> : activity.icon}
            </span>
            {/* Active indicator */}
            {activeItem === activity.id && (
              <div className="activity-indicator" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default ActivityBar
