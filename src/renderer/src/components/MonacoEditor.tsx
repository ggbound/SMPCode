import { useRef, useEffect, useCallback } from 'react'
import Editor, { OnMount, OnChange, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { EXTENSION_TO_LANGUAGE } from '../utils/languageMap'

// Configure Monaco to load from CDN (required for proper worker support in Electron)
// This ensures workers are loaded correctly from CDN URLs
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs'
  },
  // Load additional language support from CDN
  'vs/nls': {
    availableLanguages: {
      '*': 'zh-cn'
    }
  }
})

// Initialize Vue language support before Monaco loads
// This ensures the language is registered when the editor initializes
loader.init().then((monacoInstance) => {
  console.log('[MonacoEditor] Monaco initialized, available languages:', 
    monacoInstance.languages.getLanguages().map((l: any) => l.id).join(', '))
  registerVueLanguage(monacoInstance)
  console.log('[MonacoEditor] Vue language registered')
})

// Register Vue language support
function registerVueLanguage(monacoInstance: typeof monaco) {
  // Register Vue as a language
  monacoInstance.languages.register({
    id: 'vue',
    extensions: ['.vue'],
    aliases: ['Vue', 'vue'],
    mimetypes: ['text/x-vue'],
  })

  // Set language configuration
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

  // Use HTML tokenizer as base for Vue
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

interface MonacoEditorProps {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
  onSave?: () => void
  theme?: string
  onCursorPositionChange?: (position: { line: number; column: number }) => void
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

function MonacoEditor({ 
  value, 
  language, 
  onChange, 
  readOnly = false,
  onSave,
  theme = 'vs-dark',
  onCursorPositionChange,
  onMount
}: MonacoEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<string[]>([])

  // Handle editor mount
  const handleEditorDidMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor
    
    // Notify parent component
    onMount?.(editor)

    // Register Vue language support
    registerVueLanguage(monacoInstance)

    // Set up keyboard shortcuts
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      onSave?.()
    })

    // Listen to cursor position changes
    if (onCursorPositionChange) {
      editor.onDidChangeCursorPosition((e) => {
        onCursorPositionChange({
          line: e.position.lineNumber,
          column: e.position.column
        })
      })
    }

    // Focus editor
    editor.focus()
  }, [onSave, onCursorPositionChange, onMount])

  // Handle content change
  const handleEditorChange: OnChange = useCallback((value) => {
    onChange?.(value || '')
  }, [onChange])

  // Update value when it changes externally
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue()
      if (value !== currentValue) {
        editorRef.current.setValue(value)
      }
    }
  }, [value])

  // Map language aliases (using unified language map)
  const getMonacoLanguage = useCallback((lang: string): string => {
    console.log('[MonacoEditor] Input language:', lang)
    
    // First check if it's a file extension
    const langLower = lang.toLowerCase()
    const extMapping = EXTENSION_TO_LANGUAGE[langLower]
    if (extMapping) {
      console.log('[MonacoEditor] Mapped from extension:', langLower, '->', extMapping)
      return extMapping
    }
    
    // Check if it's already a valid Monaco language
    // Monaco supports: javascript, typescript, python, java, cpp, csharp, go, rust, ruby, php, sql, html, css, json, xml, yaml, markdown, shell, powershell, etc.
    const validLanguages = [
      'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
      'go', 'rust', 'ruby', 'php', 'sql', 'html', 'css', 'scss', 'less',
      'json', 'xml', 'yaml', 'markdown', 'shell', 'powershell', 'vue',
      'plaintext', 'ini', 'dockerfile', 'makefile', 'cmake', 'graphql', 'perl'
    ]
    
    if (validLanguages.includes(langLower)) {
      console.log('[MonacoEditor] Using language as-is:', langLower)
      return langLower
    }
    
    // Fallback to plaintext
    console.log('[MonacoEditor] Unknown language, falling back to plaintext:', lang)
    return 'plaintext'
  }, [])

  // Editor options
  const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    readOnly,
    minimap: { enabled: true },
    fontSize: 13,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    folding: true,
    foldingStrategy: 'indentation',
    showFoldingControls: 'mouseover',
    bracketPairColorization: { enabled: true },
    guides: {
      bracketPairs: true,
      indentation: true,
    },
    padding: { top: 10, bottom: 10 },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    contextmenu: true,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    wordBasedSuggestions: 'currentDocument',
    parameterHints: { enabled: true },
    autoIndent: 'full',
    formatOnPaste: true,
    formatOnType: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
  }

  return (
    <Editor
      height="100%"
      language={getMonacoLanguage(language)}
      value={value}
      theme={theme}
      onChange={handleEditorChange}
      onMount={handleEditorDidMount}
      options={editorOptions}
      loading={<div className="editor-loading">Loading editor...</div>}
    />
  )
}

export default MonacoEditor
