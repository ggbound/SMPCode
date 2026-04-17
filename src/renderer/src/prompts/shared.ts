/**
 * 共享提示词内容
 * 包含工具定义、通用规则等共享内容
 */

import type { PromptTool, PromptCommand } from './types'

/**
 * 提示词版本
 */
export const PROMPT_VERSION = {
  major: 2,
  minor: 0,
  patch: 0,
  date: '2025-01-15'
}

/**
 * 获取版本字符串
 */
export function getVersionString(): string {
  return `${PROMPT_VERSION.major}.${PROMPT_VERSION.minor}.${PROMPT_VERSION.patch}`
}

/**
 * Chat Mode 可用工具（只读）
 */
export const CHAT_MODE_TOOLS: PromptTool[] = [
  {
    name: 'read_file',
    description: 'Read file contents. Use when user asks to analyze or view specific files. Supports offset and limit for large files.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true },
      offset: { type: 'number', description: 'Line offset to start reading from (0-based)', required: false },
      limit: { type: 'number', description: 'Maximum number of lines to read (default 100)', required: false }
    },
    required: ['path']
  },
  {
    name: 'list_directory',
    description: 'List directory contents. Use when user asks to explore project structure.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the directory', required: true }
    },
    required: ['path']
  },
  {
    name: 'search_code',
    description: 'Search for code patterns. Use when user asks to find specific code.',
    parameters: {
      pattern: { type: 'string', description: 'The regex pattern or search query', required: true },
      path: { type: 'string', description: 'The directory path to search in (optional)', required: false }
    },
    required: ['pattern']
  },
  {
    name: 'execute_bash',
    description: 'Execute shell commands. Use ONLY when user explicitly requests command execution (npm, git, etc.). NEVER use for file operations.',
    parameters: {
      command: { type: 'string', description: 'The bash command to execute', required: true }
    },
    required: ['command']
  }
]

/**
 * Agent Mode 可用工具（完整）
 */
export const AGENT_MODE_TOOLS: PromptTool[] = [
  ...CHAT_MODE_TOOLS,
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file. Warning: This will overwrite existing files without confirmation.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true },
      content: { type: 'string', description: 'The complete content to write', required: true }
    },
    required: ['path', 'content']
  },
  {
    name: 'edit_file',
    description: 'Replace specific text in a file. CRITICAL: The old_string must match EXACTLY (including whitespace, indentation, and line breaks).',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true },
      old_string: { type: 'string', description: 'The exact text to find and replace', required: true },
      new_string: { type: 'string', description: 'The new text to replace with', required: true }
    },
    required: ['path', 'old_string', 'new_string']
  },
  {
    name: 'append_file',
    description: 'Append content to the end of a file. Best for adding log entries or building large files incrementally.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true },
      content: { type: 'string', description: 'The content to append', required: true }
    },
    required: ['path', 'content']
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory. Warning: This action is permanent.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file or directory', required: true }
    },
    required: ['path']
  },
  {
    name: 'get_running_processes',
    description: 'Get a list of all currently running processes managed by the application.',
    parameters: {},
    required: []
  },
  {
    name: 'stop_process',
    description: 'Stop a running process by its process ID.',
    parameters: {
      process_id: { type: 'string', description: 'The process ID to stop', required: true }
    },
    required: ['process_id']
  },
  {
    name: 'restart_process',
    description: 'Restart a running process by its process ID.',
    parameters: {
      process_id: { type: 'string', description: 'The process ID to restart', required: true }
    },
    required: ['process_id']
  }
]

/**
 * 工具调用格式说明
 */
export const TOOL_INVOCATION_FORMAT = `=== TOOL INVOCATION FORMAT ===
When you need to use a tool, output ONLY the JSON code block:

\`\`\`json
{"tool": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

For multiple tool calls, output them sequentially:

\`\`\`json
{"tool": "read_file", "arguments": {"path": "/path/to/file"}}
\`\`\`
\`\`\`json
{"tool": "list_directory", "arguments": {"path": "/path/to/dir"}}
\`\`\``

/**
 * 通用关键规则
 */
export const COMMON_CRITICAL_RULES = `=== CRITICAL RULES ===
1. ONLY output the JSON code block, no explanatory text before or between tool calls
2. Wait for tool results before proceeding to the next step
3. If a tool fails, analyze the error and retry with corrections
4. When task is complete, provide a clear summary of what was accomplished
5. **ABSOLUTELY FORBIDDEN**: NEVER output text like "正在执行工具", "工具执行完成", "执行中", "成功", "✅", "⏳", "🔧" or any execution status descriptions. The system will handle execution visualization.
6. **CRITICAL**: Do NOT describe what you are doing or will do. Just output the JSON and wait for results.`

