/**
 * Kilo Code 风格模式选择器
 * 参考: https://kilocode.ai
 * 
 * 特点:
 * - 简洁的胶囊式切换
 * - 彩色渐变标识
 * - 悬停显示描述
 */

import { memo, useState, useCallback } from 'react'
import { 
  Code2, 
  Compass, 
  Bug, 
  MessageCircle, 
  Settings,
  ChevronDown
} from 'lucide-react'
import { AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'

interface ModeSelectorProps {
  currentMode: AgentMode
  onModeChange: (mode: AgentMode) => void
}

const iconMap = {
  Code2,
  Compass,
  Bug,
  MessageCircle,
  Settings
}

export const ModeSelector = memo(function ModeSelector({ 
  currentMode, 
  onModeChange 
}: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredMode, setHoveredMode] = useState<AgentMode | null>(null)

  const currentConfig = AGENT_MODE_CONFIGS[currentMode]
  const CurrentIcon = iconMap[currentConfig.icon as keyof typeof iconMap] || Settings

  const handleModeSelect = useCallback((mode: AgentMode) => {
    onModeChange(mode)
    setIsOpen(false)
  }, [onModeChange])

  return (
    <div className="kilo-mode-selector">
      {/* 当前模式按钮 */}
      <button
        className="kilo-mode-button"
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          '--mode-color': currentConfig.color 
        } as React.CSSProperties}
      >
        <div className={`kilo-mode-icon ${currentConfig.id}`}>
          <CurrentIcon size={16} />
        </div>
        <span className="kilo-mode-name">{currentConfig.name}</span>
        <ChevronDown 
          size={14} 
          className={`kilo-mode-chevron ${isOpen ? 'open' : ''}`}
        />
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <>
          <div className="kilo-mode-overlay" onClick={() => setIsOpen(false)} />
          <div className="kilo-mode-dropdown">
            <div className="kilo-mode-header">
              <span>选择模式</span>
            </div>
            <div className="kilo-mode-list">
              {(Object.keys(AGENT_MODE_CONFIGS) as AgentMode[]).map((mode) => {
                const config = AGENT_MODE_CONFIGS[mode]
                const Icon = iconMap[config.icon as keyof typeof iconMap] || Settings
                const isActive = mode === currentMode
                const isHovered = mode === hoveredMode

                return (
                  <button
                    key={mode}
                    className={`kilo-mode-option ${isActive ? 'active' : ''}`}
                    onClick={() => handleModeSelect(mode)}
                    onMouseEnter={() => setHoveredMode(mode)}
                    onMouseLeave={() => setHoveredMode(null)}
                    style={{ 
                      '--mode-color': config.color 
                    } as React.CSSProperties}
                  >
                    <div className={`kilo-mode-option-icon ${mode}`}>
                      <Icon size={16} />
                    </div>
                    <div className="kilo-mode-option-info">
                      <span className="kilo-mode-option-name">{config.name}</span>
                      <span className="kilo-mode-option-desc">{config.description}</span>
                    </div>
                    {isActive && (
                      <div className="kilo-mode-active-indicator" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
})
