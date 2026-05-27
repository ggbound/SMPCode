/**
 * useMonacoLSP - Monaco Editor LSP 集成 Hook
 * 将 LSP 功能集成到 Monaco Editor
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type * as monaco from 'monaco-editor'
import { LSPManager, DefaultLanguageServers } from '../services/lsp/lsp-manager'
import { LSPClient } from '../services/lsp/lsp-client'
import { getLanguageFromPath } from '../utils/languageMap'

export interface UseMonacoLSPOptions {
  editor: monaco.editor.IStandaloneCodeEditor | null
  model: monaco.editor.ITextModel | null
  projectPath: string | null
  enabled?: boolean
}

export interface UseMonacoLSPReturn {
  isReady: boolean
  isInitialized: boolean
  supportedFeatures: string[]
  goToDefinition: () => Promise<void>
  findReferences: () => Promise<void>
  renameSymbol: () => Promise<void>
  formatDocument: () => Promise<void>
  getDiagnostics: () => Diagnostic[]
}

interface Diagnostic {
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  code?: string
  source?: string
}

/**
 * Monaco Editor LSP 集成 Hook
 */
export function useMonacoLSP(options: UseMonacoLSPOptions): UseMonacoLSPReturn {
  const { editor, model, projectPath, enabled = true } = options

  const lspManagerRef = useRef<LSPManager | null>(null)
  const currentClientRef = useRef<LSPClient | null>(null)
  const decorationsRef = useRef<string[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [supportedFeatures, setSupportedFeatures] = useState<string[]>([])

  // 初始化 LSP 管理器
  useEffect(() => {
    if (!enabled || !projectPath) return

    const manager = new LSPManager()
    lspManagerRef.current = manager

    // 注册默认语言服务器
    DefaultLanguageServers.forEach(config => {
      manager.registerServer(config)
    })

    // 启动所有服务器
    manager.startAll(projectPath).then(() => {
      setIsReady(true)
      console.log('[useMonacoLSP] LSP Manager initialized')
    })

    // 监听诊断信息
    manager.onDiagnostics((event) => {
      handleDiagnostics(event)
    })

    return () => {
      manager.dispose()
      lspManagerRef.current = null
      setIsReady(false)
      setIsInitialized(false)
    }
  }, [enabled, projectPath])

  // 处理诊断信息
  const handleDiagnostics = useCallback((event: { uri: string; diagnostics: any[] }) => {
    if (!model) return

    const modelUri = model.uri.toString()
    if (event.uri !== modelUri) return

    const mappedDiagnostics: Diagnostic[] = event.diagnostics.map(d => ({
      message: d.message,
      severity: mapDiagnosticSeverity(d.severity),
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      code: d.code?.toString(),
      source: d.source
    }))

    setDiagnostics(mappedDiagnostics)
    updateDecorations(mappedDiagnostics)
  }, [model])

  // 映射诊断严重级别
  const mapDiagnosticSeverity = (severity?: number): 'error' | 'warning' | 'info' | 'hint' => {
    switch (severity) {
      case 1: return 'error'
      case 2: return 'warning'
      case 3: return 'info'
      case 4: return 'hint'
      default: return 'error'
    }
  }

  // 更新 Monaco 装饰
  const updateDecorations = useCallback((diags: Diagnostic[]) => {
    if (!editor) return

    // 清除旧装饰
    if (decorationsRef.current.length > 0) {
      editor.deltaDecorations(decorationsRef.current, [])
    }

    // 添加新装饰
    const newDecorations = diags.map(d => ({
      range: new monaco.Range(
        d.startLineNumber,
        d.startColumn,
        d.endLineNumber,
        d.endColumn
      ),
      options: {
        isWholeLine: false,
        className: getDiagnosticClassName(d.severity),
        hoverMessage: { value: d.message },
        overviewRuler: {
          color: getDiagnosticColor(d.severity),
          position: monaco.editor.OverviewRulerLane.Right
        },
        minimap: {
          color: getDiagnosticColor(d.severity),
          position: monaco.editor.MinimapPosition.Inline
        }
      }
    }))

    decorationsRef.current = editor.deltaDecorations([], newDecorations)
  }, [editor])

  // 获取诊断样式类
  const getDiagnosticClassName = (severity: string): string => {
    switch (severity) {
      case 'error': return 'lsp-diagnostic-error'
      case 'warning': return 'lsp-diagnostic-warning'
      case 'info': return 'lsp-diagnostic-info'
      case 'hint': return 'lsp-diagnostic-hint'
      default: return 'lsp-diagnostic-error'
    }
  }

  // 获取诊断颜色
  const getDiagnosticColor = (severity: string): string => {
    switch (severity) {
      case 'error': return '#ff0000'
      case 'warning': return '#ffcc00'
      case 'info': return '#0066cc'
      case 'hint': return '#00cc66'
      default: return '#ff0000'
    }
  }

  // 更新当前客户端
  useEffect(() => {
    if (!isReady || !model) {
      currentClientRef.current = null
      setIsInitialized(false)
      return
    }

    const languageId = getLanguageFromPath(model.uri.path)
    const servers = lspManagerRef.current?.getServersForLanguage(languageId)

    if (servers && servers.length > 0) {
      const client = servers[0].client
      currentClientRef.current = client
      setIsInitialized(servers[0].isInitialized)

      // 获取支持的功能
      const capabilities = client.getServerCapabilities()
      if (capabilities) {
        const features: string[] = []
        if (capabilities.completionProvider) features.push('completion')
        if (capabilities.hoverProvider) features.push('hover')
        if (capabilities.definitionProvider) features.push('definition')
        if (capabilities.referencesProvider) features.push('references')
        if (capabilities.documentFormattingProvider) features.push('formatting')
        if (capabilities.renameProvider) features.push('rename')
        if (capabilities.documentSymbolProvider) features.push('documentSymbol')
        if (capabilities.codeActionProvider) features.push('codeAction')
        if (capabilities.signatureHelpProvider) features.push('signatureHelp')
        setSupportedFeatures(features)
      }
    } else {
      currentClientRef.current = null
      setIsInitialized(false)
      setSupportedFeatures([])
    }
  }, [isReady, model])

  // 同步文档内容到 LSP
  useEffect(() => {
    if (!isInitialized || !currentClientRef.current || !model) return

    const client = currentClientRef.current
    const uri = model.uri.toString()
    const languageId = model.getLanguageId()
    const version = model.getVersionId()
    const content = model.getValue()

    // 发送文档打开通知
    client.didOpenTextDocument({
      textDocument: {
        uri,
        languageId,
        version,
        text: content
      }
    })

    // 监听内容变化
    const disposable = model.onDidChangeContent((e) => {
      client.didChangeTextDocument({
        textDocument: { uri, version: model.getVersionId() },
        contentChanges: e.changes.map(change => ({
          range: change.range ? {
            start: { line: change.range.startLineNumber - 1, character: change.range.startColumn - 1 },
            end: { line: change.range.endLineNumber - 1, character: change.range.endColumn - 1 }
          } : undefined,
          text: change.text
        }))
      })
    })

    return () => {
      disposable.dispose()
      client.didCloseTextDocument({
        textDocument: { uri }
      })
    }
  }, [isInitialized, model])

  // 跳转到定义
  const goToDefinition = useCallback(async () => {
    if (!isInitialized || !currentClientRef.current || !editor || !model) return

    const position = editor.getPosition()
    if (!position) return

    const uri = model.uri.toString()
    const result = await currentClientRef.current.definition({
      textDocument: { uri },
      position: {
        line: position.lineNumber - 1,
        character: position.column - 1
      }
    })

    if (result && result.length > 0) {
      const location = result[0]
      // 打开文件并跳转
      const targetUri = monaco.Uri.parse(location.uri)
      // 这里需要通过外部回调打开文件
      console.log('Go to definition:', location)
    }
  }, [isInitialized, editor, model])

  // 查找引用
  const findReferences = useCallback(async () => {
    if (!isInitialized || !currentClientRef.current || !editor || !model) return

    const position = editor.getPosition()
    if (!position) return

    const uri = model.uri.toString()
    const result = await currentClientRef.current.workspaceSymbol({
      query: ''
    })

    console.log('References:', result)
  }, [isInitialized, editor, model])

  // 重命名符号
  const renameSymbol = useCallback(async () => {
    if (!isInitialized || !currentClientRef.current || !editor || !model) return

    const newName = prompt('Enter new name:')
    if (!newName) return

    const position = editor.getPosition()
    if (!position) return

    const uri = model.uri.toString()
    const result = await currentClientRef.current.rename({
      textDocument: { uri },
      position: {
        line: position.lineNumber - 1,
        character: position.column - 1
      },
      newName
    })

    if (result && result.changes) {
      // 应用重命名编辑
      console.log('Rename result:', result)
    }
  }, [isInitialized, editor, model])

  // 格式化文档
  const formatDocument = useCallback(async () => {
    if (!isInitialized || !currentClientRef.current || !editor || !model) return

    const uri = model.uri.toString()
    const result = await currentClientRef.current.formatting({
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true
      }
    })

    if (result && result.length > 0) {
      // 应用格式化编辑
      const edits = result.map(edit => ({
        range: new monaco.Range(
          edit.range.start.line + 1,
          edit.range.start.character + 1,
          edit.range.end.line + 1,
          edit.range.end.character + 1
        ),
        text: edit.newText
      }))

      model.pushEditOperations([], edits.map(edit => ({
        identifier: { major: 1, minor: 1 },
        range: edit.range,
        text: edit.text,
        forceMoveMarkers: false
      })), () => null)
    }
  }, [isInitialized, editor, model])

  // 获取当前诊断
  const getDiagnostics = useCallback(() => {
    return diagnostics
  }, [diagnostics])

  return {
    isReady,
    isInitialized,
    supportedFeatures,
    goToDefinition,
    findReferences,
    renameSymbol,
    formatDocument,
    getDiagnostics
  }
}

export default useMonacoLSP
