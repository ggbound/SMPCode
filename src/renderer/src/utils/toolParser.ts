/**
 * 工具调用解析工具模块
 * 集中管理所有工具调用解析相关功能
 */

import { TOOL_NAME_MAP as BaseTOOL_NAME_MAP } from './toolConstants'

// 导出基础工具名称映射
export { BaseTOOL_NAME_MAP }

// 扩展的工具名称映射（包含更多别名）
export const TOOL_NAME_MAP: Record<string, string> = {
  ...BaseTOOL_NAME_MAP,
  // 别名映射
  'bash': 'execute_bash',
  'shell': 'execute_bash',
  'cmd': 'execute_bash',
  'terminal': 'execute_bash',

  // 大驼峰命名向后兼容
  'FileWriteTool': 'write_file',
  'FileReadTool': 'read_file',
  'FileEditTool': 'edit_file',
  'FileAppendTool': 'append_file',
  'ListDirectoryTool': 'list_directory',
  'DeleteFileTool': 'delete_file',
  'BashTool': 'execute_bash',
  'SearchCodeTool': 'search_files',
  'GetRunningProcessesTool': 'get_running_processes',
  'StopProcessTool': 'stop_process',
  'RestartProcessTool': 'restart_process'
}

// 参数名映射
export const PARAMETER_NAME_MAP: Record<string, string> = {
  'file_path': 'path',
  'old_string': 'old_string',
  'new_string': 'new_string',
  'content': 'content',
  'command': 'command',
  'timeout': 'timeout',
  'pattern': 'pattern',
  'path': 'path'
}

/**
 * 转换工具名称（支持向后兼容）
 */
export function normalizeToolName(name: string): string {
  return TOOL_NAME_MAP[name] || name
}

/**
 * 转换参数名（支持向后兼容）
 */
export function normalizeParameters(args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const normalizedKey = PARAMETER_NAME_MAP[key] || key
    normalized[normalizedKey] = value
  }
  return normalized
}

/**
 * 工具调用结果接口
 */
export interface ParsedToolCall {
  tool: string
  arguments: Record<string, unknown>
  id?: string
}

/**
 * 解析工具调用 - 统一实现
 * 支持多种格式：XML、JSON code blocks、inline JSON
 */
