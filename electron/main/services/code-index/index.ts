/**
 * CodeIndex - 代码索引服务
 * 实现项目代码结构、符号定义、文件关系的索引和持久化
 * 参考 Cursor 和 Claude Code 的代码索引方案
 */

import log from 'electron-log'
import * as fs from 'fs/promises'
import * as path from 'path'
import { glob } from 'glob'
import { createHash } from 'crypto'

// ==================== 类型定义 ====================

// 代码符号
export interface CodeSymbol {
  id: string
  name: string
  type: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'export'
  filePath: string
  line: number
  column: number
  signature?: string
  docstring?: string
  dependencies: string[]  // 依赖的其他符号
  dependents: string[]    // 被哪些符号依赖
}

// 文件索引
export interface FileIndex {
  path: string
  hash: string           // 文件内容指纹
  size: number
  lastModified: number
  symbols: CodeSymbol[]
  imports: string[]       // 导入的模块
  exports: string[]       // 导出的内容
  summary: string         // AI 生成的摘要
}

// 项目索引
export interface ProjectIndex {
  projectPath: string
  version: number
  createdAt: number
  updatedAt: number
  files: Map<string, FileIndex>
  symbols: Map<string, CodeSymbol[]>
  dependencies: Map<string, string[]>  // 文件依赖关系
}

// 项目摘要
export interface ProjectSummary {
  totalFiles: number
  totalSymbols: number
  fileTypes: Record<string, number>
  mainEntry?: string
  framework?: string
  language: string
  architecture: string
  keyComponents: string[]
}

// ==================== 代码解析器 ====================

