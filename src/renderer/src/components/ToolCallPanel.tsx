/**
 * 工具调用面板组件
 * 显示当前活跃的工具调用和历史记录
 */

import React, { useEffect, useState, useRef } from 'react'
import {
  FileText,
  FilePlus,
  FileEdit,
  Trash2,
  Terminal,
  Search,
  FolderOpen,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X
} from 'lucide-react'
import { useToolStore } from '../store/toolStore'
import type { ToolCallRecord } from '../../../shared/types/tool-call'
import './ToolCallPanel.css'

// 工具图标映射
const toolIcons: Record<string, React.ReactNode> = {
  read_file: <FileText size={16} />,
  write_file: <FilePlus size={16} />,
  edit_file: <FileEdit size={16} />,
  append_file: <FileEdit size={16} />,
  delete_file: <Trash2 size={16} />,
  list_directory: <FolderOpen size={16} />,
  execute_bash: <Terminal size={16} />,
  search_files: <Search size={16} />
}

// 状态图标映射
const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock size={14} className="status-icon pending" />,
  executing: <Loader2 size={14} className="status-icon executing spin" />,
  completed: <CheckCircle2 size={14} className="status-icon completed" />,
  failed: <XCircle size={14} className="status-icon failed" />,
  cancelled: <AlertCircle size={14} className="status-icon cancelled" />
}

// 状态颜色映射
const statusColors: Record<string, string> = {
  pending: 'var(--text-secondary)',
  executing: 'var(--accent-color)',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#f59e0b'
}

interface ToolCallItemProps {
  record: ToolCallRecord
  isExpanded: boolean
  onToggle: () => void
}

