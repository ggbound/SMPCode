// Code Intelligence Service
// Provides semantic code analysis, symbol extraction, and context building

import log from 'electron-log'
import { readFileSync } from 'fs'

// Types for code analysis
export interface SymbolInfo {
  name: string
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'import' | 'export'
  range: { start: number; end: number }
  line: number
  character: number
  signature?: string
  documentation?: string
}

export interface CodeContext {
  filePath: string
  language: string
  content: string
  symbols: SymbolInfo[]
  imports: string[]
  exports: string[]
  surroundingContext: string
}

export interface SemanticAnalysis {
  complexity: number
  dependencies: string[]
  functions: SymbolInfo[]
  classes: SymbolInfo[]
  potentialIssues: Array<{
    type: string
    message: string
    line: number
    severity: 'warning' | 'error' | 'info'
  }>
}

// Language patterns for basic symbol extraction
const LANGUAGE_PATTERNS: Record<string, {
  function: RegExp
  class: RegExp
  interface: RegExp
  variable: RegExp
  import: RegExp
  export: RegExp
}> = {
  typescript: {
    function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
    class: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g,
    interface: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/g,
    variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/g,
    import: /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"];?/g,
    export: /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)?\s*(\w+)/g
  },
  javascript: {
    function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
    class: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g,
    interface: /interface\s+(\w+)\s*\{/g,
    variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/g,
    import: /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"];?/g,
    export: /export\s+(?:default\s+)?(?:const|let|var|function|class)?\s*(\w+)/g
  },
  python: {
    function: /def\s+(\w+)\s*\(/g,
    class: /class\s+(\w+)(?:\([^)]*\))?:/g,
    interface: /$^/g, // Python doesn't have interfaces
    variable: /^(\w+)\s*=/gm,
    import: /(?:from\s+(\S+)\s+)?import\s+([^\n]+)/g,
    export: /$^/g // Python doesn't have exports
  },
  rust: {
    function: /(?:pub\s+)?fn\s+(\w+)\s*\(/g,
    class: /(?:pub\s+)?struct\s+(\w+)|(?:pub\s+)?enum\s+(\w+)/g,
    interface: /(?:pub\s+)?trait\s+(\w+)/g,
    variable: /(?:pub\s+)?(?:let|const|static)\s+(?:mut\s+)?(\w+)/g,
    import: /use\s+([^;]+);/g,
    export: /pub\s+(?:fn|struct|enum|trait|type|use|mod)/g
  },
  go: {
    function: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g,
    class: /type\s+(\w+)\s+struct/g,
    interface: /type\s+(\w+)\s+interface/g,
    variable: /(?:var|const)\s+(\w+)|(\w+)\s*:=/g,
    import: /import\s+(?:\(\s*([^)]+)\s*\)|"([^"]+)")/g,
    export: /func\s+(?:[A-Z]\w*)|type\s+(?:[A-Z]\w*)/g
  }
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''

  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'r': 'r',
    'm': 'objectivec',
    'cs': 'csharp',
    'fs': 'fsharp',
    'ex': 'elixir',
    'exs': 'elixir',
    'erl': 'erlang',
    'hs': 'haskell',
    'lua': 'lua',
    'pl': 'perl',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'ps1': 'powershell',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'md': 'markdown',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile'
  }

  return langMap[ext] || 'text'
}

/**
 * Extract symbols from code
 */
export function extractSymbols(code: string, language: string): SymbolInfo[] {
  const patterns = LANGUAGE_PATTERNS[language] || LANGUAGE_PATTERNS.javascript
  const symbols: SymbolInfo[] = []

  // Extract functions
  let match
  while ((match = patterns.function.exec(code)) !== null) {
    symbols.push({
      name: match[1],
      type: 'function',
      range: { start: match.index, end: match.index + match[0].length },
      line: code.substring(0, match.index).split('\n').length,
      character: match.index - code.lastIndexOf('\n', match.index) - 1
    })
  }

  // Extract classes
  patterns.class.lastIndex = 0
  while ((match = patterns.class.exec(code)) !== null) {
    symbols.push({
      name: match[1] || match[2],
      type: 'class',
      range: { start: match.index, end: match.index + match[0].length },
      line: code.substring(0, match.index).split('\n').length,
      character: match.index - code.lastIndexOf('\n', match.index) - 1
    })
  }

  // Extract interfaces
  patterns.interface.lastIndex = 0
  while ((match = patterns.interface.exec(code)) !== null) {
    symbols.push({
      name: match[1],
      type: 'interface',
      range: { start: match.index, end: match.index + match[0].length },
      line: code.substring(0, match.index).split('\n').length,
      character: match.index - code.lastIndexOf('\n', match.index) - 1
    })
  }

  // Extract variables
  patterns.variable.lastIndex = 0
  while ((match = patterns.variable.exec(code)) !== null) {
    const name = match[1] || match[2]
    if (name) {
      symbols.push({
        name,
        type: 'variable',
        range: { start: match.index, end: match.index + match[0].length },
        line: code.substring(0, match.index).split('\n').length,
        character: match.index - code.lastIndexOf('\n', match.index) - 1
      })
    }
  }

  return symbols
}

