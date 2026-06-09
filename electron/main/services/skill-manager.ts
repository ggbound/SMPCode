/**
 * Skill 管理器
 * 负责 Skill 的加载、注册、执行管理
 */
import { EventEmitter } from 'events';
import log from 'electron-log';
import {
  SkillConfig,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillType,
  SkillSource,
} from './mcp-skill-types';
import { skillDownloader, DownloadProgressCallback } from './skill-downloader';
import { toolRegistry } from '../cli';

/** Skill 执行函数签名 */
type SkillExecutor = (
  context: SkillExecutionContext,
  args: Record<string, unknown>
) => Promise<SkillExecutionResult>;

/** 已加载的 Skill */
interface LoadedSkill {
  config: SkillConfig;
  executor: SkillExecutor;
}

export class SkillManager extends EventEmitter {
  private skills: Map<string, LoadedSkill> = new Map();
  private configs: Map<string, SkillConfig> = new Map();

  constructor() {
    super();
  }

  /**
   * 注册内置 Skill
   */
  registerBuiltinSkills(): void {
    log.info('[Skill] Registering builtin skills...');
    
    // 注册代码审查 Skill
    this.registerSkill({
      id: 'code-review',
      name: '代码审查',
      description: '审查代码变更，提供质量反馈',
      type: 'code-review',
      version: '1.0.0',
      source: { type: 'builtin', location: 'builtin:code-review' },
      entry: 'builtin:code-review',
      installStatus: 'ready',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, this.executeCodeReview.bind(this));

    // 注册安全审查 Skill
    this.registerSkill({
      id: 'security-review',
      name: '安全审查',
      description: '扫描代码安全漏洞',
      type: 'security',
      version: '1.0.0',
      source: { type: 'builtin', location: 'builtin:security-review' },
      entry: 'builtin:security-review',
      installStatus: 'ready',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, this.executeSecurityReview.bind(this));

    // 注册调试 Skill
    this.registerSkill({
      id: 'debugger',
      name: '智能调试',
      description: '收集运行时证据，科学定位 Bug',
      type: 'debug',
      version: '1.0.0',
      source: { type: 'builtin', location: 'builtin:debugger' },
      entry: 'builtin:debugger',
      installStatus: 'ready',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, this.executeDebugger.bind(this));

    log.info('[Skill] Builtin skills registered');
  }

  /**
   * 注册 Skill
   */
  registerSkill(config: SkillConfig, executor: SkillExecutor): void {
    if (this.skills.has(config.id)) {
      log.warn(`[Skill] Skill ${config.id} already registered, updating...`);
    }

    this.configs.set(config.id, config);
    this.skills.set(config.id, { config, executor });
    
    log.info(`[Skill] Registered: ${config.name} (${config.id})`);
    this.emit('skill-registered', config);

    // 同时注册为 AI 可调用的工具
    this.registerSkillAsTool(config, executor);
  }

  /**
   * 将 Skill 注册为 AI 可调用的工具
   */
  private registerSkillAsTool(config: SkillConfig, executor: SkillExecutor): void {
    try {
      const toolName = `skill_${config.id}`;
      
      // 构建工具参数定义
      const parameters: Record<string, any> = {
        context: {
          type: 'string',
          description: '当前上下文信息，如文件路径、代码片段等'
        },
        args: {
          type: 'object',
          description: 'Skill 执行参数'
        }
      };

      toolRegistry.register({
        name: toolName,
        description: `${config.description} (Skill: ${config.name})`,
        sourceHint: `skill:${config.name}`,
        responsibility: `执行 ${config.name} Skill。当用户需要${config.description}时调用此工具。`,
        parameters,
        required: [],
        execute: async (args: Record<string, unknown>, context: any) => {
          try {
            const skillContext: SkillExecutionContext = {
              sessionId: context.sessionId || 'default',
              currentFile: context.currentFile,
              workspacePath: context.workspacePath,
              userInput: context.userInput,
            };
            
            const result = await executor(skillContext, args.args as Record<string, unknown> || {});
            
            return {
              success: result.success,
              output: result.output || '',
              error: result.error,
              data: result.data
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
      
      log.info(`[Skill] Registered as tool: ${toolName}`);
    } catch (error) {
      log.error(`[Skill] Failed to register skill as tool:`, error);
    }
  }

  /**
   * 从远程来源安装 Skill
   */
  async installSkillFromSource(
    config: Omit<SkillConfig, 'installStatus' | 'installPath' | 'entry'>,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillConfig> {
    try {
      log.info(`[Skill] Installing skill from ${config.source.type}: ${config.source.location}`);
      
      // 更新状态为下载中
      const skillConfig: SkillConfig = {
        ...config,
        installStatus: 'downloading',
        installPath: undefined,
        entry: undefined,
      };
      
      // 下载并安装
      const result = await skillDownloader.downloadAndInstall(
        config.id,
        config.source,
        onProgress
      );
      
      if (!result.success) {
        skillConfig.installStatus = 'error';
        skillConfig.installError = result.error;
        log.error(`[Skill] Failed to install skill ${config.name}:`, result.error);
        return skillConfig;
      }
      
      // 更新配置
      skillConfig.installStatus = 'ready';
      skillConfig.installPath = result.installPath;
      skillConfig.entry = result.entryFile;
      
      log.info(`[Skill] Skill ${config.name} installed successfully at ${result.installPath}`);
      
      // 如果是本地文件，尝试加载执行器
      if (result.entryFile && result.installPath) {
        await this.loadSkillExecutor(skillConfig);
      }
      
      return skillConfig;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`[Skill] Failed to install skill ${config.name}:`, error);
      return {
        ...config,
        installStatus: 'error',
        installError: errorMsg,
      };
    }
  }

  /**
   * 加载 Skill 执行器
   */
  private async loadSkillExecutor(config: SkillConfig): Promise<void> {
    if (!config.entry || !config.installPath) return;
    
    try {
      const entryPath = config.installPath === 'builtin' 
        ? config.entry 
        : require('path').join(config.installPath, config.entry);
      
      log.info(`[Skill] Loading executor from: ${entryPath}`);
      
      // 动态加载模块
      const module = require(entryPath);
      
      if (module.execute && typeof module.execute === 'function') {
        this.registerSkill(config, module.execute.bind(module));
        log.info(`[Skill] Executor loaded for ${config.name}`);
      } else {
        log.warn(`[Skill] No execute function found in ${entryPath}`);
      }
    } catch (error) {
      log.error(`[Skill] Failed to load executor for ${config.name}:`, error);
    }
  }

  /**
   * 从文件加载自定义 Skill（旧版兼容）
   */
  async loadSkillFromFile(filePath: string): Promise<boolean> {
    try {
      log.info(`[Skill] Loading skill from: ${filePath}`);
      // TODO: 动态加载 TypeScript/JavaScript 模块
      // const module = await import(filePath);
      // this.registerSkill(module.config, module.execute);
      return true;
    } catch (error) {
      log.error(`[Skill] Failed to load skill from ${filePath}:`, error);
      return false;
    }
  }

  /**
   * 卸载 Skill（包括删除本地文件）
   */
  async uninstallSkill(id: string): Promise<boolean> {
    const config = this.configs.get(id);
    if (!config) {
      log.warn(`[Skill] Skill ${id} not found`);
      return false;
    }

    try {
      // 如果是远程安装的 Skill，删除本地文件
      if (config.source.type !== 'builtin' && config.installPath && config.installPath !== 'builtin') {
        await skillDownloader.uninstall(id);
      }

      // 从注册表中移除
      this.skills.delete(id);
      this.configs.delete(id);
      
      log.info(`[Skill] Uninstalled: ${id}`);
      this.emit('skill-uninstalled', id);
      return true;
    } catch (error) {
      log.error(`[Skill] Failed to uninstall ${id}:`, error);
      return false;
    }
  }

  /**
   * 从注册表中移除 Skill（不删除文件）
   */
  unregisterSkill(id: string): void {
    if (this.skills.has(id)) {
      this.skills.delete(id);
      this.configs.delete(id);
      log.info(`[Skill] Unregistered: ${id}`);
      this.emit('skill-unregistered', id);
    }
  }

  /**
   * 执行 Skill
   */
  async executeSkill(
    id: string,
    context: SkillExecutionContext,
    args: Record<string, unknown> = {}
  ): Promise<SkillExecutionResult> {
    const skill = this.skills.get(id);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${id}`,
      };
    }

    if (!skill.config.enabled) {
      return {
        success: false,
        error: `Skill ${id} is disabled`,
      };
    }

    log.info(`[Skill] Executing: ${skill.config.name}`);
    this.emit('skill-executing', id, context);

    try {
      const result = await skill.executor(context, args);
      log.info(`[Skill] ${skill.config.name} executed: ${result.success ? 'success' : 'failed'}`);
      this.emit('skill-executed', id, result);
      return result;
    } catch (error) {
      const result: SkillExecutionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      log.error(`[Skill] ${skill.config.name} execution failed:`, error);
      this.emit('skill-executed', id, result);
      return result;
    }
  }

  /**
   * 获取 Skill 配置
   */
  getSkillConfig(id: string): SkillConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * 获取所有 Skill 配置
   */
  getAllSkillConfigs(): SkillConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 按类型获取 Skills
   */
  getSkillsByType(type: SkillType): SkillConfig[] {
    return this.getAllSkillConfigs().filter(s => s.type === type);
  }

  /**
   * 启用/禁用 Skill
   */
  setSkillEnabled(id: string, enabled: boolean): void {
    const config = this.configs.get(id);
    if (config) {
      config.enabled = enabled;
      config.updatedAt = Date.now();
      this.configs.set(id, config);
      
      const skill = this.skills.get(id);
      if (skill) {
        skill.config.enabled = enabled;
      }
      
      log.info(`[Skill] ${config.name} ${enabled ? 'enabled' : 'disabled'}`);
      this.emit('skill-status-change', id, enabled);
    }
  }

  /**
   * 更新 Skill 配置
   */
  updateSkillConfig(id: string, updates: Partial<SkillConfig>): void {
    const config = this.configs.get(id);
    if (config) {
      Object.assign(config, updates, { updatedAt: Date.now() });
      this.configs.set(id, config);
      
      const skill = this.skills.get(id);
      if (skill) {
        Object.assign(skill.config, updates, { updatedAt: Date.now() });
      }
      
      this.emit('skill-config-updated', config);
    }
  }

  // ==================== 内置 Skill 执行器 ====================

  /**
   * 代码审查 Skill 执行器
   * 调用 TRAE-code-review skill 进行代码审查
   */
  private async executeCodeReview(
    context: SkillExecutionContext,
    args: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    log.info('[Skill:CodeReview] Starting code review...');
    
    try {
      // 获取需要审查的文件或变更
      const files = args.files as string[] | undefined;
      const diff = args.diff as string | undefined;
      
      if (!files && !diff) {
        return {
          success: false,
          error: '请提供要审查的文件列表或代码变更（diff）',
        };
      }
      
      // 构建审查提示词
      const reviewPrompt = this.buildCodeReviewPrompt(files, diff, context);
      
      // 调用 LLM 进行代码审查
      // 注意：实际项目中应该调用 anthropic-service 或其他 LLM 服务
      const result = await this.callLLMForReview(reviewPrompt);
      
      // 构建格式化的审查报告
      let reviewReport = `## 代码审查报告\n\n`;
      reviewReport += `${result.summary}\n\n`;
      
      if (result.issues && result.issues.length > 0) {
        reviewReport += `### 发现的问题\n\n`;
        for (const issue of result.issues) {
          const severityEmoji = issue.severity === 'error' ? '❌' : 
                               issue.severity === 'warning' ? '⚠️' : 'ℹ️';
          reviewReport += `- ${severityEmoji} **${issue.severity.toUpperCase()}**: ${issue.message}\n`;
        }
        reviewReport += '\n';
      }
      
      if (result.suggestions && result.suggestions.length > 0) {
        reviewReport += `### 改进建议\n\n`;
        for (const suggestion of result.suggestions) {
          reviewReport += `- 💡 ${suggestion}\n`;
        }
        reviewReport += '\n';
      }
      
      if (files && files.length > 0) {
        reviewReport += `### 审查文件\n\n`;
        for (const file of files) {
          reviewReport += `- 📄 ${file}\n`;
        }
      }
      
      return {
        success: true,
        output: reviewReport,
        data: {
          review: result,
          reviewedFiles: files || [],
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      log.error('[Skill:CodeReview] Code review failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 安全审查 Skill 执行器
   * 调用 TRAE-security-review skill 进行安全扫描
   */
  private async executeSecurityReview(
    context: SkillExecutionContext,
    args: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    log.info('[Skill:SecurityReview] Starting security review...');
    
    try {
      const files = args.files as string[] | undefined;
      const code = args.code as string | undefined;
      
      if (!files && !code) {
        return {
          success: false,
          error: '请提供要扫描的文件列表或代码内容',
        };
      }
      
      // 构建安全审查提示词
      const securityPrompt = this.buildSecurityReviewPrompt(files, code, context);
      
      // 调用 LLM 进行安全审查
      const result = await this.callLLMForSecurityReview(securityPrompt);
      
      return {
        success: true,
        output: '安全审查完成',
        data: {
          vulnerabilities: result.vulnerabilities || [],
          recommendations: result.recommendations || [],
          riskLevel: result.riskLevel || 'low',
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      log.error('[Skill:SecurityReview] Security review failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 调试 Skill 执行器
   * 调用 TRAE-debugger skill 进行智能调试
   */
  private async executeDebugger(
    context: SkillExecutionContext,
    args: Record<string, unknown>
  ): Promise<SkillExecutionResult> {
    log.info('[Skill:Debugger] Starting debug session...');
    
    try {
      const errorMessage = args.error as string | undefined;
      const stackTrace = args.stackTrace as string | undefined;
      const filePath = args.filePath as string | undefined;
      
      if (!errorMessage) {
        return {
          success: false,
          error: '请提供错误信息',
        };
      }
      
      // 构建调试提示词
      const debugPrompt = this.buildDebugPrompt(errorMessage, stackTrace, filePath, context);
      
      // 调用 LLM 进行调试分析
      const result = await this.callLLMForDebug(debugPrompt);
      
      return {
        success: true,
        output: '调试分析完成',
        data: {
          analysis: result.analysis,
          rootCause: result.rootCause,
          suggestions: result.suggestions || [],
          sessionId: context.sessionId,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      log.error('[Skill:Debugger] Debug session failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 构建代码审查提示词
   */
  private buildCodeReviewPrompt(
    files: string[] | undefined,
    diff: string | undefined,
    context: SkillExecutionContext
  ): string {
    let prompt = '请对以下代码进行审查，关注以下方面：\n\n';
    prompt += '1. 代码质量和可读性\n';
    prompt += '2. 潜在的错误或 Bug\n';
    prompt += '3. 性能问题\n';
    prompt += '4. 最佳实践遵循情况\n';
    prompt += '5. 安全漏洞\n\n';
    
    if (diff) {
      prompt += '代码变更（diff）：\n```\n' + diff + '\n```\n\n';
    }
    
    if (files && files.length > 0) {
      prompt += '涉及文件：\n' + files.join('\n') + '\n\n';
    }
    
    if (context.currentFile) {
      prompt += '当前文件：' + context.currentFile + '\n';
    }
    
    prompt += '请提供详细的审查意见，包括：\n';
    prompt += '- 发现的问题（按严重程度分类）\n';
    prompt += '- 改进建议\n';
    prompt += '- 代码示例（如有）\n';
    
    return prompt;
  }

  /**
   * 构建安全审查提示词
   */
  private buildSecurityReviewPrompt(
    files: string[] | undefined,
    code: string | undefined,
    context: SkillExecutionContext
  ): string {
    let prompt = '请对以下代码进行安全审查，重点关注：\n\n';
    prompt += '1. 注入攻击（SQL、命令、代码注入）\n';
    prompt += '2. 敏感信息泄露（密钥、密码、token）\n';
    prompt += '3. 不安全的反序列化\n';
    prompt += '4. 路径遍历和目录遍历\n';
    prompt += '5. 不安全的依赖\n';
    prompt += '6. XSS 和 CSRF 漏洞\n';
    prompt += '7. 认证和授权问题\n\n';
    
    if (code) {
      prompt += '代码内容：\n```\n' + code + '\n```\n\n';
    }
    
    if (files && files.length > 0) {
      prompt += '涉及文件：\n' + files.join('\n') + '\n\n';
    }
    
    prompt += '请提供：\n';
    prompt += '- 发现的安全漏洞（按风险等级分类：高危/中危/低危）\n';
    prompt += '- 漏洞描述和潜在影响\n';
    prompt += '- 修复建议和代码示例\n';
    prompt += '- 预防此类问题的最佳实践\n';
    
    return prompt;
  }

  /**
   * 构建调试提示词
   */
  private buildDebugPrompt(
    errorMessage: string,
    stackTrace: string | undefined,
    filePath: string | undefined,
    context: SkillExecutionContext
  ): string {
    let prompt = '请分析以下错误并提供调试建议：\n\n';
    prompt += '错误信息：\n```\n' + errorMessage + '\n```\n\n';
    
    if (stackTrace) {
      prompt += '堆栈跟踪：\n```\n' + stackTrace + '\n```\n\n';
    }
    
    if (filePath) {
      prompt += '相关文件：' + filePath + '\n';
    }
    
    if (context.currentFile) {
      prompt += '当前文件：' + context.currentFile + '\n';
    }
    
    if (context.workspacePath) {
      prompt += '工作区：' + context.workspacePath + '\n';
    }
    
    prompt += '\n请提供：\n';
    prompt += '1. 错误原因分析\n';
    prompt += '2. 可能的根本原因\n';
    prompt += '3. 修复建议\n';
    prompt += '4. 调试步骤（如果需要进一步调查）\n';
    prompt += '5. 预防措施\n';
    
    return prompt;
  }

  /**
   * 调用 LLM 进行代码审查
   * 注意：实际项目中应该调用 anthropic-service 或其他 LLM 服务
   */
  private async callLLMForReview(prompt: string): Promise<{
    summary: string;
    issues: Array<{ severity: string; message: string; line?: number }>;
    suggestions: string[];
  }> {
    // TODO: 集成实际的 LLM 服务调用
    // 这里返回模拟结果，包含实际的审查内容
    log.info('[Skill:CodeReview] Calling LLM for review...');
    
    // 模拟 LLM 响应，返回实际的审查内容
    return {
      summary: '代码审查完成。整体代码质量良好，建议关注以下几点：',
      issues: [
        { severity: 'info', message: '建议添加更多的注释说明复杂逻辑' },
        { severity: 'warning', message: '部分函数过长，建议拆分为更小的函数' }
      ],
      suggestions: [
        '添加 JSDoc 注释以提高代码可读性',
        '考虑使用更语义化的变量命名',
        '建议添加单元测试覆盖关键逻辑'
      ],
    };
  }

  /**
   * 调用 LLM 进行安全审查
   */
  private async callLLMForSecurityReview(prompt: string): Promise<{
    vulnerabilities: Array<{ type: string; severity: string; description: string }>;
    recommendations: string[];
    riskLevel: string;
  }> {
    log.info('[Skill:SecurityReview] Calling LLM for security review...');
    
    // 模拟 LLM 响应
    return {
      vulnerabilities: [],
      recommendations: [],
      riskLevel: 'low',
    };
  }

  /**
   * 调用 LLM 进行调试分析
   */
  private async callLLMForDebug(prompt: string): Promise<{
    analysis: string;
    rootCause: string;
    suggestions: string[];
  }> {
    log.info('[Skill:Debugger] Calling LLM for debug analysis...');
    
    // 模拟 LLM 响应
    return {
      analysis: '调试分析完成',
      rootCause: '未知',
      suggestions: [],
    };
  }
}

// 单例实例
export const skillManager = new SkillManager();
