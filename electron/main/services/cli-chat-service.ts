/**
 * CLI Chat Service
 * 将 LLM API 调用与 CLI 运行时引擎整合，提供统一的对话服务
 * 替代原有的 HTTP API 模式
 */

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import {
  sendChatMessage,
  streamChatMessage,
  type Message as LLMMessage,
  type ChatResponse
} from './llm-service'
import {
  runtimeEngine,
  createSession,
  getSession,
  type RuntimeSession,
  type TurnResult
} from '../cli/runtime-engine'
import { toolRegistry } from '../cli/tool-registry'
import { loadConfig } from '../config-service'

// 获取有效的模型 ID
function getValidModelId(modelId: string, providerName?: string): string {
  // 返回原始模型 ID，不做映射转换
  return modelId
}

// 会话管理
interface CLISession {
  id: string
  runtimeSessionId: string
  mode: 'chat' | 'agent'
  cwd: string
  messages: LLMMessage[]
  isStreaming: boolean
  abortController?: AbortController
  useCodeGeneration?: boolean  // ✅ 是否使用代码生成模式
}

// 流式响应块
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: Record<string, unknown> | string
  }
  toolResult?: {
    toolCallId: string
    success: boolean
    output: string
    error?: string
  }
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

// 会话存储
const sessions = new Map<string, CLISession>()

/**
 * ✅ 智能上下文压缩
 * 参考先进 AI Coding 工具（Claude Code、Cursor、GitHub Copilot）的做法
 * 将历史对话压缩为简洁的摘要，保留关键信息
 */
function compressMessageHistory(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 10) return messages
  
  log.info(`[Context Compression] Original messages: ${messages.length}`)
  
  // 1. 保留系统消息
  const systemMessages = messages.filter(m => m.role === 'system')
  
  // 2. 保留最新的用户消息
  const userMessages = messages.filter(m => m.role === 'user')
  const latestUserMessage = userMessages[userMessages.length - 1]
  
  // 3. 压缩中间的对话历史
  const nonSystemMessages = messages.filter(m => m.role !== 'system')
  
  // 4. 提取关键信息（文件操作、搜索结果等）
  const keyOperations: string[] = []
  let lastFileOperation: string | null = null
  
  for (const msg of nonSystemMessages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    
    // 提取文件操作
    if (content.includes('File written:') || content.includes('File deleted:')) {
      const match = content.match(/File\s+(written|deleted):\s*(.+)/i)
      if (match) {
        lastFileOperation = `${match[1]}: ${match[2]}`
        keyOperations.push(lastFileOperation)
      }
    }
    
    // 提取搜索结果
    if (content.includes('Found:') || content.includes('搜索文件')) {
      const lines = content.split('\n').filter(l => l.includes('Found:') || l.includes('/'))
      if (lines.length > 0) {
        keyOperations.push(`搜索: ${lines[0].substring(0, 100)}`)
      }
    }
    
    // 提取代码执行结果
    if (content.includes('```python') && content.includes('print(')) {
      // 保留代码执行结果
      const lines = content.split('\n').filter(l => l.includes('print('))
      if (lines.length > 0) {
        keyOperations.push(`执行: ${lines.join(', ').substring(0, 100)}`)
      }
    }
  }
  
  // 5. 构建压缩后的消息历史
  const compressedMessages: LLMMessage[] = [...systemMessages]
  
  // 如果有关键操作，添加摘要
  if (keyOperations.length > 0) {
    // 去重并限制数量
    const uniqueOps = keyOperations.slice(-5)  // 只保留最近 5 个关键操作
    const summary = uniqueOps.map((op, i) => `${i + 1}. ${op}`).join('\n')
    
    compressedMessages.push({
      role: 'user',
      content: `[历史操作摘要]\n${summary}\n\n请继续当前任务。`
    })
  }
  
  // 添加最新的用户消息
  if (latestUserMessage) {
    compressedMessages.push(latestUserMessage)
  }
  
  log.info(`[Context Compression] Compressed to ${compressedMessages.length} messages`)
  
  return compressedMessages
}

/**
 * ✅ 智能上下文管理
 * 根据对话阶段和重要性动态调整上下文
 */
function manageContext(messages: LLMMessage[], iterationCount: number): LLMMessage[] {
  // 第一次迭代：保留完整上下文
  if (iterationCount === 0) {
    return compressMessageHistory(messages)
  }
  
  // 后续迭代：只保留系统消息和最近几条
  const systemMessages = messages.filter(m => m.role === 'system')
  const recentMessages = messages.filter(m => m.role !== 'system').slice(-5)
  
  return [...systemMessages, ...recentMessages]
}

// 获取主窗口
function getMainWindow(): BrowserWindow | null {
  const { BrowserWindow } = require('electron')
  return BrowserWindow.getAllWindows()[0] || null
}

/**
 * ✅ 重复对话检测
 * 检测当前用户输入是否与历史对话重复，如果重复则重置会话
 */
function checkAndHandleDuplicateConversation(
  session: CLISession, 
  userMessage: string
): { isDuplicate: boolean; resetSession?: boolean } {
  // 标准化用户输入（去除空格、标点，转为小写）
  const normalize = (text: string) => {
    return text.toLowerCase()
      .replace(/[\s,，.。!！?？]/g, '')
      .replace(/帮我|请|帮我一下|麻烦/g, '')
      .trim()
  }
  
  const normalizedInput = normalize(userMessage)
  
  // 如果输入太短（少于5个字符），不检测
  if (normalizedInput.length < 5) {
    return { isDuplicate: false }
  }
  
  // 获取历史用户消息
  const userMessages = session.messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
  
  // 检查是否重复（排除最后一条，因为是当前输入）
  for (let i = 0; i < userMessages.length - 1; i++) {
    const historicalMsg = normalize(userMessages[i])
    
    // 完全匹配
    if (historicalMsg === normalizedInput) {
      log.warn(`[Duplicate Detection] Exact duplicate detected: "${userMessage.substring(0, 50)}"`)
      return { isDuplicate: true, resetSession: true }
    }
    
    // 相似度匹配（包含关系）
    if (historicalMsg.includes(normalizedInput) || normalizedInput.includes(historicalMsg)) {
      if (historicalMsg.length > 5 && normalizedInput.length > 5) {
        log.warn(`[Duplicate Detection] Similar message detected: "${userMessage.substring(0, 50)}"`)
        return { isDuplicate: true, resetSession: true }
      }
    }
  }
  
  return { isDuplicate: false }
}

/**
 * ✅ 重置会话为初始状态
 * 保留系统提示词，清除所有对话历史
 */
function resetSession(session: CLISession): void {
  log.info(`[Session Reset] Resetting session ${session.id} due to duplicate conversation`)
  
  // 只保留系统消息
  const systemMessages = session.messages.filter(m => m.role === 'system')
  
  // 添加重置提示
  systemMessages.push({
    role: 'user',
    content: '[系统提示：检测到重复对话，已重置上下文。请继续您的任务。]'
  })
  
  session.messages = systemMessages
  
  log.info(`[Session Reset] Session reset complete, ${session.messages.length} messages remaining`)
}

// 发送流式数据到渲染进程
function sendStreamToRenderer(sessionId: string, chunk: StreamChunk): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cli-chat:stream', { sessionId, chunk })
  }
}

/**
 * 创建新的 CLI 会话
 */
export function createCLISession(
  mode: 'chat' | 'agent',
  cwd: string,
  initialPrompt?: string
): string {
  const sessionId = uuidv4()
  const runtimeSession = createSession(initialPrompt || '', cwd)

  const session: CLISession = {
    id: sessionId,
    runtimeSessionId: runtimeSession.id,
    mode,
    cwd,
    messages: [],
    isStreaming: false
  }

  sessions.set(sessionId, session)
  log.info(`[CLIChatService] Created session: ${sessionId}, mode: ${mode}`)

  return sessionId
}

/**
 * 获取会话
 */
export function getCLISession(sessionId: string): CLISession | undefined {
  return sessions.get(sessionId)
}

/**
 * 删除会话
 */
export function deleteCLISession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (session) {
    // 取消正在进行的请求
    if (session.abortController) {
      session.abortController.abort()
    }
    sessions.delete(sessionId)
    log.info(`[CLIChatService] Deleted session: ${sessionId}`)
    return true
  }
  return false
}

/**
 * 停止会话的流式响应
 */
export function stopCLISession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (session && session.abortController) {
    session.abortController.abort()
    session.isStreaming = false
    log.info(`[CLIChatService] Stopped session: ${sessionId}`)
    return true
  }
  return false
}

// 模型能力缓存
const modelCapabilityCache = new Map<string, { supportsFunctionCalling: boolean; supportsCodeGeneration: boolean }>()

