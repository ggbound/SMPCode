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
 * 注意：工具名称必须与后端 cli-chat-service.ts 中注册的工具一致
 */
export const CHAT_MODE_TOOLS: PromptTool[] = [
  {
    name: 'read_file',  // ✅ 修复：使用正确的工具名称
    description: 'Read file contents. Use when user asks to analyze or view specific files.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true }
    },
    required: ['path']
  },
  {
    name: 'list_directory',
    description: 'List directory contents. Use when user asks to explore project structure.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the directory', required: false }
    },
    required: []
  },
  {
    name: 'search_files',  // ✅ 修复：使用正确的工具名称
    description: 'Find files matching a pattern. Use when user asks to find specific files.',
    parameters: {
      pattern: { type: 'string', description: 'The glob pattern to match', required: true }
    },
    required: ['pattern']
  },
  {
    name: 'execute_bash',  // ✅ 修复：使用正确的工具名称
    description: 'Execute shell commands. Use ONLY when user explicitly requests command execution (npm, git, etc.). NEVER use for file operations.',
    parameters: {
      command: { type: 'string', description: 'The bash command to execute', required: true }
    },
    required: ['command']
  },
  {
    name: 'list_reminders',
    description: 'List all scheduled reminders. Use when user asks to check scheduled tasks or reminders.',
    parameters: {},
    required: []
  },
  {
    name: 'add_reminder',
    description: 'Add a scheduled reminder. You MUST analyze the natural language time expression and provide structured data directly!',
    parameters: {
      content: { type: 'string', description: 'The reminder message content', required: true },
      cron_expression: { type: 'string', description: 'Standard node-cron format: "minute hour day month weekday". Examples: "0 10 * * *" (every day at 10am), "0 9 * * 1-5" (weekdays at 9am), "14 11 25 6 *" (June 25 at 11:14am). IMPORTANT: For one-time reminders, use specific day/month!', required: true },
      display_time: { type: 'string', description: 'Human-readable time description in Chinese, e.g., "每天上午10点", "工作日9点", "6月25日上午11点14分", "今天11点14分", "明天下午3点半"', required: true },
      is_one_time: { type: 'boolean', description: 'Whether this is a one-time reminder (true for "今天", "明天", "待会", etc. / false for repeating like "每天", "每周"). REMINDER WILL BE DELETED AFTER TRIGGERING IF TRUE!', required: true },
      schedule_type: { type: 'string', description: 'Schedule type: "today" (今天/明天/待会), "daily" (每天), "workday" (工作日), "weekly" (每周), "hourly" (每小时), "custom" (其他)', required: true },
      description: { type: 'string', description: 'Optional description or notes for this reminder', required: false }
    },
    required: ['content', 'cron_expression', 'display_time', 'is_one_time', 'schedule_type']
  }
]

/**
 * Agent Mode 可用工具（完整）
 * 注意：工具名称必须与后端 cli-chat-service.ts 中注册的工具一致
 */
export const AGENT_MODE_TOOLS: PromptTool[] = [
  ...CHAT_MODE_TOOLS,
  {
    name: 'write_file',  // ✅ 修复：使用正确的工具名称
    description: 'Create a new file or overwrite an existing file. Warning: This will overwrite existing files without confirmation.',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the file', required: true },
      content: { type: 'string', description: 'The complete content to write', required: true }
    },
    required: ['path', 'content']
  },
  {
    name: 'browse_website',
    description: 'Open a website URL and extract its content for analysis. Use this when you need to read web pages, documentation, or any online content. The tool will load the page in a hidden browser, wait for JavaScript to execute, and extract the main text content.',
    parameters: {
      url: { type: 'string', description: 'The URL to open. Can be a full URL (https://example.com) or just the domain (example.com)', required: true },
      wait_for_selector: { type: 'string', description: 'Optional CSS selector to wait for before extracting content. Useful for pages that load content dynamically.', required: false },
      timeout: { type: 'number', description: 'Maximum time to wait for page load in milliseconds. Default is 30000 (30 seconds).', required: false },
      max_length: { type: 'number', description: 'Maximum length of content to return in characters. Default is 50000.', required: false }
    },
    required: ['url']
  }
]

/**
 * 工具调用格式说明
 * 注意：必须与后端 cli-chat-service.ts 中的 parseToolCalls 函数兼容
 */
