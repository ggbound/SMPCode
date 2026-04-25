import express, { Express, Request, Response } from 'express'
import { Server } from 'http'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'

// Import services
import {
  sendChatMessage,
  streamChatMessage,
  requestCodeCompletion
} from './services/llm-service'
import {
  getCodeCompletions,
  explainCode,
  refactorCode,
  getInlineEdit
} from './services/vscode-copilot-service'
import {
  buildCodeContext,
  analyzeSemantics,
  detectLanguage
} from './services/code-intelligence-service'
import {
  getCommandsService,
  executeCommand as executeMirroredCommand,
  findCommands,
  getCommandNames,
  renderCommandIndex
} from './services/commands-service'
import {
  findTools,
  getToolNames,
  renderToolIndex
} from './services/tools-service'
import { getTools } from './core/tools'
import {
  parseToolCallsFromText
} from './services/tools-core'
import {
  executeToolCalls
} from './services/tools-executor'
import {
  getExecutionRegistry,
  buildExecutionRegistry,
  MirroredCommand,
  MirroredTool
} from './services/execution-registry'
import { executeCommand, setCurrentWorkingDirectory, getCurrentWorkingDirectory } from './services/command-executor'
import { listDirectory, readFile, writeFile } from './services/files-service'
import { searchFiles } from './services/search-service'
import {
  CODE_TOOLS,
  ToolCall,
  ToolResult,
  registerAllTools,
  toolRegistry
} from './services/tools-definitions'
import { executeTool } from './services/tool-executor'
import {
  scanProject,
  getProjectContext,
  getProjectStructureForAI,
  shouldRefreshContext,
  refreshProjectContext,
  clearProjectContext
} from './services/project-context-service'
import { initGit } from './services/git-service'
import { executeTool as executeToolNew } from './services/tool-executor'

// Import new Port Architecture
import { PortRuntime, RuntimeSessionImpl } from './core/runtime'
import { QueryEnginePort } from './core/query-engine'
import {
  getCommand as getCoreCommand,
  getCommands as getCoreCommands,
  PORTED_COMMANDS
} from './core/commands'
import {
  getTool as getCoreTool,
  getTools as getCoreTools,
  PORTED_TOOLS
} from './core/tools'
import { buildPortManifest } from './core/port-manifest'
import { loadSession as loadPortSession, saveSession as savePortSession, listSessions as listPortSessions, deleteSession as deletePortSession, createStoredSession } from './core/session-store'
import { ToolPermissionContextImpl } from './core/permissions'

let server: Server | null = null

// Session storage
interface Session {
  id: string
  messages: Array<{ role: string; content: string }>
  createdAt: string
  inputTokens: number
  outputTokens: number
  projectPath?: string // 关联的项目文件夹路径
}

const sessions: Map<string, Session> = new Map()

// Process management for long-running commands
interface ManagedProcess {
  id: string
  command: string
  process: ChildProcess
  output: string[]
  isRunning: boolean
  startTime: string
}

const managedProcesses: Map<string, ManagedProcess> = new Map()

// Debug log file path
function getDebugLogPath(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, 'api-debug.log')
}

