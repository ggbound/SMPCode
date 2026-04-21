import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import type { Message, ToolCall } from '../store'
import { CodeBlock } from './CodeBlock'
import { ThinkingPanel } from './ThinkingPanel'
import { TimeoutPrompt } from './TimeoutPrompt'
import { IterationMessage } from './IterationMessage'
import { Loader2, CheckCircle, XCircle, FileText, Edit3, PlusCircle, FolderOpen, FileSearch, Terminal, Trash2 } from 'lucide-react'

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

// 检测是否为迭代消息
function isIterationMessage(content: string): boolean {
  // 检测简化格式的迭代消息
  const lines = content.trim().split('\n')
  if (lines.length >= 2) {
    const firstLine = lines[0].trim()
    // 匹配 "第 X 轮" 或 "完成" 或 "达到限制" 等
    if (firstLine.match(/^第\s*\d+\s*轮$/) || 
        firstLine === '完成' || 
        firstLine === '达到限制' ||
        firstLine.includes('响应截断') ||
        firstLine.includes('执行异常') ||
        firstLine.includes('等待工具调用')) {
      return true
    }
  }
  // 兼容旧格式
  return content.includes('第') && content.includes('轮') && 
         (content.includes('成功') || content.includes('失败') || content.includes('完成'))
}

// 工具描述映射（英文 → 中文描述）
const toolDescriptionMap: Record<string, string> = {
  'read_file': '读取指定文件的内容',
  'write_file': '创建或覆盖文件',
  'edit_file': '替换文件中的特定文本',
  'delete_file': '删除文件或目录',
  'list_directory': '列出目录中的文件和子目录',
  'search_code': '在代码库中搜索特定模式',
  'execute_bash': '执行 shell 命令',
  'append_file': '在文件末尾追加内容'
}

// 工具名称映射（英文 → 中文）
const toolNameMap: Record<string, string> = {
  'read_file': '读取文件',
  'write_file': '写入文件',
  'edit_file': '编辑文件',
  'delete_file': '删除文件',
  'list_directory': '列出目录',
  'search_code': '搜索代码',
  'execute_bash': '执行命令',
  'append_file': '追加文件'
}

// 获取工具图标
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return <FileText size={14} />
    case 'write_file':
      return <PlusCircle size={14} />
    case 'edit_file':
      return <Edit3 size={14} />
    case 'delete_file':
      return <Trash2 size={14} />
    case 'list_directory':
      return <FolderOpen size={14} />
    case 'search_code':
      return <FileSearch size={14} />
    case 'execute_bash':
      return <Terminal size={14} />
    case 'append_file':
      return <Edit3 size={14} />
    default:
      return <FileText size={14} />
  }
}

