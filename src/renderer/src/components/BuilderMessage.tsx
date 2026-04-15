import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../store'
import { CodeBlock } from './CodeBlock'
import { ThinkingPanel } from './ThinkingPanel'
import { TimeoutPrompt } from './TimeoutPrompt'

interface BuilderMessageProps {
  message: Message
  onContinue?: () => void
  onStop?: () => void
}

// Builder标签组件
function BuilderBadge() {
  return (
    <div className="builder-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="9" y1="9" x2="15" y2="9"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
      <span>Builder</span>
    </div>
  )
}

// 解析消息内容，提取思考过程和代码块
function parseMessageContent(content: string) {
  const thinkingSteps: Array<{
    type: 'search' | 'analysis' | 'code' | 'command' | 'result'
    title: string
    content?: string
    filePath?: string
    language?: string
    lineNumbers?: boolean
  }> = []
  
  let mainContent = content
  
  // 提取代码块
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || 'text'
    const code = match[2]
    
    // 尝试提取文件路径（通常在代码块前的注释或文本中）
    const beforeText = content.substring(Math.max(0, match.index - 200), match.index)
    const filePathMatch = beforeText.match(/([\w\-]+\/)+[\w\-]+\.\w+/)
    const filePath = filePathMatch ? filePathMatch[0] : undefined
    
    thinkingSteps.push({
      type: 'code',
      title: filePath ? `问题找到了！在 ${filePath}` : '代码',
      content: code,
      filePath,
      language,
      lineNumbers: true
    })
  }
  
  // 提取搜索操作
  const searchRegex = /在工作区搜索 ['"]([^'"]+)['"]/g
  while ((match = searchRegex.exec(content)) !== null) {
    thinkingSteps.push({
      type: 'search',
      title: `在工作区搜索 '${match[1]}'`,
    })
  }
  
  // 提取终端命令
  const commandRegex = /\$ (.+)/g
  while ((match = commandRegex.exec(content)) !== null) {
    thinkingSteps.push({
      type: 'command',
      title: '执行命令',
      content: match[1]
    })
  }
  
  return { thinkingSteps, mainContent }
}

export function BuilderMessage({ message, onContinue, onStop }: BuilderMessageProps) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true)
  const { thinkingSteps, mainContent } = parseMessageContent(message.content)
  
  const hasThinkingSteps = thinkingSteps.length > 0
  const isTimeout = message.content.includes('请求超时') || message.content.includes('timeout')
  
  return (
    <div className="builder-message">
      {/* Builder标签 */}
      <div className="builder-message-header">
        <BuilderBadge />
      </div>
      
      {/* 思考过程面板 */}
      {hasThinkingSteps && (
        <div className="builder-thinking-section">
          <div 
            className="builder-thinking-toggle"
            onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
          >
            <svg 
              width="12" 
              height="12" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className={`builder-toggle-icon ${isThinkingExpanded ? 'expanded' : ''}`}
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span>思考过程</span>
            <span className="builder-thinking-count">{thinkingSteps.length} 个步骤</span>
          </div>
          
          {isThinkingExpanded && (
            <div className="builder-thinking-content">
              <ThinkingPanel steps={thinkingSteps} />
            </div>
          )}
        </div>
      )}
      
      {/* 消息内容 */}
      <div className="builder-message-content">
        {/* 渲染代码块 */}
        {thinkingSteps.filter(s => s.type === 'code').map((step, idx) => (
          <CodeBlock
            key={idx}
            code={step.content || ''}
            language={step.language || 'typescript'}
            filePath={step.filePath}
            showLineNumbers={step.lineNumbers}
          />
        ))}
        
        {/* 渲染其他内容（使用 ReactMarkdown 渲染 Markdown） */}
        <div className="builder-text-content markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => {
                // 高亮文件路径
                const text = String(children)
                const filePathRegex = /([\w\-]+\/)+[\w\-]+\.\w+/g
                const parts = text.split(filePathRegex)
                const matches = text.match(filePathRegex) || []
                
                if (matches.length === 0) {
                  return <p>{children}</p>
                }
                
                return (
                  <p>
                    {parts.map((part, i) => (
                      <span key={i}>
                        {part}
                        {matches[i] && (
                          <span className="file-path-highlight">{matches[i]}</span>
                        )}
                      </span>
                    ))}
                  </p>
                )
              },
              table: ({ children }) => (
                <div className="markdown-table-wrapper">
                  <table className="markdown-table">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="markdown-table-head">{children}</thead>,
              tbody: ({ children }) => <tbody className="markdown-table-body">{children}</tbody>,
              tr: ({ children }) => <tr className="markdown-table-row">{children}</tr>,
              th: ({ children }) => <th className="markdown-table-header">{children}</th>,
              td: ({ children }) => <td className="markdown-table-cell">{children}</td>
            }}
          >
            {mainContent.replace(/```[\s\S]*?```/g, '')}
          </ReactMarkdown>
        </div>
      </div>
      
      {/* 超时提示 */}
      {isTimeout && onContinue && (
        <TimeoutPrompt onContinue={onContinue} onStop={onStop} />
      )}
      
      {/* 消息操作按钮 */}
      <div className="builder-message-actions">
        <button className="builder-action-btn" title="复制">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button className="builder-action-btn" title="重新生成">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        <button className="builder-action-btn" title="点赞">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
        <button className="builder-action-btn" title="点踩">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default BuilderMessage