// Write debug log
function writeDebugLog(label: string, data: unknown): void {
  const logPath = getDebugLogPath()
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] ${label}:\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n\n`
  try {
    fs.appendFileSync(logPath, logEntry, 'utf-8')
  } catch (e) {
    console.error('Failed to write debug log:', e)
  }
}

/**
 * Convert special tool call format to JSON code block format
 * This ensures AI responses are always in JSON format
 */
function convertSpecialFormatToJSON(text: string): string {
  // Pattern to match the special format section (Claude's <|...|> format)
  const specialSectionPattern = /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g
  // Pattern to match individual tool calls within a section
  const callPattern = /<\|tool_call_begin\|>functions\.([\w-]+)(?::\d+)?<\|tool_call_args\|>([\s\S]*?)<\|tool_call_end\|>/g

  let result = text

  // Find all special format sections and replace them
  result = result.replace(specialSectionPattern, (section) => {
    const toolCalls: string[] = []
    let match

    // Extract individual tool calls from the section
    // Need to reset regex lastIndex for each section
    callPattern.lastIndex = 0
    while ((match = callPattern.exec(section)) !== null) {
      const toolName = match[1]
      const argsJson = match[2].trim()
      try {
        const args = JSON.parse(argsJson)
        // Convert to JSON code block format
        toolCalls.push(`\`\`\`json\n{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}\n\`\`\``)
      } catch (e) {
        log.warn('[FormatConverter] Failed to parse args:', argsJson)
      }
    }

    // Return JSON code blocks or empty string if no valid tool calls
    return toolCalls.length > 0 ? toolCalls.join('\n\n') : ''
  })

  // Also handle standalone tool calls without section markers
  const standalonePattern = /<\|tool_call_begin\|>functions\.([\w-]+)(?::\d+)?<\|tool_call_args\|>([\s\S]*?)<\|tool_call_end\|>/g
  result = result.replace(standalonePattern, (match, toolName, argsJson) => {
    try {
      const args = JSON.parse(argsJson.trim())
      return `\`\`\`json\n{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}\n\`\`\``
    } catch (e) {
      log.warn('[FormatConverter] Failed to parse standalone args:', argsJson)
      return match // Keep original if parsing fails
    }
  })

  // Handle markdown code block with tool call: ```functions.tool_name{"arg": "value"}```
  // This is the most common format from Claude
  const markdownToolPattern = /```\s*functions\.([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})\s*```/g
  result = result.replace(markdownToolPattern, (match, toolName, argsJson) => {
    try {
      // Find the last closing brace to handle nested content
      let braceCount = 0
      let jsonEnd = 0
      for (let i = 0; i < argsJson.length; i++) {
        if (argsJson[i] === '{') braceCount++
        else if (argsJson[i] === '}') {
          braceCount--
          if (braceCount === 0) {
            jsonEnd = i + 1
            break
          }
        }
      }
      const validJson = argsJson.substring(0, jsonEnd)
      const args = JSON.parse(validJson.trim())
      return `\`\`\`json\n{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}\n\`\`\``
    } catch (e) {
      log.warn('[FormatConverter] Failed to parse markdown tool args:', argsJson)
      return match
    }
  })

  // Handle inline tool call format: ```functions.tool_name:index{"arg": "value"}```
  // This format appears when AI embeds tool calls directly in text with index
  const inlineToolPattern = /```functions\.([a-zA-Z0-9_-]+):(\d+)\s*(\{[\s\S]*?\})\s*```/g
  result = result.replace(inlineToolPattern, (match, toolName, index, argsJson) => {
    try {
      const args = JSON.parse(argsJson.trim())
      return `\`\`\`json\n{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}\n\`\`\``
    } catch (e) {
      log.warn('[FormatConverter] Failed to parse inline tool args:', argsJson)
      return match
    }
  })

  // Handle simplified inline format: functions.tool_name{"arg": "value"} (without code block)
  // Match functions. followed by tool name, optional index, then JSON object on same line
  const simpleInlinePattern = /functions\.([a-zA-Z0-9_-]+)(?::\d+)?\s*(\{[^\n]*?\})/g
  result = result.replace(simpleInlinePattern, (match, toolName, argsJson) => {
    try {
      // Validate it's a proper JSON object with balanced braces
      const openBraces = (argsJson.match(/\{/g) || []).length
      const closeBraces = (argsJson.match(/\}/g) || []).length
      if (openBraces !== closeBraces || openBraces === 0) {
        return match
      }
      const args = JSON.parse(argsJson.trim())
      return `\`\`\`json\n{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}\n\`\`\``
    } catch (e) {
      return match
    }
  })

  return result
}

function getSessionsDir(): string {
  const dir = path.join(app.getPath('userData'), 'sessions')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// Load sessions from disk
function loadSessions(): void {
  const dir = getSessionsDir()
  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        const sessionPath = path.join(dir, file)
        try {
          const data = fs.readFileSync(sessionPath, 'utf-8')
          const session = JSON.parse(data) as Session
          sessions.set(session.id, session)
        } catch (e) {
          log.error(`Failed to load session ${file}:`, e)
        }
      }
    }
    log.info(`Loaded ${sessions.size} sessions from disk`)
  } catch (e) {
    log.error('Failed to load sessions:', e)
  }
}

// Save session to disk
function saveSession(session: Session): void {
  const dir = getSessionsDir()
  const sessionPath = path.join(dir, `${session.id}.json`)
  try {
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  } catch (e) {
    log.error(`Failed to save session ${session.id}:`, e)
  }
}

// Delete session from disk
function deleteSessionFromDisk(sessionId: string): void {
  const dir = getSessionsDir()
  const sessionPath = path.join(dir, `${sessionId}.json`)
  try {
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  } catch (e) {
    log.error(`Failed to delete session ${sessionId}:`, e)
  }
}

