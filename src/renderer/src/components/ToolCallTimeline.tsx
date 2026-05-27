/**
 * ToolCallTimeline - 工具调用时间线组件
 * 参考 Cursor 等现代 AI 编码工具的设计风格
 * 以时间线方式展示工具调用记录
 */

import { memo } from 'react'
import type { ToolCall } from '../store'
import { 
  FileText, 
  Edit3, 
  PlusCircle, 
  FolderOpen, 
  FileSearch, 
  Terminal, 
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Wrench,
  Eye,
  Code2,
  Search
} from 'lucide-react'

interface ToolCallTimelineProps {
  toolCalls: ToolCall[]
}

// 工具配置
const toolConfig: Record<string, { 
  icon: React.ReactNode
  label: string
  action: string
  color: string
}> = {
  'read_file': { 
    icon: <Eye size={14} />, 
    label: '查看', 
    action: '已查看',
    color: '#3b82f6'
  },
  'write_file': { 
    icon: <PlusCircle size={14} />, 
    label: '创建', 
    action: '已创建',
    color: '#22c55e'
  },
  'edit_file': { 
    icon: <Edit3 size={14} />, 
    label: '编辑', 
    action: '已编辑',
    color: '#f59e0b'
  },
  'delete_file': { 
    icon: <Trash2 size={14} />, 
    label: '删除', 
    action: '已删除',
    color: '#ef4444'
  },
  'list_directory': { 
    icon: <FolderOpen size={14} />, 
    label: '列出目录', 
    action: '已列出',
    color: '#8b5cf6'
  },
  'search_code': { 
    icon: <Search size={14} />, 
    label: '搜索', 
    action: '已搜索',
    color: '#06b6d4'
  },
  'execute_bash': { 
    icon: <Terminal size={14} />, 
    label: '执行命令', 
    action: '已执行',
    color: '#ec4899'
  },
  'append_file': { 
    icon: <Edit3 size={14} />, 
    label: '追加', 
    action: '已追加',
    color: '#f97316'
  }
}

// 获取工具信息
function getToolInfo(toolName: string) {
  return toolConfig[toolName] || { 
    icon: <Wrench size={14} />, 
    label: toolName, 
    action: '已执行',
    color: '#6b7280'
  }
}

// 格式化路径
function formatPath(path: string): string {
  if (!path) return ''
  // 如果路径太长，显示最后部分
  const parts = path.split('/')
  if (parts.length > 3) {
    return '.../' + parts.slice(-3).join('/')
  }
  return path
}

// 单个工具调用卡片
const ToolCallCard = memo(function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const config = getToolInfo(toolCall.name)
  const path = toolCall.args?.path || toolCall.args?.file_path || toolCall.args?.directory || ''
  
  return (
    <div className={`tool-call-card ${toolCall.status}`}>
      <div className="tool-call-card-icon" style={{ color: config.color }}>
        {config.icon}
      </div>
      <div className="tool-call-card-content">
        <div className="tool-call-card-action" style={{ color: config.color }}>
          {config.action}
        </div>
        {path && (
          <div className="tool-call-card-path">
            {formatPath(path)}
          </div>
        )}
      </div>
      <div className="tool-call-card-status">
        {toolCall.status === 'running' && (
          <Loader2 size={14} className="spinning" style={{ color: config.color }} />
        )}
        {toolCall.status === 'completed' && (
          <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
        )}
        {toolCall.status === 'failed' && (
          <XCircle size={14} style={{ color: '#ef4444' }} />
        )}
      </div>
    </div>
  )
})

// 主组件
export const ToolCallTimeline = memo(function ToolCallTimeline({ toolCalls }: ToolCallTimelineProps) {
  if (!toolCalls || toolCalls.length === 0) return null

  return (
    <div className="tool-call-timeline">
      <div className="tool-call-timeline-header">
        <Code2 size={14} />
        <span>操作记录</span>
        <span className="tool-call-count">{toolCalls.length}</span>
      </div>
      <div className="tool-call-timeline-list">
        {toolCalls.map((toolCall, index) => (
          <div key={toolCall.id} className="tool-call-timeline-item">
            <div className="tool-call-timeline-line" />
            <ToolCallCard toolCall={toolCall} />
          </div>
        ))}
      </div>
    </div>
  )
})

export default ToolCallTimeline
