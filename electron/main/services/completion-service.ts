/**
 * Completion Service - 智能补全服务
 * 基于代码索引和上下文提供代码补全建议
 * 参考 VS Code IntelliSense 和 Copilot 的补全机制
 */

import * as path from 'path'
import log from 'electron-log'
import { getCodeIndexService } from './code-index'

// 补全项
export interface CompletionItem {
  label: string
  kind: CompletionItemKind
  detail?: string
  documentation?: string
  insertText: string
  sortText?: string
  filterText?: string
  preselect?: boolean
  range?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

// 补全项类型
export type CompletionItemKind =
  | 'text'
  | 'method'
  | 'function'
  | 'constructor'
  | 'field'
  | 'variable'
  | 'class'
  | 'interface'
  | 'module'
  | 'property'
  | 'unit'
  | 'value'
  | 'enum'
  | 'keyword'
  | 'snippet'
  | 'color'
  | 'file'
  | 'reference'
  | 'folder'
  | 'enumMember'
  | 'constant'
  | 'struct'
  | 'event'
  | 'operator'
  | 'typeParameter'

// 补全上下文
export interface CompletionContext {
  filePath: string
  language: string
  line: number
  character: number
  prefix: string
  suffix: string
  lineContent: string
}

// 代码片段
interface CodeSnippet {
  prefix: string
  body: string
  description: string
  kind: CompletionItemKind
}

// 语言特定的代码片段
const LANGUAGE_SNIPPETS: Record<string, CodeSnippet[]> = {
  typescript: [
    { prefix: 'log', body: 'console.log($1);', description: 'Console log', kind: 'snippet' },
    { prefix: 'err', body: 'console.error($1);', description: 'Console error', kind: 'snippet' },
    { prefix: 'warn', body: 'console.warn($1);', description: 'Console warn', kind: 'snippet' },
    { prefix: 'imp', body: "import { $1 } from '$2';", description: 'Import statement', kind: 'snippet' },
    { prefix: 'exp', body: 'export { $1 };', description: 'Export statement', kind: 'snippet' },
    { prefix: 'func', body: 'function $1($2) {\n  $3\n}', description: 'Function', kind: 'snippet' },
    { prefix: 'arrow', body: 'const $1 = ($2) => {\n  $3\n};', description: 'Arrow function', kind: 'snippet' },
    { prefix: 'class', body: 'class $1 {\n  constructor($2) {\n    $3\n  }\n}', description: 'Class', kind: 'snippet' },
    { prefix: 'interface', body: 'interface $1 {\n  $2\n}', description: 'Interface', kind: 'snippet' },
    { prefix: 'type', body: 'type $1 = $2;', description: 'Type alias', kind: 'snippet' },
    { prefix: 'async', body: 'async function $1($2) {\n  $3\n}', description: 'Async function', kind: 'snippet' },
    { prefix: 'await', body: 'await $1;', description: 'Await', kind: 'snippet' },
    { prefix: 'try', body: 'try {\n  $1\n} catch (error) {\n  $2\n}', description: 'Try-catch', kind: 'snippet' },
    { prefix: 'if', body: 'if ($1) {\n  $2\n}', description: 'If statement', kind: 'snippet' },
    { prefix: 'for', body: 'for (let $1 = 0; $1 < $2; $1++) {\n  $3\n}', description: 'For loop', kind: 'snippet' },
    { prefix: 'foreach', body: '$1.forEach(($2) => {\n  $3\n});', description: 'ForEach loop', kind: 'snippet' },
    { prefix: 'map', body: '$1.map(($2) => $3);', description: 'Map', kind: 'snippet' },
    { prefix: 'filter', body: '$1.filter(($2) => $3);', description: 'Filter', kind: 'snippet' },
    { prefix: 'reduce', body: '$1.reduce(($2, $3) => $4, $5);', description: 'Reduce', kind: 'snippet' }
  ],
  javascript: [
    { prefix: 'log', body: 'console.log($1);', description: 'Console log', kind: 'snippet' },
    { prefix: 'err', body: 'console.error($1);', description: 'Console error', kind: 'snippet' },
    { prefix: 'func', body: 'function $1($2) {\n  $3\n}', description: 'Function', kind: 'snippet' },
    { prefix: 'arrow', body: 'const $1 = ($2) => {\n  $3\n};', description: 'Arrow function', kind: 'snippet' },
    { prefix: 'class', body: 'class $1 {\n  constructor($2) {\n    $3\n  }\n}', description: 'Class', kind: 'snippet' },
    { prefix: 'async', body: 'async function $1($2) {\n  $3\n}', description: 'Async function', kind: 'snippet' },
    { prefix: 'await', body: 'await $1;', description: 'Await', kind: 'snippet' },
    { prefix: 'try', body: 'try {\n  $1\n} catch (error) {\n  $2\n}', description: 'Try-catch', kind: 'snippet' },
    { prefix: 'if', body: 'if ($1) {\n  $2\n}', description: 'If statement', kind: 'snippet' },
    { prefix: 'for', body: 'for (let $1 = 0; $1 < $2; $1++) {\n  $3\n}', description: 'For loop', kind: 'snippet' }
  ],
  vue: [
    { prefix: 'template', body: '<template>\n  $1\n</template>', description: 'Template block', kind: 'snippet' },
    { prefix: 'script', body: '<script setup lang="ts">\n  $1\n</script>', description: 'Script block', kind: 'snippet' },
    { prefix: 'style', body: '<style scoped>\n  $1\n</style>', description: 'Style block', kind: 'snippet' },
    { prefix: 'ref', body: 'const $1 = ref($2);', description: 'Vue ref', kind: 'snippet' },
    { prefix: 'reactive', body: 'const $1 = reactive({\n  $2\n});', description: 'Vue reactive', kind: 'snippet' },
    { prefix: 'computed', body: 'const $1 = computed(() => {\n  $2\n});', description: 'Vue computed', kind: 'snippet' },
    { prefix: 'watch', body: 'watch($1, ($2) => {\n  $3\n});', description: 'Vue watch', kind: 'snippet' },
    { prefix: 'emit', body: 'const emit = defineEmits<{$1}>();', description: 'Define emits', kind: 'snippet' },
    { prefix: 'props', body: 'const props = defineProps<{$1}>();', description: 'Define props', kind: 'snippet' },
    { prefix: 'component', body: '<$1$2>\n  $3\n</$1>', description: 'Component', kind: 'snippet' }
  ],
  php: [
    { prefix: 'class', body: 'class $1 {\n  public function __construct($2) {\n    $3\n  }\n}', description: 'PHP Class', kind: 'snippet' },
    { prefix: 'func', body: 'function $1($2) {\n  $3\n}', description: 'Function', kind: 'snippet' },
    { prefix: 'public', body: 'public function $1($2) {\n  $3\n}', description: 'Public method', kind: 'snippet' },
    { prefix: 'private', body: 'private function $1($2) {\n  $3\n}', description: 'Private method', kind: 'snippet' },
    { prefix: 'if', body: 'if ($1) {\n  $2\n}', description: 'If statement', kind: 'snippet' },
    { prefix: 'foreach', body: 'foreach ($1 as $2) {\n  $3\n}', description: 'Foreach loop', kind: 'snippet' },
    { prefix: 'echo', body: 'echo $1;', description: 'Echo', kind: 'snippet' },
    { prefix: 'return', body: 'return $1;', description: 'Return', kind: 'snippet' }
  ],
  python: [
    { prefix: 'def', body: 'def $1($2):\n    $3', description: 'Function', kind: 'snippet' },
    { prefix: 'class', body: 'class $1:\n    def __init__(self, $2):\n        $3', description: 'Class', kind: 'snippet' },
    { prefix: 'if', body: 'if $1:\n    $2', description: 'If statement', kind: 'snippet' },
    { prefix: 'for', body: 'for $1 in $2:\n    $3', description: 'For loop', kind: 'snippet' },
    { prefix: 'print', body: 'print($1)', description: 'Print', kind: 'snippet' },
    { prefix: 'return', body: 'return $1', description: 'Return', kind: 'snippet' },
    { prefix: 'import', body: 'import $1', description: 'Import', kind: 'snippet' },
    { prefix: 'from', body: 'from $1 import $2', description: 'From import', kind: 'snippet' }
  ]
}

// 通用代码片段
const COMMON_SNIPPETS: CodeSnippet[] = [
  { prefix: 'todo', body: '// TODO: $1', description: 'TODO comment', kind: 'snippet' },
  { prefix: 'fixme', body: '// FIXME: $1', description: 'FIXME comment', kind: 'snippet' },
  { prefix: 'note', body: '// NOTE: $1', description: 'NOTE comment', kind: 'snippet' }
]

/**
 * 获取补全建议
 */
export async function getCompletions(
  projectPath: string,
  context: CompletionContext
): Promise<CompletionItem[]> {
  const completions: CompletionItem[] = []
  
  try {
    // 1. 添加代码片段补全
    const snippetCompletions = getSnippetCompletions(context)
    completions.push(...snippetCompletions)
    
    // 2. 添加符号补全（基于代码索引）
    const symbolCompletions = await getSymbolCompletions(projectPath, context)
    completions.push(...symbolCompletions)
    
    // 3. 添加文件路径补全
    const fileCompletions = await getFileCompletions(projectPath, context)
    completions.push(...fileCompletions)
    
  } catch (error) {
    log.error('[CompletionService] Failed to get completions:', error)
  }
  
  // 去重并排序
  const uniqueCompletions = deduplicateCompletions(completions)
  return sortCompletions(uniqueCompletions, context.prefix)
}

/**
 * 获取代码片段补全
 */
function getSnippetCompletions(context: CompletionContext): CompletionItem[] {
  const completions: CompletionItem[] = []
  const prefix = context.prefix.toLowerCase()
  
  // 获取语言特定的代码片段
  const languageSnippets = LANGUAGE_SNIPPETS[context.language] || []
  const allSnippets = [...COMMON_SNIPPETS, ...languageSnippets]
  
  for (const snippet of allSnippets) {
    if (snippet.prefix.toLowerCase().startsWith(prefix) || prefix === '') {
      completions.push({
        label: snippet.prefix,
        kind: snippet.kind,
        detail: snippet.description,
        documentation: snippet.body,
        insertText: snippet.body,
        sortText: `0_${snippet.prefix}`,
        preselect: snippet.prefix === prefix
      })
    }
  }
  
  return completions
}

/**
 * 获取符号补全
 */
async function getSymbolCompletions(
  projectPath: string,
  context: CompletionContext
): Promise<CompletionItem[]> {
  const completions: CompletionItem[] = []
  const prefix = context.prefix.toLowerCase()
  
  if (prefix.length < 2) {
    return completions  // 前缀太短，不搜索符号
  }
  
  try {
    const codeIndex = getCodeIndexService(projectPath)
    await codeIndex.initialize()
    
    const symbols = codeIndex.searchSymbols(prefix)
    
    for (const symbol of symbols.slice(0, 20)) {
      const kind = mapSymbolTypeToKind(symbol.type)
      
      completions.push({
        label: symbol.name,
        kind,
        detail: `${symbol.type} in ${path.basename(symbol.filePath)}`,
        documentation: symbol.signature || symbol.docstring,
        insertText: symbol.name,
        sortText: `1_${symbol.name}`,
        filterText: symbol.name.toLowerCase()
      })
    }
    
  } catch (error) {
    log.warn('[CompletionService] Failed to get symbol completions:', error)
  }
  
  return completions
}

/**
 * 获取文件路径补全
 */
async function getFileCompletions(
  projectPath: string,
  context: CompletionContext
): Promise<CompletionItem[]> {
  const completions: CompletionItem[] = []
  const lineContent = context.lineContent
  
  // 检测是否在导入语句中
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]*)$/
  const requireRegex = /require\s*\(\s*['"]([^'"]*)$/
  
  const importMatch = lineContent.match(importRegex)
  const requireMatch = lineContent.match(requireRegex)
  
  if (importMatch || requireMatch) {
    const partialPath = (importMatch || requireMatch)![1]
    
    // 这里可以添加文件路径补全逻辑
    // 简化版本：添加常见的导入路径
    const commonPaths = ['.', '..', './components', './utils', './services', './types']
    
    for (const p of commonPaths) {
      if (p.startsWith(partialPath)) {
        completions.push({
          label: p,
          kind: 'folder',
          detail: 'Path',
          insertText: p,
          sortText: `2_${p}`
        })
      }
    }
  }
  
  return completions
}

/**
 * 将符号类型映射到补全类型
 */
function mapSymbolTypeToKind(type: string): CompletionItemKind {
  const kindMap: Record<string, CompletionItemKind> = {
    'function': 'function',
    'class': 'class',
    'interface': 'interface',
    'variable': 'variable',
    'import': 'module',
    'export': 'module'
  }
  
  return kindMap[type] || 'text'
}

/**
 * 去重补全项
 */
function deduplicateCompletions(completions: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>()
  return completions.filter(item => {
    const key = `${item.label}_${item.kind}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * 排序补全项
 */
function sortCompletions(
  completions: CompletionItem[],
  prefix: string
): CompletionItem[] {
  const lowerPrefix = prefix.toLowerCase()
  
  return completions.sort((a, b) => {
    // 优先显示完全匹配的
    const aExact = a.label.toLowerCase() === lowerPrefix
    const bExact = b.label.toLowerCase() === lowerPrefix
    
    if (aExact && !bExact) return -1
    if (bExact && !aExact) return 1
    
    // 然后按 sortText 排序
    return (a.sortText || a.label).localeCompare(b.sortText || b.label)
  })
}

/**
 * 获取当前单词范围
 */
export function getWordRange(
  lineContent: string,
  character: number
): { start: number; end: number } {
  // 找到单词的开始和结束位置
  const wordRegex = /[\w$]+/g
  let match
  
  while ((match = wordRegex.exec(lineContent)) !== null) {
    const start = match.index
    const end = start + match[0].length
    
    if (start <= character && character <= end) {
      return { start, end }
    }
  }
  
  return { start: character, end: character }
}

/**
 * 检查是否应该触发补全
 */
export function shouldTriggerCompletion(
  lineContent: string,
  character: number
): boolean {
  // 在以下字符后触发补全
  const triggerChars = ['.', ':', '>', '@', '/']
  const char = lineContent[character - 1]
  
  if (triggerChars.includes(char)) {
    return true
  }
  
  // 在单词中触发
  const wordRegex = /[\w$]/
  if (wordRegex.test(char || '')) {
    return true
  }
  
  return false
}
