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
} from './mcp-skill-types';

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
      entry: 'builtin:code-review',
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
      entry: 'builtin:security-review',
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
      entry: 'builtin:debugger',
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
  }

  /**
   * 从文件加载自定义 Skill
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
   * 卸载 Skill
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
      
      return {
        success: true,
        output: '代码审查完成',
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
  private async callLLMForReview(prompt: string): Promise<unknown> {
    // TODO: 集成实际的 LLM 服务调用
    // 这里返回模拟结果
    log.info('[Skill:CodeReview] Calling LLM for review...');
    
    // 模拟 LLM 响应
    return {
      summary: '代码审查完成',
      issues: [],
      suggestions: [],
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
