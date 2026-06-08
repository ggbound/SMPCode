/**
 * MarkdownRenderer - 统一的 Markdown 渲染组件
 * 支持代码块、表格、目录树、列表等完整 Markdown 语法
 */

import { memo, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { CodeBlock } from './CodeBlock'
import { Copy, Check, FolderTree } from 'lucide-react'

// 有效的 HTML 标签名模式（仅允许字母开头，后跟字母、数字、短横线，可选末尾斜杠用于自闭合标签）
const VALID_HTML_TAG = /^[a-zA-Z][a-zA-Z0-9-]*\/?$/

/**
 * 将工具调用转换为用户能看懂的文字描述
 */
function convertToolCallToText(content: string): string {
  // 工具名称映射（将英文工具名转换为中文描述）
  const toolNameMap: Record<string, string> = {
    'list_reminders': '查看定时任务',
    'add_reminder': '添加定时提醒',
    'remove_reminder': '删除定时提醒',
    'read_file': '读取文件',
    'write_file': '写入文件',
    'edit_file': '编辑文件',
    'list_directory': '列出目录',
    'execute_bash': '执行命令',
    'search_files': '搜索文件',
    'delete_file': '删除文件',
    'append_file': '追加内容',
    'browse_website': '浏览网页',
    'search_code': '搜索代码',
    'file_read': '读取文件',
    'file_write': '写入文件',
    'bash': '执行命令',
    'glob': '搜索文件'
  }
  
  let result = content
  
  // 1. 匹配飞书格式的工具调用：<tool name="xxx">...</tool_call/>
  const feishuToolRegex = /<tool\s+name="([^"]+)"\s*>[\s\S]*?<\/tool_call\s*\/?>/gs
  result = result.replace(feishuToolRegex, (fullMatch) => {
    const nameMatch = fullMatch.match(/<tool\s+name="([^"]+)"/)
    const toolName = nameMatch ? nameMatch[1] : 'unknown'
    const displayName = toolNameMap[toolName] || toolName
    
    const params: Record<string, string> = {}
    const paramRegex = /<parameter=(\w+)>\s*([\s\S]*?)\s*<\/parameter=\1>/g
    let paramMatch
    while ((paramMatch = paramRegex.exec(fullMatch)) !== null) {
      params[paramMatch[1]] = paramMatch[2].trim()
    }
    
    if (Object.keys(params).length > 0) {
      const paramText = Object.entries(params)
        .map(([key, value]) => `${key}: ${value}`)
        .join('，')
      return `\n🔧 正在${displayName}（${paramText}）\n`
    }
    return `\n🔧 正在${displayName}...\n`
  })
  
  // 2. 匹配 <tool name="xxx"/> 格式的工具调用
  const simpleToolRegex = /<tool\s+name="([^"]+)"\s*\/>/g
  result = result.replace(simpleToolRegex, (_, toolName) => {
    const displayName = toolNameMap[toolName] || toolName
    return `\n🔧 正在${displayName}...\n`
  })
  
  // 3. 匹配 <tool_call>...</tool_call> 格式
  const toolCallTagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g
  result = result.replace(toolCallTagRegex, (_, content) => {
    // 尝试解析内容
    try {
      const parsed = JSON.parse(content.trim())
      const toolName = parsed.tool || parsed.name || '未知工具'
      const displayName = toolNameMap[toolName] || toolName
      return `\n🔧 正在${displayName}...\n`
    } catch {
      return `\n🔧 正在处理工具调用...\n`
    }
  })
  
  // 4. 匹配 ```json {"tool": "..."} ``` 格式的工具调用代码块
  const jsonToolBlockRegex = /```json\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/g
  result = result.replace(jsonToolBlockRegex, (_, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr)
      const toolName = parsed.tool || '未知工具'
      const displayName = toolNameMap[toolName] || toolName
      return `\n🔧 正在${displayName}...\n`
    } catch {
      return ''
    }
  })
  
  return result
}

/**
 * 预处理 Markdown 内容，转义无效的 HTML 标签
 * 防止 AI 输出类似 <parameter=time_expression> 的内容导致 React 崩溃
 */
function sanitizeHTMLTags(content: string): string {
  // 首先处理工具调用，转换为用户能看懂的文字描述
  let result = convertToolCallToText(content)
  
  // 匹配 <...> 形式的标签，但排除已知有效的 HTML 标签和代码块
  return result.replace(/<(\/?)([^>\s]+)(\s[^>]*)?>/g, (match, close, tagName, attrs) => {
    // 去掉自闭合标签末尾的 /
    const cleanTag = tagName.toLowerCase().replace(/\/$/, '')
    // 如果标签名匹配有效 HTML 模式，则保留
    if (VALID_HTML_TAG.test(cleanTag)) {
      return match
    }
    // 否则转义为普通文本
    return `&lt;${close}${tagName}${attrs || ''}&gt;`
  })
}

interface MarkdownRendererProps {
  content: string
  className?: string
  enableCodeBlocks?: boolean
  enableTables?: boolean
  enableDirectoryTree?: boolean
  maxHeight?: number
  onLinkClick?: (url: string) => void
}

// 检测是否为目录树
function isDirectoryTree(content: string): boolean {
  // 目录树特征：包含树形字符且有多行
  const treeChars = /[├└│─]/
  const treePattern = /^\s*[├└│].*$/m
  const lines = content.split('\n').filter(line => line.trim())
  
  // 至少包含树形字符，且匹配树形模式，且有多行
  return treeChars.test(content) && 
         treePattern.test(content) && 
         lines.length >= 2
}

// 检测是否为纯文本（不应该作为代码块渲染）
function isPlainText(content: string): boolean {
  // 如果内容看起来像 Markdown，就不应该作为代码块
  const markdownPatterns = [
    /^\s*#{1,6}\s+/m,      // 标题
    /^\s*[-*+]\s+/m,       // 列表
    /^\s*\d+\.\s+/m,       // 有序列表
    /^\s*>.+$/m,           // 引用
    /^\s*```/m,            // 代码块
    /^\s*\|.+\|$/m,        // 表格
    /^\s*\[.+\]\(.+\)/m,   // 链接
    /^\s*\*\*.+\*\*/m,     // 粗体
    /^\s*__.+__/m,         // 粗体
    /^\s*`.+`/m,           // 行内代码
  ]
  
  return !markdownPatterns.some(pattern => pattern.test(content))
}

