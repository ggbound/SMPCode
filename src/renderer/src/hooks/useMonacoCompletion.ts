/**
 * useMonacoCompletion - Monaco 编辑器智能补全 Hook
 * 集成代码索引和代码片段提供补全建议
 */

import { useEffect, useRef, useCallback } from 'react'
import * as monaco from 'monaco-editor'

interface CompletionItem {
  label: string
  kind: monaco.languages.CompletionItemKind
  detail?: string
  documentation?: string
  insertText: string
  sortText?: string
}

export function useMonacoCompletion(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  projectPath: string | null
) {
  const completionProviderRef = useRef<monaco.IDisposable | null>(null)

  // 获取补全建议
  const getCompletions = useCallback(async (
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.CompletionList> => {
    if (!window.api?.completion || !projectPath) {
      return { suggestions: [] }
    }

    try {
      const lineContent = model.getLineContent(position.lineNumber)
      const word = model.getWordUntilPosition(position)
      const prefix = lineContent.slice(0, position.column - 1)
      const language = model.getLanguageId()

      const result = await window.api.completion.get(projectPath, {
        filePath: model.uri.path,
        language,
        line: position.lineNumber,
        character: position.column,
        prefix: word.word,
        suffix: '',
        lineContent: prefix
      })

      if (!result.success || !result.completions) {
        return { suggestions: [] }
      }

      // 转换补全项
      const suggestions: monaco.languages.CompletionItem[] = result.completions.map((item: any, index: number) => ({
        label: item.label,
        kind: mapCompletionKind(item.kind),
        detail: item.detail,
        documentation: item.documentation,
        insertText: item.insertText,
        sortText: item.sortText || String(index).padStart(3, '0'),
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        }
      }))

      return { suggestions }
    } catch (error) {
      console.error('Failed to get completions:', error)
      return { suggestions: [] }
    }
  }, [projectPath])

  // 映射补全类型
  const mapCompletionKind = (kind: string): monaco.languages.CompletionItemKind => {
    const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
      'text': monaco.languages.CompletionItemKind.Text,
      'method': monaco.languages.CompletionItemKind.Method,
      'function': monaco.languages.CompletionItemKind.Function,
      'constructor': monaco.languages.CompletionItemKind.Constructor,
      'field': monaco.languages.CompletionItemKind.Field,
      'variable': monaco.languages.CompletionItemKind.Variable,
      'class': monaco.languages.CompletionItemKind.Class,
      'interface': monaco.languages.CompletionItemKind.Interface,
      'module': monaco.languages.CompletionItemKind.Module,
      'property': monaco.languages.CompletionItemKind.Property,
      'unit': monaco.languages.CompletionItemKind.Unit,
      'value': monaco.languages.CompletionItemKind.Value,
      'enum': monaco.languages.CompletionItemKind.Enum,
      'keyword': monaco.languages.CompletionItemKind.Keyword,
      'snippet': monaco.languages.CompletionItemKind.Snippet,
      'color': monaco.languages.CompletionItemKind.Color,
      'file': monaco.languages.CompletionItemKind.File,
      'reference': monaco.languages.CompletionItemKind.Reference,
      'folder': monaco.languages.CompletionItemKind.Folder,
      'enumMember': monaco.languages.CompletionItemKind.EnumMember,
      'constant': monaco.languages.CompletionItemKind.Constant,
      'struct': monaco.languages.CompletionItemKind.Struct,
      'event': monaco.languages.CompletionItemKind.Event,
      'operator': monaco.languages.CompletionItemKind.Operator,
      'typeParameter': monaco.languages.CompletionItemKind.TypeParameter
    }
    return kindMap[kind] || monaco.languages.CompletionItemKind.Text
  }

  // 注册补全提供程序
  useEffect(() => {
    if (!editor) return

    // 为 TypeScript/JavaScript 注册补全
    const languages = ['typescript', 'javascript', 'vue', 'php', 'python']
    
    languages.forEach(lang => {
      const provider = monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', ':', '>', '@', '/'],
        provideCompletionItems: async (model, position) => {
          return await getCompletions(model, position)
        }
      })
      
      if (!completionProviderRef.current) {
        completionProviderRef.current = provider
      }
    })

    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose()
        completionProviderRef.current = null
      }
    }
  }, [editor, getCompletions])

  // 添加快捷键
  useEffect(() => {
    if (!editor) return

    // Ctrl+Space 触发补全
    const disposable = editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
      () => {
        editor.trigger('keyboard', 'editor.action.triggerSuggest', {})
      }
    ) as string | undefined

    return () => {
      if (disposable && typeof disposable === 'object' && 'dispose' in disposable) {
        (disposable as { dispose: () => void }).dispose()
      }
    }
  }, [editor])
}

export default useMonacoCompletion
