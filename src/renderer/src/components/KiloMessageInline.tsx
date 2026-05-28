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
  Wrench
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
  if (blocks.length === 0 && message.content) {
    blocks.push({
      id: `text-${message.timestamp}`,
      type: 'text',
      content: message.content,
      timestamp: message.timestamp
    })
  }
  
  // 如果有 toolCalls 但没有对应的 blocks，添加它们
  if (message.toolCalls && message.toolCalls.length > 0) {
    message.toolCalls.forEach((tc) => {
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

  return (
    <div className={`kilo-message-simple ${isUser ? 'user' : 'assistant'} ${message.isStreaming ? 'streaming' : ''}`}>
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
    </div>
  )
})

export default KiloMessageInline
