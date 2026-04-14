import { useState } from 'react'
import type { ToolCall } from '../store'

interface ToolCallChainProps {
  toolCalls: ToolCall[]
}

export function ToolCallChain({ toolCalls }: ToolCallChainProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev)
      if (newSet.has(toolId)) {
        newSet.delete(toolId)
      } else {
        newSet.add(toolId)
      }
      return newSet
    })
  }

  const getStatusIcon = (status: ToolCall['status']) => {
    switch (status) {
      case 'pending':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
          </svg>
        )
      case 'running':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rotating">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          </svg>
        )
      case 'completed':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )
      case 'failed':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        )
    }
  }

  const getToolIcon = (name: string) => {
    if (name.includes('file')) return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    )
    if (name.includes('search')) return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    )
    if (name.includes('code')) return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    )
    if (name.includes('terminal') || name.includes('bash')) return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
    )
    if (name.includes('git')) return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    )
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    )
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatArgs = (args: Record<string, any>) => {
    try {
      return JSON.stringify(args, null, 2)
    } catch {
      return String(args)
    }
  }

  const runningToolCount = toolCalls.filter(t => t.status === 'running').length
  const completedToolCount = toolCalls.filter(t => t.status === 'completed').length

  return (
    <div className="trae-tool-chain">
      <div className="trae-tool-header">
        <div className="trae-tool-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span>工具调用</span>
          {runningToolCount > 0 && (
            <span className="trae-tool-badge running">{runningToolCount} 进行中</span>
          )}
        </div>
        <span className="trae-tool-progress">{completedToolCount}/{toolCalls.length}</span>
      </div>
      <div className="trae-tool-list">
        {toolCalls.map((tool, index) => {
          const isExpanded = expandedTools.has(tool.id)
          const hasContent = tool.args && Object.keys(tool.args).length > 0 || tool.result
          const isLast = index === toolCalls.length - 1
          return (
            <div
              key={tool.id}
              className={`trae-tool-item ${tool.status} ${isLast ? 'last' : ''}`}
            >
              <div className="trae-tool-indicator">
                <div className={`trae-tool-dot ${tool.status}`}>
                  {getStatusIcon(tool.status)}
                </div>
                {!isLast && <div className={`trae-tool-line ${tool.status}`} />}
              </div>
              <div className="trae-tool-content">
                <div
                  className="trae-tool-title-row"
                  onClick={() => hasContent && toggleTool(tool.id)}
                >
                  <div className="trae-tool-icon-wrapper">
                    {getToolIcon(tool.name)}
                  </div>
                  <span className="trae-tool-name">{tool.name}</span>
                  <div className="trae-tool-meta">
                    {tool.duration && (
                      <span className="trae-tool-time">{formatDuration(tool.duration)}</span>
                    )}
                    {hasContent && (
                      <svg 
                        width="12" 
                        height="12" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                        className={`trae-tool-expand ${isExpanded ? 'expanded' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="trae-tool-details">
                    {tool.args && Object.keys(tool.args).length > 0 && (
                      <div className="trae-tool-section">
                        <div className="trae-tool-section-title">参数</div>
                        <pre className="trae-tool-code">{formatArgs(tool.args)}</pre>
                      </div>
                    )}
                    {tool.result && (
                      <div className="trae-tool-section">
                        <div className="trae-tool-section-title">结果</div>
                        <pre className="trae-tool-code">{tool.result}</pre>
                      </div>
                    )}
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

export default ToolCallChain
