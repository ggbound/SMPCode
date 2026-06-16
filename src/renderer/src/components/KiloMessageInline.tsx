/**
 * Kilo Code 风格聊天消息组件 - 内联工具调用版本
 * 参考: https://kilocode.ai
 * 
 * 核心特性:
 * - 工具调用内联在内容流中显示
 * - 消息由多个内容块组成（文本、工具调用交错）
 * - 实时流式更新
 */

import { memo, useState } from 'react'
import { 
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  FileText,
  FileEdit,
  Search,
  FolderTree,
  Terminal,
  Globe,
  HelpCircle,
  GitPullRequest,
  Wrench,
  Copy,
  Check,
  Hash
} from 'lucide-react'
import { KiloToolCall, TOOL_CONFIG } from '../types/agent'
import type { KiloMessage as KiloMessageType, ContentBlock, TextBlock, ToolCallBlock } from '../store/kiloStore'
import { MarkdownRenderer } from './MarkdownRenderer'

interface KiloMessageInlineProps {
  message: KiloMessageType
  isLast?: boolean
  onOpenUrl?: (url: string) => void
}

import type { LucideIcon } from 'lucide-react'

// 工具图标映射
const toolIconMap: Record<string, LucideIcon> = {
  FileText,
  FileEdit,
  Search,
  FolderTree,
  Terminal,
  Globe,
  HelpCircle,
  CheckCircle2,
  GitPullRequest,
  Wrench
}

