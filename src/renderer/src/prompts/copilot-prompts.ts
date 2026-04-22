// Copilot-style prompts for VS Code AI integration
// Provides prompts for code completion, explanation, refactoring, and inline editing

/**
 * System prompt for code completion
 */
export const CODE_COMPLETION_SYSTEM_PROMPT = `You are an expert code completion assistant, similar to GitHub Copilot.
Your task is to complete code at the cursor position marked by <|fim_middle|>.

Guidelines:
- Provide only the completion text, no explanations or markdown
- Complete the code in a way that fits the existing context
- Maintain consistent coding style with the surrounding code
- Use appropriate variable names and patterns
- Consider the language conventions and best practices
- Keep completions concise but complete
- Do not repeat code that already exists

Output format:
- Only the completion text
- No code blocks, no markdown, no explanations`

/**
 * System prompt for code explanation
 */
export const CODE_EXPLANATION_SYSTEM_PROMPT = `You are an expert code explanation assistant.
Your task is to explain code in a clear, concise manner.

Guidelines:
- Explain what the code does in simple terms
- Highlight key concepts, patterns, or algorithms used
- Mention any potential issues or improvements
- Be thorough but concise
- Use bullet points for key takeaways

Output format:
1. Brief overview (1-2 sentences)
2. Detailed explanation
3. Key points (bullet list)
4. Potential issues or suggestions (if any)`

/**
 * System prompt for code refactoring
 */
export const CODE_REFACTORING_SYSTEM_PROMPT = `You are an expert code refactoring assistant.
Your task is to improve code quality while maintaining functionality.

Guidelines:
- Improve readability and maintainability
- Follow language-specific best practices
- Optimize for performance where appropriate
- Add documentation/comments if needed
- Preserve the original behavior
- Use modern language features when beneficial

Output format:
1. Refactored code in a code block
2. Explanation of changes made
3. List of specific improvements`

/**
 * System prompt for inline editing
 */
export const INLINE_EDIT_SYSTEM_PROMPT = `You are an expert code editing assistant.
Your task is to modify code according to the user's instruction.

Guidelines:
- Make precise, targeted changes
- Maintain code style consistency
- Preserve surrounding code unchanged
- Follow the instruction exactly
- Ensure the edited code is syntactically correct

Output format:
1. Edited code in a code block
2. Brief explanation of what was changed`

/**
 * Build FIM (Fill-In-the-Middle) prompt
 */
export function buildFIMPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
}

/**
 * Build code explanation prompt
 */
export function buildExplanationPrompt(
  code: string,
  language: string,
  filePath: string,
  selectionRange?: { start: number; end: number }
): string {
  const rangeInfo = selectionRange
    ? `\nSelection range: lines ${selectionRange.start}-${selectionRange.end}`
    : ''

  return `Please explain the following ${language} code from file ${filePath}:${rangeInfo}

\`\`\`${language}
${code}
\`\`\`

Provide:
1. What this code does
2. Key concepts or patterns used
3. Any potential issues or improvements`
}

/**
 * Build refactoring prompt
 */
export function buildRefactoringPrompt(
  code: string,
  language: string,
  filePath: string,
  refactoringType: 'improve' | 'simplify' | 'optimize' | 'fix' | 'document'
): string {
  const typeDescriptions: Record<string, string> = {
    improve: 'improve the overall code quality and readability',
    simplify: 'simplify the code while maintaining functionality',
    optimize: 'optimize the code for better performance',
    fix: 'fix any bugs or issues in the code',
    document: 'add comprehensive documentation and comments'
  }

  return `Please refactor the following ${language} code from file ${filePath} to ${typeDescriptions[refactoringType]}:

\`\`\`${language}
${code}
\`\`\`

Provide:
1. The refactored code
2. Explanation of changes
3. Specific improvements made`
}

/**
 * Build inline edit prompt
 */
export function buildInlineEditPrompt(
  code: string,
  instruction: string,
  language: string,
  filePath: string
): string {
  return `Please edit the following ${language} code from file ${filePath} according to this instruction: "${instruction}"

Original code:
\`\`\`${language}
${code}
\`\`\`

Provide:
1. The edited code
2. Brief explanation of changes`
}

/**
 * Build code analysis prompt
 */
export function buildCodeAnalysisPrompt(
  code: string,
  language: string,
  filePath: string
): string {
  return `Please analyze the following ${language} code from file ${filePath}:

\`\`\`${language}
${code}
\`\`\`

Provide:
1. Code complexity assessment
2. List of functions and classes
3. Dependencies and imports
4. Potential issues or improvements
5. Best practices compliance`
}

/**
 * Copilot-style slash commands for chat
 */
export const COPILOT_SLASH_COMMANDS = [
  {
    name: 'explain',
    description: 'Explain the selected code or current file',
    prompt: 'Please explain this code in detail:'
  },
  {
    name: 'fix',
    description: 'Fix issues in the selected code',
    prompt: 'Please fix any issues in this code:'
  },
  {
    name: 'doc',
    description: 'Generate documentation for the selected code',
    prompt: 'Please add documentation to this code:'
  },
  {
    name: 'test',
    description: 'Generate tests for the selected code',
    prompt: 'Please generate unit tests for this code:'
  },
  {
    name: 'refactor',
    description: 'Refactor the selected code for better quality',
    prompt: 'Please refactor this code to improve quality:'
  },
  {
    name: 'optimize',
    description: 'Optimize the selected code for performance',
    prompt: 'Please optimize this code for better performance:'
  }
]

/**
 * Build context-aware completion prompt
 */
export function buildContextAwareCompletionPrompt(
  prefix: string,
  suffix: string,
  language: string,
  symbols: string[],
  imports: string[]
): string {
  const contextInfo = symbols.length > 0 || imports.length > 0
    ? `\n\nAvailable symbols: ${symbols.join(', ')}\nImports: ${imports.join(', ')}`
    : ''

  return `Complete the ${language} code at the cursor position:${contextInfo}

${buildFIMPrompt(prefix, suffix)}`
}

/**
 * Build chat context with code reference
 */
export function buildChatWithCodeContext(
  message: string,
  code: string,
  language: string,
  filePath: string
): string {
  return `User message: ${message}

Referenced code from ${filePath}:
\`\`\`${language}
${code}
\`\`\`

Please respond considering the code context above.`
}

// Export all prompts
export default {
  CODE_COMPLETION_SYSTEM_PROMPT,
  CODE_EXPLANATION_SYSTEM_PROMPT,
  CODE_REFACTORING_SYSTEM_PROMPT,
  INLINE_EDIT_SYSTEM_PROMPT,
  COPILOT_SLASH_COMMANDS,
  buildFIMPrompt,
  buildExplanationPrompt,
  buildRefactoringPrompt,
  buildInlineEditPrompt,
  buildCodeAnalysisPrompt,
  buildContextAwareCompletionPrompt,
  buildChatWithCodeContext
}