export function parseToolCalls(text: string): ParsedToolCall[] | null {
  const toolCalls: ParsedToolCall[] = []

  // Method 0: Parse special tool call format
  const toolCallsSectionRegex = /\<\|tool_calls_section_begin\|\>([\s\S]*?)\<\|tool_calls_section_end\|\>/g
  let sectionMatch
  while ((sectionMatch = toolCallsSectionRegex.exec(text)) !== null) {
    const sectionContent = sectionMatch[1]
    const toolCallRegex = /\<\|tool_call_begin\|\>functions\.(\w+):\d+\<\|tool_call_args\|\>([\s\S]*?)\<\|tool_call_end\|\>/g
    let toolMatch
    while ((toolMatch = toolCallRegex.exec(sectionContent)) !== null) {
      const toolName = toolMatch[1]
      const argsJson = toolMatch[2].trim()

      if (!argsJson || argsJson.length < 2) {
        continue
      }

      try {
        const args = JSON.parse(argsJson)
        toolCalls.push({ tool: toolName, arguments: args })
      } catch (e) {
        console.error('Failed to parse tool call args:', argsJson.substring(0, 200))
      }
    }
  }

  // Method 1: Parse <tool_code> XML format
  const toolCodeRegex = /<tool_code>[\s\S]*?<tool\s+name="([^"]+)"([\s\S]*?)(?:\/>|<\/tool>)[\s\S]*?(?:<\/tool_code>|$)/g
  const toolCodeMatches = Array.from(text.matchAll(toolCodeRegex))

  for (const match of toolCodeMatches) {
    const toolName = match[1]
    if (!toolName || !/^\w[\w_-]*$/.test(toolName)) {
      console.warn('[parseToolCalls] Invalid tool name format:', toolName)
      continue
    }
    let attrsContent = match[2]
    attrsContent = attrsContent.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const args: Record<string, unknown> = {}
    const attrRegex = /(\w+)="((?:[^"\\]|\\.)*)"/g
    let attrMatch
    while ((attrMatch = attrRegex.exec(attrsContent)) !== null) {
      const attrName = attrMatch[1]
      let attrValue = attrMatch[2]
      attrValue = attrValue.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
      if (attrName !== 'name') {
        args[attrName] = attrValue
      }
    }
    if (Object.keys(args).length > 0) {
      toolCalls.push({ tool: toolName, arguments: args })
    }
  }

  // Method 2: Parse MiniMax XML format
  const xmlToolCallRegex = /<minimax:tool_call>[\s\S]*?<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>[\s\S]*?<\/minimax:tool_call>/g
  const xmlMatches = Array.from(text.matchAll(xmlToolCallRegex))

  for (const match of xmlMatches) {
    const toolName = match[1]
    if (!toolName || !/^\w[\w_-]*$/.test(toolName)) {
      console.warn('[parseToolCalls] Invalid tool name format in MiniMax XML:', toolName)
      continue
    }
    const paramsContent = match[2]
    const args: Record<string, unknown> = {}
    const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g
    const paramMatches = Array.from(paramsContent.matchAll(paramRegex))

    for (const paramMatch of paramMatches) {
      const paramName = paramMatch[1]
      const paramValue = paramMatch[2].trim()
      args[paramName] = paramValue
    }

    if (Object.keys(args).length > 0) {
      toolCalls.push({ tool: toolName, arguments: args })
    }
  }

  // Method 3: Parse JSON format from code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
  const matches = Array.from(text.matchAll(codeBlockRegex))

  for (const match of matches) {
    let blockContent = match[1].trim()

    // Try to fix incomplete JSON
    const openBraces = (blockContent.match(/\{/g) || []).length
    const closeBraces = (blockContent.match(/\}/g) || []).length
    if (openBraces > closeBraces) {
      blockContent += '}'.repeat(openBraces - closeBraces)
    }

    if (blockContent.includes('"tool"') && blockContent.includes('"arguments"')) {
      try {
        const parsed = JSON.parse(blockContent)
        if (parsed.tool && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
          continue
        }
      } catch (e) {
        // Not valid JSON, try line by line
      }
    }

    // Infer tool from fields
    try {
      const parsed = JSON.parse(blockContent)
      let inferredTool: string | null = null
      if (parsed.command !== undefined) inferredTool = 'execute_bash'
      else if (parsed.path !== undefined && parsed.content !== undefined) inferredTool = 'write_file'
      else if (parsed.path !== undefined && parsed.old_string !== undefined) inferredTool = 'edit_file'
      else if (parsed.path !== undefined) inferredTool = 'read_file'
      else if (parsed.query !== undefined) inferredTool = 'search_files'

      if (inferredTool) {
        toolCalls.push({ tool: inferredTool, arguments: parsed })
        continue
      }
    } catch (e) {
      // Not JSON
    }

    // Try line by line parsing
    const lines = blockContent.split('\n').filter(line => line.trim())
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim())
        if (parsed.tool && typeof parsed.arguments === 'object') {
          toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
        }
      } catch (e) {
        // Ignore
      }
    }
  }

  // Method 4: Look for inline JSON objects with "tool" and "arguments" fields
  const jsonObjectRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g
  let jsonMatch
  while ((jsonMatch = jsonObjectRegex.exec(text)) !== null) {
    const jsonStr = jsonMatch[0]

    if (!jsonStr || jsonStr.length < 10) {
      continue
    }

    const alreadyFound = toolCalls.some(tc => {
      const tcStr = JSON.stringify(tc)
      return jsonStr.includes(tcStr) || tcStr.includes(jsonStr.substring(0, 50))
    })
    if (alreadyFound) continue

    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.tool && typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
        toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments })
      }
    } catch (e) {
      // Ignore parse errors for inline JSON
    }
  }

  return toolCalls.length > 0 ? toolCalls : null
}

/**
 * 清理工具调用代码块 - 从内容中移除工具调用标记
 */
export function cleanToolCallBlocks(content: string): string {
  let cleaned = content

  // Remove code blocks containing tool calls
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
  const matches = Array.from(content.matchAll(codeBlockRegex))

  for (const match of matches) {
    const blockContent = match[1].trim()
    const fullBlock = match[0]
    const hasToolPattern = blockContent.includes('"tool"') ||
      blockContent.includes('"tool_calls"') ||
      (blockContent.includes('"name"') && blockContent.includes('"arguments"'))

    if (hasToolPattern) {
      cleaned = cleaned.replace(fullBlock, '')
    }
  }

  // Remove XML tool calls
  const toolCodeRegex = /<tool_code>[\s\S]*?<tool\s+name="[^"]+"[\s\S]*?(?:\/>|<\/tool>)[\s\S]*?(?:<\/tool_code>|$)/g
  const toolCodeMatches = Array.from(cleaned.matchAll(toolCodeRegex))
  for (const match of toolCodeMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  const minimaxToolRegex = /<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g
  const minimaxMatches = Array.from(cleaned.matchAll(minimaxToolRegex))
  for (const match of minimaxMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  // Remove thinking tags
  const thinkRegex = /<thinking>[\s\S]*?<\/thinking>/g
  const thinkMatches = Array.from(cleaned.matchAll(thinkRegex))
  for (const match of thinkMatches) {
    cleaned = cleaned.replace(match[0], '')
  }

  return cleaned.trim()
}

/**
 * 检查是否为文件操作工具
 */
export function isFileOperationTool(toolName: string): boolean {
  const fileOperationTools = ['write_file', 'delete_file', 'edit_file', 'append_file', 'mkdir']
  const mappedName = normalizeToolName(toolName)
  return fileOperationTools.includes(mappedName)
}

/**
 * HTML 转义工具函数
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
