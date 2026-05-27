/**
 * CodeNavigation - 代码导航组件
 * 提供跳转到定义、查找引用、查看符号等功能
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  X,
  Search,
  FunctionSquare,
  Variable,
  Class,
  Interface,
  Type,
  File,
  ArrowLeft,
  ArrowRight,
  List,
  MapPin,
  Layers,
  Filter
} from 'lucide-react'
import { useStore } from '../store'

export interface NavigationItem {
  name: string
  kind: 'function' | 'variable' | 'class' | 'interface' | 'type' | 'enum' | 'constant' | 'module' | 'property' | 'method'
  location: {
    path: string
    line: number
    column: number
  }
  detail?: string
  containerName?: string
}

export interface NavigationHistory {
  path: string
  line: number
  column: number
}

export interface CodeNavigationProps {
  projectPath: string | null
  onNavigate: (path: string, line: number, column: number) => void
  currentFile: string | null
}

type ViewMode = 'outline' | 'symbols' | 'references' | 'breadcrumbs'

const SymbolKindIcons: { [key: string]: React.ReactNode } = {
  function: <FunctionSquare className="w-4 h-4 text-yellow-400" />,
  variable: <Variable className="w-4 h-4 text-blue-400" />,
  class: <Class className="w-4 h-4 text-green-400" />,
  interface: <Interface className="w-4 h-4 text-cyan-400" />,
  type: <Type className="w-4 h-4 text-purple-400" />,
  enum: <Layers className="w-4 h-4 text-orange-400" />,
  constant: <Variable className="w-4 h-4 text-blue-400" />,
  module: <File className="w-4 h-4 text-gray-400" />,
  property: <Variable className="w-4 h-4 text-pink-400" />,
  method: <FunctionSquare className="w-4 h-4 text-yellow-400" />
}

export const CodeNavigation: React.FC<CodeNavigationProps> = ({
  projectPath,
  onNavigate,
  currentFile
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('outline')
  const [searchQuery, setSearchQuery] = useState('')
  const [symbols, setSymbols] = useState<NavigationItem[]>([])
  const [outline, setOutline] = useState<NavigationItem[]>([])
  const [references, setReferences] = useState<NavigationItem[]>([])
  const [history, setHistory] = useState<NavigationHistory[]>([])
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1)
  const [selectedSymbol, setSelectedSymbol] = useState<NavigationItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 添加历史记录
  const addToHistory = useCallback((path: string, line: number, column: number) => {
    setHistory(prev => {
      // 移除当前位置之后的历史
      const newHistory = prev.slice(0, currentHistoryIndex + 1)
      newHistory.push({ path, line, column })
      // 限制历史记录数量
      if (newHistory.length > 50) {
        newHistory.shift()
      }
      return newHistory
    })
    setCurrentHistoryIndex(prev => prev + 1)
  }, [currentHistoryIndex])

  // 向后导航
  const goBack = useCallback(() => {
    if (currentHistoryIndex > 0) {
      const prev = history[currentHistoryIndex - 1]
      setCurrentHistoryIndex(currentHistoryIndex - 1)
      onNavigate(prev.path, prev.line, prev.column)
    }
  }, [history, currentHistoryIndex, onNavigate])

  // 向前导航
  const goForward = useCallback(() => {
    if (currentHistoryIndex < history.length - 1) {
      const next = history[currentHistoryIndex + 1]
      setCurrentHistoryIndex(currentHistoryIndex + 1)
      onNavigate(next.path, next.line, next.column)
    }
  }, [history, currentHistoryIndex, onNavigate])

  // 跳转到定义
  const goToDefinition = useCallback(async () => {
    if (!currentFile) return

    setIsLoading(true)
    try {
      const api = (window as any).api
      if (api?.lsp?.definition) {
        const result = await api.lsp.definition(currentFile)
        if (result && result.length > 0) {
          const location = result[0]
          addToHistory(location.path, location.line, location.column)
          onNavigate(location.path, location.line, location.column)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [currentFile, onNavigate, addToHistory])

  // 查找引用
  const findReferences = useCallback(async (symbol: string) => {
    if (!currentFile || !symbol) return

    setViewMode('references')
    setIsLoading(true)
    try {
      const api = (window as any).api
      if (api?.lsp?.references) {
        const result = await api.lsp.references(currentFile, symbol)
        const items: NavigationItem[] = result.map((ref: any) => ({
          name: ref.name,
          kind: ref.kind,
          location: {
            path: ref.uri,
            line: ref.range.start.line + 1,
            column: ref.range.start.character + 1
          },
          detail: ref.detail
        }))
        setReferences(items)
      }
    } finally {
      setIsLoading(false)
    }
  }, [currentFile])

  // 获取文档符号
  const fetchDocumentSymbols = useCallback(async () => {
    if (!currentFile) {
      setOutline([])
      return
    }

    setIsLoading(true)
    try {
      const api = (window as any).api
      if (api?.lsp?.documentSymbols) {
        const result = await api.lsp.documentSymbols(currentFile)
        const items: NavigationItem[] = result.map((sym: any) => ({
          name: sym.name,
          kind: mapSymbolKind(sym.kind),
          location: {
            path: currentFile,
            line: sym.location.range.start.line + 1,
            column: sym.location.range.start.character + 1
          },
          detail: sym.detail,
          containerName: sym.containerName
        }))
        setOutline(items)
      }
    } catch (error) {
      console.error('Failed to fetch document symbols:', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentFile])

  // 获取工作区符号
  const fetchWorkspaceSymbols = useCallback(async (query: string) => {
    if (!projectPath) return

    setIsLoading(true)
    try {
      const api = (window as any).api
      if (api?.lsp?.workspaceSymbols) {
        const result = await api.lsp.workspaceSymbols(query)
        const items: NavigationItem[] = result.map((sym: any) => ({
          name: sym.name,
          kind: mapSymbolKind(sym.kind),
          location: {
            path: sym.location.uri,
            line: sym.location.range.start.line + 1,
            column: sym.location.range.start.character + 1
          },
          detail: sym.containerName
        }))
        setSymbols(items)
      }
    } catch (error) {
      console.error('Failed to fetch workspace symbols:', error)
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])

  // 映射符号类型
  const mapSymbolKind = (kind: number): NavigationItem['kind'] => {
    const kindMap: { [key: number]: NavigationItem['kind'] } = {
      1: 'module',
      2: 'constant',
      3: 'variable',
      4: 'interface',
      5: 'function',
      6: 'method',
      7: 'property',
      8: 'variable',
      9: 'interface',
      10: 'interface',
      11: 'type',
      12: 'type',
      13: 'type',
      14: 'variable',
      15: 'variable',
      16: 'variable',
      17: 'function',
      18: 'variable',
      19: 'class',
      20: 'variable',
      21: 'enum',
      22: 'variable',
      23: 'function',
      24: 'type',
      25: 'type',
      26: 'type'
    }
    return kindMap[kind] || 'variable'
  }

  // 处理符号点击
  const handleSymbolClick = useCallback((item: NavigationItem) => {
    addToHistory(item.location.path, item.location.line, item.location.column)
    onNavigate(item.location.path, item.location.line, item.location.column)
    setSelectedSymbol(item)
  }, [onNavigate, addToHistory])

  // 过滤符号
  const filteredSymbols = useCallback((items: NavigationItem[]) => {
    if (!searchQuery) return items
    const query = searchQuery.toLowerCase()
    return items.filter(item =>
      item.name.toLowerCase().includes(query) ||
      (item.detail && item.detail.toLowerCase().includes(query)) ||
      (item.containerName && item.containerName.toLowerCase().includes(query))
    )
  }, [searchQuery])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12: 跳转到定义
      if (e.key === 'F12') {
        e.preventDefault()
        goToDefinition()
      }
      // Shift+F12: 查找引用
      if (e.key === 'F12' && e.shiftKey) {
        e.preventDefault()
        if (selectedSymbol) {
          findReferences(selectedSymbol.name)
        }
      }
      // Ctrl+Shift+O: 显示大纲
      if (e.key === 'o' && e.ctrlKey && e.shiftKey) {
        e.preventDefault()
        setViewMode('outline')
        setIsVisible(true)
      }
      // Ctrl+T: 显示符号搜索
      if (e.key === 't' && e.ctrlKey) {
        e.preventDefault()
        setViewMode('symbols')
        setIsVisible(true)
        searchInputRef.current?.focus()
      }
      // Alt+Left: 返回
      if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault()
        goBack()
      }
      // Alt+Right: 前进
      if (e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault()
        goForward()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToDefinition, findReferences, selectedSymbol, goBack, goForward])

  // 加载大纲
  useEffect(() => {
    if (viewMode === 'outline' && currentFile) {
      fetchDocumentSymbols()
    }
  }, [viewMode, currentFile, fetchDocumentSymbols])

  // 搜索工作区符号
  useEffect(() => {
    if (viewMode === 'symbols' && searchQuery) {
      const timeout = setTimeout(() => {
        fetchWorkspaceSymbols(searchQuery)
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [viewMode, searchQuery, fetchWorkspaceSymbols])

  // 渲染导航按钮
  const renderNavButtons = () => (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10">
      <button
        onClick={goBack}
        disabled={currentHistoryIndex <= 0}
        className="p-1.5 hover:bg-white/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
        title="返回 (Alt+Left)"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button
        onClick={goForward}
        disabled={currentHistoryIndex >= history.length - 1}
        className="p-1.5 hover:bg-white/10 rounded disabled:opacity-30 disabled:cursor-not-allowed"
        title="前进 (Alt+Right)"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => setIsVisible(false)}
        className="p-1.5 hover:bg-white/10 rounded"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )

  // 渲染工具栏
  const renderToolbar = () => (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10 bg-white/5">
      {[
        { mode: 'outline', icon: List, label: '大纲' },
        { mode: 'symbols', icon: Search, label: '符号' },
        { mode: 'references', icon: MapPin, label: '引用' }
      ].map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode as ViewMode)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            viewMode === mode
              ? 'bg-blue-500/30 text-blue-300'
              : 'hover:bg-white/10 text-gray-400'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )

  // 渲染搜索框
  const renderSearch = () => (
    <div className="px-2 py-2 border-b border-white/10">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-white/5 rounded">
        <Search className="w-4 h-4 text-gray-500" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={viewMode === 'outline' ? '过滤符号...' : '搜索符号 (Ctrl+T)...'}
          className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder-gray-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="p-0.5 hover:bg-white/10 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )

  // 渲染符号列表
  const renderSymbolList = (items: NavigationItem[]) => {
    const filtered = filteredSymbols(items)

    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8 text-gray-500 text-xs">
          <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full mr-2" />
          加载中...
        </div>
      )
    }

    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-gray-500 text-xs">
          <Search className="w-8 h-8 mb-2 opacity-50" />
          {searchQuery ? '未找到匹配的符号' : '暂无符号'}
        </div>
      )
    }

    return (
      <div className="overflow-auto">
        {filtered.map((item, index) => (
          <div
            key={`${item.name}-${index}`}
            onClick={() => handleSymbolClick(item)}
            className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 ${
              selectedSymbol?.name === item.name ? 'bg-blue-500/20' : ''
            }`}
          >
            <div className="mt-0.5">
              {SymbolKindIcons[item.kind] || <Variable className="w-4 h-4 text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{item.name}</div>
              {item.detail && (
                <div className="text-xs text-gray-500 truncate">{item.detail}</div>
              )}
              <div className="flex items-center gap-2 text-[10px] text-gray-600">
                <span className="truncate">{item.location.path.split('/').pop()}</span>
                <span>:{item.location.line}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // 渲染内容
  const renderContent = () => {
    switch (viewMode) {
      case 'outline':
        return renderSymbolList(outline)
      case 'symbols':
        return renderSymbolList(symbols)
      case 'references':
        return (
          <div>
            {selectedSymbol && (
              <div className="px-3 py-2 border-b border-white/10 bg-white/5">
                <div className="text-sm text-white">{selectedSymbol.name}</div>
                <div className="text-xs text-gray-500">
                  {references.length} 个引用
                </div>
              </div>
            )}
            {renderSymbolList(references)}
          </div>
        )
      default:
        return null
    }
  }

  if (!isVisible) {
    return (
      <div className="fixed right-4 top-16 flex flex-col gap-2 z-50">
        <button
          onClick={() => setIsVisible(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[#252526] border border-white/10 rounded-lg shadow-lg hover:bg-white/5 transition-colors"
          title="代码导航 (Ctrl+Shift+O)"
        >
          <MapPin className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-white">导航</span>
        </button>
      </div>
    )
  }

  return (
    <div className="fixed right-4 top-16 w-80 bg-[#252526] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
      {renderNavButtons()}
      {renderToolbar()}
      {(viewMode === 'outline' || viewMode === 'symbols') && renderSearch()}
      <div className="max-h-96">
        {renderContent()}
      </div>
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-600 flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded">F12</kbd>
        <span>跳转到定义</span>
        <span className="text-gray-500">|</span>
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded">Shift+F12</kbd>
        <span>查找引用</span>
      </div>
    </div>
  )
}

export default CodeNavigation
