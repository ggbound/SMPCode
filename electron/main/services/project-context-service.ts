/**
 * 项目上下文服务
 * 负责扫描、缓存和管理项目文件结构，避免每次对话都重复读取目录
 */

import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'

// 项目上下文数据结构
export interface ProjectContext {
  rootPath: string
  scannedAt: number
  fileTree: FileNode[]
  stats: ProjectStats
  fileContents: Map<string, string> // 缓存的文件内容
}

// 文件节点
export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  size?: number
  modifiedAt?: number
}

// 项目统计
export interface ProjectStats {
  totalFiles: number
  totalDirectories: number
  totalSize: number
  fileTypes: Record<string, number>
}

// 忽略的文件和目录模式
const IGNORE_PATTERNS = [
  /^\./,                    // 隐藏文件
  /^node_modules$/,         // Node.js 依赖
  /^dist$/,                 // 构建输出
  /^build$/,                // 构建输出
  /^out$/,                  // 输出目录
  /^\.git$/,                // Git 目录
  /^\.svn$/,                // SVN 目录
  /^\.hg$/,                 // Mercurial 目录
  /^__pycache__$/,          // Python 缓存
  /^\.pytest_cache$/,       // Pytest 缓存
  /^target$/,               // Rust 构建输出
  /^\.idea$/,               // IntelliJ IDEA
  /^\.vscode$/,             // VS Code 配置
  /^coverage$/,             // 测试覆盖率报告
  /^\.next$/,               // Next.js 构建输出
  /^\.nuxt$/,               // Nuxt.js 构建输出
  /^vendor$/,               // 依赖目录
  /^bin$/,                  // 二进制目录
  /^obj$/,                  // 编译输出
]

// 应该缓存内容的文件类型
const CACHEABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.java', '.go', '.rs',
  '.json', '.md', '.txt', '.yaml', '.yml',
  '.html', '.css', '.scss', '.less',
  '.vue', '.svelte', '.php', '.rb'
])

// 单例实例
let projectContext: ProjectContext | null = null
let currentRootPath: string | null = null

/**
 * 检查是否应该忽略该文件/目录
 */
function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.some(pattern => pattern.test(name))
}

/**
 * 检查是否应该缓存文件内容
 */
function shouldCacheContent(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return CACHEABLE_EXTENSIONS.has(ext)
}

/**
 * 递归扫描目录
 */
async function scanDirectory(
  dirPath: string,
  relativePath: string = '',
  maxDepth: number = 10,
  currentDepth: number = 0
): Promise<FileNode[]> {
  if (currentDepth >= maxDepth) {
    return []
  }

  const nodes: FileNode[] = []

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) {
        continue
      }

      const fullPath = path.join(dirPath, entry.name)
      const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name

      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, entryRelativePath, maxDepth, currentDepth + 1)
        const stat = await fs.promises.stat(fullPath)
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          isDirectory: true,
          children,
          modifiedAt: stat.mtime.getTime()
        })
      } else {
        const stat = await fs.promises.stat(fullPath)
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          isDirectory: false,
          size: stat.size,
          modifiedAt: stat.mtime.getTime()
        })
      }
    }

    // 排序：目录在前，文件在后，按名称排序
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

  } catch (error) {
    log.error(`[ProjectContext] Error scanning directory ${dirPath}:`, error)
  }

  return nodes
}

/**
 * 计算项目统计
 */
function calculateStats(fileTree: FileNode[]): ProjectStats {
  let totalFiles = 0
  let totalDirectories = 0
  let totalSize = 0
  const fileTypes: Record<string, number> = {}

  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.isDirectory) {
        totalDirectories++
        if (node.children) {
          traverse(node.children)
        }
      } else {
        totalFiles++
        totalSize += node.size || 0
        const ext = path.extname(node.name).toLowerCase() || '(no extension)'
        fileTypes[ext] = (fileTypes[ext] || 0) + 1
      }
    }
  }

  traverse(fileTree)

  return { totalFiles, totalDirectories, totalSize, fileTypes }
}

/**
 * 缓存关键文件内容
 */
async function cacheImportantFiles(
  rootPath: string,
  fileTree: FileNode[],
  maxCacheSize: number = 1024 * 1024 // 1MB 缓存限制
): Promise<Map<string, string>> {
  const fileContents = new Map<string, string>()
  let currentCacheSize = 0

  // 优先缓存的文件（配置文件、入口文件等）
  const priorityFiles = [
    'package.json', 'tsconfig.json', 'README.md',
    'Cargo.toml', 'pyproject.toml', 'requirements.txt',
    'main.ts', 'index.ts', 'app.ts', 'server.ts',
    'main.py', 'app.py', 'manage.py'
  ]

  async function traverseAndCache(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.isDirectory && node.children) {
        await traverseAndCache(node.children)
      } else if (shouldCacheContent(node.path)) {
        const fullPath = path.join(rootPath, node.path)
        const isPriority = priorityFiles.includes(node.name.toLowerCase())

        // 优先缓存小文件和优先级文件
        if (isPriority || (node.size && node.size < 50000)) {
          try {
            const content = await fs.promises.readFile(fullPath, 'utf-8')
            const contentSize = Buffer.byteLength(content, 'utf8')

            if (currentCacheSize + contentSize < maxCacheSize) {
              fileContents.set(node.path, content)
              currentCacheSize += contentSize
            }
          } catch (error) {
            // 忽略读取错误
          }
        }
      }
    }
  }

  await traverseAndCache(fileTree)
  log.info(`[ProjectContext] Cached ${fileContents.size} files (${Math.round(currentCacheSize / 1024)}KB)`)
  return fileContents
}

