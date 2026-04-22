// VSCode Copilot Service Adapter
// Provides Copilot-style AI capabilities including code completion, explanation, and refactoring

import log from 'electron-log'

// Types for Copilot-style requests
export interface CodeCompletionRequest {
  prefix: string
  suffix: string
  language: string
  filePath: string
  cursorPosition: { line: number; character: number }
  context?: string
  apiKey: string
  model: string
  apiUrl?: string
}

export interface CodeCompletionResponse {
  completions: Array<{
    text: string
    confidence: number
    range?: { start: number; end: number }
  }>
  model: string
}

export interface CodeExplanationRequest {
  code: string
  language: string
  filePath: string
  selectionRange?: { start: number; end: number }
  apiKey: string
  model: string
  apiUrl?: string
}

export interface CodeExplanationResponse {
  explanation: string
  keyPoints: string[]
  model: string
}

export interface CodeRefactoringRequest {
  code: string
  language: string
  filePath: string
  refactoringType: 'improve' | 'simplify' | 'optimize' | 'fix' | 'document'
  apiKey: string
  model: string
  apiUrl?: string
}

export interface CodeRefactoringResponse {
  refactoredCode: string
  explanation: string
  changes: Array<{
    type: string
    description: string
    lineRange?: { start: number; end: number }
  }>
  model: string
}

export interface InlineEditRequest {
  code: string
  instruction: string
  language: string
  filePath: string
  selectionRange: { start: number; end: number }
  apiKey: string
  model: string
  apiUrl?: string
}

export interface InlineEditResponse {
  editedCode: string
  explanation: string
  diff: string
  model: string
}

// Default API Endpoints
const DEFAULT_OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

// Models optimized for code completion
const COMPLETION_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet',
  'deepseek-coder',
  'codestral'
]

/**
 * Build completion prompt in Copilot style
 */
function buildCompletionPrompt(request: CodeCompletionRequest): string {
  const { prefix, suffix } = request

  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
}

/**
 * Build explanation prompt
 */
function buildExplanationPrompt(request: CodeExplanationRequest): string {
  const { code, language, filePath } = request

  return `Explain the following ${language} code from file ${filePath}:

\`\`\`${language}
${code}
\`\`\`

Please provide:
1. A clear explanation of what this code does
2. Key concepts or patterns used
3. Any potential issues or improvements

Be concise but thorough.`
}

/**
 * Build refactoring prompt
 */
function buildRefactoringPrompt(request: CodeRefactoringRequest): string {
  const { code, language, filePath, refactoringType } = request

  const typeDescriptions: Record<string, string> = {
    improve: 'improve the code quality and readability',
    simplify: 'simplify the code while maintaining functionality',
    optimize: 'optimize the code for better performance',
    fix: 'fix any bugs or issues in the code',
    document: 'add comprehensive documentation and comments'
  }

  return `Refactor the following ${language} code from file ${filePath} to ${typeDescriptions[refactoringType] || 'improve the code'}:

\`\`\`${language}
${code}
\`\`\`

Please provide:
1. The refactored code
2. An explanation of the changes made
3. Specific improvements or fixes applied

Output format:
- Start with the refactored code in a code block
- Follow with the explanation`
}

/**
 * Build inline edit prompt
 */
function buildInlineEditPrompt(request: InlineEditRequest): string {
  const { code, instruction, language, filePath } = request

  return `Edit the following ${language} code from file ${filePath} according to this instruction: "${instruction}"

Original code:
\`\`\`${language}
${code}
\`\`\`

Please provide:
1. The edited code
2. A brief explanation of what was changed

Output format:
- Start with the edited code in a code block
- Follow with the explanation`
}

/**
 * Get API URL for the request
 */
function getApiUrl(apiUrl: string | undefined): string {
  if (apiUrl) {
    if (apiUrl.includes('/chat/completions')) {
      return apiUrl
    }
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
    if (baseUrl.endsWith('/v1')) {
      return `${baseUrl}/chat/completions`
    }
    return `${baseUrl}/chat/completions`
  }
  return DEFAULT_OPENAI_API_URL
}

/**
 * Send completion request to LLM API
 */
