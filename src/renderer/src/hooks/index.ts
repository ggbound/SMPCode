export { useChatMode } from './useChatMode'
export { useAgentMode } from './useAgentMode'
export { useCodeCompletion } from './useCodeCompletion'
export { useCodeIntelligence } from './useCodeIntelligence'
export { useUnifiedConversation } from './useUnifiedConversation'
export { useGit, type GitFile, type GitBranch, type GitCommit, type GitStash, type UseGitOptions, type UseGitReturn } from './useGit'
export {
  useConversationBase,
  getIPCApi,
  type StreamChunk,
  type ToolCall,
  type ConversationOptions,
  type ConversationResult
} from './useConversationBase'
// 工具解析函数现在从共享模块导出
export { parseToolCalls, cleanToolCallBlocks, TOOL_NAME_MAP } from '../utils/toolParser'
