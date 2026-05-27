/**
 * LSP Client - Language Server Protocol 客户端
 * 提供与语言服务器的通信能力
 */

import {
  MessageConnection,
  createMessageConnection,
  Logger,
  MessageReader,
  MessageWriter,
  DataCallback,
  Disposable,
  PartialMessageInfo
} from 'vscode-jsonrpc'
import * as rpc from 'vscode-ws-jsonrpc'
import {
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  CompletionItem,
  CompletionList,
  Hover,
  Location,
  Definition,
  DocumentSymbol,
  SymbolInformation,
  WorkspaceEdit,
  TextEdit,
  SignatureHelp,
  CodeAction,
  CodeLens,
  DocumentLink,
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  DocumentOnTypeFormattingParams,
  FormattingOptions,
  RenameParams,
  CodeActionParams,
  CodeLensParams,
  DocumentLinkParams,
  CompletionParams,
  HoverParams,
  DefinitionParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidSaveTextDocumentParams,
  DidCloseTextDocumentParams,
  TextDocumentItem,
  VersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  PublishDiagnosticsParams,
  ServerCapabilities,
  DocumentFilter,
  TextDocumentPositionParams
} from 'vscode-languageserver-protocol'

export interface LSPClientOptions {
  serverPath: string
  serverArgs?: string[]
  documentSelector: DocumentFilter[]
  initializationOptions?: any
}

export interface LSPClientState {
  isInitialized: boolean
  isConnected: boolean
  serverCapabilities: ServerCapabilities | null
  clientCapabilities: any
}

export interface DiagnosticChangeEvent {
  uri: string
  diagnostics: Diagnostic[]
}

export type DiagnosticChangeHandler = (event: DiagnosticChangeEvent) => void

/**
 * LSP 客户端类
 * 管理与语言服务器的连接和通信
 */
export class LSPClient {
  private connection: MessageConnection | null = null
  private options: LSPClientOptions
  private state: LSPClientState
  private disposables: Disposable[] = []
  private documentVersions: Map<string, number> = new Map()
  private diagnosticHandlers: Set<DiagnosticChangeHandler> = new Set()
  private messageId = 0

  constructor(options: LSPClientOptions) {
    this.options = options
    this.state = {
      isInitialized: false,
      isConnected: false,
      serverCapabilities: null,
      clientCapabilities: this.createClientCapabilities()
    }
  }

