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
import { Copy, Check } from 'lucide-react'

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
        <span className="directory-tree-label">📁 目录结构</span>
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
  
  // 根据 onLinkClick 创建组件配置
  const components = createMarkdownComponents(onLinkClick)
  
  return (
    <div className={`markdown-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownRenderer
