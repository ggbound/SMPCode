/**
 * LSP Manager - LSP 管理器
 * 管理多个语言服务器客户端
 */

import { LSPClient, LSPClientOptions, DiagnosticChangeEvent } from './lsp-client'
import { DocumentFilter, ServerCapabilities } from 'vscode-languageserver-protocol'

export interface LanguageServerConfig {
  id: string
  name: string
  languageIds: string[]
  documentSelector: DocumentFilter[]
  serverPath: string
  serverArgs?: string[]
  initializationOptions?: any
  transport: 'stdio' | 'websocket' | 'node-ipc'
  websocketUrl?: string
}

export interface LanguageServerInfo {
  id: string
  name: string
  client: LSPClient
  config: LanguageServerConfig
  isConnected: boolean
  isInitialized: boolean
}

export interface LanguageSupport {
  languageId: string
  serverIds: string[]
}

/**
 * LSP 管理器类
 * 负责管理多个语言服务器连接
 */
export class LSPManager {
  private servers: Map<string, LanguageServerInfo> = new Map()
  private languageToServers: Map<string, Set<string>> = new Map()
  private diagnosticListeners: Set<(event: DiagnosticChangeEvent) => void> = new Set()

  constructor() {
    console.log('[LSPManager] Initialized')
  }

  /**
   * 注册语言服务器
   */
  registerServer(config: LanguageServerConfig): void {
    if (this.servers.has(config.id)) {
      console.warn(`[LSPManager] Server ${config.id} already registered`)
      return
    }

    const clientOptions: LSPClientOptions = {
      serverPath: config.serverPath,
      serverArgs: config.serverArgs,
      documentSelector: config.documentSelector,
      initializationOptions: config.initializationOptions
    }

    const client = new LSPClient(clientOptions)

    // 监听诊断信息
    client.onDiagnosticsChange((event) => {
      this.diagnosticListeners.forEach(listener => listener(event))
    })

    const serverInfo: LanguageServerInfo = {
      id: config.id,
      name: config.name,
      client,
      config,
      isConnected: false,
      isInitialized: false
    }

    this.servers.set(config.id, serverInfo)

    // 建立语言到服务器的映射
    config.languageIds.forEach(languageId => {
      if (!this.languageToServers.has(languageId)) {
        this.languageToServers.set(languageId, new Set())
      }
      this.languageToServers.get(languageId)!.add(config.id)
    })

    console.log(`[LSPManager] Registered server: ${config.name} (${config.id})`)
  }

  /**
   * 启动语言服务器
   */
  async startServer(serverId: string, workspaceRoot: string): Promise<boolean> {
    const server = this.servers.get(serverId)
    if (!server) {
      console.error(`[LSPManager] Server ${serverId} not found`)
      return false
    }

    try {
      // 根据传输类型创建连接
      let transport: any

      switch (server.config.transport) {
        case 'stdio':
          transport = await this.createStdioTransport(server.config)
          break
        case 'websocket':
          transport = await this.createWebSocketTransport(server.config)
          break
        case 'node-ipc':
          transport = await this.createNodeIPCTransport(server.config)
          break
        default:
          throw new Error(`Unsupported transport: ${server.config.transport}`)
      }

      // 连接到服务器
      await server.client.connect(transport)
      server.isConnected = true

      // 初始化
      await server.client.initialize(workspaceRoot)
      server.isInitialized = true

      console.log(`[LSPManager] Started server: ${server.name}`)
      return true
    } catch (error) {
      console.error(`[LSPManager] Failed to start server ${serverId}:`, error)
      server.isConnected = false
      server.isInitialized = false
      return false
    }
  }