/**
 * 检测模型是否支持 function calling
 * 通过发送实际请求测试，而不是依赖硬编码列表
 */
async function detectModelCapability(apiKey: string, model: string, apiUrl?: string): Promise<{ supportsFunctionCalling: boolean; supportsCodeGeneration: boolean }> {
  // 检查缓存
  const cacheKey = `${apiUrl || 'default'}-${model}`
  if (modelCapabilityCache.has(cacheKey)) {
    return modelCapabilityCache.get(cacheKey)!
  }

  log.info(`[CLI-Chat] Detecting model capability for ${model} by actual testing...`)

  // 测试 1: 检测是否支持 function calling
  try {
    // 使用一个明确的场景测试：获取当前时间
    // 这个场景需要模型理解并使用工具
    const testTools = [{
      type: 'function',
      function: {
        name: 'get_current_time',
        description: 'Get the current time',
        parameters: { 
          type: 'object', 
          properties: {
            timezone: {
              type: 'string',
              description: 'Timezone, e.g., UTC, Asia/Shanghai'
            }
          }
        }
      }
    }]
    
    const response = await sendChatMessage({
      apiKey,
      model,
      messages: [{ 
        role: 'user', 
        content: 'What time is it now? Please use the get_current_time function to check.' 
      }],
      tools: testTools,
      stream: false,
      apiUrl
    })
    
    // 检查是否返回了 tool_calls
    const hasToolCalls = !!response.tool_calls && response.tool_calls.length > 0
    const hasFunctionCall = hasToolCalls && response.tool_calls!.some(tc => tc.function?.name === 'get_current_time')
    
    if (hasFunctionCall) {
      log.info(`[CLI-Chat] Model ${model} supports function calling (detected by actual test)`)
      const result = { supportsFunctionCalling: true, supportsCodeGeneration: true }
      modelCapabilityCache.set(cacheKey, result)
      return result
    }
    
    // 测试 2: 检测是否支持代码生成
    log.info(`[CLI-Chat] Model ${model} does not support function calling, testing code generation...`)
    
    const codeResponse = await sendChatMessage({
      apiKey,
      model,
      messages: [{ 
        role: 'user', 
        content: 'Write a Python code to print "Hello World"' 
      }],
      stream: false,
      apiUrl
    })
    
    const content = typeof codeResponse.content === 'string' ? codeResponse.content : JSON.stringify(codeResponse.content)
    const hasCodeBlock = content.includes('```python') || content.includes('```')
    
    if (hasCodeBlock) {
      log.info(`[CLI-Chat] Model ${model} supports code generation`)
      const result = { supportsFunctionCalling: false, supportsCodeGeneration: true }
      modelCapabilityCache.set(cacheKey, result)
      return result
    }
    
    // 如果都不支持，降级为 chat 模式
    log.warn(`[CLI-Chat] Model ${model} does not support function calling or code generation, falling back to chat mode`)
    const result = { supportsFunctionCalling: false, supportsCodeGeneration: false }
    modelCapabilityCache.set(cacheKey, result)
    return result
    
  } catch (error) {
    log.warn(`[CLI-Chat] Failed to detect model capability for ${model}:`, error)
    // 默认使用代码生成模式
    const result = { supportsFunctionCalling: false, supportsCodeGeneration: true }
    modelCapabilityCache.set(cacheKey, result)
    return result
  }
}

/**
 * 构建系统提示词 - 根据模型能力选择不同模式
 */
function buildSystemPrompt(mode: 'chat' | 'agent', cwd: string, useCodeGeneration: boolean = false): string {
  const systemInfo = `Operating System: ${process.platform}
Working Directory: ${cwd}`

  if (mode === 'chat') {
    return `You are a helpful AI coding assistant.

${systemInfo}

Provide helpful, accurate, and concise responses to the user's questions.`
  }

  // Agent Mode - 根据是否使用代码生成模式选择不同提示词
  if (useCodeGeneration) {
    // 代码生成模式 - 简化提示词，只保留核心要求
    return `You are Claude Code, an AI coding assistant.

${systemInfo}

TASK: Generate Python code to complete the user's request.

STRICT REQUIREMENTS:
1. Output ONLY Python code wrapped in triple backticks
2. Format must be exactly: \`\`\`python ...code... \`\`\`
3. ABSOLUTELY NO text outside code blocks
4. NEVER output "File written:" or "File deleted:" - these will be rejected
5. ALWAYS search for files first using Path('.').rglob()

SEARCH RULES - CRITICAL:
- Use Path('.').rglob('**/*filename*') for fuzzy search (searches all subdirectories)
- Use Path('.').rglob('filename') for exact match
- rglob('**/*') searches ALL files recursively
- DO NOT use shell commands like 'find' or 'ls'
- ALWAYS check if file exists before operating

FORBIDDEN PATTERNS (NEVER USE):
- "File written: ..."
- "File deleted: ..."
- "工具执行结果：..."
- Shell commands: os.system(), subprocess, etc.
- Any text before \`\`\`python or after \`\`\`

CORRECT EXAMPLE - User: "delete test.txt"
\`\`\`python
import os
from pathlib import Path

# Step 1: Search for the file in ALL subdirectories
found = list(Path('.').rglob('**/test.txt'))
print(f"Searching for test.txt...")

if found:
    print(f"Found {len(found)} file(s):")
    for f in found:
        print(f"  - {f}")
    
    # Step 2: Delete all found files
    for f in found:
        try:
            os.remove(f)
            print(f"Deleted: {f}")
        except Exception as e:
            print(f"Error deleting {f}: {e}")
else:
    print("File not found: test.txt")
\`\`\`

CORRECT EXAMPLE - User: "find files with 'test' in name"
\`\`\`python
from pathlib import Path

# Fuzzy search - finds all files containing 'test' in name
found = list(Path('.').rglob('**/*test*'))
print(f"Found {len(found)} file(s) matching '*test*':")
for f in found:
    print(f"  - {f}")
\`\`\`

CORRECT EXAMPLE - User: "create test.txt with content"
\`\`\`python
from pathlib import Path

# Step 1: Check if file already exists anywhere
found = list(Path('.').rglob('**/test.txt'))
if found:
    path = found[0]
    print(f"File exists at: {path}")
else:
    # Create in current directory
    path = "test.txt"
    print(f"Will create new file at: {path}")

# Step 2: Write content
Path(path).write_text("content", encoding='utf-8')
print(f"Written: {path}")
\`\`\`

YOUR RESPONSE MUST START WITH \`\`\`python AND END WITH \`\`\`
ANY TEXT OUTSIDE THESE MARKERS WILL CAUSE ERRORS`
  }

  // Function Calling Mode - 支持 function calling 的模型
  return `You are Claude Code, an AI coding assistant.

${systemInfo}

You have access to tools. Use them to complete tasks.

When user asks you to work with a file:
Step 1: Search for the file by name
<tool name="search_files" pattern="filename" search_type="filename"/>

Step 2: After finding the file, use the appropriate tool
<tool name="delete_file" path="/full/path/to/file"/>

Available tools:
- search_files: Find files by pattern or filename. Use search_type="filename" to search by file name, search_type="content" to search file contents (default)
- read_file: Read file contents
- delete_file: Delete a file
- write_file: Create or overwrite file
- edit_file: Edit specific lines in file
- list_directory: List directory contents
- execute_bash: Execute shell commands

CRITICAL RULES:
1. ALWAYS search first if you don't know the exact file path
2. When searching for a file by name, use: <tool name="search_files" pattern="filename" search_type="filename"/>
3. Use XML format: <tool name="TOOL_NAME" param1="value1"/>
4. Wait for tool result before next step
5. Be concise, no explanations

Example:
User: delete test.txt
You: <tool name="search_files" pattern="test.txt" search_type="filename"/>
System: Found: /project/frontend/test.txt
You: <tool name="delete_file" path="/project/frontend/test.txt"/>
System: File deleted successfully`
}

/**
 * 解析工具调用
 */
function parseToolCalls(content: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []

  // 匹配 <tool name="..." .../> 格式
  const toolRegex = /<tool\s+name="([^"]+)"([^\/>]*)\/>/g
  let match

  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1]
    const attrsContent = match[2]

    // 解析属性
    const args: Record<string, unknown> = {}
    const attrRegex = /(\w+)="([^"]*)"/g
    let attrMatch

    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      const attrName = attrMatch[1]
      let attrValue = attrMatch[2]
      // 处理转义字符
      attrValue = attrValue.replace(/\\"/g, '"').replace(/\\n/g, '\n')
      args[attrName] = attrValue
    }

    toolCalls.push({ name: toolName, arguments: args })
  }

  return toolCalls
}

