/**
 * BuilderMessageSimple - 简化版 Builder 消息组件
 * 参考现代 AI 编码工具（Cursor、Claude Desktop）的设计风格
 * 特点：
 * 1. 简洁明了的消息展示
 * 2. 正确的 Markdown 渲染
 * 3. 工具调用以时间线方式展示
 * 4. 思考过程可折叠
 * 5. 无闪烁、无重复渲染
 */

import { useState, memo } from 'react'
import type { Message } from '../store'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCallTimeline } from './ToolCallTimeline'
import { 
  Loader2, 
  ChevronDown,
  ChevronRight,
  Brain,
  Sparkles,
  Bot
} from 'lucide-react'

interface BuilderMessageSimpleProps {
  message: Message
  onContinue?: () => void
  onStop?: () => void
}

// 思考过程折叠面板
const ThinkingCollapsible = memo(function ThinkingCollapsible({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 提取 thinking 标签内容
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/think>/)
  const thinkingContent = thinkingMatch ? thinkingMatch[1].trim() : ''

  if (!thinkingContent) return null

  return (
    <div className="thinking-collapsible">
      <button 
        className="thinking-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Brain size={14} />
        <span>思考过程</span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isExpanded && (
        <div className="thinking-content">
          <MarkdownRenderer content={thinkingContent} />
        </div>
      )}
    </div>
  )
})

// 清理内容中的内部数据
function cleanContent(content: string): string {
  if (!content) return ''
  
  let cleaned = content
  
  // 移除 thinking 标签（但保留内容用于上面的提取）
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/think>/g, '')
  
  // 移除工具调用 JSON 代码块
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

// 主组件
export const BuilderMessageSimple = memo(function BuilderMessageSimple({ 
  message, 
  onContinue, 
  onStop 
}: BuilderMessageSimpleProps) {
  // 清理内容
  const cleanedContent = cleanContent(message.content)
  
  // 检查是否有工具调用
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  
  // 检查是否有思考过程
  const hasThinking = message.content.includes('<thinking>')

  return (
    <div className={`builder-message-simple ${message.isStreaming ? 'streaming' : ''}`}>
      {/* 头部：AI 标签 */}
      <div className="builder-header-simple">
        <div className="builder-badge-simple">
          <Bot size={14} />
          <span>AI</span>
        </div>
      </div>

      {/* 工具调用时间线 */}
      {hasToolCalls && (
        <ToolCallTimeline toolCalls={message.toolCalls || []} />
      )}

      {/* 思考过程（可折叠） */}
      {hasThinking && (
        <ThinkingCollapsible content={message.content} />
      )}

      {/* 消息内容 */}
      <div className="builder-content-simple">
        {cleanedContent ? (
          <MarkdownRenderer content={cleanedContent} />
        ) : message.isStreaming ? (
          <div className="streaming-indicator">
            <Loader2 size={16} className="spinning" />
            <span>思考中...</span>
          </div>
        ) : null}
      </div>

      {/* 流式指示器 */}
      {message.isStreaming && (
        <div className="streaming-cursor">▊</div>
      )}
    </div>
  )
})

export default BuilderMessageSimple
