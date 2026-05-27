/**
 * useGit - Git 状态管理 Hook
 * 提供 Git 仓库状态查询和操作功能
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  getGitStatus,
  getGitBranches,
  getGitCommits,
  getFileDiff,
  getGitStashList,
  type GitStatus as GitStatusType
} from '../services/enhanced-ipc-client'

export interface GitFile {
  path: string
  status: 'staged' | 'modified' | 'untracked' | 'conflicted' | 'clean'
  staged: boolean
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export interface GitStash {
  index: number
  hash: string
  message: string
}

export interface UseGitOptions {
  repoPath: string | null
  autoRefresh?: boolean
  refreshInterval?: number
}

export interface UseGitReturn {
  // State
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
  branches: GitBranch[]
  commits: GitCommit[]
  stashes: GitStash[]
  selectedFiles: Set<string>
  commitMessage: string
  isLoading: boolean
  error: string | null

  // Actions
  refresh: () => Promise<void>
  selectFile: (path: string, selected: boolean) => void
  selectAllFiles: (status: GitFile['status'] | 'all', selected: boolean) => void
  setCommitMessage: (message: string) => void
  stageFiles: (files: string[]) => Promise<boolean>
  unstageFiles: (files: string[]) => Promise<boolean>
  commit: (message?: string, files?: string[]) => Promise<boolean>
  discardChanges: (files: string[]) => Promise<boolean>
  createBranch: (branchName: string, checkout?: boolean) => Promise<boolean>
  checkoutBranch: (branchName: string) => Promise<boolean>
  deleteBranch: (branchName: string, force?: boolean) => Promise<boolean>
  push: (remote?: string, branch?: string) => Promise<boolean>
  pull: (remote?: string, branch?: string) => Promise<boolean>
  getDiff: (filePath: string, staged?: boolean) => Promise<string>
  stash: (message?: string) => Promise<boolean>
  popStash: (index?: number) => Promise<boolean>
}

export function useGit(options: UseGitOptions): UseGitReturn {
  const { repoPath, autoRefresh = true, refreshInterval = 5000 } = options

  const [isRepo, setIsRepo] = useState(false)
  const [branch, setBranch] = useState('')
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [files, setFiles] = useState<GitFile[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [stashes, setStashes] = useState<GitStash[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * 刷新 Git 状态
   */
  const refresh = useCallback(async () => {
    if (!repoPath) {
      setIsRepo(false)
      setFiles([])
      setBranches([])
      setCommits([])
      setStashes([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // 获取状态
      const status = await getGitStatus(repoPath)
      setIsRepo(status.isRepo)
      setBranch(status.branch)
      setAhead(status.ahead)
      setBehind(status.behind)

      if (status.isRepo) {
        // 合并文件列表
        const allFiles: GitFile[] = [
          ...status.staged.map(path => ({ path, status: 'staged' as const, staged: true })),
          ...status.modified.map(path => ({ path, status: 'modified' as const, staged: false })),
          ...status.untracked.map(path => ({ path, status: 'untracked' as const, staged: false })),
          ...status.conflicted.map(path => ({ path, status: 'conflicted' as const, staged: false }))
        ]
        setFiles(allFiles)

        // 获取分支
        const branchesResult = await getGitBranches(repoPath)
        const branchList: GitBranch[] = Object.entries(branchesResult.branches || {}).map(([name, info]: [string, any]) => ({
          name,
          current: info.current
        }))
        setBranches(branchList)

        // 获取提交历史
        const commitsResult = await getGitCommits(repoPath, 10)
        setCommits(commitsResult)

        // 获取 stash 列表
        const stashesResult = await getGitStashList(repoPath)
        setStashes(stashesResult)
      }
    } catch (err) {
      console.error('Failed to refresh git status:', err)
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [repoPath])

  /**
   * 选择文件
   */
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

  /**
   * 选择所有文件
   */
  const selectAllFiles = useCallback((status: GitFile['status'] | 'all', selected: boolean) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev)
      const filesToToggle = status === 'all' ? files : files.filter(f => f.status === status)

      filesToToggle.forEach(file => {
        if (selected) {
          newSet.add(file.path)
        } else {
          newSet.delete(file.path)
        }
      })

      return newSet
    })
  }, [files])

  /**
   * 暂存文件
   */
  const stageFiles = useCallback(async (filesToStage: string[]): Promise<boolean> => {
    if (!repoPath || filesToStage.length === 0) return false

    try {
      const api = (window as any).api
      if (!api?.gitStage) {
        throw new Error('Git stage API not available')
      }

      const result = await api.gitStage(repoPath, filesToStage)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to stage files:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 取消暂存文件
   */
  const unstageFiles = useCallback(async (filesToUnstage: string[]): Promise<boolean> => {
    if (!repoPath || filesToUnstage.length === 0) return false

    try {
      const api = (window as any).api
      if (!api?.gitUnstage) {
        throw new Error('Git unstage API not available')
      }

      const result = await api.gitUnstage(repoPath, filesToUnstage)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to unstage files:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 提交更改
   */
  const commit = useCallback(async (message?: string, filesToCommit?: string[]): Promise<boolean> => {
    if (!repoPath) return false

    const commitMsg = message || commitMessage
    if (!commitMsg.trim()) {
      setError('请输入提交信息')
      return false
    }

    try {
      const api = (window as any).api
      if (!api?.gitCommit) {
        throw new Error('Git commit API not available')
      }

      const result = await api.gitCommit(repoPath, commitMsg, filesToCommit)
      if (result) {
        setCommitMessage('')
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to commit:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, commitMessage, refresh])

  /**
   * 丢弃更改
   */
  const discardChanges = useCallback(async (filesToDiscard: string[]): Promise<boolean> => {
    if (!repoPath || filesToDiscard.length === 0) return false

    try {
      const api = (window as any).api
      if (!api?.gitDiscard) {
        throw new Error('Git discard API not available')
      }

      const result = await api.gitDiscard(repoPath, filesToDiscard)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to discard changes:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 创建分支
   */
  const createBranch = useCallback(async (branchName: string, checkout = true): Promise<boolean> => {
    if (!repoPath || !branchName.trim()) return false

    try {
      const api = (window as any).api
      if (!api?.gitCreateBranch) {
        throw new Error('Git create branch API not available')
      }

      const result = await api.gitCreateBranch(repoPath, branchName, checkout)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to create branch:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 切换分支
   */
  const checkoutBranch = useCallback(async (branchName: string): Promise<boolean> => {
    if (!repoPath || !branchName) return false

    try {
      const api = (window as any).api
      if (!api?.gitCheckoutBranch) {
        throw new Error('Git checkout branch API not available')
      }

      const result = await api.gitCheckoutBranch(repoPath, branchName)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to checkout branch:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 删除分支
   */
  const deleteBranch = useCallback(async (branchName: string, force = false): Promise<boolean> => {
    if (!repoPath || !branchName) return false

    try {
      const api = (window as any).api
      if (!api?.gitDeleteBranch) {
        throw new Error('Git delete branch API not available')
      }

      const result = await api.gitDeleteBranch(repoPath, branchName, force)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to delete branch:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * Push
   */
  const push = useCallback(async (remote = 'origin', branchName?: string): Promise<boolean> => {
    if (!repoPath) return false

    try {
      const api = (window as any).api
      if (!api?.gitPush) {
        throw new Error('Git push API not available')
      }

      const result = await api.gitPush(repoPath, remote, branchName)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to push:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * Pull
   */
  const pull = useCallback(async (remote = 'origin', branchName?: string): Promise<boolean> => {
    if (!repoPath) return false

    try {
      const api = (window as any).api
      if (!api?.gitPull) {
        throw new Error('Git pull API not available')
      }

      const result = await api.gitPull(repoPath, remote, branchName)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to pull:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * 获取文件 diff
   */
  const getDiff = useCallback(async (filePath: string, staged = false): Promise<string> => {
    if (!repoPath || !filePath) return ''

    try {
      return await getFileDiff(repoPath, filePath, staged)
    } catch (err) {
      console.error('Failed to get diff:', err)
      return ''
    }
  }, [repoPath])

  /**
   * Stash
   */
  const stash = useCallback(async (message?: string): Promise<boolean> => {
    if (!repoPath) return false

    try {
      const api = (window as any).api
      if (!api?.gitStash) {
        throw new Error('Git stash API not available')
      }

      const result = await api.gitStash(repoPath, message)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to stash:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  /**
   * Pop stash
   */
  const popStash = useCallback(async (index = 0): Promise<boolean> => {
    if (!repoPath) return false

    try {
      const api = (window as any).api
      if (!api?.gitStashPop) {
        throw new Error('Git stash pop API not available')
      }

      const result = await api.gitStashPop(repoPath, index)
      if (result) {
        await refresh()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to pop stash:', err)
      setError(String(err))
      return false
    }
  }, [repoPath, refresh])

  // 自动刷新
  useEffect(() => {
    if (autoRefresh && repoPath) {
      refresh()

      refreshTimeoutRef.current = setInterval(refresh, refreshInterval)

      return () => {
        if (refreshTimeoutRef.current) {
          clearInterval(refreshTimeoutRef.current)
        }
      }
    }
  }, [repoPath, autoRefresh, refreshInterval, refresh])

  // 监听文件操作事件，自动刷新
  useEffect(() => {
    const handleFileOperation = () => {
      if (repoPath) {
        refresh()
      }
    }

    window.addEventListener('file-operation-completed', handleFileOperation)
    return () => window.removeEventListener('file-operation-completed', handleFileOperation)
  }, [repoPath, refresh])

  return {
    isRepo,
    branch,
    ahead,
    behind,
    files,
    branches,
    commits,
    stashes,
    selectedFiles,
    commitMessage,
    isLoading,
    error,
    refresh,
    selectFile,
    selectAllFiles,
    setCommitMessage,
    stageFiles,
    unstageFiles,
    commit,
    discardChanges,
    createBranch,
    checkoutBranch,
    deleteBranch,
    push,
    pull,
    getDiff,
    stash,
    popStash
  }
}

export default useGit
