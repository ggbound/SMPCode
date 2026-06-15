/**
 * JackFileExplorer - 基于 @knurdz/jack-file-tree 的全新资源管理器组件
 * 完全重构，替代原有的 FileExplorer 组件
 * 
 * 功能说明：
 * - 文件夹展开状态由 jack-file-tree 内部管理
 * - 右键菜单使用自定义渲染，确保位置正确
 * - 剪贴板操作（剪切/复制/粘贴）由组件内部管理
 * - 删除为彻底删除（不是软删除）
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileTree,
  type FileTreeFsAdapter,
  type FileTreeNode,
  type FileTreeItemType,
  type FileTreeContextMenuRenderProps,
  attachFileTreeUndoHotkeys,
  clearFileTreeUndoStack,
} from '@knurdz/jack-file-tree'
import '../styles/jackFileExplorer.css'

// 获取目录路径的辅助函数
function getDirectoryPath(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf('/')
  const lastBackslashIndex = filePath.lastIndexOf('\\')
  const lastSeparatorIndex = Math.max(lastSlashIndex, lastBackslashIndex)
  
  if (lastSeparatorIndex === -1) {
    return '.'
  }
  
  return filePath.substring(0, lastSeparatorIndex) || '/'
}

// 文件系统适配器 - 通过 IPC 与主进程通信
const fsAdapter: FileTreeFsAdapter = {
  // 读取目录内容
  readDirectory: async (path: string): Promise<FileTreeNode[]> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const result = await api.executeTool(
        `list-dir-${Date.now()}`,
        'list_directory',
        { path },
        path
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to read directory')
      }

      const entries = JSON.parse(result.output)
      return entries.map((entry: any) => ({
        name: entry.name,
        path: `${path}/${entry.name}`.replace(/\/+/g, '/').replace(/\/\/+/g, '/'),
        type: entry.isDirectory ? 'directory' : 'file',
        extension: entry.isDirectory ? undefined : entry.name.split('.').pop()
      }))
    } catch (error) {
      console.error('[JackFileExplorer] Failed to read directory:', error)
      throw error
    }
  },

  // 读取文件内容
  readFile: async (path: string): Promise<string> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const result = await api.executeTool(
        `read-file-${Date.now()}`,
        'read_file',
        { path },
        path
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to read file')
      }

      return result.output
    } catch (error) {
      console.error('[JackFileExplorer] Failed to read file:', error)
      throw error
    }
  },

  // 创建文件
  createFile: async (path: string): Promise<string | void> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const result = await api.executeTool(
        `create-file-${Date.now()}`,
        'write_file',
        { path, content: '' },
        path
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to create file')
      }
      return path
    } catch (error) {
      console.error('[JackFileExplorer] Failed to create file:', error)
      throw error
    }
  },

  // 创建文件夹
  createFolder: async (path: string): Promise<string | void> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const result = await api.executeTool(
        `mkdir-${Date.now()}`,
        'execute_bash',
        { command: `mkdir -p "${path}"` },
        path
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to create folder')
      }
      return path
    } catch (error) {
      console.error('[JackFileExplorer] Failed to create folder:', error)
      throw error
    }
  },

  // 重命名项目
  renameItem: async (oldPath: string, newPath: string): Promise<string | void> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const cwd = getDirectoryPath(oldPath)
      const result = await api.executeTool(
        `rename-${Date.now()}`,
        'execute_bash',
        { command: `mv "${oldPath}" "${newPath}"` },
        cwd
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to rename')
      }
      return newPath
    } catch (error) {
      console.error('[JackFileExplorer] Failed to rename:', error)
      throw error
    }
  },

  // 复制项目
  copyItem: async (oldPath: string, newPath: string): Promise<string | void> => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const cwd = getDirectoryPath(oldPath)
      const result = await api.executeTool(
        `copy-${Date.now()}`,
        'execute_bash',
        { command: `cp -r "${oldPath}" "${newPath}"` },
        cwd
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to copy')
      }
      return newPath
    } catch (error) {
      console.error('[JackFileExplorer] Failed to copy:', error)
      throw error
    }
  },

  // 在文件管理器中打开
  openInFileManager: async (path: string): Promise<void> => {
    const api = (window as any).api
    if (!api) return

    try {
      await api.executeTool(
        `open-fm-${Date.now()}`,
        'execute_bash',
        { command: process.platform === 'darwin' ? `open "${path}"` : process.platform === 'win32' ? `explorer "${path}"` : `xdg-open "${path}"` },
        path
      )
    } catch (error) {
      console.error('[JackFileExplorer] Failed to open in file manager:', error)
    }
  }
}

interface JackFileExplorerProps {
  onFileSelect: (path: string, content: string) => void
  selectedPath: string | null
  onRootPathChange?: (path: string) => void
  onFileRenamed?: (oldPath: string, newPath: string, newName: string) => void
  onFileDeleted?: (path: string) => void
  projectPath?: string | null
}

export function JackFileExplorer({
  onFileSelect,
  selectedPath,
  onRootPathChange,
  onFileRenamed,
  onFileDeleted,
  projectPath
}: JackFileExplorerProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [newFileTrigger, setNewFileTrigger] = useState(0)

  // 同步外部 projectPath
  useEffect(() => {
    if (projectPath && projectPath !== workspaceRoot) {
      setWorkspaceRoot(projectPath)
      clearFileTreeUndoStack()
      if (onRootPathChange) {
        onRootPathChange(projectPath)
      }
    }
  }, [projectPath, workspaceRoot, onRootPathChange])

  // 同步 selectedPath
  useEffect(() => {
    if (selectedPath) {
      setActiveFilePath(selectedPath)
    }
  }, [selectedPath])

  // 启用撤销热键（Cmd/Ctrl+Z）- 仅用于重命名/创建撤销
  useEffect(() => {
    const cleanup = attachFileTreeUndoHotkeys({
      monacoSelector: '.monaco-editor',
      isEditableTarget: (target) => {
        if (!target) return false
        const el = target as HTMLElement
        return el.tagName === 'INPUT' || 
               el.tagName === 'TEXTAREA' || 
               el.isContentEditable ||
               el.closest('.monaco-editor') !== null
      }
    })
    return cleanup
  }, [])

  // 处理文件点击 - 打开文件
  const handleFileClick = useCallback((path: string, name: string) => {
    console.log('[JackFileExplorer] File clicked:', path, name)
    setActiveFilePath(path)

    // 读取并打开文件
    if (fsAdapter.readFile) {
      fsAdapter.readFile(path).then(content => {
        onFileSelect(path, content)
      }).catch(error => {
        console.error('[JackFileExplorer] Failed to read file:', error)
      })
    }
  }, [onFileSelect])

  // onFileOpened 在 jack-file-tree 中不是双击事件
  // 它是在文件被"打开"时调用（如粘贴后），我们不需要处理它
  const handleFileOpened = useCallback((path: string, name: string, isPreview?: boolean) => {
    console.log('[JackFileExplorer] File opened event (paste/create):', path, name, isPreview)
    // 不需要额外处理，因为 onFileClick 已经处理了文件打开
  }, [])

  // 处理打开文件夹
  const handleOpenFolder = useCallback(async () => {
    const api = (window as any).api
    if (!api?.selectFolder) return

    try {
      const folderPath = await api.selectFolder()
      if (folderPath) {
        setWorkspaceRoot(folderPath)
        clearFileTreeUndoStack()
        if (onRootPathChange) {
          onRootPathChange(folderPath)
        }
      }
    } catch (error) {
      console.error('[JackFileExplorer] Failed to select folder:', error)
    }
  }, [onRootPathChange])

  // 处理在文件管理器中打开
  const handleOpenInFileManager = useCallback(async (path: string) => {
    await fsAdapter.openInFileManager?.(path)
  }, [])

  // 彻底删除文件/文件夹
  const performHardDelete = useCallback(async (path: string, type: FileTreeItemType) => {
    const api = (window as any).api
    if (!api) throw new Error('API not available')

    try {
      const cwd = getDirectoryPath(path)
      const command = type === 'directory' 
        ? `rm -rf "${path}"`
        : `rm -f "${path}"`
      
      const result = await api.executeTool(
        `delete-${Date.now()}`,
        'execute_bash',
        { command },
        cwd
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete')
      }

      console.log('[JackFileExplorer] Hard deleted:', path)
      
      // 通知外部
      if (onFileDeleted) {
        onFileDeleted(path)
      }
      if (activeFilePath === path) {
        setActiveFilePath(null)
      }
      
      // 触发刷新
      setRefreshKey(prev => prev + 1)
    } catch (error) {
      console.error('[JackFileExplorer] Failed to hard delete:', error)
      throw error
    }
  }, [onFileDeleted, activeFilePath])

  // 处理文件重命名
  const handleFileRenamed = useCallback((oldPath: string, newPath: string) => {
    console.log('[JackFileExplorer] File renamed:', oldPath, '->', newPath)
    const newName = newPath.split('/').pop() || ''
    if (onFileRenamed) {
      onFileRenamed(oldPath, newPath, newName)
    }
    if (activeFilePath === oldPath) {
      setActiveFilePath(newPath)
    }
  }, [onFileRenamed, activeFilePath])

  // 处理文件创建
  const handleFileCreated = useCallback((path: string, name: string, savedContent?: string, isUndo?: boolean) => {
    console.log('[JackFileExplorer] File created:', path, name)
    setRefreshKey(prev => prev + 1)
  }, [])

  // 处理文件夹创建
  const handleFolderCreated = useCallback((path: string, isUndo?: boolean) => {
    console.log('[JackFileExplorer] Folder created:', path)
    setRefreshKey(prev => prev + 1)
  }, [])

  // 处理文件移动（拖放）
  const handleFileMoved = useCallback(() => {
    console.log('[JackFileExplorer] File moved')
    setRefreshKey(prev => prev + 1)
  }, [])

  // 处理文件复制
  const handleFileCopied = useCallback((newPath: string, type: FileTreeItemType) => {
    console.log('[JackFileExplorer] File copied:', newPath, type)
    setRefreshKey(prev => prev + 1)
  }, [])

  // 监听文件变化事件
  useEffect(() => {
    const api = (window as any).api
    if (!api?.onFileChange) return

    const handleFileChange = (_event: any, data: { eventType: string; filename: string; dirPath: string }) => {
      console.log('[JackFileExplorer] File changed:', data.eventType, data.filename)
      setTimeout(() => {
        setRefreshKey(prev => prev + 1)
      }, 300)
    }

    const unsubscribe = api.onFileChange(handleFileChange)
    return () => {
      unsubscribe?.()
    }
  }, [])

  // 监听文件操作完成事件
  useEffect(() => {
    const handleFileOperationCompleted = () => {
      console.log('[JackFileExplorer] File operation completed, refreshing...')
      setRefreshKey(prev => prev + 1)
    }

    window.addEventListener('file-operation-completed', handleFileOperationCompleted)
    return () => {
      window.removeEventListener('file-operation-completed', handleFileOperationCompleted)
    }
  }, [])

  // 自定义上下文菜单组件 - 使用彻底删除
  const ContextMenu = (props: FileTreeContextMenuRenderProps) => {
    const { groups, closeMenu, position, scope, node } = props
    const menuRef = useRef<HTMLDivElement>(null)
    const [adjustedPosition, setAdjustedPosition] = useState(position)

    // 计算菜单位置
    useEffect(() => {
      if (menuRef.current) {
        const menu = menuRef.current
        const rect = menu.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        let x = position.x
        let y = position.y

        if (x + rect.width > viewportWidth) {
          x = viewportWidth - rect.width - 8
        }
        if (x < 0) {
          x = 8
        }
        if (y + rect.height > viewportHeight) {
          y = viewportHeight - rect.height - 8
        }
        if (y < 0) {
          y = 8
        }

        setAdjustedPosition({ x, y })
      }
    }, [position])

    // 点击外部关闭
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          closeMenu()
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [closeMenu])

    // 按 Escape 关闭
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeMenu()
        }
      }
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [closeMenu])

    // 处理删除点击 - 使用彻底删除
    const handleDeleteClick = async () => {
      if (!node) return
      
      // 确认删除
      const confirmed = window.confirm(`确定要彻底删除 ${node.name} 吗？\n此操作不可撤销。`)
      if (!confirmed) {
        closeMenu()
        return
      }

      closeMenu()
      
      try {
        await performHardDelete(node.path, node.type)
      } catch (error) {
        console.error('[JackFileExplorer] Delete failed:', error)
        alert('删除失败: ' + (error instanceof Error ? error.message : String(error)))
      }
    }

    return (
      <div
        ref={menuRef}
        className="sft-context-menu-layer"
        style={{
          position: 'fixed',
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          zIndex: 999999,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sft-context-menu" data-scope={scope}>
          {groups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.map((item) => {
                // 如果是删除操作，使用自定义处理
                if (item.id === 'delete') {
                  return (
                    <div
                      key={item.id}
                      className={`sft-context-menu-item sft-danger`}
                      onClick={handleDeleteClick}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="sft-context-menu-shortcut">{item.shortcut}</span>
                      )}
                    </div>
                  )
                }
                
                // 其他操作使用默认行为
                return (
                  <div
                    key={item.id}
                    className={`sft-context-menu-item ${item.danger ? 'sft-danger' : ''} ${item.disabled ? 'sft-disabled' : ''}`}
                    onClick={() => {
                      if (!item.disabled) {
                        item.onSelect()
                        closeMenu()
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span className="sft-context-menu-shortcut">{item.shortcut}</span>
                    )}
                  </div>
                )
              })}
              {groupIndex < groups.length - 1 && <div className="sft-context-menu-separator" />}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 自定义标签
  const customLabels = {
    explorer: '资源管理器',
    openFolder: '打开文件夹',
    noFolderOpened: '未打开文件夹',
    openInFileExplorer: '在资源管理器中打开',
    openInFinder: '在 Finder 中打开',
    openInFileManager: '在文件管理器中打开',
    newFile: '新建文件',
    newFolder: '新建文件夹',
    collapseAllFolders: '全部折叠',
    expandAllFolders: '全部展开',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    rename: '重命名',
    delete: '彻底删除',
    createFilePlaceholder: '输入文件名',
    createFolderPlaceholder: '输入文件夹名',
  }

  return (
    <div className="jack-file-explorer">
      <FileTree
        fs={fsAdapter}
        workspaceRoot={workspaceRoot}
        sidebarPosition="left"
        activeFilePath={activeFilePath}
        onOpenFolder={handleOpenFolder}
        onOpenInFileManager={handleOpenInFileManager}
        onFileClick={handleFileClick}
        onFileOpened={handleFileOpened}
        // 不传递 onFileDeleted，使用自定义删除
        onFileRenamed={handleFileRenamed}
        onFileCreated={handleFileCreated}
        onFolderCreated={handleFolderCreated}
        onFileMoved={handleFileMoved}
        onFileCopied={handleFileCopied}
        refreshTrigger={refreshKey}
        newFileTrigger={newFileTrigger}
        showHeader={true}
        showHeaderActions={true}
        iconTheme="material"
        enableUndoHotkeys={true}
        theme={{
          backgroundPrimary: 'var(--sidebar-background)',
          backgroundSecondary: 'var(--sidebar-background)',
          backgroundHover: 'var(--list-hover-background)',
          textPrimary: 'var(--foreground)',
          textSecondary: 'var(--foreground-muted)',
          textMuted: 'var(--foreground-muted)',
          accent: 'var(--accent)',
          accentTransparent: 'var(--accent-transparent)',
          danger: 'var(--danger)',
          menuBackground: 'var(--menu-background)',
          menuBorder: 'var(--menu-border)',
          menuHover: 'var(--menu-hover)',
          menuText: 'var(--menu-text)',
          sidebarBorder: 'var(--border)',
          openFolderButtonBackground: 'var(--button-background)',
          openFolderButtonBackgroundHover: 'var(--button-background-hover)',
          openFolderButtonText: 'var(--button-foreground)',
          openFolderButtonBorder: 'var(--button-border)',
          fontFamily: 'var(--font-family)',
          panelTopPadding: 8,
        }}
        // 启用上下文菜单，使用自定义渲染
        contextMenu={{
          enabled: true,
          actions: {
            'new-file': true,
            'new-folder': true,
            'open-in-file-manager': true,
            cut: true,
            copy: true,
            paste: true,
            rename: true,
            delete: true,
          },
          renderMenu: (props) => <ContextMenu {...props} />,
        }}
        labels={customLabels}
      />
    </div>
  )
}

export default JackFileExplorer