export const TOOL_INVOCATION_FORMAT = `=== TOOL INVOCATION FORMAT ===
When you need to use a tool, you MUST output it in this EXACT format:

<tool name="tool_name" param1="value1" param2="value2"/>

CRITICAL RULES:
1. ALWAYS use XML-style tag format <tool name="..." .../>, NEVER use JSON code blocks or markdown code blocks
2. NEVER wrap tool calls in \`\`\`bash or \`\`\`json code blocks
3. The tool call MUST be on its own line, without any markdown formatting or code blocks
4. Parameter values must be in double quotes
5. Escape special characters in parameter values

CORRECT examples:
<tool name="read_file" path="/Users/test/project/README.md"/>
<tool name="list_directory" path="/Users/test/project/src"/>
<tool name="execute_bash" command="npm install"/>
<tool name="write_file" path="/path/to/file.txt" content="file content here"/>
<tool name="browse_website" url="https://example.com"/>
<tool name="browse_website" url="https://github.com/user/repo" wait_for_selector=".repository-content"/>

INCORRECT examples (NEVER do these):
- \`\`\`bash\ncd /path && npm install\n\`\`\` ← WRONG! Don't use markdown code blocks
- {"tool": "read_file", "path": "/path"} ← WRONG! Don't use JSON
- read_file(/path/to/file) ← WRONG! Don't use parentheses format

INCORRECT formats (NEVER use these):
- {"tool": "read_file", "arguments": {"path": "/test"}}  ← WRONG! Don't use JSON
- read_file: "{\"path\": \"/test\"}"  ← WRONG! Don't use this format
- - read_file (/path/to/file)  ← WRONG! Don't use list format
- I'll use read_file to read the file  ← WRONG! Just output the tool call directly

REMEMBER: Output the tool call directly. Do NOT say "I'll use X tool" - just use it.`

/**
 * 通用关键规则
 */
export const COMMON_CRITICAL_RULES = `=== CRITICAL RULES ===
1. ONLY output the JSON code block, no explanatory text before or between tool calls
2. Wait for tool results before proceeding to the next step
3. If a tool fails due to timeout or network error, DO NOT automatically retry. Report the error to the user and ask if they want to retry.
4. When task is complete, provide a clear summary of what was accomplished
5. **ABSOLUTELY FORBIDDEN**: NEVER output text like "正在执行工具", "工具执行完成", "执行中", "成功", "✅", "⏳", "" or any execution status descriptions. The system will handle execution visualization.
6. **CRITICAL**: Do NOT describe what you are doing or will do. Just output the JSON and wait for results.
7. **NEVER OUTPUT HTML**: Do NOT output any HTML tags like <div>, <span>, <svg>, etc. Only output plain text and JSON code blocks.
8. **NO VISUAL CARDS**: Do NOT create visual cards or UI elements. Just output the JSON tool calls.
9. **CONTINUE UNTIL COMPLETE**: After receiving tool results, you MUST continue to analyze and call more tools if needed. Do NOT provide final summary until the user's task is fully completed.
10. **TOOL CHAINING**: If you need to perform multiple steps (e.g., list directory → read file → analyze), call tools one at a time and wait for results before proceeding to the next step.
11. **NO TEXT ANALYSIS DURING EXECUTION**: While executing tools, NEVER output analysis text like "我看到...", "让我检查...". ONLY output JSON tool calls. Save all analysis for the final summary after all tools are complete.
12. **NEVER STOP AFTER ONE TOOL**: A task is NOT complete after executing just one tool. You MUST continue until you have fully addressed the user's request.`

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
  console.log('[buildSystemInfoSection] cwd:', cwd, 'length:', cwd.length, 'chars:', cwd.split('').map(c => c.charCodeAt(0)))
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
- Use search_files to find references, imports, and dependencies
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
2. Check if the error is due to timeout or network issues
3. For timeout/network errors: Report the error to the user and ask if they want to retry
4. For parameter/validation errors: Verify you have the correct parameters and retry only once with corrections
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
 * 任务规划协议 - 参考 Cursor 模式重构
 */
export const TASK_PLANNING_PROTOCOL = `=== TASK PLANNING PROTOCOL ===
CRITICAL: For EVERY user request, you MUST follow this protocol:

Step 1 - INITIAL ANALYSIS (MANDATORY):
Before calling ANY tools, analyze the request:
- What is the user asking for?
- What information do you need?
- What files/components are likely involved?
- How many steps will this take?

Step 2 - OUTPUT TASK PLAN (MANDATORY):
In your FIRST response, you MUST output a task plan:

## 📋 任务计划
1. [步骤1]: 探索项目结构 (使用 list_directory)
2. [步骤2]: 读取关键文件 (使用 read_file)
3. [步骤3]: 分析代码逻辑
4. [步骤4]: 提供总结

Step 3 - EXECUTE AND TRACK PROGRESS:
After each tool execution, update the task status:
- ✅ 已完成: [what was done]
- ⏳ 进行中: [current step]
- 📌 待处理: [remaining steps]

Step 4 - NEVER STOP PREMATURELY:
You MUST complete ALL steps in your plan before providing final summary.
If you stop after step 1, you have FAILED the task.

Step 5 - AVOID INFINITE LOOPS:
- If you find yourself reading files repeatedly, STOP and reassess
- Ask yourself: "What am I trying to find?"
- If stuck, summarize findings and ask user for clarification

Step 6 - MEMORY MANAGEMENT:
When context is compressed, maintain task memory by explicitly stating:
- 【问题分析】: What is the problem you're solving
- 【根本原因】: Root cause of the issue
- 【修复策略】: Your plan to fix it
- 【待修复文件】: List of files that need modification
- 【已完成】: Files already fixed
Example: "【问题分析】API接口404错误 【根本原因】路由配置错误 【修复策略】修改server.js中的路由 【待修复文件】server.js, api.js 【已完成】无"`
