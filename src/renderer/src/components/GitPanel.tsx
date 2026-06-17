/**
 * GitPanel - VSCode 风格的 Git 面板
 * 提供完整的 Git 操作功能，包括分支管理、文件操作、右键菜单等
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
  User,
  Clock,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Settings,
  Database,
  Globe,
  Layout,
  Hash,
  ChevronLeft,
  LayoutGrid,
  List,
  MoreVertical,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react'
import { useGit, GitFile } from '../hooks/useGit'
import '../styles/vscode-sidebar.css'
import '../styles/git-panel.css'

// ==================== 类型定义 ====================

type ViewMode = 'changes' | 'history'
type FileStatus = 'staged' | 'modified' | 'untracked' | 'conflicted' | 'clean'

interface GitPanelProps {
  repoPath: string | null
  openFile?: (path: string, content: string) => void
}

interface FileItemData {
  path: string
  status: FileStatus
  staged: boolean
}

interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

interface ContextMenuSection {
  items: ContextMenuItem[]
}

// ==================== 工具函数 ====================

// 获取文件扩展名
const getFileExt = (fileName: string): string => {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

// 获取文件图标
const getFileIcon = (fileName: string) => {
  const ext = getFileExt(fileName)
  const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
    ts: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>TS</span>, color: '#3178c6' },
    tsx: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>TSX</span>, color: '#3178c6' },
    js: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>JS</span>, color: '#f1e05a' },
    jsx: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>JSX</span>, color: '#f1e05a' },
    json: { icon: <FileJson size={14} />, color: '#f1e05a' },
    css: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>#</span>, color: '#563d7c' },
    scss: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>SCSS</span>, color: '#563d7c' },
    html: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>HTML</span>, color: '#e34c26' },
    md: { icon: <FileText size={14} />, color: '#083fa1' },
    vue: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>VUE</span>, color: '#41b883' },
    py: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>PY</span>, color: '#3572A5' },
    java: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>JAVA</span>, color: '#b07219' },
    go: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>GO</span>, color: '#00ADD8' },
    rs: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>RS</span>, color: '#dea584' },
    php: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>PHP</span>, color: '#4F5D95' },
    rb: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>RB</span>, color: '#701516' },
    sql: { icon: <Database size={14} />, color: '#e38c00' },
    yml: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>YML</span>, color: '#cb171e' },
    yaml: { icon: <span style={{ fontSize: 10, fontWeight: 600 }}>YML</span>, color: '#cb171e' },
  }
  return iconMap[ext] || { icon: <FileCode size={14} />, color: '#6e7681' }
}

// 获取状态图标
const getStatusIcon = (status: FileStatus) => {
  switch (status) {
    case 'staged':
      return <Check size={12} style={{ color: '#238636' }} />
    case 'modified':
      return <span style={{ color: '#1f6feb', fontSize: 12, fontWeight: 600 }}>M</span>
    case 'untracked':
      return <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 600 }}>U</span>
    case 'conflicted':
      return <span style={{ color: '#da3633', fontSize: 12, fontWeight: 600 }}>C</span>
    default:
      return null
  }
}

// ==================== 子组件 ====================

// 右键菜单组件
const ContextMenu: React.FC<{
  visible: boolean
  x: number
  y: number
  sections: ContextMenuSection[]
  onClose: () => void
}> = ({ visible, x, y, sections, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, onClose])

  if (!visible) return null

  console.log('[ContextMenu] Rendering menu with sections:', sections.length)

  // 确保菜单不超出视口
  const adjustedX = Math.min(x, window.innerWidth - 250)
  const adjustedY = Math.min(y, window.innerHeight - 300)

  return (
    <div
      ref={menuRef}
      className="git-context-menu"
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 1000,
        minWidth: '200px',
        background: '#252526',
        border: '1px solid #3c3c3c',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        padding: '4px 0',
      }}
    >
      {sections.map((section, sectionIndex) => (
        <React.Fragment key={sectionIndex}>
          {sectionIndex > 0 && (
            <div style={{ borderTop: '1px solid #3c3c3c', margin: '4px 0' }} />
          )}
          {section.items.map((item, itemIndex) => (
            <button
              key={itemIndex}
              className="git-context-menu-item"
              onClick={() => {
                item.onClick()
                onClose()
              }}
              disabled={item.disabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                color: item.danger ? '#f85149' : '#cccccc',
                fontSize: '13px',
                textAlign: 'left',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  e.currentTarget.style.backgroundColor = '#094771'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <span style={{ width: 20, marginRight: 8, display: 'flex', alignItems: 'center' }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.shortcut && (
                <span style={{ color: '#6e7681', fontSize: 11, marginLeft: 16 }}>
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

// 文件项组件
interface FileItemProps {
  file: FileItemData
  selected: boolean
  onSelect: (selected: boolean) => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  onOpenFile: () => void
  onOpenDiff: () => void
  onAddToGitignore?: () => void
}

const FileItem: React.FC<FileItemProps> = ({
  file,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
  onOpenDiff,
  onAddToGitignore,
}) => {
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  })

  const fileName = file.path.split('/').pop() || file.path
  const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''
  const fileIcon = getFileIcon(fileName)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[FileItem] Context menu triggered for:', file.path)
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }

  const menuSections: ContextMenuSection[] = [
    {
      items: [
        { label: '打开更改', icon: <FileCode size={14} />, onClick: onOpenDiff },
        { label: '打开文件 (HEAD)', icon: <ExternalLink size={14} />, onClick: onOpenFile },
      ],
    },
    {
      items: [
        ...(file.status !== 'staged'
          ? [{ label: '暂存更改', icon: <Plus size={14} />, onClick: onStage }]
          : [{ label: '取消暂存', icon: <Minus size={14} />, onClick: onUnstage }]),
      ],
    },
    {
      items: [
        ...(file.status !== 'staged' && file.status !== 'untracked'
          ? [{ label: '放弃更改', icon: <RotateCcw size={14} />, onClick: onDiscard, danger: true }]
          : []),
        ...(onAddToGitignore
          ? [{ label: '添加到 .gitignore', icon: <GitBranch size={14} />, onClick: onAddToGitignore }]
          : []),
      ],
    },
  ].filter(section => section.items.length > 0)

  return (
    <>
      <div
        className={`git-file-item ${selected ? 'selected' : ''}`}
        onClick={() => onSelect(!selected)}
        onContextMenu={handleContextMenu}
      >
        {/* 复选框 */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="git-file-checkbox"
          onClick={(e) => e.stopPropagation()}
        />
        
        {/* 状态图标 */}
        <span className="git-file-status">
          {getStatusIcon(file.status)}
        </span>
        
        {/* 文件图标 */}
        <span className="git-file-icon" style={{ color: fileIcon.color }}>
          {fileIcon.icon}
        </span>
        
        {/* 文件名和路径 */}
        <div className="git-file-label">
          <span className="git-file-name">{fileName}</span>
          {dirPath && (
            <span className="git-file-path">{dirPath}</span>
          )}
        </div>
        
        {/* 操作按钮 - 悬停时显示 */}
        <div className="git-file-actions">
          {/* 打开文件按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenFile() }}
            onContextMenu={(e) => { e.stopPropagation() }}
            className="git-file-action-btn"
            title="打开文件"
          >
            <FileCode size={14} />
          </button>
          
          {/* 暂存/取消暂存按钮 */}
          {file.status !== 'staged' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStage() }}
              onContextMenu={(e) => { e.stopPropagation() }}
              className="git-file-action-btn"
              title="暂存更改"
            >
              <Plus size={14} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onUnstage() }}
              onContextMenu={(e) => { e.stopPropagation() }}
              className="git-file-action-btn"
              title="取消暂存"
            >
              <Minus size={14} />
            </button>
          )}
          
          {/* 放弃更改按钮 - 只在修改的文件显示（非暂存、非未跟踪） */}
          {file.status === 'modified' && (
            <button
              onClick={(e) => { e.stopPropagation(); onDiscard() }}
              onContextMenu={(e) => { e.stopPropagation() }}
              className="git-file-action-btn"
              title="放弃更改"
              style={{ color: '#f85149' }}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        sections={menuSections}
        onClose={() => setContextMenu({ visible: false, x: 0, y: 0 })}
      />
    </>
  )
}