export async function startApiServer(): Promise<void> {
  const expressApp: Express = express()
  // Increase JSON body size limit to 100MB for large file operations
  expressApp.use(express.json({ limit: '100mb' }))
  expressApp.use(express.urlencoded({ limit: '100mb', extended: true }))

  // CORS
  expressApp.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200)
    } else {
      next()
    }
  })

  // Initialize services (they will auto-load their data)
  const commandsService = getCommandsService()
  const portedTools = getTools()

  // Register all tools
  registerAllTools()

  log.info(`API Server initialized: ${commandsService.getCount()} commands, ${portedTools.length} ported tools, ${toolRegistry.count()} executors`)

  // Health check
  expressApp.get('/api/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      commands: commandsService.getCount(),
      tools: portedTools.length
    })
  })

  // ========== Git Endpoints ==========
  
  // Get current git branch
  expressApp.get('/api/git/branch', async (req: Request, res: Response) => {
    try {
      const repoPath = req.query.repoPath as string
      if (!repoPath) {
        return res.status(400).json({ error: 'repoPath parameter is required' })
      }

      const git = initGit(repoPath)
      if (!git) {
        return res.json({ branch: '', isRepo: false })
      }

      const status = await git.status()
      res.json({ 
        branch: status.current || '',
        isRepo: true
      })
    } catch (error) {
      log.error('Failed to get git branch:', error)
      res.json({ branch: '', error: String(error) })
    }
  })

  // ========== Commands Endpoints ==========
  
  // Get all commands
  expressApp.get('/api/commands', (_req: Request, res: Response) => {
    res.json({
      count: commandsService.getCount(),
      commands: commandsService.getAll()
    })
  })

  // Search commands
  expressApp.get('/api/commands/search', (req: Request, res: Response) => {
    const result = commandsService.search({
      query: req.query.q as string,
      limit: parseInt(req.query.limit as string) || 20
    })
    res.json(result)
  })

  // Get command by name
  expressApp.get('/api/commands/:name', (req: Request, res: Response) => {
    const command = commandsService.getByName(req.params.name)
    if (!command) {
      res.status(404).json({ error: 'Command not found' })
      return
    }
    res.json(command)
  })

  // ========== Tools Endpoints ==========

  // Get all tools
  expressApp.get('/api/tools', (_req: Request, res: Response) => {
    res.json({
      count: portedTools.length,
      tools: portedTools
    })
  })

  // Search tools
  expressApp.get('/api/tools/search', (req: Request, res: Response) => {
    const query = (req.query.q as string)?.toLowerCase() || ''
    const limit = parseInt(req.query.limit as string) || 20
    const results = query
      ? portedTools.filter(t => 
          t.name.toLowerCase().includes(query) || 
          t.sourceHint.toLowerCase().includes(query) ||
          t.responsibility.toLowerCase().includes(query)
        )
      : portedTools
    res.json({ count: results.length, tools: results.slice(0, limit) })
  })

  // Get tool by name
  expressApp.get('/api/tools/:name', (req: Request, res: Response) => {
    const tool = portedTools.find(t => t.name.toLowerCase() === req.params.name.toLowerCase())
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' })
      return
    }
    res.json(tool)
  })

  // ========== Route Endpoint ==========

  // Route prompt to find matching commands/tools
  expressApp.post('/api/route', (req: Request, res: Response) => {
    const { prompt } = req.body
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    const lowerPrompt = prompt.toLowerCase()
    const matches: Array<{ kind: string; name: string; score: number; source_hint: string }> = []

    // Check commands - split by dash and check each part
    const commands = commandsService.getAll()
    for (const cmd of commands) {
      const parts = cmd.name.toLowerCase().split('-')
      const score = parts.filter(part => lowerPrompt.includes(part)).length
      if (score > 0) {
        matches.push({ kind: 'command', name: cmd.name, score, source_hint: cmd.source_hint })
      }
    }

    // Check tools - split by camelCase and check each part
    for (const tool of portedTools) {
      const parts = tool.name.toLowerCase().split(/(?=[A-Z])/)
      const score = parts.filter((part: string) => lowerPrompt.includes(part.toLowerCase())).length
      if (score > 0) {
        matches.push({ kind: 'tool', name: tool.name, score, source_hint: tool.sourceHint })
      }
    }

    // Sort by score and return top 5
    matches.sort((a, b) => b.score - a.score)
    res.json({ matches: matches.slice(0, 5) })
  })

  // ========== Port Architecture Endpoints ==========

  // Get port manifest
  expressApp.get('/api/port/manifest', (_req: Request, res: Response) => {
    const manifest = buildPortManifest()
    res.json({ manifest: manifest.toMarkdown() })
  })

  // Get ported commands (new architecture)
  expressApp.get('/api/port/commands', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20
    const query = req.query.query as string | undefined
    const noPluginCommands = req.query.noPluginCommands === 'true'
    const noSkillCommands = req.query.noSkillCommands === 'true'

    if (query) {
      res.json({ commands: findCommands(query, limit) })
    } else {
      const commands = getCoreCommands(undefined, !noPluginCommands, !noSkillCommands)
      res.json({
        count: commands.length,
        commands: commands.slice(0, limit)
      })
    }
  })

  // Get ported tools (new architecture)
  expressApp.get('/api/port/tools', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20
    const query = req.query.query as string | undefined
    const simpleMode = req.query.simpleMode === 'true'
    const noMcp = req.query.noMcp === 'true'
    const denyTool = ((req.query.denyTool as string) || '').split(',').filter(Boolean)
    const denyPrefix = ((req.query.denyPrefix as string) || '').split(',').filter(Boolean)

    const permissionContext = ToolPermissionContextImpl.fromIterables(denyTool, denyPrefix)

    if (query) {
      res.json({ tools: findTools(query, limit) })
    } else {
      const tools = getCoreTools(simpleMode, !noMcp, permissionContext)
      res.json({
        count: tools.length,
        tools: tools.slice(0, limit)
      })
    }
  })

  // Route prompt using new architecture
  expressApp.post('/api/port/route', (req: Request, res: Response) => {
    const { prompt, limit = 5 } = req.body

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    const runtime = new PortRuntime()
    const matches = runtime.routePrompt(prompt, limit)

    res.json({
      matches: matches.map(m => ({
        kind: m.kind,
        name: m.name,
        source_hint: m.sourceHint,
        score: m.score
      }))
    })
  })

  // Bootstrap session using new architecture
  expressApp.post('/api/port/bootstrap', (req: Request, res: Response) => {
    const { prompt, limit = 5 } = req.body

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    const runtime = new PortRuntime()
    const session = runtime.bootstrapSession(prompt, limit)

    res.json({
      session: {
        prompt: session.prompt,
        context: session.context,
        setup: session.setup,
        routedMatches: session.routedMatches,
        turnResult: session.turnResult,
        persistedSessionPath: session.persistedSessionPath
      }
    })
  })

  // Run turn loop using new architecture
  expressApp.post('/api/port/turn-loop', (req: Request, res: Response) => {
    const { prompt, limit = 5, maxTurns = 3, structuredOutput = false } = req.body

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    const runtime = new PortRuntime()
    const results = runtime.runTurnLoop(prompt, limit, maxTurns, structuredOutput)

    res.json({ results })
  })

  // Stream bootstrap session
  expressApp.post('/api/port/bootstrap/stream', (req: Request, res: Response) => {
    const { prompt, limit = 5 } = req.body

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const runtime = new PortRuntime()
    const matches = runtime.routePrompt(prompt, limit)
    const engine = QueryEnginePort.fromWorkspace()

    const denials = matches
      .filter(m => m.kind === 'tool' && m.name.toLowerCase().includes('bash'))
      .map(m => ({ toolName: m.name, reason: 'Destructive shell execution remains gated' }))

    const generator = engine.streamSubmitMessage(
      prompt,
      matches.filter(m => m.kind === 'command').map(m => m.name),
      matches.filter(m => m.kind === 'tool').map(m => m.name),
      denials
    )

    for (const event of generator) {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  })

  // Execute ported command
  expressApp.post('/api/port/exec-command', (req: Request, res: Response) => {
    const { name, prompt = '' } = req.body

    if (!name) {
      res.status(400).json({ error: 'Command name is required' })
      return
    }

    const result = executeMirroredCommand(name, prompt)
    res.json({ result })
  })

  // Execute ported tool
  expressApp.post('/api/port/exec-tool', (req: Request, res: Response) => {
    const { name, payload = '' } = req.body

    if (!name) {
      res.status(400).json({ error: 'Tool name is required' })
      return
    }

    // Note: Mirrored tool execution deprecated, use /api/tools/execute-direct
    const result = { handled: false, message: 'Mirrored tool execution deprecated', name, source_hint: '', payload }
    res.json({ result })
  })

  // Port session management
  expressApp.get('/api/port/sessions', (_req: Request, res: Response) => {
    const sessions = listPortSessions()
    res.json({ sessions })
  })

  // POST /api/port/sessions - Create a new session
  expressApp.post('/api/port/sessions', (_req: Request, res: Response) => {
    const sessionId = uuidv4()
    const session = createStoredSession(sessionId)
    savePortSession(session)
    log.info(`[API] Created new port session: ${sessionId}`)
    res.json({ session })
  })

  expressApp.get('/api/port/sessions/:id', (req: Request, res: Response) => {
    const session = loadPortSession(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json({ session })
  })

  expressApp.delete('/api/port/sessions/:id', (req: Request, res: Response) => {
    const success = deletePortSession(req.params.id)
    if (!success) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json({ success: true })
  })

  // ========== Project Context Endpoint ==========

  // Get project context for AI
  expressApp.get('/api/project-context', async (req: Request, res: Response) => {
    const projectPath = req.query.path as string

    if (!projectPath) {
      res.status(400).json({ error: 'path query parameter is required' })
      return
    }

    try {
      // Check if we need to refresh the context
      if (shouldRefreshContext(projectPath)) {
        log.info(`[API] Scanning project context for: ${projectPath}`)
        await scanProject(projectPath)
      }

      const context = getProjectContext()
      if (!context) {
        res.status(404).json({ error: 'Failed to scan project' })
        return
      }

      // Get formatted context for AI
      const aiContext = getProjectStructureForAI(true, 4)

      res.json({
        context: aiContext,
        stats: context.stats,
        scannedAt: context.scannedAt
      })
    } catch (error) {
      log.error('[API] Failed to get project context:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Refresh project context
  expressApp.post('/api/project-context/refresh', async (req: Request, res: Response) => {
    const { path: projectPath } = req.body

    if (!projectPath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      log.info(`[API] Refreshing project context for: ${projectPath}`)
      const context = await refreshProjectContext(projectPath)
      const aiContext = getProjectStructureForAI(true, 4)

      res.json({
        context: aiContext,
        stats: context.stats,
        scannedAt: context.scannedAt
      })
    } catch (error) {
      log.error('[API] Failed to refresh project context:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Clear project context
  expressApp.post('/api/project-context/clear', (_req: Request, res: Response) => {
    clearProjectContext()
    res.json({ success: true })
  })

  // ========== Subsystems Endpoint ==========

  expressApp.get('/api/subsystems', (_req: Request, res: Response) => {
    res.json([
      { name: 'commands', file_count: commandsService.getCount(), notes: 'Command surface' },
      { name: 'tools', file_count: portedTools.length, notes: 'Tool surface' },
      { name: 'runtime', file_count: 1, notes: 'Runtime orchestration' },
      { name: 'query_engine', file_count: 1, notes: 'Query engine' },
      { name: 'session_store', file_count: 1, notes: 'Session storage' },
      { name: 'permissions', file_count: 1, notes: 'Permission management' },
      { name: 'ported_commands', file_count: PORTED_COMMANDS.length, notes: 'Ported command surface' },
      { name: 'ported_tools', file_count: PORTED_TOOLS.length, notes: 'Ported tool surface' }
    ])
  })

  // ========== Chat Endpoint (using service) ==========

  expressApp.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { apiKey, model, messages, tools, stream = false, apiUrl } = req.body
      log.info('[API] /api/chat called with', messages?.length, 'messages', 'apiUrl:', apiUrl || 'default')

      if (!apiKey) {
        res.status(400).json({ error: 'API key is required' })
        return
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const asyncIter = streamChatMessage({ apiKey, model, messages, tools, stream, apiUrl })
        for await (const chunk of asyncIter) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        res.write('data: [DONE]\n\n')
        res.end()
      } else {
        const response = await sendChatMessage({ apiKey, model, messages, tools, stream, apiUrl })

        // Debug: log original response
        writeDebugLog('ORIGINAL_RESPONSE', response.content)

        // Convert special format to JSON format in the response content
        let convertedContent = response.content
        if (typeof convertedContent === 'string') {
          convertedContent = convertSpecialFormatToJSON(convertedContent)
        } else if (Array.isArray(convertedContent)) {
          convertedContent = convertedContent.map(item => {
            if (typeof item === 'object' && item !== null && 'text' in item) {
              return { ...item, text: convertSpecialFormatToJSON(item.text as string) }
            }
            return item
          })
        }

        // Debug: log converted response
        writeDebugLog('CONVERTED_RESPONSE', convertedContent)

        const result: Record<string, unknown> = {
          id: response.id,
          type: response.type,
          role: response.role,
          content: convertedContent,
          model: response.model,
          stop_reason: response.stop_reason,
          usage: response.usage
        }
        // Include tool_calls if present
        if (response.tool_calls && response.tool_calls.length > 0) {
          result.tool_calls = response.tool_calls
        }
        res.json(result)
      }
    } catch (error) {
      log.error('Chat error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== Tool Calling Endpoints ==========

  // Get available tools for LLM
  expressApp.get('/api/tools/definitions', (_req: Request, res: Response) => {
    res.json({ tools: CODE_TOOLS })
  })

  // Execute tool calls from LLM (OpenAI format)
  expressApp.post('/api/tools/execute', async (req: Request, res: Response) => {
    const { tool_calls, cwd } = req.body as { tool_calls: ToolCall[]; cwd?: string }

    if (!tool_calls || !Array.isArray(tool_calls)) {
      res.status(400).json({ error: 'tool_calls array is required' })
      return
    }

    try {
      const workingDir = cwd || getCurrentWorkingDirectory()

      const results = await executeToolCalls(tool_calls, {
        cwd: workingDir
      })

      res.json({ results })
    } catch (error) {
      log.error('Tool execution error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Execute tool directly (simplified format for text-based tool calling)
  expressApp.post('/api/tools/execute-direct', async (req: Request, res: Response) => {
    const { tool, arguments: args, cwd, callId } = req.body as { tool: string; arguments: Record<string, unknown>; cwd?: string; callId?: string }

    if (!tool) {
      res.status(400).json({ error: 'tool name is required' })
      return
    }

    try {
      const workingDir = cwd || getCurrentWorkingDirectory()

      // Set working directory if provided
      if (cwd) {
        setCurrentWorkingDirectory(cwd)
      }

      log.info(`[API] ========== Tool Execution Request ==========`)
      log.info(`[API] Tool name: ${tool}`)
      log.info(`[API] Call ID: ${callId || 'auto-generated'}`)
      log.info(`[API] Arguments:`, JSON.stringify(args, null, 2))
      log.info(`[API] Working directory: ${workingDir}`)
      writeDebugLog(`TOOL_EXECUTE_${tool}`, { args, cwd: workingDir, callId })

      // Use new tool executor for execution with event notifications
      const result = await executeToolNew(callId || `call_${Date.now()}`, tool, args || {}, workingDir)

      log.info(`[API] ========== Tool Execution Result ==========`)
      log.info(`[API] Tool: ${tool}`)
      log.info(`[API] Success: ${result.success}`)
      log.info(`[API] Output length: ${result.output?.length || 0}`)
      if (result.metadata) {
        log.info(`[API] Metadata:`, JSON.stringify(result.metadata, null, 2))
      }
      if (!result.success && result.error) {
        log.error(`[API] Error:`, result.error)
      }
      writeDebugLog(`TOOL_RESULT_${tool}`, { result })

      res.json({ result })
    } catch (error) {
      log.error('Tool execution error:', error)
      writeDebugLog(`TOOL_ERROR_${tool}`, { error: String(error), stack: error instanceof Error ? error.stack : undefined })
      res.status(500).json({ error: String(error) })
    }
  })

  // Parse and execute tool calls from text (for text-based tool calling)
  expressApp.post('/api/tools/parse-and-execute', async (req: Request, res: Response) => {
    const { text, cwd } = req.body as { text: string; cwd?: string }

    if (!text) {
      res.status(400).json({ error: 'text is required' })
      return
    }

    try {
      const workingDir = cwd || getCurrentWorkingDirectory()

      // Parse tool calls from text
      const toolCalls = parseToolCallsFromText(text)

      if (toolCalls.length === 0) {
        res.json({ toolCalls: [], results: [] })
        return
      }

      // Execute parsed tool calls
      const toolCallArray: ToolCall[] = toolCalls.map((call: { tool: string; arguments: Record<string, unknown> }, index: number) => ({
        id: `call_${index + 1}_${Date.now()}`,
        type: 'function',
        function: {
          name: call.tool,
          arguments: call.arguments
        }
      }))

      const results = await executeToolCalls(toolCallArray, {
        cwd: workingDir
      })

      res.json({ toolCalls, results })
    } catch (error) {
      log.error('Parse and execute error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== Session Endpoints ==========

  expressApp.post('/api/sessions', (req: Request, res: Response) => {
    const id = uuidv4()
    const { projectPath } = req.body || {}
    const session: Session = {
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      projectPath: projectPath || undefined
    }
    sessions.set(id, session)
    saveSession(session)
    const { id: _sessionId, ...sessionWithoutId } = session
    res.json({ id, ...sessionWithoutId })
  })

  // Get session by project path - returns the most recent session for a project
  expressApp.get('/api/sessions/by-project', (req: Request, res: Response) => {
    const projectPath = req.query.path as string
    if (!projectPath) {
      res.status(400).json({ error: 'project path is required' })
      return
    }

    // Find sessions for this project, sorted by createdAt (newest first)
    const projectSessions = Array.from(sessions.values())
      .filter(s => s.projectPath === projectPath)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    if (projectSessions.length > 0) {
      res.json({ found: true, session: projectSessions[0] }) // Return the most recent session
    } else {
      // Return 200 with found: false instead of 404 to avoid browser console errors
      // This is a normal case - project just doesn't have a session yet
      res.json({ found: false, message: 'No session found for this project' })
    }
  })

  // Update session's project path
  expressApp.patch('/api/sessions/:id/project-path', (req: Request, res: Response) => {
    const session = sessions.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { projectPath } = req.body
    session.projectPath = projectPath || undefined
    saveSession(session)
    res.json(session)
  })

  expressApp.delete('/api/sessions/:id', (req: Request, res: Response) => {
    const session = sessions.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    sessions.delete(req.params.id)
    deleteSessionFromDisk(req.params.id)
    res.json({ success: true })
  })

  expressApp.get('/api/sessions/:id', (req: Request, res: Response) => {
    const session = sessions.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json(session)
  })

  expressApp.get('/api/sessions', (_req: Request, res: Response) => {
    const sessionList = Array.from(sessions.values()).map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      messageCount: s.messages.length,
      projectPath: s.projectPath
    }))
    res.json(sessionList)
  })

  expressApp.post('/api/sessions/:id/messages', (req: Request, res: Response) => {
    const session = sessions.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const { role, content } = req.body
    session.messages.push({ role, content })
    res.json(session)
  })

  // ========== Command Execution Endpoints ==========

  expressApp.post('/api/commands/execute', async (req: Request, res: Response) => {
    const { command, prompt } = req.body

    try {
      const commandsService = getCommandsService()
      const cmd = commandsService.getByName(command)

      if (!cmd) {
        res.status(404).json({ error: `Command not found: ${command}` })
        return
      }

      // Execute the actual command
      const execResult = await executeCommand(command, prompt || '')

      const result = {
        command: cmd.name,
        source_hint: cmd.source_hint,
        responsibility: cmd.responsibility,
        prompt: prompt || '',
        handled: true,
        success: execResult.success,
        output: execResult.output,
        error: execResult.error,
        cwd: getCurrentWorkingDirectory()
      }

      res.json({ result })
    } catch (error) {
      log.error('Command execution error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Get/Set current working directory
  expressApp.get('/api/cwd', (_req: Request, res: Response) => {
    res.json({ cwd: getCurrentWorkingDirectory() })
  })

  expressApp.post('/api/cwd', (req: Request, res: Response) => {
    const { cwd } = req.body
    if (cwd) {
      setCurrentWorkingDirectory(cwd)
      res.json({ cwd: getCurrentWorkingDirectory() })
    } else {
      res.status(400).json({ error: 'cwd is required' })
    }
  })

  // ========== File System Endpoints ==========

  // List directory contents with VSCode-style optimizations
  expressApp.get('/api/fs/list', (req: Request, res: Response) => {
    const dirPath = req.query.path as string
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      // Support optional parameters for VSCode-style features
      const includeHidden = req.query.includeHidden === 'true'
      const items = listDirectory(dirPath, { includeHidden })
      res.json({ items })
    } catch (error) {
      log.error('Failed to list directory:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Read file
  expressApp.get('/api/fs/read', (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      // 将相对路径解析为绝对路径
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(getCurrentWorkingDirectory() || process.cwd(), filePath)
      const content = readFile(resolvedPath)
      res.json({ content })
    } catch (error) {
      log.error('Failed to read file:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Write file
  expressApp.post('/api/fs/write', (req: Request, res: Response) => {
    const { path: filePath, content } = req.body
    if (!filePath || content === undefined) {
      res.status(400).json({ error: 'path and content are required' })
      return
    }

    try {
      writeFile(filePath, content)
      res.json({ success: true })
    } catch (error) {
      log.error('Failed to write file:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Delete file or directory
  expressApp.post('/api/fs/delete', (req: Request, res: Response) => {
    const { path: filePath } = req.body
    if (!filePath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      const targetPath = path.resolve(filePath)
      
      if (!fs.existsSync(targetPath)) {
        res.status(404).json({ error: 'Path does not exist' })
        return
      }

      const stats = fs.statSync(targetPath)
      if (stats.isDirectory()) {
        fs.rmdirSync(targetPath, { recursive: true })
        res.json({ success: true, type: 'directory', path: targetPath })
      } else {
        fs.unlinkSync(targetPath)
        res.json({ success: true, type: 'file', path: targetPath })
      }
    } catch (error) {
      log.error('Failed to delete:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Create directory
  expressApp.post('/api/fs/mkdir', (req: Request, res: Response) => {
    const { path: dirPath } = req.body
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      const targetPath = path.resolve(dirPath)
      fs.mkdirSync(targetPath, { recursive: true })
      res.json({ success: true, path: targetPath })
    } catch (error) {
      log.error('Failed to create directory:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Rename file or directory
  expressApp.post('/api/fs/rename', (req: Request, res: Response) => {
    const { oldPath, newPath } = req.body
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'oldPath and newPath are required' })
      return
    }

    try {
      const resolvedOldPath = path.resolve(oldPath)
      const resolvedNewPath = path.resolve(newPath)
      
      if (!fs.existsSync(resolvedOldPath)) {
        res.status(404).json({ error: 'Source path does not exist' })
        return
      }

      fs.renameSync(resolvedOldPath, resolvedNewPath)
      res.json({ success: true, oldPath: resolvedOldPath, newPath: resolvedNewPath })
    } catch (error) {
      log.error('Failed to rename:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== Process Management Endpoints ==========

  // Get all managed processes
  expressApp.get('/api/processes', (_req: Request, res: Response) => {
    const processes = Array.from(managedProcesses.values()).map(p => ({
      id: p.id,
      command: p.command,
      output: p.output,
      isRunning: p.isRunning,
      startTime: p.startTime
    }))
    res.json({ processes })
  })

  // Start a new process
  expressApp.post('/api/processes/start', (req: Request, res: Response) => {
    const { command } = req.body as { command: string }

    if (!command) {
      res.status(400).json({ error: 'Command is required' })
      return
    }

    try {
      const processId = uuidv4()
      const cwd = getCurrentWorkingDirectory()

      log.info(`Starting managed process: ${command} in ${cwd}`)

      // Parse command and arguments
      const parts = command.split(' ')
      const cmd = parts[0]
      const args = parts.slice(1)

      // Spawn the process
      const childProcess = spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' }
      })

      const managedProcess: ManagedProcess = {
        id: processId,
        command,
        process: childProcess,
        output: [`$ ${command}`, `Working directory: ${cwd}`, '---'],
        isRunning: true,
        startTime: new Date().toISOString()
      }

      managedProcesses.set(processId, managedProcess)

      // Handle stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.length > 0)
        managedProcess.output.push(...lines)
        // Keep only last 1000 lines to prevent memory issues
        if (managedProcess.output.length > 1000) {
          managedProcess.output = managedProcess.output.slice(-1000)
        }
      })

      // Handle stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.length > 0)
        managedProcess.output.push(...lines.map(l => `[stderr] ${l}`))
        if (managedProcess.output.length > 1000) {
          managedProcess.output = managedProcess.output.slice(-1000)
        }
      })

      // Handle process exit
      childProcess.on('close', (code: number | null) => {
        managedProcess.isRunning = false
        managedProcess.output.push(`---`)
        managedProcess.output.push(`Process exited with code ${code}`)
        log.info(`Managed process ${processId} exited with code ${code}`)
      })

      childProcess.on('error', (error: Error) => {
        managedProcess.isRunning = false
        managedProcess.output.push(`[Error] ${error.message}`)
        log.error(`Managed process ${processId} error:`, error)
      })

      res.json({ processId, message: 'Process started' })
    } catch (error) {
      log.error('Failed to start process:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Stop a process
  expressApp.post('/api/processes/:id/stop', (req: Request, res: Response) => {
    const { id } = req.params
    const managedProcess = managedProcesses.get(id)

    if (!managedProcess) {
      res.status(404).json({ error: 'Process not found' })
      return
    }

    try {
      if (managedProcess.isRunning) {
        // Kill the process tree
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', managedProcess.process.pid?.toString() || '', '/f', '/t'])
        } else {
          managedProcess.process.kill('SIGTERM')
          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (!managedProcess.process.killed) {
              managedProcess.process.kill('SIGKILL')
            }
          }, 5000)
        }
        managedProcess.isRunning = false
        managedProcess.output.push('---')
        managedProcess.output.push('Process stopped by user')
      }

      res.json({ message: 'Process stopped' })
    } catch (error) {
      log.error('Failed to stop process:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Clean up stopped processes
  expressApp.delete('/api/processes/:id', (req: Request, res: Response) => {
    const { id } = req.params
    const managedProcess = managedProcesses.get(id)

    if (!managedProcess) {
      res.status(404).json({ error: 'Process not found' })
      return
    }

    if (managedProcess.isRunning) {
      res.status(400).json({ error: 'Cannot delete running process' })
      return
    }

    managedProcesses.delete(id)
    res.json({ message: 'Process deleted' })
  })

  // ============================================
  // VS Code Copilot Integration Routes
  // ============================================

  // Code completion endpoint
  expressApp.post('/api/copilot/completions', async (req: Request, res: Response) => {
    try {
      const { prefix, suffix, language, filePath, apiKey, model, apiUrl } = req.body

      if (!apiKey || !model) {
        res.status(400).json({ error: 'Missing API key or model' })
        return
      }

      const completions = await getCodeCompletions({
        prefix,
        suffix,
        language,
        filePath,
        cursorPosition: { line: 0, character: prefix.length },
        apiKey,
        model,
        apiUrl
      })

      res.json(completions)
    } catch (error) {
      log.error('Code completion error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Code explanation endpoint
  expressApp.post('/api/copilot/explain', async (req: Request, res: Response) => {
    try {
      const { code, language, filePath, selectionRange, apiKey, model, apiUrl } = req.body

      if (!apiKey || !model) {
        res.status(400).json({ error: 'Missing API key or model' })
        return
      }

      const explanation = await explainCode({
        code,
        language,
        filePath,
        selectionRange,
        apiKey,
        model,
        apiUrl
      })

      res.json(explanation)
    } catch (error) {
      log.error('Code explanation error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Code refactoring endpoint
  expressApp.post('/api/copilot/refactor', async (req: Request, res: Response) => {
    try {
      const { code, language, filePath, refactoringType, apiKey, model, apiUrl } = req.body

      if (!apiKey || !model) {
        res.status(400).json({ error: 'Missing API key or model' })
        return
      }

      const refactoring = await refactorCode({
        code,
        language,
        filePath,
        refactoringType: refactoringType || 'improve',
        apiKey,
        model,
        apiUrl
      })

      res.json(refactoring)
    } catch (error) {
      log.error('Code refactoring error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Inline edit endpoint
  expressApp.post('/api/copilot/inline-edit', async (req: Request, res: Response) => {
    try {
      const { code, instruction, language, filePath, selectionRange, apiKey, model, apiUrl } = req.body

      if (!apiKey || !model) {
        res.status(400).json({ error: 'Missing API key or model' })
        return
      }

      const inlineEdit = await getInlineEdit({
        code,
        instruction,
        language,
        filePath,
        selectionRange,
        apiKey,
        model,
        apiUrl
      })

      res.json(inlineEdit)
    } catch (error) {
      log.error('Inline edit error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Code analysis endpoint
  expressApp.post('/api/copilot/analyze', async (req: Request, res: Response) => {
    try {
      const { code, language, filePath } = req.body

      const lang = language || detectLanguage(filePath || '')
      const analysis = analyzeSemantics(code, lang)

      res.json(analysis)
    } catch (error) {
      log.error('Code analysis error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Code context endpoint
  expressApp.post('/api/copilot/context', async (req: Request, res: Response) => {
    try {
      const { code, filePath, cursorPosition } = req.body

      const context = buildCodeContext(filePath || '', code, cursorPosition)

      res.json(context)
    } catch (error) {
      log.error('Code context error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ============================================
  // Search API Routes
  // ============================================

  // Execute file content search using ripgrep
  expressApp.get('/api/search', async (req: Request, res: Response) => {
    try {
      const { path, query, include, exclude, isRegex, isCaseSensitive, isWholeWords, maxResults, useIgnoreFiles } = req.query

      if (!path || !query) {
        res.status(400).json({ 
          success: false, 
          error: 'path and query parameters are required' 
        })
        return
      }

      const result = await searchFiles({
        query: String(query),
        path: String(path),
        includePattern: include ? String(include) : undefined,
        excludePattern: exclude ? String(exclude) : undefined,
        isRegex: isRegex === 'true',
        isCaseSensitive: isCaseSensitive === 'true',
        isWholeWords: isWholeWords === 'true',
        maxResults: maxResults ? Number(maxResults) : 10000,
        useIgnoreFiles: useIgnoreFiles !== 'false'
      })

      res.json({
        success: true,
        data: result
      })
    } catch (error) {
      log.error('Search error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  // POST version for complex search queries
  expressApp.post('/api/search', async (req: Request, res: Response) => {
    try {
      const { query, path, includePattern, excludePattern, isRegex, isCaseSensitive, isWholeWords, maxResults, useIgnoreFiles } = req.body

      if (!path || !query) {
        res.status(400).json({ 
          success: false, 
          error: 'path and query are required' 
        })
        return
      }

      const result = await searchFiles({
        query,
        path,
        includePattern,
        excludePattern,
        isRegex,
        isCaseSensitive,
        isWholeWords,
        maxResults: maxResults || 10000,
        useIgnoreFiles: useIgnoreFiles !== false
      })

      res.json({
        success: true,
        data: result
      })
    } catch (error) {
      log.error('Search error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  // Legacy code completion endpoint (for backward compatibility)
  expressApp.post('/api/completion', async (req: Request, res: Response) => {
    try {
      const { apiKey, model, prefix, suffix, apiUrl } = req.body

      if (!apiKey || !model) {
        res.status(400).json({ error: 'Missing API key or model' })
        return
      }

      const completion = await requestCodeCompletion(apiKey, model, prefix, suffix, apiUrl)

      res.json({
        completion,
        model
      })
    } catch (error) {
      log.error('Completion error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // Start server
  const PORT = 3847
  return new Promise((resolve, reject) => {
    server = expressApp.listen(PORT, () => {
      log.info(`API server running on port ${PORT}`)
      resolve()
    })

    server.on('error', (err) => {
      log.error('Server error:', err)
      reject(err)
    })
  })
}

export function stopApiServer(): void {
  if (server) {
    // Kill all managed processes
    for (const [id, managedProcess] of managedProcesses) {
      if (managedProcess.isRunning) {
        try {
          managedProcess.process.kill('SIGTERM')
        } catch (error) {
          log.error(`Failed to kill process ${id}:`, error)
        }
      }
    }
    managedProcesses.clear()

    server.close()
    server = null
    log.info('API server stopped')
  }
}