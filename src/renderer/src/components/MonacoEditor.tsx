import { useRef, useEffect, useCallback } from 'react'
import Editor, { OnMount, OnChange, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Configure Monaco to use local resources instead of CDN
loader.config({ monaco })

interface MonacoEditorProps {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
  onSave?: () => void
  theme?: string
  onCursorPositionChange?: (position: { line: number; column: number }) => void
}

function MonacoEditor({ 
  value, 
  language, 
  onChange, 
  readOnly = false,
  onSave,
  theme = 'vs-dark',
  onCursorPositionChange
}: MonacoEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<string[]>([])

  // Handle editor mount
  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Set up keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
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
  }, [onSave, onCursorPositionChange])

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

  // Map language aliases
  const getMonacoLanguage = useCallback((lang: string): string => {
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'yml': 'yaml',
      'md': 'markdown',
      'cpp': 'cpp',
      'cxx': 'cpp',
      'cc': 'cpp',
      'hpp': 'cpp',
      'h': 'c',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'kt': 'kotlin',
      'cs': 'csharp',
      'php': 'php',
      'sql': 'sql',
      'xml': 'xml',
      'svg': 'xml',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'toml': 'ini',
      'ini': 'ini',
      'conf': 'ini',
      'txt': 'plaintext',
      'text': 'plaintext',
      'vue': 'html',
      'svelte': 'html',
    }
    return langMap[lang.toLowerCase()] || lang.toLowerCase()
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
