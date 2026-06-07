/**
 * MCP JSON-RPC 协议实现
 * 处理 MCP 服务器的通信协议
 */
import { EventEmitter } from 'events';
import log from 'electron-log';

/** JSON-RPC 请求 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 响应 */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** MCP 工具定义 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP 资源定义 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP 提示词定义 */
export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/** MCP 服务器能力 */
export interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

/** MCP 服务器信息 */
export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities: MCPServerCapabilities;
}

export class MCPProtocolHandler extends EventEmitter {
  private requestId = 0;
  private pendingRequests: Map<number | string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }> = new Map();
  private buffer = '';
  private serverInfo?: MCPServerInfo;
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];

  constructor() {
    super();
  }

  /**
   * 处理从服务器接收的数据
   */
  handleData(data: Buffer): void {
    this.buffer += data.toString();
    
    // 按行分割处理 JSON-RPC 消息
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留不完整的最后一行
    
    for (const line of lines) {
      if (line.trim()) {
        this.processMessage(line);
      }
    }
  }

  /**
   * 处理单条 JSON-RPC 消息
   */
  private processMessage(line: string): void {
    try {
      const message = JSON.parse(line) as JSONRPCRequest | JSONRPCResponse;
      
      if ('method' in message) {
        // 这是请求或通知
        this.handleRequest(message as JSONRPCRequest);
      } else {
        // 这是响应
        this.handleResponse(message as JSONRPCResponse);
      }
    } catch (error) {
      log.error('[MCPProtocol] Failed to parse message:', error, 'Line:', line);
    }
  }

  /**
   * 处理来自服务器的请求
   */
  private handleRequest(request: JSONRPCRequest): void {
    log.debug('[MCPProtocol] Received request:', request.method);
    
    switch (request.method) {
      case 'notifications/tools/list_changed':
        this.emit('tools-changed');
        break;
      case 'notifications/resources/list_changed':
        this.emit('resources-changed');
        break;
      case 'notifications/prompts/list_changed':
        this.emit('prompts-changed');
        break;
      case 'notifications/message':
        this.emit('message', request.params);
        break;
      default:
        log.debug('[MCPProtocol] Unknown notification:', request.method);
    }
  }

  /**
   * 处理来自服务器的响应
   */
  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      log.warn('[MCPProtocol] Received response for unknown request:', response.id);
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * 发送 JSON-RPC 请求
   */
  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // 发送消息（添加换行符）
      const message = JSON.stringify(request) + '\n';
      this.emit('send', message);
      
      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000); // 30秒超时
    });
  }

  /**
   * 发送通知（无响应）
   */
  sendNotification(method: string, params?: unknown): void {
    const notification: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 'notification', // 通知也需要 id 字段
      method,
      params,
    };
    
    const message = JSON.stringify(notification) + '\n';
    this.emit('send', message);
  }

  // ==================== MCP 协议方法 ====================

  /**
   * 初始化连接
   */
  async initialize(clientName: string, clientVersion: string): Promise<MCPServerInfo> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
      },
      clientInfo: {
        name: clientName,
        version: clientVersion,
      },
    }) as { serverInfo: MCPServerInfo; protocolVersion: string };
    
    this.serverInfo = result.serverInfo;
    log.info('[MCPProtocol] Initialized with server:', result.serverInfo.name, 'v' + result.serverInfo.version);
    
    // 发送 initialized 通知
    this.sendNotification('notifications/initialized');
    
    return result.serverInfo;
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list') as { tools: MCPTool[] };
    this.tools = result.tools;
    return result.tools;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
  }

  /**
   * 获取资源列表
   */
  async listResources(): Promise<MCPResource[]> {
    const result = await this.sendRequest('resources/list') as { resources: MCPResource[] };
    this.resources = result.resources;
    return result.resources;
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<unknown> {
    return this.sendRequest('resources/read', { uri });
  }

  /**
   * 获取提示词列表
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    const result = await this.sendRequest('prompts/list') as { prompts: MCPPrompt[] };
    this.prompts = result.prompts;
    return result.prompts;
  }

  /**
   * 获取提示词
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    return this.sendRequest('prompts/get', {
      name,
      arguments: args,
    });
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): MCPServerInfo | undefined {
    return this.serverInfo;
  }

  /**
   * 获取缓存的工具列表
   */
  getCachedTools(): MCPTool[] {
    return this.tools;
  }

  /**
   * 获取缓存的资源列表
   */
  getCachedResources(): MCPResource[] {
    return this.resources;
  }

  /**
   * 获取缓存的提示词列表
   */
  getCachedPrompts(): MCPPrompt[] {
    return this.prompts;
  }

  /**
   * 清理待处理的请求
   */
  cleanup(): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this.buffer = '';
  }
}

export default MCPProtocolHandler;
