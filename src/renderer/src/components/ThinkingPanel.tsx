import { useState } from 'react'

interface ThinkingStep {
  type: 'search' | 'analysis' | 'code' | 'command' | 'result'
  title: string
  content?: string
  filePath?: string
  language?: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
}

interface ThinkingPanelProps {
  steps: ThinkingStep[]
}

// 获取步骤图标
function getStepIcon(type: ThinkingStep['type'], status?: ThinkingStep['status']) {
  const iconClass = status === 'running' ? 'rotating' : ''
  
  switch (type) {
    case 'search':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
      )
    case 'analysis':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      )
    case 'code':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <polyline points="16 18 22 12 16 6"/>
          <polyline points="8 6 2 12 8 18"/>
        </svg>
      )
    case 'command':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <path d="M4 17l6-6-6-6M12 19h8"/>
        </svg>
      )
    case 'result':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
          <circle cx="12" cy="12" r="10"/>
        </svg>
      )
  }
}

// 获取步骤状态颜色
function getStepStatusColor(status?: ThinkingStep['status']) {
  switch (status) {
    case 'running':
      return 'var(--accent-color)'
    case 'completed':
      return 'var(--success-color)'
    case 'failed':
      return 'var(--danger-color)'
    default:
      return 'var(--text-tertiary)'
  }
}

// 单个思考步骤组件
function ThinkingStepItem({ step, index }: { step: ThinkingStep; index: number }) {
  const [isExpanded, setIsExpanded] = useState(step.type === 'code' || step.type === 'command')
  const hasContent = step.content || step.filePath
  
  return (
    <div className={`thinking-step ${step.type} ${step.status || ''}`}>
      <div 
        className="thinking-step-header"
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
      >
        <div className="thinking-step-icon" style={{ color: getStepStatusColor(step.status) }}>
          {getStepIcon(step.type, step.status)}
        </div>
        <div className="thinking-step-title">
          <span className="thinking-step-number">{index + 1}.</span>
          <span className="thinking-step-text">{step.title}</span>
        </div>
        {hasContent && (
          <svg 
            width="12" 
            height="12" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            className={`thinking-step-toggle ${isExpanded ? 'expanded' : ''}`}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
      </div>
      
      {isExpanded && hasContent && (
        <div className="thinking-step-content">
          {step.filePath && (
            <div className="thinking-step-filepath">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>{step.filePath}</span>
            </div>
          )}
          {step.content && (
            <div className="thinking-step-code">
              <pre>{step.content}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ThinkingPanel({ steps }: ThinkingPanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  
  const toggleStep = (index: number) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }
  
  const toggleAll = () => {
    if (expandedSteps.size === steps.length) {
      setExpandedSteps(new Set())
    } else {
      setExpandedSteps(new Set(steps.map((_, i) => i)))
    }
  }
  
  return (
    <div className="thinking-panel">
      <div className="thinking-panel-header">
        <span className="thinking-panel-title">思考过程</span>
        <button className="thinking-panel-toggle" onClick={toggleAll}>
          {expandedSteps.size === steps.length ? '收起全部' : '展开全部'}
        </button>
      </div>
      
      <div className="thinking-steps">
        {steps.map((step, index) => (
          <ThinkingStepItem 
            key={index} 
            step={step} 
            index={index}
          />
        ))}
      </div>
    </div>
  )
}

export default ThinkingPanel
