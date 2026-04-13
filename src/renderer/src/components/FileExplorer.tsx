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

// VSCode-style file icon component
const FileIcon = ({ filename, isDirectory, isOpen }: { filename: string; isDirectory: boolean; isOpen?: boolean }) => {
  if (isDirectory) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {isOpen ? (
          <path d="M4 20C4 20 4 6 4 6C4 5.45 4.45 5 5 5H11L13 7H19C19.55 7 20 7.45 20 8V20C20 20.55 19.55 21 19 21H5C4.45 21 4 20.55 4 20Z" fill="#DCAD5A"/>
        ) : (
          <path d="M20 8H14L12 6H4C3.45 6 3 6.45 3 7V19C3 19.55 3.45 20 4 20H20C20.55 20 21 19.55 21 19V9C21 8.45 20.55 8 20 8Z" fill="#DCAD5A"/>
        )}
      </svg>
    )
  }
  
  const ext = filename.split('.').pop()?.toLowerCase()
  const name = filename.toLowerCase()
  
  // Special file names
  if (name === 'package.json' || name === 'package-lock.json') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#CB3837"/>
        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">npm</text>
      </svg>
    )
  }
  if (name === '.gitignore' || name === '.gitattributes') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="#F05032"/>
        <path d="M12 7V17M7 12H17" stroke="white" strokeWidth="2"/>
      </svg>
    )
  }
  if (name.startsWith('dockerfile') || name.endsWith('.dockerfile')) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#2496ED"/>
        <path d="M7 10H17M7 13H17M7 16H14" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }
  if (name === 'readme.md' || name === 'readme') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="2" width="16" height="20" rx="2" fill="#42A5F5"/>
        <path d="M7 6H17M7 10H17M7 14H13" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }
  if (name === 'license' || name === 'license.md') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="2" width="16" height="20" rx="2" fill="#FF9800"/>
        <circle cx="12" cy="10" r="3" fill="white"/>
        <path d="M8 16C8 16 9 18 12 18C15 18 16 16 16 16" stroke="white" strokeWidth="1.5"/>
      </svg>
    )
  }
  if (name === '.env' || name.includes('.env.')) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="6" width="18" height="12" rx="2" fill="#FFCA28"/>
        <text x="12" y="15" textAnchor="middle" fill="#333" fontSize="8" fontWeight="bold">ENV</text>
      </svg>
    )
  }
  if (name === 'tsconfig.json') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#3178C6"/>
        <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">TS</text>
      </svg>
    )
  }
  if (name === 'vite.config.ts' || name === 'vite.config.js') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="#646CFF"/>
        <path d="M12 6L17 10L12 14L7 10Z" fill="#FFD62E"/>
      </svg>
    )
  }
  if (name === 'tailwind.config.js' || name === 'tailwind.config.ts') {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#38BDF8"/>
        <path d="M8 12C8 10 9 8 12 8C15 8 16 10 16 12C16 14 14 15 12 15C10 15 8 14 8 12Z" fill="white"/>
      </svg>
    )
  }
  if (name === 'webpack.config.js' || name.startsWith('webpack')) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#8DD6F9"/>
        <rect x="6" y="8" width="12" height="8" fill="#1C78C0"/>
      </svg>
    )
  }
  if (name === 'eslint' || name.includes('.eslint')) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="#4B32C3"/>
        <path d="M8 12H16M12 8V16" stroke="white" strokeWidth="2"/>
      </svg>
    )
  }
  if (name === 'prettier' || name.includes('.prettier')) {
    return (
      <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="#F7B93E"/>
        <circle cx="9" cy="12" r="2" fill="#333"/>
        <circle cx="15" cy="12" r="2" fill="#333"/>
      </svg>
    )
  }
  
  // Extension-based icons
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#F7DF1E"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="10" fontWeight="bold">JS</text>
        </svg>
      )
    case 'ts':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#3178C6"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">TS</text>
        </svg>
      )
    case 'tsx':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#3178C6"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">TSX</text>
        </svg>
      )
    case 'jsx':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#61DAFB"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="9" fontWeight="bold">JSX</text>
        </svg>
      )
    case 'py':
    case 'pyc':
    case 'pyo':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" fill="#3776AB"/>
          <path d="M9 9H15M9 15H15" stroke="#FFD43B" strokeWidth="2"/>
        </svg>
      )
    case 'json':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#6B8E23"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">JSON</text>
        </svg>
      )
    case 'md':
    case 'markdown':
    case 'mdx':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="2" width="16" height="20" rx="2" fill="#42A5F5"/>
          <text x="12" y="14" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">MD</text>
        </svg>
      )
    case 'css':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#264DE4"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">CSS</text>
        </svg>
      )
    case 'scss':
    case 'sass':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#CC6699"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">SCSS</text>
        </svg>
      )
    case 'less':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#1D365D"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">LESS</text>
        </svg>
      )
    case 'html':
    case 'htm':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#E34F26"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">HTML</text>
        </svg>
      )
    case 'xml':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#FF6600"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">XML</text>
        </svg>
      )
    case 'yaml':
    case 'yml':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#CB171E"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">YAML</text>
        </svg>
      )
    case 'toml':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#9C4221"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">TOML</text>
        </svg>
      )
    case 'ini':
    case 'conf':
    case 'config':
    case 'cfg':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#6D6D6D"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">CONF</text>
        </svg>
      )
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#89E051"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="9" fontWeight="bold">SH</text>
        </svg>
      )
    case 'rs':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#DEA584"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="9" fontWeight="bold">RS</text>
        </svg>
      )
    case 'go':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#00ADD8"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">GO</text>
        </svg>
      )
    case 'java':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#B07219"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">JAVA</text>
        </svg>
      )
    case 'kt':
    case 'kts':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#A97BFF"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">KT</text>
        </svg>
      )
    case 'c':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#555555"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">C</text>
        </svg>
      )
    case 'cpp':
    case 'cc':
    case 'cxx':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#F34B7D"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">C++</text>
        </svg>
      )
    case 'h':
    case 'hpp':
    case 'hh':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#438EFF"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">H</text>
        </svg>
      )
    case 'rb':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#701516"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">RB</text>
        </svg>
      )
    case 'php':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#4F5D95"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">PHP</text>
        </svg>
      )
    case 'swift':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#F05138"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">SWIFT</text>
        </svg>
      )
    case 'sql':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#E38C00"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">SQL</text>
        </svg>
      )
    case 'vue':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#41B883"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">VUE</text>
        </svg>
      )
    case 'svelte':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#FF3E00"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">SVELTE</text>
        </svg>
      )
    case 'astro':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#FF5D01"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">ASTRO</text>
        </svg>
      )
    case 'wasm':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#654FF0"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">WASM</text>
        </svg>
      )
    case 'lock':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#FFD54F"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="8" fontWeight="bold">LOCK</text>
        </svg>
      )
    case 'txt':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="2" width="16" height="20" rx="2" fill="#757575"/>
          <text x="12" y="14" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">TXT</text>
        </svg>
      )
    case 'svg':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#FFB13B"/>
          <text x="12" y="16" textAnchor="middle" fill="#333" fontSize="8" fontWeight="bold">SVG</text>
        </svg>
      )
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="#26A69A"/>
          <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">IMG</text>
        </svg>
      )
    default:
      return (
        <svg className="file-icon-svg" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="2" width="16" height="20" rx="2" fill="#9E9E9E"/>
          <text x="12" y="14" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">FILE</text>
        </svg>
      )
  }
}

// Legacy function for backward compatibility
const getFileIcon = (filename: string, isDirectory: boolean, isOpen?: boolean): string => {
  if (isDirectory) {
    return isOpen ? '📂' : '📁'
  }
  return '📄'
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
          <FileIcon filename={node.name} isDirectory={node.isDirectory} isOpen={node.isOpen} />
          
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
