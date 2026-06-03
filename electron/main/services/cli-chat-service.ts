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
}

// 流式响应块
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: string
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

// 获取主窗口
function getMainWindow(): BrowserWindow | null {
  const { BrowserWindow } = require('electron')
  return BrowserWindow.getAllWindows()[0] || null
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

/**
 * 构建系统提示词
 */
function buildSystemPrompt(mode: 'chat' | 'agent', cwd: string): string {
  const systemInfo = `
Operating System: ${process.platform}
Working Directory: ${cwd}
Node Version: ${process.version}
`.trim()

  if (mode === 'chat') {
    return `You are a helpful AI coding assistant. You are running in an integrated development environment.

${systemInfo}

Provide helpful, accurate, and concise responses to the user's questions about code, development, and programming.
When showing code, use proper code blocks with language identifiers.`
  } else {
    return `You are an AI coding agent that can help with software development tasks.

${systemInfo}

You have access to various tools to help you complete tasks:
- read_file: Read the contents of a file
- write_file: Create or overwrite a file
- edit_file: Edit specific lines in a file
- list_directory: List files in a directory
- execute_bash: Execute shell commands
- search_files: Find files matching a pattern
- delete_file: Delete a file
- append_file: Append content to a file

CRITICAL INSTRUCTIONS FOR TOOL USAGE:

1. When you need to use a tool, you MUST output it in this EXACT format:
   <tool name="tool_name" param1="value1" param2="value2"/>

2. The tool call MUST be on its own line, without any markdown formatting, code blocks, or bullet points.

3. CORRECT examples:
   <tool name="read_file" path="/Users/test/project/README.md"/>
   <tool name="list_directory" path="/Users/test/project/src"/>
   <tool name="execute_bash" command="npm install"/>
   <tool name="write_file" path="/Users/test/output.txt" content="Hello World"/>
   <tool name="delete_file" path="/Users/test/project/old-file.txt"/>

4. INCORRECT formats (NEVER use these):
   - DO NOT use markdown code blocks like \`\`\`bash ... \`\`\` 
   - DO NOT use JSON format: {"tool": "read_file", "path": "..."}
   - DO NOT use parentheses format: read_file(/path/to/file)
   - DO NOT say "I'll use read_file" or "让我查看" - JUST USE THE TOOL DIRECTLY
   - DO NOT explain what you're going to do - JUST DO IT

5. Use the EXACT tool names: read_file, write_file, edit_file, list_directory, execute_bash, search_files, delete_file, append_file
   Do NOT use: file_read, file_write, bash, glob, or any other names.

6. Output the tool call directly in your response. Do NOT say "I'll use X tool" - just use it.

7. IMPORTANT: When suggesting commands to the user, use the <tool> format above. Do NOT wrap commands in markdown code blocks.

8. CRITICAL: When user asks you to perform an action (like delete file, read file, etc.), you MUST use the appropriate tool IMMEDIATELY. Do NOT ask for confirmation or explain what you're going to do. Just output the tool call.

9. For file operations, ALWAYS use the EXACT path provided by the user. If user says "delete test file", use <tool name="list_directory" path="..."/> first to find it, then <tool name="delete_file" path="..."/>.

CRITICAL: FOR LONG-RUNNING COMMANDS (servers, watchers, etc.):
- DO NOT use background execution with & or redirect output to files (>, >>, 2>&1)
- DO NOT use: npm run dev > /tmp/frontend.log 2>&1 &
- DO NOT use: php artisan serve > /tmp/backend.log 2>&1 &
- Instead, run commands directly in the terminal: npm run dev, php artisan serve
- The terminal will handle process management automatically
- You can stop processes later using: kill <PID> or killall <process_name>
- To check if a service is running, use: lsof -i :<port> or ps aux | grep <process>

Always think step by step and explain your reasoning, but when you need to use a tool, output it in the correct format immediately.`
  }
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
    return {
      success: false,
      output: '',
      error: `Tool not found: ${toolName}`
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
  const knownTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'execute_bash', 'search_files', 'delete_file', 'append_file']

  log.debug(`[CLI-Chat] Extracting tool calls from content: ${content.substring(0, 200)}...`)

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
// ✅ 性能优化：降低最大迭代次数，防止栈溢出和内存泄漏
const MAX_ITERATIONS = 20

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
    // 构建消息历史
    if (messages && messages.length > 0) {
      // 如果提供了完整消息历史，使用它（前端传来的包含系统提示词）
      log.debug(`[CLI-Chat] Using provided messages: count=${messages.length}`)
      session.messages = messages.map(m => {
        const msg: LLMMessage = { 
          role: m.role as 'system' | 'user' | 'assistant' | 'tool', 
          content: m.content
        }
        if (m.name) msg.name = m.name
        return msg
      })
    } else if (session.messages.length === 0) {
      // 否则，只在会话消息为空时添加系统提示词
      log.debug('[CLI-Chat] Building system prompt for new session')
      session.messages.push({
        role: 'system',
        content: buildSystemPrompt(session.mode, session.cwd)
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
    } else if (!wasProvidedMessages) {
      // 没有提供完整消息历史，添加 message 作为用户消息
      session.messages.push({
        role: 'user',
        content: message
      })
    } else {
      // 提供了消息历史，但最后一条不是用户消息（可能是 tool 或 assistant）
      // 需要添加用户消息
      log.debug('[CLI-Chat] Last message is not user, adding new user message')
      session.messages.push({
        role: 'user',
        content: message
      })
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

    for await (const chunk of streamChatMessage({
      apiKey,
      model,
      messages: session.messages,
      tools,
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
        const toolCall = {
          id: (chunk as { id?: string }).id || uuidv4(),
          name: (chunk as { name?: string }).name || '',
          arguments: JSON.stringify((chunk as { input?: unknown }).input || {})
        }
        toolCalls.push(toolCall)
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
            arguments: pending.arguments || '{}'
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
        const args = JSON.parse(toolCall.arguments)
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
      // 添加一个明确的用户消息来提示 AI 继续分析
      const continuePrompt = `工具执行完成。请分析上述结果并决定下一步行动。

重要提醒：
1. 如果任务已完成，提供最终总结
2. 如果需要更多信息，调用下一个工具继续探索
3. 如果需要修改文件，使用 write_file 或 edit_file
4. 不要停止，继续分析直到任务完全完成

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
    if (session.mode === 'agent' && fullContent.trim()) {
      const { toolCalls: extractedToolCalls, cleanedContent } = extractToolCallsFromContent(fullContent)
      log.debug(`[CLI-Chat] Extraction result: ${extractedToolCalls.length} tool calls found`)
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

        // 执行提取的工具调用
        for (const toolCall of extractedToolCalls) {
          try {
            log.debug(`[CLI-Chat] Executing extracted tool: ${toolCall.name}`)
            const result = await executeToolCall(toolCall.name, toolCall.arguments, session.cwd)

            // 使用工具调用的实际 ID
            const toolCallId = toolCall.id || `extracted-${toolCall.name}`

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
              name: toolCall.name,
              content: result.success ? result.output : result.error || 'Error',
              tool_call_id: `extracted-${toolCall.name}`
            })
          } catch (error) {
            log.error(`[CLI-Chat] Extracted tool execution error: ${error}`)
          }
        }

        // 继续对话
        const continuePrompt = `工具执行完成。请分析上述结果并决定下一步行动。

重要提醒：
1. 如果任务已完成，提供最终总结
2. 如果需要更多信息，调用下一个工具继续探索
3. 如果需要修改文件，使用 write_file 或 edit_file
4. 不要停止，继续分析直到任务完全完成

当前迭代: ${iterationCount + 1}/${MAX_ITERATIONS}`

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