/**
 * 扫描项目并创建上下文
 */
export async function scanProject(rootPath: string): Promise<ProjectContext> {
  log.info(`[ProjectContext] Scanning project: ${rootPath}`)
  const startTime = Date.now()

  const fileTree = await scanDirectory(rootPath)
  const stats = calculateStats(fileTree)
  const fileContents = await cacheImportantFiles(rootPath, fileTree)

  projectContext = {
    rootPath,
    scannedAt: Date.now(),
    fileTree,
    stats,
    fileContents
  }

  currentRootPath = rootPath

  const duration = Date.now() - startTime
  log.info(`[ProjectContext] Scan completed in ${duration}ms:`, {
    files: stats.totalFiles,
    directories: stats.totalDirectories,
    cachedFiles: fileContents.size
  })

  return projectContext
}

/**
 * 获取当前项目上下文
 */
export function getProjectContext(): ProjectContext | null {
  return projectContext
}

/**
 * 获取项目文件树（文本格式，用于显示）
 */
export function getFileTreeText(
  maxDepth: number = 3,
  maxFiles: number = 100
): string {
  if (!projectContext) {
    return '(No project context available)'
  }

  const lines: string[] = []
  let fileCount = 0

  function renderNode(node: FileNode, depth: number, isLast: boolean, prefix: string = '') {
    if (depth > maxDepth) return
    if (!node.isDirectory && fileCount >= maxFiles) return

    const connector = isLast ? '└── ' : '├── '
    const line = prefix + connector + node.name + (node.isDirectory ? '/' : '')
    lines.push(line)

    if (!node.isDirectory) {
      fileCount++
    }

    if (node.children && depth < maxDepth) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ')
      node.children.forEach((child, index) => {
        renderNode(child, depth + 1, index === node.children!.length - 1, childPrefix)
      })
    }
  }

  lines.push(path.basename(projectContext.rootPath) + '/')
  projectContext.fileTree.forEach((node, index) => {
    renderNode(node, 0, index === projectContext!.fileTree.length - 1)
  })

  if (fileCount >= maxFiles) {
    lines.push('... (truncated)')
  }

  return lines.join('\n')
}

/**
 * 获取项目概览（用于系统提示）
 */
export function getProjectOverview(): string {
  if (!projectContext) {
    return ''
  }

  const { stats, rootPath } = projectContext
  const topFileTypes = Object.entries(stats.fileTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(', ')

  return `Project: ${path.basename(rootPath)}
Location: ${rootPath}
Files: ${stats.totalFiles}, Directories: ${stats.totalDirectories}
Main file types: ${topFileTypes}`
}

/**
 * 获取缓存的文件内容
 */
export function getCachedFileContent(filePath: string): string | undefined {
  if (!projectContext) return undefined

  // 尝试直接匹配
  if (projectContext.fileContents.has(filePath)) {
    return projectContext.fileContents.get(filePath)
  }

  // 尝试相对路径匹配
  const relativePath = path.relative(projectContext.rootPath, filePath)
  return projectContext.fileContents.get(relativePath)
}

/**
 * 搜索项目中的文件
 */
export function searchFiles(pattern: string): FileNode[] {
  if (!projectContext) return []

  const results: FileNode[] = []
  const regex = new RegExp(pattern, 'i')

  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      if (regex.test(node.name)) {
        results.push(node)
      }
      if (node.children) {
        traverse(node.children)
      }
    }
  }

  traverse(projectContext.fileTree)
  return results
}

/**
 * 检查上下文是否需要刷新（超过5分钟或路径变化）
 */
export function shouldRefreshContext(rootPath: string): boolean {
  if (!projectContext) return true
  if (currentRootPath !== rootPath) return true

  const age = Date.now() - projectContext.scannedAt
  const maxAge = 5 * 60 * 1000 // 5分钟

  return age > maxAge
}

/**
 * 刷新项目上下文
 */
export async function refreshProjectContext(rootPath: string): Promise<ProjectContext> {
  log.info(`[ProjectContext] Refreshing context for: ${rootPath}`)
  return scanProject(rootPath)
}

/**
 * 清除项目上下文
 */
export function clearProjectContext(): void {
  projectContext = null
  currentRootPath = null
  log.info('[ProjectContext] Context cleared')
}

/**
 * 获取项目结构作为 AI 提示
 */
export function getProjectStructureForAI(
  includeFileTree: boolean = true,
  maxTreeDepth: number = 3
): string {
  if (!projectContext) {
    return ''
  }

  const parts: string[] = []

  // 项目概览
  parts.push('=== PROJECT OVERVIEW ===')
  parts.push(getProjectOverview())
  parts.push('')

  // 文件树
  if (includeFileTree) {
    parts.push('=== PROJECT STRUCTURE ===')
    parts.push(getFileTreeText(maxTreeDepth))
    parts.push('')
  }

  // 关键文件预览
  const keyFiles: string[] = []
  const importantFiles = ['package.json', 'tsconfig.json', 'README.md', 'Cargo.toml']

  for (const fileName of importantFiles) {
    const content = getCachedFileContent(fileName)
    if (content) {
      keyFiles.push(`=== ${fileName} ===\n${content.substring(0, 1000)}${content.length > 1000 ? '\n... (truncated)' : ''}`)
    }
  }

  if (keyFiles.length > 0) {
    parts.push('=== KEY FILES ===')
    parts.push(keyFiles.join('\n\n'))
    parts.push('')
  }

  return parts.join('\n')
}

// 导出单例状态检查函数
export function hasProjectContext(): boolean {
  return projectContext !== null
}

export function getCurrentRootPath(): string | null {
  return currentRootPath
}
