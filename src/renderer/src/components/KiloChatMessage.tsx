/**
 * KiloChatMessage - 参考 Kilo Code 设计风格的聊天消息组件
 * 特点：
 * 1. 极简设计 - 清晰的视觉层次
 * 2. 工具调用卡片 - 彩色状态指示
 * 3. 流式打字效果 - 实时响应反馈
 * 4. 代码块优化 - 语法高亮、行号、复制
 */

import { useState, useEffect, memo } from 'react'
import type { Message, ToolCall } from '../store'
import { MarkdownRenderer } from './MarkdownRenderer'
import { 
  Bot,
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
  Clock,
  Wrench,
  Zap,
  Code2,
  Copy,
  Check,
  Eye,
  Globe,
  Bell,
  List,
  Trash,
  Folder,
  File
} from 'lucide-react'

interface KiloChatMessageProps {
  message: Message
  onContinue?: () => void
  onStop?: () => void
}

// 工具配置 - Kilo 风格配色
const toolConfig: Record<string, { 
  icon: React.ReactNode
  label: string
  color: string
  bgColor: string
}> = {
  'read_file': { 
    icon: <Eye size={14} />, 
    label: '查看',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)'
  },
  'write_file': { 
    icon: <PlusCircle size={14} />, 
    label: '创建',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.1)'
  },
  'edit_file': { 
    icon: <Edit3 size={14} />, 
    label: '编辑',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)'
  },
  'delete_file': { 
    icon: <Trash2 size={14} />, 
    label: '删除',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.1)'
  },
  'list_directory': { 
    icon: <FolderOpen size={14} />, 
    label: '列出',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)'
  },
  'search_files': {  // ✅ 修复：使用正确的工具名称
    icon: <Search size={14} />, 
    label: '搜索',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)'
  },
  'execute_bash': { 
    icon: <Terminal size={14} />, 
    label: '执行',
    color: '#ec4899',
    bgColor: 'rgba(236, 72, 153, 0.1)'
  },
  'append_file': { 
    icon: <Edit3 size={14} />, 
    label: '追加',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)'
  },
  'browse_website': { 
    icon: <Globe size={14} />, 
    label: '浏览网页',
    color: '#0ea5e9',
    bgColor: 'rgba(14, 165, 233, 0.1)'
  },
  'add_reminder': { 
    icon: <Bell size={14} />, 
    label: '添加提醒',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)'
  },
  'list_reminders': { 
    icon: <List size={14} />, 
    label: '提醒列表',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)'
  },
  'remove_reminder': { 
    icon: <Trash size={14} />, 
    label: '删除提醒',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.1)'
  }
}

// 获取工具信息
function getToolInfo(toolName: string) {
  return toolConfig[toolName] || { 
    icon: <Wrench size={14} />, 
    label: toolName,
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.1)'
  }
}

// 格式化路径或 URL
function formatPath(path: string): string {
  if (!path) return ''
  // 如果是 URL，显示域名部分
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const url = new URL(path)
      return url.hostname
    } catch {
      return path
    }
  }
  const parts = path.split('/')
  if (parts.length > 4) {
    return parts.slice(-4).join('/')
  }
  return path
}