// 目录树渲染组件
const DirectoryTreeBlock = memo(function DirectoryTreeBlock({ content }: { content: string }) {
  const [isCopied, setIsCopied] = useState(false)
  
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [content])
  
  return (
    <div className="directory-tree-block">
      <div className="directory-tree-header">
        <span className="directory-tree-label"><FolderTree size={14} style={{ marginRight: '6px' }} />目录结构</span>
        <button 
          className={`directory-tree-copy-btn ${isCopied ? 'copied' : ''}`}
          onClick={handleCopy}
        >
          {isCopied ? <Check size={12} /> : <Copy size={12} />}
          <span>{isCopied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <div className="directory-tree-content">
        <pre>{content}</pre>
      </div>
    </div>
  )
})

// 检测是否为工具调用 JSON（不应该显示给用户）
function isToolCallJSON(code: string): boolean {
  const trimmed = code.trim()
  // 检测各种工具调用 JSON 格式
  if (trimmed.startsWith('{"tool"') || trimmed.startsWith('"tool"')) {
    return true
  }
  if (trimmed.includes('"tool"') && trimmed.includes('"arguments"')) {
    return true
  }
  // 检测嵌套的代码块中的工具调用
  if (trimmed.includes('```json') && trimmed.includes('"tool"')) {
    return true
  }
  // 检测 file_read: 格式的工具调用（多轮对话后可能出现的格式）
  if (/^file_read:\s*"\{/.test(trimmed) || /^file_write:\s*"\{/.test(trimmed)) {
    return true
  }
  // 检测其他工具调用格式（使用正确的工具名称）
  if (/^(read_file|write_file|edit_file|execute_bash|search_files|list_directory|delete_file|append_file)\s*[:=]/.test(trimmed)) {
    return true
  }
  return false
}

// 代码块包装组件
const CodeBlockWrapper = memo(function CodeBlockWrapper({ 
  code, 
  language, 
  maxHeight = 500 
}: { 
  code: string
  language: string
  maxHeight?: number
}) {
  // 检测是否为工具调用 JSON - 如果是，渲染为空（防止闪出）
  if (isToolCallJSON(code)) {
    console.log('[MarkdownRenderer] Filtering out tool call JSON')
    return <div style={{ display: 'none' }} /> // 使用 display:none 而不是 null，防止闪出
  }
  
  // 检测是否为目录树
  if (isDirectoryTree(code)) {
    return <DirectoryTreeBlock content={code} />
  }
  
  // 检测内容是否包含 Markdown 语法（如标题、列表等）
  // 如果是，说明这可能是被错误包裹在代码块中的 Markdown
  const hasMarkdownSyntax = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>.+$|\[.+\]\(.+\)|\*\*.+\*\*|__.+__)/m.test(code)
  
  // 如果是 text 语言且包含 Markdown 语法，作为 Markdown 渲染
  if ((language === 'text' || language === '') && hasMarkdownSyntax) {
    return (
      <div className="markdown-content-wrapper">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]} 
          rehypePlugins={[rehypeRaw]}
          components={createMarkdownComponents()}
        >
          {code}
        </ReactMarkdown>
      </div>
    )
  }
  
  return (
    <CodeBlock 
      code={code} 
      language={language} 
      showLineNumbers={true}
      maxHeight={maxHeight}
    />
  )
})

