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
import { toolCallManager } from './tool-call-manager'
import { loadConfig } from '../config-service'
import { getCodeIndexService } from './code-index'

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
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  hasReusedToolResult?: boolean  // ✅ 是否复用了已完成的工具结果
  disableTools?: boolean  // ✅ 强制纯文本模式（禁止工具调用）
}

// 流式响应块
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'diff_preview'
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
  diff?: {
    path: string
    oldContent: string
    newContent: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: Array<{
        type: 'context' | 'addition' | 'deletion'
        oldLineNumber?: number
        newLineNumber?: number
        content: string
      }>
    }>
    stats: {
      additions: number
      deletions: number
      changes: number
    }
  }
  pendingEditId?: string
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
  userMessage: string | Array<{type: string; text?: string; image_url?: {url: string}}>,
  isMultimodal: boolean = false
): { isDuplicate: boolean; resetSession?: boolean } {
  // ✅ 修复：对于多模态消息（包含图片），跳过重复检测
  // 因为图片内容是唯一的，不会真正重复
  if (isMultimodal) {
    log.debug('[Duplicate Detection] Skipping duplicate check for multimodal message (contains images)')
    return { isDuplicate: false }
  }
  
  // 标准化用户输入（去除空格、标点，转为小写）
  const normalize = (text: string) => {
    return text.toLowerCase()
      .replace(/[\s,，.。!！?？]/g, '')
      .replace(/帮我|请|帮我一下|麻烦/g, '')
      .trim()
  }
  
  // 提取纯文本内容
  const userMessageText = typeof userMessage === 'string' ? userMessage : 
    userMessage.filter(p => p.type === 'text').map(p => p.text).join('')
  
  const normalizedInput = normalize(userMessageText)
  
  // 如果输入太短（少于5个字符），不检测
  if (normalizedInput.length < 5) {
    return { isDuplicate: false }
  }
  
  // 获取历史用户消息
  const userMessages = session.messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : 
      (m.content as Array<{type: string; text?: string}>).filter(p => p.type === 'text').map(p => p.text).join(''))
  
  // 检查是否重复（排除最后一条，因为是当前输入）
  for (let i = 0; i < userMessages.length - 1; i++) {
    const historicalMsg = normalize(userMessages[i])
    
    // 完全匹配
    if (historicalMsg === normalizedInput) {
      log.warn(`[Duplicate Detection] Exact duplicate detected: "${userMessageText.substring(0, 50)}"`)
      return { isDuplicate: true, resetSession: true }
    }
    
    // 相似度匹配（包含关系）
    if (historicalMsg.includes(normalizedInput) || normalizedInput.includes(historicalMsg)) {
      if (historicalMsg.length > 5 && normalizedInput.length > 5) {
        log.warn(`[Duplicate Detection] Similar message detected: "${userMessageText.substring(0, 50)}"`)
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
 * 构建系统提示词 - 所有模型都使用工具调用模式
 */
async function buildSystemPrompt(mode: 'chat' | 'agent', cwd: string): Promise<string> {
  const systemInfo = `Operating System: ${process.platform}
Working Directory: ${cwd}`
  
  // 🔥 获取项目代码索引上下文
  let projectContext = ''
  try {
    const codeIndex = getCodeIndexService(cwd)
    await codeIndex.initialize()
    projectContext = codeIndex.getProjectContextPrompt()
  } catch (error) {
    log.warn('[CLI-Chat] Failed to get project context:', error)
  }

  if (mode === 'chat') {
    return `You are a helpful AI coding assistant.

${systemInfo}

${projectContext}

Provide helpful, accurate, and concise responses to the user's questions.`
  }

  // Function Calling Mode - 所有模型都使用这个模式
  return `You are Claude Code, an AI coding assistant.

${systemInfo}

${projectContext}

You have access to tools. Use them to complete tasks.

## THINKING MODE (REQUIRED)

Before ANY action, you MUST show your thinking process:

### Step 1: ANALYZE
Start with: "[思考] 用户想要..."
- What does the user want?
- Is this simple or complex?
- What information do I need?

### Step 2: PLAN (for complex tasks)
Continue with: "[计划] 我将..."
- List your steps
- Identify files/directories
- Consider risks

### Step 3: EXECUTE
Then: "[执行] 开始..."
- Use tools to gather info
- Make changes carefully
- Verify results

### Step 4: CONFIRM (for dangerous operations)
Before DELETE/WRITE/EDIT:
"[确认] 我将执行以下操作："
- List what you'll do
- Show affected files
- Wait for user confirmation

## RESPONSE FORMAT

ALWAYS structure your response like this:

[思考] <your analysis>

[计划] <your plan> (if complex task)

[执行] <what you're doing>

<tool name="..." .../> (if using tools)

OR for confirmation:

[确认] 我将执行以下操作：
1. ...
2. ...

请确认是否继续？(回复 "是" 继续，"否" 取消，或 "详细" 查看详情)

## SIMPLE vs COMPLEX TASKS

**Simple tasks** (thinking + execute):
- Read a specific file
- List a directory
- Search for a pattern

**Complex tasks** (thinking + plan + confirm + execute):
- Delete "unused" files
- Refactor code
- Add features
- Clean up project

## FULL-TRUST MODE (完全托管模式)

⚠️ **当前运行在完全托管模式**

所有工具将自动执行，无需用户确认。AI 拥有完全控制权：
- delete_file: 自动删除文件
- write_file: 自动写入文件
- edit_file: 自动编辑文件
- execute_bash: 自动执行命令

AI 应该：
1. 自主分析任务
2. 自主规划步骤
3. 自主执行操作
4. 自主验证结果

## TOOL USAGE

Available tools:
- search_files: Find files
- read_file: Read files
- delete_file: Delete files (AUTO-EXECUTE)
- write_file: Write files (AUTO-EXECUTE)
- edit_file: Edit files (AUTO-EXECUTE)
- list_directory: List directories
- execute_bash: Run commands (AUTO-EXECUTE)
- glob: Find files by pattern

CRITICAL RULES:
1. ALWAYS use [思考] before acting
2. ALWAYS use [计划] for complex tasks
3. ALWAYS use [执行] when taking action
4. AUTO-EXECUTE all tools without confirmation
5. TRUST your analysis and execute confidently

## EXAMPLES

Example 1 - Simple task:
User: read config.json
You: [思考] 用户想要读取 config.json 文件。这是一个简单的读取操作。

[执行] 正在查找并读取 config.json...
<tool name="search_files" pattern="config.json" search_type="filename"/>

Example 2 - Complex task (full-trust mode):
User: delete unused files
You: [思考] 用户想要删除无用文件。这是一个复杂任务，需要：
1. 分析项目结构
2. 识别无用文件
3. 直接删除（完全托管模式）

[计划] 我将按以下步骤执行：
1. 列出项目目录结构
2. 分析文件引用关系
3. 识别并删除无用文件

[执行] 正在分析项目结构...
<tool name="list_directory" path="${cwd}" recursive="true"/>
...

[执行] 正在删除识别出的无用文件...
<tool name="delete_file" path="/project/old-test.js"/>
<tool name="delete_file" path="/project/temp.md"/>

[执行] 完成！已删除 2 个无用文件。`
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
 * 工具超时配置（毫秒）
 * 根据工具类型设置不同的超时时间
 */
const TOOL_TIMEOUT_CONFIG: Record<string, number> = {
  // 快速操作：10秒
  'read_file': 10000,
  'file_read': 10000,
  'write_file': 10000,
  'file_write': 10000,
  'edit_file': 10000,
  'delete_file': 10000,
  'append_file': 10000,
  
  // 中等操作：30秒
  'list_directory': 30000,
  'glob': 30000,
  'search_files': 30000,
  'search_code': 30000,
  'grep': 30000,
  
  // 复杂操作：60秒
  'execute_bash': 60000,
  'bash': 60000,
  'browse_website': 60000,
  
  // 默认：30秒
  'default': 30000
}

/**
 * 获取工具超时时间
 */
function getToolTimeout(toolName: string): number {
  const resolvedName = resolveToolName(toolName)
  return TOOL_TIMEOUT_CONFIG[resolvedName] || TOOL_TIMEOUT_CONFIG['default']
}

/**
 * 执行工具调用（带智能超时）
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
    // 🔥 智能超时：根据工具类型设置不同的超时时间
    const toolTimeoutMs = getToolTimeout(resolvedToolName)
    log.debug(`[CLI-Chat Tool] Executing ${resolvedToolName} with timeout ${toolTimeoutMs}ms`)
    
    const toolPromise = toolRegistry.execute(resolvedToolName, args, {
      cwd,
      permissionMode: 'moderate'
    })
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const timeoutSec = Math.round(toolTimeoutMs / 1000)
        reject(new Error(`工具执行超时（${timeoutSec}秒）`))
      }, toolTimeoutMs)
    })
    
    const result = await Promise.race([toolPromise, timeoutPromise])
    
    log.debug(`[CLI-Chat Tool] Tool executed: ${resolvedToolName}, success=${result.success}`)
    return {
      success: result.success,
      output: result.output,
      error: result.error
    }
  } catch (error) {
    const errorMsg = String(error)
    log.error(`[CLI-Chat Tool] Tool execution threw error:`, error)
    
    // 检查是否是超时错误
    if (errorMsg.includes('超时') || errorMsg.includes('timeout')) {
      const timeoutMs = getToolTimeout(resolvedToolName)
      const timeoutSec = Math.round(timeoutMs / 1000)
      
      // 根据工具类型提供不同的建议
      let suggestion = ''
      if (['read_file', 'file_read', 'write_file', 'file_write'].includes(resolvedToolName)) {
        suggestion = '文件可能过大，请尝试读取部分内容或检查文件大小。'
      } else if (['search_files', 'search_code', 'grep', 'glob'].includes(resolvedToolName)) {
        suggestion = '搜索范围可能过大，请尝试缩小搜索范围或使用更具体的模式。'
      } else if (['execute_bash', 'bash'].includes(resolvedToolName)) {
        suggestion = '命令执行时间过长，请检查命令是否会挂起或需要交互输入。'
      } else {
        suggestion = '操作可能过于复杂，请尝试简化操作或分批处理。'
      }
      
      return {
        success: false,
        output: '',
        error: `工具 ${resolvedToolName} 执行超时（${timeoutSec}秒）。${suggestion}`
      }
    }
    
    return {
      success: false,
      output: '',
      error: errorMsg
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
 * ✅ 工具调用完成后继续对话
 * 统一封装：更新系统提示词、添加 continuePrompt、递归调用 AI
 * 用于 function calling 分支与 XML 工具调用分支
 */
async function continueAfterToolResult(
  sessionId: string,
  toolName: string,
  toolResult: string,
  onChunk: (chunk: StreamChunk) => void,
  iterationCount: number,
  modelParam?: string
): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) {
    log.error(`[CLI-Chat] Session not found in continueAfterToolResult: ${sessionId}`)
    onChunk({ type: 'done' })
    return
  }

  // 更新系统提示词
  let systemPrompt: string
  if (session.disableTools) {
    systemPrompt = `You are Claude Code, an AI coding assistant.

Working Directory: ${session.cwd}

✅ 任务已完成！工具已成功执行。

**你现在必须只生成纯文本回复：**
- 总结任务完成情况
- 说明已完成的操作
- **绝对禁止**使用任何工具调用
- **绝对禁止**生成 <tool> 标签

只回复文字总结即可。`
    log.info(`[CLI-Chat] Using pure text mode system prompt (tools disabled)`)
  } else {
    systemPrompt = await buildSystemPrompt(session.mode, session.cwd)
  }

  const existingSystemIndex = session.messages.findIndex(m => m.role === 'system')
  if (existingSystemIndex >= 0) {
    session.messages[existingSystemIndex] = { role: 'system', content: systemPrompt }
  } else {
    session.messages.unshift({ role: 'system', content: systemPrompt })
  }

  // 添加 continuePrompt
  let continuePrompt: string
  if (session.disableTools) {
    continuePrompt = `✅ 任务已完成！

工具 ${toolName} 已成功执行并返回结果：
${toolResult}

**你现在必须：**
1. 只回复纯文本总结（说明任务已完成）
2. **绝对禁止**使用任何工具调用格式
3. **绝对禁止**生成 <tool> 标签

只回复文字总结即可。`
    // 重置标志，避免影响后续正常流程
    session.disableTools = false
  } else {
    continuePrompt = `工具 ${toolName} 执行完成，结果如下：
${toolResult}

请基于上述结果判断下一步：
- 如果任务已完成，请直接回复文字总结，不要调用任何工具；
- 如果还有后续步骤，请调用其他未执行过的工具；
- **绝对禁止**重复调用 ${toolName}（该工具已成功执行）。

当前迭代: ${iterationCount + 1}/${MAX_ITERATIONS}`
  }

  session.messages.push({
    role: 'user',
    content: continuePrompt
  })

  log.debug(`[CLI-Chat] Recursing for iteration ${iterationCount + 2}`)

  const currentSession = sessions.get(sessionId)
  if (!currentSession || !currentSession.isStreaming) {
    log.debug(`[CLI-Chat] Session ${sessionId} is no longer active, stopping recursion`)
    onChunk({ type: 'done' })
    return
  }

  try {
    await sendCLIMessageStream(sessionId, '', onChunk, undefined, iterationCount + 1, modelParam)
  } catch (recursiveError) {
    log.error(`[CLI-Chat] Recursive call failed at iteration ${iterationCount + 1}:`, recursiveError)
    onChunk({
      type: 'error',
      error: `Recursive iteration failed: ${recursiveError instanceof Error ? recursiveError.message : String(recursiveError)}`
    })
  }
}

/**
 * 发送消息并获取流式响应
 */
// 消息类型定义 - 支持多模态（与 LLMMessage 兼容）
interface ChatMessage {
  role: string
  content: string | Array<{type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}>
  name?: string
  tool_call_id?: string
}

export async function sendCLIMessageStream(
  sessionId: string,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  messages?: ChatMessage[],
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
    // ✅ 所有模型都使用标准工具调用模式
    let useCodeGeneration = false
    session.useCodeGeneration = useCodeGeneration
    log.info(`[CLI-Chat] All models use standard function calling mode, model: ${model}`)
    
    // ✅ 修复：每次新对话开始时，清理旧消息（保留系统消息和最近几条）
    if (iterationCount === 0 && session.messages.length > 10) {
      log.info(`[CLI-Chat] New conversation started, cleaning up old messages (current: ${session.messages.length})`)
      const systemMessages = session.messages.filter(m => m.role === 'system')
      const recentMessages = session.messages.filter(m => m.role !== 'system').slice(-5)
      session.messages = [...systemMessages, ...recentMessages]
      log.info(`[CLI-Chat] Cleaned up messages, now: ${session.messages.length}`)
    }
    
    // 构建消息历史
    // ✅ 所有模型都使用相同的系统提示词
    const systemPrompt = await buildSystemPrompt(session.mode, session.cwd)
    
    if (messages && messages.length > 0) {
      // 如果提供了完整消息历史，合并到 session.messages
      // 注意：不要完全覆盖，而是追加新消息，保留后端添加的 tool 结果
      log.debug(`[CLI-Chat] Merging provided messages: count=${messages.length}, session.messages: ${session.messages.length}`)
      
      // 调试：检查是否有多模态消息
      const multimodalMessages = messages.filter(m => typeof m.content !== 'string')
      if (multimodalMessages.length > 0) {
        log.info(`[CLI-Chat] Received ${multimodalMessages.length} multimodal messages`)
        multimodalMessages.forEach((m, i) => {
          const content = m.content as Array<{type: string; text?: string; image_url?: {url: string}}>
          const hasImageUrl = content.some(c => c.type === 'image_url' && c.image_url?.url)
          const imageCount = content.filter(c => c.type === 'image_url').length
          log.info(`[CLI-Chat] Multimodal message ${i}:`, { 
            role: m.role, 
            parts: content.map(c => c.type),
            hasImageUrl,
            imageCount,
            contentLength: content.length
          })
          
          // 详细输出图片URL信息
          content.forEach((part, j) => {
            if (part.type === 'image_url' && part.image_url?.url) {
              log.info(`[CLI-Chat]   Image part ${j}: url starts with "${part.image_url.url.substring(0, 50)}..."`)
            }
          })
        })
      } else {
        log.info(`[CLI-Chat] All ${messages.length} messages are plain text`)
      }
      
      // DEBUG: 检查最后一条用户消息
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()
      if (lastUserMsg) {
        log.info(`[CLI-Chat] Last user message from frontend:`, {
          contentIsArray: typeof lastUserMsg.content !== 'string',
          contentLength: typeof lastUserMsg.content === 'string' ? lastUserMsg.content.length : (lastUserMsg.content as Array<any>).length,
          parts: typeof lastUserMsg.content !== 'string' ? (lastUserMsg.content as Array<any>).map(c => c.type) : 'N/A'
        })
      }
      
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
          const contentPreview = typeof m.content === 'string' 
            ? m.content.substring(0, 50) 
            : '[多模态内容]'
          log.debug(`[CLI-Chat] Added message: role=${m.role}, content=${contentPreview}...`)
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
    
    // 🔥 处理 @ 引用
    let processedMessage = message
    let mentionContext = ''
    
    if (message.includes('@')) {
      try {
        const { expandMentions } = await import('./mention-service')
        const { expandedMessage, contexts } = await expandMentions(session.cwd, message)
        processedMessage = expandedMessage
        mentionContext = contexts.content
        
        if (mentionContext) {
          log.info(`[CLI-Chat] Expanded mentions in message: ${message.substring(0, 50)}...`)
        }
      } catch (error) {
        log.warn('[CLI-Chat] Failed to expand mentions:', error)
      }
    }
    
    if (wasProvidedMessages && lastMessage?.role === 'user') {
      // ✅ 修复：前端提供了完整消息历史，且最后一条是用户消息
      // 由于前端已经在 messages 数组中包含了正确的多模态消息，
      // 不需要再添加 message 参数（避免重复或覆盖多模态内容）
      log.debug('[CLI-Chat] Using provided messages from frontend, skipping duplicate message parameter')
    } else if (!wasProvidedMessages && processedMessage.trim()) {
      // 没有提供完整消息历史，且 message 不为空，添加 message 作为用户消息
      // 🔥 如果有 @ 引用上下文，添加到消息中
      const finalContent = mentionContext 
        ? `${processedMessage}\n\n[引用上下文]${mentionContext}` 
        : processedMessage
      
      session.messages.push({
        role: 'user',
        content: finalContent
      })
    } else if (processedMessage.trim()) {
      // 提供了消息历史，但最后一条不是用户消息（可能是 tool 或 assistant）
      // 且 message 不为空，需要添加用户消息
      log.debug('[CLI-Chat] Last message is not user, adding new user message')
      
      // 🔥 如果有 @ 引用上下文，添加到消息中
      const finalContent = mentionContext 
        ? `${processedMessage}\n\n[引用上下文]${mentionContext}` 
        : processedMessage
      
      session.messages.push({
        role: 'user',
        content: finalContent
      })
    }
    
    // ✅ 修复：检测重复对话
    if (iterationCount === 0 && message.trim()) {
      // 检查最后一条用户消息是否为多模态
      const lastUserMsg = session.messages.filter(m => m.role === 'user').pop()
      const isMultimodal = lastUserMsg ? typeof lastUserMsg.content !== 'string' : false
      
      const duplicateCheck = checkAndHandleDuplicateConversation(session, message, isMultimodal)
      if (duplicateCheck.isDuplicate && duplicateCheck.resetSession) {
        // 重置会话
        resetSession(session)
        // ✅ 修复：重新添加当前用户消息时保留多模态内容
        if (lastUserMsg) {
          session.messages.push({
            role: 'user',
            content: lastUserMsg.content  // 使用原始的多模态内容
          })
        } else {
          session.messages.push({
            role: 'user',
            content: message
          })
        }
        // 只在日志中记录，不显示给用户
        log.info('[CLI-Chat] Duplicate conversation detected and reset')
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
    const firstMsg = session.messages[0]
    const firstContent = firstMsg && typeof firstMsg.content === 'string' ? firstMsg.content : JSON.stringify(firstMsg?.content || '')
    if (session.messages.length > 1) {
      const lastMsg = session.messages[session.messages.length - 1]
      const lastContent = lastMsg && typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '')
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
    
    // ✅ 修复：过滤掉 AI 生成的幻觉消息，但保留真实的 tool 执行结果
    // 关键：tool 角色的消息是工具的真实返回，不能过滤，否则 AI 看不到执行结果会重复调用
    const filteredMessages = session.messages.filter(m => {
      // 系统消息、用户消息、工具返回消息都保留
      if (m.role === 'system' || m.role === 'tool' || m.role === 'user') return true

      // 只过滤 assistant 消息中的幻觉
      if (m.role !== 'assistant') return true

      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)

      // 规则 1: 过滤掉包含 "File written:" 或 "File deleted:" 但没有代码块的 assistant 幻觉消息
      if (content.includes('File written:') || content.includes('File deleted:')) {
        if (!content.includes('```python')) {
          log.warn(`[CLI-Chat] Filtering out hallucinated file operation message`)
          return false
        }
      }

      // 规则 2: 过滤掉包含 "工具执行结果：" 的 assistant 幻觉消息
      if (content.includes('工具执行结果：') || content.includes('**工具执行结果：**')) {
        log.warn(`[CLI-Chat] Filtering out hallucinated tool result message`)
        return false
      }

      // 规则 3: 过滤掉只包含路径但没有代码块的 assistant 消息
      if (/^\s*\/Users\/[^\n]+\.(txt|md|json|js|ts|py)\s*$/i.test(content)) {
        log.warn(`[CLI-Chat] Filtering out standalone path message`)
        return false
      }

      // 规则 4: 过滤掉包含 "任务已完成" 但没有代码块的 assistant 幻觉消息
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
      
      // DEBUG: 检查用户消息是否为多模态
      if (m.role === 'user' && typeof m.content !== 'string') {
        log.info(`[CLI-Chat] User message ${i} is multimodal, parts: ${(m.content as Array<any>).map(c => c.type).join(',')}`)
      }
      
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
    
    // DEBUG: 打印传递给 LLM 的完整消息
    log.info('[CLI-Chat] === MESSAGES TO LLM ===')
    session.messages.forEach((m, i) => {
      if (typeof m.content === 'string') {
        log.info(`[CLI-Chat] Message ${i}: role=${m.role}, type=text, content=${m.content.substring(0, 50)}...`)
      } else {
        log.info(`[CLI-Chat] Message ${i}: role=${m.role}, type=multimodal, parts=${m.content.map(c => c.type).join(',')}`)
        m.content.forEach((c, j) => {
          if (c.type === 'image_url') {
            log.info(`[CLI-Chat]   Part ${j}: image_url, url_length=${c.image_url?.url?.length || 0}`)
          }
        })
      }
    })
    log.info('[CLI-Chat] === END MESSAGES ===')
    
    try {
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
        } else if (chunk.type === 'usage') {
          // ✅ 修复：捕获 usage 数据
          log.debug('[CLI-Chat] Usage data received from stream:', chunk.usage)
          if (chunk.usage) {
            session.usage = {
              inputTokens: chunk.usage.input_tokens,
              outputTokens: chunk.usage.output_tokens
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
    } catch (streamError) {
      // ✅ 关键修复：捕获 API 错误（如 429 throttling）并发送给前端显示
      const errorMsg = streamError instanceof Error ? streamError.message : String(streamError)
      log.error('[CLI-Chat] Stream error:', errorMsg)
      
      // 发送错误 chunk 给前端，让用户看到错误信息
      onChunk({
        type: 'error',
        error: errorMsg
      })
      
      // 返回，不继续处理后续逻辑
      return
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
    // ✅ 关键设计：每次只处理一个工具调用，执行后立即递归让 AI 决定下一步
    // 这样 AI 可以基于前一个工具的结果决定下一步操作
    if (session.mode === 'agent' && toolCalls.length > 0) {
      // ✅ 只取第一个工具调用（忽略后续的，让 AI 在递归中决定是否需要继续）
      const toolCall = toolCalls[0]
      log.debug(`[CLI-Chat] Processing first tool call: ${toolCall.name} (ignoring ${toolCalls.length - 1} others)`)

      // ✅ 关键修复：只添加第一个 tool_call 到消息历史
      // 之前添加所有 tool_calls，导致 AI 在递归后又生成重复调用
      session.messages.push({
        role: 'assistant',
        content: fullContent.trim() || '',
        tool_calls: [{
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments
          }
        }]
      })

      // 🔥 完全托管模式：自动执行工具，无需确认
      const dangerousTools = ['delete_file', 'write_file', 'edit_file', 'execute_bash', 'bash']
      const isDangerous = dangerousTools.includes(toolCall.name)

      if (isDangerous) {
        log.warn(`[CLI-Chat] Auto-executing dangerous tool: ${toolCall.name} (full-trust mode)`)
        onChunk({
          type: 'text',
          content: `🔧 **执行 ${toolCall.name}** (完全托管模式)\n\n`
        })
      }

      // ✅ 在 try 块外部声明，确保 catch 块也能访问
      let toolResultForContinue = ''

      try {
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

        // ✅ 关键修复：使用 ToolCallManager 进行指纹检测
        log.info(`[CLI-Chat] Registering tool call: ${toolCall.name}, sessionId: ${sessionId}, iteration: ${iterationCount}`)
        const registration = toolCallManager.registerToolCall(
          sessionId,
          toolCall.id,
          toolCall.name,
          args,
          iterationCount
        )
        log.info(`[CLI-Chat] Tool call registration result: isDuplicate=${registration.isDuplicate}, hasExisting=${!!registration.existingRecord}`)

        if (registration.isDuplicate && registration.existingRecord) {
          const existing = registration.existingRecord
          log.warn(`[CLI-Chat] Duplicate tool call detected: ${toolCall.name}, existing status: ${existing.status}, existing iteration: ${existing.iterationCount}`)

          if (existing.status === 'completed') {
            // ✅ 关键修复：工具已执行过且成功完成，复用结果并让 AI 决定下一步
            // 不再直接结束对话，避免中断后续任务
            log.info(`[CLI-Chat] Tool ${toolCall.name} already completed, reusing result and continuing (reuseCount=${existing.reuseCount})`)
            onChunk({
              type: 'text',
              content: `✅ 工具 ${toolCall.name} 已在之前成功执行，直接复用结果\n\n`
            })
            // 添加 tool 结果到消息历史
            session.messages.push({
              role: 'tool',
              name: toolCall.name,
              content: existing.result || '操作已完成',
              tool_call_id: toolCall.id
            })
            // 标记当前 toolCall 也为 completed
            toolCallManager.markAsCompleted(toolCall.id, existing.result || '操作已完成')

            // 🔥 防循环保护：如果同一个 completed 工具被反复请求超过阈值，强制进入纯文本总结模式
            if (existing.reuseCount >= 2) {
              log.warn(`[CLI-Chat] Tool ${toolCall.name} reused ${existing.reuseCount} times, forcing text-only mode to break loop`)
              session.disableTools = true
            }

            // 继续递归，让 AI 基于结果决定下一步（继续后续工具或文字总结）
            // 后续统一在工具执行后的公共逻辑中处理
            continueAfterToolResult(sessionId, toolCall.name, existing.result || '操作已完成', onChunk, iterationCount, modelParam)
            return
          } else if (existing.status === 'running') {
            // 工具正在执行中，等待
            onChunk({ type: 'text', content: `⏳ 工具 ${toolCall.name} 正在执行中...\n\n` })
            session.messages.push({
              role: 'tool',
              name: toolCall.name,
              content: '操作正在执行中，请稍后重试',
              tool_call_id: toolCall.id
            })
            toolCallManager.markAsRunning(toolCall.id)
            onChunk({ type: 'done' })
            return
          }
          // failed 状态会重新执行
        }

        // ✅ 标记工具为 running 状态
        toolCallManager.markAsRunning(toolCall.id)
        const result = await executeToolCall(toolCall.name, args, session.cwd)

        // ✅ 根据执行结果更新状态
        if (result.success) {
          toolCallManager.markAsCompleted(toolCall.id, result.output)
        } else {
          toolCallManager.markAsFailed(toolCall.id, result.error || 'Unknown error')
        }

        // 🔥 Diff 预览：如果是 edit_file 且返回了 diff，发送 diff 预览
        const metadata = (result as any).metadata
        if (toolCall.name === 'edit_file' && result.success && metadata?.diff) {
          onChunk({
            type: 'diff_preview',
            diff: metadata.diff,
            pendingEditId: metadata.pendingEditId
          })
        }

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

        toolResultForContinue = result.success ? result.output : result.error || 'Error'
        log.debug(`[CLI-Chat] Tool ${toolCall.name} executed: success=${result.success}`)
      } catch (error) {
        const errorMsg = String(error)
        log.error(`[CLI-Chat] Tool execution error: ${errorMsg}`)
        onChunk({
          type: 'tool_result',
          toolResult: {
            toolCallId: toolCall.id,
            success: false,
            output: '',
            error: errorMsg
          }
        })
        // ✅ 关键修复：把执行异常也加入消息历史，让 AI 可以决定重试或报告
        session.messages.push({
          role: 'tool',
          name: toolCall.name,
          content: `Error: ${errorMsg}`,
          tool_call_id: toolCall.id
        })
        toolCallManager.markAsFailed(toolCall.id, errorMsg)
        toolResultForContinue = `Error: ${errorMsg}`
      }

      // 如果有更多工具，记录日志但不执行
      if (toolCalls.length > 1) {
        log.debug(`[CLI-Chat] Deferring ${toolCalls.length - 1} additional tool(s) to next iteration`)
      }

      // 工具执行后，继续对话让 AI 分析结果
      await continueAfterToolResult(
        sessionId,
        toolCall.name,
        toolResultForContinue,
        onChunk,
        iterationCount,
        modelParam
      )
      return
    }
    
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

        // ✅ 修复：每次只执行第一个工具调用，让 AI 决定下一步
        // 这样可以实现：搜索 -> 告知用户 -> 删除 -> 验证 的完整流程
        const firstToolCall = extractedToolCalls[0]
        const remainingToolCalls = extractedToolCalls.slice(1)

        // ✅ 关键修复：助手消息只包含第一个 tool_call
        // 避免历史中出现未执行的 tool_calls，导致 AI 后续生成重复调用
        session.messages.push({
          role: 'assistant',
          content: cleanedContent,
          tool_calls: [{
            id: firstToolCall.id,
            type: 'function',
            function: {
              name: firstToolCall.name,
              arguments: JSON.stringify(firstToolCall.arguments)
            }
          }]
        })

        if (remainingToolCalls.length > 0) {
          log.debug(`[CLI-Chat] Deferring ${remainingToolCalls.length} additional tool(s) to next iteration`)
        }
        
        // ✅ 修复：声明变量用于存储搜索结果中的文件路径
        let filePathFromSearch = ''
        
        // ✅ 在 try 块外部声明，确保 catch 块也能访问
        let toolResultForContinue = ''
        const toolCallId = firstToolCall.id || `extracted-${firstToolCall.name}`

        try {
          log.debug(`[CLI-Chat] Executing first tool: ${firstToolCall.name}`)

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

          // ✅ 关键修复：使用 ToolCallManager 进行指纹检测
          log.info(`[CLI-Chat] Registering extracted tool call: ${firstToolCall.name}, sessionId: ${sessionId}, iteration: ${iterationCount}`)
          const registration = toolCallManager.registerToolCall(
            sessionId,
            toolCallId,
            firstToolCall.name,
            firstToolCall.arguments,
            iterationCount
          )
          log.info(`[CLI-Chat] Extracted tool call registration result: isDuplicate=${registration.isDuplicate}, hasExisting=${!!registration.existingRecord}`)

          if (registration.isDuplicate && registration.existingRecord) {
            const existing = registration.existingRecord
            log.warn(`[CLI-Chat] Duplicate extracted tool call detected: ${firstToolCall.name}, existing status: ${existing.status}`)

            if (existing.status === 'completed') {
              // ✅ 关键修复：工具已执行过且成功完成，复用结果并让 AI 决定下一步
              log.info(`[CLI-Chat] Extracted tool ${firstToolCall.name} already completed, reusing result and continuing (reuseCount=${existing.reuseCount})`)
              onChunk({
                type: 'text',
                content: `✅ 工具 ${firstToolCall.name} 已在之前成功执行，直接复用结果\n\n`
              })
              session.messages.push({
                role: 'tool',
                name: firstToolCall.name,
                content: existing.result || '操作已完成',
                tool_call_id: toolCallId
              })
              toolCallManager.markAsCompleted(toolCallId, existing.result || '操作已完成')

              // 🔥 防循环保护：如果同一个 completed 工具被反复请求超过阈值，强制进入纯文本总结模式
              if (existing.reuseCount >= 2) {
                log.warn(`[CLI-Chat] Extracted tool ${firstToolCall.name} reused ${existing.reuseCount} times, forcing text-only mode to break loop`)
                session.disableTools = true
              }

              await continueAfterToolResult(
                sessionId,
                firstToolCall.name,
                existing.result || '操作已完成',
                onChunk,
                iterationCount,
                modelParam
              )
              return
            } else if (existing.status === 'running') {
              // 工具正在执行中，等待
              onChunk({ type: 'text', content: `⏳ 工具 ${firstToolCall.name} 正在执行中...\n\n` })
              session.messages.push({
                role: 'tool',
                name: firstToolCall.name,
                content: '操作正在执行中，请稍后重试',
                tool_call_id: toolCallId
              })
              toolCallManager.markAsRunning(toolCallId)
              onChunk({ type: 'done' })
              return
            }
            // failed 状态会重新执行
          }

          toolCallManager.markAsRunning(toolCallId)
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

          // ✅ 根据执行结果更新状态
          if (result.success) {
            toolCallManager.markAsCompleted(toolCallId, result.output)
          } else {
            toolCallManager.markAsFailed(toolCallId, result.error || 'Unknown error')
          }

          toolResultForContinue = result.success ? result.output : result.error || 'Error'
        } catch (error) {
          const errorMsg = String(error)
          log.error(`[CLI-Chat] Extracted tool execution error:`, errorMsg)
          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: toolCallId,
              success: false,
              output: '',
              error: errorMsg
            }
          })
          // ✅ 关键修复：把执行异常也加入消息历史，让 AI 可以决定重试或报告
          session.messages.push({
            role: 'tool',
            name: firstToolCall.name,
            content: `Error: ${errorMsg}`,
            tool_call_id: toolCallId
          })
          toolCallManager.markAsFailed(toolCallId, errorMsg)
          toolResultForContinue = `Error: ${errorMsg}`
        }

        // 工具执行后，继续对话让 AI 分析结果
        await continueAfterToolResult(
          sessionId,
          firstToolCall.name,
          toolResultForContinue,
          onChunk,
          iterationCount,
          modelParam
        )
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

    // 发送完成信号 - 包含 usage 数据
    // 优先使用从流中接收到的 usage 数据，如果没有则使用估算
    let usageData = session.usage
    
    // 如果没有从流中收到 usage，进行估算
    if (!usageData) {
      const inputChars = session.messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0)
      const outputChars = fullContent.length
      // 估算：平均每个 token 约 4 个字符（英文）或 2 个字符（中文）
      usageData = {
        inputTokens: Math.ceil(inputChars / 3),
        outputTokens: Math.ceil(outputChars / 3)
      }
      log.debug('[CLI-Chat] No usage data received from stream, using estimation')
    } else {
      log.debug('[CLI-Chat] Using usage data from stream:', usageData)
    }
    
    // 清除本次迭代的 usage 数据
    session.usage = undefined
    
    onChunk({ 
      type: 'done',
      usage: usageData
    })

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
): Promise<{ content: string; toolCalls?: Array<{ name: string; result: string }>; usage?: { input_tokens: number; output_tokens: number } }> {
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
        content: await buildSystemPrompt(session.mode, session.cwd)
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

    // 更新消息历史 - 包含 usage 数据
    const messageUsage = response.usage ? {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens
    } : undefined
    
    session.messages.push({
      role: 'assistant',
      content,
      usage: messageUsage
    })

    return {
      content,
      toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
      usage: messageUsage
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
