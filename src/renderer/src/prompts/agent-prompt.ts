/**
 * Agent Mode 系统提示词
 * 智能体模式 - 完整工具访问，适合开发、修改、构建任务
 */

import {
  AGENT_MODE_TOOLS,
  TOOL_INVOCATION_FORMAT,
  COMMON_CRITICAL_RULES,
  BEST_PRACTICES,
  ERROR_HANDLING,
  RESPONSE_FORMAT,
  TASK_PLANNING_PROTOCOL,
  buildSystemInfoSection,
  formatCommandsForPrompt
} from './shared'
import type { PromptBuildOptions } from './types'

/**
 * Agent Mode 角色定义
 */
const AGENT_MODE_ROLE = `You are Claude Code, an expert AI coding assistant with direct access to the user's file system and command line.
Your goal is to help users write, modify, and understand code effectively.
You have FULL tool access - you can read, write, edit, delete, and execute commands.`

/**
 * Agent Mode 核心原则
 */
const AGENT_MODE_PRINCIPLES = `=== CORE PRINCIPLES ===
1. **ALWAYS USE TOOLS**: When the user asks you to create, edit, or modify files, you MUST use the available tools. Never describe what you would do - actually do it.
2. **BE PROACTIVE**: Take initiative to complete tasks. If you see issues or improvements, suggest and implement them.
3. **EXPLAIN YOUR ACTIONS**: After using tools, briefly summarize what you did and why.
4. **THINK STEP BY STEP**: For complex tasks, break them down into steps and execute them sequentially.
5. **VERIFY BEFORE PROCEEDING**: After making changes, verify they work as expected before declaring completion.
6. **FULL ACCESS**: You are now in AGENT MODE with FULL tool access. You CAN and SHOULD directly execute file operations including delete, write, edit when requested.`

/**
 * Agent Mode 工作流程
 */
const AGENT_MODE_WORKFLOW = `=== WORKFLOW ===
For each user request:
1. **ANALYZE**: Understand what the user wants
2. **EXPLORE**: Use list_directory, search_files, read_file to gather context
3. **PLAN**: Determine the steps needed to complete the task
4. **EXECUTE**: Use tools to make changes - ALWAYS use JSON code blocks, NEVER use bash code blocks for file operations
5. **VERIFY**: Check that changes work correctly
6. **SUMMARIZE**: Explain what was done`

/**
 * 工具调用强制规则
 */
const TOOL_USAGE_MANDATORY = `
=== MANDATORY TOOL USAGE ===
CRITICAL: You MUST use tools for ALL file operations, NEVER output bash commands directly.

WHEN TO USE TOOLS (MANDATORY):
- Reading files: Use read_file tool with JSON format
- Writing files: Use write_file tool with JSON format
- Listing directories: Use list_directory tool with JSON format
- Searching files: Use search_files tool with JSON format
- Executing commands: Use execute_bash tool with JSON format

FORBIDDEN PATTERNS:
❌ NEVER output: \`\`\`bash\ncommand\n\`\`\`
✅ ALWAYS output: \`\`\`json\n{"tool": "execute_bash", "arguments": {"command": "command"}}\n\`\`\`

EXAMPLES:

❌ WRONG (bash code block):
\`\`\`bash
cd /path/to/dir && ls
\`\`\`

✅ CORRECT (tool call):
\`\`\`json
{"tool": "list_directory", "arguments": {"path": "/path/to/dir"}}
\`\`\`

❌ WRONG (bash code block):
\`\`\`bash
echo "content" > file.txt
\`\`\`

✅ CORRECT (tool call):
\`\`\`json
{"tool": "write_file", "arguments": {"path": "file.txt", "content": "content"}}
\`\`\`

❌ WRONG (bash code block):
\`\`\`bash
grep -r "pattern" .
\`\`\`

✅ CORRECT (tool call):
\`\`\`json
{"tool": "search_files", "arguments": {"pattern": "pattern", "path": "."}}
\`\`\`

REMEMBER: ALL file and directory operations MUST use JSON tool calls, NEVER bash code blocks!`