  /**
   * 停止语言服务器
   */
  async stopServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId)
    if (!server) {
      console.error(`[LSPManager] Server ${serverId} not found`)
      return false
    }

    try {
      await server.client.shutdown()
      server.isConnected = false
      server.isInitialized = false

      console.log(`[LSPManager] Stopped server: ${server.name}`)
      return true
    } catch (error) {
      console.error(`[LSPManager] Error stopping server ${serverId}:`, error)
      return false
    }
  }

  /**
   * 创建 stdio 传输
   */
  private async createStdioTransport(config: LanguageServerConfig): Promise<any> {
    // 通过 IPC 调用主进程创建子进程
    const ipc = (window as any).api?.lsp
    if (!ipc?.createStdioTransport) {
      throw new Error('LSP IPC not available')
    }

    return await ipc.createStdioTransport(config.serverPath, config.serverArgs)
  }

  /**
   * 创建 WebSocket 传输
   */
  private async createWebSocketTransport(config: LanguageServerConfig): Promise<any> {
    if (!config.websocketUrl) {
      throw new Error('WebSocket URL not provided')
    }

    const WebSocketClient = require('vscode-ws-jsonrpc').WebSocketMessageReader
    const socket = new WebSocket(config.websocketUrl)

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        const reader = new (require('vscode-ws-jsonrpc').WebSocketMessageReader)(socket)
        const writer = new (require('vscode-ws-jsonrpc').WebSocketMessageWriter)(socket)
        resolve({
          ...reader,
          ...writer,
          onError: reader.onError.bind(reader),
          onClose: reader.onClose.bind(reader),
          listen: reader.listen.bind(reader),
          dispose: () => {
            reader.dispose()
            writer.dispose()
            socket.close()
          }
        })
      }
      socket.onerror = (error) => reject(error)
    })
  }

  /**
   * 创建 Node IPC 传输
   */
  private async createNodeIPCTransport(config: LanguageServerConfig): Promise<any> {
    const ipc = (window as any).api?.lsp
    if (!ipc?.createNodeIPCTransport) {
      throw new Error('LSP IPC not available')
    }

    return await ipc.createNodeIPCTransport(config.serverPath, config.serverArgs)
  }

  /**
   * 获取支持特定语言的服务器
   */
  getServersForLanguage(languageId: string): LanguageServerInfo[] {
    const serverIds = this.languageToServers.get(languageId)
    if (!serverIds) return []

    return serverIds
      .map(id => this.servers.get(id))
      .filter((server): server is LanguageServerInfo => server !== undefined)
  }

  /**
   * 获取语言服务器客户端
   */
  getClient(serverId: string): LSPClient | null {
    const server = this.servers.get(serverId)
    return server?.client || null
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(serverId: string): LanguageServerInfo | undefined {
    return this.servers.get(serverId)
  }

  /**
   * 获取所有服务器
   */
  getAllServers(): LanguageServerInfo[] {
    return Array.from(this.servers.values())
  }

  /**
   * 获取已连接的服务器
   */
  getConnectedServers(): LanguageServerInfo[] {
    return Array.from(this.servers.values()).filter(s => s.isConnected)
  }

  /**
   * 获取已初始化的服务器
   */
  getInitializedServers(): LanguageServerInfo[] {
    return Array.from(this.servers.values()).filter(s => s.isInitialized)
  }

  /**
   * 检查语言是否被支持
   */
  isLanguageSupported(languageId: string): boolean {
    return this.languageToServers.has(languageId)
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.languageToServers.keys())
  }

  /**
   * 注册诊断监听器
   */
  onDiagnostics(listener: (event: DiagnosticChangeEvent) => void): { dispose: () => void } {
    this.diagnosticListeners.add(listener)
    return {
      dispose: () => {
        this.diagnosticListeners.delete(listener)
      }
    }
  }

  /**
   * 启动所有服务器
   */
  async startAll(workspaceRoot: string): Promise<{ [serverId: string]: boolean }> {
    const results: { [serverId: string]: boolean } = {}

    for (const [id] of this.servers) {
      results[id] = await this.startServer(id, workspaceRoot)
    }

    return results
  }

  /**
   * 停止所有服务器
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map(id => this.stopServer(id))
    await Promise.all(promises)
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.stopAll()
    this.servers.clear()
    this.languageToServers.clear()
    this.diagnosticListeners.clear()
    console.log('[LSPManager] Disposed')
  }
}

// 默认配置
export const DefaultLanguageServers: LanguageServerConfig[] = [
  {
    id: 'typescript-language-server',
    name: 'TypeScript Language Server',
    languageIds: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    documentSelector: [
      { language: 'typescript' },
      { language: 'javascript' },
      { language: 'typescriptreact' },
      { language: 'javascriptreact' }
    ],
    serverPath: 'typescript-language-server',
    serverArgs: ['--stdio'],
    transport: 'stdio',
    initializationOptions: {
      preferences: {
        includeInlayParameterNameHints: 'all',
        includeInlayParameterNameHintsWhenArgumentMatchesName: true,
        includeInlayFunctionParameterTypeHints: true,
        includeInlayVariableTypeHints: true,
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
        includeInlayEnumMemberValueHints: true
      }
    }
  },
  {
    id: 'python-language-server',
    name: 'Python Language Server (Pyright)',
    languageIds: ['python'],
    documentSelector: [{ language: 'python' }],
    serverPath: 'pyright-langserver',
    serverArgs: ['--stdio'],
    transport: 'stdio',
    initializationOptions: {
      settings: {
        python: {
          analysis: {
            typeCheckingMode: 'basic',
            autoImportCompletions: true
          }
        }
      }
    }
  },
  {
    id: 'rust-analyzer',
    name: 'Rust Analyzer',
    languageIds: ['rust'],
    documentSelector: [{ language: 'rust' }],
    serverPath: 'rust-analyzer',
    transport: 'stdio',
    initializationOptions: {
      checkOnSave: {
        command: 'clippy'
      }
    }
  },
  {
    id: 'gopls',
    name: 'Go Language Server',
    languageIds: ['go'],
    documentSelector: [{ language: 'go' }],
    serverPath: 'gopls',
    transport: 'stdio',
    initializationOptions: {
      build: {
        experimentalWorkspaceModule: true
      }
    }
  }
]

export default LSPManager
