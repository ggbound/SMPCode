/**
 * GitPanel - Git 版本控制面板
 * 完全按照 VSCode Dark+ 主题设计
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  GitBranch,
  RefreshCw,
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Ellipsis,
  Cloud,
  CloudDownload,
  CloudUpload,
  FolderGit,
  File,
  RotateCcw,
  History,
  GitCommit,
  GitMerge,
  Tag,
  Layers,
  MoreHorizontal,
  Circle,
  GitGraph,
  User,
  Clock,
  FileCode,
  FileJson,
  FileType,
  FileText,
  Image as ImageIcon,
  Settings,
  Database,
  Globe,
  Layout,
  Hash,
  ChevronLeft
} from 'lucide-react'
import { useGit, GitFile } from '../hooks/useGit'
import '../styles/vscode-sidebar.css'

interface GitPanelProps {
  repoPath: string | null
  openFile?: (path: string, content: string) => void
}

interface FileItemProps {
  file: {
    path: string
    status: 'staged' | 'modified' | 'untracked' | 'conflicted' | 'clean'
    staged: boolean
  }
  selected: boolean
  onSelect: (selected: boolean) => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
}

// 文件类型图标组件
const FileTypeIcon: React.FC<{ fileName: string }> = ({ fileName }) => {
  // 防止空值错误
  if (!fileName) {
    return (
      <div className="vscode-file-type-icon">
        <FileCode size={16} style={{ color: '#6e7681' }} />
      </div>
    )
  }
  
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const name = fileName.toLowerCase()
  
  // 根据扩展名返回对应的图标
  const getIcon = () => {
    switch (ext) {
      case 'ts':
      case 'tsx':
        return <span className="vscode-file-icon-symbol" style={{ color: '#3178c6' }}>TS</span>
      case 'js':
      case 'jsx':
        return <span className="vscode-file-icon-symbol" style={{ color: '#f1e05a' }}>JS</span>
      case 'json':
        return <FileJson size={16} style={{ color: '#f1e05a' }} />
      case 'css':
      case 'scss':
      case 'less':
        return <span className="vscode-file-icon-symbol" style={{ color: '#563d7c' }}>#</span>
      case 'html':
      case 'htm':
        return <span className="vscode-file-icon-symbol" style={{ color: '#e34c26' }}>HTML</span>
      case 'md':
      case 'markdown':
        return <FileText size={16} style={{ color: '#083fa1' }} />
      case 'py':
        return <span className="vscode-file-icon-symbol" style={{ color: '#3572A5' }}>PY</span>
      case 'java':
        return <span className="vscode-file-icon-symbol" style={{ color: '#b07219' }}>JAVA</span>
      case 'go':
        return <span className="vscode-file-icon-symbol" style={{ color: '#00ADD8' }}>GO</span>
      case 'rs':
        return <span className="vscode-file-icon-symbol" style={{ color: '#dea584' }}>RS</span>
      case 'php':
        return <span className="vscode-file-icon-symbol" style={{ color: '#4F5D95' }}>PHP</span>
      case 'rb':
        return <span className="vscode-file-icon-symbol" style={{ color: '#701516' }}>RB</span>
      case 'c':
        return <span className="vscode-file-icon-symbol" style={{ color: '#555555' }}>C</span>
      case 'cpp':
      case 'cc':
      case 'cxx':
        return <span className="vscode-file-icon-symbol" style={{ color: '#f34b7d' }}>C++</span>
      case 'swift':
        return <span className="vscode-file-icon-symbol" style={{ color: '#ffac45' }}>SWIFT</span>
      case 'kt':
        return <span className="vscode-file-icon-symbol" style={{ color: '#A97BFF' }}>KT</span>
      case 'vue':
        return <span className="vscode-file-icon-symbol" style={{ color: '#41b883' }}>VUE</span>
      case 'sql':
        return <Database size={16} style={{ color: '#e38c00' }} />
      case 'sh':
      case 'bash':
        return <span className="vscode-file-icon-symbol" style={{ color: '#89e051' }}>$</span>
      case 'yml':
      case 'yaml':
        return <span className="vscode-file-icon-symbol" style={{ color: '#cb171e' }}>YML</span>
      case 'xml':
        return <span className="vscode-file-icon-symbol" style={{ color: '#0060ac' }}>XML</span>
      case 'dockerfile':
        return <span className="vscode-file-icon-symbol" style={{ color: '#2496ed' }}>DOCKER</span>
      case 'gitignore':
        return <GitBranch size={16} style={{ color: '#f14e32' }} />
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
        return <ImageIcon size={16} style={{ color: '#a855f7' }} />
      default:
        return <FileCode size={16} style={{ color: '#6e7681' }} />
    }
  }
  
  return (
    <div className="vscode-file-type-icon">
      {getIcon()}
    </div>
  )
}

// 文件状态图标 - VSCode 风格
const FileStatusIcon: React.FC<{ status: string; fileName: string }> = ({ status, fileName }) => {
  const getStatusBadge = () => {
    switch (status) {
      case 'staged':
        return <span className="vscode-file-status-badge staged">A</span>
      case 'modified':
        return <span className="vscode-file-status-badge modified">M</span>
      case 'untracked':
        return <span className="vscode-file-status-badge untracked">U</span>
      case 'conflicted':
        return <span className="vscode-file-status-badge conflicted">C</span>
      default:
        return null
    }
  }
  
  return (
    <div className="vscode-file-icon-wrapper">
      <FileTypeIcon fileName={fileName} />
      {getStatusBadge()}
    </div>
  )
}

// 文件项组件 - VSCode 风格
const FileItem: React.FC<FileItemProps & { onContextMenu?: (e: React.MouseEvent, file: GitFile) => void }> = ({ file, selected, onSelect, onStage, onUnstage, onDiscard, onContextMenu }) => {
  const fileName = file.path.split('/').pop() || file.path
  const dirPath = file.path.split('/').slice(0, -1).join('/')

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu?.(e, file)
  }

  return (
    <div
      className={`vscode-list-item ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(!selected)}
      onContextMenu={handleContextMenu}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        className="vscode-checkbox"
        onClick={(e) => e.stopPropagation()}
      />
      <FileStatusIcon status={file.status} fileName={fileName} />
      <span className="vscode-list-item-label">{fileName}</span>
      {dirPath && (
        <span className="vscode-list-item-sublabel">{dirPath}</span>
      )}
      <div className="vscode-list-item-actions">
        {file.status !== 'staged' && (
          <button
            onClick={(e) => { e.stopPropagation(); onStage() }}
            className="vscode-list-item-action-btn"
            title="暂存更改"
          >
            <Plus size={14} />
          </button>
        )}
        {file.status === 'staged' && (
          <button
            onClick={(e) => { e.stopPropagation(); onUnstage() }}
            className="vscode-list-item-action-btn"
            title="取消暂存"
          >
            <Minus size={14} />
          </button>
        )}
        {file.status !== 'staged' && file.status !== 'untracked' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard() }}
            className="vscode-list-item-action-btn"
            title="放弃更改"
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// 可折叠区域组件 - VSCode 风格
interface SectionProps {
  title: string
  count: number
  children: React.ReactNode
  expanded: boolean
  onToggle: () => void
  actions?: React.ReactNode
}

const Section: React.FC<SectionProps> = ({ title, count, children, expanded, onToggle, actions }) => {
  return (
    <div className="vscode-section">
      <div className="vscode-section-header" onClick={onToggle}>
        <div className="vscode-section-header-left">
          <ChevronRight 
            size={16} 
            className={`vscode-section-icon ${expanded ? 'expanded' : ''}`} 
          />
          <span className="vscode-section-title">{title}</span>
          <span className="vscode-section-count">({count})</span>
        </div>
        {actions && expanded && (
          <div className="vscode-section-actions">{actions}</div>
        )}
      </div>
      {expanded && <div className="vscode-section-content">{children}</div>}
    </div>
  )
}

// 右键菜单状态
interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  file?: GitFile
}

// 右键菜单组件
const ContextMenu: React.FC<{
  state: ContextMenuState
  onClose: () => void
  onOpenChanges: () => void
  onOpenFile: () => void
  onOpenFileHead: () => void
  onDiscardChanges: () => void
  onStageChanges: () => void
  onUnstageChanges: () => void
  onAddToGitignore: () => void
  onRevealInExplorer: () => void
}> = ({ state, onClose, onOpenChanges, onOpenFile, onOpenFileHead, onDiscardChanges, onStageChanges, onUnstageChanges, onAddToGitignore, onRevealInExplorer }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    if (state.visible) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [state.visible, onClose])
  
  if (!state.visible || !state.file) return null
  
  const isStaged = state.file.status === 'staged'
  const isModified = state.file.status === 'modified'
  const isUntracked = state.file.status === 'untracked'
  
  return (
    <div 
      ref={menuRef}
      className="vscode-context-menu"
      style={{ left: state.x, top: state.y }}
    >
      <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onOpenChanges(); }}>
        <FileCode size={14} />
        <span>打开更改</span>
      </div>
      <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onOpenFile(); }}>
        <File size={14} />
        <span>打开文件</span>
      </div>
      <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onOpenFileHead(); }}>
        <GitCommit size={14} />
        <span>打开文件 (HEAD)</span>
      </div>
      
      <div className="vscode-context-menu-separator" />
      
      {!isStaged && (isModified || isUntracked) && (
        <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onStageChanges(); }}>
          <Plus size={14} />
          <span>暂存更改</span>
        </div>
      )}
      {isStaged && (
        <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onUnstageChanges(); }}>
          <Minus size={14} />
          <span>取消暂存</span>
        </div>
      )}
      
      {!isStaged && isModified && (
        <div className="vscode-context-menu-item vscode-context-menu-item-danger" onClick={(e) => { e.stopPropagation(); onDiscardChanges(); }}>
          <RotateCcw size={14} />
          <span>放弃更改</span>
        </div>
      )}
      
      {isUntracked && (
        <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onAddToGitignore(); }}>
          <GitBranch size={14} />
          <span>添加到 .gitignore</span>
        </div>
      )}
      
      <div className="vscode-context-menu-separator" />
      
      <div className="vscode-context-menu-item" onClick={(e) => { e.stopPropagation(); onRevealInExplorer(); }}>
        <FolderGit size={14} />
        <span>在资源管理器视图中显示</span>
      </div>
    </div>
  )
}

// 提交历史项组件
interface CommitHistoryItemProps {
  commit: {
    hash: string
    message: string
    author: string
    date: string
  }
  isCurrent: boolean
  branches: string[]
  repoPath: string | null
  onFileClick: (filePath: string, commitHash: string) => void
}

interface CommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

const CommitHistoryItem: React.FC<CommitHistoryItemProps> = ({ commit, isCurrent, branches, repoPath, onFileClick }) => {
  const [showActions, setShowActions] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  
  const handleClick = async () => {
    setIsExpanded(!isExpanded)
    
    // Load commit details when expanding
    if (!isExpanded && repoPath && commitFiles.length === 0) {
      setIsLoading(true)
      try {
        const api = (window as any).api
        if (api?.gitCommitDetails) {
          const details = await api.gitCommitDetails(repoPath, commit.hash)
          if (details?.files) {
            const files: CommitFile[] = details.files.map((f: string) => ({
              path: f,
              status: 'modified' // Default status, could be enhanced
            }))
            setCommitFiles(files)
          }
        }
      } catch (err) {
        console.error('Failed to load commit details:', err)
      } finally {
        setIsLoading(false)
      }
    }
  }
  
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    switch (ext) {
      case 'ts':
      case 'tsx':
        return <span className="vscode-commit-file-icon" style={{ color: '#3178c6' }}>TS</span>
      case 'js':
      case 'jsx':
        return <span className="vscode-commit-file-icon" style={{ color: '#f1e05a' }}>JS</span>
      case 'json':
        return <FileJson size={14} style={{ color: '#f1e05a' }} />
      case 'css':
      case 'scss':
      case 'less':
        return <span className="vscode-commit-file-icon" style={{ color: '#563d7c' }}>#</span>
      case 'html':
      case 'htm':
        return <span className="vscode-commit-file-icon" style={{ color: '#e34c26' }}>HTML</span>
      case 'md':
      case 'markdown':
        return <FileText size={14} style={{ color: '#083fa1' }} />
      case 'py':
        return <span className="vscode-commit-file-icon" style={{ color: '#3572A5' }}>PY</span>
      default:
        return <FileCode size={14} style={{ color: '#6e7681' }} />
    }
  }
  
  return (
    <div className="vscode-commit-item-wrapper">
      <div 
        className={`vscode-commit-item ${isCurrent ? 'current' : ''} ${isExpanded ? 'expanded' : ''}`}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        onClick={handleClick}
      >
        {/* 展开/折叠箭头 */}
        <div className="vscode-commit-expand-arrow">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        
        {/* 图形化分支线 */}
        <div className="vscode-commit-graph">
          <div className="vscode-commit-dot" />
          <div className="vscode-commit-line" />
        </div>
        
        {/* 提交内容 */}
        <div className="vscode-commit-content">
          <div className="vscode-commit-message">{commit.message}</div>
          <div className="vscode-commit-meta">
            <span className="vscode-commit-author">
              <User size={12} />
              {commit.author}
            </span>
            <span className="vscode-commit-time">
              <Clock size={12} />
              {commit.date}
            </span>
          </div>
          
          {/* 分支标签 */}
          {branches.length > 0 && (
            <div className="vscode-commit-branches">
              {branches.map(branch => (
                <span key={branch} className="vscode-branch-tag">
                  <GitBranch size={10} />
                  {branch}
                </span>
              ))}
            </div>
          )}
        </div>
        
        {/* 悬停操作 */}
        {showActions && (
          <div className="vscode-commit-actions">
            <button 
              className="vscode-commit-action-btn" 
              title="查看更改"
              onClick={(e) => {
                e.stopPropagation()
                handleClick()
              }}
            >
              <FileCode size={14} />
            </button>
            <button className="vscode-commit-action-btn" title="检出此提交">
              <GitCommit size={14} />
            </button>
          </div>
        )}
      </div>
      
      {/* 展开的文件列表 */}
      {isExpanded && (
        <div className="vscode-commit-files">
          {isLoading ? (
            <div className="vscode-commit-files-loading">加载中...</div>
          ) : commitFiles.length > 0 ? (
            commitFiles.map((file, index) => (
              <div 
                key={index}
                className="vscode-commit-file-item"
                onClick={(e) => {
                  e.stopPropagation()
                  onFileClick(file.path, commit.hash)
                }}
              >
                {getFileIcon(file.path)}
                <span className="vscode-commit-file-path">{file.path}</span>
              </div>
            ))
          ) : (
            <div className="vscode-commit-files-empty">无文件更改</div>
          )}
        </div>
      )}
    </div>
  )
}

