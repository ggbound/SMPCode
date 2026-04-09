/**
 * CLI 模块入口
 * 导出所有 CLI 相关功能
 */

// 导出注册表
export { commandRegistry, registerCommand, getCommand, getAllCommands } from './command-registry'
export { toolRegistry, registerTool, getTool, getAllTools } from './tool-registry'

// 导出运行时引擎
export {
  runtimeEngine,
  createSession,
  getSession,
  executeTurn,
  runTurnLoop
} from './runtime-engine'

// 导出 CLI 入口
export { program as cliProgram } from './cli-entry'

// 导出类型
export type { CommandDefinition, CommandContext, CommandResult } from './command-registry'
export type { ToolDefinition, ToolContext, ToolResult, ToolParameter, PermissionDenial } from './tool-registry'
export type { RuntimeSession, RuntimeConfig, TurnResult, RoutedMatch } from './runtime-engine'
