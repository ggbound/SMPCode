/**
 * 智能上下文管理系统
 * 解决连续对话中的上下文丢失和重复执行问题
 */

import type { KiloMessage, KiloToolCall } from '../store/kiloStore'

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  isCodeBlock?: boolean
  codeLanguage?: string
  isToolCall?: boolean
  toolName?: string
  importance: number // 0-10，用于智能筛选
}

export interface ContextSummary {
  userIntent: 'continue' | 'new_task' | 'reference_previous' | 'unknown'
  referencedTopics: string[]
  confidence: number
}

/**
 * 工具执行状态
 */
export interface ToolExecutionState {
  toolCallId: string
  toolName: string
  status: 'pending' | 'completed' | 'failed'
  result?: string
  error?: string
  timestamp: number
}

/**
 * 对话状态跟踪
 */
export interface ConversationState {
  completedTasks: string[] // 已完成的任务描述
  toolExecutions: ToolExecutionState[] // 工具执行历史
  keyFindings: string[] // 关键发现
  lastAction: string // 最后执行的操作
}

/**
 * 分析用户消息意图
 */
export function analyzeUserIntent(
  currentMessage: string,
  historyMessages: KiloMessage[]
): ContextSummary {
  const lowerMsg = currentMessage.toLowerCase()
  
  // 辅助函数：获取消息内容字符串
  const getMessageContent = (content: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>): string => {
    if (typeof content === 'string') return content
    return content
      .filter((part): part is {type: 'text'; text: string} => part.type === 'text')
      .map(part => part.text)
      .join(' ')
  }
  
  // 继续类关键词
  const continueKeywords = [
    '继续', '帮我', '进行', '改进', '优化', '修改', '完善',
    'continue', 'help me', 'improve', 'optimize', 'modify', 'refine',
    '完善', '调整', '更新', '修复', '改一下', '调整一下'
  ]
  
  // 引用类关键词
  const referenceKeywords = [
    '刚才', '之前', '上面', '那个', '这个', '生成的',
    'just now', 'previous', 'above', 'that', 'this', 'generated',
    '刚才的', '之前的', '上面的', '之前生成的'
  ]
  
  // 新任务关键词
  const newTaskKeywords = [
    '新建', '创建', '开始', '初始化', '新的', '删除', '移除', '删掉', '删去', '清空',
    'create new', 'start', 'init', 'new', 'delete', 'remove', 'clear', 'clean'
  ]
  
  // 重复检测关键词
  const repeatKeywords = [
    '再', '重新', '又', '还是', 'again', 'retry', '重新执行'
  ]
  
  let intent: ContextSummary['userIntent'] = 'unknown'
  let confidence = 0.5
  const referencedTopics: string[] = []
  
  // 检测重复意图
  if (repeatKeywords.some(k => lowerMsg.includes(k))) {
    intent = 'continue'
    confidence = 0.9
  }
  
  // 检测继续意图
  if (continueKeywords.some(k => lowerMsg.includes(k))) {
    intent = 'continue'
    confidence = 0.8
  }
  
  // 检测引用意图
  if (referenceKeywords.some(k => lowerMsg.includes(k))) {
    intent = 'reference_previous'
    confidence = 0.9
    
    // 从历史消息中提取可能的引用主题
    const lastAssistantMsg = historyMessages
      .filter(m => m.role === 'assistant')
      .pop()
    
    if (lastAssistantMsg) {
      const content = getMessageContent(lastAssistantMsg.content)
      const codeBlocks = extractCodeBlocks(content)
      codeBlocks.forEach(block => {
        if (block.language) {
          referencedTopics.push(`${block.language}代码`)
        }
      })
    }
  }
  
  // 检测新任务意图
  if (newTaskKeywords.some(k => lowerMsg.includes(k))) {
    intent = 'new_task'
    confidence = 0.7
  }
  
  return {
    userIntent: intent,
    referencedTopics,
    confidence
  }
}

/**
 * 提取代码块
 */
function extractCodeBlocks(content: string): Array<{language?: string; code: string}> {
  const blocks: Array<{language?: string; code: string}> = []
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  
  let match
  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1],
      code: match[2].trim()
    })
  }
  
  return blocks
}

/**
 * 分析对话状态
 * 提取已完成的任务和关键发现
 */