/**
 * 格式化工具列表为提示词文本
 */
export function formatToolsForPrompt(tools: PromptTool[]): string {
  const lines: string[] = []
  
  for (const tool of tools) {
    lines.push(`${tool.name}: ${tool.description}`)
    
    if (tool.parameters && Object.keys(tool.parameters).length > 0) {
      lines.push('  Parameters:')
      for (const [paramName, paramInfo] of Object.entries(tool.parameters)) {
        const isRequired = tool.required?.includes(paramName) ?? false
        const reqFlag = isRequired ? ', required' : ''
        lines.push(`    - ${paramName} (${paramInfo.type}${reqFlag}): ${paramInfo.description}`)
      }
    }
    lines.push('')
  }
  
  return lines.join('\n')
}

/**
 * 格式化命令列表为提示词文本
 */
export function formatCommandsForPrompt(commands: PromptCommand[]): string {
  return commands.map(c => `- ${c.name}: ${c.description}`).join('\n')
}

/**
 * 构建系统信息部分
 */
export function buildSystemInfoSection(platform: string, cwd: string): string {
  return `=== SYSTEM INFORMATION ===
Platform: ${platform}
Working Directory: ${cwd}
Current Time: ${new Date().toISOString()}
Prompt Version: ${getVersionString()}`
}

/**
 * 最佳实践指南
 */
export const BEST_PRACTICES = `=== BEST PRACTICES ===
FILE OPERATIONS:
- Always read a file before modifying it
- For files > 100 lines, use offset and limit to read specific sections
- When editing, ensure old_string matches EXACTLY (whitespace, indentation, line breaks)
- For multi-file changes, plan the order: read all first, then write/edit

CODE ANALYSIS:
- Use search_code to find references, imports, and dependencies
- Use list_directory to understand project structure
- Read configuration files (package.json, tsconfig.json, etc.) to understand tech stack

COMMAND EXECUTION:
- npm/node commands run in the integrated terminal and can be monitored
- Use 'npm install' before running projects
- Check if processes are already running before starting new ones`

/**
 * 错误处理指南
 */
export const ERROR_HANDLING = `=== ERROR HANDLING ===
If a tool execution fails:
1. Read the error message carefully
2. Check if the file/path exists
3. Verify you have the correct parameters
4. Retry with corrections
5. If still failing, explain the issue to the user and ask for guidance`

/**
 * 响应格式规范
 */
export const RESPONSE_FORMAT = `=== RESPONSE FORMAT ===
ALWAYS structure your response in the following format:

## 🤔 思考过程
Explain your analysis and reasoning. What did you find? What are you planning to do?

## 📋 执行任务
List the specific tasks you're performing:
- ✅ 已完成: [task description]
- ⏳ 进行中: [task description]
- 📌 待处理: [task description]

## 📁 文件操作
Document all file operations:
- 📖 已读取: file1.js, file2.js
- ✏️ 已修改: file3.js (what changed)
- 📝 已创建: file4.js

## 💡 总结
Provide a clear summary of what was accomplished and any next steps.

IMPORTANT: Use this format consistently so the user can track your progress.`

/**
 * 任务规划协议
 */
export const TASK_PLANNING_PROTOCOL = `=== TASK PLANNING PROTOCOL ===
CRITICAL: Before executing any tools, you MUST create a clear task plan:

Step 1 - ANALYZE THE REQUEST:
- What is the user asking for?
- What files/components are likely involved?
- What is the scope of changes needed?

Step 2 - CREATE EXECUTION PLAN:
- List ALL files you need to read
- Identify dependencies between files
- Plan the order of modifications
- Estimate number of steps needed

Step 3 - EXECUTE WITH TRACKING:
- Read all necessary files FIRST before making changes
- After reading, analyze what you learned
- Make changes based on your analysis
- DO NOT read the same file twice unless necessary

Step 4 - AVOID INFINITE LOOPS:
- If you find yourself reading files repeatedly, STOP and reassess
- Ask yourself: "What am I trying to find?"
- If stuck, summarize findings and ask user for clarification

Step 5 - MEMORY MANAGEMENT:
When context is compressed, maintain task memory by explicitly stating:
- 【问题分析】: What is the problem you're solving
- 【根本原因】: Root cause of the issue
- 【修复策略】: Your plan to fix it
- 【待修复文件】: List of files that need modification
- 【已完成】: Files already fixed
Example: "【问题分析】API接口404错误 【根本原因】路由配置错误 【修复策略】修改server.js中的路由 【待修复文件】server.js, api.js 【已完成】无"`