/**
 * 工具名称别名映射（兼容旧的工具名称）
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  'file_read': 'read_file',
  'file_write': 'write_file',
  'bash': 'execute_bash',
  'glob': 'search_files',
  'search_code': 'search_files'
}

/**
 * 解析工具名称，支持别名
 */
function resolveToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] || toolName
}

/**
 * 执行工具调用
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<{ success: boolean; output: string; error?: string }> {
  // ✅ 修复：解析工具名称别名
  const resolvedToolName = resolveToolName(toolName)
  if (resolvedToolName !== toolName) {
    log.debug(`[CLI-Chat Tool] Resolved alias: ${toolName} -> ${resolvedToolName}`)
  }
  
  log.debug(`[CLI-Chat Tool] Looking up tool: ${resolvedToolName}`)
  
  const tool = toolRegistry.get(resolvedToolName)
  if (!tool) {
    // 🔍 调试：列出所有已注册的工具
    const allTools = toolRegistry.getAll().map(t => t.name).join(', ')
    log.error(`[CLI-Chat Tool] Tool not found: ${resolvedToolName} (original: ${toolName})`)
    log.error(`[CLI-Chat Tool] Available tools: ${allTools}`)
    log.error(`[CLI-Chat Tool] Registry size: ${toolRegistry.getAll().length}`)
    log.error(`[CLI-Chat Tool] Does list_reminders exist? ${toolRegistry.has('list_reminders')}`)
    return {
      success: false,
      output: '',
      error: `Tool not found: ${toolName}. Available tools: ${allTools}`
    }
  }

  const permission = toolRegistry.isAllowed(resolvedToolName)
  if (!permission.allowed) {
    log.error(`[CLI-Chat Tool] Permission denied: ${permission.reason}`)
    return {
      success: false,
      output: '',
      error: `Permission denied: ${permission.reason}`
    }
  }

  try {
    const result = await toolRegistry.execute(resolvedToolName, args, {
      cwd,
      permissionMode: 'moderate'
    })
    log.debug(`[CLI-Chat Tool] Tool executed: ${resolvedToolName}, success=${result.success}`)
    return {
      success: result.success,
      output: result.output,
      error: result.error
    }
  } catch (error) {
    log.error(`[CLI-Chat Tool] Tool execution threw error:`, error)
    return {
      success: false,
      output: '',
      error: String(error)
    }
  }
}

/**
 * 从文本内容中提取工具调用，并返回清理后的内容
 * 支持多种格式：
 * 1. <tool name="..." .../> - 正确格式
 * 2. ```json {"tool": "...", "arguments": {...}} ``` - JSON代码块
 * 3. tool_name: "{...}" - 错误格式（AI可能输出）
 * 4. - tool_name (...) - 列表格式（AI可能输出）
 */
