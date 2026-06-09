/**
 * MCP (Model Context Protocol) 和 Skill 系统配置类型定义
 */

// ==================== MCP Server 配置 ====================

/** MCP 传输方式 */
export type MCPTransportType = 'stdio' | 'http' | 'sse';

/** MCP Server 配置 */
export interface MCPServerConfig {
  /** 服务器唯一标识 */
  id: string;
  /** 服务器名称（显示用） */
  name: string;
  /** 服务器描述 */
  description?: string;
  /** 传输方式 */
  transport: MCPTransportType;
  /** stdio 模式：执行的命令 */
  command?: string;
  /** stdio 模式：命令参数 */
  args?: string[];
  /** HTTP/SSE 模式：服务器 URL */
  url?: string;
  /** 请求头（用于认证） */
  headers?: Record<string, string>;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** MCP Server 连接状态 */
export interface MCPServerStatus {
  id: string;
  name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
  tools?: MCPToolDefinition[];
  prompts?: MCPPromptDefinition[];
  resources?: MCPResourceDefinition[];
  lastConnectedAt?: number;
}

/** MCP 工具定义 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 提示词定义 */
export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

/** MCP 资源定义 */
export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ==================== Skill 系统 ====================

/** Skill 类型 */
export type SkillType = 'code-review' | 'debug' | 'security' | 'mini-app' | 'custom';

/** Skill 来源类型 */
export type SkillSourceType = 'builtin' | 'local' | 'npm' | 'github' | 'url';

/** Skill 来源配置 */
export interface SkillSource {
  /** 来源类型 */
  type: SkillSourceType;
  /** 来源地址
   * - builtin: 'builtin:skill-name'
   * - local: '/absolute/path/to/skill'
   * - npm: '@scope/package-name' 或 'package-name'
   * - github: 'owner/repo#branch' 或 'owner/repo'
   * - url: 'https://example.com/skill.zip' 或 'https://example.com/skill.tar.gz'
   */
  location: string;
  /** 版本/标签（用于 npm/github） */
  version?: string;
}

/** Skill 安装状态 */
export type SkillInstallStatus = 'pending' | 'downloading' | 'installing' | 'ready' | 'error';

/** Skill 配置 */
export interface SkillConfig {
  /** Skill 唯一标识 */
  id: string;
  /** Skill 名称 */
  name: string;
  /** Skill 描述 */
  description: string;
  /** Skill 类型 */
  type: SkillType;
  /** Skill 版本 */
  version: string;
  /** Skill 来源配置（新增） */
  source: SkillSource;
  /** Skill 入口文件（本地安装后的路径） */
  entry?: string;
  /** Skill 安装状态（新增） */
  installStatus: SkillInstallStatus;
  /** 安装错误信息（如果状态为 error） */
  installError?: string;
  /** 本地安装路径（系统自动管理） */
  installPath?: string;
  /** Skill 元数据 */
  metadata?: Record<string, unknown>;
  /** 依赖的工具列表 */
  dependencies?: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** Skill 执行上下文 */
export interface SkillExecutionContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 当前文件路径 */
  currentFile?: string;
  /** 当前工作区路径 */
  workspacePath?: string;
  /** 用户输入 */
  userInput?: string;
}

/** Skill 执行结果 */
export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: Record<string, unknown>;
}

// ==================== 配置管理 ====================

/** 完整配置结构 */
export interface MCPAndSkillConfig {
  /** MCP Server 配置列表 */
  mcpServers: Record<string, MCPServerConfig>;
  /** Skill 配置列表 */
  skills: Record<string, SkillConfig>;
  /** 全局设置 */
  settings: {
    /** 默认 MCP 服务器 */
    defaultMcpServer?: string;
    /** 自动加载 MCP 服务器 */
    autoLoadMcpServers: boolean;
    /** 自动执行 Skill */
    autoExecuteSkills: boolean;
  };
}

/** 默认配置 */
export const DEFAULT_CONFIG: MCPAndSkillConfig = {
  mcpServers: {},
  skills: {},
  settings: {
    autoLoadMcpServers: true,
    autoExecuteSkills: false,
  },
};

/** 配置保存位置 */
export const CONFIG_PATHS = {
  /** 用户级配置 */
  userConfig: '~/.smpcode/mcp-skills.json',
  /** 项目级配置 */
  projectConfig: '.smpcode/mcp-skills.json',
};
