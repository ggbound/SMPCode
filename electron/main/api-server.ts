import express, { Express, Request, Response } from 'express'
import { Server } from 'http'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { app } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'

// Import services
import { sendChatMessage, streamChatMessage } from './services/llm-service'
import { getCommandsService } from './services/commands-service'
import { getToolsService } from './services/tools-service'
import { executeCommand, setCurrentWorkingDirectory, getCurrentWorkingDirectory } from './services/command-executor'
import { listDirectory, readFile, writeFile } from './services/files-service'
import { CODE_TOOLS, ToolCall, ToolResult } from './services/tools-definitions'
import { executeTool } from './services/tools-executor'

let server: Server | null = null

// Session storage
interface Session {
  id: string
  messages: Array<{ role: string; content: string }>
  createdAt: string
  inputTokens: number
  outputTokens: number
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

function getSessionsDir(): string {
  const dir = join(app.getPath('userData'), 'sessions')
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
        const sessionPath = join(dir, file)
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
  const sessionPath = join(dir, `${session.id}.json`)
  try {
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  } catch (e) {
    log.error(`Failed to save session ${session.id}:`, e)
  }
}

// Delete session from disk
function deleteSessionFromDisk(sessionId: string): void {
  const dir = getSessionsDir()
  const sessionPath = join(dir, `${sessionId}.json`)
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
  expressApp.use(express.json())

  // CORS
  expressApp.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  // Initialize services (they will auto-load their data)
  const commandsService = getCommandsService()
  const toolsService = getToolsService()
  log.info(`API Server initialized: ${commandsService.getCount()} commands, ${toolsService.getCount()} tools`)

  // Health check
  expressApp.get('/api/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      commands: commandsService.getCount(),
      tools: toolsService.getCount()
    })
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
      count: toolsService.getCount(),
      tools: toolsService.getAll()
    })
  })

  // Search tools
  expressApp.get('/api/tools/search', (req: Request, res: Response) => {
    const result = toolsService.search({
      query: req.query.q as string,
      limit: parseInt(req.query.limit as string) || 20
    })
    res.json(result)
  })

  // Get tool by name
  expressApp.get('/api/tools/:name', (req: Request, res: Response) => {
    const tool = toolsService.getByName(req.params.name)
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
    const tools = toolsService.getAll()
    for (const tool of tools) {
      const parts = tool.name.toLowerCase().split(/(?=[A-Z])/)
      const score = parts.filter(part => lowerPrompt.includes(part.toLowerCase())).length
      if (score > 0) {
        matches.push({ kind: 'tool', name: tool.name, score, source_hint: tool.source_hint })
      }
    }

    // Sort by score and return top 5
    matches.sort((a, b) => b.score - a.score)
    res.json({ matches: matches.slice(0, 5) })
  })

  // ========== Subsystems Endpoint ==========

  expressApp.get('/api/subsystems', (_req: Request, res: Response) => {
    res.json([
      { name: 'commands', file_count: commandsService.getCount(), notes: 'Command surface' },
      { name: 'tools', file_count: toolsService.getCount(), notes: 'Tool surface' },
      { name: 'runtime', file_count: 1, notes: 'Runtime orchestration' },
      { name: 'query_engine', file_count: 1, notes: 'Query engine' },
      { name: 'session_store', file_count: 1, notes: 'Session storage' },
      { name: 'permissions', file_count: 1, notes: 'Permission management' }
    ])
  })

  // ========== Chat Endpoint (using service) ==========

  expressApp.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { apiKey, model, messages, tools, stream = false } = req.body

      if (!apiKey) {
        res.status(400).json({ error: 'API key is required' })
        return
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const asyncIter = streamChatMessage({ apiKey, model, messages, tools, stream })
        for await (const chunk of asyncIter) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        res.write('data: [DONE]\n\n')
        res.end()
      } else {
        const response = await sendChatMessage({ apiKey, model, messages, tools, stream })
        const result: Record<string, unknown> = {
          id: response.id,
          type: response.type,
          role: response.role,
          content: response.content,
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
    const { tool_calls } = req.body as { tool_calls: ToolCall[] }

    if (!tool_calls || !Array.isArray(tool_calls)) {
      res.status(400).json({ error: 'tool_calls array is required' })
      return
    }

    const results: ToolResult[] = []

    for (const toolCall of tool_calls) {
      try {
        const args = JSON.parse(toolCall.function.arguments)
        const result = await executeTool(toolCall.function.name, args)

        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.function.name,
          content: result.success
            ? result.output
            : `Error: ${result.error || 'Unknown error'}`
        })
      } catch (error) {
        results.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.function.name,
          content: `Error executing tool: ${String(error)}`
        })
      }
    }

    res.json({ results })
  })

  // Execute tool directly (simplified format for text-based tool calling)
  expressApp.post('/api/tools/execute-direct', async (req: Request, res: Response) => {
    const { tool, arguments: args, cwd } = req.body as { tool: string; arguments: Record<string, unknown>; cwd?: string }

    if (!tool) {
      res.status(400).json({ error: 'tool name is required' })
      return
    }

    try {
      // Set working directory if provided
      if (cwd) {
        setCurrentWorkingDirectory(cwd)
      }

      log.info(`Executing tool ${tool} with args:`, args, 'in cwd:', cwd || getCurrentWorkingDirectory())

      const result = await executeTool(tool, args || {})
      res.json({ result })
    } catch (error) {
      log.error('Tool execution error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  // ========== Session Endpoints ==========

  expressApp.post('/api/sessions', (req: Request, res: Response) => {
    const id = uuidv4()
    const session: Session = {
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      inputTokens: 0,
      outputTokens: 0
    }
    sessions.set(id, session)
    saveSession(session)
    const { id: _sessionId, ...sessionWithoutId } = session
    res.json({ id, ...sessionWithoutId })
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
      messageCount: s.messages.length
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

  // List directory contents
  expressApp.get('/api/fs/list', (req: Request, res: Response) => {
    const dirPath = req.query.path as string
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' })
      return
    }

    try {
      const items = listDirectory(dirPath)
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
      const content = readFile(filePath)
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

  // ========== Tool Execution Endpoints ==========

  expressApp.post('/api/tools/execute', async (req: Request, res: Response) => {
    const { tool, parameters } = req.body

    try {
      let result: unknown

      switch (tool) {
        case 'BashTool': {
          const { command } = parameters
          const { exec } = await import('child_process')
          const util = await import('util')
          const execPromise = util.promisify(exec)

          try {
            const { stdout, stderr } = await execPromise(command, { timeout: 60000 })
            result = { output: stdout || stderr, error: stderr ? true : false }
          } catch (error) {
            result = { output: String(error), error: true }
          }
          break
        }

        case 'FileReadTool': {
          const { file_path } = parameters
          const content = fs.readFileSync(file_path, 'utf-8')
          result = { content }
          break
        }

        case 'FileEditTool': {
          const { file_path, old_string, new_string } = parameters
          let content = fs.readFileSync(file_path, 'utf-8')
          content = content.replace(old_string, new_string)
          fs.writeFileSync(file_path, content, 'utf-8')
          result = { success: true }
          break
        }

        case 'FileWriteTool': {
          const { file_path, content } = parameters
          fs.writeFileSync(file_path, content, 'utf-8')
          result = { success: true }
          break
        }

        default:
          result = { error: `Unknown tool: ${tool}` }
      }

      res.json({ result })
    } catch (error) {
      log.error('Tool execution error:', error)
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