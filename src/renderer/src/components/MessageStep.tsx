/**
 * MessageStep - 消息步骤组件
 * 实现步骤化展示，支持思考、工具调用、结果分析等不同类型的步骤
 */

import { useState, memo } from 'react'
import type { MessageStep as MessageStepType } from '../store'
import { MarkdownRenderer } from './MarkdownRenderer'
import { 
  Loader2, 
  CheckCircle, 
  XCircle, 
  FileText, 
  Edit3, 
  PlusCircle, 
  FolderOpen, 
  FileSearch, 
  Terminal, 
  Trash2,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  Search,
  CheckSquare
} from 'lucide-react'

interface MessageStepProps {
  step: MessageStepType
  isLast?: boolean
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
      return <FileText size={16} />
    case 'write_file':
      return <PlusCircle size={16} />
    case 'edit_file':
      return <Edit3 size={16} />
    case 'delete_file':
      return <Trash2 size={16} />
    case 'list_directory':
      return <FolderOpen size={16} />
    case 'search_code':
      return <FileSearch size={16} />
    case 'execute_bash':
      return <Terminal size={16} />
    case 'append_file':
      return <Edit3 size={16} />
    default:
      return <Wrench size={16} />
  }
}

// 获取步骤类型图标
function getStepTypeIcon(type: MessageStepType['type']) {
  switch (type) {
    case 'thinking':
      return <Brain size={16} />
    case 'tool_call':
      return <Wrench size={16} />
    case 'tool_result':
      return <CheckSquare size={16} />
    case 'analysis':
      return <Search size={16} />
    case 'summary':
      return <CheckCircle size={16} />
    default:
      return <Brain size={16} />
  }
}

// 获取步骤类型颜色
function getStepTypeColor(type: MessageStepType['type']) {
  switch (type) {
    case 'thinking':
      return '#3b82f6' // blue
    case 'tool_call':
      return '#f59e0b' // amber
    case 'tool_result':
      return '#10b981' // green
    case 'analysis':
      return '#8b5cf6' // purple
    case 'summary':
      return '#22c55e' // green
    default:
      return '#6b7280' // gray
  }
}