// 工具调用卡片 - Kilo 风格
const ToolCallCard = memo(function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  // 防御性检查：确保 toolCall 格式正确
  if (!toolCall || typeof toolCall.name !== 'string') {
    return null
  }
  
  const config = getToolInfo(toolCall.name)
  const path = toolCall.args?.path || toolCall.args?.file_path || toolCall.args?.directory || toolCall.args?.command || toolCall.args?.url || ''
  const [showResult, setShowResult] = useState(false)
  
  // 格式化工具结果用于显示
  const formatResult = (result: string | undefined): string => {
    if (!result) return ''
    try {
      // 尝试解析 JSON 并格式化
      const parsed = JSON.parse(result)
      if (Array.isArray(parsed)) {
        // 目录列表等数组结果
        return parsed.map(item => {
          if (typeof item === 'object' && item.name) {
            return item.isDirectory ? `[DIR] ${item.name}` : `[FILE] ${item.name}`
          }
          return String(item)
        }).join('\n')
      }
      return JSON.stringify(parsed, null, 2)
    } catch {
      // 如果不是 JSON，直接返回
      return result
    }
  }
  
  const hasResult = toolCall.status === 'completed' && toolCall.result
  const hasError = toolCall.status === 'failed'
  
  return (
    <div 
      className="kilo-tool-card"
      style={{ 
        borderColor: config.color,
        backgroundColor: config.bgColor,
        flexDirection: 'column',
        alignItems: 'stretch'
      }}
    >
      <div className="kilo-tool-card-main" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="kilo-tool-card-left" style={{ flex: 1 }}>
          <div 
            className="kilo-tool-icon"
            style={{ color: config.color }}
          >
            {config.icon}
          </div>
          <div className="kilo-tool-info">
            <span 
              className="kilo-tool-label"
              style={{ color: config.color }}
            >
              {config.label}
            </span>
            {path && (
              <span className="kilo-tool-path">
                {formatPath(path)}
              </span>
            )}
          </div>
        </div>
        <div className="kilo-tool-status" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {hasResult && (
            <button
              onClick={() => setShowResult(!showResult)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                color: config.color,
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255,255,255,0.1)'
              }}
            >
              {showResult ? '隐藏结果' : '查看结果'}
            </button>
          )}
          {toolCall.status === 'running' && (
            <Loader2 size={14} className="kilo-spin" style={{ color: config.color }} />
          )}
          {toolCall.status === 'completed' && (
            <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
          )}
          {toolCall.status === 'failed' && (
            <XCircle size={14} style={{ color: '#ef4444' }} />
          )}
        </div>
      </div>
      
      {/* 工具执行结果 */}
      {showResult && hasResult && (
        <div 
          className="kilo-tool-result"
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            backgroundColor: 'rgba(0,0,0,0.2)',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '300px',
            overflow: 'auto',
            color: '#e2e8f0'
          }}
        >
          {formatResult(toolCall.result)}
        </div>
      )}
      
      {/* 错误信息 */}
      {hasError && toolCall.result && (
        <div 
          className="kilo-tool-error"
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#ef4444'
          }}
        >
          {toolCall.result}
        </div>
      )}
    </div>
  )
})

// 工具调用面板
const ToolCallPanel = memo(function ToolCallPanel({ toolCalls }: { toolCalls: ToolCall[] }) {
  // 过滤掉格式不正确的 toolCalls
  const validToolCalls = toolCalls?.filter(tc => tc && typeof tc.name === 'string') || []
  if (validToolCalls.length === 0) return null

  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="kilo-tool-panel">
      <button 
        className="kilo-tool-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="kilo-tool-panel-title">
          <Zap size={14} />
          <span>工具调用</span>
          <span className="kilo-tool-count">{validToolCalls.length}</span>
        </div>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isExpanded && (
        <div className="kilo-tool-panel-content">
          {validToolCalls.map((toolCall) => (
            <ToolCallCard key={toolCall.id || Math.random().toString()} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  )
})

// 打字机效果 Hook
function useTypewriter(content: string, isStreaming: boolean, speed: number = 10) {
  const [displayed, setDisplayed] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!isStreaming) {
      setDisplayed(content)
      return
    }

    if (index < content.length) {
      const timer = setTimeout(() => {
        setDisplayed(content.slice(0, index + 1))
        setIndex(index + 1)
      }, speed)
      return () => clearTimeout(timer)
    }
  }, [content, isStreaming, index, speed])

  useEffect(() => {
    if (content !== displayed && !isStreaming) {
      setDisplayed(content)
      setIndex(content.length)
    }
  }, [content])

  return displayed
}

// 清理内容
function cleanContent(content: string): string {
  if (!content) return ''
  
  let cleaned = content
  
  // 移除 thinking 标签
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/think>/g, '')
  
  // 移除工具调用 JSON
  cleaned = cleaned.replace(/```json\s*\n?\s*\{\s*"tool"[\s\S]*?```/gi, '')
  cleaned = cleaned.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi, '')
  
  // 移除工具调用标记
  cleaned = cleaned.replace(/\*\*正在调用工具：\*\*\s*\w+\n?/gi, '')
  cleaned = cleaned.replace(/\*\*工具执行结果：\*\*[\s\S]*?(?=\n\n|$)/gi, '')
  cleaned = cleaned.replace(/\*\*工具执行失败：\*\*[\s\S]*?(?=\n\n|$)/gi, '')
  
  // 清理多余空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  
  return cleaned.trim()
}

