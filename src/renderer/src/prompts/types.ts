/**
 * 系统提示词类型定义
 * 统一管理系统提示词相关的类型
 */

/**
 * 工具定义
 */
export interface PromptTool {
  name: string
  description: string
  parameters?: Record<string, PromptToolParameter>
  required?: string[]
}

/**
 * 工具参数定义
 */
export interface PromptToolParameter {
  type: string
  description: string
  required?: boolean
}

/**
 * 命令定义
 */
export interface PromptCommand {
  name: string
  description: string
}

/**
 * 系统信息
 */
export interface SystemInfo {
  platform: string
  cwd: string
  currentTime: string
}

/**
 * 项目上下文
 */
export interface ProjectContext {
  overview: string
  fileTree?: string
  keyFiles?: string
}

/**
 * 提示词构建选项
 */
export interface PromptBuildOptions {
  systemInfo: SystemInfo
  projectContext?: string
  commands?: PromptCommand[]
  tools?: PromptTool[]
  version?: string
}

/**
 * 提示词版本信息
 */
export interface PromptVersion {
  major: number
  minor: number
  patch: number
  date: string
}

/**
 * 模式类型
 */
export type PromptMode = 'chat' | 'agent'
