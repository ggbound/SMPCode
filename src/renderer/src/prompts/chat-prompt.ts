/**
 * Chat Mode 系统提示词
 * 智能问答模式 - 只读工具，适合一般性问答和代码分析
 */

import {
  CHAT_MODE_TOOLS,
  TOOL_INVOCATION_FORMAT,
  COMMON_CRITICAL_RULES,
  buildSystemInfoSection
} from './shared'
import type { PromptBuildOptions } from './types'

/**
 * Chat Mode 角色定义
 */
const CHAT_MODE_ROLE = `You are a helpful AI assistant in CHAT MODE.
Your goal is to answer user questions clearly and concisely.
You have LIMITED tool access - you can only READ and EXPLORE, not modify.`

/**
 * Chat Mode 核心原则
 */
const CHAT_MODE_PRINCIPLES = `=== CORE PRINCIPLES ===
1. **NATURAL CONVERSATION**: For general questions and conversations, respond naturally WITHOUT using tools
2. **EXPLICIT TOOL USE**: ONLY use tools when the user explicitly asks you to analyze, read, explore, or work with files
3. **READ-ONLY MODE**: You are in CHAT MODE which is READ-ONLY. You CANNOT create, write, edit, append, delete, or modify files in any way
4. **NO FILE MODIFICATIONS**: If the user asks you to write, create, edit, or delete files, you MUST:
   - Explain that file modification is not supported in chat mode
   - Suggest switching to "智能体模式" (Agent Mode) for file operations
   - Do NOT attempt to use any tool to modify files
5. **BASH RESTRICTIONS**: ONLY use execute_bash when user explicitly asks to run commands like npm, git, etc. NEVER use it for file operations.`

/**
 * Chat Mode 工具使用示例
 */
const CHAT_MODE_EXAMPLES = `=== USAGE EXAMPLES ===
When to use tools:
✓ "帮我分析下这个项目" → Use list_directory, read_file to explore
✓ "查看一下这个文件" → Use read_file
✓ "搜索一下这段代码" → Use search_code
✓ "运行 npm install" → Use execute_bash

When NOT to use tools:
✗ "你好" → Respond naturally
✗ "什么是 React" → Explain without tools
✗ "帮我写个函数" → Explain or suggest Agent Mode
✗ "删除这个文件" → Explain read-only limitation`

/**
 * 构建 Chat Mode 系统提示词
 */
export function buildChatModePrompt(options: PromptBuildOptions): string {
  const { systemInfo, projectContext } = options
  
  const sections: string[] = []
  
  // 1. 角色定义
  sections.push(CHAT_MODE_ROLE)
  sections.push('')
  
  // 2. 系统信息
  sections.push(buildSystemInfoSection(systemInfo.platform, systemInfo.cwd))
  sections.push('')
  
  // 3. 项目上下文（如果有）
  if (projectContext) {
    sections.push('=== PROJECT CONTEXT ===')
    sections.push(projectContext)
    sections.push('')
  }
  
  // 4. 可用工具
  sections.push('=== AVAILABLE TOOLS (READ-ONLY) ===')
  sections.push('You have access to the following tools. ONLY use them when explicitly needed:')
  sections.push('')
  
  for (const tool of CHAT_MODE_TOOLS) {
    sections.push(`${tool.name}: ${tool.description}`)
    if (tool.parameters && Object.keys(tool.parameters).length > 0) {
      sections.push('  Parameters:')
      for (const [paramName, paramInfo] of Object.entries(tool.parameters)) {
        const isRequired = tool.required?.includes(paramName) ?? false
        const reqFlag = isRequired ? ', required' : ''
        sections.push(`    - ${paramName} (${paramInfo.type}${reqFlag}): ${paramInfo.description}`)
      }
    }
    sections.push('')
  }
  
  // 5. 工具调用格式
  sections.push(TOOL_INVOCATION_FORMAT)
  sections.push('')
  
  // 6. 核心原则
  sections.push(CHAT_MODE_PRINCIPLES)
  sections.push('')
  
  // 7. 使用示例
  sections.push(CHAT_MODE_EXAMPLES)
  sections.push('')
  
  // 8. 关键规则
  sections.push(COMMON_CRITICAL_RULES)
  sections.push('')
  
  // 9. 语言要求
  sections.push('=== RESPONSE LANGUAGE ===')
  sections.push('Respond in the same language as the user\'s query. Be concise but thorough.')
  
  return sections.join('\n')
}

/**
 * 获取 Chat Mode 工具列表
 */
export function getChatModeTools() {
  return CHAT_MODE_TOOLS
}

/**
 * 检查工具是否在 Chat Mode 中可用
 */
export function isToolAvailableInChatMode(toolName: string): boolean {
  return CHAT_MODE_TOOLS.some(t => t.name === toolName)
}
