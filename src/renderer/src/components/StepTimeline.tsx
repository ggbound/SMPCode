import { useState } from 'react'
import type { Step } from '../store'

interface StepTimelineProps {
  steps: Step[]
}

// 工具图标映射
const getToolIcon = (toolName?: string) => {
  if (!toolName) return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v8m-4-4h8"/>
    </svg>
  )
  
  const name = toolName.toLowerCase()
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l8 8-8 8M12 4h8"/>
      </svg>
    )
  }
  if (name.includes('file') || name.includes('read') || name.includes('write')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    )
  }
  if (name.includes('search') || name.includes('grep') || name.includes('find')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
    )
  }
  if (name.includes('edit') || name.includes('replace')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8v8m-4-4h8"/>
    </svg>
  )
}

// 格式化参数显示
const formatArgs = (args?: Record<string, any>) => {
  if (!args || Object.keys(args).length === 0) return null
  
  const entries = Object.entries(args)
  if (entries.length === 0) return null
  
  // 只显示前几个参数，避免过长
  const displayEntries = entries.slice(0, 3)
  const hasMore = entries.length > 3
  
  return displayEntries.map(([key, value]) => {
    let displayValue = String(value)
    // 截断过长的值
    if (displayValue.length > 50) {
      displayValue = displayValue.substring(0, 50) + '...'
    }
    return `${key}="${displayValue}"`
  }).join(' ') + (hasMore ? ' ...' : '')
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const runningStepCount = steps.filter(s => s.status === 'running').length
  const completedStepCount = steps.filter(s => s.status === 'completed').length
  const totalSteps = steps[0]?.totalSteps || steps.length

  // 获取当前运行的步骤
  const currentRunningStep = steps.find(s => s.status === 'running')

  return (
    <div className="trae-step-timeline">
      {/* 头部：显示当前步骤进度 */}
      <div className="trae-step-header">
        <div className="trae-step-title">
          <span className="trae-step-icon">📍</span>
          <span className="trae-step-header-text">
            步骤 {currentRunningStep?.stepNumber || completedStepCount}/{totalSteps}
          </span>
        </div>
      </div>

      {/* 当前正在执行的操作 */}
      {currentRunningStep && (
        <div className="trae-current-action">
          <div className="trae-action-header">
            <span className="trae-action-icon">🔄</span>
            <span className="trae-action-text">
              {currentRunningStep.action || '正在调用工具'}:
            </span>
          </div>
          {currentRunningStep.toolName && (
            <div className="trae-tool-call-detail">
              <div className="trae-tool-name-row">
                {getToolIcon(currentRunningStep.toolName)}
                <span className="trae-tool-name">{currentRunningStep.toolName}</span>
              </div>
              {currentRunningStep.toolArgs && (
                <div className="trae-tool-args">
                  {formatArgs(currentRunningStep.toolArgs)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="trae-step-list">
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id)
          const isLast = index === steps.length - 1
          const stepNum = step.stepNumber || index + 1
          
          return (
            <div 
              key={step.id} 
              className={`trae-step-item ${step.status} ${isLast ? 'last' : ''} ${step.status === 'running' ? 'active' : ''}`}
            >
              <div className="trae-step-indicator">
                <div className={`trae-step-number ${step.status}`}>
                  {step.status === 'completed' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : step.status === 'running' ? (
                    <div className="trae-step-pulse" />
                  ) : step.status === 'failed' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  ) : (
                    <span>{stepNum}</span>
                  )}
                </div>
                {!isLast && <div className={`trae-step-line ${step.status}`} />}
              </div>
              <div className="trae-step-content">
                <div 
                  className="trae-step-title-row"
                  onClick={() => (step.content || step.toolArgs) && toggleStep(step.id)}
                >
                  <div className="trae-step-main">
                    <span className="trae-step-name">{step.title}</span>
                    {step.toolName && (
                      <span className="trae-step-tool-tag">{step.toolName}</span>
                    )}
                  </div>
                  <div className="trae-step-meta">
                    {step.duration && (
                      <span className="trae-step-time">{formatDuration(step.duration)}</span>
                    )}
                    {(step.content || step.toolArgs) && (
                      <svg 
                        width="12" 
                        height="12" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                        className={`trae-step-expand ${isExpanded ? 'expanded' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    )}
                  </div>
                </div>
                {isExpanded && (step.content || step.toolArgs) && (
                  <div className="trae-step-detail">
                    {step.toolArgs && (
                      <div className="trae-step-args-detail">
                        <pre>{JSON.stringify(step.toolArgs, null, 2)}</pre>
                      </div>
                    )}
                    {step.content && <pre>{step.content}</pre>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default StepTimeline
