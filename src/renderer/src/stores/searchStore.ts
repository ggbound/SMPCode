import { create } from 'zustand'
import type { ISearchQuery, ISearchResult, ISearchHistoryEntry, IFileMatch } from '../types/search'

// 从 localStorage 加载搜索历史
function loadSearchHistory(): ISearchHistoryEntry[] {
  try {
    const history = localStorage.getItem('searchHistory')
    return history ? JSON.parse(history) : []
  } catch (e) {
    console.error('Failed to load search history:', e)
    return []
  }
}

interface SearchState {
  // 查询状态
  query: ISearchQuery
  isSearching: boolean
  replaceString: string
  
  // 结果状态
  result: ISearchResult | null
  expandedFiles: Set<string>
  
  // UI状态
  showReplace: boolean
  showQueryDetails: boolean
  
  // 历史记录
  searchHistory: ISearchHistoryEntry[]
  
  // 操作方法
  setQuery: (query: Partial<ISearchQuery>) => void
  setReplaceString: (replaceString: string) => void
  setSearchResult: (result: ISearchResult) => void
  toggleReplace: () => void
  toggleQueryDetails: () => void
  expandFile: (filePath: string) => void
  collapseFile: (filePath: string) => void
  performSearch: (projectPath: string) => Promise<void>
  addToHistory: () => void
  clearResults: () => void
  loadFromHistory: (entry: ISearchHistoryEntry) => void
}

export const useSearchStore = create<SearchState>((set, get) => ({
  // 初始状态
  query: {
    contentPattern: '',
    isRegex: false,
    isCaseSensitive: false,
    isWholeWords: false,
    includePattern: '',
    excludePattern: '',
    maxResults: 10000,
    useIgnoreFiles: true
  },
  isSearching: false,
  replaceString: '',
  result: null,
  expandedFiles: new Set(),
  showReplace: false,
  showQueryDetails: false,
  searchHistory: loadSearchHistory(), // 从 localStorage 加载
  
  // 设置查询参数
  setQuery: (queryUpdate) => set((state) => ({
    query: { ...state.query, ...queryUpdate }
  })),
  
  // 设置替换字符串
  setReplaceString: (replaceString) => set({ replaceString }),
  
  // 设置搜索结果
  setSearchResult: (result) => set({ result }),
  
  // 切换替换模式
  toggleReplace: () => set((state) => ({
    showReplace: !state.showReplace
  })),
  
  // 切换查询详情显示
  toggleQueryDetails: () => set((state) => ({
    showQueryDetails: !state.showQueryDetails
  })),
  
  // 展开文件
  expandFile: (filePath) => set((state) => {
    const expandedFiles = new Set(state.expandedFiles)
    expandedFiles.add(filePath)
    return { expandedFiles }
  }),
  
  // 折叠文件
  collapseFile: (filePath) => set((state) => {
    const expandedFiles = new Set(state.expandedFiles)
    expandedFiles.delete(filePath)
    return { expandedFiles }
  }),
  
  // 执行搜索
  performSearch: async (projectPath: string) => {
    const { query } = get()
    
    console.log('[Search] Starting search:', {
      query: query.contentPattern,
      projectPath,
      isRegex: query.isRegex,
      isCaseSensitive: query.isCaseSensitive,
      isWholeWords: query.isWholeWords
    })
    
    if (!query.contentPattern.trim() || !projectPath) {
      console.log('[Search] Search cancelled: empty query or no project path')
      return
    }
    
    set({ isSearching: true })
    
    try {
      // 调用Electron API执行搜索
      if (!window.api?.executeSearch) {
        throw new Error('executeSearch IPC not available')
      }
      
      const response = await window.api.executeSearch({
        query: query.contentPattern,
        path: projectPath,
        includePattern: query.includePattern,
        excludePattern: query.excludePattern,
        isRegex: query.isRegex,
        isCaseSensitive: query.isCaseSensitive,
        isWholeWords: query.isWholeWords,
        maxResults: query.maxResults,
        useIgnoreFiles: query.useIgnoreFiles
      })
      
      console.log('[Search] Search response:', response)
      
      if (response.success && response.data) {
        const { matches, totalFiles, limitHit } = response.data
        
        console.log('[Search] Results:', {
          totalMatches: matches.length,
          totalFiles,
          limitHit,
          firstFewMatches: matches.slice(0, 3)
        })
        
        // 将匹配结果按文件分组
        const fileMatchesMap = new Map<string, IFileMatch>()
        
        for (const match of matches) {
          if (!fileMatchesMap.has(match.file)) {
            // 检测语言类型
            const languageId = detectLanguage(match.file)
            
            fileMatchesMap.set(match.file, {
              filePath: match.file,
              languageId,
              matches: [],
              matchCount: 0
            })
          }
          
          const fileMatch = fileMatchesMap.get(match.file)!
          fileMatch.matches.push({
            fileId: match.file,
            filePath: match.file,
            line: match.line,
            column: match.column,
            preview: match.content,
            match: match.match,
            languageId: fileMatch.languageId
          })
          fileMatch.matchCount++
        }
        
        const fileMatches = Array.from(fileMatchesMap.values())
        const totalMatches = fileMatches.reduce((sum, fm) => sum + fm.matchCount, 0)
        
        const result: ISearchResult = {
          query,
          fileMatches,
          totalMatches,
          totalFiles,
          isComplete: true,
          limitHit
        }
        
        set({ result })
        
        // 添加到历史记录
        get().addToHistory()
      } else {
        console.error('Search failed:', response.error)
        set({ result: null })
      }
    } catch (error) {
      console.error('Search error:', error)
      set({ result: null })
    } finally {
      set({ isSearching: false })
    }
  },
  
  // 添加到历史记录
  addToHistory: () => {
    const { query, result } = get()
    
    if (!query.contentPattern.trim()) {
      return
    }
    
    const entry: ISearchHistoryEntry = {
      id: Date.now().toString(),
      query: { ...query },
      timestamp: Date.now(),
      resultCount: result?.totalMatches || 0
    }
    
    set((state) => {
      const newHistory = [entry, ...state.searchHistory].slice(0, 50)
      
      // 保存到 localStorage
      try {
        localStorage.setItem('searchHistory', JSON.stringify(newHistory))
      } catch (e) {
        console.error('Failed to save search history:', e)
      }
      
      return { searchHistory: newHistory }
    })
  },
  
  // 清除结果
  clearResults: () => set({
    result: null,
    expandedFiles: new Set()
  }),
  
  // 从历史记录加载
  loadFromHistory: (entry) => set({
    query: entry.query,
    result: null,
    expandedFiles: new Set()
  })
}))

// 简单的语言检测函数
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'cs': 'csharp',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sh': 'bash',
    'bash': 'bash',
    'sql': 'sql',
    'vue': 'vue',
    'svelte': 'svelte'
  }
  
  return languageMap[ext] || 'plaintext'
}
