/**
 * 任务检查点系统
 * 跟踪对话中的任务状态，防止重复执行
 */

import type { KiloMessage } from '../store/kiloStore'

export interface TaskCheckpoint {
  id: string
  timestamp: number
  description: string
  completedTools: CompletedToolInfo[]
  keyFindings: string[]
  generatedFiles: string[]
  userApprovals: string[]
  summary: string
}

export interface CompletedToolInfo {
  id: string
  name: string
  args: Record<string, unknown>
  result: string
  timestamp: number
}

export interface TaskState {
  checkpoints: TaskCheckpoint[]
  currentCheckpoint: TaskCheckpoint | null
  completedTaskIds: Set<string>
}

// 危险工具列表
const DANGEROUS_TOOLS = ['delete_file', 'write_file', 'edit_file', 'execute_bash', 'bash']

/**
 * 生成任务唯一ID
 */
function generateTaskId(toolName: string, args: Record<string, unknown>): string {
  const argsStr = JSON.stringify(args)
  return `${toolName}:${argsStr}`
}

/**
 * 从消息历史中提取检查点
 */
export function extractCheckpoints(messages: KiloMessage[]): TaskCheckpoint[] {
  const checkpoints: TaskCheckpoint[] = []
  let currentCheckpoint: TaskCheckpoint | null = null
  
  messages.forEach((msg, index) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    
    // 检测新检查点标记（如 "[思考]" 或新的用户请求）
    if (msg.role === 'user' || (msg.role === 'assistant' && content.includes('[思考]'))) {
      // 保存之前的检查点
      const prevCp = currentCheckpoint
      if (prevCp && prevCp.completedTools.length > 0) {
        checkpoints.push(prevCp)
      }
      
      // 创建新检查点
      currentCheckpoint = {
        id: `checkpoint-${Date.now()}-${index}`,
        timestamp: msg.timestamp,
        description: extractDescription(content),
        completedTools: [],
        keyFindings: [],
        generatedFiles: [],
        userApprovals: [],
        summary: ''
      }
    }
    
    // 提取工具调用
    const cp = currentCheckpoint
    if (cp) {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach(toolCall => {
          if (toolCall.status === 'completed') {
            const toolInfo: CompletedToolInfo = {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.args,
              result: toolCall.result !== undefined ? String(toolCall.result) : '',
              timestamp: msg.timestamp
            }
            cp.completedTools.push(toolInfo)
          }
        })
      }
      
      // 提取关键发现
      if (msg.role === 'assistant') {
        const findings = extractKeyFindings(content)
        cp.keyFindings.push(...findings)
        
        // 提取生成的文件
        const files = extractGeneratedFiles(content)
        cp.generatedFiles.push(...files)
        
        // 提取用户确认
        if (content.includes('用户确认') || content.includes('已确认')) {
          cp.userApprovals.push(content.slice(0, 100))
        }
      }
    }
  })
  
  // 保存最后一个检查点
  const lastCheckpoint = currentCheckpoint as TaskCheckpoint | null
  if (lastCheckpoint && lastCheckpoint.completedTools.length > 0) {
    checkpoints.push(lastCheckpoint)
  }
  
  // 生成摘要
  checkpoints.forEach(cp => {
    cp.summary = generateCheckpointSummary(cp)
  })
  
  return checkpoints
}

/**
 * 提取描述
 */
function extractDescription(content: string): string {
  // 提取 [思考] 后的内容
  const thinkingMatch = content.match(/\[思考\]\s*([^\n]+)/)
  if (thinkingMatch) {
    return thinkingMatch[1].slice(0, 100)
  }
  
  // 提取用户消息的前100字符
  return content.slice(0, 100)
}

/**
 * 提取关键发现
 */
function extractKeyFindings(content: string): string[] {
  const findings: string[] = []
  
  const patterns = [
    /发现[了\s]*([^。\n]+)/,
    /找到[了\s]*([^。\n]+)/,
    /完成[了\s]*([^。\n]+)/,
    /已[经\s]*([^。\n]+)/,
    /问题[是\s]*([^。\n]+)/,
    /原因[是\s]*([^。\n]+)/,
    /解决[了\s]*([^。\n]+)/
  ]
  
  patterns.forEach(pattern => {
    const match = content.match(pattern)
    if (match && match[1].length > 5 && match[1].length < 80) {
      findings.push(match[1].trim())
    }
  })
  
  return findings
}

/**
 * 提取生成的文件
 */