// 可折叠区域组件
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
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ marginRight: 6, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <ChevronRight size={14} style={{ color: '#8b949e' }} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#cccccc', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </span>
        <span style={{ marginLeft: 6, fontSize: 11, color: '#6e7681' }}>
          ({count})
        </span>
        {expanded && actions && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {actions}
          </div>
        )}
      </div>
      {expanded && (
        <div style={{ paddingLeft: 12 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// 分支下拉菜单组件
const BranchDropdown: React.FC<{
  branches: { name: string; current: boolean }[]
  currentBranch: string
  onCheckout: (branchName: string) => void
  onCreateBranch: () => void
  visible: boolean
  onClose: () => void
}> = ({ branches, currentBranch, onCheckout, onCreateBranch, visible, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, onClose])

  if (!visible) return null

  const localBranches = branches.filter(b => !b.name.startsWith('remotes/'))
  const remoteBranches = branches.filter(b => b.name.startsWith('remotes/'))

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        minWidth: 220,
        background: '#252526',
        border: '1px solid #3c3c3c',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        padding: '4px 0',
      }}
    >
      {/* 本地分支 */}
      <div style={{ padding: '6px 12px', fontSize: 11, color: '#6e7681', fontWeight: 600 }}>
        本地分支
      </div>
      {localBranches.map(branch => (
        <button
          key={branch.name}
          onClick={() => {
            if (!branch.current) onCheckout(branch.name)
            onClose()
          }}
          disabled={branch.current}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: branch.current ? '#094771' : 'transparent',
            color: branch.current ? '#ffffff' : '#cccccc',
            fontSize: 13,
            textAlign: 'left',
            cursor: branch.current ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!branch.current) e.currentTarget.style.backgroundColor = '#2a2d2e'
          }}
          onMouseLeave={(e) => {
            if (!branch.current) e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <GitBranch size={14} style={{ marginRight: 8, color: branch.current ? '#238636' : '#8b949e' }} />
          <span>{branch.name}</span>
          {branch.current && <Check size={12} style={{ marginLeft: 'auto', color: '#238636' }} />}
        </button>
      ))}

      {/* 远程分支 */}
      {remoteBranches.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid #3c3c3c', margin: '4px 0' }} />
          <div style={{ padding: '6px 12px', fontSize: 11, color: '#6e7681', fontWeight: 600 }}>
            远程分支
          </div>
          {remoteBranches.map(branch => (
            <button
              key={branch.name}
              onClick={() => {
                onCheckout(branch.name)
                onClose()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                color: '#cccccc',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2d2e'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Cloud size={14} style={{ marginRight: 8, color: '#8b949e' }} />
              <span>{branch.name.replace('remotes/', '')}</span>
            </button>
          ))}
        </>
      )}

      {/* 创建新分支 */}
      <div style={{ borderTop: '1px solid #3c3c3c', margin: '4px 0' }} />
      <button
        onClick={() => {
          onCreateBranch()
          onClose()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          padding: '6px 12px',
          border: 'none',
          background: 'transparent',
          color: '#58a6ff',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2d2e'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <Plus size={14} style={{ marginRight: 8 }} />
        <span>创建新分支...</span>
      </button>
    </div>
  )
}

// ==================== 主组件 ====================

export const GitPanel: React.FC<GitPanelProps> = ({ repoPath, openFile }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('changes')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['changes', 'staged']))
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [showNewBranchDialog, setShowNewBranchDialog] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [commitMessage, setCommitMessage] = useState('')

  const branchMenuRef = useRef<HTMLDivElement>(null)

  // 使用 Git hook
  const {
    isRepo,
    branch,
    branches,
    files,
    commits,
    isLoading,
    ahead,
    behind,
    refresh,
    stageFiles,
    unstageFiles,
    discardChanges,
    commit,
    checkoutBranch,
    createBranch,
    getCommitDetails,
    getDiff,
    addToGitignore,
  } = useGit({ repoPath })

  // 文件分组
  const groupedFiles = useMemo(() => {
    const staged: FileItemData[] = []
    const modified: FileItemData[] = []
    const untracked: FileItemData[] = []

    files.forEach((file: { path: string; status: string; staged: boolean }) => {
      const fileData: FileItemData = {
        path: file.path,
        status: file.status as FileStatus,
        staged: file.staged,
      }
      if (file.staged) {
        staged.push(fileData)
      } else if (file.status === 'untracked') {
        untracked.push(fileData)
      } else {
        modified.push(fileData)
      }
    })

    return { staged, modified, untracked }
  }, [files])

  // 切换区域展开状态
  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(section)) {
        newSet.delete(section)
      } else {
        newSet.add(section)
      }
      return newSet
    })
  }, [])

  // 选择文件
  const selectFile = useCallback((path: string, selected: boolean) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(path)
      } else {
        newSet.delete(path)
      }
      return newSet
    })
  }, [])

  // 提交更改
  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    await commit(commitMessage)
    setCommitMessage('')
  }

  // 创建新分支
  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return
    await createBranch(newBranchName)
    setNewBranchName('')
    setShowNewBranchDialog(false)
  }

  // 打开文件
  const handleOpenFile = async (filePath: string) => {
    if (!repoPath || !openFile) return
    
    try {
      const api = (window as any).api
      const fullPath = `${repoPath}/${filePath}`
      const result = await api.fsReadFile(fullPath)
      // fsReadFile 返回 { success: true, content: string }
      const content = result?.success ? result.content : ''
      openFile(filePath, content)
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }

  // 打开提交中的文件差异
  const handleOpenCommitFile = (commitHash: string, filePath: string) => {
    if (!repoPath) return
    
    console.log('[GitPanel] Opening diff for:', filePath, 'commit:', commitHash)
    
    // 触发自定义事件打开 diff 视图
    const event = new CustomEvent('git:openDiff', {
      detail: {
        filePath,
        commitHash,
        repoPath
      }
    })
    window.dispatchEvent(event)
    console.log('[GitPanel] Dispatched git:openDiff event')
  }

  // 打开文件差异
  const handleOpenDiff = async (filePath: string, isStaged = false, fileStatus?: string) => {
    try {
      let diffContent = ''
      
      // 对于未跟踪文件，读取完整文件内容作为 diff
      if (fileStatus === 'untracked') {
        const api = (window as any).api
        const fullPath = `${repoPath}/${filePath}`
        console.log('[handleOpenDiff] Reading untracked file:', fullPath)
        const result = await api.fsReadFile(fullPath)
        // fsReadFile 返回 { success: true, content: string }
        const content = result?.success ? result.content : ''
        console.log('[handleOpenDiff] File content length:', content.length)
        if (content) {
          const lines = content.split('\n')
          // 构建一个模拟的 diff 格式
          diffContent = `diff --git a/${filePath} b/${filePath}
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/${filePath}
@@ -0,0 +1,${lines.length} @@
${lines.map((line: string) => '+' + line).join('\n')}`
          console.log('[handleOpenDiff] Generated diff length:', diffContent.length)
        } else {
          console.warn('[handleOpenDiff] Empty content for untracked file:', filePath)
        }
      } else {
        // 对于版本控制中的文件，使用 git diff
        console.log('[handleOpenDiff] Getting diff for tracked file:', filePath, 'status:', fileStatus)
        diffContent = await getDiff(filePath, isStaged)
        console.log('[handleOpenDiff] Git diff result length:', diffContent?.length || 0)
      }
      
      if (diffContent && openFile) {
        // 打开 diff 视图
        const event = new CustomEvent('git:openDiff', {
          detail: {
            filePath,
            diffContent,
            isStaged
          }
        })
        window.dispatchEvent(event)
      } else if (!diffContent) {
        console.warn('No diff content for file:', filePath)
      }
    } catch (err) {
      console.error('Failed to open diff:', err)
    }
  }

  // 提交历史展开状态
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<Record<string, string[]>>({})

  // 切换提交展开状态
  const toggleCommitExpand = useCallback(async (commitHash: string) => {
    if (expandedCommit === commitHash) {
      // 如果已展开，则关闭
      setExpandedCommit(null)
    } else {
      // 展开新的提交，关闭其他
      setExpandedCommit(commitHash)
      
      // 如果还没有获取文件列表，则获取
      if (!commitFiles[commitHash] && repoPath) {
        try {
          const details = await getCommitDetails(commitHash)
          if (details && details.files) {
            setCommitFiles(prev => ({
              ...prev,
              [commitHash]: details.files
            }))
          }
        } catch (error) {
          console.error('Failed to get commit details:', error)
        }
      }
    }
  }, [expandedCommit, commitFiles, repoPath, getCommitDetails])

  // 如果没有 Git 仓库
  if (!isRepo) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 40,
        color: '#8b949e',
        background: '#0D1117',
      }}>
        <FolderGit size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
          未找到 Git 仓库
        </div>
        <div style={{ fontSize: 13 }}>
          请打开一个包含 Git 仓库的项目
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#0D1117' }}>
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #30363d',
        background: '#161b22',
      }}>
        {/* 分支信息 */}
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 8 }}>
          <GitBranch size={14} style={{ color: '#8b949e' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e6edf3' }}>
            {branch || 'main'}
          </span>
          {ahead > 0 && (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '2px 6px',
              background: '#238636',
              borderRadius: 10,
              fontSize: 11,
              color: '#fff',
            }}>
              <CloudUpload size={10} />
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '2px 6px',
              background: '#d29922',
              borderRadius: 10,
              fontSize: 11,
              color: '#fff',
            }}>
              <CloudDownload size={10} />
              {behind}
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={refresh}
            disabled={isLoading}
            style={{
              padding: 4,
              border: 'none',
              background: 'transparent',
              color: '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
            }}
            title="刷新"
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
          
          {/* 分支菜单 */}
          <div ref={branchMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowBranchMenu(!showBranchMenu)}
              style={{
                padding: 4,
                border: 'none',
                background: 'transparent',
                color: '#8b949e',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              title="分支操作"
            >
              <MoreVertical size={14} />
            </button>
            <BranchDropdown
              branches={branches}
              currentBranch={branch || ''}
              onCheckout={checkoutBranch}
              onCreateBranch={() => setShowNewBranchDialog(true)}
              visible={showBranchMenu}
              onClose={() => setShowBranchMenu(false)}
            />
          </div>
        </div>
      </div>

      {/* 视图切换 */}
      <div style={{
        display: 'flex',
        padding: '4px 8px',
        gap: 4,
        borderBottom: '1px solid #30363d',
      }}>
        {[
          { key: 'changes', label: '更改', icon: <File size={14} /> },
          { key: 'history', label: '历史', icon: <History size={14} /> },
        ].map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setViewMode(key as ViewMode)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              border: 'none',
              background: viewMode === key ? '#1f6feb' : 'transparent',
              color: viewMode === key ? '#fff' : '#8b949e',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* 更改视图 */}
      {viewMode === 'changes' && (
        <div style={{ padding: '8px 0' }}>
          {/* 暂存的更改 */}
          {groupedFiles.staged.length > 0 && (
            <Section
              title="暂存的更改"
              count={groupedFiles.staged.length}
              expanded={expandedSections.has('staged')}
              onToggle={() => toggleSection('staged')}
              actions={
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    unstageFiles(groupedFiles.staged.map(f => f.path))
                  }}
                  style={{
                    padding: '2px 6px',
                    border: 'none',
                    background: 'transparent',
                    color: '#8b949e',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <Minus size={12} />
                  全部取消暂存
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
                  onOpenFile={() => handleOpenFile(file.path)}
                  onOpenDiff={() => handleOpenDiff(file.path, false, file.status)}
                  onAddToGitignore={() => addToGitignore(file.path)}
                />
              ))}
            </Section>
          )}

          {/* 更改 */}
          <Section
            title="更改"
            count={groupedFiles.modified.length + groupedFiles.untracked.length}
            expanded={expandedSections.has('changes')}
            onToggle={() => toggleSection('changes')}
            actions={
              <>
                {groupedFiles.modified.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      stageFiles(groupedFiles.modified.map(f => f.path))
                    }}
                    style={{
                      padding: '2px 6px',
                      border: 'none',
                      background: 'transparent',
                      color: '#8b949e',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <Plus size={12} />
                    全部暂存
                  </button>
                )}
              </>
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
                onDiscard={() => discardChanges([file.path])}
                onOpenFile={() => handleOpenFile(file.path)}
                onOpenDiff={() => handleOpenDiff(file.path, false, file.status)}
                onAddToGitignore={() => addToGitignore(file.path)}
              />
            ))}
            {groupedFiles.untracked.map(file => (
              <FileItem
                key={file.path}
                file={file}
                selected={selectedFiles.has(file.path)}
                onSelect={(selected) => selectFile(file.path, selected)}
                onStage={() => stageFiles([file.path])}
                onUnstage={() => {}}
                onDiscard={() => {}}
                onOpenFile={() => handleOpenFile(file.path)}
                onOpenDiff={() => handleOpenDiff(file.path, false, file.status)}
                onAddToGitignore={() => addToGitignore(file.path)}
              />
            ))}
          </Section>

          {/* 提交信息输入 */}
          <div style={{ padding: '12px' }}>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="输入提交信息..."
              style={{
                width: '100%',
                minHeight: 60,
                padding: 8,
                border: '1px solid #30363d',
                borderRadius: 4,
                background: '#0D1117',
                color: '#e6edf3',
                fontSize: 13,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || groupedFiles.staged.length === 0}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                background: commitMessage.trim() && groupedFiles.staged.length > 0 ? '#238636' : '#30363d',
                color: '#fff',
                fontSize: 13,
                cursor: commitMessage.trim() && groupedFiles.staged.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              <Check size={14} style={{ marginRight: 6 }} />
              提交
            </button>
          </div>
        </div>
      )}

      {/* 历史视图 */}
      {viewMode === 'history' && (
        <div style={{ padding: '8px 0', overflow: 'auto' }}>
          {commits.length === 0 ? (
            <div style={{ 
              padding: 40, 
              textAlign: 'center', 
              color: '#8b949e',
              fontSize: 13 
            }}>
              <History size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
              <div>暂无提交历史</div>
            </div>
          ) : (
            commits.map((commit, index) => {
              const isExpanded = expandedCommit === commit.hash
              const files = commitFiles[commit.hash] || []
              
              return (
                <div
                  key={commit.hash}
                  style={{
                    borderBottom: index < commits.length - 1 ? '1px solid #21262d' : 'none',
                  }}
                >
                  {/* 提交项头部 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s',
                      backgroundColor: isExpanded ? '#161b22' : 'transparent',
                    }}
                    onClick={() => toggleCommitExpand(commit.hash)}
                    onMouseEnter={(e) => {
                      if (!isExpanded) e.currentTarget.style.backgroundColor = '#161b22'
                    }}
                    onMouseLeave={(e) => {
                      if (!isExpanded) e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    {/* 展开箭头 */}
                    <div style={{
                      width: 16,
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 8,
                      transition: 'transform 0.2s',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}>
                      <ChevronRight size={14} style={{ color: '#8b949e' }} />
                    </div>

                    {/* 提交图标 */}
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: index === 0 ? '#238636' : '#8957e5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 10,
                      flexShrink: 0,
                    }}>
                      <GitCommit size={12} style={{ color: '#fff' }} />
                    </div>

                    {/* 提交信息 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* 提交消息 */}
                      <div style={{
                        fontSize: 13,
                        color: '#e6edf3',
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {commit.message}
                      </div>

                      {/* 作者和时间 */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        color: '#8b949e',
                      }}>
                        <span>{commit.author}</span>
                        <span>•</span>
                        <span>
                          {new Date(commit.date).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Commit Hash */}
                    <div style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#58a6ff',
                      padding: '2px 6px',
                      background: '#0d1117',
                      borderRadius: 4,
                      marginLeft: 8,
                      flexShrink: 0,
                    }}>
                      {commit.hash.substring(0, 7)}
                    </div>
                  </div>

                  {/* 展开的文件列表 */}
                  {isExpanded && (
                    <div style={{
                      padding: '0 12px 8px 44px',
                      background: '#0d1117',
                    }}>
                      {files.length === 0 ? (
                        <div style={{
                          padding: '8px 0',
                          fontSize: 12,
                          color: '#6e7681',
                        }}>
                          加载文件列表...
                        </div>
                      ) : (
                        files.map((filePath: string) => (
                          <div
                            key={filePath}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              borderRadius: 3,
                              transition: 'background-color 0.1s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#21262d'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                            onClick={() => handleOpenCommitFile(commit.hash, filePath)}
                          >
                            {/* 文件图标 */}
                            <span style={{
                              marginRight: 6,
                              display: 'flex',
                              alignItems: 'center',
                              color: '#8b949e',
                            }}>
                              <FileCode size={12} />
                            </span>
                            
                            {/* 文件名 */}
                            <span style={{
                              fontSize: 12,
                              color: '#cccccc',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {filePath}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* 新建分支对话框 */}
      {showNewBranchDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            width: 400,
            padding: 20,
            background: '#161b22',
            borderRadius: 8,
            border: '1px solid #30363d',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e6edf3', marginBottom: 16 }}>
              创建新分支
            </div>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="分支名称"
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid #30363d',
                borderRadius: 4,
                background: '#0D1117',
                color: '#e6edf3',
                fontSize: 13,
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => {
                  setShowNewBranchDialog(false)
                  setNewBranchName('')
                }}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  background: 'transparent',
                  color: '#8b949e',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 4,
                  background: newBranchName.trim() ? '#238636' : '#30363d',
                  color: '#fff',
                  fontSize: 13,
                  cursor: newBranchName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GitPanel
