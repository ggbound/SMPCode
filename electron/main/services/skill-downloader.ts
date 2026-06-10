/**
 * Skill 下载器服务
 * 支持从 npm、github、url 下载 Skill
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import log from 'electron-log';
import type { SkillSource, SkillInstallStatus } from './mcp-skill-types';

/** 下载进度回调 */
export type DownloadProgressCallback = (progress: {
  status: SkillInstallStatus;
  progress?: number;
  message: string;
  error?: string;
}) => void;

/** Skill 下载结果 */
export interface SkillDownloadResult {
  success: boolean;
  installPath?: string;
  entryFile?: string;
  error?: string;
}

/** Skill 下载器 */
export class SkillDownloader {
  private skillsDir: string;

  constructor() {
    // Skill 安装目录：用户数据目录下的 skills 文件夹
    const userDataPath = app.getPath('userData');
    this.skillsDir = path.join(userDataPath, 'skills');
  }

  /**
   * 确保 skills 目录存在
   */
  private async ensureSkillsDir(): Promise<void> {
    try {
      await fs.mkdir(this.skillsDir, { recursive: true });
    } catch (error) {
      log.error('[SkillDownloader] Failed to create skills directory:', error);
      throw error;
    }
  }

  /**
   * 获取 Skill 的安装路径
   */
  getSkillInstallPath(skillId: string): string {
    return path.join(this.skillsDir, skillId);
  }

