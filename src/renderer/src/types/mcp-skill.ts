/**
 * 前端 MCP & Skill 类型定义
 */

// ==================== MCP Server ====================

export type MCPTransportType = 'stdio' | 'http' | 'sse';

export interface MCPServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: MCPTransportType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
  tools?: MCPToolDefinition[];
  lastConnectedAt?: number;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ==================== Skill ====================

export type SkillType = 'code-review' | 'debug' | 'security' | 'mini-app' | 'custom';

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  version: string;
  entry: string;
  metadata?: Record<string, unknown>;
  dependencies?: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ==================== 配置 ====================

export interface MCPAndSkillConfig {
  mcpServers: Record<string, MCPServerConfig>;
  skills: Record<string, SkillConfig>;
  settings: {
    defaultMcpServer?: string;
    autoLoadMcpServers: boolean;
    autoExecuteSkills: boolean;
  };
}

// ==================== UI 状态 ====================

export interface MCPPanelState {
  servers: MCPServerConfig[];
  statuses: Record<string, MCPServerStatus>;
  selectedServerId: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface SkillPanelState {
  skills: SkillConfig[];
  selectedSkillId: string | null;
  isLoading: boolean;
  error: string | null;
}