function extractGeneratedFiles(content: string): string[] {
  const files: string[] = []
  
  // 匹配文件路径
  const filePatterns = [
    /创建[了\s]*文件\s*[`"]?(\/[^`"\s]+)/,
    /生成[了\s]*文件\s*[`"]?(\/[^`"\s]+)/,
    /写入[了\s]*文件\s*[`"]?(\/[^`"\s]+)/,
    /文件\s*[`"]?(\/[^`"\s]+)\s*已创建/
  ]
  
  filePatterns.forEach(pattern => {
    const match = content.match(pattern)
    if (match) {
      files.push(match[1])
    }
  })
  
  return files
}

/**
 * 生成检查点摘要
 */
function generateCheckpointSummary(checkpoint: TaskCheckpoint): string {
  const parts: string[] = []
  
  if (checkpoint.completedTools.length > 0) {
    const toolNames = checkpoint.completedTools.map(t => t.name).join(', ')
    parts.push(`执行了 ${checkpoint.completedTools.length} 个工具 (${toolNames})`)
  }
  
  if (checkpoint.keyFindings.length > 0) {
    parts.push(`发现: ${checkpoint.keyFindings[0]}`)
  }
  
  if (checkpoint.generatedFiles.length > 0) {
    parts.push(`生成 ${checkpoint.generatedFiles.length} 个文件`)
  }
  
  return parts.join('; ') || '无操作'
}

/**
 * 检查是否是重复任务
 */
export function isDuplicateTask(
  toolName: string,
  args: Record<string, unknown>,
  checkpoints: TaskCheckpoint[]
): { isDuplicate: boolean; previousResult?: string } {
  const taskId = generateTaskId(toolName, args)
  
  for (const checkpoint of checkpoints) {
    for (const tool of checkpoint.completedTools) {
      const existingTaskId = generateTaskId(tool.name, tool.args)
      if (existingTaskId === taskId) {
        return {
          isDuplicate: true,
          previousResult: tool.result
        }
      }
    }
  }
  
  return { isDuplicate: false }
}

/**
 * 检查是否是危险操作
 */
export function isDangerousOperation(toolName: string): boolean {
  return DANGEROUS_TOOLS.includes(toolName)
}

/**
 * 生成危险操作警告
 */
export function generateDangerWarning(
  toolName: string,
  args: Record<string, unknown>
): string {
  const toolDescriptions: Record<string, string> = {
    'delete_file': '删除文件',
    'write_file': '写入文件（会覆盖原有内容）',
    'edit_file': '编辑文件',
    'execute_bash': '执行 shell 命令',
    'bash': '执行 shell 命令'
  }
  
  const description = toolDescriptions[toolName] || toolName
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  
  return `⚠️ **危险操作警告**

操作: ${description}
参数: ${argsStr}

此操作可能：
- 删除重要数据
- 修改现有代码
- 执行系统命令

请确认是否继续？
(回复 "是" 继续，"否" 取消)`
}

/**
 * 获取最近的检查点摘要
 */
export function getRecentCheckpointSummary(
  checkpoints: TaskCheckpoint[],
  count: number = 3
): string {
  if (checkpoints.length === 0) {
    return '暂无已完成的任务'
  }
  
  const recent = checkpoints.slice(-count)
  return recent
    .map((cp, i) => `${i + 1}. ${cp.summary}`)
    .join('\n')
}

/**
 * 构建检查点上下文提示
 */
export function buildCheckpointContext(
  checkpoints: TaskCheckpoint[]
): string {
  if (checkpoints.length === 0) {
    return ''
  }
  
  const lines: string[] = []
  lines.push('【任务历史】')
  
  checkpoints.slice(-5).forEach((cp, i) => {
    lines.push(`\n检查点 ${i + 1} (${new Date(cp.timestamp).toLocaleTimeString()}):`)
    lines.push(`  描述: ${cp.description}`)
    
    if (cp.completedTools.length > 0) {
      lines.push(`  已完成:`)
      cp.completedTools.forEach(tool => {
        lines.push(`    - ${tool.name}: ${tool.result.slice(0, 50)}${tool.result.length > 50 ? '...' : ''}`)
      })
    }
    
    if (cp.keyFindings.length > 0) {
      lines.push(`  关键发现:`)
      cp.keyFindings.forEach(finding => {
        lines.push(`    - ${finding}`)
      })
    }
  })
  
  lines.push('\n注意: 以上任务已完成，无需重复执行。')
  
  return lines.join('\n')
}
