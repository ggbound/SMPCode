import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Folder, FolderOpen, File, ArrowUp, Scissors, Edit, Trash2 } from 'lucide-react'
import { t } from '../i18n'
import { gitIPC } from './GitStatusBar'
import { getFileIconSVG } from '../utils/fileIconTheme'
import { getSetiIconInfo } from '../utils/setiIconTheme'
import '../styles/fileExplorer.css'

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isOpen?: boolean
  isLoading?: boolean
  gitStatus?: 'modified' | 'staged' | 'untracked' | 'conflicted' | null
  // VSCode-style properties
  hasChildren?: boolean  // Whether the node has children (for lazy loading)
  isExpanded?: boolean   // Whether the node is currently expanded
  depth?: number         // Depth in the tree for indentation
}

interface FileExplorerProps {
  onFileSelect: (path: string, content: string) => void
  selectedPath: string | null
  onRootPathChange?: (path: string) => void
  openFile?: (path: string, content: string) => void
  onFileRenamed?: (oldPath: string, newPath: string, newName: string) => void
  onFileDeleted?: (path: string) => void
}

// VSCode-style file icon component using Seti-UI font icons
const FileIcon = ({ filename, isDirectory, isOpen }: { filename: string; isDirectory: boolean; isOpen?: boolean }) => {
  const iconInfo = getSetiIconInfo(filename, isDirectory, isOpen)
  
  return (
    <span 
      className="seti-icon"
      data-icon-char={iconInfo.char}
      style={{ color: iconInfo.color }}
      aria-hidden="true"
    />
  )
}

// Legacy function for backward compatibility
const getFileIcon = (filename: string, isDirectory: boolean, isOpen?: boolean) => {
  if (isDirectory) {
    return isOpen ? <FolderOpen size={16} /> : <Folder size={16} />
  }
  return <File size={16} />
}

// Git status badge component
const GitStatusBadge = ({ status }: { status?: string | null }) => {
  if (!status) return null
  
  const getBadgeStyle = () => {
    switch (status) {
      case 'modified':
        return { color: '#d29922', title: 'Modified' }
      case 'staged':
        return { color: '#3fb950', title: 'Staged' }
      case 'untracked':
        return { color: '#8b949e', title: 'Untracked' }
      case 'conflicted':
        return { color: '#f85149', title: 'Conflicted' }
      default:
        return { color: 'transparent', title: '' }
    }
  }
  
  const style = getBadgeStyle()
  
  return (
    <span 
      className="git-status-badge" 
      style={{ backgroundColor: style.color }}
      title={style.title}
    />
  )
}

