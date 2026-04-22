import { useState, useEffect } from 'react'
import { GitBranch, AlertCircle, AlertTriangle, DollarSign, Settings, Bell } from 'lucide-react'
import { t } from '../i18n'

interface StatusBarProps {
  permissionMode: string
  inputTokens: number
  outputTokens: number
  activeTabPath?: string | null
  activeTabLanguage?: string
  cursorLine?: number
  cursorColumn?: number
  projectPath?: string | null
  onOpenSettings?: () => void
}

function StatusBar({ 
  permissionMode, 
  inputTokens, 
  outputTokens,
  activeTabPath,
  activeTabLanguage,
  cursorLine,
  cursorColumn,
  projectPath,
  onOpenSettings
}: StatusBarProps) {
  const [gitBranch, setGitBranch] = useState<string>('')
  const [errorCount, setErrorCount] = useState(0)
  const [warningCount, setWarningCount] = useState(0)
  const [encoding, setEncoding] = useState('UTF-8')
  const [lineEnding, setLineEnding] = useState('LF')
  const [indentation, setIndentation] = useState('Spaces: 2')

  const totalTokens = inputTokens + outputTokens
  const costEstimate = (totalTokens * 0.003).toFixed(4)

  // Map permission mode to translation key
  const getPermissionLabel = (mode: string) => {
    switch (mode) {
      case 'read-only': return t('readOnlyMode')
      case 'workspace-write': return t('workspaceWriteMode')
      case 'danger-full-access': return t('fullAccessMode')
      default: return mode
    }
  }

  // Get file extension for language detection
  const getFileExtension = (path: string | null): string => {
    if (!path) return ''
    const parts = path.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : ''
  }

  // Update git branch info
  useEffect(() => {
    const fetchGitInfo = async () => {
      if (!projectPath) {
        setGitBranch('')
        return
      }

      try {
        // Simple branch detection using git
        // Use encodeURIComponent but decode slashes to prevent 404 errors
        const encodedPath = encodeURIComponent(projectPath).replace(/%2F/g, '/')
        const response = await fetch(`http://localhost:3847/api/git/branch?repoPath=${encodedPath}`)
        if (response.ok) {
          const data = await response.json()
          setGitBranch(data.branch || '')
        }
      } catch (error) {
        // Silently fail if git is not available
        console.debug('Git branch detection failed:', error)
      }
    }

    fetchGitInfo()
  }, [projectPath])

  return (
    <div className="status-bar">
      {/* Left section */}
      <div className="status-bar-left">
        {/* Permission mode */}
        <div className="status-bar-item" title="Permission Mode">
          <span>{getPermissionLabel(permissionMode)}</span>
        </div>

        {/* Git branch */}
        {gitBranch && (
          <div className="status-bar-item status-bar-item-clickable" title="Source Control">
            <GitBranch size={14} strokeWidth={1.5} />
            <span>{gitBranch}</span>
          </div>
        )}

        {/* Errors and warnings */}
        {errorCount > 0 && (
          <div className="status-bar-item status-bar-item-clickable" title={`${errorCount} errors`}>
            <AlertCircle size={14} strokeWidth={1.5} />
            <span>{errorCount}</span>
          </div>
        )}
        {warningCount > 0 && (
          <div className="status-bar-item status-bar-item-clickable" title={`${warningCount} warnings`}>
            <AlertTriangle size={14} strokeWidth={1.5} />
            <span>{warningCount}</span>
          </div>
        )}
      </div>

      {/* Right section */}
      <div className="status-bar-right">
        {/* Cost display - compact */}
        <div className="status-bar-item" title="Token Usage">
          <span>${costEstimate} · In: {inputTokens} · Out: {outputTokens}</span>
        </div>

        {/* Cursor position */}
        {activeTabPath && cursorLine !== undefined && (
          <div className="status-bar-item" title="Cursor Position">
            <span>Ln {cursorLine}, Col {cursorColumn || 1}</span>
          </div>
        )}

        {/* File language */}
        {activeTabPath && (
          <div className="status-bar-item status-bar-item-clickable" title="Language Mode">
            <span>{activeTabLanguage || getFileExtension(activeTabPath)}</span>
          </div>
        )}

        {/* Encoding */}
        {activeTabPath && (
          <div className="status-bar-item status-bar-item-clickable" title="Encoding">
            <span>{encoding}</span>
          </div>
        )}

        {/* Line ending */}
        {activeTabPath && (
          <div className="status-bar-item status-bar-item-clickable" title="Line Ending">
            <span>{lineEnding}</span>
          </div>
        )}

        {/* Indentation */}
        {activeTabPath && (
          <div className="status-bar-item status-bar-item-clickable" title="Indentation">
            <span>{indentation}</span>
          </div>
        )}

        {/* Notifications */}
        <div className="status-bar-item status-bar-item-clickable" title="Notifications">
          <Bell size={14} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  )
}

export default StatusBar