export async function getCodeCompletions(
  request: CodeCompletionRequest
): Promise<CodeCompletionResponse> {
  const { apiKey, model, apiUrl } = request

  const prompt = buildCompletionPrompt(request)

  try {
    const url = getApiUrl(apiUrl)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a code completion assistant. Complete the code at the cursor position marked by <|fim_middle|>. Provide only the completion text, no explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 256,
        temperature: 0.2,
        stop: ['<|fim_suffix|>', '\n\n', '\n\t\n']
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const completionText = data.choices?.[0]?.message?.content?.trim() || ''

    // Clean up the completion
    const cleanedCompletion = completionText
      .replace(/^<\|fim_middle\|>/, '')
      .replace(/<\|fim_suffix\|>.*$/, '')
      .trim()

    return {
      completions: [
        {
          text: cleanedCompletion,
          confidence: 0.9
        }
      ],
      model: data.model || model
    }
  } catch (error) {
    log.error('[CopilotService] Completion error:', error)
    throw error
  }
}

/**
 * Get code explanation
 */
export async function explainCode(
  request: CodeExplanationRequest
): Promise<CodeExplanationResponse> {
  const { apiKey, model, apiUrl } = request

  const prompt = buildExplanationPrompt(request)

  try {
    const url = getApiUrl(apiUrl)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a code explanation assistant. Provide clear, concise explanations of code.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const explanation = data.choices?.[0]?.message?.content?.trim() || ''

    // Extract key points
    const keyPointsMatch = explanation.match(/(?:key concepts?|key points?|patterns? used?):?\s*([\s\S]*?)(?=\n\n|$)/i)
    const keyPoints = keyPointsMatch
      ? keyPointsMatch[1].split('\n').filter((line: string) => line.trim()).map((line: string) => line.replace(/^[-*]\s*/, ''))
      : []

    return {
      explanation,
      keyPoints,
      model: data.model || model
    }
  } catch (error) {
    log.error('[CopilotService] Explanation error:', error)
    throw error
  }
}

/**
 * Get code refactoring suggestions
 */
export async function refactorCode(
  request: CodeRefactoringRequest
): Promise<CodeRefactoringResponse> {
  const { apiKey, model, apiUrl } = request

  const prompt = buildRefactoringPrompt(request)

  try {
    const url = getApiUrl(apiUrl)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a code refactoring assistant. Provide improved code with clear explanations of changes.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 2048,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const responseText = data.choices?.[0]?.message?.content?.trim() || ''

    // Parse refactored code from response
    const codeMatch = responseText.match(/```[\w]*\n([\s\S]*?)```/)
    const refactoredCode = codeMatch ? codeMatch[1].trim() : responseText

    // Extract explanation (text after code block)
    const explanationMatch = responseText.match(/```[\s\S]*?```\s*\n\n?([\s\S]*)/)
    const explanation = explanationMatch ? explanationMatch[1].trim() : 'Code has been refactored.'

    return {
      refactoredCode,
      explanation,
      changes: [],
      model: data.model || model
    }
  } catch (error) {
    log.error('[CopilotService] Refactoring error:', error)
    throw error
  }
}

/**
 * Get inline edit suggestion
 */
export async function getInlineEdit(
  request: InlineEditRequest
): Promise<InlineEditResponse> {
  const { apiKey, model, apiUrl } = request

  const prompt = buildInlineEditPrompt(request)

  try {
    const url = getApiUrl(apiUrl)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a code editing assistant. Edit code according to instructions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 2048,
        temperature: 0.2
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const responseText = data.choices?.[0]?.message?.content?.trim() || ''

    // Parse edited code from response
    const codeMatch = responseText.match(/```[\w]*\n([\s\S]*?)```/)
    const editedCode = codeMatch ? codeMatch[1].trim() : responseText

    // Extract explanation
    const explanationMatch = responseText.match(/```[\s\S]*?```\s*\n\n?([\s\S]*)/)
    const explanation = explanationMatch ? explanationMatch[1].trim() : 'Code has been edited.'

    // Generate simple diff
    const diff = `--- original\n+++ edited\n@@ -1 +1 @@\n${request.code}\n${editedCode}`

    return {
      editedCode,
      explanation,
      diff,
      model: data.model || model
    }
  } catch (error) {
    log.error('[CopilotService] Inline edit error:', error)
    throw error
  }
}

// Export all functions
export default {
  getCodeCompletions,
  explainCode,
  refactorCode,
  getInlineEdit
}
