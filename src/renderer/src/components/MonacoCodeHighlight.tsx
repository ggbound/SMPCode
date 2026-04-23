/**
 * Monaco-based Code Highlighting Component
 * 
 * Uses Monaco Editor's tokenization system for consistent highlighting
 * with the main editor. This mimics VSCode's internal highlighting.
 */

import { useRef, useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { getLanguageFromPath, LANGUAGE_TO_LABEL } from '../utils/languageMap'

// Fix web worker issues - completely disable workers for read-only highlighting
// This prevents MIME type errors and worker loading issues
// Must be set before any monaco operations
if (typeof window !== 'undefined') {
  (window as any).MonacoEnvironment = {
    getWorkerUrl: function () {
      return ''
    }
  }
}

// Set default theme
monaco.editor.setTheme('vs-dark')

interface MonacoCodeHighlightProps {
  code: string
  language?: string
  filePath?: string
  showLineNumbers?: boolean
  maxHeight?: number
  theme?: 'vs-dark' | 'vs' | 'hc-black'
}

// Initialize Vue language support
const initVueLanguage = (monacoInstance: typeof monaco) => {
  // Skip if already registered
  if (monacoInstance.languages.getLanguages().some(lang => lang.id === 'vue')) {
    return
  }

  monacoInstance.languages.register({
    id: 'vue',
    extensions: ['.vue'],
    aliases: ['Vue', 'vue'],
    mimetypes: ['text/x-vue'],
  })

  monacoInstance.languages.setLanguageConfiguration('vue', {
    wordPattern: /(-?\d*\.?\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    brackets: [
      ['<!--', '-->'],
      ['<', '>'],
      ['{{', '}}'],
      ['{', '}'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '<', close: '>' },
    ],
  })

  // Vue Monarch tokenizer - similar to MonacoEditor.tsx
  monacoInstance.languages.setMonarchTokensProvider('vue', {
    defaultToken: '',
    tokenPostfix: '.vue',
    tokenizer: {
      root: [
        [/<!DOCTYPE/, 'metatag', '@doctype'],
        [/<!--/, 'comment', '@comment'],
        [/<script\s+setup/, { token: 'tag.tag-id', next: '@scriptTS', nextEmbedded: 'typescript' }],
        [/<script\s+lang=["']ts["']/, { token: 'tag.tag-id', next: '@scriptTS', nextEmbedded: 'typescript' }],
        [/<script/, { token: 'tag.tag-id', next: '@script', nextEmbedded: 'javascript' }],
        [/<style\s+scoped/, { token: 'tag.tag-id', next: '@style', nextEmbedded: 'css' }],
        [/<style/, { token: 'tag.tag-id', next: '@style', nextEmbedded: 'css' }],
        [/<template/, { token: 'tag.tag-id', next: '@template' }],
        [/(<)([\w\-:]+)/, [{ token: 'delimiter.tag' }, { token: 'tag.tag-id', next: '@tag' }]],
        [/(<\/)([\w\-:]+)(>)/, [{ token: 'delimiter.tag' }, { token: 'tag.tag-id' }, { token: 'delimiter.tag' }]],
        [/[^<{]+/, ''],
      ],
      doctype: [
        [/[^>]+/, 'metatag.content'],
        [/>/, 'metatag', '@pop'],
      ],
      comment: [
        [/-->/, 'comment', '@pop'],
        [/[^-]+/, 'comment.content'],
        [/./, 'comment.content'],
      ],
      tag: [
        [/\s+/, 'white'],
        [/(v-[\w\-]+|@\w+|:\w+)(=)(["'])/, ['keyword', 'delimiter', { token: 'string', next: '@string' }]],
        [/[\w\-]+(?=\s*=)/, 'attribute.name'],
        [/=/, 'delimiter'],
        [/["']/, { token: 'string', next: '@string' }],
        [/>/, { token: 'delimiter.tag', next: '@pop' }],
        [/\/>/, { token: 'delimiter.tag', next: '@pop' }],
      ],
      string: [
        [/[^"'{{]+/, 'string'],
        [/{{/, { token: 'delimiter.bracket', next: '@vueExpression' }],
        [/["']/, { token: 'string', next: '@pop' }],
      ],
      vueExpression: [
        [/}}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/[a-zA-Z_$][\w$]*/, 'identifier'],
        [/[0-9]+/, 'number'],
        [/["'][^"']*["']/, 'string'],
        [/[+\-*/=<>!]+/, 'operator'],
        [/\s+/, 'white'],
        [/./, ''],
      ],
      template: [
        [/>/, { token: 'delimiter.tag', next: '@templateContent' }],
        { include: '@tag' },
      ],
      templateContent: [
        [/<\/template>/, { token: 'tag.tag-id', next: '@popall' }],
        [/{{/, { token: 'delimiter.bracket', next: '@vueExpression' }],
        [/<[\w\-:]+/, { token: 'tag.tag-id', next: '@templateTag' }],
        [/<\/[\w\-:]+>/, 'tag.tag-id'],
        [/[^<{]+/, 'content'],
      ],
      templateTag: [
        [/>/, { token: 'delimiter.tag', next: '@pop' }],
        { include: '@tag' },
      ],
      script: [
        [/<\/script>/, { token: 'tag.tag-id', next: '@popall' }],
        [/[^<]+/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      ],
      scriptTS: [
        [/<\/script>/, { token: 'tag.tag-id', next: '@popall' }],
        [/[^<]+/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      ],
      style: [
        [/<\/style>/, { token: 'tag.tag-id', next: '@popall' }],
        [/[^<]+/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
      ],
    },
  })
}

// Initialize language support once
let languagesInitialized = false

export function MonacoCodeHighlight({
  code,
  language,
  filePath,
  showLineNumbers = true,
  maxHeight = 400,
  theme = 'vs-dark'
}: MonacoCodeHighlightProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const lines = code.split('\n')
  const hasOverflow = lines.length > 20 || code.length > 1000

  // Determine language
  const detectedLanguage = filePath 
    ? getLanguageFromPath(filePath) 
    : language || 'plaintext'

  const displayLanguage = LANGUAGE_TO_LABEL[detectedLanguage] || detectedLanguage.toUpperCase()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Initialize Monaco editor for highlighting
  useEffect(() => {
    if (!containerRef.current) return

    // Initialize Vue language support
    if (!languagesInitialized) {
      initVueLanguage(monaco)
      languagesInitialized = true
    }

    // Create editor instance
    const editor = monaco.editor.create(containerRef.current, {
      value: code,
      language: detectedLanguage,
      theme: theme,
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: showLineNumbers ? 'on' : 'off',
      renderLineHighlight: 'none',
      folding: false,
      glyphMargin: false,
      contextmenu: false,
      quickSuggestions: false,
      parameterHints: { enabled: false },
      autoClosingBrackets: 'never',
      autoClosingQuotes: 'never',
      formatOnPaste: false,
      formatOnType: false,
      wordWrap: 'on',
      fontSize: 13,
      lineHeight: 22,
      padding: { top: 12, bottom: 12 },
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
    }
  }, [code, detectedLanguage, theme, showLineNumbers])

  // Update content when code changes
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue()
      if (currentValue !== code) {
        editorRef.current.setValue(code)
      }
    }
  }, [code])

  // Update language when it changes
  useEffect(() => {
    if (editorRef.current && detectedLanguage) {
      const model = editorRef.current.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, detectedLanguage)
      }
    }
  }, [detectedLanguage])

  return (
    <div className="code-block-container">
      {/* 头部 */}
      <div className="code-block-header">
        <div className="code-block-meta">
          <span className="code-block-language">{displayLanguage}</span>
          {filePath && (
            <span className="code-block-filepath">{filePath}</span>
          )}
        </div>
        <div className="code-block-actions">
          {hasOverflow && (
            <button 
              className="code-block-action-btn"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? '收起' : '展开'}
            </button>
          )}
          <button 
            className="code-block-action-btn"
            onClick={handleCopy}
          >
            {isCopied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>已复制</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* 代码内容 */}
      <div 
        className="code-block-content"
        style={{ 
          maxHeight: isExpanded ? 'none' : `${maxHeight}px`,
          overflow: isExpanded ? 'auto' : 'hidden'
        }}
      >
        <div ref={containerRef} />
      </div>
      
      {/* 展开遮罩 */}
      {!isExpanded && hasOverflow && (
        <div className="code-block-expand-mask">
          <button 
            className="code-block-expand-btn"
            onClick={() => setIsExpanded(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <span>展开全部</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default MonacoCodeHighlight