class CodeParser {
  // 解析文件中的代码符号
  async parseFile(filePath: string, content: string): Promise<CodeSymbol[]> {
    const symbols: CodeSymbol[] = []
    const ext = path.extname(filePath).toLowerCase()
    
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
        return this.parseJavaScript(content, filePath)
      case '.vue':
        return this.parseVue(content, filePath)
      case '.php':
        return this.parsePHP(content, filePath)
      case '.py':
        return this.parsePython(content, filePath)
      default:
        return []
    }
  }
  
  private parseJavaScript(content: string, filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = []
    const lines = content.split('\n')
    
    // 函数定义
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g
    // 类定义
    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    // 接口定义
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g
    // 箭头函数/方法
    const methodRegex = /(?:async\s+)?(\w+)\s*[=:]\s*(?:async\s*)?\([^)]*\)\s*=>/g
    // 导入语句
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
    // 导出语句
    const exportRegex = /export\s+(?:const|let|var|function|class|interface)?\s*(\w+)/g
    
    lines.forEach((line, lineNum) => {
      // 函数
      let match: RegExpExecArray | null
      while ((match = functionRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'function',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          signature: this.extractSignature(line, match[1]),
          dependencies: [],
          dependents: []
        })
      }
      
      // 类
      while ((match = classRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'class',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
      
      // 接口
      while ((match = interfaceRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'interface',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
      
      // 导出
      while ((match = exportRegex.exec(line)) !== null) {
        const existing = symbols.find(s => s.name === match![1])
        if (!existing) {
          symbols.push({
            id: `${filePath}:${match[1]}`,
            name: match[1],
            type: 'export',
            filePath,
            line: lineNum + 1,
            column: match.index + 1,
            dependencies: [],
            dependents: []
          })
        }
      }
    })
    
    return symbols
  }
  
  private parseVue(content: string, filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = []
    
    // 提取 script 部分
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    if (scriptMatch) {
      const scriptContent = scriptMatch[1]
      const jsSymbols = this.parseJavaScript(scriptContent, filePath)
      symbols.push(...jsSymbols)
    }
    
    return symbols
  }
  
  private parsePHP(content: string, filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = []
    const lines = content.split('\n')
    
    // 函数定义
    const functionRegex = /function\s+(\w+)\s*\(/g
    // 类定义
    const classRegex = /class\s+(\w+)/g
    // 命名空间
    const namespaceRegex = /namespace\s+([^;]+);/g
    
    lines.forEach((line, lineNum) => {
      let match
      while ((match = functionRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'function',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
      
      while ((match = classRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'class',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
    })
    
    return symbols
  }
  
  private parsePython(content: string, filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = []
    const lines = content.split('\n')
    
    // 函数定义
    const functionRegex = /def\s+(\w+)\s*\(/g
    // 类定义
    const classRegex = /class\s+(\w+)/g
    
    lines.forEach((line, lineNum) => {
      let match
      while ((match = functionRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'function',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
      
      while ((match = classRegex.exec(line)) !== null) {
        symbols.push({
          id: `${filePath}:${match[1]}`,
          name: match[1],
          type: 'class',
          filePath,
          line: lineNum + 1,
          column: match.index + 1,
          dependencies: [],
          dependents: []
        })
      }
    })
    
    return symbols
  }
  
  private extractSignature(line: string, name: string): string {
    const start = line.indexOf(name)
    const end = line.indexOf('{') > -1 ? line.indexOf('{') : line.length
    return line.slice(start, end).trim()
  }
}

// ==================== 代码索引服务 ====================

export class CodeIndexService {
  private projectPath: string
  private indexPath: string
  private index: ProjectIndex | null = null
  private parser: CodeParser
  
  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.indexPath = path.join(projectPath, '.smp-code', 'code-index.json')
    this.parser = new CodeParser()
  }
  
  // 初始化索引
  async initialize(): Promise<void> {
    log.info('[CodeIndex] Initializing...')
    
    // 尝试加载已有索引
    const loaded = await this.loadIndex()
    
    if (!loaded) {
      // 创建新索引
      log.info('[CodeIndex] Creating new index...')
      await this.buildIndex()
    } else {
      // 检查变更并更新
      log.info('[CodeIndex] Checking for changes...')
      await this.updateChangedFiles()
    }
    
    log.info('[CodeIndex] Initialized successfully')
  }
  
  // 构建完整索引
  async buildIndex(): Promise<void> {
    const files = await this.scanProjectFiles()
    const fileMap = new Map<string, FileIndex>()
    const symbolMap = new Map<string, CodeSymbol[]>()
    
    for (const filePath of files) {
      try {
        const fullPath = path.join(this.projectPath, filePath)
        const stats = await fs.stat(fullPath)
        const content = await fs.readFile(fullPath, 'utf-8')
        const hash = createHash('md5').update(content).digest('hex')
        
        // 解析代码符号
        const symbols = await this.parser.parseFile(fullPath, content)
        
        const fileIndex: FileIndex = {
          path: filePath,
          hash,
          size: stats.size,
          lastModified: stats.mtime.getTime(),
          symbols,
          imports: this.extractImports(content),
          exports: this.extractExports(content),
          summary: this.generateFileSummary(filePath, content, symbols)
        }
        
        fileMap.set(filePath, fileIndex)
        
        // 索引符号
        symbols.forEach(symbol => {
          const existing = symbolMap.get(symbol.name) || []
          existing.push(symbol)
          symbolMap.set(symbol.name, existing)
        })
        
      } catch (error) {
        log.warn(`[CodeIndex] Failed to index ${filePath}:`, error)
      }
    }
    
    this.index = {
      projectPath: this.projectPath,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: fileMap,
      symbols: symbolMap,
      dependencies: new Map()
    }
    
    // 分析依赖关系
    this.analyzeDependencies()
    
    // 保存索引
    await this.saveIndex()
    
    log.info(`[CodeIndex] Indexed ${fileMap.size} files, ${symbolMap.size} symbols`)
  }
  
  // 扫描项目文件
  private async scanProjectFiles(): Promise<string[]> {
    const patterns = [
      '**/*.{ts,tsx,js,jsx,vue,php,py}',
      '!**/node_modules/**',
      '!**/.git/**',
      '!**/dist/**',
      '!**/build/**',
      '!**/.smp-code/**'
    ]
    
    const files = await glob(patterns, {
      cwd: this.projectPath,
      absolute: false
    })
    
    return files
  }
  
  // 提取导入
  private extractImports(content: string): string[] {
    const imports: string[] = []
    const regex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      imports.push(match[1])
    }
    return imports
  }
  
  // 提取导出
  private extractExports(content: string): string[] {
    const exports: string[] = []
    const regex = /export\s+(?:const|let|var|function|class|interface)?\s*(\w+)/g
    let match
    while ((match = regex.exec(content)) !== null) {
      exports.push(match[1])
    }
    return exports
  }
  
  // 生成文件摘要
  private generateFileSummary(filePath: string, content: string, symbols: CodeSymbol[]): string {
    const fileName = path.basename(filePath)
    const symbolNames = symbols.slice(0, 5).map(s => s.name).join(', ')
    const lineCount = content.split('\n').length
    
    return `${fileName} (${lineCount} lines): ${symbolNames}${symbols.length > 5 ? '...' : ''}`
  }
  
  // 分析依赖关系
  private analyzeDependencies(): void {
    if (!this.index) return
    
    this.index.files.forEach((file, filePath) => {
      const deps: string[] = []
      
      file.imports.forEach(imp => {
        // 解析相对导入
        if (imp.startsWith('.')) {
          const resolved = path.resolve(path.dirname(filePath), imp)
          const possiblePaths = [
            resolved,
            resolved + '.ts',
            resolved + '.tsx',
            resolved + '.js',
            resolved + '/index.ts'
          ]
          
          for (const p of possiblePaths) {
            const relativePath = path.relative(this.projectPath, p)
            if (this.index!.files.has(relativePath)) {
              deps.push(relativePath)
              break
            }
          }
        }
      })
      
      this.index!.dependencies.set(filePath, deps)
    })
  }
  
  // 更新变更的文件
  private async updateChangedFiles(): Promise<void> {
    if (!this.index) return
    
    const changedFiles: string[] = []
    
    for (const [filePath, fileIndex] of this.index.files) {
      try {
        const fullPath = path.join(this.projectPath, filePath)
        const stats = await fs.stat(fullPath)
        
        if (stats.mtime.getTime() > fileIndex.lastModified) {
          changedFiles.push(filePath)
        }
      } catch {
        // 文件可能被删除
        this.index.files.delete(filePath)
      }
    }
    
    if (changedFiles.length > 0) {
      log.info(`[CodeIndex] Updating ${changedFiles.length} changed files...`)
      
      for (const filePath of changedFiles) {
        // 重新索引变更的文件
        await this.reindexFile(filePath)
      }
      
      this.index.updatedAt = Date.now()
      await this.saveIndex()
    }
  }
  
  // 重新索引单个文件
  private async reindexFile(filePath: string): Promise<void> {
    if (!this.index) return
    
    try {
      const fullPath = path.join(this.projectPath, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      const stats = await fs.stat(fullPath)
      const hash = createHash('md5').update(content).digest('hex')
      
      // 移除旧的符号索引
      const oldFile = this.index.files.get(filePath)
      if (oldFile) {
        oldFile.symbols.forEach(symbol => {
          const existing = this.index!.symbols.get(symbol.name) || []
          const filtered = existing.filter(s => s.filePath !== filePath)
          if (filtered.length > 0) {
            this.index!.symbols.set(symbol.name, filtered)
          } else {
            this.index!.symbols.delete(symbol.name)
          }
        })
      }
      
      // 解析新符号
      const symbols = await this.parser.parseFile(fullPath, content)
      
      const fileIndex: FileIndex = {
        path: filePath,
        hash,
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        symbols,
        imports: this.extractImports(content),
        exports: this.extractExports(content),
        summary: this.generateFileSummary(filePath, content, symbols)
      }
      
      this.index.files.set(filePath, fileIndex)
      
      // 更新符号索引
      symbols.forEach(symbol => {
        const existing = this.index!.symbols.get(symbol.name) || []
        existing.push(symbol)
        this.index!.symbols.set(symbol.name, existing)
      })
      
    } catch (error) {
      log.warn(`[CodeIndex] Failed to reindex ${filePath}:`, error)
    }
  }
  
  // 加载索引
  private async loadIndex(): Promise<boolean> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8')
      const data = JSON.parse(content)
      
      // 转换 Map
      this.index = {
        ...data,
        files: new Map(Object.entries(data.files)),
        symbols: new Map(Object.entries(data.symbols)),
        dependencies: new Map(Object.entries(data.dependencies))
      }
      
      log.info(`[CodeIndex] Loaded index: ${this.index?.files.size || 0} files`)
      return true
      
    } catch {
      return false
    }
  }
  
  // 保存索引
  private async saveIndex(): Promise<void> {
    if (!this.index) return
    
    // 确保目录存在
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true })
    
    // 转换 Map 为普通对象
    const data = {
      ...this.index,
      files: Object.fromEntries(this.index.files),
      symbols: Object.fromEntries(this.index.symbols),
      dependencies: Object.fromEntries(this.index.dependencies)
    }
    
    await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2))
    log.info('[CodeIndex] Index saved')
  }
  
  // ==================== 公共 API ====================
  
  // 获取项目摘要
  getProjectSummary(): ProjectSummary {
    if (!this.index) {
      return {
        totalFiles: 0,
        totalSymbols: 0,
        fileTypes: {},
        language: 'unknown',
        architecture: 'unknown',
        keyComponents: []
      }
    }
    
    const fileTypes: Record<string, number> = {}
    this.index.files.forEach(file => {
      const ext = path.extname(file.path)
      fileTypes[ext] = (fileTypes[ext] || 0) + 1
    })
    
    // 检测框架
    let framework = 'unknown'
    if (this.index.files.has('package.json')) {
      framework = 'nodejs'
    } else if (this.index.files.has('composer.json')) {
      framework = 'php'
    } else if (this.index.files.has('requirements.txt') || this.index.files.has('setup.py')) {
      framework = 'python'
    }
    
    // 检测主要入口
    let mainEntry: string | undefined
    if (this.index.files.has('src/main.ts')) mainEntry = 'src/main.ts'
    else if (this.index.files.has('index.php')) mainEntry = 'index.php'
    else if (this.index.files.has('app.py')) mainEntry = 'app.py'
    
    return {
      totalFiles: this.index.files.size,
      totalSymbols: this.index.symbols.size,
      fileTypes,
      mainEntry,
      framework,
      language: this.detectMainLanguage(fileTypes),
      architecture: this.detectArchitecture(),
      keyComponents: this.detectKeyComponents()
    }
  }
  
  // 检测主要语言
  private detectMainLanguage(fileTypes: Record<string, number>): string {
    const sorted = Object.entries(fileTypes).sort((a, b) => b[1] - a[1])
    const mainExt = sorted[0]?.[0] || ''
    
    const langMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.vue': 'Vue',
      '.php': 'PHP',
      '.py': 'Python'
    }
    
    return langMap[mainExt] || 'Unknown'
  }
  
  // 检测架构
  private detectArchitecture(): string {
    if (!this.index) return 'unknown'
    
    const files = Array.from(this.index.files.keys())
    
    if (files.some(f => f.includes('src/components') || f.includes('src/views'))) {
      return 'component-based'
    }
    if (files.some(f => f.includes('src/controllers') || f.includes('src/models'))) {
      return 'mvc'
    }
    if (files.some(f => f.includes('src/modules') || f.includes('src/features'))) {
      return 'modular'
    }
    
    return 'flat'
  }
  
  // 检测关键组件
  private detectKeyComponents(): string[] {
    if (!this.index) return []
    
    const components: string[] = []
    
    // 查找主要目录
    const dirs = new Set<string>()
    this.index.files.forEach((_, filePath) => {
      const parts = filePath.split('/')
      if (parts.length > 1) {
        dirs.add(parts[0])
        if (parts.length > 2) {
          dirs.add(`${parts[0]}/${parts[1]}`)
        }
      }
    })
    
    return Array.from(dirs).slice(0, 10)
  }
  
  // 搜索符号
  searchSymbols(query: string): CodeSymbol[] {
    if (!this.index) return []
    
    const results: CodeSymbol[] = []
    const lowerQuery = query.toLowerCase()
    
    this.index.symbols.forEach((symbols, name) => {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...symbols)
      }
    })
    
    return results.slice(0, 20)
  }
  
  // 获取文件信息
  getFileInfo(filePath: string): FileIndex | null {
    if (!this.index) return null
    return this.index.files.get(filePath) || null
  }
  
  // 获取相关文件
  getRelatedFiles(filePath: string): string[] {
    if (!this.index) return []
    
    const deps = this.index.dependencies.get(filePath) || []
    
    // 反向依赖
    const reverseDeps: string[] = []
    this.index.dependencies.forEach((deps, path) => {
      if (deps.includes(filePath)) {
        reverseDeps.push(path)
      }
    })
    
    return [...deps, ...reverseDeps]
  }
  
  // 获取项目结构提示
  getProjectContextPrompt(): string {
    const summary = this.getProjectSummary()
    
    const lines: string[] = []
    lines.push('【项目结构】')
    lines.push(`项目路径: ${this.projectPath}`)
    lines.push(`主要语言: ${summary.language}`)
    lines.push(`框架: ${summary.framework}`)
    lines.push(`架构: ${summary.architecture}`)
    lines.push(`文件总数: ${summary.totalFiles}`)
    lines.push(`符号总数: ${summary.totalSymbols}`)
    
    if (summary.mainEntry) {
      lines.push(`入口文件: ${summary.mainEntry}`)
    }
    
    if (summary.keyComponents.length > 0) {
      lines.push(`关键目录: ${summary.keyComponents.join(', ')}`)
    }
    
    lines.push('\n【文件类型分布】')
    Object.entries(summary.fileTypes).forEach(([ext, count]) => {
      lines.push(`  ${ext}: ${count} 个文件`)
    })
    
    return lines.join('\n')
  }
  
  // 强制重新索引
  async forceRebuild(): Promise<void> {
    log.info('[CodeIndex] Force rebuilding index...')
    await this.buildIndex()
  }
}

// 单例模式
const indexServices = new Map<string, CodeIndexService>()

export function getCodeIndexService(projectPath: string): CodeIndexService {
  if (!indexServices.has(projectPath)) {
    indexServices.set(projectPath, new CodeIndexService(projectPath))
  }
  return indexServices.get(projectPath)!
}