// 创建 Markdown 组件配置（支持自定义链接点击）
const createMarkdownComponents = (onLinkClick?: (url: string) => void): Components => ({
  // 代码块处理
  pre: (props) => {
    return <>{props.children}</>
  },
  
  code: (props) => {
    const { className, children } = props
    const match = /language-(\w+)/.exec(className || '')
    const language = match ? match[1] : 'text'
    const code = String(children).replace(/\n$/, '')
    
    // 行内代码
    if (!className) {
      return (
        <code className="inline-code">
          {children}
        </code>
      )
    }
    
    return <CodeBlockWrapper code={code} language={language} />
  },
  
  // 表格处理
  table: (props) => (
    <div className="markdown-table-wrapper">
      <table className="markdown-table">{props.children}</table>
    </div>
  ),
  thead: (props) => <thead className="markdown-table-head">{props.children}</thead>,
  tbody: (props) => <tbody className="markdown-table-body">{props.children}</tbody>,
  tr: (props) => <tr className="markdown-table-row">{props.children}</tr>,
  th: (props) => <th className="markdown-table-header">{props.children}</th>,
  td: (props) => <td className="markdown-table-cell">{props.children}</td>,
  
  // 标题处理
  h1: (props) => <h1 className="markdown-h1">{props.children}</h1>,
  h2: (props) => <h2 className="markdown-h2">{props.children}</h2>,
  h3: (props) => <h3 className="markdown-h3">{props.children}</h3>,
  h4: (props) => <h4 className="markdown-h4">{props.children}</h4>,
  h5: (props) => <h5 className="markdown-h5">{props.children}</h5>,
  h6: (props) => <h6 className="markdown-h6">{props.children}</h6>,
  
  // 列表处理
  ul: (props) => <ul className="markdown-ul">{props.children}</ul>,
  ol: (props) => <ol className="markdown-ol">{props.children}</ol>,
  li: (props) => <li className="markdown-li">{props.children}</li>,
  
  // 引用处理
  blockquote: (props) => (
    <blockquote className="markdown-blockquote">{props.children}</blockquote>
  ),
  
  // 链接处理
  a: (props) => {
    const { children, href } = props
    const handleClick = (e: React.MouseEvent) => {
      if (onLinkClick && href) {
        e.preventDefault()
        onLinkClick(href)
      }
    }
    return (
      <a 
        className="markdown-link" 
        href={href} 
        target={onLinkClick ? undefined : "_blank"} 
        rel={onLinkClick ? undefined : "noopener noreferrer"}
        onClick={handleClick}
      >
        {children}
      </a>
    )
  },
  
  // 段落处理
  p: (props) => {
    const children = props.children
    // 高亮文件路径
    const text = String(children)
    const filePathRegex = /([\w\-]+\/)+[\w\-]+\.\w+/g
    const parts = text.split(filePathRegex)
    const matches = text.match(filePathRegex) || []
    
    if (matches.length === 0) {
      return <p className="markdown-p">{children}</p>
    }
    
    return (
      <p className="markdown-p">
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
  
  // 分隔线
  hr: () => <hr className="markdown-hr" />,
  
  // 强调
  strong: (props) => (
    <strong className="markdown-strong">{props.children}</strong>
  ),
  em: (props) => (
    <em className="markdown-em">{props.children}</em>
  ),
})

// 主组件
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  onLinkClick,
}: MarkdownRendererProps) {
  if (!content || content.trim().length === 0) {
    return null
  }

  // 预处理内容，转义无效 HTML 标签，防止 React createElement 崩溃
  const sanitizedContent = sanitizeHTMLTags(content)
  
  // 根据 onLinkClick 创建组件配置
  const components = createMarkdownComponents(onLinkClick)
  
  return (
    <div className={`markdown-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownRenderer
