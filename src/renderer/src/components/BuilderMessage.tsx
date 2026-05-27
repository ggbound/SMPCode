import { useState, useEffect } from 'react'
import type { Message, ToolCall } from '../store'
import { ThinkingPanel } from './ThinkingPanel'
import { TimeoutPrompt } from './TimeoutPrompt'
import { IterationMessage } from './IterationMessage'
import { MessageStepList } from './MessageStep'
import { MarkdownRenderer } from './MarkdownRenderer'
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

/**
 * 检测是否为工具调用 JSON
 */
function isToolCallJSON(code: string): boolean {
  const trimmed = code.trim()
  if (trimmed.startsWith('{"tool"') || trimmed.startsWith('"tool"')) {
    return true
  }
  if (trimmed.includes('"tool"') && trimmed.includes('"arguments"')) {
    return true
  }
  return false
}

/**
 * 清理内容中的内部数据和工具调用标记
 * 这是关键函数，用于过滤掉不应该显示给用户的内容
 * 
 * 注意：保留 thinking 标签内容，因为用户希望看到 AI 的思考过程
 */
function cleanInternalContent(content: string): string {
  if (!content) return ''
  
  let cleaned = content
  
  // 1. 提取 thinking 标签内容并保留（不移除，因为用户希望看到思考过程）
  // 只移除 thinking 标签本身，保留内容
  cleaned = cleaned.replace(/<think>/gi, '')
  cleaned = cleaned.replace(/<\/think>/gi, '')
  
  // 2. 移除工具调用 JSON 代码块（包括嵌套的情况）
  // 匹配 ```json\n{"tool": "...", ...}\n``` 包括嵌套的 ```json
  cleaned = cleaned.replace(/```json\s*\n?\s*\{\s*"tool"\s*:\s*"[^"]+"[\s\S]*?```\s*\n?/gi, '')
  
  // 3. 移除更复杂的嵌套工具调用 JSON 代码块
  // 处理截图中看到的嵌套情况：```json\n{"tool":...}\n```json\n{...}
  const nestedToolCallPattern = /```json\s*\n\s*\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}\s*\n```json\s*\n\s*\{\s*"tool"[\s\S]*?\n```/gi
  cleaned = cleaned.replace(nestedToolCallPattern, '')
  
  // 4. 移除内联的工具调用 JSON（包括多行的情况）
  // 匹配 {"tool": "...", "arguments": {...}} 包括跨行的情况
  cleaned = cleaned.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi, '')
  
  // 5. 移除工具调用标记
  cleaned = cleaned.replace(/\*\*正在调用工具：\*\*\s*\w+\n?/gi, '')
  cleaned = cleaned.replace(/\*\*工具执行结果：\*\*[\s\S]*?(?=\n\n|$)/gi, '')
  cleaned = cleaned.replace(/\*\*工具执行失败：\*\*[\s\S]*?(?=\n\n|$)/gi, '')
  
  // 6. 移除重复的 "工具执行结果:" 标题
  cleaned = cleaned.replace(/工具执行结果：\s*\n/gi, '')
  
  // 7. 清理多余的空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  
  // 8. 移除首尾空白
  cleaned = cleaned.trim()
  
  return cleaned
}

/**
 * 解析内容中的 thinking 标签
 * 返回提取的思考内容和清理后的内容
 */
function parseThinkingTags(content: string): { thinking: string | null; cleaned: string } {
  // 匹配 <thinking>内容</think> 格式
  const thinkingRegex = /<thinking>([\s\S]*?)<\/think>/gi
  const matches: string[] = []
  
  let match
  while ((match = thinkingRegex.exec(content)) !== null) {
    matches.push(match[1].trim())
  }
  
  // 使用新的清理函数
  const cleaned = cleanInternalContent(content)
  
  return {
    thinking: matches.length > 0 ? matches.join('\n\n') : null,
    cleaned
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
  
  // 首先清理内部数据（保留 thinking 内容，移除工具调用 JSON）
  const cleaned = cleanInternalContent(content)
  
  // 提取 thinking 内容（从原始内容）
  const { thinking } = parseThinkingTags(content)
  
  // 如果存在 thinking 内容，添加为分析步骤
  if (thinking) {
    thinkingSteps.push({
      type: 'analysis',
      title: 'AI 思考过程',
      content: thinking
    })
  }
  
  // 注意：不再从 mainContent 中提取代码块
  // 代码块应该由 MarkdownRenderer 正常渲染
  // 我们只提取特殊的操作步骤（搜索、命令等）用于展示
  
  // 提取搜索操作
  const searchRegex = /在工作区搜索 ['"]([^'"]+)['"]/g
  let match
  while ((match = searchRegex.exec(cleaned)) !== null) {
    thinkingSteps.push({
      type: 'search',
      title: `在工作区搜索 '${match[1]}'`,
    })
  }
  
  // 提取终端命令
  const commandRegex = /\$ (.+)/g
  while ((match = commandRegex.exec(cleaned)) !== null) {
    thinkingSteps.push({
      type: 'command',
      title: '执行命令',
      content: match[1]
    })
  }
  
  // mainContent 保持完整，让 MarkdownRenderer 正常渲染
  // 包括标题、列表、代码块等所有 Markdown 语法
  return { thinkingSteps, mainContent: cleaned }
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
  return (
    <div className={`streaming-content ${isStreaming ? 'streaming' : ''}`}>
      <MarkdownRenderer content={content} />
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
  
  // 检查是否有消息步骤（新的步骤化展示）
  const hasMessageSteps = message.messageSteps && message.messageSteps.length > 0
  
  // 检查是否有实际内容（去除空白后）
  const hasContent = message.content.trim().length > 0 || hasThinkingSteps || hasToolCalls || hasMessageSteps
  
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
      
      {/* 新的步骤化展示 */}
      {hasMessageSteps && (
        <div className="builder-steps-section">
          <MessageStepList 
            steps={message.messageSteps!} 
            executionPhase={message.executionPhase}
          />
        </div>
      )}
      
      {/* 工具调用链 - 流式模式下显示（向后兼容） */}
      {hasToolCalls && !hasMessageSteps && (
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
      
      {/* 思考过程面板（向后兼容） */}
      {hasThinkingSteps && !hasMessageSteps && (
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
        {/* 流式内容显示 - 使用清理后的 mainContent */}
        {message.isStreaming ? (
          <StreamingContent content={mainContent} isStreaming={message.isStreaming} />
        ) : (
          /* 渲染内容（使用 MarkdownRenderer 渲染 Markdown，包括代码块） */
          <div className="builder-text-content markdown-body">
            <MarkdownRenderer content={mainContent} />
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
