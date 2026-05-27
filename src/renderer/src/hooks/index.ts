export { useChatMode } from './useChatMode'
export { useAgentMode } from './useAgentMode'
export { useCodeCompletion } from './useCodeCompletion'
export { useCodeIntelligence } from './useCodeIntelligence'
export { useUnifiedConversation } from './useUnifiedConversation'
export { useGit, type GitFile, type GitBranch, type GitCommit, type GitStash, type UseGitOptions, type UseGitReturn } from './useGit'
export {
  useConversationBase,
  parseToolCalls,
  cleanToolCallBlocks,
  TOOL_NAME_MAP,
  getIPCApi,
  type StreamChunk,
  type ToolCall,
  type ConversationOptions,
  type ConversationResult
} from './useConversationBase'
