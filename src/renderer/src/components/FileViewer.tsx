import { useState, useEffect, useCallback, useRef } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Tab } from './FileTabs'
import { t } from '../i18n'

interface FileViewerProps {
  tab: Tab | null
  onContentChange?: (tabId: string, content: string) => void
  onSave?: (tabId: string, content: string) => Promise<boolean>
}

// Auto-save delay in milliseconds
const AUTO_SAVE_DELAY = 1000

function FileViewer({ tab, onContentChange, onSave }: FileViewerProps) {
  const [editedContent, setEditedContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')

  // Reset content when tab changes
  useEffect(() => {
    if (tab) {
      setEditedContent(tab.content)
      lastSavedContentRef.current = tab.content
      setSaveStatus(tab.isDirty ? 'unsaved' : 'saved')
    }
  }, [tab?.id])

  // Update content when tab content changes externally
  useEffect(() => {
    if (tab && tab.content !== editedContent && tab.content !== lastSavedContentRef.current) {
      setEditedContent(tab.content)
      lastSavedContentRef.current = tab.content
      setSaveStatus(tab.isDirty ? 'unsaved' : 'saved')
    }
  }, [tab?.content])

  const getLanguage = useCallback((path: string | null): string => {
    if (!path) return 'text'
    const ext = path.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'tsx': 'tsx',
      'jsx': 'jsx',
      'py': 'python',
      'json': 'json',
      'md': 'markdown',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'html': 'html',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'c': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'hh': 'cpp',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'sql': 'sql',
      'dockerfile': 'docker',
      'vue': 'vue',
      'svelte': 'svelte',
      'astro': 'astro',
      'wasm': 'wasm',
    }
    return langMap[ext || ''] || 'text'
  }, [])

  // Perform save
  const performSave = useCallback(async (content: string) => {
    if (!tab || !onSave) return false

    try {
      setIsSaving(true)
      setSaveStatus('saving')
      const success = await onSave(tab.id, content)
      if (success) {
        onContentChange?.(tab.id, content)
        lastSavedContentRef.current = content
        setSaveStatus('saved')
        return true
      } else {
        setSaveStatus('unsaved')
        return false
      }
    } catch (error) {
      console.error('Failed to save file:', error)
      setSaveStatus('unsaved')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [tab, onSave, onContentChange])

  // Handle content change with auto-save
  const handleContentChange = useCallback((newContent: string) => {
    setEditedContent(newContent)
    setSaveStatus('unsaved')
    
    // Notify parent about content change (for dirty state)
    if (tab && onContentChange) {
      onContentChange(tab.id, newContent)
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Set new auto-save timer
    autoSaveTimerRef.current = setTimeout(() => {
      if (newContent !== lastSavedContentRef.current) {
        performSave(newContent)
      }
    }, AUTO_SAVE_DELAY)
  }, [tab, onContentChange, performSave])

  // Manual save handler
  const handleManualSave = useCallback(async () => {
    if (editedContent !== lastSavedContentRef.current) {
      await performSave(editedContent)
    }
  }, [editedContent, performSave])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [])

  // Keyboard shortcut for save (Ctrl/Cmd + S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleManualSave()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleManualSave])

  const copyToClipboard = async () => {
    if (!tab) return
    try {
      await navigator.clipboard.writeText(editedContent)
      alert(t('copied'))
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (!tab) {
    return (
      <div className="file-viewer file-viewer-empty">
        <div className="file-viewer-placeholder">
          <div className="placeholder-icon">📄</div>
          <p>{t('selectFileToView')}</p>
        </div>
      </div>
    )
  }

  const fileName = tab.name || tab.path.split('/').pop() || tab.path
  const language = getLanguage(tab.path)
  const isImage = /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i.test(tab.path)

  // Get save status display
  const getSaveStatusDisplay = () => {
    switch (saveStatus) {
      case 'saving':
        return <span className="save-status saving">{t('savingStatus')}</span>
      case 'unsaved':
        return <span className="save-status unsaved">{t('unsavedStatus')}</span>
      case 'saved':
        return <span className="save-status saved">{t('savedStatus')}</span>
    }
  }

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <div className="file-viewer-info">
          <span className="file-viewer-name">
            {fileName}
            {saveStatus === 'unsaved' && <span className="file-dirty-indicator">●</span>}
          </span>
          <span className="file-viewer-path">
            {tab.path}
            <span className="save-status-separator">•</span>
            {getSaveStatusDisplay()}
          </span>
        </div>
        <div className="file-viewer-actions">
          {!isImage && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleManualSave}
              disabled={isSaving || saveStatus === 'saved'}
            >
              {isSaving ? t('savingStatus') : t('save')}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={copyToClipboard}
            title={t('copy')}
          >
            {t('copy')}
          </button>
        </div>
      </div>

      <div className="file-viewer-content">
        {isImage ? (
          <div className="file-viewer-image">
            <img src={`file://${tab.path}`} alt={fileName} />
          </div>
        ) : (
          <textarea
            className="file-editor"
            value={editedContent}
            onChange={(e) => handleContentChange(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}

export default FileViewer