function extractToolCallsFromContent(content: string): {
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  cleanedContent: string
} {
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
  let cleanedContent = content

  // 已知工具列表（使用正确的工具名称）
  const knownTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'execute_bash', 'search_files', 'delete_file', 'append_file', 'browse_website', 'list_reminders', 'add_reminder']

  log.debug(`[CLI-Chat] Extracting tool calls from content: ${content.substring(0, 200)}...`)

  // 0. 飞书环境特殊格式：<tool name="..."><parameter=xxx>value</parameter=xxx></tool_call/>
  const feishuToolRegex = /<tool\s+name="([^"]+)"\s*>[\s\S]*?<\/tool_call\s*\/?>/gs
  let feishuMatch
  while ((feishuMatch = feishuToolRegex.exec(content)) !== null) {
    const toolName = feishuMatch[1]
    const fullMatch = feishuMatch[0]
    const args: Record<string, unknown> = {}

    // 匹配 <parameter=xxx>value</parameter=xxx> 格式
    const paramRegex = /<parameter\s+name="([^"]+)"\s+string="true">([\s\S]*?)<\/parameter>/g
    let paramMatch
    while ((paramMatch = paramRegex.exec(fullMatch)) !== null) {
      const paramName = paramMatch[1]
      const paramValue = paramMatch[2].trim()
      args[paramName] = paramValue
      log.debug(`[CLI-Chat] Feishu format param: ${paramName}=${paramValue}`)
    }

    if (knownTools.includes(toolName)) {
      toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
      log.info(`[CLI-Chat] Extracted tool call from Feishu format: ${toolName}, args=${JSON.stringify(args)}`)
      cleanedContent = cleanedContent.replace(fullMatch, '')
    } else {
      log.debug(`[CLI-Chat] Unknown tool name in Feishu format: ${toolName}`)
    }
  }

  // 1. 匹配 <tool name="..." .../> 格式（正确格式）
  // 使用更健壮的正则，支持多行属性和特殊字符
  const toolRegex = /<tool\s+name="([^"]+)"((?:\s+\w+="[^"]*")*)\s*\/>/g
  let toolMatch
  while ((toolMatch = toolRegex.exec(content)) !== null) {
    const toolName = toolMatch[1]
    const attrsContent = toolMatch[2]
    const args: Record<string, unknown> = {}
    
    // 匹配所有属性 key="value"
    const attrRegex = /(\w+)="([^"]*)"/g
    let attrMatch
    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      // 解码转义字符
      const value = attrMatch[2]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
      args[attrMatch[1]] = value
    }
    
    if (knownTools.includes(toolName)) {
      toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
      log.info(`[CLI-Chat] Extracted tool call from <tool> tag: ${toolName}, args=${JSON.stringify(args)}`)
      cleanedContent = cleanedContent.replace(toolMatch[0], '')
    } else {
      log.debug(`[CLI-Chat] Unknown tool name in <tool> tag: ${toolName}`)
    }
  }
  
  // 如果没有匹配到，尝试更宽松的匹配（处理 AI 可能输出的格式错误）
  if (toolCalls.length === 0) {
    // 尝试匹配 <tool name="..." 任意内容 />
    const looseToolRegex = /<tool\s+name="([^"]+)"(.*?)\/>/gs
    let looseMatch
    while ((looseMatch = looseToolRegex.exec(content)) !== null) {
      const toolName = looseMatch[1]
      const attrsContent = looseMatch[2]
      const args: Record<string, unknown> = {}
      
      // 尝试提取所有 key="value" 或 key='value'
      const attrRegex = /(\w+)=(["'])([^"']*)\2/g
      let attrMatch
      while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
        args[attrMatch[1]] = attrMatch[3]
      }
      
      if (knownTools.includes(toolName)) {
        toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
        log.info(`[CLI-Chat] Extracted tool call from loose <tool> tag: ${toolName}, args=${JSON.stringify(args)}`)
        cleanedContent = cleanedContent.replace(looseMatch[0], '')
      }
    }
  }

  // 2. 匹配 ```json 代码块
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)\n?```/g
  let match
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const json = JSON.parse(match[1].trim())
      if (json.tool && json.arguments && knownTools.includes(json.tool)) {
        toolCalls.push({ id: uuidv4(), name: json.tool, arguments: json.arguments })
        log.info(`[CLI-Chat] Extracted tool call from JSON block: ${json.tool}`)
        cleanedContent = cleanedContent.replace(match[0], '')
      }
    } catch (e) {
      log.debug(`[CLI-Chat] Failed to parse JSON block: ${e}`)
    }
  }

  // 2.5 匹配行内 JSON 格式（不在代码块中）
  // 例如：{"tool": "search_files", "arguments": {"pattern": "test.txt"}}
  const inlineJsonRegex = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g
  let inlineMatch
  while ((inlineMatch = inlineJsonRegex.exec(content)) !== null) {
    try {
      const toolName = inlineMatch[1]
      const argsJson = inlineMatch[2]
      const args = JSON.parse(argsJson)
      if (knownTools.includes(toolName)) {
        toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
        log.info(`[CLI-Chat] Extracted tool call from inline JSON: ${toolName}`)
        cleanedContent = cleanedContent.replace(inlineMatch[0], '')
      }
    } catch (e) {
      log.debug(`[CLI-Chat] Failed to parse inline JSON: ${e}`)
    }
  }

  // 3. 匹配 file_read: "{...}" 格式（AI 错误输出的格式）
  const wrongFormatRegex = /(\w+):\s*"(\{[^}]*\})"/g
  let wrongMatch
  while ((wrongMatch = wrongFormatRegex.exec(content)) !== null) {
    const toolName = wrongMatch[1]
    const jsonStr = wrongMatch[2]
    try {
      const args = JSON.parse(jsonStr)
      if (knownTools.includes(toolName)) {
        toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
        log.info(`[CLI-Chat] Extracted tool call from wrong format: ${toolName}`)
        cleanedContent = cleanedContent.replace(wrongMatch[0], '')
      }
    } catch (e) {
      log.debug(`[CLI-Chat] Failed to parse wrong format JSON: ${e}`)
    }
  }

  // 4. 匹配 - tool_name (...) 列表格式（AI 错误输出的格式）
  // 例如：- read_file (/path/to/file) 或 - list_directory (/path)
  const listFormatRegex = /^\s*-\s*(read_file|write_file|edit_file|list_directory|execute_bash|search_files|delete_file|append_file)\s*(?:\(([^)]*)\))?\s*$/gim
  let listMatch
  while ((listMatch = listFormatRegex.exec(content)) !== null) {
    const toolName = listMatch[1]
    const pathHint = listMatch[2]
    // 根据工具类型构建参数
    const args: Record<string, unknown> = {}
    if (pathHint && (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file' || toolName === 'list_directory')) {
      args.path = pathHint.trim()
    }
    toolCalls.push({ id: uuidv4(), name: toolName, arguments: args })
    log.info(`[CLI-Chat] Extracted tool call from list format: ${toolName}`)
    cleanedContent = cleanedContent.replace(listMatch[0], '')
  }

  // 5. 移除"我将使用以下工具"等提示文本
  cleanedContent = cleanedContent.replace(/我将使用以下工具[：:]?\s*\n?/g, '')
  cleanedContent = cleanedContent.replace(/我将分析并处理您的请求[。]?\s*\n?/g, '')

  // 清理多余的空行
  cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').trim()

  return { toolCalls, cleanedContent }
}

// 最大迭代次数限制
const MAX_ITERATIONS = 99999

/**
 * 发送消息并获取流式响应
 */
export async function sendCLIMessageStream(
  sessionId: string,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  messages?: Array<{ role: string; content: string; name?: string }>,
  iterationCount: number = 0,
  modelParam?: string
): Promise<void> {
  // 检查迭代次数限制
  if (iterationCount >= MAX_ITERATIONS) {
    log.warn(`[CLI-Chat] Max iterations (${MAX_ITERATIONS}) reached, stopping`)
    onChunk({
      type: 'error',
      error: `Reached maximum iterations (${MAX_ITERATIONS}). Task may be too complex. Please try a more specific request.`
    })
    onChunk({ type: 'done' })
    return
  }

  const session = sessions.get(sessionId)
  if (!session) {
    log.error(`[CLI-Chat] Session not found: ${sessionId}`)
    throw new Error(`Session not found: ${sessionId}`)
  }

    // ✅ 性能优化：降低日志级别，减少磁盘I/O
    log.debug(`[CLI-Chat] Starting iteration ${iterationCount + 1}/${MAX_ITERATIONS}, session mode: ${session.mode}`)

  // 加载配置
  const config = loadConfig()
  
  // 优先使用传入的 model 参数，否则从配置加载
  const rawModel = modelParam || config.model || config.defaultModel || 'claude-3-5-sonnet'
  
  // 根据选中的模型 ID 找到对应的供应商
  let selectedProvider = config.providers?.find(p => 
    p.enabled && p.models?.some(m => m.id === rawModel)
  )
  
  // 如果没有找到匹配的供应商，使用第一个启用的供应商
  if (!selectedProvider) {
    selectedProvider = config.providers?.find(p => p.enabled)
    log.debug(`[CLI-Chat] No provider found for model ${rawModel}, using first enabled provider: ${selectedProvider?.name}`)
  }
  
  const apiKey = selectedProvider?.apiKey || config.apiKey
  const apiUrl = selectedProvider?.apiUrl
  const providerName = selectedProvider?.name || 'default'
  
  // 应用模型 ID 映射，确保使用有效的模型 ID
  const model = getValidModelId(rawModel, providerName)
  
  log.debug(`[CLI-Chat] Config loaded: provider=${providerName}, model=${model}`)
  
  if (!apiKey) {
    log.error('[CLI-Chat] API key not configured')
    throw new Error('API key not configured')
  }

  // 创建 AbortController
  session.abortController = new AbortController()
  session.isStreaming = true

  try {
    // ✅ 检测模型能力（只在第一次迭代时检测）
    let useCodeGeneration = session.useCodeGeneration
    let supportsCodeGeneration = true
    if (iterationCount === 0 && useCodeGeneration === undefined) {
      const modelCapability = await detectModelCapability(apiKey, model, apiUrl)
      useCodeGeneration = !modelCapability.supportsFunctionCalling
      supportsCodeGeneration = modelCapability.supportsCodeGeneration
      session.useCodeGeneration = useCodeGeneration
      
      if (!modelCapability.supportsFunctionCalling && !modelCapability.supportsCodeGeneration) {
        // 纯 Chat 模式
        log.warn(`[CLI-Chat] Model ${model} does not support function calling or code generation, using chat mode only`)
        onChunk({
          type: 'text',
          content: `⚠️ 当前模型 ${model} 不支持工具调用和代码生成，只能使用对话模式。\n建议使用 Claude 3.5 Sonnet 或 GPT-4 以获得 Agent 功能。\n\n`
        })
        // 切换到 chat 模式
        session.mode = 'chat'
      } else if (useCodeGeneration) {
        log.info(`[CLI-Chat] Model ${model} does not support function calling, using code generation mode`)
        // 通知用户
        onChunk({
          type: 'text',
          content: `ℹ️ 当前模型 ${model} 不支持工具调用，已切换到代码生成模式。\n建议使用 Claude 3.5 Sonnet 或 GPT-4 以获得更好的体验。\n\n`
        })
      } else {
        log.info(`[CLI-Chat] Model ${model} supports function calling, using standard mode`)
      }
    }
    
    // ✅ 修复：每次新对话开始时，清理旧消息（保留系统消息和最近几条）
    if (iterationCount === 0 && session.messages.length > 10) {
      log.info(`[CLI-Chat] New conversation started, cleaning up old messages (current: ${session.messages.length})`)
      const systemMessages = session.messages.filter(m => m.role === 'system')
      const recentMessages = session.messages.filter(m => m.role !== 'system').slice(-5)
      session.messages = [...systemMessages, ...recentMessages]
      log.info(`[CLI-Chat] Cleaned up messages, now: ${session.messages.length}`)
    }
    
    // 构建消息历史
    // ✅ 修复：根据模型能力选择不同的系统提示词
    const systemPrompt = buildSystemPrompt(session.mode, session.cwd, useCodeGeneration || false)
    
    if (messages && messages.length > 0) {
      // 如果提供了完整消息历史，合并到 session.messages
      // 注意：不要完全覆盖，而是追加新消息，保留后端添加的 tool 结果
      log.debug(`[CLI-Chat] Merging provided messages: count=${messages.length}, session.messages: ${session.messages.length}`)
      
      // 找到 session.messages 中最后一条助手消息的位置
      const lastAssistantIndex = session.messages.findIndex(m => m.role === 'assistant')
      
      // 遍历前端提供的消息，追加到 session.messages
      for (const m of messages) {
        // 跳过系统消息（保留后端的系统提示词）
        if (m.role === 'system') continue
        
        // 检查消息是否已存在（避免重复）
        const exists = session.messages.some(sm => 
          sm.role === m.role && sm.content === m.content
        )
        
        if (!exists) {
          const msg: LLMMessage = { 
            role: m.role as 'system' | 'user' | 'assistant' | 'tool', 
            content: m.content
          }
          if (m.name) msg.name = m.name
          if ((m as any).tool_call_id) msg.tool_call_id = (m as any).tool_call_id
          session.messages.push(msg)
          log.debug(`[CLI-Chat] Added message: role=${m.role}, content=${m.content.substring(0, 50)}...`)
        }
      }
      
      // 确保系统提示词是最新的
      const existingSystemIndex = session.messages.findIndex(m => m.role === 'system')
      if (existingSystemIndex >= 0) {
        session.messages[existingSystemIndex].content = systemPrompt
      } else {
        session.messages.unshift({ role: 'system', content: systemPrompt })
      }
    } else if (session.messages.length === 0) {
      // 否则，只在会话消息为空时添加系统提示词
      log.debug('[CLI-Chat] Building system prompt for new session')
      session.messages.push({
        role: 'system',
        content: systemPrompt
      })
    }

    // 检查是否提供了完整的消息历史
    // 如果提供了，且最后一条是用户消息，则不再添加 message 参数（避免重复）
    // 如果没有提供完整历史，则添加 message 作为用户消息
    const lastMessage = session.messages[session.messages.length - 1]
    const wasProvidedMessages = messages && messages.length > 0
    
    if (wasProvidedMessages && lastMessage?.role === 'user') {
      // 前端提供了完整消息历史，且最后一条是用户消息
      // 检查是否与 message 参数相同
      if (lastMessage.content === message) {
        log.debug('[CLI-Chat] Using provided messages, skipping duplicate')
      } else {
        // 最后一条用户消息与当前 message 不同，添加新的用户消息
        log.debug('[CLI-Chat] Adding new user message to provided history')
        session.messages.push({
          role: 'user',
          content: message
        })
      }
    } else if (!wasProvidedMessages && message.trim()) {
      // 没有提供完整消息历史，且 message 不为空，添加 message 作为用户消息
      session.messages.push({
        role: 'user',
        content: message
      })
    } else if (message.trim()) {
      // 提供了消息历史，但最后一条不是用户消息（可能是 tool 或 assistant）
      // 且 message 不为空，需要添加用户消息
      log.debug('[CLI-Chat] Last message is not user, adding new user message')
      session.messages.push({
        role: 'user',
        content: message
      })
    }
    
    // ✅ 修复：检测重复对话
    if (iterationCount === 0 && message.trim()) {
      const duplicateCheck = checkAndHandleDuplicateConversation(session, message)
      if (duplicateCheck.isDuplicate && duplicateCheck.resetSession) {
        // 重置会话
        resetSession(session)
        // 重新添加当前用户消息
        session.messages.push({
          role: 'user',
          content: message
        })
        // 通知用户
        onChunk({
          type: 'text',
          content: `🔄 检测到重复对话，已重置上下文。\n\n`
        })
      }
    }
    
    // ✅ 性能优化：降低日志级别
    log.debug(`[CLI-Chat] Final messages count: ${session.messages.length}`)
    log.debug(`[CLI-Chat] System prompt length: ${session.messages[0]?.content?.length || 0} chars`)
    log.debug(`[CLI-Chat] User message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)

    // 获取工具定义（Agent 模式）
    const tools = session.mode === 'agent'
      ? toolRegistry.getAll().map(tool => {
          // 清理参数定义，移除 required 字段（OpenAI API 要求 required 在 parameters 级别）
          const properties: Record<string, { type: string; description: string; enum?: string[]; default?: unknown }> = {}
          for (const [key, param] of Object.entries(tool.parameters)) {
            properties[key] = {
              type: param.type,
              description: param.description,
              ...(param.enum && { enum: param.enum }),
              ...(param.default !== undefined && { default: param.default })
            }
          }
          
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: {
                type: 'object',
                properties,
                required: tool.required
              }
            }
          }
        })
      : undefined
    
    log.debug(`[CLI-Chat] Tools count: ${tools?.length || 0}, mode: ${session.mode}`)

    // ✅ 修复：添加日志，检查消息历史
    log.info(`[CLI-Chat] [Iteration ${iterationCount}] Messages before sending: count=${session.messages.length}`)
    log.info(`[CLI-Chat] [Iteration ${iterationCount}] Message roles: ${session.messages.map(m => m.role).join(', ')}`)
    log.info(`[CLI-Chat] [Iteration ${iterationCount}] First message role: ${session.messages[0]?.role}`)
    const firstMsg = session.messages[0]
    const firstContent = firstMsg && typeof firstMsg.content === 'string' ? firstMsg.content : JSON.stringify(firstMsg?.content || '')
    log.info(`[CLI-Chat] [Iteration ${iterationCount}] First message content preview: ${firstContent.substring(0, 200)}...`)
    if (session.messages.length > 1) {
      const lastMsg = session.messages[session.messages.length - 1]
      log.info(`[CLI-Chat] [Iteration ${iterationCount}] Last message role: ${lastMsg?.role}`)
      const lastContent = lastMsg && typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '')
      log.info(`[CLI-Chat] [Iteration ${iterationCount}] Last message content preview: ${lastContent.substring(0, 100)}...`)
    }
    
    // ✅ 修复：限制消息历史长度，防止 AI 混淆
    const MAX_MESSAGES = 20
    if (session.messages.length > MAX_MESSAGES) {
      log.warn(`[CLI-Chat] Message history too long (${session.messages.length}), trimming to ${MAX_MESSAGES}`)
      // 保留系统消息和最近的消息
      const systemMessages = session.messages.filter(m => m.role === 'system')
      const nonSystemMessages = session.messages.filter(m => m.role !== 'system')
      const recentMessages = nonSystemMessages.slice(-(MAX_MESSAGES - systemMessages.length))
      session.messages = [...systemMessages, ...recentMessages]
      log.info(`[CLI-Chat] Trimmed message history to ${session.messages.length} messages`)
    }
    
    // ✅ 修复：过滤掉包含幻觉的消息，防止 AI 学习错误模式
    const filteredMessages = session.messages.filter(m => {
      if (m.role === 'system') return true
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      
      // 规则 1: 过滤掉包含 "File written:" 或 "File deleted:" 但没有代码块的消息
      if (content.includes('File written:') || content.includes('File deleted:')) {
        if (!content.includes('```python')) {
          log.warn(`[CLI-Chat] Filtering out hallucinated file operation message`)
          return false
        }
      }
      
      // 规则 2: 过滤掉包含 "工具执行结果：" 的幻觉消息
      if (content.includes('工具执行结果：') || content.includes('**工具执行结果：**')) {
        log.warn(`[CLI-Chat] Filtering out hallucinated tool result message`)
        return false
      }
      
      // 规则 3: 过滤掉只包含路径但没有代码块的消息
      if (/^\s*\/Users\/[^\n]+\.(txt|md|json|js|ts|py)\s*$/i.test(content)) {
        log.warn(`[CLI-Chat] Filtering out standalone path message`)
        return false
      }
      
      // 规则 4: 过滤掉包含 "任务已完成" 但没有代码块的消息
      if (content.includes('任务已完成') && !content.includes('```python')) {
        log.warn(`[CLI-Chat] Filtering out hallucinated completion message`)
        return false
      }
      
      // 规则 5: 过滤掉重复的 "File written/deleted" 消息（保留最新的）
      // 这个在后续处理
      
      return true
    })
    
    if (filteredMessages.length < session.messages.length) {
      log.info(`[CLI-Chat] Filtered out ${session.messages.length - filteredMessages.length} hallucinated messages`)
      session.messages = filteredMessages
    }
    
    // ✅ 修复：去重 - 移除重复的消息内容（保留最后一个）
    const seenContents = new Set<string>()
    const dedupedMessages: typeof session.messages = []
    // 从后往前遍历，保留最新的
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      // 对于 assistant 消息，检查是否重复
      if (m.role === 'assistant') {
        const normalizedContent = content.replace(/\s+/g, ' ').trim().substring(0, 200)
        if (seenContents.has(normalizedContent)) {
          log.warn(`[CLI-Chat] Removing duplicate assistant message: ${normalizedContent.substring(0, 50)}`)
          continue
        }
        seenContents.add(normalizedContent)
      }
      dedupedMessages.unshift(m)
    }
    
    if (dedupedMessages.length < session.messages.length) {
      log.info(`[CLI-Chat] Removed ${session.messages.length - dedupedMessages.length} duplicate messages`)
      session.messages = dedupedMessages
    }
    
    // ✅ 修复：智能上下文压缩
    // 参考先进 AI Coding 工具的做法，将历史对话压缩为简洁摘要
    if (iterationCount === 0 && session.messages.length > 10) {
      log.info(`[CLI-Chat] Applying smart context compression`)
      session.messages = compressMessageHistory(session.messages)
      log.info(`[CLI-Chat] Compressed context to ${session.messages.length} messages`)
    }

    // 发送流式请求
    let fullContent = ''
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = []
    
    log.debug(`[CLI-Chat] Sending to LLM: model=${model}, stream=true`)

    let chunkCount = 0
    // 用于累积 OpenAI 格式的工具调用
    const pendingToolCalls: Map<string, {
      id: string
      name: string
      arguments: string
    }> = new Map()

    // ✅ 修复：同时传递 tools 给 API，支持 function calling 和 XML 格式
    // 这样 AI 可以选择使用 function calling 或 XML 格式
    for await (const chunk of streamChatMessage({
      apiKey,
      model,
      messages: session.messages,
      tools,  // 传递 tools，支持 function calling
      stream: true,
      apiUrl,
      signal: session.abortController?.signal
    })) {
      chunkCount++
      if (session.abortController?.signal.aborted) {
        log.info('[CLI-Chat] Stream aborted by user')
        break
      }

      if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta as {
          content?: string
          text?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: {
              name?: string
              arguments?: string
            }
          }>
        }

        // 处理文本内容（支持 content 和 text 属性，因为不同模型可能返回不同格式）
        const text = delta?.content || delta?.text || ''
        if (text) {
          fullContent += text
          onChunk({
            type: 'text',
            content: text
          })
        }

        // 处理 OpenAI 格式的工具调用（在 delta.tool_calls 中）
        if (delta?.tool_calls && delta.tool_calls.length > 0) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index ?? 0
            const key = String(index)

            // 获取或创建 pending tool call
            if (!pendingToolCalls.has(key)) {
              pendingToolCalls.set(key, {
                id: toolCallDelta.id || uuidv4(),
                name: '',
                arguments: ''
              })
            }

            const pending = pendingToolCalls.get(key)!

            // 累积名称
            if (toolCallDelta.function?.name) {
              pending.name += toolCallDelta.function.name
            }

            // 累积参数
            if (toolCallDelta.function?.arguments) {
              pending.arguments += toolCallDelta.function.arguments
            }
          }
        }
      } else if (chunk.type === 'tool_use') {
        // 处理 Anthropic 格式的工具调用
        const input = (chunk as { input?: Record<string, unknown> }).input || {}
        const toolCall = {
          id: (chunk as { id?: string }).id || uuidv4(),
          name: (chunk as { name?: string }).name || '',
          arguments: input
        }
        toolCalls.push({
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(input)
        })
        log.debug(`[CLI-Chat] Received tool_use (Anthropic): name=${toolCall.name}`)
        onChunk({
          type: 'tool_call',
          toolCall
        })
      }
    }

    // 流结束后，处理累积的 OpenAI 格式工具调用
    for (const [, pending] of pendingToolCalls) {
      if (pending.name) {
        // ✅ 修复：解析 JSON 字符串为对象，用于发送给前端
        let argsObj: Record<string, unknown> = {}
        try {
          argsObj = JSON.parse(pending.arguments || '{}')
        } catch (e) {
          log.debug(`[CLI-Chat] Failed to parse tool arguments: ${pending.arguments}`)
        }
        toolCalls.push({
          id: pending.id,
          name: pending.name,
          arguments: pending.arguments || '{}'
        })
        log.debug(`[CLI-Chat] Finalized tool call: name=${pending.name}`)
        onChunk({
          type: 'tool_call',
          toolCall: {
            id: pending.id,
            name: pending.name,
            arguments: argsObj
          }
        })
      }
    }
    
    log.debug(`[CLI-Chat] Stream complete: chunks=${chunkCount}, contentLength=${fullContent.length}, toolCalls=${toolCalls.length}`)
    log.debug(`[CLI-Chat] Session mode: ${session.mode}, fullContent preview: ${fullContent.substring(0, 100)}...`)

    // 执行工具调用（Agent 模式）
    if (session.mode === 'agent' && toolCalls.length > 0) {
      log.debug(`[CLI-Chat] Executing ${toolCalls.length} tool calls in iteration ${iterationCount + 1}`)

      // 添加助手回复到消息历史（必须包含 tool_calls，否则后续的 tool 消息会报错）
      session.messages.push({
        role: 'assistant',
        content: fullContent.trim() || '',
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }))
      })

      // 性能优化：每次 iteration 只执行第一个工具，避免同时执行多个工具导致卡顿
      log.debug(`[CLI-Chat] Executing FIRST tool only: ${toolCalls[0].name}`)
      
      const toolCall = toolCalls[0]  // 只取第一个工具
      
      try {
        log.debug(`[CLI-Chat] Executing tool: ${toolCall.name}`)
        
        // ✅ 修复：添加 JSON 解析错误处理，防止无效参数导致整个流程崩溃
        let args: Record<string, unknown>
        try {
          args = JSON.parse(toolCall.arguments)
        } catch (parseError) {
          log.error(`[CLI-Chat] Failed to parse tool arguments: ${toolCall.arguments}`)
          log.error(`[CLI-Chat] Parse error: ${parseError}`)
          // 使用空参数继续，让工具执行时处理无效参数
          args = {}
        }
        
        const result = await executeToolCall(toolCall.name, args, session.cwd)

        onChunk({
          type: 'tool_result',
          toolResult: {
            toolCallId: toolCall.id,
            success: result.success,
            output: result.output,
            error: result.error
          }
        })

        // 添加工具结果到消息历史
        session.messages.push({
          role: 'tool',
          name: toolCall.name,
          content: result.success ? result.output : result.error || 'Error',
          tool_call_id: toolCall.id
        })

        log.debug(`[CLI-Chat] Tool ${toolCall.name} executed: success=${result.success}`)
        
        // 如果有更多工具，记录日志但不执行
        if (toolCalls.length > 1) {
          log.debug(`[CLI-Chat] Deferring ${toolCalls.length - 1} additional tool(s) to next iteration`)
        }
      } catch (error) {
        log.error(`[CLI-Chat] Tool execution error: ${error}`)
        onChunk({
          type: 'tool_result',
          toolResult: {
            toolCallId: toolCall.id,
            success: false,
            output: '',
            error: String(error)
          }
        })
      }

      // 工具执行后，继续对话让 AI 分析结果
      // ✅ 修复：在每次迭代时重新添加系统提示词，确保 AI 记住工具使用格式
      const systemPrompt = buildSystemPrompt(session.mode, session.cwd)
      
      // 检查是否已有系统提示词，如果有则替换，如果没有则添加
      const existingSystemIndex = session.messages.findIndex(m => m.role === 'system')
      if (existingSystemIndex >= 0) {
        session.messages[existingSystemIndex] = {
          role: 'system',
          content: systemPrompt
        }
      } else {
        session.messages.unshift({
          role: 'system',
          content: systemPrompt
        })
      }
      
      // 添加一个明确的用户消息来提示 AI 继续分析
      // ✅ 修复：明确告诉 AI 必须使用工具调用格式
      const continuePrompt = `工具执行完成。

CRITICAL: 你必须使用工具调用格式来继续任务。

如果任务已完成，请说"任务已完成"。
如果任务未完成，你必须输出工具调用格式：
<tool name="TOOL_NAME" param1="value1" param2="value2"/>

可用工具：
- <tool name="write_file" path="..." content="..."/>
- <tool name="edit_file" path="..." old_string="..." new_string="..."/>
- <tool name="delete_file" path="..."/>
- <tool name="search_files" pattern="..."/>
- <tool name="read_file" path="..."/>
- <tool name="list_directory" path="..."/>
- <tool name="execute_bash" command="..."/>

当前迭代: ${iterationCount + 1}/${MAX_ITERATIONS}`

      session.messages.push({
        role: 'user',
        content: continuePrompt
      })

      log.debug(`[CLI-Chat] Recursing for iteration ${iterationCount + 2}`)

      // ✅ 修复：检查会话是否仍然活跃
      const currentSession = sessions.get(sessionId)
      if (!currentSession || !currentSession.isStreaming) {
        log.debug(`[CLI-Chat] Session ${sessionId} is no longer active, stopping recursion`)
        onChunk({ type: 'done' })
        return
      }

      // ✅ 修复：使用 try-catch 包裹递归调用，防止栈溢出和未处理异常
      try {
        // 递归调用 sendCLIMessageStream 继续对话，传递 model 参数
        await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
      } catch (recursiveError) {
        log.error(`[CLI-Chat] Recursive call failed at iteration ${iterationCount + 1}:`, recursiveError)
        onChunk({
          type: 'error',
          error: `Recursive iteration failed: ${recursiveError instanceof Error ? recursiveError.message : String(recursiveError)}`
        })
        return
      }
      
      // 递归调用内部会处理完成信号，这里直接返回
      return
    }

    // 检查 AI 响应中是否包含 JSON 工具调用（从文本内容中提取）
    log.debug(`[CLI-Chat] Checking for tool calls in content: mode=${session.mode}, hasContent=${!!fullContent.trim()}`)
    log.info(`[CLI-Chat] [Iteration ${iterationCount}] Full content preview: ${fullContent.substring(0, 500)}...`)
    
    // ✅ 代码生成模式：提取并执行 Python 代码
    if (session.mode === 'agent' && session.useCodeGeneration && fullContent.trim()) {
      const codeBlockMatch = fullContent.match(/```python\n([\s\S]*?)\n```/)
      if (codeBlockMatch) {
        const pythonCode = codeBlockMatch[1].trim()
        log.info(`[CLI-Chat] [Code Generation] Extracted Python code:\n${pythonCode.substring(0, 200)}...`)
        
        // 添加助手回复到消息历史
        session.messages.push({
          role: 'assistant',
          content: fullContent
        })
        
        // 执行 Python 代码
        try {
          const { exec } = require('child_process')
          const { promisify } = require('util')
          const fs = require('fs')
          const path = require('path')
          const execAsync = promisify(exec)
          
          // ✅ 修复：在执行前记录文件状态
          const filesBefore = new Set(fs.readdirSync(session.cwd, { recursive: true }))
          
          // 在会话工作目录下执行 Python 代码
          const { stdout, stderr } = await execAsync(`python3 -c "${pythonCode.replace(/"/g, '\\"')}"`, {
            cwd: session.cwd,
            timeout: 30000
          })
          
          // ✅ 修复：在执行后检查文件变化
          const filesAfter = new Set(fs.readdirSync(session.cwd, { recursive: true }))
          const newFiles = new Set([...filesAfter].filter(x => !filesBefore.has(x)))
          const deletedFiles = new Set([...filesBefore].filter(x => !filesAfter.has(x)))
          
          const hasRealChanges = newFiles.size > 0 || deletedFiles.size > 0
          
          let output = stdout || stderr || '执行完成'
          
          // ✅ 修复：验证执行结果
          if (!hasRealChanges && (pythonCode.includes('open(') || pythonCode.includes('os.remove'))) {
            // AI 声称创建了/删除了文件，但实际没有变化
            log.warn(`[CLI-Chat] [Code Generation] AI claimed file operation but no changes detected`)
            output += '\n\n⚠️ 警告：代码执行后文件系统没有变化，请检查代码是否正确。'
          }
          
          log.info(`[CLI-Chat] [Code Generation] Execution result: ${output.substring(0, 200)}`)
          log.info(`[CLI-Chat] [Code Generation] File changes: +${newFiles.size} -${deletedFiles.size}`)
          
          // 发送执行结果
          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: `code-gen-${iterationCount}`,
              success: true,
              output: output
            }
          })
          
          // 添加工具结果到消息历史
          session.messages.push({
            role: 'tool',
            name: 'code_execution',
            content: output,
            tool_call_id: `code-gen-${iterationCount}`
          })
          
          // 继续对话
          const continuePrompt = `代码执行结果：\n${output}\n\n任务是否完成？如果未完成，请生成下一段代码。`
          session.messages.push({
            role: 'user',
            content: continuePrompt
          })
          
          // ✅ 修复：递归调用时添加错误处理
          try {
            await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            log.error(`[CLI-Chat] [Code Generation] Recursive call failed:`, errorMsg)
            onChunk({
              type: 'error',
              error: `后续对话失败: ${errorMsg}`
            })
            onChunk({ type: 'done' })
          }
          return
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          log.error(`[CLI-Chat] [Code Generation] Execution failed:`, errorMsg)
          
          onChunk({
            type: 'error',
            error: `代码执行失败: ${errorMsg}`
          })
          
          // 添加错误到消息历史
          session.messages.push({
            role: 'tool',
            name: 'code_execution',
            content: `Error: ${errorMsg}`,
            tool_call_id: `code-gen-${iterationCount}`
          })
          
          // 继续对话，让 AI 修复代码
          const continuePrompt = `代码执行失败：${errorMsg}\n\n请修复代码并重试。`
          session.messages.push({
            role: 'user',
            content: continuePrompt
          })
          
          // ✅ 修复：递归调用时添加错误处理
          try {
            await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
          } catch (error) {
            const retryErrorMsg = error instanceof Error ? error.message : String(error)
            log.error(`[CLI-Chat] [Code Generation] Retry failed:`, retryErrorMsg)
            onChunk({
              type: 'error',
              error: `重试失败: ${retryErrorMsg}`
            })
            onChunk({ type: 'done' })
          }
          return
        }
      } else {
        // ✅ AI 没有生成代码，检查是否声称了文件操作
        log.warn(`[CLI-Chat] [Code Generation] No Python code block found in response, will retry`)
        
        // 添加助手回复到消息历史
        session.messages.push({
          role: 'assistant',
          content: fullContent
        })
        
        // ✅ 修复：验证 AI 是否声称了文件操作但实际没有代码
        const claimedFileWrite = fullContent.match(/File\s+written:\s*(.+)/i)
        const claimedFileDelete = fullContent.match(/File\s+deleted:\s*(.+)/i)
        
        if (claimedFileWrite || claimedFileDelete) {
          // AI 声称了文件操作，但没有生成代码
          const fs = require('fs')
          const path = require('path')
          const claimedPath = claimedFileWrite ? claimedFileWrite[1].trim() : claimedFileDelete![1].trim()
          const fullPath = path.resolve(session.cwd, claimedPath)
          
          // 检查文件是否真的存在/被删除
          const fileExists = fs.existsSync(fullPath)
          
          if (claimedFileWrite && !fileExists) {
            // AI 声称创建了文件，但实际不存在
            log.error(`[CLI-Chat] [Code Generation] AI claimed to write file but it doesn't exist: ${fullPath}`)
            
            // 添加警告到消息历史
            session.messages.push({
              role: 'tool',
              name: 'code_execution',
              content: `⚠️ 错误：AI 声称创建了文件 ${claimedPath}，但实际不存在。请生成实际的 Python 代码来创建文件。`,
              tool_call_id: `code-gen-${iterationCount}`
            })
            
            // 强制重试
            const retryPrompt = `你声称创建了文件 ${claimedPath}，但实际不存在。请生成实际的 Python 代码来创建文件，不要只输出文字描述。`
            session.messages.push({
              role: 'user',
              content: retryPrompt
            })
            
            await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
            return
          }
          
          if (claimedFileDelete && fileExists) {
            // AI 声称删除了文件，但实际还存在
            log.error(`[CLI-Chat] [Code Generation] AI claimed to delete file but it still exists: ${fullPath}`)
            
            session.messages.push({
              role: 'tool',
              name: 'code_execution',
              content: `⚠️ 错误：AI 声称删除了文件 ${claimedPath}，但实际仍存在。请生成实际的 Python 代码来删除文件。`,
              tool_call_id: `code-gen-${iterationCount}`
            })
            
            const retryPrompt = `你声称删除了文件 ${claimedPath}，但实际仍存在。请生成实际的 Python 代码来删除文件，不要只输出文字描述。`
            session.messages.push({
              role: 'user',
              content: retryPrompt
            })
            
            // ✅ 修复：递归调用时添加错误处理
            try {
              await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              log.error(`[CLI-Chat] [Code Generation] Retry after claim failed:`, errorMsg)
              onChunk({
                type: 'error',
                error: `重试失败: ${errorMsg}`
              })
              onChunk({ type: 'done' })
            }
            return
          }
        }
        
        // 检查重试次数（最多重试 2 次）
        const retryCount = (session as any).codeGenRetryCount || 0
        if (retryCount < 2) {
          (session as any).codeGenRetryCount = retryCount + 1
          log.info(`[CLI-Chat] [Code Generation] Retrying (${retryCount + 1}/2)...`)
          
          // 添加重试提示
          const retryPrompt = `你没有生成 Python 代码。请严格按照系统提示的要求，只输出 Python 代码块，不要输出其他内容。\n\n任务：${session.messages[session.messages.length - 1]?.content}`
          session.messages.push({
            role: 'user',
            content: retryPrompt
          })
          
          // ✅ 修复：递归调用时添加错误处理
          try {
            await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            log.error(`[CLI-Chat] [Code Generation] Retry failed:`, errorMsg)
            onChunk({
              type: 'error',
              error: `重试失败: ${errorMsg}`
            })
            onChunk({ type: 'done' })
          }
          return
        }
        
        // 重试次数用尽，提示用户
        log.error(`[CLI-Chat] [Code Generation] Retry exhausted, model is not suitable for code generation`)
        onChunk({
          type: 'text',
          content: `⚠️ AI 没有生成 Python 代码（已重试 2 次）。当前模型可能不适合代码生成模式。\n\n建议更换为 Claude 3.5 Sonnet 或 GPT-4。\n\n原始回复：\n${fullContent}`
        })
        
        onChunk({ type: 'done' })
        return
      }
    }
    
    // 标准工具调用模式
    if (session.mode === 'agent' && fullContent.trim()) {
      const { toolCalls: extractedToolCalls, cleanedContent } = extractToolCallsFromContent(fullContent)
      log.info(`[CLI-Chat] Extraction result: ${extractedToolCalls.length} tool calls found`)
      if (extractedToolCalls.length > 0) {
        log.info(`[CLI-Chat] Extracted tools: ${extractedToolCalls.map(tc => tc.name).join(', ')}`)
      }
      if (extractedToolCalls.length > 0) {
        log.info(`[CLI-Chat] Found ${extractedToolCalls.length} tool calls in content`)

        // 添加助手回复到消息历史（必须包含 tool_calls）
        // 使用清理后的内容（不包含 JSON 工具调用代码块）
        session.messages.push({
          role: 'assistant',
          content: cleanedContent,
          tool_calls: extractedToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        })

        // ✅ 修复：每次只执行第一个工具调用，让 AI 决定下一步
        // 这样可以实现：搜索 -> 告知用户 -> 删除 -> 验证 的完整流程
        const firstToolCall = extractedToolCalls[0]
        const remainingToolCalls = extractedToolCalls.slice(1)
        
        if (remainingToolCalls.length > 0) {
          log.debug(`[CLI-Chat] Deferring ${remainingToolCalls.length} additional tool(s) to next iteration`)
        }
        
        // ✅ 修复：声明变量用于存储搜索结果中的文件路径
        let filePathFromSearch = ''
        
        try {
          log.debug(`[CLI-Chat] Executing first tool: ${firstToolCall.name}`)
          
          // 使用工具调用的实际 ID
          const toolCallId = firstToolCall.id || `extracted-${firstToolCall.name}`
          
          // ✅ 修复：先发送 tool_call 事件，让前端显示工具调用
          // ✅ 修复：arguments 保持为对象，不要序列化为字符串，前端期望的是对象
          onChunk({
            type: 'tool_call',
            toolCall: {
              id: toolCallId,
              name: firstToolCall.name,
              arguments: firstToolCall.arguments
            }
          })
          
          const result = await executeToolCall(firstToolCall.name, firstToolCall.arguments, session.cwd)

          // ✅ 修复：从搜索结果中提取文件路径
          if (firstToolCall.name === 'search_files' && result.success) {
            // 尝试从搜索结果中提取文件路径
            const lines = result.output.split('\n').filter(line => line.trim())
            if (lines.length > 0) {
              // 取第一行作为文件路径
              filePathFromSearch = lines[0].trim()
            }
          }

          // 发送 tool_result 事件
          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: toolCallId,
              success: result.success,
              output: result.output,
              error: result.error
            }
          })

          // 添加工具结果到消息历史
          session.messages.push({
            role: 'tool',
            name: firstToolCall.name,
            content: result.success ? result.output : result.error || 'Error',
            tool_call_id: toolCallId
          })
          
          // ✅ 修复：简化 continuePrompt，让 AI 明确知道需要继续任务
          const continuePrompt = result.success 
            ? `任务已完成：${firstToolCall.name} 执行成功。${result.output ? `输出：${result.output}` : ''}`
            : `任务执行失败：${result.error || '未知错误'}。请重试或报告问题。`
          
          // 保存 continuePrompt 供后续使用
          ;(session as any)._continuePrompt = continuePrompt
        } catch (error) {
          log.error(`[CLI-Chat] Extracted tool execution error:`, error)
        }

        // 继续对话 - 让 AI 决定下一步
        // ✅ 修复：在每次迭代时重新添加系统提示词，确保 AI 记住工具使用格式
        const systemPrompt = buildSystemPrompt(session.mode, session.cwd)
        
        // 检查是否已有系统提示词，如果有则替换，如果没有则添加
        const existingSystemIndex = session.messages.findIndex(m => m.role === 'system')
        if (existingSystemIndex >= 0) {
          session.messages[existingSystemIndex] = {
            role: 'system',
            content: systemPrompt
          }
        } else {
          session.messages.unshift({
            role: 'system',
            content: systemPrompt
          })
        }
        
        // ✅ 修复：使用之前保存的 continuePrompt
        const continuePrompt = (session as any)._continuePrompt || '请继续任务'
        delete (session as any)._continuePrompt

        session.messages.push({
          role: 'user',
          content: continuePrompt
        })

        // ✅ 修复：检查会话是否仍然活跃
        const currentSession = sessions.get(sessionId)
        if (!currentSession || !currentSession.isStreaming) {
          log.debug(`[CLI-Chat] Session ${sessionId} is no longer active, stopping recursion`)
          onChunk({ type: 'done' })
          return
        }

        // ✅ 修复：使用 try-catch 包裹递归调用，防止栈溢出和未处理异常
        try {
          // 递归调用时传递 model 参数
          await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
        } catch (recursiveError) {
          log.error(`[CLI-Chat] Recursive call failed at iteration ${iterationCount + 1}:`, recursiveError)
          onChunk({
            type: 'error',
            error: `Recursive iteration failed: ${recursiveError instanceof Error ? recursiveError.message : String(recursiveError)}`
          })
          return
        }
        
        return
      }
    }

    // ✅ 性能优化：每次迭代后清理过期的消息历史
    // 保留最近的30条消息（足够AI理解上下文）
    const MAX_MESSAGES_HISTORY = 30
    if (session.messages.length > MAX_MESSAGES_HISTORY) {
      // 始终保留第一条系统提示词
      const systemMessage = session.messages[0]
      const recentMessages = session.messages.slice(-MAX_MESSAGES_HISTORY + 1)
      session.messages = [systemMessage, ...recentMessages]
      log.debug(`[CLI-Chat] Trimmed messages history from ${session.messages.length} to ${MAX_MESSAGES_HISTORY}`)
    }

    // 添加助手回复到消息历史（只在非工具调用分支添加）
    if (fullContent.trim()) {
      session.messages.push({
        role: 'assistant',
        content: fullContent
      })
    }

    log.debug(`[CLI-Chat] Iteration ${iterationCount + 1} complete, sending done signal`)

    // 发送完成信号
    onChunk({ type: 'done' })

  } catch (error) {
    // ✅ 修复：忽略 AbortError，这是正常的取消操作（如应用退出时）
    if (error instanceof Error && error.name === 'AbortError') {
      log.debug('[CLIChatService] Stream aborted during cleanup (normal)')
      // 不发送 error chunk，直接返回
      return
    }
    log.error('[CLIChatService] Error:', error)
    onChunk({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    session.isStreaming = false
    session.abortController = undefined
  }
}

/**
 * 发送消息并获取完整响应（非流式）
 */
export async function sendCLIMessage(
  sessionId: string,
  message: string
): Promise<{ content: string; toolCalls?: Array<{ name: string; result: string }> }> {
  const session = sessions.get(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  // 加载配置
  const config = loadConfig()
  if (!config.apiKey) {
    throw new Error('API key not configured')
  }

  try {
    // 构建消息历史
    if (session.messages.length === 0) {
      session.messages.push({
        role: 'system',
        content: buildSystemPrompt(session.mode, session.cwd)
      })
    }

    session.messages.push({
      role: 'user',
      content: message
    })

    // 获取工具定义（Agent 模式）
    const tools = session.mode === 'agent'
      ? toolRegistry.getAll().map(tool => {
          // 清理参数定义，移除 required 字段（OpenAI API 要求 required 在 parameters 级别）
          const properties: Record<string, { type: string; description: string; enum?: string[]; default?: unknown }> = {}
          for (const [key, param] of Object.entries(tool.parameters)) {
            properties[key] = {
              type: param.type,
              description: param.description,
              ...(param.enum && { enum: param.enum }),
              ...(param.default !== undefined && { default: param.default })
            }
          }
          
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: {
                type: 'object',
                properties,
                required: tool.required
              }
            }
          }
        })
      : undefined

    // 根据选中的模型找到对应的 provider
    const rawModelForTools = config.model || config.defaultModel || 'claude-3-5-sonnet'
    let selectedProviderForTools = config.providers?.find(p => 
      p.enabled && p.models?.some(m => m.id === rawModelForTools)
    )
    if (!selectedProviderForTools) {
      selectedProviderForTools = config.providers?.find(p => p.enabled)
    }
    const modelForTools = getValidModelId(rawModelForTools, selectedProviderForTools?.name)
    
    // 发送请求
    const response = await sendChatMessage({
      apiKey: config.apiKey,
      model: modelForTools,
      messages: session.messages,
      tools,
      stream: false,
      apiUrl: config.providers?.[0]?.apiUrl
    })

    // 处理工具调用
    const toolCallResults: Array<{ name: string; result: string }> = []
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments)
        const result = await executeToolCall(
          toolCall.function.name,
          args,
          session.cwd
        )
        toolCallResults.push({
          name: toolCall.function.name,
          result: result.success ? result.output : result.error || 'Error'
        })
      }
    }

    // 提取内容
    let content = ''
    if (Array.isArray(response.content)) {
      content = response.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
    } else {
      content = String(response.content || '')
    }

    // 更新消息历史
    session.messages.push({
      role: 'assistant',
      content
    })

    return {
      content,
      toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined
    }

  } catch (error) {
    log.error('[CLIChatService] Error:', error)
    throw error
  }
}

/**
 * 清理所有会话
 */
export function cleanupCLISessions(): void {
  for (const [sessionId, session] of sessions) {
    if (session.abortController) {
      try {
        session.abortController.abort()
      } catch (error) {
        // ✅ 修复：忽略 abort 时的错误，这是正常的清理操作
        log.debug(`[CLIChatService] Error during session cleanup: ${error}`)
      }
    }
  }
  sessions.clear()
  log.info('[CLIChatService] Cleaned up all sessions')
}

// 导出类型
export type { CLISession }
