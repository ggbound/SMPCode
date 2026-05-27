/**
 * Plugin API - 插件 API 定义
 * 定义插件可用的 API 接口
 */

import type * as monaco from 'monaco-editor'
import type { Message } from '../../store'

/**
 * 插件上下文
 */
export interface PluginContext {
  // 编辑器 API
  editor: {
    getInstance: () => monaco.editor.IStandaloneCodeEditor | null
    getModel: () => monaco.editor.ITextModel | null
    insertText: (text: string, position?: monaco.Position) => void
    replaceText: (range: monaco.Range, text: string) => void
    getSelectedText: () => string
    getCursorPosition: () => monaco.Position | null
    openFile: (path: string, content?: string) => void
    saveFile: () => Promise<boolean>
    executeCommand: (commandId: string, ...args: any[]) => Promise<any>
  }

  // 文件系统 API
  fs: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<boolean>
    deleteFile: (path: string) => Promise<boolean>
    readDir: (path: string) => Promise<string[]>
    exists: (path: string) => Promise<boolean>
    watch: (path: string, callback: (event: string, filename: string) => void) => () => void
  }

  // UI API
  ui: {
    showMessage: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void
    showInput: (prompt: string, defaultValue?: string) => Promise<string | null>
    showQuickPick: (items: string[], placeholder?: string) => Promise<string | undefined>
    showNotification: (title: string, message: string, buttons?: string[]) => Promise<string | undefined>
    createStatusBarItem: (alignment: 'left' | 'right', priority?: number) => StatusBarItem
    registerCommand: (commandId: string, callback: (...args: any[]) => any) => void
    registerKeybinding: (keybinding: string, commandId: string, when?: string) => void
    registerMenuItem: (location: string, item: MenuItem) => void
    showWebviewPanel: (viewType: string, title: string, options: WebviewOptions) => WebviewPanel
  }

  // AI API
  ai: {
    sendMessage: (content: string, options?: AISendOptions) => Promise<Message>
    streamMessage: (content: string, options?: AISendOptions, onChunk?: (chunk: string) => void) => Promise<Message>
    getHistory: () => Message[]
    clearHistory: () => void
  }

  // 项目 API
  project: {
    getPath: () => string | null
    getFiles: () => Promise<string[]>
    getActiveFile: () => string | null
    setActiveFile: (path: string) => void
  }

  // 工具 API
  tools: {
    execute: (toolName: string, args: Record<string, any>) => Promise<any>
    register: (toolDefinition: ToolDefinition) => void
  }

  // 存储 API
  storage: {
    get: <T>(key: string, defaultValue?: T) => Promise<T | undefined>
    set: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<void>
    onChange: (key: string, callback: (value: any) => void) => () => void
  }

  // 事件 API
  events: {
    on: (event: string, callback: (...args: any[]) => void) => () => void
    emit: (event: string, ...args: any[]) => void
  }

  // 日志 API
  log: {
    debug: (message: string, ...args: any[]) => void
    info: (message: string, ...args: any[]) => void
    warn: (message: string, ...args: any[]) => void
    error: (message: string, ...args: any[]) => void
  }
}

/**
 * 状态栏项
 */
export interface StatusBarItem {
  text: string
  tooltip?: string
  command?: string
  show: () => void
  hide: () => void
  dispose: () => void
}

/**
 * 菜单项
 */
export interface MenuItem {
  id: string
  label: string
  icon?: string
  command: string
  when?: string
  group?: string
}

/**
 * Webview 选项
 */
export interface WebviewOptions {
  enableScripts?: boolean
  retainContextWhenHidden?: boolean
  localResourceRoots?: string[]
}

/**
 * Webview 面板
 */
export interface WebviewPanel {
  webview: {
    html: string
    postMessage: (message: any) => void
    onDidReceiveMessage: (callback: (message: any) => void) => void
  }
  title: string
  visible: boolean
  active: boolean
  onDidChangeViewState: (callback: () => void) => void
  onDidDispose: (callback: () => void) => void
  reveal: (viewColumn?: number, preserveFocus?: boolean) => void
  dispose: () => void
}

/**
 * AI 发送选项
 */
export interface AISendOptions {
  model?: string
  stream?: boolean
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required: string[]
  }
  execute: (args: any, context: PluginContext) => Promise<any>
}

/**
 * 编辑器装饰
 */
export interface DecorationOptions {
  range: monaco.Range
  options: {
    isWholeLine?: boolean
    className?: string
    glyphMarginClassName?: string
    linesDecorationsClassName?: string
    marginClassName?: string
    inlineClassName?: string
    before?: DecorationAttachment
    after?: DecorationAttachment
    hoverMessage?: string | { value: string }
  }
}

/**
 * 装饰附件
 */
export interface DecorationAttachment {
  content: string
  inlineClassName?: string
  inlineClassNameAffectsLetterSpacing?: boolean
  attachedData?: any
}

/**
 * 代码透镜
 */
export interface CodeLens {
  range: monaco.Range
  command?: {
    id: string
    title: string
    tooltip?: string
    arguments?: any[]
  }
}

/**
 * 代码操作
 */
export interface CodeAction {
  title: string
  kind?: string
  diagnostics?: any[]
  edit?: {
    edits: Array<{
      resource: string
      edits: Array<{
        range: monaco.Range
        text: string
      }>
    }>
  }
  command?: {
    id: string
    title: string
    arguments?: any[]
  }
}

/**
 * 补全项
 */
export interface CompletionItem {
  label: string
  kind?: monaco.languages.CompletionItemKind
  detail?: string
  documentation?: string | { value: string }
  insertText?: string
  range?: monaco.Range
  sortText?: string
  filterText?: string
  preselect?: boolean
  commitCharacters?: string[]
}

/**
 * 悬停信息
 */
export interface Hover {
  contents: Array<string | { value: string; language?: string }>
  range?: monaco.Range
}
