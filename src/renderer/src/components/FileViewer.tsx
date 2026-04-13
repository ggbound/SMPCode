import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { vue } from '@codemirror/lang-vue'
import type { Tab } from './FileTabs'
import { t } from '../i18n'

interface FileViewerProps {
  tab: Tab | null
  onContentChange?: (tabId: string, content: string) => void
  onSave?: (tabId: string, content: string) => Promise<boolean>
}

// Auto-save delay in milliseconds
const AUTO_SAVE_DELAY = 1000

// Get language extension based on file path
function getLanguageExtension(path: string | null) {
  if (!path) return null
  const ext = path.split('.').pop()?.toLowerCase()
  
  switch (ext) {
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return javascript({ jsx: ext === 'jsx' || ext === 'tsx', typescript: ext === 'ts' || ext === 'tsx' })
    case 'html':
    case 'htm':
      return html()
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return css()
    case 'json':
      return json()
    case 'md':
    case 'markdown':
      return markdown()
    case 'py':
    case 'python':
      return python()
    case 'vue':
      return vue()
    default:
      return null
  }
}

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

  // Get language extension
  const extensions = useMemo(() => {
    const ext = getLanguageExtension(tab?.path || null)
    return ext ? [ext] : []
  }, [tab?.path])

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
          <div className="code-editor-container">
            <CodeMirror
              value={editedContent}
              height="100%"
              theme={vscodeDark}
              extensions={extensions}
              onChange={(value) => handleContentChange(value)}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                foldGutter: false,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                highlightSelectionMatches: true,
                tabSize: 2,
              }}
              style={{
                height: '100%',
                fontSize: '13px',
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default FileViewer