export function analyzeConversationState(messages: KiloMessage[]): ConversationState {
  const state: ConversationState = {
    completedTasks: [],
    toolExecutions: [],
    keyFindings: [],
    lastAction: ''
  }
  
  const getMessageContent = (content: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>): string => {
    if (typeof content === 'string') return content
    return content
      .filter((part): part is {type: 'text'; text: string} => part.type === 'text')
      .map(part => part.text)
      .join(' ')
  }
  
  // 遍历消息，提取工具执行和结果
  messages.forEach((msg, index) => {
    const content = getMessageContent(msg.content)
    
    // 提取工具调用
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      msg.toolCalls.forEach(toolCall => {
        if (toolCall.status === 'completed' || toolCall.status === 'failed') {
          // 转换 result 为字符串
          const resultStr = toolCall.result !== undefined ? String(toolCall.result) : undefined
          
          state.toolExecutions.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            status: toolCall.status,
            result: resultStr,
            error: toolCall.error,
            timestamp: msg.timestamp
          })
          
          // 记录完成的任务
          if (toolCall.status === 'completed') {
            const taskDesc = `${toolCall.name}: ${summarizeToolResult(toolCall.name, resultStr)}`
            if (!state.completedTasks.includes(taskDesc)) {
              state.completedTasks.push(taskDesc)
            }
          }
        }
      })
    }
    
    // 提取关键发现（从 AI 回复中）
    if (msg.role === 'assistant' && content.length > 50) {
      // 查找"发现"、"找到"、"完成"等关键词
      const findingPatterns = [
        /发现[了\s]*([^。\n]+)/,
        /找到[了\s]*([^。\n]+)/,
        /完成[了\s]*([^。\n]+)/,
        /已[经\s]*([^。\n]+)/,
        /问题[是\s]*([^。\n]+)/
      ]
      
      findingPatterns.forEach(pattern => {
        const match = content.match(pattern)
        if (match && match[1].length > 10 && match[1].length < 100) {
          const finding = match[1].trim()
          if (!state.keyFindings.includes(finding)) {
            state.keyFindings.push(finding)
          }
        }
      })
    }
    
    // 记录最后操作
    if (index === messages.length - 1 && msg.role === 'assistant') {
      state.lastAction = content.slice(0, 200)
    }
  })
  
  return state
}

/**
 * 摘要工具执行结果
 */
function summarizeToolResult(toolName: string, result?: string): string {
  if (!result) return '无结果'
  
  const lines = result.split('\n').filter(l => l.trim())
  
  switch (toolName) {
    case 'read_file':
    case 'file_read':
      return `读取了 ${lines.length} 行`
    
    case 'list_directory':
      const fileCount = lines.filter(l => l.includes('File:') || !l.includes('Dir:')).length
      const dirCount = lines.filter(l => l.includes('Dir:')).length
      return `${dirCount} 个目录, ${fileCount} 个文件`
    
    case 'search_files':
    case 'search_code':
    case 'grep':
      return `找到 ${lines.length} 个匹配`
    
    case 'write_file':
    case 'file_write':
      return `写入 ${lines.length} 行`
    
    case 'delete_file':
      return '已删除'
    
    case 'execute_bash':
    case 'bash':
      return result.slice(0, 50) + (result.length > 50 ? '...' : '')
    
    default:
      return result.slice(0, 50) + (result.length > 50 ? '...' : '')
  }
}

/**
 * 检查是否是重复请求
 */
export function isDuplicateRequest(
  currentMessage: string,
  state: ConversationState
): boolean {
  const lowerMsg = currentMessage.toLowerCase()

  // 如果用户意图明确是新任务，不认为是重复
  const newTaskKeywords = ['删除', '移除', '删掉', '删去', '清空', 'delete', 'remove', 'clear', 'clean']
  if (newTaskKeywords.some(k => lowerMsg.includes(k))) {
    // 删除操作通常不是重复，而是对之前操作的补充
    return false
  }

  // 检查是否请求了已完成的任务
  for (const task of state.completedTasks) {
    const taskLower = task.toLowerCase()
    // 提取工具名
    const toolName = taskLower.split(':')[0]
    // 只有当操作类型和工具都匹配时才认为是重复
    if (lowerMsg.includes(toolName)) {
      // 检查是否包含重复关键词
      const repeatKeywords = ['再', '重新', '又', '还是', 'again', 'retry', '重新执行', '重新创建']
      if (repeatKeywords.some(k => lowerMsg.includes(k))) {
        return true
      }
    }
  }

  return false
}

/**
 * 智能压缩历史消息
 * 保留关键信息，丢弃冗余内容
 */
