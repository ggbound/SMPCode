/**
 * MCP Server 管理器
 * 负责 MCP 服务器的动态加载、连接管理、工具发现
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';
import {
  MCPServerConfig,
  MCPServerStatus,
  MCPToolDefinition,
  MCPPromptDefinition,
  MCPResourceDefinition,
} from './mcp-skill-types';
import MCPProtocolHandler from './mcp-protocol-handler';
import { registerAllTools } from './tools-definitions';
import { toolRegistry as cliToolRegistry } from '../cli/tool-registry';

export class MCPManager extends EventEmitter {
  private servers: Map<string, MCPServerStatus> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();
  private protocolHandlers: Map<string, MCPProtocolHandler> = new Map();

  constructor() {
    super();
  }

  /**
   * 添加 MCP 服务器配置
   */
  addServer(config: MCPServerConfig): void {
    log.info(`[MCP] Adding server: ${config.name}`);
    this.configs.set(config.id, config);
    const status: MCPServerStatus = {
      id: config.id,
      name: config.name,
      status: 'disconnected',
    };
    this.servers.set(config.id, status);
    this.emit('server-added', config);
    log.info(`[MCP] Server ${config.name} added successfully`);
  }

  /**
   * 移除 MCP 服务器
   */
  removeServer(id: string): void {
    log.info(`[MCP] Removing server: ${id}`);
    this.disconnectServer(id);
    this.servers.delete(id);
    this.configs.delete(id);
    this.emit('server-removed', id);
  }

  /**
   * 连接 MCP 服务器
   */
  async connectServer(id: string): Promise<boolean> {
    const config = this.configs.get(id);
    if (!config) {
      log.error(`[MCP] Server not found: ${id}`);
      return false;
    }

    const status = this.servers.get(id);
    if (!status) return false;

    status.status = 'connecting';
    this.servers.set(id, status);
    this.emit('server-status-change', id, status);

    try {
      if (config.transport === 'stdio') {
        await this.connectStdioServer(config);
      } else if (config.transport === 'http' || config.transport === 'sse') {
        await this.connectHttpServer(config);
      }

      status.status = 'connected';
      status.lastConnectedAt = Date.now();
      this.servers.set(id, status);
      this.emit('server-status-change', id, status);
      log.info(`[MCP] Server ${config.name} connected successfully`);
      
      // 注册 MCP 工具到 tools-definitions
      try {
        registerAllTools();
        log.info(`[MCP] Tools registered after server ${config.name} connected`);
      } catch (error) {
        log.error(`[MCP] Failed to register tools:`, error);
      }
      
      // 注册 MCP 工具到 CLI toolRegistry
      try {
        const serverStatus = this.servers.get(id);
        if (serverStatus?.tools) {
          for (const tool of serverStatus.tools) {
            // 使用下划线格式：mcp_{serverId}_{toolName}
            const toolName = `mcp_${id}_${tool.name}`;
            const parameters: Record<string, any> = tool.inputSchema?.properties || {};
            const requiredProps: string[] = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
            cliToolRegistry.register({
              name: toolName,
              description: `${tool.description || 'MCP tool from ' + config.name}`,
              sourceHint: `mcp:${config.name}`,
              responsibility: `Execute MCP tool ${tool.name} from server ${config.name}`,
              parameters,
              required: requiredProps,
              execute: async (args: Record<string, unknown>, context: any) => {
                try {
                  const result = await this.executeTool(id, tool.name, args);
                  return {
                    success: true,
                    output: JSON.stringify(result, null, 2)
                  };
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  return {
                    success: false,
                    output: '',
                    error: errorMessage
                  };
                }
              }
            });
            log.info(`[MCP] Registered CLI tool: ${toolName}`);
          }
        }
      } catch (error) {
        log.error(`[MCP] Failed to register CLI tools:`, error);
      }
      
      return true;
    } catch (error) {
      status.status = 'error';
      status.error = error instanceof Error ? error.message : String(error);
      this.servers.set(id, status);
      this.emit('server-status-change', id, status);
      log.error(`[MCP] Failed to connect server ${config.name}:`, error);
      return false;
    }
  }

  /**
   * 断开 MCP 服务器连接
   */
  disconnectServer(id: string): void {
    const childProcess = this.processes.get(id);
    if (childProcess) {
      childProcess.kill();
      this.processes.delete(id);
    }

    const status = this.servers.get(id);
    if (status) {
      status.status = 'disconnected';
      status.tools = undefined;
      status.prompts = undefined;
      status.resources = undefined;
      this.servers.set(id, status);
      this.emit('server-status-change', id, status);
    }
    log.info(`[MCP] Server ${id} disconnected`);
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(id: string): MCPServerStatus | undefined {
    return this.servers.get(id);
  }

  /**
   * 获取所有服务器状态
   */
  getAllServerStatuses(): MCPServerStatus[] {
    return Array.from(this.servers.values());
  }

  /**
   * 获取已连接服务器的工具列表
   */
  getTools(serverId: string): MCPToolDefinition[] | undefined {
    return this.servers.get(serverId)?.tools;
  }

  /**
   * 连接 stdio 模式的 MCP 服务器
   */
  private async connectStdioServer(config: MCPServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      // 确保 PATH 包含常见的 Node.js 安装路径
      const pathEnv = process.env.PATH || '';
      const nodePaths = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/opt/local/bin';
      const envVars = { 
        ...process.env, 
        ...config.env,
        PATH: `${pathEnv}:${nodePaths}`
      };
      
      // 设置连接超时
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout: MCP server ${config.name} did not respond within 30 seconds`));
      }, 30000);

      // 构建完整命令（使用 shell 模式确保 npx 等命令可用）
      const fullCommand = `${config.command} ${config.args?.join(' ') || ''}`;
      log.info(`[MCP] Spawning process: ${fullCommand}`);
      log.info(`[MCP] PATH: ${envVars.PATH}`);
      
      // 使用 shell: true 确保 PATH 环境变量正确
      const childProcess = spawn(fullCommand, { 
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      this.processes.set(config.id, childProcess);

      // 创建协议处理器
      const protocolHandler = new MCPProtocolHandler();
      this.protocolHandlers.set(config.id, protocolHandler);

      // 监听协议事件
      protocolHandler.on('send', (message: string) => {
        log.info(`[MCP] Sending message to ${config.name}:`, message.substring(0, 200));
        if (!childProcess.stdin?.destroyed) {
          childProcess.stdin?.write(message);
        }
      });

      protocolHandler.on('tools-changed', () => {
        this.refreshTools(config.id);
      });

      protocolHandler.on('resources-changed', () => {
        this.refreshResources(config.id);
      });

      protocolHandler.on('prompts-changed', () => {
        this.refreshPrompts(config.id);
      });

      childProcess.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });

      childProcess.on('exit', (code: number | null) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`MCP server process exited with code ${code}`));
        }
      });

      childProcess.stdout.on('data', (data: Buffer) => {
         const dataStr = data.toString();
         log.info(`[MCP] Received from ${config.name}:`, dataStr.substring(0, 200));
          protocolHandler.handleData(data);
        });

      childProcess.stderr.on('data', (data: Buffer) => {
        const stderr = data.toString();
        log.warn(`[MCP] Server ${config.name} stderr:`, stderr);
      });

      // 初始化连接
      protocolHandler.initialize('SMP Code', '1.0.0')
        .then(async (serverInfo) => {
          clearTimeout(timeout);
          log.info(`[MCP] Server ${config.name} initialized:`, serverInfo.name, 'v' + serverInfo.version);
          
          // 获取工具列表
          try {
            const tools = await protocolHandler.listTools();
            const status = this.servers.get(config.id);
            if (status) {
              status.tools = tools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              }));
              this.servers.set(config.id, status);
            }
          } catch (toolError) {
            log.warn(`[MCP] Failed to list tools for ${config.name}:`, toolError);
          }
          
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * 执行 MCP 工具（使用协议处理器）
   */
  async executeTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const protocolHandler = this.protocolHandlers.get(serverId);
    if (!protocolHandler) {
      throw new Error(`Protocol handler not found for server ${serverId}`);
    }
    
    const status = this.servers.get(serverId);
    if (!status || status.status !== 'connected') {
      throw new Error(`Server ${serverId} is not connected`);
    }

    log.info(`[MCP] Executing tool ${toolName} on server ${serverId}`);
    return protocolHandler.callTool(toolName, args);
  }

  /**
   * 刷新工具列表
   */
  private async refreshTools(serverId: string): Promise<void> {
    const protocolHandler = this.protocolHandlers.get(serverId);
    if (!protocolHandler) return;
    
    try {
      const tools = await protocolHandler.listTools();
      const status = this.servers.get(serverId);
      if (status) {
        status.tools = tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        this.servers.set(serverId, status);
        this.emit('server-status-change', serverId, status);
      }
    } catch (error) {
      log.error(`[MCP] Failed to refresh tools for server ${serverId}:`, error);
    }
  }

  /**
   * 刷新资源列表
   */
  private async refreshResources(serverId: string): Promise<void> {
    const protocolHandler = this.protocolHandlers.get(serverId);
    if (!protocolHandler) return;
    
    try {
      await protocolHandler.listResources();
      // TODO: 更新状态
    } catch (error) {
      log.error(`[MCP] Failed to refresh resources for server ${serverId}:`, error);
    }
  }

  /**
   * 刷新提示词列表
   */
  private async refreshPrompts(serverId: string): Promise<void> {
    const protocolHandler = this.protocolHandlers.get(serverId);
    if (!protocolHandler) return;
    
    try {
      await protocolHandler.listPrompts();
      // TODO: 更新状态
    } catch (error) {
      log.error(`[MCP] Failed to refresh prompts for server ${serverId}:`, error);
    }
  }

  /**
   * 连接 HTTP/SSE 模式的 MCP 服务器
   */
  private async connectHttpServer(config: MCPServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error('URL is required for HTTP/SSE transport');
    }

    log.info(`[MCP] Connecting to HTTP server: ${config.url}`);
    // TODO: 实现 HTTP/SSE 连接逻辑
  }

  /**
   * 更新服务器配置
   */
  updateServerConfig(id: string, config: Partial<MCPServerConfig>): void {
    const existing = this.configs.get(id);
    if (existing) {
      const updated = { ...existing, ...config, updatedAt: Date.now() };
      this.configs.set(id, updated);
      this.emit('server-config-updated', updated);
    }
  }

  /**
   * 获取服务器配置
   */
  getServerConfig(id: string): MCPServerConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * 获取所有服务器配置
   */
  getAllServerConfigs(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }
}

// 单例实例
export const mcpManager = new MCPManager();
