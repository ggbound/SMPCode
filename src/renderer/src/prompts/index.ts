/**
 * 系统提示词管理模块
 * 统一导出所有提示词相关功能
 */

// 类型定义
export type {
  PromptTool,
  PromptToolParameter,
  PromptCommand,
  SystemInfo,
  ProjectContext,
  PromptBuildOptions,
  PromptVersion,
  PromptMode
} from './types'

// 共享内容
export {
  PROMPT_VERSION,
  getVersionString,
  CHAT_MODE_TOOLS,
  AGENT_MODE_TOOLS,
  TOOL_INVOCATION_FORMAT,
  COMMON_CRITICAL_RULES,
  BEST_PRACTICES,
  ERROR_HANDLING,
  RESPONSE_FORMAT,
  TASK_PLANNING_PROTOCOL,
  formatToolsForPrompt,
  formatCommandsForPrompt,
  buildSystemInfoSection
} from './shared'

// Chat Mode
export {
  buildChatModePrompt,
  getChatModeTools,
  isToolAvailableInChatMode
} from './chat-prompt'

// Agent Mode
export {
  buildAgentModePrompt,
  getAgentModeTools,
  isToolAvailableInAgentMode,
  getAgentOnlyTools
} from './agent-prompt'

/**
 * 构建系统提示词的主入口函数
 * 根据模式自动选择合适的提示词构建器
 */
import type { PromptBuildOptions, PromptMode } from './types'
import { buildChatModePrompt } from './chat-prompt'
import { buildAgentModePrompt } from './agent-prompt'

export function buildSystemPrompt(mode: PromptMode, options: PromptBuildOptions): string {
  switch (mode) {
    case 'chat':
      return buildChatModePrompt(options)
    case 'agent':
      return buildAgentModePrompt(options)
    default:
      throw new Error(`Unknown prompt mode: ${mode}`)
  }
}

/**
 * 获取指定模式的工具列表
 */
import { getChatModeTools, isToolAvailableInChatMode } from './chat-prompt'
import { getAgentModeTools, isToolAvailableInAgentMode } from './agent-prompt'

export function getToolsForMode(mode: PromptMode) {
  switch (mode) {
    case 'chat':
      return getChatModeTools()
    case 'agent':
      return getAgentModeTools()
    default:
      throw new Error(`Unknown prompt mode: ${mode}`)
  }
}

/**
 * 检查工具在指定模式下是否可用
 */
export function isToolAvailable(toolName: string, mode: PromptMode): boolean {
  switch (mode) {
    case 'chat':
      return isToolAvailableInChatMode(toolName)
    case 'agent':
      return isToolAvailableInAgentMode(toolName)
    default:
      return false
  }
}

/**
 * 获取系统信息
 */
export function getSystemInfo(cwd: string): { platform: string; cwd: string; currentTime: string } {
  const platform = navigator.platform.toLowerCase().includes('win') ? 'Windows' :
                   navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Linux'
  
  return {
    platform,
    cwd,
    currentTime: new Date().toISOString()
  }
}
