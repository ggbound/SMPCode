/**
 * Shiki 语法高亮引擎
 * 使用与 VSCode 相同的 TextMate 语法，提供完美的高亮效果
 */

import {
  createHighlighter,
  HighlighterGeneric,
  BundledLanguage,
  BundledTheme
} from 'shiki'

// VSCode Dark+ 主题等效的 Shiki 主题
const VSCODE_DARK_THEME = 'github-dark'

// 语言映射 - 将 Monarch 语言 ID 映射到 Shiki 语言 ID
const LANGUAGE_MAP: Record<string, any> = {
  'javascript': 'javascript',
  'js': 'javascript',
  'typescript': 'typescript',
  'ts': 'typescript',
  'jsx': 'javascript',
  'tsx': 'typescript',
  'python': 'python',
  'py': 'python',
  'java': 'java',
  'c': 'c',
  'cpp': 'cpp',
  'csharp': 'csharp',
  'cs': 'csharp',
  'go': 'go',
  'rust': 'rust',
  'ruby': 'ruby',
  'rb': 'ruby',
  'php': 'php',
  'swift': 'swift',
  'kotlin': 'kotlin',
  'kt': 'kotlin',
  'scala': 'scala',
  'dart': 'dart',
  'html': 'html',
  'xml': 'xml',
  'css': 'css',
  'scss': 'scss',
  'sass': 'sass',
  'less': 'less',
  'stylus': 'stylus',
  'json': 'json',
  'yaml': 'yaml',
  'yml': 'yaml',
  'toml': 'toml',
  'markdown': 'markdown',
  'md': 'markdown',
  'bash': 'bash',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'powershell': 'powershell',
  'ps': 'powershell',
  'sql': 'sql',
  'dockerfile': 'dockerfile',
  'docker': 'dockerfile',
  'makefile': 'makefile',
  'make': 'makefile',
  'cmake': 'cmake',
  'vue': 'vue',
  'svelte': 'svelte',
  'r': 'r',
  'lua': 'lua',
  'perl': 'perl',
  'pl': 'perl',
  'haskell': 'haskell',
  'hs': 'haskell',
  'clojure': 'clojure',
  'clj': 'clojure',
  'elixir': 'elixir',
  'ex': 'elixir',
  'elm': 'elm',
  'erlang': 'erlang',
  'fsharp': 'fsharp',
  'fs': 'fsharp',
  'groovy': 'groovy',
  'graphql': 'graphql',
  'gql': 'graphql',
  'ini': 'ini',
  'properties': 'properties',
  'conf': 'ini',
  'latex': 'latex',
  'tex': 'latex',
  'matlab': 'matlab',
  'objc': 'objective-c',
  'objective-c': 'objective-c',
  'objc++': 'objective-cpp',
  'objective-cpp': 'objective-cpp',
  'pascal': 'pascal',
  'proto': 'protobuf',
  'protobuf': 'protobuf',
  'raku': 'raku',
  'rakudo': 'raku',
  'razor': 'razor',
  'sas': 'sas',
  'shaderlab': 'shaderlab',
  'solidity': 'solidity',
  'sparql': 'sparql',
  'stata': 'stata',
  'system-verilog': 'system-verilog',
  'tcl': 'tcl',
  'vb': 'vb',
  'verilog': 'verilog',
  'vhdl': 'vhdl',
  'viml': 'viml',
  'vim': 'viml',
  'vue-html': 'vue-html',
  'wgsl': 'wgsl',
  'wenyan': 'wenyan',
  'wenyan-lang': 'wenyan',
  'text': 'plaintext',
  'txt': 'plaintext'
}

let highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null = null
let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null

/**
 * 初始化 Shiki 高亮器
 */
export async function initHighlighter(): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
  if (highlighter) {
    return highlighter
  }

  if (highlighterPromise) {
    return highlighterPromise
  }

  highlighterPromise = createHighlighter({
    themes: [VSCODE_DARK_THEME],
    langs: [
      'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
      'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'dart',
      'html', 'xml', 'css', 'scss', 'sass', 'less', 'stylus',
      'json', 'yaml', 'toml', 'markdown', 'bash', 'powershell',
      'sql', 'dockerfile', 'makefile', 'cmake', 'vue', 'svelte',
      'r', 'lua', 'perl', 'haskell', 'clojure', 'elixir', 'elm',
      'erlang', 'fsharp', 'groovy', 'graphql', 'ini', 'latex',
      'matlab', 'objective-c', 'objective-cpp', 'pascal', 'protobuf',
      'raku', 'razor', 'registry', 'sas', 'shaderlab', 'solidity',
      'sparql', 'stata', 'system-verilog', 'tcl', 'tex', 'vb',
      'verilog', 'vhdl', 'viml', 'vue-html', 'wgsl', 'wenyan',
      'plaintext'
    ],
  })

  highlighter = await highlighterPromise
  return highlighter
}

/**
 * 标准化语言名称
 */
export function normalizeLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim()
  return LANGUAGE_MAP[normalized] || 'plaintext'
}

/**
 * 高亮代码
 * @param code 要高亮的代码
 * @param language 语言名称
 * @returns HTML 字符串
 */
export async function highlightCode(code: string, language: string): Promise<string> {
  const normalizedLang = normalizeLanguage(language)
  const hl = await initHighlighter()
  
  try {
    return hl.codeToHtml(code, {
      lang: normalizedLang as BundledLanguage,
      theme: VSCODE_DARK_THEME,
    })
  } catch (error) {
    console.warn(`[Shiki] Failed to highlight ${language}, falling back to plaintext:`, error)
    // 降级到纯文本
    return hl.codeToHtml(code, {
      lang: 'plaintext',
      theme: VSCODE_DARK_THEME,
    })
  }
}

/**
 * 获取高亮器的 token 数组（用于自定义渲染）
 */
export async function getHighlightedTokens(code: string, language: string) {
  const normalizedLang = normalizeLanguage(language)
  const hl = await initHighlighter()
  
  try {
    return hl.codeToTokens(code, {
      lang: normalizedLang as BundledLanguage,
      theme: VSCODE_DARK_THEME,
    })
  } catch (error) {
    console.warn(`[Shiki] Failed to get tokens for ${language}:`, error)
    return hl.codeToTokens(code, {
      lang: 'plaintext',
      theme: VSCODE_DARK_THEME,
    })
  }
}

/**
 * 动态加载额外的语言
 */
export async function loadLanguage(lang: BundledLanguage): Promise<void> {
  const hl = await initHighlighter()
  if (!hl.getLoadedLanguages().includes(lang)) {
    await hl.loadLanguage(lang)
  }
}

/**
 * 销毁高亮器（释放内存）
 */
export function disposeHighlighter(): void {
  if (highlighter) {
    highlighter.dispose()
    highlighter = null
    highlighterPromise = null
  }
}