export function compressContext(
  messages: KiloMessage[],
  maxTokens: number = 4000,
  intent: ContextSummary
): ContextMessage[] {
  if (messages.length === 0) return []
  
  const processed: ContextMessage[] = []
  const state = analyzeConversationState(messages)
  
  // 1. 处理系统消息（保留）
  const systemMessages = messages.filter(m => m.role === 'system')
  systemMessages.forEach(m => {
    processed.push({
      role: 'system',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: m.timestamp,
      importance: 10
    })
  })
  
  // 2. 添加对话状态摘要（如果已完成任务较多）
  if (state.completedTasks.length > 0) {
    const stateSummary = `【已完成任务】\n${state.completedTasks.slice(-5).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    processed.push({
      role: 'system',
      content: stateSummary,
      timestamp: Date.now(),
      importance: 9
    })
  }
  
  // 3. 添加关键发现
  if (state.keyFindings.length > 0) {
    const findingsSummary = `【关键发现】\n${state.keyFindings.slice(-3).join('\n')}`
    processed.push({
      role: 'system',
      content: findingsSummary,
      timestamp: Date.now(),
      importance: 8
    })
  }
  
  // 4. 处理用户和助手消息
  const chatMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')
  
  // 根据意图决定保留策略
  if (intent.userIntent === 'continue' || intent.userIntent === 'reference_previous') {
    // 保留最近的几轮对话
    const recentMessages = chatMessages.slice(-6)
    
    recentMessages.forEach((m, index) => {
      const isLast = index === recentMessages.length - 1
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      
      // 提取代码块
      const codeBlocks = extractCodeBlocks(content)
      
      if (codeBlocks.length > 0) {
        // 消息包含代码块，保留完整内容
        processed.push({
          role: m.role as 'user' | 'assistant',
          content,
          timestamp: m.timestamp,
          isCodeBlock: true,
          importance: isLast ? 10 : 8
        })
      } else if (m.role === 'assistant' && content.length > 500 && !isLast) {
        // 长回复，如果是之前的消息则摘要
        processed.push({
          role: 'assistant',
          content: summarizeMessage(content),
          timestamp: m.timestamp,
          importance: 6
        })
      } else {
        // 普通消息
        processed.push({
          role: m.role as 'user' | 'assistant',
          content,
          timestamp: m.timestamp,
          importance: isLast ? 9 : 7
        })
      }
    })
  } else {
    // 新任务，只保留系统上下文和最近的用户消息
    const lastUserMsg = chatMessages.filter(m => m.role === 'user').pop()
    if (lastUserMsg) {
      const content = typeof lastUserMsg.content === 'string' 
        ? lastUserMsg.content 
        : JSON.stringify(lastUserMsg.content)
      
      processed.push({
        role: 'user',
        content: `[新任务] ${content}`,
        timestamp: lastUserMsg.timestamp,
        importance: 8
      })
    }
  }
  
  // 5. 根据重要性排序和截断
  return processed
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 20)
    .sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * 摘要长消息
 */
function summarizeMessage(content: string): string {
  const lines = content.split('\n')
  
  // 保留前3行和包含关键信息的行
  const importantLines = lines.filter(line => 
    line.includes('完成') || 
    line.includes('创建') || 
    line.includes('生成') ||
    line.includes('文件') ||
    line.includes('代码') ||
    line.includes('发现') ||
    line.includes('找到')
  )
  
  if (importantLines.length > 0) {
    return `[摘要] ${importantLines.slice(0, 3).join('；')}`
  }
  
  return `[摘要] ${lines.slice(0, 2).join(' ')}...`
}

/**
 * 构建增强的系统提示词
 */
export function buildContextualSystemPrompt(
  basePrompt: string,
  context: ContextMessage[],
  intent: ContextSummary,
  state?: ConversationState
): string {
  let enhancedPrompt = basePrompt
  
  // 添加对话状态信息
  if (state && state.completedTasks.length > 0) {
    enhancedPrompt += `\n\n【对话状态】\n以下任务已在本对话中完成，无需重复执行：\n${state.completedTasks.slice(-5).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
  }
  
  if (intent.userIntent === 'continue' || intent.userIntent === 'reference_previous') {
    const recentContext = context
      .filter(m => m.role !== 'system')
      .slice(-4)
      .map(m => `${m.role}: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
      .join('\n\n')
    
    enhancedPrompt += `\n\n【对话上下文】\n用户正在继续之前的对话。以下是最近的对话摘要：\n\n${recentContext}\n\n请基于以上上下文继续帮助用户。`
  }
  
  return enhancedPrompt
}

/**
 * 检查是否需要完整上下文
 */
export function shouldIncludeFullContext(
  currentMessage: string,
  historyMessages: KiloMessage[]
): boolean {
  const intent = analyzeUserIntent(currentMessage, historyMessages)
  const state = analyzeConversationState(historyMessages)
  
  // 如果检测到重复请求，需要包含上下文以避免重复
  if (isDuplicateRequest(currentMessage, state)) {
    return true
  }
  
  // 只有明确意图为继续或引用时才包含历史
  // 移除 confidence > 0.8 的条件，避免误判
  return (
    intent.userIntent === 'continue' ||
    intent.userIntent === 'reference_previous'
  )
}

/**
 * 生成重复请求警告
 */
export function generateDuplicateWarning(
  currentMessage: string,
  state: ConversationState
): string | null {
  if (!isDuplicateRequest(currentMessage, state)) {
    return null
  }
  
  // 找到可能重复的任务
  const lowerMsg = currentMessage.toLowerCase()
  const duplicateTask = state.completedTasks.find(task => {
    const toolName = task.toLowerCase().split(':')[0]
    return lowerMsg.includes(toolName)
  })
  
  if (duplicateTask) {
    return `⚠️ 注意：检测到您可能想要重复执行已完成的任务。\n\n已完成的任务：${duplicateTask}\n\n如果您想查看结果，请说"显示之前的结果"。\n如果您确实需要重新执行，请说"重新执行"。`
  }
  
  return null
}
