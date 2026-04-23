import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  // VSCode-style properties
  hasChildren?: boolean  // Whether the node has children (for lazy loading)
  mtime?: number         // Modification time for change detection
  size?: number          // File size
}

// File watchers map
const fileWatchers = new Map<string, fs.FSWatcher>()

// List directory contents with VSCode-style optimizations
export function listDirectory(dirPath: string, options?: { includeHidden?: boolean; maxDepth?: number }): FileNode[] {
  try {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`)
    }

    const stats = fs.statSync(dirPath)
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`)
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []
    const includeHidden = options?.includeHidden ?? true  // 默认显示隐藏文件

    for (const item of items) {
      // 显示所有文件，包括隐藏文件和node_modules
      // 不再过滤任何文件或目录

      const itemPath = path.join(dirPath, item.name)
      try {
        const itemStats = fs.statSync(itemPath)
        const isDir = item.isDirectory()
        
        const node: FileNode = {
          name: item.name,
          path: itemPath,
          isDirectory: isDir,
          hasChildren: isDir ? undefined : false,
          mtime: itemStats.mtimeMs,
          size: itemStats.size
        }
        
        // For directories, check if they have children without loading them all
        if (isDir) {
          try {
            const childItems = fs.readdirSync(itemPath)
            node.hasChildren = childItems.length > 0
          } catch (e) {
            node.hasChildren = false
          }
        }
        
        nodes.push(node)
      } catch (e) {
        log.warn(`Failed to stat ${itemPath}:`, e)
      }
    }

    // Sort: directories first, then files, both alphabetically (VSCode-style)
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return nodes
  } catch (error) {
    log.error('Failed to list directory:', error)
    throw error
  }
}

// Read file content
export function readFile(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`)
    }

    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      throw new Error(`Is a directory: ${filePath}`)
    }

    // Check file size (limit to 10MB)
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error(`File too large: ${filePath}`)
    }

    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    log.error('Failed to read file:', error)
    throw error
  }
}

// Write file content
export function writeFile(filePath: string, content: string): void {
  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(filePath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    fs.writeFileSync(filePath, content, 'utf-8')
  } catch (error) {
    log.error('Failed to write file:', error)
    throw error
  }
}

// Check if path exists
export function pathExists(checkPath: string): boolean {
  return fs.existsSync(checkPath)
}

// Get file stats
export function getFileStats(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

// Get file extension
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

// Check if file is binary (basic check)
export function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.ttf', '.otf', '.woff', '.woff2',
    '.sqlite', '.db'
  ]
  const ext = getFileExtension(filePath)
  return binaryExtensions.includes(ext)
}

// Watch directory for changes
export function watchDirectory(dirPath: string, callback: (eventType: string, filename: string) => void): boolean {
  try {
    // Close existing watcher if any
    if (fileWatchers.has(dirPath)) {
      fileWatchers.get(dirPath)?.close()
    }

    const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
      if (filename) {
        callback(eventType, filename)
      }
    })

    fileWatchers.set(dirPath, watcher)
    log.info(`Started watching directory: ${dirPath}`)
    return true
  } catch (error) {
    log.error('Failed to watch directory:', error)
    return false
  }
}

// Stop watching directory
export function unwatchDirectory(dirPath: string): boolean {
  const watcher = fileWatchers.get(dirPath)
  if (watcher) {
    watcher.close()
    fileWatchers.delete(dirPath)
    log.info(`Stopped watching directory: ${dirPath}`)
    return true
  }
  return false
}

// Stop all watchers
export function stopAllWatchers(): void {
  fileWatchers.forEach((watcher, dirPath) => {
    watcher.close()
    log.info(`Stopped watching: ${dirPath}`)
  })
  fileWatchers.clear()
}

// Check if .gitignore exists and parse it
export function getGitIgnorePatterns(dirPath: string): string[] {
  const gitignorePath = path.join(dirPath, '.gitignore')
  
  if (!fs.existsSync(gitignorePath)) {
    return []
  }
  
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8')
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  } catch (error) {
    log.error('Failed to read .gitignore:', error)
    return []
  }
}

// Check if file should be ignored based on .gitignore patterns
export function shouldIgnoreFile(filename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching
    if (pattern === filename) return true
    if (pattern.endsWith('/') && filename.startsWith(pattern)) return true
    if (pattern.startsWith('*') && filename.endsWith(pattern.slice(1))) return true
    if (pattern.endsWith('*') && filename.startsWith(pattern.slice(0, -1))) return true
  }
  return false
}