// 获取状态图标
function StatusIcon({ status }: { status: MessageStepType['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="step-status-icon spinning" />
    case 'completed':
      return <CheckCircle size={14} className="step-status-icon completed" />
    case 'failed':
      return <XCircle size={14} className="step-status-icon failed" />
    default:
      return <div className="step-status-icon pending" />
  }
}

// 思考步骤组件
function ThinkingStep({ step, isExpanded, onToggle }: { 
  step: MessageStepType
  isExpanded: boolean
  onToggle: () => void 
}) {
  return (
    <div className="message-step thinking-step">
      <div className="step-header" onClick={onToggle}>
        <div className="step-icon" style={{ color: getStepTypeColor('thinking') }}>
          <Brain size={16} />
        </div>
        <div className="step-title">
          {step.title || '思考中...'}
        </div>
        <div className="step-status">
          <StatusIcon status={step.status} />
        </div>
        <div className="step-toggle">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {isExpanded && step.content && (
        <div className="step-content">
          <div className="thinking-content">
            <MarkdownRenderer content={step.content} />
          </div>
        </div>
      )}
    </div>
  )
}

// 工具调用步骤组件
function ToolCallStep({ step, isExpanded, onToggle }: { 
  step: MessageStepType
  isExpanded: boolean
  onToggle: () => void 
}) {
  const toolName = step.toolName || 'unknown'
  const displayName = toolNameMap[toolName] || toolName
  const isFileOperation = ['read_file', 'write_file', 'edit_file', 'delete_file', 'append_file'].includes(toolName)
  
  // 获取文件路径
  const filePath = step.toolArgs?.path || step.filePath || ''
  
  return (
    <div className={`message-step tool-call-step ${isFileOperation ? 'file-operation' : ''}`}>
      <div className="step-header" onClick={onToggle}>
        <div className="step-icon" style={{ color: getStepTypeColor('tool_call') }}>
          {getToolIcon(toolName)}
        </div>
        <div className="step-title">
          <span className="tool-name">{displayName}</span>
          {filePath && (
            <span className="file-path">{filePath}</span>
          )}
        </div>
        <div className="step-status">
          <StatusIcon status={step.status} />
        </div>
        <div className="step-toggle">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {isExpanded && (
        <div className="step-content">
          {step.toolArgs && Object.keys(step.toolArgs).length > 0 && (
            <div className="tool-args-section">
              <div className="section-label">参数</div>
              <pre className="tool-args">
                {JSON.stringify(step.toolArgs, null, 2)}
              </pre>
            </div>
          )}
          {step.toolResult && (
            <div className="tool-result-section">
              <div className="section-label">
                {step.toolResult.success ? '执行结果' : '执行失败'}
              </div>
              {step.toolResult.success ? (
                <pre className="tool-result success">
                  {step.toolResult.output?.slice(0, 1000)}
                  {step.toolResult.output && step.toolResult.output.length > 1000 && '\n...'}
                </pre>
              ) : (
                <pre className="tool-result error">
                  {step.toolResult.error}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 工具结果步骤组件
function ToolResultStep({ step, isExpanded, onToggle }: { 
  step: MessageStepType
  isExpanded: boolean
  onToggle: () => void 
}) {
  return (
    <div className="message-step tool-result-step">
      <div className="step-header" onClick={onToggle}>
        <div className="step-icon" style={{ color: getStepTypeColor('tool_result') }}>
          <CheckSquare size={16} />
        </div>
        <div className="step-title">
          {step.title || '工具执行结果'}
        </div>
        <div className="step-status">
          <StatusIcon status={step.status} />
        </div>
        <div className="step-toggle">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {isExpanded && step.toolResult && (
        <div className="step-content">
          <div className="tool-result-section">
            {step.toolResult.success ? (
              <pre className="tool-result success">
                {step.toolResult.output?.slice(0, 1000)}
                {step.toolResult.output && step.toolResult.output.length > 1000 && '\n...'}
              </pre>
            ) : (
              <pre className="tool-result error">
                {step.toolResult.error}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 分析步骤组件
function AnalysisStep({ step, isExpanded, onToggle }: { 
  step: MessageStepType
  isExpanded: boolean
  onToggle: () => void 
}) {
  return (
    <div className="message-step analysis-step">
      <div className="step-header" onClick={onToggle}>
        <div className="step-icon" style={{ color: getStepTypeColor('analysis') }}>
          <Search size={16} />
        </div>
        <div className="step-title">
          {step.title || '分析结果'}
        </div>
        <div className="step-status">
          <StatusIcon status={step.status} />
        </div>
        <div className="step-toggle">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {isExpanded && step.content && (
        <div className="step-content">
          <div className="analysis-content">
            <MarkdownRenderer content={step.content} />
          </div>
        </div>
      )}
    </div>
  )
}

// 总结步骤组件
function SummaryStep({ step }: { step: MessageStepType }) {
  return (
    <div className="message-step summary-step">
      <div className="step-header">
        <div className="step-icon" style={{ color: getStepTypeColor('summary') }}>
          <CheckCircle size={16} />
        </div>
        <div className="step-title">
          {step.title || '任务完成'}
        </div>
        <div className="step-status">
          <StatusIcon status={step.status} />
        </div>
      </div>
    </div>
  )
}

// 主组件
export const MessageStepComponent = memo(function MessageStepComponent({ step, isLast }: MessageStepProps) {
  const [isExpanded, setIsExpanded] = useState(
    step.type === 'tool_call' || step.type === 'tool_result'
  )

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  // 根据步骤类型渲染不同的组件
  switch (step.type) {
    case 'thinking':
      return <ThinkingStep step={step} isExpanded={isExpanded} onToggle={handleToggle} />
    case 'tool_call':
      return <ToolCallStep step={step} isExpanded={isExpanded} onToggle={handleToggle} />
    case 'tool_result':
      return <ToolResultStep step={step} isExpanded={isExpanded} onToggle={handleToggle} />
    case 'analysis':
      return <AnalysisStep step={step} isExpanded={isExpanded} onToggle={handleToggle} />
    case 'summary':
      return <SummaryStep step={step} />
    default:
      return <ThinkingStep step={step} isExpanded={isExpanded} onToggle={handleToggle} />
  }
})

// 步骤列表组件
interface MessageStepListProps {
  steps: MessageStepType[]
  executionPhase?: string
}

export const MessageStepList = memo(function MessageStepList({ steps, executionPhase }: MessageStepListProps) {
  if (!steps || steps.length === 0) {
    return null
  }

  return (
    <div className="message-step-list">
      {/* 执行阶段指示器 */}
      {executionPhase && executionPhase !== 'completed' && (
        <div className="execution-phase-indicator">
          <div className={`phase-badge ${executionPhase}`}>
            {executionPhase === 'thinking' && <><Brain size={12} /> 思考中</>}
            {executionPhase === 'executing_tool' && <><Wrench size={12} /> 执行工具</>}
            {executionPhase === 'analyzing' && <><Search size={12} /> 分析中</>}
            {executionPhase === 'error' && <><XCircle size={12} /> 执行出错</>}
          </div>
          <div className="phase-progress">
            步骤 {steps.length}
          </div>
        </div>
      )}
      
      {/* 步骤列表 */}
      <div className="steps-container">
        {steps.map((step, index) => (
          <MessageStepComponent 
            key={step.id} 
            step={step} 
            isLast={index === steps.length - 1}
          />
        ))}
      </div>
    </div>
  )
})

export default MessageStepComponent