const ToolCallItem: React.FC<ToolCallItemProps> = ({ record, isExpanded, onToggle }) => {
  const icon = toolIcons[record.name] || <FileText size={16} />
  const statusIcon = statusIcons[record.status]
  const statusColor = statusColors[record.status]

  // 格式化耗时
  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // 格式化参数为易读的键值对
  const formatArgsList = () => {
    const args = record.arguments
    return Object.entries(args).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value)
    }))
  }

  return (
    <div className="tool-call-item">
      {/* 头部：工具名称 + 状态 + 耗时 */}
      <div className="tool-call-header" onClick={onToggle}>
        <div className="tool-call-left">
          <div className="tool-call-icon">{icon}</div>
          <div className="tool-call-info">
            <div className="tool-call-name">{record.name}</div>
            <div className="tool-call-args-preview">
              {typeof record.arguments.path === 'string' && record.arguments.path && (
                <span className="arg-item">path: {record.arguments.path}</span>
              )}
              {typeof record.arguments.command === 'string' && record.arguments.command && (
                <span className="arg-item">cmd: {record.arguments.command}</span>
              )}
              {!record.arguments.path && !record.arguments.command && (
                <span className="arg-item">{Object.keys(record.arguments).join(', ')}</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="tool-call-right">
          <div className="tool-call-status" style={{ color: statusColor }}>
            {statusIcon}
            <span className="status-text">{record.status === 'completed' ? '成功' : record.status === 'failed' ? '失败' : record.status}</span>
          </div>
          {record.executionTime && (
            <div className="tool-call-duration">{formatDuration(record.executionTime)}</div>
          )}
          <div className="tool-call-expand">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </div>
      </div>

      {/* 展开详情 */}
      {isExpanded && (
        <div className="tool-call-details">
          {/* 参数区域 */}
          {Object.keys(record.arguments).length > 0 && (
            <div className="detail-section">
              <div className="detail-header">
                <span className="detail-label">参数</span>
              </div>
              <div className="detail-args-grid">
                {formatArgsList().map(({ key, value }) => (
                  <div key={key} className="arg-row">
                    <span className="arg-key">{key}</span>
                    <span className="arg-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 结果区域 */}
          {record.result && (
            <div className="detail-section">
              <div className="detail-header">
                <span className="detail-label">结果</span>
                <span className="detail-size">{record.result.length} 字符</span>
              </div>
              <pre className="detail-code success">
                {record.result.slice(0, 1000)}
                {record.result.length > 1000 && '\n... (已截断)'}
              </pre>
            </div>
          )}

          {/* 错误区域 */}
          {record.error && (
            <div className="detail-section">
              <div className="detail-header">
                <span className="detail-label error">错误</span>
              </div>
              <pre className="detail-code error">{record.error}</pre>
            </div>
          )}

          {/* 时间信息 */}
          <div className="detail-section detail-footer">
            <div className="detail-times">
              <span>开始: {new Date(record.startTime).toLocaleTimeString()}</span>
              {record.endTime && <span>结束: {new Date(record.endTime).toLocaleTimeString()}</span>}
              {record.executionTime && <span className="duration-highlight">耗时: {formatDuration(record.executionTime)}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ToolCallPanelProps {
  className?: string
}

export const ToolCallPanel: React.FC<ToolCallPanelProps> = ({ className = '' }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set())
  const [autoExpandActive, setAutoExpandActive] = useState(true)
  const prevActiveCountRef = useRef(0)

  // 使用 Zustand store
  const calls = useToolStore(state => state.allCalls())
  const activeCalls = useToolStore(state => state.activeCalls())
  const clearHistory = useToolStore(state => state.clearHistory)

  // 初始化时加载历史记录
  useEffect(() => {
    // 可以在这里加载历史记录
  }, [])

  // 自动展开活跃调用
  useEffect(() => {
    if (autoExpandActive && activeCalls.length > 0) {
      // 当新的活跃调用出现时，自动展开
      if (activeCalls.length > prevActiveCountRef.current) {
        setExpandedCalls(prev => {
          const newSet = new Set(prev)
          activeCalls.forEach(call => {
            if (call.status === 'executing') {
              newSet.add(call.id)
            }
          })
          return newSet
        })
      }
    }
    prevActiveCountRef.current = activeCalls.length
  }, [activeCalls, autoExpandActive])

  // 当面板可见且有活跃调用时，自动滚动到最新的活跃调用
  useEffect(() => {
    if (isVisible && activeCalls.length > 0 && calls.length > 0) {
      // 找到最新的活跃调用
      const latestActiveCall = activeCalls[0]
      if (latestActiveCall) {
        // 确保它在展开列表中
        setExpandedCalls(prev => {
          if (!prev.has(latestActiveCall.id)) {
            const newSet = new Set(prev)
            newSet.add(latestActiveCall.id)
            return newSet
          }
          return prev
        })
      }
    }
  }, [isVisible, activeCalls.length, calls.length])

  const toggleExpanded = (callId: string) => {
    setExpandedCalls(prev => {
      const newSet = new Set(prev)
      if (newSet.has(callId)) {
        newSet.delete(callId)
      } else {
        newSet.add(callId)
      }
      return newSet
    })
  }

  // 展开所有调用
  const expandAll = () => {
    setExpandedCalls(new Set(calls.map(c => c.id)))
  }

  // 收起所有调用
  const collapseAll = () => {
    setExpandedCalls(new Set())
  }

  const activeCount = activeCalls.length
  const completedCount = calls.filter(c => c.status === 'completed').length
  const failedCount = calls.filter(c => c.status === 'failed').length

  if (!isVisible) {
    return (
      <button
        className={`tool-panel-toggle ${className}`}
        onClick={() => setIsVisible(true)}
      >
        <Terminal size={16} />
        <span>工具调用</span>
        {activeCount > 0 && (
          <span className="badge active">{activeCount}</span>
        )}
        {completedCount > 0 && (
          <span className="badge completed">{completedCount}</span>
        )}
        {failedCount > 0 && (
          <span className="badge failed">{failedCount}</span>
        )}
      </button>
    )
  }

  return (
    <div className={`tool-call-panel ${className}`}>
      <div className="panel-header">
        <div className="panel-title">
          <Terminal size={18} />
          <span>工具调用</span>
          <span className="call-count">({calls.length})</span>
        </div>
        <div className="panel-actions">
          {calls.length > 0 && (
            <>
              <button
                className="action-btn"
                onClick={expandAll}
                title="展开全部"
              >
                <ChevronDown size={14} />
              </button>
              <button
                className="action-btn"
                onClick={collapseAll}
                title="收起全部"
              >
                <ChevronRight size={14} />
              </button>
              <button
                className="action-btn"
                onClick={clearHistory}
                title="清除历史"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button
            className="action-btn close"
            onClick={() => setIsVisible(false)}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="panel-stats">
        <div className="stat">
          <span className="stat-value">{calls.length}</span>
          <span className="stat-label">总计</span>
        </div>
        <div className="stat">
          <span className="stat-value active">{activeCount}</span>
          <span className="stat-label">执行中</span>
        </div>
        <div className="stat">
          <span className="stat-value completed">{completedCount}</span>
          <span className="stat-label">成功</span>
        </div>
        <div className="stat">
          <span className="stat-value failed">{failedCount}</span>
          <span className="stat-label">失败</span>
        </div>
      </div>

      <div className="panel-content">
        {calls.length === 0 ? (
          <div className="empty-state">
            <Terminal size={48} className="empty-icon" />
            <p>暂无工具调用记录</p>
            <p className="empty-hint">与 AI 对话时将自动显示工具调用</p>
          </div>
        ) : (
          <div className="tool-call-list">
            {calls.map(call => (
              <ToolCallItem
                key={call.id}
                record={call}
                isExpanded={expandedCalls.has(call.id)}
                onToggle={() => toggleExpanded(call.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