  /**
   * 创建客户端能力
   */
  private createClientCapabilities(): any {
    return {
      textDocument: {
        synchronization: {
          dynamicRegistration: true,
          willSave: true,
          willSaveWaitUntil: true,
          didSave: true
        },
        completion: {
          dynamicRegistration: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            preselectSupport: true,
            tagSupport: {
              valueSet: [1] // Deprecated
            },
            insertReplaceSupport: true,
            resolveSupport: {
              properties: ['documentation', 'detail', 'additionalTextEdits']
            }
          },
          completionItemKind: {
            valueSet: [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
              11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
              21, 22, 23, 24, 25
            ]
          },
          contextSupport: true
        },
        hover: {
          dynamicRegistration: true,
          contentFormat: ['markdown', 'plaintext']
        },
        definition: {
          dynamicRegistration: true,
          linkSupport: true
        },
        documentSymbol: {
          dynamicRegistration: true,
          hierarchicalDocumentSymbolSupport: true,
          symbolKind: {
            valueSet: [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
              11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
              21, 22, 23, 24, 25, 26
            ]
          },
          tagSupport: {
            valueSet: [1]
          }
        },
        codeAction: {
          dynamicRegistration: true,
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: ['', 'quickfix', 'refactor', 'source']
            }
          },
          isPreferredSupport: true,
          disabledSupport: true,
          dataSupport: true,
          resolveSupport: {
            properties: ['edit']
          }
        },
        codeLens: {
          dynamicRegistration: true
        },
        formatting: {
          dynamicRegistration: true
        },
        rangeFormatting: {
          dynamicRegistration: true
        },
        onTypeFormatting: {
          dynamicRegistration: true
        },
        rename: {
          dynamicRegistration: true,
          prepareSupport: true,
          executeSupport: true
        },
        documentLink: {
          dynamicRegistration: true,
          tooltipSupport: true
        },
        signatureHelp: {
          dynamicRegistration: true,
          signatureInformation: {
            documentationFormat: ['markdown', 'plaintext'],
            parameterInformation: {
              labelOffsetSupport: true
            },
            activeParameterSupport: true
          },
          contextSupport: true
        },
        publishDiagnostics: {
          relatedInformation: true,
          versionSupport: true,
          tagSupport: {
            valueSet: [1, 2]
          },
          codeDescriptionSupport: true,
          dataSupport: true
        }
      },
      workspace: {
        applyEdit: true,
        workspaceEdit: {
          documentChanges: true
        },
        didChangeConfiguration: {
          dynamicRegistration: true
        },
        didChangeWatchedFiles: {
          dynamicRegistration: true
        },
        symbol: {
          dynamicRegistration: true,
          symbolKind: {
            valueSet: [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
              11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
              21, 22, 23, 24, 25, 26
            ]
          }
        },
        executeCommand: {
          dynamicRegistration: true
        },
        configuration: true,
        fileOperations: {
          dynamicRegistration: true
        }
      }
    }
  }

  /**
   * 连接到语言服务器
   * 通过 WebSocket 或 Node.js 子进程
   */
  async connect(transport: MessageReader & MessageWriter): Promise<void> {
    if (this.connection) {
      throw new Error('LSP client already connected')
    }

    const logger: Logger = {
      error: (message) => console.error('[LSP]', message),
      warn: (message) => console.warn('[LSP]', message),
      info: (message) => console.info('[LSP]', message),
      log: (message) => console.log('[LSP]', message)
    }

    this.connection = createMessageConnection(
      transport,
      transport,
      logger
    )

    // 监听诊断信息
    this.connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      this.handleDiagnostics(params)
    })

    // 监听服务器请求
    this.connection.onRequest('client/registerCapability', (params) => {
      console.log('[LSP] Server registered capability:', params)
      return null
    })

    this.connection.onRequest('client/unregisterCapability', (params) => {
      console.log('[LSP] Server unregistered capability:', params)
      return null
    })

    // 开始监听
    this.connection.listen()
    this.state.isConnected = true

    console.log('[LSP] Client connected to server')
  }

  /**
   * 初始化语言服务器
   */
  async initialize(workspaceRoot: string): Promise<InitializeResult> {
    if (!this.connection) {
      throw new Error('LSP client not connected')
    }

    const params: InitializeParams = {
      processId: null,
      rootUri: `file://${workspaceRoot}`,
      capabilities: this.state.clientCapabilities,
      workspaceFolders: workspaceRoot ? [{
        uri: `file://${workspaceRoot}`,
        name: workspaceRoot.split('/').pop() || 'workspace'
      }] : null,
      initializationOptions: this.options.initializationOptions
    }

    try {
      const result = await this.connection.sendRequest('initialize', params)
      this.state.serverCapabilities = result.capabilities
      this.state.isInitialized = true

      // 发送 initialized 通知
      this.connection.sendNotification('initialized', {})

      console.log('[LSP] Server initialized:', result.serverInfo)
      return result
    } catch (error) {
      console.error('[LSP] Failed to initialize server:', error)
      throw error
    }
  }

  /**
   * 关闭连接
   */
  async shutdown(): Promise<void> {
    if (!this.connection) return

    try {
      // 发送 shutdown 请求
      await this.connection.sendRequest('shutdown')

      // 发送 exit 通知
      this.connection.sendNotification('exit')
    } catch (error) {
      console.error('[LSP] Error during shutdown:', error)
    }

    // 清理资源
    this.disposables.forEach(d => d.dispose())
    this.disposables = []

    this.connection.dispose()
    this.connection = null
    this.state.isConnected = false
    this.state.isInitialized = false
    this.state.serverCapabilities = null

    console.log('[LSP] Client disconnected')
  }

  /**
   * 处理诊断信息
   */
  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    const event: DiagnosticChangeEvent = {
      uri: params.uri,
      diagnostics: params.diagnostics
    }

    this.diagnosticHandlers.forEach(handler => {
      try {
        handler(event)
      } catch (error) {
        console.error('[LSP] Error in diagnostic handler:', error)
      }
    })
  }

  /**
   * 注册诊断变更处理器
   */
  onDiagnosticsChange(handler: DiagnosticChangeHandler): Disposable {
    this.diagnosticHandlers.add(handler)
    return {
      dispose: () => {
        this.diagnosticHandlers.delete(handler)
      }
    }
  }

  /**
   * 发送文档打开通知
   */
  didOpenTextDocument(params: DidOpenTextDocumentParams): void {
    if (!this.connection) return

    this.documentVersions.set(params.textDocument.uri, params.textDocument.version)
    this.connection.sendNotification('textDocument/didOpen', params)
  }

  /**
   * 发送文档变更通知
   */
  didChangeTextDocument(params: DidChangeTextDocumentParams): void {
    if (!this.connection) return

    const currentVersion = this.documentVersions.get(params.textDocument.uri) || 0
    const newVersion = currentVersion + 1
    this.documentVersions.set(params.textDocument.uri, newVersion)

    this.connection.sendNotification('textDocument/didChange', {
      ...params,
      textDocument: {
        ...params.textDocument,
        version: newVersion
      }
    })
  }

  /**
   * 发送文档保存通知
   */
  didSaveTextDocument(params: DidSaveTextDocumentParams): void {
    if (!this.connection) return
    this.connection.sendNotification('textDocument/didSave', params)
  }

  /**
   * 发送文档关闭通知
   */
  didCloseTextDocument(params: DidCloseTextDocumentParams): void {
    if (!this.connection) return

    this.documentVersions.delete(params.textDocument.uri)
    this.connection.sendNotification('textDocument/didClose', params)
  }

  /**
   * 请求代码补全
   */
  async completion(params: CompletionParams): Promise<CompletionItem[] | CompletionList | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/completion', params)
    } catch (error) {
      console.error('[LSP] Completion error:', error)
      return null
    }
  }

  /**
   * 请求悬停信息
   */
  async hover(params: HoverParams): Promise<Hover | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/hover', params)
    } catch (error) {
      console.error('[LSP] Hover error:', error)
      return null
    }
  }

  /**
   * 请求定义位置
   */
  async definition(params: DefinitionParams): Promise<Definition | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/definition', params)
    } catch (error) {
      console.error('[LSP] Definition error:', error)
      return null
    }
  }

  /**
   * 请求文档符号
   */
  async documentSymbol(params: DocumentSymbolParams): Promise<DocumentSymbol[] | SymbolInformation[] | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/documentSymbol', params)
    } catch (error) {
      console.error('[LSP] Document symbol error:', error)
      return null
    }
  }

  /**
   * 请求工作区符号
   */
  async workspaceSymbol(params: WorkspaceSymbolParams): Promise<SymbolInformation[] | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('workspace/symbol', params)
    } catch (error) {
      console.error('[LSP] Workspace symbol error:', error)
      return null
    }
  }

  /**
   * 请求代码操作
   */
  async codeAction(params: CodeActionParams): Promise<(Command | CodeAction)[] | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/codeAction', params)
    } catch (error) {
      console.error('[LSP] Code action error:', error)
      return null
    }
  }

  /**
   * 请求格式化
   */
  async formatting(params: DocumentFormattingParams): Promise<TextEdit[] | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/formatting', params)
    } catch (error) {
      console.error('[LSP] Formatting error:', error)
      return null
    }
  }

  /**
   * 请求范围格式化
   */
  async rangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/rangeFormatting', params)
    } catch (error) {
      console.error('[LSP] Range formatting error:', error)
      return null
    }
  }

  /**
   * 请求重命名
   */
  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/rename', params)
    } catch (error) {
      console.error('[LSP] Rename error:', error)
      return null
    }
  }

  /**
   * 请求签名帮助
   */
  async signatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp | null> {
    if (!this.connection || !this.state.isInitialized) return null

    try {
      return await this.connection.sendRequest('textDocument/signatureHelp', params)
    } catch (error) {
      console.error('[LSP] Signature help error:', error)
      return null
    }
  }

  /**
   * 检查是否支持特定功能
   */
  supportsFeature(feature: keyof ServerCapabilities): boolean {
    if (!this.state.serverCapabilities) return false
    return !!this.state.serverCapabilities[feature]
  }

  /**
   * 获取服务器能力
   */
  getServerCapabilities(): ServerCapabilities | null {
    return this.state.serverCapabilities
  }

  /**
   * 获取客户端状态
   */
  getState(): LSPClientState {
    return { ...this.state }
  }

  /**
   * 获取文档版本
   */
  getDocumentVersion(uri: string): number {
    return this.documentVersions.get(uri) || 0
  }
}

// Command 类型（用于 codeAction）
interface Command {
  title: string
  command: string
  arguments?: any[]
}

export default LSPClient
