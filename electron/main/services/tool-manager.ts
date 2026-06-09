/**
 * 统一的工具管理器
 * 整合工具注册和执行，提供单一的工具管理入口
 */

import log from 'electron-log'
import type { ToolExecutionResult } from '../../../src/shared/types/tool-call'
import {
  executeReadFile,
  executeWriteFile,
  executeEditFile,
  executeBash,
  executeListDirectory,
  executeSearchFiles,
  executeDeleteFile,
  executeCheckPort,
  executeKillProcess,
  executeFindProcess,
  executeListReminders
} from './tool-implementations'
import { mcpManager } from './mcp-manager'

// 统一的工具处理器类型
interface ToolHandler {
  (args: Record<string, unknown>, cwd: string): Promise<ToolExecutionResult>
}

// 单例工具管理器
class ToolManager {
  private static instance: ToolManager
  private tools: Map<string, ToolHandler> = new Map()
  private isInitialized = false

  private constructor() {}

  static getInstance(): ToolManager {
    if (!ToolManager.instance) {
      ToolManager.instance = new ToolManager()
    }
    return ToolManager.instance
  }

  // 注册工具
  register(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler)
    log.info(`[ToolManager] Registered tool: ${name}`)
  }

  // 获取工具
  get(name: string): ToolHandler | undefined {
    return this.tools.get(name)
  }

  // 检查工具是否存在
  has(name: string): boolean {
    return this.tools.has(name)
  }

  // 获取所有工具名称
  getAllNames(): string[] {
    return Array.from(this.tools.keys())
  }

  // 初始化工具
  initialize(): void {
    if (this.isInitialized) {
      log.warn('[ToolManager] Already initialized')
      return
    }

    log.info('[ToolManager] Registering tools...')

    this.register('read_file', executeReadFile)
    this.register('write_file', executeWriteFile)
    this.register('edit_file', executeEditFile)
    this.register('append_file', executeWriteFile)
    this.register('execute_bash', executeBash)
    this.register('list_directory', executeListDirectory)
    this.register('search_files', executeSearchFiles)
    this.register('delete_file', executeDeleteFile)
    this.register('check_port', executeCheckPort)
    this.register('kill_process', executeKillProcess)
    this.register('find_process', executeFindProcess)
    this.register('list_reminders', executeListReminders)

    this.isInitialized = true
    log.info(`[ToolManager] Initialized with ${this.tools.size} tools`)
    log.info(`[ToolManager] Available tools: ${this.getAllNames().join(', ')}`)
  }

  // 执行工具
  async execute(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    cwd: string
  ): Promise<ToolExecutionResult> {
    if (!this.isInitialized) {
      this.initialize()
    }

    // 先检查是否是 MCP 工具（格式：mcp:{serverId}:{toolName}）
    if (toolName.startsWith('mcp:')) {
      return this.executeMcpTool(callId, toolName, args)
    }

    const handler = this.tools.get(toolName)
    if (!handler) {
      const error = `Unknown tool: ${toolName}. Available tools: ${this.getAllNames().join(', ')}`
      log.error(`[ToolManager] ${error}`)
      return { success: false, output: '', error }
    }

    log.info(`[ToolManager] Executing tool: ${toolName} (id: ${callId})`)
    log.info(`[ToolManager] Arguments:`, JSON.stringify(args, null, 2))
    log.info(`[ToolManager] Working directory: ${cwd}`)
    
    try {
      const result = await handler(args, cwd)
      log.info(`[ToolManager] Tool ${toolName} completed: ${result.success ? 'success' : 'failed'}`)
      if (result.metadata) {
        log.info(`[ToolManager] Metadata:`, JSON.stringify(result.metadata, null, 2))
      }
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[ToolManager] Tool ${toolName} failed:`, error)
      return { success: false, output: '', error: errorMessage }
    }
  }

  // 执行 MCP 工具
  private async executeMcpTool(
    callId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    // 解析工具名称：mcp:{serverId}:{toolName}
    const parts = toolName.split(':')
    if (parts.length !== 3) {
      return { success: false, output: '', error: `Invalid MCP tool name format: ${toolName}` }
    }

    const [, serverId, actualToolName] = parts

    log.info(`[ToolManager] Executing MCP tool: ${actualToolName} on server ${serverId} (id: ${callId})`)
    log.info(`[ToolManager] Arguments:`, JSON.stringify(args, null, 2))

    try {
      const result = await mcpManager.executeTool(serverId, actualToolName, args)
      log.info(`[ToolManager] MCP tool ${actualToolName} completed successfully`)
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        metadata: { mcpResult: result }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[ToolManager] MCP tool ${actualToolName} failed:`, error)
      return { success: false, output: '', error: errorMessage }
    }
  }

  // 获取所有可用的 MCP 工具定义
  getMcpToolDefinitions(): { serverId: string; tools: any[] }[] {
    const definitions: { serverId: string; tools: any[] }[] = []
    const statuses = mcpManager.getAllServerStatuses()
    
    for (const status of statuses) {
      if (status.status === 'connected' && status.tools && status.tools.length > 0) {
        definitions.push({
          serverId: status.id,
          tools: status.tools
        })
      }
    }
    
    return definitions
  }
}

export const toolManager = ToolManager.getInstance()
