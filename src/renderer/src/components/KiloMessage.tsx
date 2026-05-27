/**
 * Kilo Code 风格聊天消息组件
 * 参考: https://kilocode.ai
 * 
 * 特点:
 * - 简洁的消息头部（AI标识 + 模式标签）
 * - 彩色工具调用卡片
 * - 流式打字效果
 * - 可折叠的思考过程
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { 
  Bot, 
  User, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
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
  Code2,
  Compass,
  Bug,
  MessageCircle
} from 'lucide-react'
import { KiloToolCall, MessageBlock, TOOL_CONFIG, AgentMode, AGENT_MODE_CONFIGS } from '../types/agent'
import type { KiloMessage as KiloMessageType } from '../store/kiloStore'
import { MarkdownRenderer } from './MarkdownRenderer'

interface KiloMessageProps {
  message: KiloMessageType
  isLast?: boolean
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
  GitPullRequest
}

// 模式图标映射
const modeIconMap: Record<AgentMode, LucideIcon> = {
  code: Code2,
  architect: Compass,
  debug: Bug,
  ask: MessageCircle,
  custom: Sparkles
}

// 打字机效果 Hook
function useTypewriter(content: string, isStreaming: boolean, speed: number = 8) {
  const [displayed, setDisplayed] = useState(content)

  useEffect(() => {
    setDisplayed(content)
  }, [content])

  return displayed
}

// 工具调用卡片
const ToolCallCard = memo(function ToolCallCard({ 
  toolCall,
  index 
}: { 
  toolCall: KiloToolCall
  index: number 
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const config = TOOL_CONFIG[toolCall.name] || {
    label: toolCall.name,
    icon: 'FileText',
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.1)',
    borderColor: 'rgba(107, 114, 128, 0.3)',
    description: toolCall.name
  }

  const Icon = toolIconMap[config.icon] || FileText

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'running':
        return <Loader2 size={14} className="kilo-tool-status-icon spinning" />
      case 'completed':
        return <CheckCircle2 size={14} className="kilo-tool-status-icon success" />
      case 'failed':
        return <XCircle size={14} className="kilo-tool-status-icon error" />
      default:
        return <Clock size={14} className="kilo-tool-status-icon pending" />
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div 
      className={`kilo-tool-card ${toolCall.status}`}
      style={{
        '--tool-color': config.color,
        '--tool-bg': config.bgColor,
        '--tool-border': config.borderColor
      } as React.CSSProperties}
    >
      <div className="kilo-tool-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="kilo-tool-main">
          <div className="kilo-tool-icon">
            <Icon size={14} />
          </div>
          <div className="kilo-tool-info">
            <span className="kilo-tool-name">{config.label}</span>
            <span className="kilo-tool-desc">{config.description}</span>
          </div>
        </div>
        <div className="kilo-tool-meta">
          {toolCall.duration && (
            <span className="kilo-tool-duration">{formatDuration(toolCall.duration)}</span>
          )}
          {getStatusIcon()}
          <button className="kilo-tool-expand">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="kilo-tool-details">
          {toolCall.args && Object.keys(toolCall.args).length > 0 && (
            <div className="kilo-tool-section">
              <span className="kilo-tool-section-title">参数</span>
              <pre className="kilo-tool-args">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div className="kilo-tool-section">
              <span className="kilo-tool-section-title">结果</span>
              <pre className="kilo-tool-result">
                {typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div className="kilo-tool-section">
              <span className="kilo-tool-section-title error">错误</span>
              <pre className="kilo-tool-error">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// 消息块组件
const MessageBlockComponent = memo(function MessageBlockComponent({ 
  block 
}: { 
  block: MessageBlock 
}) {
  const [isExpanded, setIsExpanded] = useState(true)

  switch (block.type) {
    case 'thinking':
      return (
        <div className="kilo-block-thinking">
          <button className="kilo-block-header" onClick={() => setIsExpanded(!isExpanded)}>
            <Sparkles size={14} />
            <span>思考过程</span>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {isExpanded && (
            <div className="kilo-block-content">
              <MarkdownRenderer content={block.content} />
            </div>
          )}
        </div>
      )
    case 'code':
      return (
        <div className="kilo-block-code">
          <MarkdownRenderer content={block.content} />
        </div>
      )
    default:
      return (
        <div className="kilo-block-text">
          <MarkdownRenderer content={block.content} />
        </div>
      )
  }
})

// 主消息组件
export const KiloMessage = memo(function KiloMessage({ 
  message, 
  isLast 
}: KiloMessageProps) {
  const isUser = message.role === 'user'
  const modeConfig = AGENT_MODE_CONFIGS[message.mode || 'code']
  const ModeIcon = modeIconMap[message.mode || 'code']
  
  const displayedContent = useTypewriter(
    message.content, 
    (message.isStreaming ?? false) && (isLast ?? false), 
    5
  )

  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0

  return (
    <div className={`kilo-message ${isUser ? 'user' : 'assistant'} ${message.isStreaming ? 'streaming' : ''}`}>
      {/* 消息头部 */}
      <div className="kilo-message-header">
        {isUser ? (
          <>
            <div className="kilo-avatar user">
              <User size={16} />
            </div>
            <span className="kilo-author">你</span>
          </>
        ) : (
          <>
            <div className="kilo-avatar assistant" style={{ '--mode-color': modeConfig.color } as React.CSSProperties}>
              <Bot size={16} />
            </div>
            <span className="kilo-author">AI</span>
            <div className="kilo-mode-badge" style={{ '--mode-color': modeConfig.color } as React.CSSProperties}>
              <ModeIcon size={12} />
              <span>{modeConfig.name}</span>
            </div>
            {message.isStreaming && (
              <div className="kilo-typing-indicator">
                <span className="kilo-dot" />
                <span className="kilo-dot" />
                <span className="kilo-dot" />
              </div>
            )}
          </>
        )}
      </div>

      {/* 消息内容 */}
      <div className="kilo-message-body">
        {/* 思考过程 */}
        {message.reasoning && (
          <div className="kilo-reasoning">
            <div className="kilo-reasoning-header">
              <Sparkles size={14} />
              <span>思考过程</span>
            </div>
            <div className="kilo-reasoning-content">
              <MarkdownRenderer content={message.reasoning} />
            </div>
          </div>
        )}

        {/* 主内容 */}
        {displayedContent && (
          <div className="kilo-message-content">
            <MarkdownRenderer content={displayedContent} />
            {message.isStreaming && isLast && (
              <span className="kilo-cursor">▋</span>
            )}
          </div>
        )}

        {/* 流式加载状态 */}
        {message.isStreaming && !displayedContent && (
          <div className="kilo-streaming-placeholder">
            <Loader2 size={16} className="kilo-spin" />
            <span>思考中...</span>
          </div>
        )}

        {/* 工具调用面板 - 显示在内容下方 */}
        {hasToolCalls && message.toolCalls && (
          <div className="kilo-tools-panel">
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
