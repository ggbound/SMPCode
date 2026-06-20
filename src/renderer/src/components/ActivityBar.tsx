import { useState, type ReactNode } from 'react'
import { File, Search, Settings, GitBranch, Clock, Plug, MessageSquare } from 'lucide-react'
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
}

function ActivityBar({ activeItem, onItemClick }: ActivityBarProps) {
  const [hoveredItem, setHoveredItem] = useState<ActivityBarItem | null>(null)

  const activities: { id: ActivityBarItem; icon: ReactNode; label: string }[] = [
    { id: 'explorer', icon: <File size={16} />, label: t('explorer') || 'Explorer' },
    { id: 'search', icon: <Search size={16} />, label: 'Search' },
    { id: 'git', icon: <GitBranch size={16} />, label: 'Git' },
    { id: 'reminders', icon: <Clock size={16} />, label: '定时任务' },
    { id: 'mcp-skill', icon: <Plug size={16} />, label: 'MCP & Skill' },
    { id: 'feishu', icon: <MessageSquare size={16} />, label: '飞书' },
    { id: 'settings', icon: <Settings size={16} />, label: t('settings') || 'Settings' },
  ]

  const bottomActivities: { id: ActivityBarItem; icon: ReactNode; label: string }[] = []

  const handleItemClick = (item: ActivityBarItem) => {
    // Settings 按钮特殊处理：打开设置模态框
    if (item === 'settings') {
      onItemClick(item)
      return
    }
    // VS Code 风格：点击已激活的项不会关闭侧边栏，而是保持当前状态
    // 只有点击不同的项才会切换
    if (activeItem !== item) {
      onItemClick(item)
    } else {
    }
  }

  return (
    <div className="activity-bar">
      {/* Top activities */}
      <div className="activity-bar-items">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className={`activity-bar-item ${activeItem === activity.id ? 'active' : ''} ${hoveredItem === activity.id ? 'hovered' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleItemClick(activity.id)
            }}
            onMouseEnter={() => {
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              setHoveredItem(null)
            }}
            title={activity.label}
            style={{ zIndex: 1001, position: 'relative' }}
          >
            <span className="activity-icon">{activity.icon}</span>
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
            className={`activity-bar-item ${activeItem === activity.id ? 'active' : ''} ${hoveredItem === activity.id ? 'hovered' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleItemClick(activity.id)
            }}
            onMouseEnter={() => {
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              setHoveredItem(null)
            }}
            title={activity.label}
            style={{ zIndex: 1000, position: 'relative' }}
          >
            <span className="activity-icon">{activity.icon}</span>
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
