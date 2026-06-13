/**
 * 流式消息组件 - 参考 Kilo Code 和 Cursor 设计
 * 
 * 核心特性：
 * 1. 消息由多个内容块组成（文本、工具调用、工具结果）
 * 2. 工具调用内联显示，实时更新状态
 * 3. 流式打字效果
 * 4. 代码块语法高亮
 */

import { memo, useState, useCallback } from 'react'
import type { KiloMessage, ContentBlock, KiloToolCall } from '../store/kiloStore'
import { MarkdownRenderer } from './MarkdownRenderer'
import {
  Bot,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Edit3,
  PlusCircle,
  FolderOpen,
  Search,
  Terminal,
  Trash2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Globe,
  Bell,
  List,
  Trash,
  FileCode,
  FileX,
  FilePlus,
  FolderTree,
  Play,
  AlertCircle
} from 'lucide-react'

interface StreamingMessageProps {
  message: KiloMessage
  isLast?: boolean
}

// 工具配置
const TOOL_CONFIG: Record<string, {
  icon: React.ReactNode
  label: string
  color: string
  bgColor: string
  description: string
}> = {
  read_file: {
    icon: <FileText size={14} />,
    label: '读取文件',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    description: '读取文件内容'
  },
  write_file: {
    icon: <FilePlus size={14} />,
    label: '写入文件',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.1)',
    description: '创建或覆盖文件'
  },
  edit_file: {
    icon: <Edit3 size={14} />,
    label: '编辑文件',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    description: '修改文件内容'
  },
  delete_file: {
    icon: <FileX size={14} />,
    label: '删除文件',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.1)',
    description: '删除指定文件'
  },
  list_directory: {
    icon: <FolderTree size={14} />,
    label: '列出目录',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
    description: '查看目录内容'
  },
  search_files: {
    icon: <Search size={14} />,
    label: '搜索文件',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)',
    description: '搜索匹配的文件'
  },
  execute_bash: {
    icon: <Terminal size={14} />,
    label: '执行命令',
    color: '#ec4899',
    bgColor: 'rgba(236, 72, 153, 0.1)',
    description: '执行 shell 命令'
  },
  append_file: {
    icon: <FilePlus size={14} />,
    label: '追加文件',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)',
    description: '追加内容到文件'
  },
  browse_website: {
    icon: <Globe size={14} />,
    label: '浏览网页',
    color: '#0ea5e9',
    bgColor: 'rgba(14, 165, 233, 0.1)',
    description: '访问并提取网页内容'
  },
  add_reminder: {
    icon: <Bell size={14} />,
    label: '添加提醒',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    description: '设置定时提醒'
  },
  list_reminders: {
    icon: <List size={14} />,
    label: '提醒列表',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
    description: '查看所有提醒'
  }
}

// 获取工具配置
function getToolConfig(name: string) {
  return TOOL_CONFIG[name] || {
    icon: <Wrench size={14} />,
    label: name,
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.1)',
    description: '执行工具操作'
  }
}

// 格式化参数显示
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  
  const firstEntry = entries[0]
  const value = String(firstEntry[1])
  
  // 截断过长的值
  if (value.length > 50) {
    return `${firstEntry[0]}: ${value.slice(0, 50)}...`
  }
  return `${firstEntry[0]}: ${value}`
}

// 工具调用卡片
const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  result,
  error
}: {
  toolCall: KiloToolCall
  result?: unknown
  error?: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const config = getToolConfig(toolCall.name)
  
  const isRunning = toolCall.status === 'running'
  const isCompleted = toolCall.status === 'completed'
  const isFailed = toolCall.status === 'failed'
  
  return (
    <div
      className="tool-call-card"
      style={{
        borderLeft: `3px solid ${isFailed ? '#ef4444' : config.color}`,
        backgroundColor: config.bgColor,
        margin: '8px 0',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '13px'
      }}
    >
      {/* 头部：工具名称和状态 */}
      <div
        className="tool-call-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          cursor: result || error ? 'pointer' : 'default'
        }}
        onClick={() => (result || error) && setIsExpanded(!isExpanded)}
      >
        <div
          className="tool-icon"
          style={{
            color: config.color,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          {isRunning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isCompleted ? (
            <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
          ) : isFailed ? (
            <XCircle size={16} style={{ color: '#ef4444' }} />
          ) : (
            config.icon
          )}
        </div>
        
        <div className="tool-info" style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, color: config.color }}>
            {config.label}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
            {formatArgs(toolCall.args)}
          </div>
        </div>
        
        {(result || error) && (
          <div style={{ color: 'rgba(255,255,255,0.5)' }}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
        )}
      </div>
      
      {/* 展开内容：工具结果 */}
      {isExpanded && (result || error) && (
        <div
          className="tool-result"
          style={{
            marginTop: '10px',
            padding: '10px',
            backgroundColor: 'rgba(0,0,0,0.2)',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '300px',
            overflow: 'auto',
            color: error ? '#ef4444' : '#e2e8f0'
          }}
        >
          {error || String(result)}
        </div>
      )}
    </div>
  )
})

