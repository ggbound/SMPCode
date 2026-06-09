/**
 * MCP & Skill 配置管理服务
 * 负责配置的保存、加载、验证
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import log from 'electron-log';
import {
  MCPAndSkillConfig,
  MCPServerConfig,
  SkillConfig,
  DEFAULT_CONFIG,
  SkillSource,
} from './mcp-skill-types';
import { skillManager } from './skill-manager';
import type { DownloadProgressCallback } from './skill-downloader';

export class MCPConfigService {
  private configPath: string;
  private currentConfig: MCPAndSkillConfig = DEFAULT_CONFIG;
  private configListeners: Set<(config: MCPAndSkillConfig) => void> = new Set();

  constructor() {
    // 配置文件路径：用户数据目录下的 mcp-skills.json
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'mcp-skills.json');
    log.info(`[MCPConfig] Config path: ${this.configPath}`);
  }

  /**
   * 初始化配置服务
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig();
      log.info('[MCPConfig] Config service initialized');
    } catch (error) {
      log.error('[MCPConfig] Failed to initialize:', error);
      // 使用默认配置
      this.currentConfig = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<MCPAndSkillConfig> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // 验证配置结构
      this.currentConfig = this.validateConfig(parsed);
      log.info('[MCPConfig] Config loaded successfully');
      
      this.notifyListeners();
      return this.currentConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 配置文件不存在，创建默认配置
        log.info('[MCPConfig] Config file not found, creating default...');
        await this.saveConfig(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }
      throw error;
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config: MCPAndSkillConfig): Promise<void> {
    try {
      // 确保目录存在
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      
      // 格式化 JSON 并保存
      const json = JSON.stringify(config, null, 2);
      await fs.writeFile(this.configPath, json, 'utf-8');
      
      this.currentConfig = config;
      log.info('[MCPConfig] Config saved successfully');
      
      this.notifyListeners();
    } catch (error) {
      log.error('[MCPConfig] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): MCPAndSkillConfig {
    return { ...this.currentConfig };
  }

  /**
   * 添加 MCP Server
   */
  async addMCPServer(config: Omit<MCPServerConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<MCPServerConfig> {
    const serverConfig: MCPServerConfig = {
      ...config,
      id: this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.currentConfig.mcpServers[serverConfig.id] = serverConfig;
    await this.saveConfig(this.currentConfig);
    
    log.info(`[MCPConfig] Added MCP server: ${serverConfig.name}`);
    return serverConfig;
  }

  /**
   * 更新 MCP Server
   */
  async updateMCPServer(id: string, updates: Partial<MCPServerConfig>): Promise<MCPServerConfig | null> {
    const server = this.currentConfig.mcpServers[id];
    if (!server) return null;

    Object.assign(server, updates, { updatedAt: Date.now() });
    await this.saveConfig(this.currentConfig);
    
    log.info(`[MCPConfig] Updated MCP server: ${server.name}`);
    return server;
  }

  /**
   * 删除 MCP Server
   */
  async removeMCPServer(id: string): Promise<boolean> {
    if (this.currentConfig.mcpServers[id]) {
      delete this.currentConfig.mcpServers[id];
      await this.saveConfig(this.currentConfig);
      log.info(`[MCPConfig] Removed MCP server: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * 添加 Skill（支持远程安装）
   */
  async addSkill(
    config: Omit<SkillConfig, 'id' | 'createdAt' | 'updatedAt' | 'installStatus' | 'installPath' | 'entry'>,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillConfig> {
    const skillId = this.generateId();
    
    // 创建初始配置
    const skillConfig: SkillConfig = {
      ...config,
      id: skillId,
      installStatus: 'pending',
      installPath: undefined,
      entry: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 保存到配置
    this.currentConfig.skills[skillId] = skillConfig;
    await this.saveConfig(this.currentConfig);
    
    log.info(`[MCPConfig] Added skill: ${skillConfig.name}, source: ${config.source.type}`);
    
    // 如果是远程来源，自动下载安装
    if (config.source.type !== 'builtin' && config.source.type !== 'local') {
      log.info(`[MCPConfig] Starting remote installation for ${skillConfig.name}`);
      
      const installedConfig = await skillManager.installSkillFromSource(skillConfig, onProgress);
      
      // 更新配置
      this.currentConfig.skills[skillId] = installedConfig;
      await this.saveConfig(this.currentConfig);
      
      return installedConfig;
    }
    
    return skillConfig;
  }

  /**
   * 更新 Skill
   */
  async updateSkill(id: string, updates: Partial<SkillConfig>): Promise<SkillConfig | null> {
    const skill = this.currentConfig.skills[id];
    if (!skill) return null;

    Object.assign(skill, updates, { updatedAt: Date.now() });
    await this.saveConfig(this.currentConfig);
    
    log.info(`[MCPConfig] Updated skill: ${skill.name}`);
    return skill;
  }

  /**
   * 删除 Skill（包括卸载本地文件）
   */
  async removeSkill(id: string): Promise<boolean> {
    const skill = this.currentConfig.skills[id];
    if (!skill) return false;

    // 先卸载（删除本地文件）
    await skillManager.uninstallSkill(id);
    
    // 从配置中删除
    delete this.currentConfig.skills[id];
    await this.saveConfig(this.currentConfig);
    
    log.info(`[MCPConfig] Removed skill: ${id}`);
    return true;
  }

  /**
   * 更新全局设置
   */
  async updateSettings(settings: Partial<MCPAndSkillConfig['settings']>): Promise<void> {
    Object.assign(this.currentConfig.settings, settings);
    await this.saveConfig(this.currentConfig);
    log.info('[MCPConfig] Settings updated');
  }

  /**
   * 订阅配置变更
   */
  subscribe(listener: (config: MCPAndSkillConfig) => void): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  /**
   * 导出配置为 JSON 字符串
   */
  exportConfig(): string {
    return JSON.stringify(this.currentConfig, null, 2);
  }

  /**
   * 从 JSON 字符串导入配置
   */
  async importConfig(json: string): Promise<void> {
    const parsed = JSON.parse(json);
    const validated = this.validateConfig(parsed);
    await this.saveConfig(validated);
    log.info('[MCPConfig] Config imported successfully');
  }

  /**
   * 验证配置结构
   */
  private validateConfig(config: unknown): MCPAndSkillConfig {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config: must be an object');
    }

    const c = config as Record<string, unknown>;

    return {
      mcpServers: this.validateMCPServers(c.mcpServers),
      skills: this.validateSkills(c.skills),
      settings: this.validateSettings(c.settings),
    };
  }

  private validateMCPServers(servers: unknown): Record<string, MCPServerConfig> {
    if (!servers || typeof servers !== 'object') {
      return {};
    }
    return servers as Record<string, MCPServerConfig>;
  }

  private validateSkills(skills: unknown): Record<string, SkillConfig> {
    if (!skills || typeof skills !== 'object') {
      return {};
    }
    return skills as Record<string, SkillConfig>;
  }

  private validateSettings(settings: unknown): MCPAndSkillConfig['settings'] {
    const defaultSettings = DEFAULT_CONFIG.settings;
    if (!settings || typeof settings !== 'object') {
      return defaultSettings;
    }
    return { ...defaultSettings, ...settings } as MCPAndSkillConfig['settings'];
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.configListeners.forEach(listener => {
      try {
        listener(this.currentConfig);
      } catch (error) {
        log.error('[MCPConfig] Config listener error:', error);
      }
    });
  }
}

// 单例实例
export const mcpConfigService = new MCPConfigService();
