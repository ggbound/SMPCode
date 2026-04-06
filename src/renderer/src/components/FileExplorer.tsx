import { useState, useCallback, useEffect, useRef } from 'react'
import { t } from '../i18n'

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isOpen?: boolean
}

interface FileExplorerProps {
  onFileSelect: (path: string, content: string) => void
  selectedPath: string | null
  onRootPathChange?: (path: string) => void
}

function FileExplorer({ onFileSelect, selectedPath, onRootPathChange }: FileExplorerProps) {
  const [rootPath, setRootPath] = useState<string>('')
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const fileTreeRef = useRef<FileNode[]>([])

  const API_BASE = 'http://localhost:3847/api'

  // Keep ref in sync with state
  useEffect(() => {
    fileTreeRef.current = fileTree
  }, [fileTree])

  // Auto refresh file tree when files are modified
  useEffect(() => {
    if (rootPath) {
      // Initial load - do NOT expand any folders by default
      handleRefreshNoExpansion()

      // Set up auto refresh interval
      const interval = setInterval(() => {
        handleRefreshPreserveExpansion()
      }, 2000) // Refresh every 2 seconds

      return () => {
        clearInterval(interval)
      }
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

  // Toggle directory open/close
  const toggleDirectory = useCallback(async (node: FileNode, tree: FileNode[], path: string[]) => {
    const newTree = [...tree]
    let current = newTree

    for (let i = 0; i < path.length; i++) {
      const index = current.findIndex(n => n.name === path[i])
      if (index === -1) return newTree

      if (i === path.length - 1) {
        // Toggle current node
        current[index] = { ...current[index], isOpen: !current[index].isOpen }

        // Load children if opening and no children loaded
        if (current[index].isOpen && !current[index].children) {
          const children = await loadDirectory(current[index].path)
          current[index] = { ...current[index], children }
        }
      } else {
        current = current[index].children!
      }
    }

    return newTree
  }, [loadDirectory])

  // Handle node click
  const handleNodeClick = useCallback(async (node: FileNode, tree: FileNode[], path: string[]) => {
    if (node.isDirectory) {
      const newTree = await toggleDirectory(node, tree, path)
      setFileTree(newTree)
    } else {
      // Load file content
      try {
        const res = await fetch(`${API_BASE}/fs/read?path=${encodeURIComponent(node.path)}`)
        if (res.ok) {
          const data = await res.json()
          onFileSelect(node.path, data.content || '')
        }
      } catch (error) {
        console.error('Failed to read file:', error)
      }
    }
  }, [onFileSelect, toggleDirectory])

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
      } else {
        console.error('Failed to set working directory: HTTP', res.status)
        return false
      }
    } catch (error) {
      console.error('Failed to set working directory:', error)
      return false
    }
  }, [])

  // Select folder
  const handleSelectFolder = useCallback(async () => {
    try {
      setIsLoading(true)
      // Use Electron's dialog via IPC
      if (window.api?.selectFolder) {
        const folderPath = await window.api.selectFolder()
        if (folderPath) {
          // Set as working directory for commands FIRST
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
        // Fallback: use prompt
        const folderPath = prompt(t('enterFolderPath') || 'Enter folder path:')
        if (folderPath) {
          // Set as working directory for commands FIRST
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
  }, [loadDirectory, setWorkingDirectory])

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
      // All folders closed by default
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
      // Build a map of current expansion states from the existing tree (use ref to get latest)
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

      // Load new directory structure
      const items = await loadDirectory(rootPath)

      // Apply expansion states to new tree
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

      // Recursively load children for expanded directories
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

  // Render file tree node
  const renderNode = (node: FileNode, tree: FileNode[], path: string[], depth: number = 0): React.ReactElement => {
    const isSelected = node.path === selectedPath
    const currentPath = [...path, node.name]

    return (
      <div key={node.path}>
        <div
          className={`file-node ${isSelected ? 'selected' : ''} ${node.isDirectory ? 'directory' : 'file'}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleNodeClick(node, tree, currentPath)}
        >
          <span className="file-icon">
            {node.isDirectory ? (node.isOpen ? '📂' : '📁') : getFileIcon(node.name)}
          </span>
          <span className="file-name">{node.name}</span>
        </div>
        {node.isDirectory && node.isOpen && node.children && (
          <div className="file-children">
            {node.children.map(child => renderNode(child, tree, currentPath, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Get file icon based on extension
  const getFileIcon = (filename: string): string => {
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
      'html': '🌐',
      'txt': '📄',
    }
    return iconMap[ext || ''] || '📄'
  }

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <span className="file-explorer-title">{t('project') || 'Project'}</span>
        <div className="file-explorer-actions">
          <button
            className="btn-icon"
            onClick={handleSelectFolder}
            disabled={isLoading}
            title={t('openFolder') || 'Open Folder'}
          >
            📂
          </button>
          {rootPath && (
            <button
              className="btn-icon"
              onClick={handleRefresh}
              disabled={isLoading}
              title={t('refresh') || 'Refresh'}
            >
              🔄
            </button>
          )}
        </div>
      </div>

      <div className="file-explorer-path" title={rootPath}>
        {rootPath ? rootPath.split('/').pop() || rootPath : t('noFolderSelected') || 'No folder selected'}
      </div>

      <div className="file-explorer-content">
        {isLoading ? (
          <div className="file-explorer-loading">{t('loading') || 'Loading...'}</div>
        ) : fileTree.length > 0 ? (
          fileTree.map(node => renderNode(node, fileTree, [], 0))
        ) : rootPath ? (
          <div className="file-explorer-empty">{t('emptyFolder') || 'Empty folder'}</div>
        ) : (
          <div className="file-explorer-placeholder">
            <button className="btn btn-primary" onClick={handleSelectFolder}>
              {t('openFolder') || 'Open Folder'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default FileExplorer