/**
 * Extract imports from code
 */
export function extractImports(code: string, language: string): string[] {
  const patterns = LANGUAGE_PATTERNS[language] || LANGUAGE_PATTERNS.javascript
  const imports: string[] = []

  let match
  while ((match = patterns.import.exec(code)) !== null) {
    if (match[1]) imports.push(match[1])
    if (match[2]) {
      match[2].split(',').forEach((imp: string) => {
        imports.push(imp.trim())
      })
    }
  }

  return [...new Set(imports)]
}

/**
 * Build code context for AI analysis
 */
export function buildCodeContext(
  filePath: string,
  content: string,
  cursorPosition?: { line: number; character: number }
): CodeContext {
  const language = detectLanguage(filePath)
  const symbols = extractSymbols(content, language)
  const imports = extractImports(content, language)

  // Extract surrounding context around cursor
  let surroundingContext = content
  if (cursorPosition) {
    const lines = content.split('\n')
    const startLine = Math.max(0, cursorPosition.line - 10)
    const endLine = Math.min(lines.length, cursorPosition.line + 10)
    surroundingContext = lines.slice(startLine, endLine).join('\n')
  }

  return {
    filePath,
    language,
    content,
    symbols,
    imports,
    exports: [], // TODO: Implement export extraction
    surroundingContext
  }
}

/**
 * Analyze code complexity
 */
export function analyzeComplexity(code: string, language: string): number {
  let complexity = 1

  // Count control flow statements
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:]*\s*:/g, // ternary operators
    /\|\||&&/g // logical operators
  ]

  patterns.forEach(pattern => {
    const matches = code.match(pattern)
    if (matches) {
      complexity += matches.length
    }
  })

  return complexity
}

/**
 * Perform semantic analysis
 */
export function analyzeSemantics(code: string, language: string): SemanticAnalysis {
  const symbols = extractSymbols(code, language)
  const complexity = analyzeComplexity(code, language)
  const imports = extractImports(code, language)

  const functions = symbols.filter(s => s.type === 'function')
  const classes = symbols.filter(s => s.type === 'class')

  // Detect potential issues
  const potentialIssues: SemanticAnalysis['potentialIssues'] = []

  // Check for TODO/FIXME comments
  const todoMatches = code.match(/\/\/\s*(TODO|FIXME|XXX|HACK).*/gi)
  if (todoMatches) {
    todoMatches.forEach((match: string) => {
      const line = code.substring(0, code.indexOf(match)).split('\n').length
      potentialIssues.push({
        type: 'todo',
        message: match.trim(),
        line,
        severity: 'info'
      })
    })
  }

  // Check for long functions (potential complexity issue)
  functions.forEach(func => {
    const funcCode = code.substring(func.range.start, func.range.end + 500)
    const lineCount = funcCode.split('\n').length
    if (lineCount > 50) {
      potentialIssues.push({
        type: 'complexity',
        message: `Function "${func.name}" is ${lineCount} lines long. Consider refactoring.`,
        line: func.line,
        severity: 'warning'
      })
    }
  })

  return {
    complexity,
    dependencies: imports,
    functions,
    classes,
    potentialIssues
  }
}

/**
 * Get context around a specific position
 */
export function getContextAtPosition(
  code: string,
  position: { line: number; character: number },
  contextLines: number = 10
): string {
  const lines = code.split('\n')
  const startLine = Math.max(0, position.line - contextLines)
  const endLine = Math.min(lines.length, position.line + contextLines + 1)

  return lines.slice(startLine, endLine).join('\n')
}

/**
 * Find symbol at position
 */
export function findSymbolAtPosition(
  code: string,
  language: string,
  position: { line: number; character: number }
): SymbolInfo | null {
  const symbols = extractSymbols(code, language)

  // Convert position to character offset
  const lines = code.split('\n')
  let offset = 0
  for (let i = 0; i < position.line && i < lines.length; i++) {
    offset += lines[i].length + 1 // +1 for newline
  }
  offset += position.character

  // Find symbol that contains this position
  return symbols.find(symbol =>
    offset >= symbol.range.start && offset <= symbol.range.end
  ) || null
}

/**
 * Build completion context
 */
export function buildCompletionContext(
  code: string,
  cursorPosition: { line: number; character: number }
): { prefix: string; suffix: string } {
  const lines = code.split('\n')

  // Get prefix (text before cursor)
  let prefix = ''
  for (let i = 0; i < cursorPosition.line; i++) {
    prefix += lines[i] + '\n'
  }
  prefix += lines[cursorPosition.line]?.substring(0, cursorPosition.character) || ''

  // Get suffix (text after cursor)
  let suffix = ''
  const currentLine = lines[cursorPosition.line] || ''
  suffix += currentLine.substring(cursorPosition.character) + '\n'
  for (let i = cursorPosition.line + 1; i < lines.length; i++) {
    suffix += lines[i] + '\n'
  }

  return { prefix, suffix }
}

// Export all functions
export default {
  detectLanguage,
  extractSymbols,
  extractImports,
  buildCodeContext,
  analyzeComplexity,
  analyzeSemantics,
  getContextAtPosition,
  findSymbolAtPosition,
  buildCompletionContext
}
