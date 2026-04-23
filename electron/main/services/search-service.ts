import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as glob from 'glob'

interface SearchOptions {
  query: string
  path: string
  includePattern?: string
  excludePattern?: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWords?: boolean
  maxResults?: number
  useIgnoreFiles?: boolean
}

interface SearchMatch {
  file: string
  line: number
  column: number
  content: string
  match: string
}

export async function searchFiles(options: SearchOptions): Promise<{
  matches: SearchMatch[]
  totalFiles: number
  limitHit: boolean
}> {
  const {
    query,
    path: searchPath,
    includePattern,
    excludePattern,
    isRegex = false,
    isCaseSensitive = false,
    isWholeWords = false,
    maxResults = 10000,
    useIgnoreFiles = true
  } = options
  
  // 尝试使用ripgrep
  const rgPath = await findRipgrep()
  if (rgPath) {
    return searchWithRipgrep(options, rgPath)
  }
  
  // 降级为基于Node.js的搜索
  console.log('[Search] ripgrep not found, using Node.js fallback')
  return searchWithNode(options)
}

// 使用ripgrep搜索
async function searchWithRipgrep(options: SearchOptions, rgPath: string): Promise<{
  matches: SearchMatch[]
  totalFiles: number
  limitHit: boolean
}> {
  const {
    query,
    path: searchPath,
    includePattern,
    excludePattern,
    isRegex = false,
    isCaseSensitive = false,
    isWholeWords = false,
    maxResults = 10000,
    useIgnoreFiles = true
  } = options
  
  // 构建ripgrep命令参数
  const args: string[] = ['--json', '--line-number', '--column']
  
  if (isRegex) {
    args.push('--regexp')
  } else {
    args.push('--fixed-strings')
  }
  
  if (!isCaseSensitive) {
    args.push('--ignore-case')
  }
  
  if (isWholeWords) {
    args.push('--word-regexp')
  }
  
  if (maxResults) {
    args.push('--max-count', maxResults.toString())
  }
  
  // 包含模式
  if (includePattern) {
    args.push('--glob', includePattern)
  }
  
  // 排除模式
  if (excludePattern) {
    args.push('--glob', `!${excludePattern}`)
  }
  
  // 使用.gitignore
  if (useIgnoreFiles) {
    args.push('--ignore-file', '.gitignore')
  }
  
  // 添加一些常见的忽略模式
  args.push('--glob', '!node_modules/**')
  args.push('--glob', '!.git/**')
  args.push('--glob', '!dist/**')
  args.push('--glob', '!build/**')
  args.push('--glob', '!out/**')
  args.push('--glob', '!*.lock')
  args.push('--glob', '!package-lock.json')
  args.push('--glob', '!yarn.lock')
  args.push('--glob', '!pnpm-lock.yaml')
  
  args.push(query, searchPath)
  
  return new Promise((resolve, reject) => {
    const rg = spawn(rgPath, args)
    const matches: SearchMatch[] = []
    let limitHit = false
    
    rg.stdout.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        
        try {
          const json = JSON.parse(line)
          if (json.type === 'match') {
            const matchData = json.data
            const matchText = matchData.submatches[0]?.match?.text || ''
            
            matches.push({
              file: matchData.path.text,
              line: matchData.line_number,
              column: matchData.submatches[0].start,
              content: matchData.lines.text,
              match: matchText
            })
            
            if (matches.length >= maxResults) {
              limitHit = true
              rg.kill()
              break
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    })
    
    rg.stderr.on('data', (data) => {
      console.error('ripgrep stderr:', data.toString())
    })
    
    rg.on('close', (code) => {
      // 统计文件数
      const uniqueFiles = new Set(matches.map(m => m.file))
      resolve({
        matches,
        totalFiles: uniqueFiles.size,
        limitHit
      })
    })
    
    rg.on('error', (error) => {
      reject(error)
    })
  })
}

// 查找ripgrep可执行文件
async function findRipgrep(): Promise<string | null> {
  // 常见的ripgrep安装位置
  const possiblePaths = [
    'rg', // PATH中的rg
    '/usr/local/bin/rg',
    '/usr/bin/rg',
    '/opt/homebrew/bin/rg', // macOS Apple Silicon
    '/usr/local/Homebrew/bin/rg', // macOS Intel
  ]
  
  for (const rgPath of possiblePaths) {
    try {
      return await checkExecutable(rgPath)
    } catch {
      continue
    }
  }
  
  return null
}

function checkExecutable(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(path, ['--version'])
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(path)
      } else {
        reject(new Error(`Not executable: ${path}`))
      }
    })
    proc.on('error', () => reject(new Error(`Not found: ${path}`)))
  })
}

// 使用Node.js降级搜索
async function searchWithNode(options: SearchOptions): Promise<{
  matches: SearchMatch[]
  totalFiles: number
  limitHit: boolean
}> {
  const {
    query,
    path: searchPath,
    includePattern,
    excludePattern,
    isRegex = false,
    isCaseSensitive = false,
    isWholeWords = false,
    maxResults = 10000,
    useIgnoreFiles = true
  } = options
  
  const matches: SearchMatch[] = []
  let limitHit = false
  
  // 构建搜索模式
  let searchRegex: RegExp
  try {
    if (isRegex) {
      searchRegex = new RegExp(query, isCaseSensitive ? '' : 'i')
    } else {
      // 转义正则特殊字符
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = isWholeWords ? `\\b${escaped}\\b` : escaped
      searchRegex = new RegExp(pattern, isCaseSensitive ? '' : 'i')
    }
  } catch (e) {
    console.error('[Search] Invalid regex:', e)
    return { matches: [], totalFiles: 0, limitHit: false }
  }
  
  // 获取文件列表
  const globPattern = includePattern 
    ? path.join(searchPath, '**', includePattern)
    : path.join(searchPath, '**', '*')
  
  const files = glob.sync(globPattern, {
    nodir: true,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/*.lock',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      ...(excludePattern ? [`**/${excludePattern}`] : [])
    ]
  })
  
  // 搜索文件内容
  for (const file of files) {
    if (limitHit) break
    
    try {
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum]
        const lineMatches = line.match(searchRegex)
        
        if (lineMatches) {
          matches.push({
            file,
            line: lineNum + 1,
            column: lineMatches.index || 0,
            content: line,
            match: lineMatches[0]
          })
          
          if (matches.length >= maxResults) {
            limitHit = true
            break
          }
        }
      }
    } catch (e) {
      // 忽略无法读取的文件
      continue
    }
  }
  
  const uniqueFiles = new Set(matches.map(m => m.file))
  return {
    matches,
    totalFiles: uniqueFiles.size,
    limitHit
  }
}
