import { useState } from 'react'
import { ChevronRight, ChevronDown, CheckCircle, XCircle, Loader2, FileText, Edit3, PlusCircle, FolderOpen, FileSearch, Terminal, Trash2, Check, X } from 'lucide-react'

interface ToolResult {
  tool: string
  result: {
    success: boolean
    output?: string
    error?: string
  }
  description?: string
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

// 工具描述映射
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

// 获取工具图标
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return <FileText size={12} />
    case 'write_file':
      return <PlusCircle size={12} />
    case 'edit_file':
      return <Edit3 size={12} />
    case 'delete_file':
      return <Trash2 size={12} />
    case 'list_directory':
      return <FolderOpen size={12} />
    case 'search_code':
      return <FileSearch size={12} />
    case 'execute_bash':
      return <Terminal size={12} />
    case 'append_file':
      return <Edit3 size={12} />
    default:
      return <FileText size={12} />
  }
}

interface IterationMessageProps {
  iteration: number
  status: 'running' | 'completed' | 'failed'
  successCount: number
  totalCount: number
  toolResults: ToolResult[]
  fileOps?: {
    read?: number
    modified?: number
    created?: number
  }
  summary?: string
  isFinal?: boolean
}

export function IterationMessage({
  iteration,
  status,
  successCount,
  totalCount,
  toolResults,
  fileOps,
  summary,
  isFinal
}: IterationMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const allSuccess = successCount === totalCount
  const hasFailures = successCount < totalCount

  return (
    <div className="iteration-message">
      {/* 头部：轮次信息和状态 */}
      <div className="iteration-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="iteration-title-row">
          <div className="iteration-toggle">
            {isExpanded ? (
              <ChevronDown className="iteration-toggle-icon" size={16} />
            ) : (
              <ChevronRight className="iteration-toggle-icon" size={16} />
            )}
          </div>
          
          <div className="iteration-badge">
            {isFinal ? (
              <>
                <CheckCircle className="iteration-badge-icon success" size={14} />
                <span>完成</span>
              </>
            ) : status === 'running' ? (
              <>
                <Loader2 className="iteration-badge-icon spinning" size={14} />
                <span>第 {iteration} 轮</span>
              </>
            ) : (
              <>
                {allSuccess ? (
                  <CheckCircle className="iteration-badge-icon success" size={14} />
                ) : (
                  <XCircle className="iteration-badge-icon error" size={14} />
                )}
                <span>第 {iteration} 轮</span>
              </>
            )}
          </div>

          <div className="iteration-status">
            {allSuccess ? (
              <span className="status-success">{successCount}/{totalCount} 成功</span>
            ) : hasFailures ? (
              <span className="status-partial">{successCount}/{totalCount} 成功</span>
            ) : (
              <span className="status-running">执行中...</span>
            )}
          </div>
        </div>

        {/* 工具执行摘要 */}
        <div className="iteration-tools-summary">
          {toolResults.map((tr, idx) => {
            const chineseName = toolNameMap[tr.tool] || tr.tool
            const description = tr.description || toolDescriptionMap[tr.tool] || ''
            return (
              <span
                key={idx}
                className={`tool-tag ${tr.result.success ? 'success' : 'failed'}`}
                title={description}
              >
                <span className="tool-tag-icon">{getToolIcon(tr.tool)}</span>
                <span className="tool-tag-name">{chineseName}</span>
              </span>
            )
          })}
        </div>

        {/* 文件操作摘要 */}
        {fileOps && (fileOps.read || fileOps.modified || fileOps.created) && (
          <div className="iteration-file-ops">
            {fileOps.read ? (
              <span className="file-op-tag read">
                <FileText size={12} /> {fileOps.read}
              </span>
            ) : null}
            {fileOps.modified ? (
              <span className="file-op-tag modified">
                <Edit3 size={12} /> {fileOps.modified}
              </span>
            ) : null}
            {fileOps.created ? (
              <span className="file-op-tag created">
                <PlusCircle size={12} /> {fileOps.created}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* 展开内容：详细结果 */}
      {isExpanded && (
        <div className="iteration-details">
          {summary && (
            <div className="iteration-summary">
              <h4>执行摘要</h4>
              <p>{summary}</p>
            </div>
          )}
          
          <div className="iteration-tools-detail">
            <h4>工具执行详情</h4>
            {toolResults.map((tr, idx) => {
              const chineseName = toolNameMap[tr.tool] || tr.tool
              const description = tr.description || toolDescriptionMap[tr.tool] || ''
              return (
                <div
                  key={idx}
                  className={`tool-detail-item ${tr.result.success ? 'success' : 'failed'}`}
                >
                  <div className="tool-detail-header">
                    <span className="tool-status-icon">
                      {tr.result.success ? <Check size={14} /> : <X size={14} />}
                    </span>
                    <span className="tool-icon">{getToolIcon(tr.tool)}</span>
                    <div className="tool-info">
                      <span className="tool-name">{chineseName}</span>
                      <span className="tool-description">{description}</span>
                    </div>
                    <span className={`tool-status ${tr.result.success ? 'success' : 'failed'}`}>
                      {tr.result.success ? '成功' : '失败'}
                    </span>
                  </div>
                  {tr.result.output && (
                    <pre className="tool-output">{tr.result.output}</pre>
                  )}
                  {tr.result.error && (
                    <div className="tool-error">{tr.result.error}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default IterationMessage
