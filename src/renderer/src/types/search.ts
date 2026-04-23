// 搜索查询参数
export interface ISearchQuery {
  contentPattern: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWords?: boolean
  includePattern?: string
  excludePattern?: string
  maxResults?: number
  useIgnoreFiles?: boolean
}

// 搜索结果匹配项
export interface ISearchMatch {
  fileId: string
  filePath: string
  line: number
  column: number
  preview: string
  match: string
  languageId: string
}

// 文件匹配组
export interface IFileMatch {
  filePath: string
  languageId: string
  matches: ISearchMatch[]
  matchCount: number
}

// 搜索结果
export interface ISearchResult {
  query: ISearchQuery
  fileMatches: IFileMatch[]
  totalMatches: number
  totalFiles: number
  isComplete: boolean
  limitHit: boolean
}

// 搜索历史条目
export interface ISearchHistoryEntry {
  id: string
  query: ISearchQuery
  timestamp: number
  resultCount: number
}

// 语言特性配置
export interface LanguageFeature {
  wordSeparators: string
  symbolPattern: RegExp
  commentPattern: RegExp
}