// 内容块渲染
const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block
}: {
  block: ContentBlock
}) {
  switch (block.type) {
    case 'text':
      return (
        <div className="text-block">
          <MarkdownRenderer content={block.content} />
        </div>
      )
      
    case 'tool_call':
      return (
        <ToolCallCard
          toolCall={block.toolCall}
          result={block.toolCall.result}
          error={block.toolCall.error}
        />
      )
      
    case 'tool_result':
      // 工具结果通常和 tool_call 一起显示，这里不需要单独渲染
      return null
      
    case 'thinking':
      return (
        <div
          className="thinking-block"
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            margin: '8px 0',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.6)',
            fontStyle: 'italic'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Loader2 size={14} className="animate-spin" />
            <span>思考中...</span>
          </div>
          {block.content}
        </div>
      )
      
    default:
      return null
  }
})

// 用户消息
const UserMessage = memo(function UserMessage({ message }: { message: KiloMessage }) {
  return (
    <div
      className="user-message"
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        margin: '16px 0'
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '12px 16px',
          backgroundColor: '#3b82f6',
          borderRadius: '16px 16px 4px 16px',
          color: 'white',
          fontSize: '14px',
          lineHeight: '1.5'
        }}
      >
        {message.content}
      </div>
    </div>
  )
})

// AI 消息
const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast
}: {
  message: KiloMessage
  isLast?: boolean
}) {
  // 从 blocks 或 toolCalls 构建显示内容
  const hasBlocks = message.blocks && message.blocks.length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  
  return (
    <div
      className="assistant-message"
      style={{
        display: 'flex',
        gap: '12px',
        margin: '16px 0'
      }}
    >
      {/* 头像 */}
      <div
        className="avatar"
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#3b82f6',
          flexShrink: 0
        }}
      >
        <Bot size={18} />
      </div>
      
      {/* 内容区域 */}
      <div style={{ flex: 1, maxWidth: 'calc(100% - 44px)' }}>
        {/* 消息头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.5)'
          }}
        >
          <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>
            AI
          </span>
          {message.isStreaming && (
            <span className="streaming-indicator">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          )}
        </div>
        
        {/* 内容块 */}
        {hasBlocks ? (
          <div className="content-blocks">
            {message.blocks!.map((block) => (
              <ContentBlockRenderer key={block.id} block={block} />
            ))}
          </div>
        ) : hasToolCalls ? (
          // 向后兼容：从 toolCalls 渲染
          <div className="legacy-tool-calls">
            {message.toolCalls!.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                result={tc.result}
                error={tc.error}
              />
            ))}
            {message.content && (
              <div className="message-content">
                <MarkdownRenderer content={message.content} />
              </div>
            )}
          </div>
        ) : (
          // 纯文本消息
          <div className="message-content">
            <MarkdownRenderer content={message.content} />
          </div>
        )}
        
        {/* 流式光标 */}
        {message.isStreaming && isLast && (
          <span
            className="cursor"
            style={{
              display: 'inline-block',
              width: '2px',
              height: '1.2em',
              backgroundColor: '#3b82f6',
              marginLeft: '2px',
              animation: 'blink 1s infinite'
            }}
          />
        )}
      </div>
    </div>
  )
})

// 主组件
export const StreamingMessage = memo(function StreamingMessage({
  message,
  isLast
}: StreamingMessageProps) {
  if (message.role === 'user') {
    return <UserMessage message={message} />
  }
  
  return <AssistantMessage message={message} isLast={isLast} />
})

export default StreamingMessage