// 解析迭代消息
function parseIterationMessage(content: string) {
  const lines = content.trim().split('\n')
  const firstLine = lines[0]?.trim() || ''
  
  // 提取轮次
  let iteration = 1
  const iterationMatch = firstLine.match(/第\s*(\d+)\s*轮/)
  if (iterationMatch) {
    iteration = parseInt(iterationMatch[1])
  }
  
  // 检测状态
  const isFinal = firstLine === '完成' || content.includes('完成')
  const isError = firstLine.includes('异常') || firstLine.includes('截断') || firstLine.includes('限制')
  const isWaiting = firstLine.includes('等待')
  
  let status: 'running' | 'completed' | 'failed' = 'completed'
  if (isError) status = 'failed'
  else if (isWaiting) status = 'running'
  
  // 提取成功/总数
  let successCount = 0
  let totalCount = 0
  const countMatch = content.match(/(\d+)\s*\/\s*(\d+)\s*成功/)
  if (countMatch) {
    successCount = parseInt(countMatch[1])
    totalCount = parseInt(countMatch[2])
  }
  
  // 提取工具结果
  const toolResults: Array<{tool: string, result: {success: boolean, output?: string, error?: string}, description?: string}> = []
  const toolMatches = content.matchAll(/[✓✅✔]\s*(\w+)|[✗❌✖]\s*(\w+)/g)
  for (const match of toolMatches) {
    const tool = match[1] || match[2]
    const isSuccess = match[0].includes('✓') || match[0].includes('✅') || match[0].includes('✔')
    if (tool) {
      toolResults.push({
        tool,
        result: { success: isSuccess },
        description: toolDescriptionMap[tool] || ''
      })
    }
  }
  
  // 如果没有匹配到，尝试其他格式
  if (toolResults.length === 0) {
    const listMatches = content.matchAll(/list_directory|read_file|write_file|edit_file|execute_bash|delete_file|search_code|append_file/g)
    for (const match of listMatches) {
      const tool = match[0]
      toolResults.push({
        tool,
        result: { success: true },
        description: toolDescriptionMap[tool] || ''
      })
    }
  }
  
  // 提取文件操作数量
  const fileOps = {
    read: 0,
    modified: 0,
    created: 0
  }
  const readMatch = content.match(/(\d+)\s*个读取/)
  if (readMatch) fileOps.read = parseInt(readMatch[1])
  const modifiedMatch = content.match(/(\d+)\s*个修改/)
  if (modifiedMatch) fileOps.modified = parseInt(modifiedMatch[1])
  const createdMatch = content.match(/(\d+)\s*个创建/)
  if (createdMatch) fileOps.created = parseInt(createdMatch[1])
  // 兼容旧格式
  const oldReadMatch = content.match(/(\d+)\s*个文件/)
  if (oldReadMatch && fileOps.read === 0) fileOps.read = parseInt(oldReadMatch[1])
  
  return {
    iteration,
    status,
    successCount,
    totalCount,
    toolResults,
    fileOps,
    isFinal
  }
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

// 工具调用链组件
function ToolCallChain({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls || toolCalls.length === 0) return null
  
  return (
    <div className="tool-call-chain">
      <div className="tool-call-chain-header">
        <span className="tool-call-chain-title">工具调用</span>
        <span className="tool-call-chain-count">{toolCalls.length} 个</span>
      </div>
      <div className="tool-call-chain-list">
        {toolCalls.map((toolCall, idx) => (
          <div key={toolCall.id} className={`tool-call-item ${toolCall.status}`}>
            <div className="tool-call-status">
              {toolCall.status === 'running' ? (
                <Loader2 size={14} className="tool-call-spinner" />
              ) : toolCall.status === 'completed' ? (
                <CheckCircle size={14} className="tool-call-success" />
              ) : (
                <XCircle size={14} className="tool-call-failed" />
              )}
            </div>
            <div className="tool-call-icon">
              {getToolIcon(toolCall.name)}
            </div>
            <div className="tool-call-info">
              <span className="tool-call-name">{toolNameMap[toolCall.name] || toolCall.name}</span>
              {toolCall.args?.path && (
                <span className="tool-call-path">{toolCall.args.path}</span>
              )}
            </div>
            <div className="tool-call-meta">
              {toolCall.duration && (
                <span className="tool-call-duration">{toolCall.duration}ms</span>
              )}
              <span className={`tool-call-status-text ${toolCall.status}`}>
                {toolCall.status === 'running' ? '执行中' : 
                 toolCall.status === 'completed' ? '成功' : '失败'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 流式内容显示组件
function StreamingContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [displayContent, setDisplayContent] = useState(content)
  
  useEffect(() => {
    setDisplayContent(content)
  }, [content])
  
  return (
    <div className={`streaming-content ${isStreaming ? 'streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className }) => {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : 'text'
            const code = String(children).replace(/\n$/, '')
            return (
              <CodeBlock
                code={code}
                language={language}
                showLineNumbers={true}
              />
            )
          }
        }}
      >
        {displayContent}
      </ReactMarkdown>
      {isStreaming && (
        <span className="streaming-cursor">▊</span>
      )}
    </div>
  )
}

export function BuilderMessage({ message, onContinue, onStop }: BuilderMessageProps) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true)
  const [isToolChainExpanded, setIsToolChainExpanded] = useState(true)
  const { thinkingSteps, mainContent } = parseMessageContent(message.content)
  
  // 合并解析的思考步骤和消息中的思考步骤
  const allThinkingSteps = [...(message.thinkingSteps || []), ...thinkingSteps]
  const hasThinkingSteps = allThinkingSteps.length > 0
  const isTimeout = message.content.includes('请求超时') || message.content.includes('timeout')
  const isIteration = isIterationMessage(message.content)
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  
  // 检查是否有实际内容（去除空白后）
  const hasContent = message.content.trim().length > 0 || hasThinkingSteps || hasToolCalls
  
  // 如果没有内容，渲染最小化的占位符
  if (!hasContent) {
    return (
      <div className="builder-message builder-message-loading">
        <div className="builder-message-header">
          <BuilderBadge />
        </div>
        <div className="builder-loading-indicator">
          <span className="builder-loading-dot"></span>
          <span className="builder-loading-dot"></span>
          <span className="builder-loading-dot"></span>
        </div>
      </div>
    )
  }
  
  // 如果是迭代消息且不是流式状态，使用 IterationMessage 组件渲染
  if (isIteration && !message.isStreaming) {
    const iterationData = parseIterationMessage(message.content)
    return (
      <div className="builder-message">
        <div className="builder-message-header">
          <BuilderBadge />
        </div>
        <IterationMessage {...iterationData} />
      </div>
    )
  }
  
  return (
    <div className={`builder-message ${message.isStreaming ? 'streaming' : ''}`}>
      {/* Builder标签 */}
      <div className="builder-message-header">
        <BuilderBadge />
        {message.isStreaming && (
          <span className="builder-streaming-indicator">
            <Loader2 size={14} className="builder-streaming-spinner" />
            <span>思考中...</span>
          </span>
        )}
      </div>
      
      {/* 工具调用链 - 流式模式下显示 */}
      {hasToolCalls && (
        <div className="builder-toolchain-section">
          <div 
            className="builder-toolchain-toggle"
            onClick={() => setIsToolChainExpanded(!isToolChainExpanded)}
          >
            <svg 
              width="12" 
              height="12" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className={`builder-toggle-icon ${isToolChainExpanded ? 'expanded' : ''}`}
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span>工具调用</span>
            <span className="builder-toolchain-count">{message.toolCalls?.length} 个</span>
          </div>
          
          {isToolChainExpanded && message.toolCalls && (
            <div className="builder-toolchain-content">
              <ToolCallChain toolCalls={message.toolCalls} />
            </div>
          )}
        </div>
      )}
      
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
            <span className="builder-thinking-count">{allThinkingSteps.length} 个步骤</span>
          </div>
          
          {isThinkingExpanded && (
            <div className="builder-thinking-content">
              <ThinkingPanel steps={allThinkingSteps} />
            </div>
          )}
        </div>
      )}
      
      {/* 消息内容 */}
      <div className="builder-message-content">
        {/* 流式内容显示 */}
        {message.isStreaming ? (
          <StreamingContent content={message.content} isStreaming={message.isStreaming} />
        ) : (
          /* 渲染内容（使用 ReactMarkdown 渲染 Markdown，包括代码块） */
          <div className="builder-text-content markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
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
                // 代码块使用 CodeBlock 组件渲染
                pre: ({ children }) => {
                  return <>{children}</>
                },
                code: ({ children, className }) => {
                  const match = /language-(\w+)/.exec(className || '')
                  const language = match ? match[1] : 'text'
                  const code = String(children).replace(/\n$/, '')
                  
                  return (
                    <CodeBlock
                      code={code}
                      language={language}
                      showLineNumbers={true}
                    />
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
                td: ({ children }) => <td className="markdown-table-cell">{children}</td>,
                details: ({ children }) => <details className="markdown-details">{children}</details>,
                summary: ({ children }) => <summary className="markdown-summary">{children}</summary>
              }}
            >
              {mainContent}
            </ReactMarkdown>
          </div>
        )}
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
