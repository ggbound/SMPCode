/**
 * Inline AI Service - 代码内联 AI 服务
 * 支持选中代码后询问 AI
 * 参考 Cursor 的 Cmd+K 内联编辑功能
 */

import log from 'electron-log'
import { BrowserWindow } from 'electron'

// 内联 AI 会话
interface InlineAISession {
  id: string
  filePath: string
  selectedCode: string
  startLine: number
  endLine: number
  language: string
  timestamp: number
  status: 'pending' | 'processing' | 'completed' | 'error'
  result?: string
}

// 会话存储
const sessions = new Map<string, InlineAISession>()

/**
 * 创建内联 AI 会话
 */
export function createInlineSession(
  filePath: string,
  selectedCode: string,
  startLine: number,
  endLine: number,
  language: string
): InlineAISession {
  const id = `inline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const session: InlineAISession = {
    id,
    filePath,
    selectedCode,
    startLine,
    endLine,
    language,
    timestamp: Date.now(),
    status: 'pending'
  }
  
  sessions.set(id, session)
  
  // 清理旧会话（保留最近 20 个）
  const sortedSessions = Array.from(sessions.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
  
  if (sortedSessions.length > 20) {
    for (const [key] of sortedSessions.slice(20)) {
      sessions.delete(key)
    }
  }
  
  log.info(`[InlineAI] Created session: ${id} for ${filePath}:${startLine}-${endLine}`)
  return session
}

/**
 * 获取会话
 */
export function getInlineSession(id: string): InlineAISession | null {
  return sessions.get(id) || null
}

/**
 * 更新会话状态
 */
export function updateInlineSession(
  id: string,
  updates: Partial<InlineAISession>
): InlineAISession | null {
  const session = sessions.get(id)
  if (!session) return null
  
  Object.assign(session, updates)
  sessions.set(id, session)
  
  return session
}

/**
 * 删除会话
 */
export function deleteInlineSession(id: string): boolean {
  const deleted = sessions.delete(id)
  if (deleted) {
    log.info(`[InlineAI] Deleted session: ${id}`)
  }
  return deleted
}

/**
 * 获取所有会话
 */
export function getAllInlineSessions(): InlineAISession[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * 生成提示词
 */
export function generatePrompt(
  selectedCode: string,
  userInstruction: string,
  language: string
): string {
  return `You are an expert ${language} programmer. I have selected the following code:

\`\`\`${language}
${selectedCode}
\`\`\`

${userInstruction}

Please provide your response in one of these formats:

1. If you want to replace the code:
   \`\`\`${language}
   [your new code here]
   \`\`\`

2. If you want to explain or answer without code:
   Just provide your explanation.

3. If you want to suggest edits:
   Explain what should be changed and why.

Be concise and helpful.`
}

/**
 * 解析 AI 响应
 */
export function parseAIResponse(response: string): {
  type: 'replace' | 'explain' | 'suggest'
  content: string
  code?: string
} {
  // 检查是否包含代码块
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  const codeBlocks: Array<{ language?: string; code: string }> = []
  
  let match
  while ((match = codeBlockRegex.exec(response)) !== null) {
    codeBlocks.push({
      language: match[1],
      code: match[2].trim()
    })
  }
  
  if (codeBlocks.length > 0) {
    // 有代码块，认为是替换
    return {
      type: 'replace',
      content: response,
      code: codeBlocks[0].code
    }
  }
  
  // 检查是否包含建议关键词
  const suggestKeywords = ['should', 'could', 'might', 'consider', 'suggest', 'recommend']
  const hasSuggest = suggestKeywords.some(kw => response.toLowerCase().includes(kw))
  
  if (hasSuggest) {
    return {
      type: 'suggest',
      content: response
    }
  }
  
  // 否则是解释
  return {
    type: 'explain',
    content: response
  }
}

/**
 * 应用 AI 建议
 */
export async function applyAIResult(
  sessionId: string,
  window: BrowserWindow
): Promise<boolean> {
  const session = sessions.get(sessionId)
  if (!session || !session.result) {
    return false
  }
  
  try {
    const parsed = parseAIResponse(session.result)
    
    if (parsed.type === 'replace' && parsed.code) {
      // 发送替换命令到前端
      window.webContents.send('inline-ai:replace', {
        sessionId,
        filePath: session.filePath,
        startLine: session.startLine,
        endLine: session.endLine,
        newCode: parsed.code
      })
      
      log.info(`[InlineAI] Applied replacement for session: ${sessionId}`)
      return true
    }
    
    return false
  } catch (error) {
    log.error(`[InlineAI] Failed to apply result:`, error)
    return false
  }
}

/**
 * 获取会话描述
 */
export function getSessionDescription(sessionId: string): string | null {
  const session = sessions.get(sessionId)
  if (!session) return null
  
  const lines = session.endLine - session.startLine + 1
  return `${session.language} ${lines} lines (${session.startLine}-${session.endLine})`
}