// 从 messageSteps 提取工具调用
function extractToolCallsFromSteps(messageSteps?: Array<{
  id: string
  type: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, any>
  toolResult?: {
    success: boolean
    output?: string
    error?: string
  }
}>): ToolCall[] {
  if (!messageSteps || messageSteps.length === 0) return []
  
  const toolCalls: ToolCall[] = []
  const toolCallSteps = messageSteps.filter(step => step.type === 'tool_call')
  
  for (const step of toolCallSteps) {
    if (step.toolName) {
      toolCalls.push({
        id: step.id,
        name: step.toolName,
        args: step.toolArgs || {},
        status: step.status,
        timestamp: step.timestamp,
        result: step.toolResult?.output || step.toolResult?.error
      })
    }
  }
  
  return toolCalls
}

// 格式化时间戳
 function formatTime(timestamp?: number): string {
   if (!timestamp) return ''
   const date = new Date(timestamp)
   return date.toLocaleTimeString('zh-CN', { 
     hour: '2-digit', 
     minute: '2-digit',
     second: '2-digit'
   })
 }

// 消息工具栏组件
const MessageToolbar = memo(function MessageToolbar({ 
  message,
  content
}: { 
  message: Message
  content: string 
}) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  const timeStr = formatTime(message.timestamp)
   
  return (
    <div className="kilo-message-toolbar">
      {/* 复制按钮 */}
      <button 
        className="kilo-toolbar-btn"
        onClick={handleCopy}
        title="复制内容"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
      
      {/* 消息时间 */}
      {timeStr && (
        <div className="kilo-toolbar-info" title="消息时间">
          <Clock size={14} />
          <span>{timeStr}</span>
        </div>
      )}
    </div>
  )
})

// 主组件
export const KiloChatMessage = memo(function KiloChatMessage({ 
  message, 
  onContinue, 
  onStop 
}: KiloChatMessageProps) {
  const cleaned = cleanContent(message.content)
  
  // 合并 toolCalls 和从 messageSteps 提取的工具调用
  const toolCallsFromSteps = extractToolCallsFromSteps(message.messageSteps)
  const allToolCalls = [...(message.toolCalls || []), ...toolCallsFromSteps]
  const hasTools = allToolCalls.length > 0
  
  // 打字机效果
  const displayedContent = useTypewriter(cleaned, message.isStreaming ?? false, 5)
  
  // 是否显示工具栏（非流式状态且是 AI 消息）
  const showToolbar = !message.isStreaming && message.role === 'assistant' && displayedContent

  return (
    <div className={`kilo-message ${message.isStreaming ? 'streaming' : ''}`}>
      {/* 头部 - AI 标识 */}
      <div className="kilo-message-header">
        <div className="kilo-avatar">
          <Bot size={16} />
        </div>
        <span className="kilo-author">AI</span>
        {message.isStreaming && (
          <span className="kilo-typing">
            <span className="kilo-dot" />
            <span className="kilo-dot" />
            <span className="kilo-dot" />
          </span>
        )}
      </div>

      {/* 工具调用面板 */}
      {hasTools && (
        <ToolCallPanel toolCalls={allToolCalls} />
      )}

      {/* 消息内容 */}
      <div className="kilo-message-content">
        {displayedContent ? (
          <MarkdownRenderer content={displayedContent} />
        ) : message.isStreaming ? (
          <div className="kilo-thinking">
            <Loader2 size={16} className="kilo-spin" />
            <span>思考中...</span>
          </div>
        ) : null}
      </div>

      {/* 消息工具栏 */}
      {showToolbar && (
        <MessageToolbar message={message} content={cleaned} />
      )}

      {/* 流式光标 */}
      {message.isStreaming && (
        <span className="kilo-cursor">▋</span>
      )}
    </div>
  )
})

export default KiloChatMessage