function FileExplorer({ onFileSelect, selectedPath, onRootPathChange, openFile, onFileRenamed, onFileDeleted }: FileExplorerProps) {
  const [rootPath, setRootPath] = useState<string>('')
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null)
  const [newItemDialog, setNewItemDialog] = useState<{ isOpen: boolean; type: 'file' | 'folder'; parentPath: string } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [renameDialog, setRenameDialog] = useState<{ isOpen: boolean; node: FileNode | null } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingNode, setEditingNode] = useState<{ path: string; name: string } | null>(null)
  const [draggedNode, setDraggedNode] = useState<FileNode | null>(null)
  const [dropTarget, setDropTarget] = useState<{ path: string; position: 'before' | 'after' | 'inside' } | null>(null)
  const [clipboard, setClipboard] = useState<{ path: string; type: 'copy' | 'cut'; node: FileNode } | null>(null)
  const fileTreeRef = useRef<FileNode[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isWatchingRef = useRef(false)
  
  // Virtual scrolling optimization
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const ITEM_HEIGHT = 24 // Height of each file tree item in pixels
  const VISIBLE_BUFFER = 10 // Number of items to render outside visible area

  const API_BASE = 'http://localhost:3847/api'

  // Keep ref in sync with state
  useEffect(() => {
    fileTreeRef.current = fileTree
  }, [fileTree])

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + F to focus search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setIsSearching(true)
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
      // Escape to close search
      if (e.key === 'Escape' && isSearching) {
        setIsSearching(false)
        setSearchQuery('')
      }
      // F2 to rename selected file
      if (e.key === 'F2' && selectedPath) {
        e.preventDefault()
        const findNodeByPath = (nodes: FileNode[], path: string): FileNode | null => {
          for (const node of nodes) {
            if (node.path === path) return node
            if (node.children) {
              const found = findNodeByPath(node.children, path)
              if (found) return found
            }
          }
          return null
        }
        const node = findNodeByPath(fileTree, selectedPath)
        if (node) {
          setEditingNode({ path: node.path, name: node.name })
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSearching, selectedPath, fileTree])

  // File watching - auto refresh on file changes
  useEffect(() => {
    if (!rootPath || isWatchingRef.current) return

    const startWatching = async () => {
      try {
        await (window as any).api.fsWatch(rootPath)
        isWatchingRef.current = true
        console.log('[FileExplorer] Started watching:', rootPath)
      } catch (err) {
        console.error('[FileExplorer] Failed to start watching:', err)
      }
    }

    startWatching()

    // Listen for file change events
    const handleFileChange = (_event: any, data: { eventType: string; filename: string; dirPath: string }) => {
      console.log('[FileExplorer] File changed:', data.eventType, data.filename)
      // Debounce refresh
      setTimeout(() => {
        handleRefreshPreserveExpansion()
      }, 500)
    }

    const { api } = window as any
    if (api && api.onFileChange) {
      api.onFileChange(handleFileChange)
    }

    return () => {
      if (isWatchingRef.current && rootPath) {
        api?.fsUnwatch(rootPath)
        isWatchingRef.current = false
      }
    }
  }, [rootPath])

  // Refresh project context when files change
  const refreshProjectContext = useCallback(async () => {
    if (!rootPath) return
    try {
      await fetch(`${API_BASE}/project-context/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rootPath })
      })
    } catch (error) {
      console.error('[FileExplorer] Failed to refresh project context:', error)
    }
  }, [rootPath])

  // Auto refresh file tree when files are modified
  useEffect(() => {
    if (rootPath) {
      handleRefreshNoExpansion()
      refreshProjectContext()

      const interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          handleRefreshPreserveExpansion()
          refreshProjectContext()
        }
      }, 30000)

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          handleRefreshPreserveExpansion()
          refreshProjectContext()
        }
      }
      document.addEventListener('visibilitychange', handleVisibilityChange)

      return () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [rootPath, refreshProjectContext])

  // Listen for file operation events from AI tools (separate useEffect to avoid circular deps)
  useEffect(() => {
    const handleFileOperationCompleted = () => {
      console.log('[FileExplorer] File operation completed, refreshing...')
      // Directly refresh without depending on external functions
      if (rootPath) {
        // Refresh file tree while preserving expansion state
        const buildExpansionMap = (nodes: FileNode[], map: Map<string, boolean>) => {
          for (const node of nodes) {
            if (node.isDirectory) {
              map.set(node.path, node.isOpen || false)
              if (node.children) {
                buildExpansionMap(node.children, map)
              }
            }
          }
        }

        const expansionMap = new Map<string, boolean>()
        buildExpansionMap(fileTreeRef.current, expansionMap)

        fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(rootPath)}`)
          .then(res => res.json())
          .then(async (items: FileNode[]) => {
            // Get Git status for files
            const gitRoot = await gitIPC.findRoot(rootPath)
            let processedItems = items
            if (gitRoot) {
              processedItems = await getGitStatusForFiles(items, gitRoot)
            }
            
            const applyExpansion = (nodes: FileNode[]): FileNode[] => {
              return nodes.map(node => {
                if (node.isDirectory) {
                  const wasOpen = expansionMap.get(node.path)
                  return { ...node, isOpen: wasOpen || false }
                }
                return node
              })
            }
            setFileTree(applyExpansion(processedItems))
          })
          .catch(err => console.error('[FileExplorer] Refresh failed:', err))

        // Refresh project context
        fetch(`${API_BASE}/project-context/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: rootPath })
        }).catch(err => console.error('[FileExplorer] Context refresh failed:', err))
      }
    }
    window.addEventListener('file-operation-completed', handleFileOperationCompleted)

    return () => {
      window.removeEventListener('file-operation-completed', handleFileOperationCompleted)
    }
  }, [rootPath])

  // Load directory contents
  const loadDirectory = useCallback(async (path: string): Promise<FileNode[]> => {
    try {
      const res = await fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(path)}`)
      if (res.ok) {
        const data = await res.json()
        return data.items || []
      }
    } catch (error) {
      console.error('Failed to load directory:', error)
    }
    return []
  }, [])

  // Get Git status for files in a directory
  const getGitStatusForFiles = useCallback(async (nodes: FileNode[], repoPath: string): Promise<FileNode[]> => {
    if (!repoPath) return nodes
    
    const updatedNodes = await Promise.all(
      nodes.map(async (node) => {
        if (!node.isDirectory) {
          try {
            const status = await gitIPC.getFileStatus(repoPath, node.path)
            return { ...node, gitStatus: status as any }
          } catch (err) {
            return node
          }
        }
        return node
      })
    )
    
    return updatedNodes
  }, [])

  // Toggle directory open/close with lazy loading (VSCode-style)
  const toggleDirectory = useCallback(async (node: FileNode, tree: FileNode[], path: string[]) => {
    const newTree = [...tree]
    let current = newTree

    for (let i = 0; i < path.length; i++) {
      const index = current.findIndex(n => n.name === path[i])
      if (index === -1) return newTree

      if (i === path.length - 1) {
        const isOpening = !current[index].isOpen
        current[index] = { ...current[index], isOpen: isOpening, isExpanded: isOpening }

        if (isOpening && (!current[index].children || current[index].children.length === 0)) {
          current[index] = { ...current[index], isLoading: true }
          setFileTree(newTree)
          
          // Lazy load children only when expanding
          let children = await loadDirectory(current[index].path)
          
          // Get Git status for files
          const gitRoot = await gitIPC.findRoot(rootPath)
          if (gitRoot) {
            children = await getGitStatusForFiles(children, gitRoot)
          }
          
          const updateTree = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(n => {
              if (n.path === node.path) {
                return { 
                  ...n, 
                  children, 
                  isLoading: false,
                  hasChildren: children.length > 0
                }
              }
              if (n.children) {
                return { ...n, children: updateTree(n.children) }
              }
              return n
            })
          }
          setFileTree(prev => updateTree(prev))
          return
        }
      } else {
        current = current[index].children!
      }
    }

    return newTree
  }, [loadDirectory, rootPath])

  // Handle node click
  const handleNodeClick = useCallback(async (node: FileNode, tree: FileNode[], path: string[], e?: React.MouseEvent) => {
    e?.stopPropagation()
    
    if (node.isDirectory) {
      const newTree = await toggleDirectory(node, tree, path)
      if (newTree) {
        setFileTree(newTree)
      }
    } else {
      // Load file content
      try {
        const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(node.path)}`)
        if (res.ok) {
          const data = await res.json()
          if (openFile) {
            openFile(node.path, data.content || '')
          } else {
            onFileSelect(node.path, data.content || '')
          }
        }
      } catch (error) {
        console.error('Failed to read file:', error)
      }
    }
  }, [onFileSelect, openFile, toggleDirectory])

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  // Create new file or folder
  const handleCreateNew = async () => {
    if (!newItemDialog || !newItemName.trim()) return
    
    const parentPath = newItemDialog.parentPath
    const newPath = `${parentPath}/${newItemName.trim()}`
    
    try {
      if (newItemDialog.type === 'file') {
        const res = await fetch(`${API_BASE}/fs/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newPath, content: '' })
        })
        if (res.ok) {
          handleRefreshPreserveExpansion()
        }
      } else {
        const res = await fetch(`${API_BASE}/fs/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newPath })
        })
        if (res.ok) {
          handleRefreshPreserveExpansion()
        }
      }
    } catch (error) {
      console.error('Failed to create item:', error)
    }
    
    setNewItemDialog(null)
    setNewItemName('')
  }

  // Rename file or folder
  const handleRename = async () => {
    if (!renameDialog?.node || !renameValue.trim()) return
    
    const oldPath = renameDialog.node.path
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = `${parentPath}/${renameValue.trim()}`
    const newName = renameValue.trim()
    
    try {
      const res = await fetch(`${API_BASE}/fs/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
      })
      if (res.ok) {
        handleRefreshPreserveExpansion()
        // Notify parent component about the rename
        onFileRenamed?.(oldPath, newPath, newName)
      }
    } catch (error) {
      console.error('Failed to rename item:', error)
    }
    
    setRenameDialog(null)
    setRenameValue('')
  }

  // Delete file or folder
  const handleDelete = async (node: FileNode) => {
    if (!confirm(t('confirmDelete').replace('{name}', node.name))) return
    
    try {
      const res = await fetch(`${API_BASE}/fs/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path })
      })
      if (res.ok) {
        handleRefreshPreserveExpansion()
        // Notify parent component about the deletion
        onFileDeleted?.(node.path)
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
    }
    setContextMenu(null)
  }

  // Handle inline rename
  const handleInlineRename = async () => {
    if (!editingNode || !editingNode.name.trim()) {
      setEditingNode(null)
      return
    }
    
    const oldPath = editingNode.path
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = `${parentPath}/${editingNode.name.trim()}`
    const newName = editingNode.name.trim()
    
    try {
      const res = await fetch(`${API_BASE}/fs/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
      })
      if (res.ok) {
        handleRefreshPreserveExpansion()
        onFileRenamed?.(oldPath, newPath, newName)
      }
    } catch (error) {
      console.error('Failed to rename item:', error)
    }
    
    setEditingNode(null)
  }

  // Copy file/folder
  const handleCopy = (node: FileNode) => {
    setClipboard({ path: node.path, type: 'copy', node })
    setContextMenu(null)
  }

  // Cut file/folder
  const handleCut = (node: FileNode) => {
    setClipboard({ path: node.path, type: 'cut', node })
    setContextMenu(null)
  }

  // Paste file/folder
  const handlePaste = async (targetDir: string) => {
    if (!clipboard) return
    
    const fileName = clipboard.node.name
    const targetPath = `${targetDir}/${fileName}`
    
    try {
      if (clipboard.type === 'copy') {
        // For copy, we need to read and write
        const readRes = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(clipboard.path)}`)
        if (readRes.ok) {
          const data = await readRes.json()
          const writeRes = await fetch(`${API_BASE}/fs/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: targetPath, content: data.content || '' })
          })
          if (writeRes.ok) {
            handleRefreshPreserveExpansion()
          }
        }
      } else {
        // For cut, use rename
        const res = await fetch(`${API_BASE}/fs/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: clipboard.path, newPath: targetPath })
        })
        if (res.ok) {
          handleRefreshPreserveExpansion()
          setClipboard(null)
        }
      }
    } catch (error) {
      console.error('Failed to paste item:', error)
    }
    setContextMenu(null)
  }

  // Reveal in Finder/Explorer
  const handleRevealInFinder = async (node: FileNode) => {
    try {
      const api = window.api as unknown as { revealInFinder: (path: string) => Promise<void> }
      if (api?.revealInFinder) {
        await api.revealInFinder(node.path)
      }
    } catch (error) {
      console.error('Failed to reveal in finder:', error)
    }
    setContextMenu(null)
  }

  // Copy path to clipboard
  const handleCopyPath = async (node: FileNode) => {
    try {
      await navigator.clipboard.writeText(node.path)
    } catch (error) {
      console.error('Failed to copy path:', error)
    }
    setContextMenu(null)
  }

  // Set working directory on backend
  const setWorkingDirectory = useCallback(async (dirPath: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/cwd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: dirPath })
      })
      if (res.ok) {
        const data = await res.json()
        console.log('Working directory set to:', data.cwd)
        return true
      }
    } catch (error) {
      console.error('Failed to set working directory:', error)
    }
    return false
  }, [])

  // Select folder
  const handleSelectFolder = useCallback(async () => {
    try {
      setIsLoading(true)
      const api = window.api as unknown as { selectFolder: () => Promise<string | null> }
      if (api?.selectFolder) {
        const folderPath = await api.selectFolder()
        if (folderPath) {
          const success = await setWorkingDirectory(folderPath)
          if (!success) {
            alert(t('failedToSetWorkingDir') || 'Failed to set working directory')
            return
          }
          setRootPath(folderPath)
          onRootPathChange?.(folderPath)
          const items = await loadDirectory(folderPath)
          setFileTree(items)
        }
      } else {
        const folderPath = prompt(t('enterFolderPath') || 'Enter folder path:')
        if (folderPath) {
          const success = await setWorkingDirectory(folderPath)
          if (!success) {
            alert(t('failedToSetWorkingDir') || 'Failed to set working directory')
            return
          }
          setRootPath(folderPath)
          onRootPathChange?.(folderPath)
          const items = await loadDirectory(folderPath)
          setFileTree(items)
        }
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    } finally {
      setIsLoading(false)
    }
  }, [loadDirectory, setWorkingDirectory, onRootPathChange])

  // Refresh current folder
  const handleRefresh = useCallback(async () => {
    if (rootPath) {
      const items = await loadDirectory(rootPath)
      setFileTree(items)
    }
  }, [rootPath, loadDirectory])

  // Refresh without expanding any folders (for initial load)
  const handleRefreshNoExpansion = useCallback(async () => {
    if (rootPath) {
      const items = await loadDirectory(rootPath)
      const closeAll = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.isDirectory) {
            return { ...node, isOpen: false, children: undefined }
          }
          return node
        })
      }
      setFileTree(closeAll(items))
    }
  }, [rootPath, loadDirectory])

  // Refresh while preserving current expansion state
  const handleRefreshPreserveExpansion = useCallback(async () => {
    if (rootPath) {
      const buildExpansionMap = (nodes: FileNode[], map: Map<string, boolean>) => {
        for (const node of nodes) {
          if (node.isDirectory) {
            map.set(node.path, node.isOpen || false)
            if (node.children) {
              buildExpansionMap(node.children, map)
            }
          }
        }
      }

      const expansionMap = new Map<string, boolean>()
      buildExpansionMap(fileTreeRef.current, expansionMap)

      const items = await loadDirectory(rootPath)

      const applyExpansion = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.isDirectory) {
            const wasOpen = expansionMap.get(node.path)
            return { ...node, isOpen: wasOpen || false }
          }
          return node
        })
      }

      let mergedItems = applyExpansion(items)

      const loadExpandedChildren = async (nodes: FileNode[]): Promise<FileNode[]> => {
        const result: FileNode[] = []
        for (const node of nodes) {
          if (node.isDirectory && node.isOpen) {
            const children = await loadDirectory(node.path)
            const expandedChildren = applyExpansion(children)
            const loadedChildren = await loadExpandedChildren(expandedChildren)
            result.push({ ...node, children: loadedChildren })
          } else if (node.isDirectory) {
            result.push({ ...node, children: undefined })
          } else {
            result.push(node)
          }
        }
        return result
      }

      mergedItems = await loadExpandedChildren(mergedItems)
      setFileTree(mergedItems)
    }
  }, [rootPath, loadDirectory])

  // Filter file tree based on search query with debounce optimization
  const filteredFileTree = useMemo(() => {
    if (!searchQuery.trim()) return fileTree
    
    const query = searchQuery.toLowerCase()
    const filterNodes = (nodes: FileNode[]): FileNode[] => {
      const result: FileNode[] = []
      for (const node of nodes) {
        const matchesSearch = node.name.toLowerCase().includes(query)
        
        if (node.isDirectory && node.children) {
          const filteredChildren = filterNodes(node.children)
          if (matchesSearch || filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren, isOpen: true })
          }
        } else if (matchesSearch) {
          result.push(node)
        }
      }
      return result
    }
    
    return filterNodes(fileTree)
  }, [fileTree, searchQuery])

  // Flatten tree for virtual scrolling
  const flattenedTree = useMemo(() => {
    const flatten = (nodes: FileNode[], depth: number = 0, parentPath: string[] = []): Array<FileNode & { depth: number; fullPath: string[] }> => {
      const result: Array<FileNode & { depth: number; fullPath: string[] }> = []
      for (const node of nodes) {
        const currentPath = [...parentPath, node.name]
        result.push({ ...node, depth, fullPath: currentPath })
        if (node.isDirectory && node.isOpen && node.children) {
          result.push(...flatten(node.children, depth + 1, currentPath))
        }
      }
      return result
    }
    return flatten(filteredFileTree)
  }, [filteredFileTree])

  // Handle scroll for virtual rendering
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollTop = container.scrollTop
      const visibleHeight = container.clientHeight
      const totalItems = flattenedTree.length
      
      const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - VISIBLE_BUFFER)
      const end = Math.min(
        totalItems,
        Math.ceil((scrollTop + visibleHeight) / ITEM_HEIGHT) + VISIBLE_BUFFER
      )
      
      setVisibleRange({ start, end })
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [flattenedTree])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  // Handle search input with debounce
  const handleSearchChange = (value: string) => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(value)
    }, 300) // 300ms debounce
  }

  // Collapse all folders
  const handleCollapseAll = () => {
    const collapseAll = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(node => {
        if (node.isDirectory) {
          return { ...node, isOpen: false, children: node.children ? collapseAll(node.children) : undefined }
        }
        return node
      })
    }
    setFileTree(collapseAll(fileTree))
  }

  // Render flattened file tree node (for virtual scrolling - no recursive children)
  const renderFlattenedNode = (node: FileNode & { depth: number; fullPath: string[] }, index: number): React.ReactElement => {
    const isSelected = node.path === selectedPath
    const hasChildren = node.isDirectory && (node.hasChildren ?? (node.children?.length ?? 0) > 0)
    const isEmptyFolder = node.isDirectory && !hasChildren && !node.isLoading
    const isEditing = editingNode?.path === node.path
    const isDropTarget = dropTarget?.path === node.path
    const isExpanded = node.isOpen || node.isExpanded

    return (
      <div key={node.path} className="file-tree-node" data-depth={node.depth}>
        <div
          className={`file-node ${isSelected ? 'selected' : ''} ${node.isDirectory ? 'directory' : 'file'} ${isDropTarget ? `drop-target-${dropTarget?.position}` : ''}`}
          style={{ paddingLeft: `${node.depth * 16 + 4}px` }}
          onClick={(e) => handleNodeClick(node, filteredFileTree, node.fullPath, e)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          title={node.path}
          draggable={!node.isDirectory}
          onDragStart={(e) => {
            if (!node.isDirectory) {
              e.dataTransfer.setData('text/plain', node.path)
              setDraggedNode(node)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (node.isDirectory) {
              const rect = e.currentTarget.getBoundingClientRect()
              const y = e.clientY - rect.top
              const height = rect.height
              
              if (y < height * 0.25) {
                setDropTarget({ path: node.path, position: 'before' })
              } else if (y > height * 0.75) {
                setDropTarget({ path: node.path, position: 'after' })
              } else {
                setDropTarget({ path: node.path, position: 'inside' })
              }
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropTarget(null)
            }
          }}
          onDrop={async (e) => {
            e.preventDefault()
            setDropTarget(null)
            
            const draggedPath = e.dataTransfer.getData('text/plain')
            if (draggedPath && draggedPath !== node.path && node.isDirectory) {
              try {
                const fileName = draggedPath.split('/').pop()!
                const targetDir = node.path
                const response = await fetch(`${API_BASE}/files/move`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sourcePath: draggedPath,
                    targetPath: `${targetDir}/${fileName}`
                  })
                })
                
                if (response.ok) {
                  handleRefreshPreserveExpansion()
                }
              } catch (error) {
                console.error('Failed to move file:', error)
              }
              setDraggedNode(null)
            }
          }}
        >
          {/* Expand/Collapse arrow for directories - VSCode style */}
          {node.isDirectory && (
            <span 
              className={`file-arrow ${isExpanded ? 'expanded' : ''} ${isEmptyFolder ? 'empty' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (!isEmptyFolder) {
                  handleNodeClick(node, filteredFileTree, node.fullPath, e)
                }
              }}
            >
              {!isEmptyFolder && (isExpanded ? '▼' : '▶')}
            </span>
          )}
          {!node.isDirectory && <span className="file-arrow-placeholder" />}
          
          {/* File/Folder icon with VSCode-style icons */}
          <FileIcon filename={node.name} isDirectory={node.isDirectory} isOpen={isExpanded} />
          
          {/* Git status badge */}
          <GitStatusBadge status={node.gitStatus} />
          
          {/* File name or inline edit input */}
          {isEditing ? (
            <input
              className="file-name-input"
              value={editingNode.name}
              onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
              onBlur={handleInlineRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  handleInlineRename()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditingNode(null)
                }
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="file-name">{node.name}</span>
          )}
          
          {/* Loading indicator */}
          {node.isLoading && <span className="file-loading">⟳</span>}
        </div>
      </div>
    )
  }

  // Render file tree node with VSCode-style optimizations
  const renderNode = (node: FileNode, tree: FileNode[], path: string[], depth: number = 0): React.ReactElement => {
    const isSelected = node.path === selectedPath
    const currentPath = [...path, node.name]
    const hasChildren = node.isDirectory && (node.hasChildren ?? (node.children?.length ?? 0) > 0)
    const isEmptyFolder = node.isDirectory && !hasChildren && !node.isLoading
    const isEditing = editingNode?.path === node.path
    const isDropTarget = dropTarget?.path === node.path
    const isExpanded = node.isOpen || node.isExpanded

    return (
      <div key={node.path} className="file-tree-node" data-depth={depth}>
        <div
          className={`file-node ${isSelected ? 'selected' : ''} ${node.isDirectory ? 'directory' : 'file'} ${isDropTarget ? `drop-target-${dropTarget.position}` : ''}`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={(e) => handleNodeClick(node, tree, currentPath, e)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          title={node.path}
          draggable={!node.isDirectory}
          onDragStart={(e) => {
            if (!node.isDirectory) {
              e.dataTransfer.setData('text/plain', node.path)
              setDraggedNode(node)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (node.isDirectory) {
              const rect = e.currentTarget.getBoundingClientRect()
              const y = e.clientY - rect.top
              const height = rect.height
              
              if (y < height * 0.25) {
                setDropTarget({ path: node.path, position: 'before' })
              } else if (y > height * 0.75) {
                setDropTarget({ path: node.path, position: 'after' })
              } else {
                setDropTarget({ path: node.path, position: 'inside' })
              }
            }
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={async (e) => {
            e.preventDefault()
            setDropTarget(null)
            
            const sourcePath = e.dataTransfer.getData('text/plain')
            if (!sourcePath || !node.isDirectory) return
            
            const fileName = sourcePath.split('/').pop()
            if (!fileName) return
            
            const targetPath = `${node.path}/${fileName}`
            
            try {
              const res = await fetch(`${API_BASE}/fs/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPath: sourcePath, newPath: targetPath })
              })
              if (res.ok) {
                handleRefreshPreserveExpansion()
              }
            } catch (error) {
              console.error('Failed to move file:', error)
            }
            setDraggedNode(null)
          }}
        >
          {/* Expand/Collapse arrow for directories - VSCode style */}
          {node.isDirectory && (
            <span 
              className={`file-arrow ${isExpanded ? 'expanded' : ''} ${isEmptyFolder ? 'empty' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (!isEmptyFolder) {
                  handleNodeClick(node, tree, currentPath, e)
                }
              }}
            >
              {!isEmptyFolder && (isExpanded ? '▼' : '▶')}
            </span>
          )}
          {!node.isDirectory && <span className="file-arrow-placeholder" />}
          
          {/* File/Folder icon with VSCode-style icons */}
          <FileIcon filename={node.name} isDirectory={node.isDirectory} isOpen={isExpanded} />
          
          {/* Git status badge */}
          <GitStatusBadge status={node.gitStatus} />
          
          {/* File name or inline edit input */}
          {isEditing ? (
            <input
              className="file-name-input"
              value={editingNode.name}
              onChange={(e) => setEditingNode({ ...editingNode, name: e.target.value })}
              onBlur={handleInlineRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  handleInlineRename()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditingNode(null)
                }
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="file-name">{node.name}</span>
          )}
          
          {/* Loading indicator */}
          {node.isLoading && <span className="file-loading">⟳</span>}
        </div>
        
        {/* Render children only when expanded - Lazy loading */}
        {node.isDirectory && isExpanded && node.children && (
          <div className="file-children">
            {node.children.map(child => renderNode(child, tree, currentPath, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="file-explorer">
      {/* Header */}
      {/* Header */}
      <div className="file-explorer-header">
        <span className="file-explorer-title">{t('explorer').toUpperCase()}</span>
        <div className="file-explorer-actions">
          <button
            className="btn-icon"
            onClick={() => setNewItemDialog({ isOpen: true, type: 'file', parentPath: rootPath })}
            disabled={!rootPath || isLoading}
            title={t('newFile')}
          >
            📝
          </button>
          <button
            className="btn-icon"
            onClick={() => setNewItemDialog({ isOpen: true, type: 'folder', parentPath: rootPath })}
            disabled={!rootPath || isLoading}
            title={t('newFolder')}
          >
            📁
          </button>
          <button
            className="btn-icon"
            onClick={handleRefreshPreserveExpansion}
            disabled={!rootPath || isLoading}
            title={t('refresh') || 'Refresh'}
          >
            🔄
          </button>
          <button
            className="btn-icon"
            onClick={handleCollapseAll}
            disabled={!rootPath || isLoading}
            title={t('collapseAll')}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>

      {/* Search bar */}
      {isSearching && (
        <div className="file-explorer-search">
          <input
            ref={searchInputRef}
            type="text"
            className="file-search-input"
            placeholder={t('searchFiles')}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsSearching(false)
                setSearchQuery('')
              }
            }}
          />
          <button 
            className="btn-icon btn-close-search"
            onClick={() => {
              setIsSearching(false)
              setSearchQuery('')
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Project name / Path */}
      <div className="file-explorer-path" title={rootPath}>
        {rootPath ? (
          <span className="project-name">{rootPath.split('/').pop() || rootPath}</span>
        ) : (
          <span className="no-folder">{t('noFolderOpened').toUpperCase()}</span>
        )}
      </div>

      {/* File tree content */}
      <div className="file-explorer-content" ref={containerRef}>
        {isLoading ? (
          <div className="file-explorer-loading">{t('loading') || 'Loading...'}</div>
        ) : flattenedTree.length > 0 ? (
          <div 
            className="virtual-tree-container"
            style={{ height: flattenedTree.length * ITEM_HEIGHT, position: 'relative' }}
          >
            <div
              className="virtual-tree-content"
              style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${visibleRange.start * ITEM_HEIGHT}px)`,
                willChange: 'transform'
              }}
            >
              {flattenedTree.slice(visibleRange.start, visibleRange.end).map((node, index) => 
                renderFlattenedNode(node, visibleRange.start + index)
              )}
            </div>
          </div>
        ) : rootPath ? (
          searchQuery ? (
            <div className="file-explorer-empty">{t('noResultsFound')}</div>
          ) : (
            <div className="file-explorer-empty">{t('emptyFolder')}</div>
          )
        ) : (
          <div className="file-explorer-placeholder">
            <button className="btn btn-primary" onClick={handleSelectFolder}>
              {t('openFolder') || 'Open Folder'}
            </button>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node && (
            <>
              {/* Open file/folder */}
              {!contextMenu.node.isDirectory && (
                <button 
                  className="context-menu-item"
                  onClick={() => {
                    handleNodeClick(contextMenu.node!, fileTree, [contextMenu.node!.name])
                    setContextMenu(null)
                  }}
                >
                  <span className="context-icon">📖</span>
                  {t('open')}
                </button>
              )}
              
              {/* New file/folder (for directories) */}
              {contextMenu.node.isDirectory && (
                <>
                  <button 
                    className="context-menu-item"
                    onClick={() => {
                      setNewItemDialog({ isOpen: true, type: 'file', parentPath: contextMenu.node!.path })
                      setContextMenu(null)
                    }}
                  >
                    <span className="context-icon">📝</span>
                    {t('newFile')}
                  </button>
                  <button 
                    className="context-menu-item"
                    onClick={() => {
                      setNewItemDialog({ isOpen: true, type: 'folder', parentPath: contextMenu.node!.path })
                      setContextMenu(null)
                    }}
                  >
                    <span className="context-icon">📁</span>
                    {t('newFolder')}
                  </button>
                </>
              )}
              
              <div className="context-menu-divider" />
              
              {/* Copy/Cut/Paste */}
              <button 
                className="context-menu-item"
                onClick={() => handleCopy(contextMenu.node!)}
              >
                <span className="context-icon">📋</span>
                {t('copy') || 'Copy'}
              </button>
              <button 
                className="context-menu-item"
                onClick={() => handleCut(contextMenu.node!)}
              >
                <span className="context-icon"><Scissors size={14} /></span>
                {t('cut') || 'Cut'}
              </button>
              {clipboard && contextMenu.node?.isDirectory && (
                <button 
                  className="context-menu-item"
                  onClick={() => handlePaste(contextMenu.node!.path)}
                >
                  <span className="context-icon">📌</span>
                  {t('paste') || 'Paste'}
                </button>
              )}
              
              <div className="context-menu-divider" />
              
              {/* Rename/Delete */}
              <button 
                className="context-menu-item"
                onClick={() => {
                  setEditingNode({ path: contextMenu.node!.path, name: contextMenu.node!.name })
                  setContextMenu(null)
                }}
              >
                <span className="context-icon"><Edit size={14} /></span>
                {t('rename')}
              </button>
              <button 
                className="context-menu-item context-menu-danger"
                onClick={() => handleDelete(contextMenu.node!)}
              >
                <span className="context-icon"><Trash2 size={14} /></span>
                {t('delete') || 'Delete'}
              </button>
              
              <div className="context-menu-divider" />
              
              {/* System actions */}
              <button 
                className="context-menu-item"
                onClick={() => handleRevealInFinder(contextMenu.node!)}
              >
                <span className="context-icon">📂</span>
                {t('revealInFinder') || 'Reveal in Finder'}
              </button>
              <button 
                className="context-menu-item"
                onClick={() => handleCopyPath(contextMenu.node!)}
              >
                <span className="context-icon">📎</span>
                {t('copyPath') || 'Copy Path'}
              </button>
            </>
          )}
        </div>
      )}

      {/* New Item Dialog */}
      {newItemDialog?.isOpen && (
        <div className="modal-overlay" onClick={() => setNewItemDialog(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {newItemDialog.type === 'file' 
                  ? t('newFile')
                  : t('newFolder')
                }
              </h3>
              <button className="modal-close" onClick={() => setNewItemDialog(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('name')}</label>
                <input
                  type="text"
                  className="form-input"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateNew()
                    if (e.key === 'Escape') setNewItemDialog(null)
                  }}
                  placeholder={newItemDialog.type === 'file' ? t('filenamePlaceholder') : t('foldernamePlaceholder')}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setNewItemDialog(null)}>
                {t('cancel') || 'Cancel'}
              </button>
              <button className="btn btn-primary" onClick={handleCreateNew}>
                {t('create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {renameDialog?.isOpen && (
        <div className="modal-overlay" onClick={() => setRenameDialog(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{t('rename')}</h3>
              <button className="modal-close" onClick={() => setRenameDialog(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('newName')}</label>
                <input
                  type="text"
                  className="form-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename()
                    if (e.key === 'Escape') setRenameDialog(null)
                  }}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenameDialog(null)}>
                {t('cancel') || 'Cancel'}
              </button>
              <button className="btn btn-primary" onClick={handleRename}>
                {t('rename')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileExplorer
