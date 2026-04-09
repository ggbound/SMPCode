/**
 * 工具注册表
 * 管理 CLI 工具的注册、权限控制和执行
 */

import log from 'electron-log'

export interface ToolParameter {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  default?: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  sourceHint: string
  responsibility: string
  parameters: Record<string, ToolParameter>
  required: string[]
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

export interface ToolContext {
  cwd: string
  sessionId?: string
  permissionMode: 'strict' | 'moderate' | 'permissive'
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  data?: unknown
}

export interface PermissionDenial {
  toolName: string
  reason: string
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  private deniedPrefixes: string[] = []
  private deniedTools: string[] = []

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name.toLowerCase(), tool)
    log.info(`[ToolRegistry] Registered tool: ${tool.name}`)
  }

  /**
   * 注销工具
   */
  unregister(name: string): void {
    this.tools.delete(name.toLowerCase())
    log.info(`[ToolRegistry] Unregistered tool: ${name}`)
  }

  /**
   * 获取工具
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name.toLowerCase())
  }

  /**
   * 获取所有工具
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name.toLowerCase())
  }

  /**
   * 设置权限控制
   */
  setPermissions(deniedTools: string[] = [], deniedPrefixes: string[] = []): void {
    this.deniedTools = deniedTools.map(t => t.toLowerCase())
    this.deniedPrefixes = deniedPrefixes.map(p => p.toLowerCase())
  }

  /**
   * 检查工具是否被允许
   */
  isAllowed(name: string): { allowed: boolean; reason?: string } {
    const lowerName = name.toLowerCase()

    // 检查具体工具
    if (this.deniedTools.includes(lowerName)) {
      return { allowed: false, reason: `Tool '${name}' is explicitly denied` }
    }

    // 检查前缀
    for (const prefix of this.deniedPrefixes) {
      if (lowerName.startsWith(prefix)) {
        return { allowed: false, reason: `Tool '${name}' matches denied prefix '${prefix}'` }
      }
    }

    return { allowed: true }
  }

  /**
   * 搜索工具
   */
  search(query: string, limit: number = 20): ToolDefinition[] {
    const needle = query.toLowerCase()
    const matches = this.getAll().filter(
      tool =>
        tool.name.toLowerCase().includes(needle) ||
        tool.sourceHint.toLowerCase().includes(needle) ||
        tool.responsibility.toLowerCase().includes(needle)
    )
    return matches.slice(0, limit)
  }

  /**
   * 路由提示到匹配的工具
   */
  routePrompt(prompt: string, limit: number = 5): Array<{ kind: string; name: string; score: number; sourceHint: string }> {
    const tokens = new Set(
      prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0)
    )

    const matches: Array<{ kind: string; name: string; score: number; sourceHint: string }> = []

    for (const tool of this.getAll()) {
      const haystacks = [tool.name.toLowerCase(), tool.sourceHint.toLowerCase(), tool.responsibility.toLowerCase()]
      let score = 0
      for (const token of Array.from(tokens)) {
        if (haystacks.some(h => h.includes(token))) {
          score += 1
        }
      }
      if (score > 0) {
        matches.push({ kind: 'tool', name: tool.name, score, sourceHint: tool.sourceHint })
      }
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 执行工具
   */
  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.get(name)
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Unknown tool: ${name}`
      }
    }

    // 权限检查
    const permission = this.isAllowed(name)
    if (!permission.allowed) {
      return {
        success: false,
        output: '',
        error: `Permission denied: ${permission.reason}`
      }
    }

    // 根据权限模式进行额外检查
    if (context.permissionMode === 'strict' && name.toLowerCase().includes('bash')) {
      return {
        success: false,
        output: '',
        error: `Permission denied: bash execution is gated in strict mode`
      }
    }

    try {
      return await tool.execute(args, context)
    } catch (error) {
      log.error(`[ToolRegistry] Error executing tool ${name}:`, error)
      return {
        success: false,
        output: '',
        error: `Error executing tool ${name}: ${String(error)}`
      }
    }
  }

  /**
   * 验证工具参数
   */
  validateArgs(tool: ToolDefinition, args: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // 检查必需参数
    for (const required of tool.required) {
      if (!(required in args) || args[required] === undefined || args[required] === null) {
        errors.push(`Missing required parameter: ${required}`)
      }
    }

    // 验证参数类型
    for (const [key, value] of Object.entries(args)) {
      const paramDef = tool.parameters[key]
      if (!paramDef) {
        errors.push(`Unknown parameter: ${key}`)
        continue
      }

      if (paramDef.type === 'string' && typeof value !== 'string') {
        errors.push(`Parameter ${key} must be a string`)
      } else if (paramDef.type === 'number' && typeof value !== 'number') {
        errors.push(`Parameter ${key} must be a number`)
      } else if (paramDef.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`Parameter ${key} must be a boolean`)
      } else if (paramDef.type === 'array' && !Array.isArray(value)) {
        errors.push(`Parameter ${key} must be an array`)
      }

      // 枚举检查
      if (paramDef.enum && !paramDef.enum.includes(String(value))) {
        errors.push(`Parameter ${key} must be one of: ${paramDef.enum.join(', ')}`)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * 转换为 OpenAI 格式
   */
  toOpenAIDefinitions(): Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: {
        type: 'object'
        properties: Record<string, ToolParameter>
        required: string[]
      }
    }
  }> {
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.responsibility,
        parameters: {
          type: 'object',
          properties: tool.parameters,
          required: tool.required
        }
      }
    }))
  }
}

// 全局工具注册表实例
export const toolRegistry = new ToolRegistry()

// 导出便捷函数
export function registerTool(tool: ToolDefinition): void {
  toolRegistry.register(tool)
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return toolRegistry.getAll()
}

export function executeTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  return toolRegistry.execute(name, args, context)
}
