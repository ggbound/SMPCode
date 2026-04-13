import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { t } from '../i18n'

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isOpen?: boolean
  isLoading?: boolean
}

interface FileExplorerProps {
  onFileSelect: (path: string, content: string) => void
  selectedPath: string | null
  onRootPathChange?: (path: string) => void
  openFile?: (path: string, content: string) => void
  onFileRenamed?: (oldPath: string, newPath: string, newName: string) => void
  onFileDeleted?: (path: string) => void
}

// File icon mapping based on extension
const getFileIcon = (filename: string, isDirectory: boolean, isOpen?: boolean): string => {
  if (isDirectory) {
    return isOpen ? '📂' : '📁'
  }
  
  const ext = filename.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    'js': '📜',
    'ts': '📘',
    'tsx': '⚛️',
    'jsx': '⚛️',
    'py': '🐍',
    'json': '📋',
    'md': '📝',
    'css': '🎨',
    'scss': '🎨',
    'sass': '🎨',
    'less': '🎨',
    'html': '🌐',
    'htm': '🌐',
    'txt': '📄',
    'xml': '📄',
    'yaml': '⚙️',
    'yml': '⚙️',
    'toml': '⚙️',
    'ini': '⚙️',
    'conf': '⚙️',
    'config': '⚙️',
    'sh': '🔧',
    'bash': '🔧',
    'zsh': '🔧',
    'fish': '🔧',
    'rs': '🦀',
    'go': '🔵',
    'java': '☕',
    'kt': '🔷',
    'c': '🔷',
    'cpp': '🔷',
    'cc': '🔷',
    'cxx': '🔷',
    'h': '🔷',
    'hpp': '🔷',
    'hh': '🔷',
    'rb': '💎',
    'php': '🐘',
    'swift': '🦉',
    'sql': '🗃️',
    'dockerfile': '🐳',
    'vue': '💚',
    'svelte': '🧡',
    'astro': '🚀',
    'wasm': '⚡',
    'lock': '🔒',
    'gitignore': '🚫',
    'gitattributes': '⚙️',
    'env': '🔐',
    'LICENSE': '📜',
    'README': '📖',
    'CHANGELOG': '📋',
    'CONTRIBUTING': '🤝',
    'CODE_OF_CONDUCT': '📜',
    'SECURITY': '🔒',
  }
  
  // Check for special filenames first
  const baseName = filename.split('/').pop()?.toUpperCase() || ''
  for (const [key, icon] of Object.entries(iconMap)) {
    if (baseName.includes(key.toUpperCase())) {
      return icon
    }
  }
  
  return iconMap[ext || ''] || '📄'
}

function FileExplorer({ onFileSelect, selectedPath, onRootPathChange, openFile, onFileRenamed, onFileDeleted }: FileExplorerProps) {
  const [rootPath, setRootPath] = useState<string>('')
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null)
  const [newItemDialog, setNewItemDialog] = useState<{ isOpen: boolean; type: 'file' | 'folder'; parentPath: string } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [renameDialog, setRenameDialog] = useState<{ isOpen: boolean; node: FileNode | null } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileTreeRef = useRef<FileNode[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

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
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSearching])

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

  // Toggle directory open/close
  const toggleDirectory = useCallback(async (node: FileNode, tree: FileNode[], path: string[]) => {
    const newTree = [...tree]
    let current = newTree

    for (let i = 0; i < path.length; i++) {
      const index = current.findIndex(n => n.name === path[i])
      if (index === -1) return newTree

      if (i === path.length - 1) {
        const isOpening = !current[index].isOpen
        current[index] = { ...current[index], isOpen: isOpening }

        if (isOpening && !current[index].children) {
          current[index] = { ...current[index], isLoading: true }
          setFileTree(newTree)
          
          const children = await loadDirectory(current[index].path)
          const updateTree = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(n => {
              if (n.path === node.path) {
                return { ...n, children, isLoading: false }
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
  }, [loadDirectory])

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

  // Filter file tree based on search query
  const filteredFileTree = useMemo(() => {
    if (!searchQuery.trim()) return fileTree
    
    const filterNodes = (nodes: FileNode[]): FileNode[] => {
      const result: FileNode[] = []
      for (const node of nodes) {
        const matchesSearch = node.name.toLowerCase().includes(searchQuery.toLowerCase())
        
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

  // Render file tree node
  const renderNode = (node: FileNode, tree: FileNode[], path: string[], depth: number = 0): React.ReactElement => {
    const isSelected = node.path === selectedPath
    const currentPath = [...path, node.name]
    const hasChildren = node.isDirectory && (node.children?.length ?? 0) > 0
    const isEmptyFolder = node.isDirectory && !hasChildren && !node.isLoading

    return (
      <div key={node.path} className="file-tree-node">
        <div
          className={`file-node ${isSelected ? 'selected' : ''} ${node.isDirectory ? 'directory' : 'file'}`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={(e) => handleNodeClick(node, tree, currentPath, e)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          title={node.path}
        >
          {/* Expand/Collapse arrow for directories */}
          {node.isDirectory && (
            <span 
              className={`file-arrow ${node.isOpen ? 'expanded' : ''} ${isEmptyFolder ? 'empty' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (!isEmptyFolder) {
                  handleNodeClick(node, tree, currentPath, e)
                }
              }}
            >
              {!isEmptyFolder && '▶'}
            </span>
          )}
          {!node.isDirectory && <span className="file-arrow-placeholder" />}
          
          {/* File/Folder icon */}
          <span className="file-icon">
            {getFileIcon(node.name, node.isDirectory, node.isOpen)}
          </span>
          
          {/* File name */}
          <span className="file-name">{node.name}</span>
          
          {/* Loading indicator */}
          {node.isLoading && <span className="file-loading">⟳</span>}
        </div>
        
        {/* Render children */}
        {node.isDirectory && node.isOpen && node.children && (
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
            ⬆️
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
            onChange={(e) => setSearchQuery(e.target.value)}
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
      <div className="file-explorer-content">
        {isLoading ? (
          <div className="file-explorer-loading">{t('loading') || 'Loading...'}</div>
        ) : filteredFileTree.length > 0 ? (
          filteredFileTree.map(node => renderNode(node, filteredFileTree, [], 0))
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
              <button 
                className="context-menu-item"
                onClick={() => {
                  setRenameDialog({ isOpen: true, node: contextMenu.node })
                  setRenameValue(contextMenu.node!.name)
                  setContextMenu(null)
                }}
              >
                <span className="context-icon">✏️</span>
                {t('rename')}
              </button>
              <button 
                className="context-menu-item context-menu-danger"
                onClick={() => handleDelete(contextMenu.node!)}
              >
                <span className="context-icon">🗑️</span>
                {t('delete') || 'Delete'}
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
