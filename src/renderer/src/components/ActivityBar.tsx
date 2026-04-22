import { useState, type ReactNode } from 'react'
import { File, Search, Settings } from 'lucide-react'
import { t } from '../i18n'

export type ActivityBarItem = 
  | 'explorer'
  | 'search'
  | 'settings'

interface ActivityBarProps {
  activeItem: ActivityBarItem
  onItemClick: (item: ActivityBarItem) => void
}

function ActivityBar({ activeItem, onItemClick }: ActivityBarProps) {
  const [hoveredItem, setHoveredItem] = useState<ActivityBarItem | null>(null)

  const activities: { id: ActivityBarItem; icon: ReactNode; label: string }[] = [
    { id: 'explorer', icon: <File size={24} />, label: t('explorer') || 'Explorer' },
    { id: 'search', icon: <Search size={24} />, label: 'Search' },
    { id: 'settings', icon: <Settings size={24} />, label: t('settings') || 'Settings' },
  ]

  const bottomActivities: { id: ActivityBarItem; icon: ReactNode; label: string }[] = []

  const handleItemClick = (item: ActivityBarItem) => {
    console.log('[ActivityBar] handleItemClick called with:', item, 'activeItem:', activeItem)
    // Settings 按钮特殊处理：打开设置模态框
    if (item === 'settings') {
      console.log('[ActivityBar] Opening settings')
      onItemClick(item)
      return
    }
    // VS Code 风格：点击已激活的项不会关闭侧边栏，而是保持当前状态
    // 只有点击不同的项才会切换
    if (activeItem !== item) {
      console.log('[ActivityBar] Switching from', activeItem, 'to', item)
      onItemClick(item)
    } else {
      console.log('[ActivityBar] Already active, ignoring click on', item)
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
              console.log('[ActivityBar] Top item clicked:', activity.id)
              handleItemClick(activity.id)
            }}
            onMouseEnter={() => {
              console.log('[ActivityBar] Mouse enter:', activity.id)
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              console.log('[ActivityBar] Mouse leave:', activity.id)
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
              console.log('[ActivityBar] onClick triggered for:', activity.id)
              e.stopPropagation()
              handleItemClick(activity.id)
            }}
            onMouseEnter={() => {
              console.log('[ActivityBar] Mouse enter:', activity.id)
              setHoveredItem(activity.id)
            }}
            onMouseLeave={() => {
              console.log('[ActivityBar] Mouse leave:', activity.id)
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
