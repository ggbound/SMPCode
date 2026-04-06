// @ts-ignore - TypeScript strict typing issue
import { Anthropic } from '@anthropic-ai/sdk'
import log from 'electron-log'

// Types for API calls
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  apiKey: string
  model: string
  messages: Message[]
  // @ts-ignore - Tool type import issue
  tools?: unknown[]
  stream?: boolean
}

export interface ChatResponse {
  id: string
  type: string
  role: string
  content: unknown
  model: string
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export interface StreamChunk {
  type: string
  [key: string]: unknown
}

// Anthropic client singleton
let anthropicClient: Anthropic | null = null
let currentApiKey: string = ''

/**
 * Get or create Anthropic client
 */
export function getAnthropicClient(apiKey: string): Anthropic {
  if (!anthropicClient || currentApiKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey })
    currentApiKey = apiKey
    log.info('Anthropic client initialized')
  }
  return anthropicClient
}

/**
 * Reset Anthropic client (for testing or key changes)
 */
export function resetAnthropicClient(): void {
  anthropicClient = null
  currentApiKey = ''
  log.info('Anthropic client reset')
}

/**
 * Send chat message to Claude API
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const { apiKey, model, messages, tools, stream = false } = request
  
  const client = getAnthropicClient(apiKey)
  
  // @ts-ignore - TypeScript strict typing issue
  const requestParams: Parameters<typeof client.messages.create>[0] = {
    model: model || 'claude-3-7-sonnet-latest',
    messages,
    max_tokens: 4096,
    stream
  }

  if (tools && tools.length > 0) {
    // @ts-ignore - Tool type import issue
    requestParams.tools = tools
  }

  try {
    // @ts-ignore - TypeScript issue with union types
    const message = await client.messages.create(requestParams)
    const msg = message as unknown as ChatResponse
    
    return {
      id: msg.id,
      type: msg.type,
      role: msg.role,
      content: msg.content,
      model: msg.model,
      stop_reason: msg.stop_reason,
      usage: msg.usage
    }
  } catch (error) {
    log.error('Chat API error:', error)
    throw error
  }
}

/**
 * Stream chat message to Claude API
 */
export async function* streamChatMessage(request: ChatRequest): AsyncGenerator<StreamChunk> {
  const { apiKey, model, messages, tools } = request
  
  const client = getAnthropicClient(apiKey)
  
  // @ts-ignore - TypeScript strict typing issue
  const requestParams: Parameters<typeof client.messages.create>[0] = {
    model: model || 'claude-3-7-sonnet-latest',
    messages,
    max_tokens: 4096,
    stream: true
  }

  if (tools && tools.length > 0) {
    // @ts-ignore - Tool type import issue
    requestParams.tools = tools
  }

  try {
    const stream = await client.messages.stream(requestParams)
    
    for await (const chunk of stream) {
      yield chunk as StreamChunk
    }
  } catch (error) {
    log.error('Stream Chat API error:', error)
    throw error
  }
}

/**
 * Validate API key by making a simple request
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = getAnthropicClient(apiKey)
    // Try to create a minimal message to validate the key
    await client.messages.create({
      model: 'claude-3-7-sonnet-latest',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1
    })
    return true
  } catch (error) {
    log.error('API key validation failed:', error)
    return false
  }
}

export default {
  getAnthropicClient,
  resetAnthropicClient,
  sendChatMessage,
  streamChatMessage,
  validateApiKey
}