  /**
   * 下载并安装 Skill
   */
  async downloadAndInstall(
    skillId: string,
    source: SkillSource,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    try {
      await this.ensureSkillsDir();
      const installPath = this.getSkillInstallPath(skillId);

      // 报告开始下载
      onProgress?.({ status: 'downloading', progress: 0, message: '开始下载...' });

      switch (source.type) {
        case 'builtin':
          return await this.installBuiltin(skillId, source, installPath, onProgress);
        case 'local':
          return await this.installLocal(skillId, source, installPath, onProgress);
        case 'npm':
          return await this.installFromNpm(skillId, source, installPath, onProgress);
        case 'github':
          return await this.installFromGithub(skillId, source, installPath, onProgress);
        case 'url':
          return await this.installFromUrl(skillId, source, installPath, onProgress);
        default:
          throw new Error(`Unsupported source type: ${source.type}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[SkillDownloader] Download failed:', error);
      onProgress?.({ status: 'error', message: '下载失败', error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 安装内置 Skill
   */
  private async installBuiltin(
    skillId: string,
    source: SkillSource,
    installPath: string,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    // 内置 Skill 不需要下载，直接使用应用内置的
    onProgress?.({ status: 'ready', progress: 100, message: '内置 Skill，无需下载' });
    return {
      success: true,
      installPath: 'builtin',
      entryFile: source.location.replace('builtin:', '')
    };
  }

  /**
   * 安装本地 Skill
   */
  private async installLocal(
    skillId: string,
    source: SkillSource,
    installPath: string,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    const localPath = source.location;
    
    // 检查本地路径是否存在
    try {
      await fs.access(localPath);
    } catch {
      throw new Error(`Local path does not exist: ${localPath}`);
    }

    // 复制到 skills 目录
    onProgress?.({ status: 'installing', progress: 50, message: '复制本地文件...' });
    await this.copyDirectory(localPath, installPath);

    // 查找入口文件
    const entryFile = await this.findEntryFile(installPath);
    
    onProgress?.({ status: 'ready', progress: 100, message: '安装完成' });
    return {
      success: true,
      installPath,
      entryFile
    };
  }

  /**
   * 从 npm 安装 Skill
   */
  private async installFromNpm(
    skillId: string,
    source: SkillSource,
    installPath: string,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    const packageName = source.location;
    const version = source.version || 'latest';

    onProgress?.({ status: 'downloading', progress: 20, message: `正在下载 npm 包 ${packageName}...` });

    // 使用 npm pack 下载包
    const tempDir = path.join(app.getPath('temp'), `skill-${skillId}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // 下载 npm 包
      const fullPackageName = source.version ? `${packageName}@${source.version}` : packageName;
      await this.execCommand('npm', ['pack', fullPackageName], tempDir);

      // 查找下载的 tarball
      const files = await fs.readdir(tempDir);
      const tarball = files.find(f => f.endsWith('.tgz'));
      if (!tarball) {
        throw new Error('Failed to download npm package');
      }

      onProgress?.({ status: 'installing', progress: 60, message: '解压 npm 包...' });

      // 解压到安装目录
      await fs.mkdir(installPath, { recursive: true }).catch(() => {});
      await this.execCommand('tar', ['-xzf', path.join(tempDir, tarball), '-C', installPath, '--strip-components=1']);

      // 安装依赖
      onProgress?.({ status: 'installing', progress: 80, message: '安装依赖...' });
      await this.execCommand('npm', ['install', '--production'], installPath);

      // 查找入口文件
      const entryFile = await this.findEntryFile(installPath);

      onProgress?.({ status: 'ready', progress: 100, message: '安装完成' });
      return {
        success: true,
        installPath,
        entryFile
      };
    } finally {
      // 清理临时目录
      await this.removeDirectory(tempDir);
    }
  }

  /**
   * 解析 Git URL（支持 GitHub 和 Gitee）
   * 支持格式:
   * - owner/repo - 下载整个仓库
   * - owner/repo#branch - 下载指定分支
   * - owner/repo/path/to/subdir - 下载子目录
   * - owner/repo/path/to/subdir#branch - 下载指定分支的子目录
   * - https://github.com/owner/repo/tree/branch/path - GitHub 网页 URL
   * - https://github.com/owner/repo/blob/branch/path - GitHub 网页 URL
   * - https://gitee.com/owner/repo/tree/branch/path - Gitee 网页 URL
   */
  private parseGitUrl(location: string): { 
    owner: string; 
    repo: string; 
    subPath: string; 
    branch: string;
    platform: 'github' | 'gitee';
  } {
    // 移除 https:// 前缀
    let cleanLocation = location.replace(/^https?:\/\//, '');
    
    // 检测平台
    let platform: 'github' | 'gitee' = 'github';
    if (cleanLocation.startsWith('gitee.com/')) {
      platform = 'gitee';
      cleanLocation = cleanLocation.replace(/^gitee\.com\//, '');
    } else if (cleanLocation.startsWith('github.com/')) {
      cleanLocation = cleanLocation.replace(/^github\.com\//, '');
    }

    // 尝试匹配网页 URL 格式: owner/repo/tree/branch/path 或 owner/repo/blob/branch/path
    const treeMatch = cleanLocation.match(/^([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)\/?(.*)$/);
    if (treeMatch) {
      return {
        owner: treeMatch[1],
        repo: treeMatch[2],
        branch: treeMatch[3],
        subPath: treeMatch[4] || '',
        platform
      };
    }

    // 尝试匹配简写格式: owner/repo/path#branch
    const hashMatch = cleanLocation.match(/^([^/]+)\/([^/]+)(\/[^#]*)?(?:#(.+))?$/);
    if (hashMatch) {
      return {
        owner: hashMatch[1],
        repo: hashMatch[2],
        subPath: hashMatch[3] ? hashMatch[3].slice(1) : '', // 移除开头的 /
        branch: hashMatch[4] || 'main',
        platform
      };
    }

    throw new Error(`Invalid Git source format: ${location}`);
  }

  /**
   * 验证 zip 文件是否有效
   */
  private async isValidZip(filePath: string): Promise<boolean> {
    try {
      const buffer = await fs.readFile(filePath, { encoding: null, flag: 'r' });
      // ZIP 文件的魔数是 0x50 0x4B 0x03 0x04 (PK\x03\x04)
      return buffer.length >= 4 && 
             buffer[0] === 0x50 && 
             buffer[1] === 0x4B && 
             buffer[2] === 0x03 && 
             buffer[3] === 0x04;
    } catch {
      return false;
    }
  }

  /**
   * 从 Git 仓库安装 Skill（支持 GitHub 和 Gitee）
   */
  private async installFromGithub(
    skillId: string,
    source: SkillSource,
    installPath: string,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    // 解析 Git 地址
    const parsed = this.parseGitUrl(source.location);
    const { owner, repo, subPath, platform } = parsed;
    const specifiedBranch = source.version || parsed.branch || 'main';

    const platformName = platform === 'gitee' ? 'Gitee' : 'GitHub';
    const gitUrl = platform === 'gitee' 
      ? `https://gitee.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    onProgress?.({ status: 'downloading', progress: 20, message: `正在从 ${platformName} 下载 ${owner}/${repo}...` });

    // 根据平台构建下载 URL
    let possibleUrls: string[];
    if (platform === 'gitee') {
      // Gitee 下载 URL 格式（尝试多种格式）
      possibleUrls = [
        `https://gitee.com/${owner}/${repo}/repository/archive/${specifiedBranch}.zip`,
        `https://gitee.com/${owner}/${repo}/repository/archive/master.zip`,
        `https://gitee.com/${owner}/${repo}/repository/archive/main.zip`,
        `https://gitee.com/${owner}/${repo}/archive/${specifiedBranch}.zip`,
        `https://gitee.com/${owner}/${repo}/archive/master.zip`,
        `https://gitee.com/${owner}/${repo}/archive/main.zip`,
      ];
    } else {
      // GitHub 下载 URL 格式
      possibleUrls = [
        `https://github.com/${owner}/${repo}/archive/refs/heads/${specifiedBranch}.zip`,
        `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
        `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`,
        `https://github.com/${owner}/${repo}/archive/${specifiedBranch}.zip`,
      ];
    }

    const tempDir = path.join(app.getPath('temp'), `skill-${skillId}-${Date.now()}`);
    const zipPath = path.join(tempDir, 'download.zip');
    await fs.mkdir(tempDir, { recursive: true });

    try {
      let downloadSuccess = false;
      let lastError: Error | null = null;
      const maxRetries = 3;

      // 尝试不同的 URL，每个 URL 重试 3 次
      for (const downloadUrl of possibleUrls) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            log.info(`[SkillDownloader] Trying ${platformName} URL (attempt ${attempt}/${maxRetries}): ${downloadUrl}`);
            onProgress?.({ 
              status: 'downloading', 
              progress: 20 + (attempt * 5), 
              message: `正在从 ${platformName} 下载 ${owner}/${repo} (尝试 ${attempt}/${maxRetries})...` 
            });
            
            await this.downloadFileWithRetry(downloadUrl, zipPath, 3);
            
            // 验证下载的文件是否是有效的 zip
            const isValid = await this.isValidZip(zipPath);
            if (!isValid) {
              log.warn(`[SkillDownloader] Downloaded file is not a valid zip: ${downloadUrl}`);
              // 读取文件前几个字节用于调试
              try {
                const buffer = await fs.readFile(zipPath, { encoding: null, flag: 'r' });
                const preview = buffer.slice(0, 100).toString();
                log.info(`[SkillDownloader] File preview: ${preview}`);
              } catch {}
              throw new Error('Downloaded file is not a valid zip archive');
            }
            
            downloadSuccess = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            log.warn(`[SkillDownloader] Failed to download from ${downloadUrl} (attempt ${attempt}/${maxRetries}):`, lastError.message);
            
            if (attempt < maxRetries) {
              // 等待后重试
              const delay = attempt * 1000; // 1s, 2s, 3s
              log.info(`[SkillDownloader] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        if (downloadSuccess) break;
      }

      // 如果 zip 下载失败，尝试使用 git clone
      if (!downloadSuccess) {
        log.info(`[SkillDownloader] Zip download failed, trying git clone from ${gitUrl}...`);
        onProgress?.({ status: 'downloading', progress: 40, message: `使用 git clone 下载 ${owner}/${repo}...` });
        
        try {
          // 使用不同的临时目录名称避免冲突
          const gitTempDir = path.join(app.getPath('temp'), `skill-git-${skillId}-${Date.now()}`);
          await this.execCommand('git', ['clone', '--depth', '1', '--branch', specifiedBranch, gitUrl, gitTempDir], app.getPath('temp'));
          
          // git clone 成功后，处理子目录
          const finalSourcePath = subPath ? path.join(gitTempDir, subPath) : gitTempDir;
          
          // 检查子目录是否存在
          try {
            await fs.access(finalSourcePath);
            const stats = await fs.stat(finalSourcePath);
            log.info(`[SkillDownloader] Git clone source path: ${finalSourcePath}, isDirectory: ${stats.isDirectory()}`);
          } catch {
            log.error(`[SkillDownloader] Subdirectory not found after git clone: ${subPath}`);
            // 列出克隆的目录结构
            await this.listDirectoryStructure(gitTempDir, 0);
            throw new Error(`Subdirectory not found: ${subPath}`);
          }

          // 移动到安装目录
          await fs.mkdir(installPath, { recursive: true }).catch(() => {});
          await this.copyDirectory(finalSourcePath, installPath);
          log.info(`[SkillDownloader] Copied from git clone to: ${installPath}`);
          
          // 清理 git 临时目录
          await this.removeDirectory(gitTempDir);
          
          // 检查是否存在 package.json，如果存在则安装依赖
          const packageJsonPath2 = path.join(installPath, 'package.json');
          try {
            await fs.access(packageJsonPath2);
            log.info(`[SkillDownloader] Found package.json, installing dependencies...`);
            onProgress?.({ status: 'installing', progress: 80, message: '安装依赖...' });
            await this.execCommand('npm', ['install', '--production'], installPath);
          } catch {
            log.info(`[SkillDownloader] No package.json found, skipping npm install`);
          }

          // 查找入口文件
          const entryFile = await this.findEntryFile(installPath);

          onProgress?.({ status: 'ready', progress: 100, message: '安装完成' });
          return {
            success: true,
            installPath,
            entryFile
          };
        } catch (gitError) {
          log.error(`[SkillDownloader] Git clone also failed:`, gitError);
          const errorMsg = String(gitError);
          if (errorMsg.includes('could not read Username') || errorMsg.includes('Authentication failed')) {
            throw new Error(`仓库 ${owner}/${repo} 需要认证或不存在。请检查：\n1. 仓库地址是否正确\n2. 仓库是否为公开仓库\n3. 如果需要认证，请使用 git clone 手动克隆`);
          }
          throw lastError || new Error(`Failed to download from ${platformName}: ${gitError}`);
        }
      }

      onProgress?.({ status: 'installing', progress: 60, message: '解压文件...' });

      // 解压
      await this.execCommand('unzip', ['-q', zipPath, '-d', tempDir]);

      // 查找解压后的目录
      const extractedDirs = await fs.readdir(tempDir);
      log.info(`[SkillDownloader] Extracted directories:`, extractedDirs);
      
      const sourceDir = extractedDirs.find(d => d.startsWith(`${repo}-`) && !d.endsWith('.zip'));
      if (!sourceDir) {
        throw new Error('Failed to find extracted directory');
      }

      const extractedPath = path.join(tempDir, sourceDir);
      log.info(`[SkillDownloader] Extracted path: ${extractedPath}`);

      // 如果指定了子目录，使用子目录
      const finalSourcePath = subPath ? path.join(extractedPath, subPath) : extractedPath;
      log.info(`[SkillDownloader] Final source path: ${finalSourcePath}`);

      // 检查子目录是否存在
      try {
        await fs.access(finalSourcePath);
        const stats = await fs.stat(finalSourcePath);
        log.info(`[SkillDownloader] Source path exists: ${finalSourcePath}, isDirectory: ${stats.isDirectory()}`);
      } catch (error) {
        // 列出解压后的目录结构，帮助诊断
        log.error(`[SkillDownloader] Subdirectory not found: ${finalSourcePath}`);
        log.info(`[SkillDownloader] Listing extracted directory structure...`);
        await this.listDirectoryStructure(extractedPath, 0);
        throw new Error(`Subdirectory not found: ${subPath}`);
      }

      // 移动到安装目录
      await fs.mkdir(installPath, { recursive: true }).catch(() => {});
      await this.copyDirectory(finalSourcePath, installPath);
      log.info(`[SkillDownloader] Copied to: ${installPath}`);

      // 检查是否存在 package.json，如果存在则安装依赖
      const packageJsonPath = path.join(installPath, 'package.json');
      try {
        await fs.access(packageJsonPath);
        log.info(`[SkillDownloader] Found package.json, installing dependencies...`);
        onProgress?.({ status: 'installing', progress: 80, message: '安装依赖...' });
        await this.execCommand('npm', ['install', '--production'], installPath);
      } catch {
        log.info(`[SkillDownloader] No package.json found, skipping npm install`);
      }

      // 查找入口文件
      const entryFile = await this.findEntryFile(installPath);

      onProgress?.({ status: 'ready', progress: 100, message: '安装完成' });
      return {
        success: true,
        installPath,
        entryFile
      };
    } finally {
      // 清理临时目录
      await this.removeDirectory(tempDir);
    }
  }

  /**
   * 下载文件（带重试）
   */
  private async downloadFileWithRetry(url: string, destPath: string, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.downloadFile(url, destPath);
        return; // 成功，直接返回
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries) {
          const delay = attempt * 1000; // 1s, 2s, 3s
          log.warn(`[SkillDownloader] Download attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`Failed to download after ${maxRetries} attempts`);
  }

  /**
   * 从 URL 安装 Skill
   */
  private async installFromUrl(
    skillId: string,
    source: SkillSource,
    installPath: string,
    onProgress?: DownloadProgressCallback
  ): Promise<SkillDownloadResult> {
    const url = source.location;
    const isZip = url.endsWith('.zip');
    const isTarGz = url.endsWith('.tar.gz') || url.endsWith('.tgz');

    if (!isZip && !isTarGz) {
      throw new Error('URL must point to a .zip or .tar.gz file');
    }

    onProgress?.({ status: 'downloading', progress: 20, message: '正在下载文件...' });

    const tempDir = path.join(app.getPath('temp'), `skill-${skillId}-${Date.now()}`);
    const archivePath = path.join(tempDir, isZip ? 'download.zip' : 'download.tar.gz');
    await fs.mkdir(tempDir, { recursive: true });

    try {
      await this.downloadFile(url, archivePath);

      onProgress?.({ status: 'installing', progress: 60, message: '解压文件...' });

      await fs.mkdir(installPath, { recursive: true }).catch(() => {});

      if (isZip) {
        await this.execCommand('unzip', ['-q', archivePath, '-d', installPath]);
      } else {
        await this.execCommand('tar', ['-xzf', archivePath, '-C', installPath]);
      }

      // 如果解压后只有一个子目录，将其内容提升到根目录
      const entries = await fs.readdir(installPath);
      if (entries.length === 1) {
        const subDir = path.join(installPath, entries[0]);
        const stats = await fs.stat(subDir);
        if (stats.isDirectory()) {
          const tempSubDir = path.join(tempDir, 'sub');
          await fs.rename(subDir, tempSubDir);
          await this.copyDirectory(tempSubDir, installPath);
          await this.removeDirectory(tempSubDir);
        }
      }

      // 安装依赖
      onProgress?.({ status: 'installing', progress: 80, message: '安装依赖...' });
      await this.execCommand('npm', ['install', '--production'], installPath);

      // 查找入口文件
      const entryFile = await this.findEntryFile(installPath);

      onProgress?.({ status: 'ready', progress: 100, message: '安装完成' });
      return {
        success: true,
        installPath,
        entryFile
      };
    } finally {
      // 清理临时目录
      await this.removeDirectory(tempDir);
    }
  }

  /**
   * 查找入口文件
   */
  private async findEntryFile(installPath: string): Promise<string | undefined> {
    // 可能的入口文件名
    const possibleEntries = [
      'index.ts',
      'index.js',
      'skill.ts',
      'skill.js',
      'main.ts',
      'main.js',
      'src/index.ts',
      'src/index.js',
      'src/skill.ts',
      'src/skill.js',
    ];

    for (const entry of possibleEntries) {
      const fullPath = path.join(installPath, entry);
      try {
        await fs.access(fullPath);
        return entry;
      } catch {
        // 文件不存在，继续查找
      }
    }

    // 如果没有找到，尝试读取 package.json 的 main 字段
    try {
      const packageJsonPath = path.join(installPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (packageJson.main) {
        return packageJson.main;
      }
    } catch {
      // package.json 不存在或解析失败
    }

    return undefined;
  }

  /**
   * 下载文件
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https:') ? https : http;
      const file = require('fs').createWriteStream(destPath);

      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // 重定向
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        reject(err);
      });
    });
  }

  /**
   * 执行命令
   */
  private async execCommand(command: string, args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: { cwd?: string; shell: boolean; env: NodeJS.ProcessEnv } = {
        shell: true,
        env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` }
      }
      if (cwd) {
        options.cwd = cwd
      }
      const child = spawn(command, args, options)

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 复制目录
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true }).catch(() => {});
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 列出目录结构（用于调试）
   */
  private async listDirectoryStructure(dir: string, depth: number): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const indent = '  '.repeat(depth);
        log.info(`${indent}${entry.name}${entry.isDirectory() ? '/' : ''}`);
        if (entry.isDirectory() && depth < 3) {
          await this.listDirectoryStructure(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch (error) {
      log.error(`[SkillDownloader] Failed to list directory: ${dir}`, error);
    }
  }

  /**
   * 删除目录
   */
  private async removeDirectory(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      log.warn('[SkillDownloader] Failed to remove directory:', dir, error);
    }
  }

  /**
   * 删除已安装的 Skill
   */
  async uninstall(skillId: string): Promise<boolean> {
    try {
      const installPath = this.getSkillInstallPath(skillId);
      await this.removeDirectory(installPath);
      log.info(`[SkillDownloader] Uninstalled skill: ${skillId}`);
      return true;
    } catch (error) {
      log.error(`[SkillDownloader] Failed to uninstall skill ${skillId}:`, error);
      return false;
    }
  }
}

// 导出单例实例
export const skillDownloader = new SkillDownloader();
