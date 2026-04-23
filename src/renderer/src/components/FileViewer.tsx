import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tab } from './FileTabs'
import { t } from '../i18n'
import { useCodeCompletion } from '../hooks/useCodeCompletion'
import { useCodeIntelligence } from '../hooks/useCodeIntelligence'
import { CodeCompletion } from './CodeCompletion'
import { InlineEdit } from './InlineEdit'
import MonacoEditor from './MonacoEditor'
import Breadcrumbs from './Breadcrumbs'
import { File } from 'lucide-react'

interface FileViewerProps {
  tab: Tab | null
  onContentChange?: (tabId: string, content: string) => void
  onSave?: (tabId: string, content: string) => Promise<boolean>
  onExplainCode?: (code: string, language: string) => void
  rootPath?: string
  onCursorPositionChange?: (position: { line: number; column: number }) => void
  onEditorMount?: (editor: any) => void
}

// Auto-save delay in milliseconds
const AUTO_SAVE_DELAY = 1000

function FileViewer({ tab, onContentChange, onSave, onExplainCode, rootPath, onCursorPositionChange, onEditorMount }: FileViewerProps) {
  const [editedContent, setEditedContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const editorRef = useRef<HTMLDivElement>(null)
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 })
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const [showInlineEdit, setShowInlineEdit] = useState(false)
  const [inlineEditCode, setInlineEditCode] = useState('')

  // VS Code Copilot integration hooks
  const {
    isLoading: completionLoading,
    completions,
    activeIndex,
    visible: completionVisible,
    triggerCompletion,
    acceptCompletion,
    rejectCompletion,
    nextCompletion,
    prevCompletion,
    getActiveCompletion
  } = useCodeCompletion()

  const {
    explanation,
    refactoring,
    inlineEdit,
    explainCode,
    refactorCode,
    getInlineEdit,
    clearResults
  } = useCodeIntelligence()

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

  // Language is now handled by MonacoEditor internally

  const language = useMemo(() => {
    if (!tab?.path) return 'text'
    const ext = tab.path.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = {
      'js': 'javascript', 'ts': 'typescript', 'tsx': 'tsx', 'jsx': 'jsx',
      'py': 'python', 'json': 'json', 'md': 'markdown', 'css': 'css',
      'scss': 'scss', 'html': 'html', 'xml': 'xml', 'yaml': 'yaml',
      'yml': 'yaml', 'sh': 'bash', 'bash': 'bash', 'rs': 'rust',
      'go': 'go', 'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
      'hpp': 'cpp', 'rb': 'ruby', 'php': 'php', 'sql': 'sql'
    }
    return langMap[ext] || 'text'
  }, [tab?.path])

  // Handle editor selection change for Monaco
  const handleEditorSelectionChange = useCallback((selection: any) => {
    if (selection && selection.startLineNumber && selection.endLineNumber) {
      setSelectionRange({
        start: selection.startLineNumber,
        end: selection.endLineNumber
      })
      // Get selected text
      if (selection.startLineNumber !== selection.endLineNumber || 
          selection.startColumn !== selection.endColumn) {
        // Calculate selected text - would need editor instance
        setInlineEditCode('')
      }
    } else {
      setSelectionRange(null)
    }
  }, [])

  // Handle editor cursor activity for completions
  const handleEditorCursorChange = useCallback((position: any) => {
    // Update cursor position for UI
    setCursorPosition({ x: position.column, y: position.lineNumber })
  }, [])

  // Handle code explanation
  const handleExplainCode = useCallback(async () => {
    if (!tab || !selectionRange) return
    const code = inlineEditCode
    await explainCode(code, language, tab.path, selectionRange)
  }, [tab, language, selectionRange, inlineEditCode, explainCode])

  // Handle inline edit trigger
  const handleInlineEdit = useCallback(async (instruction: string) => {
    if (!tab || !selectionRange) return
    await getInlineEdit(inlineEditCode, instruction, language, tab.path, selectionRange)
    setShowInlineEdit(true)
  }, [tab, language, selectionRange, inlineEditCode, getInlineEdit])

  // Handle inline edit accept
  const handleInlineEditAccept = useCallback(() => {
    if (inlineEdit?.editedCode) {
      handleContentChange(inlineEdit.editedCode)
    }
    setShowInlineEdit(false)
    clearResults()
  }, [inlineEdit, handleContentChange, clearResults])

  // Handle inline edit reject
  const handleInlineEditReject = useCallback(() => {
    setShowInlineEdit(false)
    clearResults()
  }, [clearResults])

  // Handle completion accept
  const handleCompletionAccept = useCallback((index?: number) => {
    const completion = acceptCompletion(index)
    if (completion) {
      // Insert completion at cursor position
      // This would need to be integrated with the editor instance
      console.log('Accepted completion:', completion)
    }
  }, [acceptCompletion])

  // Handle completion reject
  const handleCompletionReject = useCallback(() => {
    rejectCompletion()
  }, [rejectCompletion])

  if (!tab) {
    return (
      <div className="file-viewer file-viewer-empty">
        <div className="file-viewer-placeholder">
          <div className="placeholder-icon"><File size={48} /></div>
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
      {/* Breadcrumbs navigation */}
      {tab && rootPath && (
        <Breadcrumbs
          filePath={tab.path}
          rootPath={rootPath}
          onPathClick={(path) => {
            // Dispatch event to highlight path in file tree
            window.dispatchEvent(new CustomEvent('highlight-path', { detail: { path } }))
          }}
        />
      )}
      
      <div className="file-viewer-content">
        {isImage ? (
          <div className="file-viewer-image">
            <img src={`file://${tab.path}`} alt={fileName} />
          </div>
        ) : (
          <div className="code-editor-container" ref={editorRef} style={{ position: 'relative' }}>
            <MonacoEditor
              value={editedContent}
              language={language}
              onChange={(value) => handleContentChange(value)}
              onSave={handleManualSave}
              onCursorPositionChange={onCursorPositionChange}
              onMount={onEditorMount}
            />

            {/* Copilot Code Completion Overlay */}
            <CodeCompletion
              visible={completionVisible}
              completions={completions}
              activeIndex={activeIndex}
              cursorPosition={cursorPosition}
              ghostText={getActiveCompletion()}
              onAccept={handleCompletionAccept}
              onReject={handleCompletionReject}
              onNext={nextCompletion}
              onPrev={prevCompletion}
            />
          </div>
        )}
      </div>

      {/* Inline Edit Modal */}
      <InlineEdit
        visible={showInlineEdit}
        originalCode={inlineEditCode}
        editedCode={inlineEdit?.editedCode || ''}
        explanation={inlineEdit?.explanation || ''}
        diff={inlineEdit?.diff || ''}
        loading={inlineEdit?.loading || false}
        error={inlineEdit?.error}
        onAccept={handleInlineEditAccept}
        onReject={handleInlineEditReject}
        onModify={(newCode) => {
          handleContentChange(newCode)
          setShowInlineEdit(false)
          clearResults()
        }}
        language={language}
      />
    </div>
  )
}

export default FileViewer