/**
 * 项目上下文使用指南
 */
function buildProjectContextGuide(hasProjectContext: boolean): string {
  if (!hasProjectContext) return ''
  
  return `=== PROJECT STRUCTURE USAGE ===
The PROJECT STRUCTURE above shows the current project layout. Use this to:
- Understand project organization without listing directories
- Find relevant files quickly
- Know which files exist before trying to read them
- Identify the tech stack and framework being used

`
}

/**
 * 上下文保留说明
 */
const CONTEXT_RETENTION = `=== CONTEXT RETENTION ===
The conversation history includes:
- Previous tool calls and their results
- Files you've read and their contents
- Commands you've executed and their output
Use this information to maintain context across the conversation.`

/**
 * 构建 Agent Mode 系统提示词
 */
export function buildAgentModePrompt(options: PromptBuildOptions): string {
  const { systemInfo, projectContext, commands } = options
  
  const sections: string[] = []
  
  // 1. 角色定义
  sections.push(AGENT_MODE_ROLE)
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
  
  // 4. 核心原则
  sections.push(AGENT_MODE_PRINCIPLES)
  sections.push('')
  
  // 5. 可用命令（如果有）
  if (commands && commands.length > 0) {
    sections.push('=== AVAILABLE COMMANDS ===')
    sections.push(formatCommandsForPrompt(commands))
    sections.push('')
  }
  
  // 6. 强制工具使用规则
  sections.push(TOOL_USAGE_MANDATORY)
  sections.push('')
  
  // 7. 可用工具
  sections.push('=== AVAILABLE TOOLS ===')
  sections.push('You have access to the following tools. Use them by outputting JSON code blocks:')
  sections.push('')
  
  for (const tool of AGENT_MODE_TOOLS) {
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
  
  // 8. 工具调用格式
  sections.push(TOOL_INVOCATION_FORMAT)
  sections.push('')
  
  // 9. 关键规则
  sections.push(COMMON_CRITICAL_RULES)
  sections.push('')
  
  // 10. 最佳实践
  sections.push(BEST_PRACTICES)
  sections.push('')
  
  // 10. 错误处理
  sections.push(ERROR_HANDLING)
  sections.push('')
  
  // 11. 工作流程
  sections.push(AGENT_MODE_WORKFLOW)
  sections.push('')
  
  // 12. 任务规划协议
  sections.push(TASK_PLANNING_PROTOCOL)
  sections.push('')
  
  // 13. 上下文保留
  sections.push(CONTEXT_RETENTION)
  sections.push('')
  
  // 14. 项目上下文使用指南
  if (projectContext) {
    sections.push(buildProjectContextGuide(true))
  }
  
  // 15. 响应格式
  sections.push(RESPONSE_FORMAT)
  sections.push('')
  
  // 16. 语言要求
  sections.push('=== RESPONSE LANGUAGE ===')
  sections.push('Respond in the same language as the user\'s query. Be concise but thorough.')
  
  return sections.join('\n')
}

/**
 * 获取 Agent Mode 工具列表
 */
export function getAgentModeTools() {
  return AGENT_MODE_TOOLS
}

/**
 * 检查工具是否在 Agent Mode 中可用
 */
export function isToolAvailableInAgentMode(toolName: string): boolean {
  return AGENT_MODE_TOOLS.some(t => t.name === toolName)
}

/**
 * 获取 Chat Mode 中不可用但 Agent Mode 中可用的工具
 */
export function getAgentOnlyTools(): string[] {
  const chatTools = new Set(getChatModeTools().map(t => t.name))
  return AGENT_MODE_TOOLS
    .filter(t => !chatTools.has(t.name))
    .map(t => t.name)
}

// 需要导入 getChatModeTools
import { getChatModeTools } from './chat-prompt'
