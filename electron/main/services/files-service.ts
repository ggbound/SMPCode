import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

// List directory contents
export function listDirectory(dirPath: string): FileNode[] {
  try {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`)
    }

    const stats = fs.statSync(dirPath)
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`)
    }

    const items = fs.readdirSync(dirPath)
    const nodes: FileNode[] = []

    for (const item of items) {
      // Skip hidden files and node_modules
      if (item.startsWith('.') || item === 'node_modules') {
        continue
      }

      const itemPath = path.join(dirPath, item)
      try {
        const itemStats = fs.statSync(itemPath)
        nodes.push({
          name: item,
          path: itemPath,
          isDirectory: itemStats.isDirectory()
        })
      } catch (e) {
        log.warn(`Failed to stat ${itemPath}:`, e)
      }
    }

    // Sort: directories first, then files, both alphabetically
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
