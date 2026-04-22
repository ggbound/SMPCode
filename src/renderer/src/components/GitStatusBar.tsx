import { useState, useEffect } from 'react'
import { GitBranch, GitCommit, ArrowUp, ArrowDown, CheckCircle, FileText, AlertCircle } from 'lucide-react'

interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  staged: string[]
  modified: string[]
  untracked: string[]
  conflicted: string[]
  current: string | null
}

interface GitStatusBarProps {
  repoPath: string | null
}

// IPC wrapper for git operations
const gitIPC = {
  async getStatus(repoPath: string): Promise<GitStatus> {
    return await (window as any).api.gitStatus(repoPath)
  },
  
  async isRepo(dirPath: string): Promise<boolean> {
    return await (window as any).api.gitIsRepo(dirPath)
  },
  
  async findRoot(startPath: string): Promise<string | null> {
    return await (window as any).api.gitFindRoot(startPath)
  },
  
  async getFileStatus(repoPath: string, filePath: string): Promise<string | null> {
    return await (window as any).api.gitFileStatus(repoPath, filePath)
  },
  
  async getCommits(repoPath: string, count?: number): Promise<Array<{
    hash: string
    message: string
    author: string
    date: string
  }>> {
    return await (window as any).api.gitCommits(repoPath, count)
  },
  
  async getBranches(repoPath: string): Promise<{
    current: string
    all: string[]
    branches: Record<string, { current: boolean; name: string }>
  }> {
    return await (window as any).api.gitBranches(repoPath)
  }
}

function GitStatusBar({ repoPath }: GitStatusBarProps) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!repoPath) {
      setStatus(null)
      return
    }

    let mounted = true
    setLoading(true)

    gitIPC.getStatus(repoPath).then(gitStatus => {
      if (mounted) {
        setStatus(gitStatus)
        setLoading(false)
      }
    }).catch(err => {
      console.error('Failed to get git status:', err)
      if (mounted) {
        setLoading(false)
      }
    })

    return () => {
      mounted = false
    }
  }, [repoPath])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!repoPath || !status?.isRepo) return

    const interval = setInterval(() => {
      gitIPC.getStatus(repoPath).then(gitStatus => {
        setStatus(gitStatus)
      }).catch(console.error)
    }, 30000)

    return () => clearInterval(interval)
  }, [repoPath, status?.isRepo])

  if (loading) {
    return (
      <div className="git-status-bar">
        <span className="git-status-loading">Loading...</span>
      </div>
    )
  }

  if (!status || !status.isRepo) {
    return null
  }

  const hasChanges = 
    status.staged.length > 0 || 
    status.modified.length > 0 || 
    status.untracked.length > 0 ||
    status.conflicted.length > 0

  return (
    <div className="git-status-bar">
      {/* Branch info */}
      <div className="git-branch-info">
        <GitBranch size={14} />
        <span className="git-branch-name">{status.branch}</span>
      </div>

      {/* Ahead/Behind indicators */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="git-sync-info">
          {status.ahead > 0 && (
            <span className="git-ahead" title={`${status.ahead} commit(s) ahead`}>
              <ArrowUp size={12} />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="git-behind" title={`${status.behind} commit(s) behind`}>
              <ArrowDown size={12} />
              {status.behind}
            </span>
          )}
        </div>
      )}

      {/* Change indicators */}
      <div className="git-changes-info">
        {status.conflicted.length > 0 && (
          <span className="git-conflicted" title={`${status.conflicted.length} conflict(s)`}>
            <AlertCircle size={14} />
            {status.conflicted.length}
          </span>
        )}
        
        {status.staged.length > 0 && (
          <span className="git-staged" title={`${status.staged.length} staged change(s)`}>
            <CheckCircle size={14} />
            {status.staged.length}
          </span>
        )}
        
        {status.modified.length > 0 && (
          <span className="git-modified" title={`${status.modified.length} modified file(s)`}>
            <FileText size={14} />
            {status.modified.length}
          </span>
        )}
        
        {status.untracked.length > 0 && (
          <span className="git-untracked" title={`${status.untracked.length} untracked file(s)`}>
            <FileText size={14} />
            {status.untracked.length}
          </span>
        )}
      </div>

      {/* No changes indicator */}
      {!hasChanges && (
        <div className="git-clean">
          <CheckCircle size={14} />
          <span>Clean</span>
        </div>
      )}
    </div>
  )
}

export default GitStatusBar
export { gitIPC }
