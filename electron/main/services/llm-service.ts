// LLM Service supporting OpenAI and Anthropic compatible APIs via DashScope
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

// API Endpoints
const OPENAI_API_URL = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions'
const ANTHROPIC_API_URL = 'https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages'

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
 * Send chat message to LLM API
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const { apiKey, model, messages, tools, stream = false } = request

  if (isAnthropicModel(model)) {
    return sendAnthropicMessage(apiKey, model, messages, tools, stream)
  } else {
    return sendOpenAIMessage(apiKey, model, messages, tools, stream)
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
  stream = false
): Promise<ChatResponse> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    stream
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools
    // Force the model to use tools when they're provided
    requestBody.tool_choice = 'auto'
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
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
  stream = false
): Promise<ChatResponse> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    stream
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
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
  const { apiKey, model, messages, tools } = request

  if (isAnthropicModel(model)) {
    yield* streamAnthropicMessage(apiKey, model, messages, tools)
  } else {
    yield* streamOpenAIMessage(apiKey, model, messages, tools)
  }
}

/**
 * Stream message using OpenAI compatible API
 */
async function* streamOpenAIMessage(
  apiKey: string,
  model: string,
  messages: Message[],
  tools?: unknown[]
): AsyncGenerator<StreamChunk> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    stream: true
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
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
  tools?: unknown[]
): AsyncGenerator<StreamChunk> {
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    stream: true
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
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
export async function validateApiKey(apiKey: string, model: string): Promise<boolean> {
  try {
    if (isAnthropicModel(model)) {
      const response = await fetch(ANTHROPIC_API_URL, {
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
      const response = await fetch(OPENAI_API_URL, {
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
