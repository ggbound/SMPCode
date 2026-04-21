// LLM Service supporting OpenAI and Anthropic compatible APIs
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
  tools?: unknown[]
  stream?: boolean
  apiUrl?: string  // 自定义 API 端点
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
  tool_calls?: Array<{
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface StreamChunk {
  type: string
  [key: string]: unknown
}

// Default API Endpoints (fallback)
const DEFAULT_OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

// Models that use Anthropic protocol
const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]

/**
 * Check if model uses Anthropic protocol
 */
function isAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODELS.some(m => model.toLowerCase().includes(m.toLowerCase()))
}

/**
 * Get API URL for the request
 */
function getApiUrl(apiUrl: string | undefined, isAnthropic: boolean): string {
  if (apiUrl) {
    // If user provided URL already ends with /chat/completions, use it as-is
    if (apiUrl.includes('/chat/completions')) {
      return apiUrl
    }
    
    // Remove trailing slash if present
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
    
    // If URL ends with /v1, append /chat/completions (OpenAI, Azure, DashScope style)
    if (baseUrl.endsWith('/v1')) {
      return `${baseUrl}/chat/completions`
    }
    
    // For other cases (like DeepSeek: https://api.deepseek.com), just append /chat/completions
    // DeepSeek API: https://api.deepseek.com/chat/completions (no /v1)
    return `${baseUrl}/chat/completions`
  }
  return isAnthropic ? DEFAULT_ANTHROPIC_API_URL : DEFAULT_OPENAI_API_URL
}

/**
 * Send chat message to LLM API
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const { apiKey, model, messages, tools, stream = false, apiUrl } = request

  if (isAnthropicModel(model)) {
    return sendAnthropicMessage(apiKey, model, messages, tools, stream, apiUrl)
  } else {
    return sendOpenAIMessage(apiKey, model, messages, tools, stream, apiUrl)
  }
}

/**
 * Send message using OpenAI compatible API
 */
async function sendOpenAIMessage(
  apiKey: string,
  model: string,
  messages: Message[],
  tools?: unknown[],
  stream = false,
  apiUrl?: string
): Promise<ChatResponse> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 16384,  // Increased for large file operations
    stream
  }

  // Check if this is DeepSeek API (based on URL or model name)
  const isDeepSeek = apiUrl?.includes('deepseek') || model.toLowerCase().includes('deepseek')

  // Enable tools if provided (but not for DeepSeek as it may not support function calling)
  if (tools && tools.length > 0 && !isDeepSeek) {
    requestBody.tools = tools
    requestBody.tool_choice = 'auto'
  }

  const url = getApiUrl(apiUrl, false)

  log.info(`[LLM] Sending request to: ${url}, model: ${model}, isDeepSeek: ${isDeepSeek}`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error(`[LLM] API error: ${response.status} - ${errorText}`)
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    const message = data.choices[0]?.message
    const content = message?.content || ''
    const toolCalls = message?.tool_calls

    // Convert OpenAI format to our internal format
    const result: ChatResponse = {
      id: data.id,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      model: data.model,
      stop_reason: data.choices[0]?.finish_reason || 'stop',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0
      }
    }

    // Include tool_calls if present
    if (toolCalls && toolCalls.length > 0) {
      result.tool_calls = toolCalls
    }

    return result
  } catch (error) {
    log.error('OpenAI API error:', error)
    throw error
  }
}

/**
 * Send message using Anthropic compatible API
 */
async function sendAnthropicMessage(
  apiKey: string,
  model: string,
  messages: Message[],
  tools?: unknown[],
  stream = false,
  apiUrl?: string
): Promise<ChatResponse> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 16384,  // Increased for large file operations
    stream
  }

  // Enable tools if provided
  if (tools && tools.length > 0) {
    requestBody.tools = tools
  }

  const url = getApiUrl(apiUrl, true)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    const result: ChatResponse = {
      id: data.id,
      type: data.type || 'message',
      role: data.role || 'assistant',
      content: data.content || [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
      model: data.model,
      stop_reason: data.stop_reason || data.choices?.[0]?.finish_reason || 'stop',
      usage: {
        input_tokens: data.usage?.input_tokens || data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.output_tokens || data.usage?.completion_tokens || 0
      }
    }

    // Include tool_calls if present (Anthropic format may be different)
    if (data.tool_calls) {
      result.tool_calls = data.tool_calls
    } else if (data.choices?.[0]?.message?.tool_calls) {
      result.tool_calls = data.choices[0].message.tool_calls
    }

    return result
  } catch (error) {
    log.error('Anthropic API error:', error)
    throw error
  }
}

/**
 * Stream chat message to LLM API
 */
export async function* streamChatMessage(request: ChatRequest): AsyncGenerator<StreamChunk> {
  const { apiKey, model, messages, tools, apiUrl } = request

  if (isAnthropicModel(model)) {
    yield* streamAnthropicMessage(apiKey, model, messages, tools, apiUrl)
  } else {
    yield* streamOpenAIMessage(apiKey, model, messages, tools, apiUrl)
  }
}

/**
 * Stream message using OpenAI compatible API
 */
async function* streamOpenAIMessage(
  apiKey: string,
  model: string,
  messages: Message[],
  tools?: unknown[],
  apiUrl?: string
): AsyncGenerator<StreamChunk> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 16384,  // Increased for large file operations
    stream: true
  }

  // NOTE: We don't send tools parameter to force AI to use JSON format
  // Tools are described in system prompt instead
  // if (tools && tools.length > 0) {
  //   requestBody.tools = tools
  // }

  const url = getApiUrl(apiUrl, false)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            yield { type: 'done' }
            return
          }
          try {
            const parsed = JSON.parse(data)
            yield {
              type: 'content_block_delta',
              delta: { type: 'text', text: parsed.choices[0]?.delta?.content || '' }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    log.error('OpenAI Stream API error:', error)
    throw error
  }
}

/**
 * Stream message using Anthropic compatible API
 */
async function* streamAnthropicMessage(
  apiKey: string,
  model: string,
  messages: Message[],
  tools?: unknown[],
  apiUrl?: string
): AsyncGenerator<StreamChunk> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 16384,  // Increased for large file operations
    stream: true
  }

  // NOTE: We don't send tools parameter to force AI to use JSON format
  // Tools are described in system prompt instead
  // if (tools && tools.length > 0) {
  //   requestBody.tools = tools
  // }

  const url = getApiUrl(apiUrl, true)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            yield { type: 'done' }
            return
          }
          try {
            const parsed = JSON.parse(data)
            yield parsed as StreamChunk
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    log.error('Anthropic Stream API error:', error)
    throw error
  }
}

/**
 * Validate API key by making a simple request
 */
export async function validateApiKey(apiKey: string, model: string, apiUrl?: string): Promise<boolean> {
  try {
    const isAnthropic = isAnthropicModel(model)
    const url = getApiUrl(apiUrl, isAnthropic)

    if (isAnthropic) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1
        })
      })
      return response.ok
    } else {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1
        })
      })
      return response.ok
    }
  } catch (error) {
    log.error('API key validation failed:', error)
    return false
  }
}

export default {
  sendChatMessage,
  streamChatMessage,
  validateApiKey
}