export const GitPanel: React.FC<GitPanelProps> = ({ repoPath, openFile }) => {
  const [showNewBranchDialog, setShowNewBranchDialog] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [checkoutNewBranch, setCheckoutNewBranch] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['changes', 'staged', 'history']))
  const [showCommitHistory, setShowCommitHistory] = useState(true)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })

  const {
    isRepo,
    branch,
    ahead,
    behind,
    files,
    commits,
    selectedFiles,
    commitMessage,
    isLoading,
    error,
    refresh,
    selectFile,
    setCommitMessage,
    stageFiles,
    unstageFiles,
    commit,
    discardChanges,
    createBranch,
    push,
    pull
  } = useGit({ repoPath, autoRefresh: true, refreshInterval: 5000 })

  const groupedFiles = useMemo(() => ({
    staged: files.filter(f => f.status === 'staged'),
    modified: files.filter(f => f.status === 'modified'),
    untracked: files.filter(f => f.status === 'untracked'),
    conflicted: files.filter(f => f.status === 'conflicted')
  }), [files])

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return
    await commit()
  }, [commit, commitMessage])

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return
    await createBranch(newBranchName, checkoutNewBranch)
    setNewBranchName('')
    setShowNewBranchDialog(false)
  }, [createBranch, newBranchName, checkoutNewBranch])

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent, file: GitFile) => {
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      file
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  const handleOpenChanges = useCallback(async () => {
    console.log('[GitPanel] Opening changes for:', contextMenu.file?.path, 'repoPath:', repoPath, 'openFile:', !!openFile)
    if (contextMenu.file && repoPath && openFile) {
      const fullPath = `${repoPath}/${contextMenu.file.path}`
      console.log('[GitPanel] Full path:', fullPath)
      try {
        const result = await window.api?.fsReadFile?.(fullPath)
        console.log('[GitPanel] fsReadFile result:', result)
        if (result?.success && result.content !== undefined) {
          openFile(fullPath, result.content)
        } else {
          console.error('[GitPanel] Failed to read file:', result?.error)
        }
      } catch (error) {
        console.error('[GitPanel] Failed to open file:', error)
      }
    } else {
      console.warn('[GitPanel] Cannot open changes - missing:', { file: !!contextMenu.file, repoPath: !!repoPath, openFile: !!openFile })
    }
    closeContextMenu()
  }, [contextMenu.file, repoPath, openFile, closeContextMenu])

  const handleOpenFile = useCallback(async () => {
    if (contextMenu.file && repoPath && openFile) {
      const fullPath = `${repoPath}/${contextMenu.file.path}`
      try {
        const result = await window.api?.fsReadFile?.(fullPath)
        if (result?.success && result.content !== undefined) {
          openFile(fullPath, result.content)
        }
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
    closeContextMenu()
  }, [contextMenu.file, repoPath, openFile, closeContextMenu])

  const handleOpenFileHead = useCallback(async () => {
    if (contextMenu.file && repoPath && openFile) {
      // 打开 HEAD 版本的文件
      const fullPath = `${repoPath}/${contextMenu.file.path}`
      try {
        const result = await window.api?.fsReadFile?.(fullPath)
        if (result?.success && result.content !== undefined) {
          openFile(fullPath, result.content)
        }
      } catch (error) {
        console.error('Failed to open file at HEAD:', error)
      }
    }
    closeContextMenu()
  }, [contextMenu.file, repoPath, openFile, closeContextMenu])

  const handleContextMenuStage = useCallback(() => {
    if (contextMenu.file) {
      stageFiles([contextMenu.file.path])
    }
    closeContextMenu()
  }, [contextMenu.file, stageFiles, closeContextMenu])

  const handleContextMenuUnstage = useCallback(() => {
    if (contextMenu.file) {
      unstageFiles([contextMenu.file.path])
    }
    closeContextMenu()
  }, [contextMenu.file, unstageFiles, closeContextMenu])

  const handleContextMenuDiscard = useCallback(() => {
    if (contextMenu.file) {
      if (confirm(`确定要放弃 ${contextMenu.file.path} 的更改吗？`)) {
        discardChanges([contextMenu.file.path])
      }
    }
    closeContextMenu()
  }, [contextMenu.file, discardChanges, closeContextMenu])

  const handleAddToGitignore = useCallback(async () => {
    if (contextMenu.file && repoPath) {
      try {
        const gitignorePath = `${repoPath}/.gitignore`
        const entry = contextMenu.file.path
        
        // 读取现有 .gitignore 内容
        let content = ''
        try {
          const result = await window.api?.fsReadFile?.(gitignorePath)
          if (result?.success && result.content !== undefined) {
            content = result.content
            if (!content.endsWith('\n')) content += '\n'
          }
        } catch {
          // .gitignore 不存在，创建新文件
        }
        
        // 添加新条目
        content += `${entry}\n`
        
        // 写入文件
        const writeResult = await window.api?.fsWriteFile?.(gitignorePath, content)
        if (writeResult?.success) {
          // 刷新 Git 状态
          refresh()
        }
      } catch (error) {
        console.error('Failed to add to gitignore:', error)
      }
    }
    closeContextMenu()
  }, [contextMenu.file, repoPath, refresh, closeContextMenu])

  const handleRevealInExplorer = useCallback(() => {
    if (contextMenu.file && repoPath) {
      // 在资源管理器中显示 - 通过触发文件选择事件
      const fullPath = `${repoPath}/${contextMenu.file.path}`
      // 发送自定义事件通知 FileExplorer 选中该文件
      window.dispatchEvent(new CustomEvent('git:revealInExplorer', { 
        detail: { path: fullPath } 
      }))
    }
    closeContextMenu()
  }, [contextMenu.file, repoPath, closeContextMenu])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(section)) newSet.delete(section)
      else newSet.add(section)
      return newSet
    })
  }

  // 非 Git 仓库状态
  if (!isRepo) {
    return (
      <div className="vscode-sidebar-panel git-panel">
        {/* 标题栏 */}
        <div className="vscode-panel-header">
          <div className="vscode-panel-header-left">
            <span className="vscode-panel-title">源代码管理</span>
          </div>
          <div className="vscode-panel-actions">
            <button onClick={refresh} className="vscode-panel-action-btn" title="刷新">
              <RefreshCw size={16} className={isLoading ? 'vscode-spin' : ''} />
            </button>
            <button className="vscode-panel-action-btn" title="更多操作">
              <Ellipsis size={16} />
            </button>
          </div>
        </div>
        {/* 空状态 */}
        <div className="vscode-empty-state">
          <FolderGit className="vscode-empty-icon" />
          <p className="vscode-empty-title">当前文件夹没有 Git 仓库</p>
          {repoPath && (
            <button onClick={refresh} className="vscode-btn">
              <RefreshCw size={14} />
              刷新
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="vscode-sidebar-panel git-panel">
      {/* 标题栏 */}
      <div className="vscode-panel-header">
        <div className="vscode-panel-header-left">
          <span className="vscode-panel-title">源代码管理</span>
        </div>
        <div className="vscode-panel-actions">
          <button onClick={refresh} disabled={isLoading} className="vscode-panel-action-btn" title="刷新">
            <RefreshCw size={16} className={isLoading ? 'vscode-spin' : ''} />
          </button>
          <button className="vscode-panel-action-btn" title="更多操作">
            <Ellipsis size={16} />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="vscode-panel-content">
        {error && (
          <div style={{ margin: '8px', padding: '8px', backgroundColor: '#5a1d1d', borderRadius: '4px', color: '#f48771' }}>
            {error}
          </div>
        )}

        {/* 仓库信息 */}
        <div className="vscode-repo-info">
          <button className="vscode-branch-selector">
            <GitBranch className="vscode-branch-icon" size={16} />
            <span className="vscode-branch-name">{branch}</span>
            <ChevronDown size={12} className="vscode-branch-chevron" />
          </button>
          <div className="vscode-sync-status">
            {behind > 0 && (
              <button onClick={() => pull()} className="vscode-sync-btn" title="拉取更改">
                <CloudDownload size={14} />
                <span>{behind}</span>
              </button>
            )}
            {ahead > 0 && (
              <button onClick={() => push()} className="vscode-sync-btn" title="推送更改">
                <CloudUpload size={14} />
                <span>{ahead}</span>
              </button>
            )}
            {(ahead === 0 && behind === 0) && <Cloud size={16} style={{ color: '#858585' }} />}
          </div>
        </div>

        {/* 提交消息输入框 */}
        <div className="vscode-commit-box">
          <div className="vscode-commit-input-wrapper">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={`消息 (⌘Enter 在"${branch}"提交)`}
              className="vscode-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey && commitMessage.trim() && groupedFiles.staged.length > 0) {
                  handleCommit()
                }
              }}
            />
            <div className="vscode-commit-toolbar">
              <button className="vscode-commit-toolbar-btn" title="操作">
                <Ellipsis size={14} />
              </button>
            </div>
          </div>
          {groupedFiles.staged.length > 0 && (
            <div className="vscode-commit-actions">
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim()}
                className="vscode-btn vscode-btn-primary"
              >
                <Check size={14} />
                提交
              </button>
            </div>
          )}
        </div>

        {/* 更改列表 */}
        <div className="vscode-changes-list">
          {/* 暂存的更改 */}
          {groupedFiles.staged.length > 0 && (
            <Section
              title="暂存的更改"
              count={groupedFiles.staged.length}
              expanded={expandedSections.has('staged')}
              onToggle={() => toggleSection('staged')}
              actions={
                <button
                  onClick={(e) => { e.stopPropagation(); unstageFiles(groupedFiles.staged.map(f => f.path)) }}
                  className="vscode-section-action-btn"
                  title="全部取消暂存"
                >
                  <Minus size={14} />
                </button>
              }
            >
              {groupedFiles.staged.map(file => (
                <FileItem
                  key={file.path}
                  file={file}
                  selected={selectedFiles.has(file.path)}
                  onSelect={(selected) => selectFile(file.path, selected)}
                  onStage={() => {}}
                  onUnstage={() => unstageFiles([file.path])}
                  onDiscard={() => {}}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </Section>
          )}

          {/* 更改 */}
          {groupedFiles.modified.length > 0 && (
            <Section
              title="更改"
              count={groupedFiles.modified.length}
              expanded={expandedSections.has('changes')}
              onToggle={() => toggleSection('changes')}
              actions={
                <button
                  onClick={(e) => { e.stopPropagation(); stageFiles(groupedFiles.modified.map(f => f.path)) }}
                  className="vscode-section-action-btn"
                  title="全部暂存"
                >
                  <Plus size={14} />
                </button>
              }
            >
              {groupedFiles.modified.map(file => (
                <FileItem
                  key={file.path}
                  file={file}
                  selected={selectedFiles.has(file.path)}
                  onSelect={(selected) => selectFile(file.path, selected)}
                  onStage={() => stageFiles([file.path])}
                  onUnstage={() => {}}
                  onDiscard={() => {
                    if (confirm(`确定要放弃 ${file.path} 的更改吗？`)) {
                      discardChanges([file.path])
                    }
                  }}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </Section>
          )}

          {/* 未跟踪的文件 */}
          {groupedFiles.untracked.length > 0 && (
            <Section
              title="未跟踪的文件"
              count={groupedFiles.untracked.length}
              expanded={expandedSections.has('untracked')}
              onToggle={() => toggleSection('untracked')}
              actions={
                <button
                  onClick={(e) => { e.stopPropagation(); stageFiles(groupedFiles.untracked.map(f => f.path)) }}
                  className="vscode-section-action-btn"
                  title="全部暂存"
                >
                  <Plus size={14} />
                </button>
              }
            >
              {groupedFiles.untracked.map(file => (
                <FileItem
                  key={file.path}
                  file={file}
                  selected={selectedFiles.has(file.path)}
                  onSelect={(selected) => selectFile(file.path, selected)}
                  onStage={() => stageFiles([file.path])}
                  onUnstage={() => {}}
                  onDiscard={() => {}}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </Section>
          )}

          {/* 冲突的文件 */}
          {groupedFiles.conflicted.length > 0 && (
            <Section
              title="冲突的文件"
              count={groupedFiles.conflicted.length}
              expanded={expandedSections.has('conflicted')}
              onToggle={() => toggleSection('conflicted')}
            >
              {groupedFiles.conflicted.map(file => (
                <FileItem
                  key={file.path}
                  file={file}
                  selected={selectedFiles.has(file.path)}
                  onSelect={(selected) => selectFile(file.path, selected)}
                  onStage={() => stageFiles([file.path])}
                  onUnstage={() => unstageFiles([file.path])}
                  onDiscard={() => {}}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </Section>
          )}

          {/* 空状态 */}
          {files.length === 0 && (
            <div className="vscode-clean-state">
              <Check size={32} className="vscode-clean-icon" />
              <p className="vscode-clean-text">所有更改已暂存</p>
              <p className="vscode-clean-subtitle">工作区干净</p>
            </div>
          )}
        </div>

        {/* 提交历史区域 - 独立区域，在更改列表外部 */}
        {showCommitHistory && commits.length > 0 && (
          <div className="vscode-commit-history-section">
            <Section
              title="提交历史"
              count={commits.length}
              expanded={expandedSections.has('history')}
              onToggle={() => toggleSection('history')}
            >
              <div className="vscode-commit-history-list">
                {commits.map((commit, index) => (
                  <CommitHistoryItem
                    key={commit.hash}
                    commit={commit}
                    isCurrent={index === 0}
                    branches={index === 0 ? [branch] : []}
                    repoPath={repoPath}
                    onFileClick={(filePath, commitHash) => {
                      // Open diff view for the file at this commit
                      if (openFile && repoPath) {
                        const fullPath = `${repoPath}/${filePath}`
                        // Dispatch event to open diff view
                        window.dispatchEvent(new CustomEvent('git:openDiff', {
                          detail: { filePath: fullPath, commitHash, repoPath }
                        }))
                      }
                    }}
                  />
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        state={contextMenu}
        onClose={closeContextMenu}
        onOpenChanges={handleOpenChanges}
        onOpenFile={handleOpenFile}
        onOpenFileHead={handleOpenFileHead}
        onDiscardChanges={handleContextMenuDiscard}
        onStageChanges={handleContextMenuStage}
        onUnstageChanges={handleContextMenuUnstage}
        onAddToGitignore={handleAddToGitignore}
        onRevealInExplorer={handleRevealInExplorer}
      />

      {/* 新建分支对话框 */}
      {showNewBranchDialog && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            backgroundColor: '#252526', border: '1px solid #3c3c3c', borderRadius: '6px',
            padding: '16px', width: '320px'
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#cccccc', margin: '0 0 16px' }}>新建分支</h3>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="分支名称"
              className="vscode-input"
              style={{ marginBottom: '12px' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <input type="checkbox" checked={checkoutNewBranch} onChange={(e) => setCheckoutNewBranch(e.target.checked)} />
              <span style={{ fontSize: '13px', color: '#cccccc' }}>切换到新分支</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowNewBranchDialog(false)} className="vscode-btn vscode-btn-secondary">取消</button>
              <button onClick={handleCreateBranch} disabled={!newBranchName.trim()} className="vscode-btn">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GitPanel