// 内联工具调用卡片
const InlineToolCallCard = memo(function InlineToolCallCard({ 
  toolCall,
  isExpanded: initialExpanded = false
}: { 
  toolCall: KiloToolCall
  isExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const config = TOOL_CONFIG[toolCall.name] || {
    label: toolCall.name,
    icon: 'Wrench',
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.1)',
    borderColor: 'rgba(107, 114, 128, 0.3)',
    description: toolCall.name
  }

  const Icon = toolIconMap[config.icon] || Wrench

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'completed':
        return <CheckCircle2 size={12} className="kilo-inline-tool-status success" />
      case 'failed':
        return <XCircle size={12} className="kilo-inline-tool-status error" />
      default:
        return <Clock size={12} className="kilo-inline-tool-status pending" />
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // 获取参数摘要 - 简化显示，只显示路径
  const getArgsSummary = () => {
    const args = toolCall.args || {}
    // 只显示路径类参数
    const path = args.path || args.file_path || args.directory || args.filePath
    if (path && typeof path === 'string') {
      const shortPath = path.length > 30 
        ? '...' + path.slice(-30) 
        : path
      return shortPath
    }
    return ''
  }

  const argsSummary = getArgsSummary()

  return (
    <div 
      className={`kilo-inline-tool-card ${toolCall.status}`}
      style={{
        '--tool-color': config.color,
        '--tool-bg': config.bgColor,
        '--tool-border': config.borderColor
      } as React.CSSProperties}
    >
      <div className="kilo-inline-tool-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="kilo-inline-tool-main">
          <div className="kilo-inline-tool-icon" style={{ color: config.color }}>
            <Icon size={14} />
          </div>
          <div className="kilo-inline-tool-info">
            <span className="kilo-inline-tool-name" style={{ color: config.color }}>
              {config.label}
            </span>
            {argsSummary && (
              <span className="kilo-inline-tool-args" title={argsSummary}>
                {argsSummary}
              </span>
            )}
          </div>
        </div>
        <div className="kilo-inline-tool-meta">
          {toolCall.duration && toolCall.status !== 'running' && (
            <span className="kilo-inline-tool-duration">{formatDuration(toolCall.duration)}</span>
          )}
          {getStatusIcon()}
        </div>
      </div>

      {isExpanded && (
        <div className="kilo-inline-tool-details">
          {toolCall.args && Object.keys(toolCall.args).length > 0 && (
            <div className="kilo-inline-tool-section">
              <span className="kilo-inline-tool-section-title">参数</span>
              <pre className="kilo-inline-tool-args-detail">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div className="kilo-inline-tool-section">
              <span className="kilo-inline-tool-section-title">结果</span>
              <pre className="kilo-inline-tool-result">
                {typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div className="kilo-inline-tool-section">
              <span className="kilo-inline-tool-section-title error">错误</span>
              <pre className="kilo-inline-tool-error">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// 文本内容块
const TextBlockComponent = memo(function TextBlockComponent({ 
  content,
  isStreaming,
  onOpenUrl
}: { 
  content: string
  isStreaming?: boolean
  onOpenUrl?: (url: string) => void
}) {
  if (!content.trim()) return null
  
  return (
    <div className="kilo-text-block">
      <MarkdownRenderer content={content} onLinkClick={onOpenUrl} />
    </div>
  )
})

// 内容块渲染器
const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  isLast,
  isStreaming,
  onOpenUrl
}: {
  block: ContentBlock
  isLast?: boolean
  isStreaming?: boolean
  onOpenUrl?: (url: string) => void
}) {
  switch (block.type) {
    case 'text':
      return <TextBlockComponent content={(block as TextBlock).content} isStreaming={isStreaming} onOpenUrl={onOpenUrl} />
    
    case 'tool_call':
      return <InlineToolCallCard toolCall={(block as ToolCallBlock).toolCall} />
    
    case 'thinking':
      return (
        <div className="kilo-thinking-block">
          <Sparkles size={14} />
          <span>思考中...</span>
        </div>
      )
    
    default:
      return null
  }
})

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

// 格式化 Token 数量
function formatTokens(tokens?: number): string {
  if (!tokens || tokens === 0) return ''
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return tokens.toString()
}

// 消息工具栏组件
const MessageToolbar = memo(function MessageToolbar({ 
  message
}: { 
  message: KiloMessageType
}) {
  const [copied, setCopied] = useState(false)
  
  // 从 message 中提取完整内容（优先使用 content，否则从 blocks 拼接）
  // 处理统一的 content 格式：string | MessageContentPart[]
  const getFullContent = (): string => {
    // 如果有直接的 content，优先使用
    if (message.content) {
      if (typeof message.content === 'string') {
        // 纯文本消息
        return message.content.trim() || ''
      } else {
        // 多模态消息（数组格式）- 提取文本内容
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('\n\n')
          .trim()
      }
    }
    
    // 否则从 blocks 拼接内容
    if (message.blocks && message.blocks.length > 0) {
      return message.blocks
        .filter(b => b.type === 'text')
        .map(b => (b as TextBlock).content)
        .join('\n\n')
    }
    
    return ''
  }
  
  const handleCopy = async () => {
    try {
      const fullContent = getFullContent()
      await navigator.clipboard.writeText(fullContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  const timeStr = formatTime(message.timestamp)
  const inputTokens = formatTokens(message.usage?.inputTokens)
  const outputTokens = formatTokens(message.usage?.outputTokens)
  
  // 只有 AI 消息显示工具栏
  if (message.role !== 'assistant') return null
  
  return (
    <div className="kilo-message-toolbar">
      {/* 复制按钮 */}
      <button 
        className="kilo-toolbar-btn"
        onClick={handleCopy}
        title="复制内容"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
      
      {/* Token 使用情况 */}
      {(inputTokens || outputTokens) && (
        <div className="kilo-toolbar-info" title="Token 使用情况">
          <Hash size={12} />
          <span>
            {inputTokens && `${inputTokens} in`}
            {inputTokens && outputTokens && ' / '}
            {outputTokens && `${outputTokens} out`}
          </span>
        </div>
      )}
      
      {/* 消息时间 */}
      {timeStr && (
        <div className="kilo-toolbar-info" title="消息时间">
          <Clock size={12} />
          <span>{timeStr}</span>
        </div>
      )}
    </div>
  )
})

// 主消息组件 - 简洁左右布局，无头像无标识
export const KiloMessageInline = memo(function KiloMessageInline({ 
  message, 
  isLast,
  onOpenUrl
}: KiloMessageInlineProps) {
  const isUser = message.role === 'user'
  
  // 使用 blocks 或从 content/toolCalls 构建 blocks
  const blocks: ContentBlock[] = message.blocks || []
  
  // 如果没有 blocks，从 content 构建
  // 处理统一的 content 格式：string | MessageContentPart[]
  if (blocks.length === 0 && message.content) {
    if (typeof message.content === 'string') {
      // 纯文本消息
      blocks.push({
        id: `text-${message.timestamp}`,
        type: 'text',
        content: message.content,
        timestamp: message.timestamp
      })
    } else {
      // 多模态消息（数组格式）
      // 提取所有文本内容并合并
      const textContent = message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('\n\n')
      
      if (textContent.trim()) {
        blocks.push({
          id: `text-${message.timestamp}`,
          type: 'text',
          content: textContent,
          timestamp: message.timestamp
        })
      }
    }
  }
  
  // 如果有 toolCalls 但没有对应的 blocks，添加它们
  if (message.toolCalls && message.toolCalls.length > 0) {
    message.toolCalls.forEach((tc: KiloToolCall) => {
      const existingBlock = blocks.find(b => 
        b.type === 'tool_call' && (b as ToolCallBlock).toolCall.id === tc.id
      )
      if (!existingBlock) {
        blocks.push({
          id: `tool-${tc.id}`,
          type: 'tool_call',
          toolCall: tc,
          timestamp: tc.timestamp
        })
      }
    })
    // 按时间戳排序
    blocks.sort((a, b) => a.timestamp - b.timestamp)
  }
  
  // 是否显示工具栏（非流式状态且是 AI 消息）
  const showToolbar = !message.isStreaming && message.role === 'assistant' && message.content

  return (
    <div className={`kilo-message-simple ${isUser ? 'user' : 'assistant'} ${message.isStreaming ? 'streaming' : ''}`}>
      {/* 用户消息的图片显示 - 优先从 images 字段获取，其次从 content 数组中提取 */}
      {isUser && message.images && message.images.length > 0 && (
        <div className="kilo-message-images">
          {message.images.map((image, index) => (
            <div key={index} className="kilo-message-image-item">
              <img 
                src={image.data} 
                alt={image.name || 'uploaded image'}
                className="kilo-message-image"
              />
            </div>
          ))}
        </div>
      )}
      
      {/* 消息内容 - 直接渲染，无包裹 */}
      {blocks.length > 0 ? (
        <div className="kilo-content-blocks">
          {blocks.map((block, index) => (
            <ContentBlockRenderer
              key={block.id}
              block={block}
              isLast={isLast && index === blocks.length - 1}
              isStreaming={message.isStreaming}
              onOpenUrl={onOpenUrl}
            />
          ))}
          {message.isStreaming && isLast && (
            <span className="kilo-cursor">▋</span>
          )}
        </div>
      ) : message.isStreaming ? (
        <div className="kilo-streaming-placeholder">
          <Loader2 size={16} className="kilo-spin" />
          <span>思考中...</span>
        </div>
      ) : null}
      
      {/* 消息工具栏 - 始终显示用于测试 */}
      {message.role === 'assistant' && (
        <MessageToolbar message={message} />
      )}
    </div>
  )
})

export default KiloMessageInline
