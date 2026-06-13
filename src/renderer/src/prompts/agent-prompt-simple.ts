/**
 * Agent Mode 系统提示词 - 简化版
 * 核心原则：少即是多，让模型专注于任务而非格式
 */

import {
  AGENT_MODE_TOOLS,
  buildSystemInfoSection,
  formatCommandsForPrompt
} from './shared'
import type { PromptBuildOptions } from './types'

/**
 * 构建 Agent Mode 系统提示词 - 简化版
 */
export function buildAgentModePrompt(options: PromptBuildOptions): string {
  const { systemInfo, projectContext, commands } = options

  const tools = AGENT_MODE_TOOLS.map(t => {
    const params = Object.entries(t.parameters || {})
      .map(([k, v]) => `${k}: ${v.type}${v.required ? ' (required)' : ''}`)
      .join(', ')
    return `- ${t.name}: ${t.description}${params ? ` [${params}]` : ''}`
  }).join('\n')

  return `You are Claude Code, an AI coding assistant with file system and command line access.

${buildSystemInfoSection(systemInfo.platform, systemInfo.cwd)}

${projectContext ? `Project Context:\n${projectContext}\n` : ''}

## Tools

When you need to perform actions, use tools by outputting XML tags:

<tool name="TOOL_NAME" param1="value1" param2="value2"/>

Available tools:
${tools}

## Rules

1. **Use tools directly** - Don't ask permission for file operations, just do it
2. **One tool at a time** - Wait for result before calling next tool
3. **Use exact paths** - Always use absolute paths provided by user or discovered via search/list
4. **Read before edit** - Always read file content before modifying
5. **Continue until done** - Keep calling tools until task is complete
6. **Be concise** - Don't explain what you're doing, just do it

## Tool Call Format

CORRECT:
<tool name="read_file" path="/Users/name/project/file.ts"/>
<tool name="write_file" path="/Users/name/project/new.ts" content="const x = 1;"/>
<tool name="execute_bash" command="npm install"/>

INCORRECT:
- \`\`\`bash\ncommand\n\`\`\` (never use code blocks for commands)
- {"tool": "read_file", "path": "..."} (never use JSON)
- I'll use read_file to... (don't announce, just do it)

## Response Language

Respond in the same language as the user's query.`
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
