import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Tab } from './FileTabs'
import { t } from '../i18n'
import MonacoEditor from './MonacoEditor'
import Breadcrumbs from './Breadcrumbs'
import DiffPreview from './DiffPreview'
import InlineAI from './InlineAI'
import { File } from 'lucide-react'
// import { useYjsDoc } from '../hooks/useYjsDoc'

interface FileViewerProps {
  tab: Tab | null
  onContentChange?: (tabId: string, content: string) => void
  onSave?: (tabId: string, content: string) => Promise<boolean>
  onExplainCode?: (code: string, language: string) => void
  rootPath?: string
  onCursorPositionChange?: (position: { line: number; column: number }) => void
  onEditorMount?: (editor: any) => void
}

// Diff 数据类型
interface DiffData {
  path: string
  oldContent: string
  newContent: string
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: Array<{
      type: 'context' | 'addition' | 'deletion'
      oldLineNumber?: number
      newLineNumber?: number
      content: string
    }>
  }>
  stats: {
    additions: number
    deletions: number
    changes: number
  }
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
  
  // 使用 ref 保存最新的 editedContent，用于保存快捷键
  const editedContentRef = useRef('')
  
  // 🔥 AI 功能状态
  const [showDiff, setShowDiff] = useState(false)
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)
  const [showInlineAI, setShowInlineAI] = useState(false)
  const [selectedCode, setSelectedCode] = useState('')
  const [selectionRange, setSelectionRange] = useState<{ startLine: number; endLine: number } | null>(null)



  // Reset content when tab changes
  useEffect(() => {
    if (tab) {
      setEditedContent(tab.content)
      editedContentRef.current = tab.content
      lastSavedContentRef.current = tab.content
      setSaveStatus(tab.isDirty ? 'unsaved' : 'saved')
      
    } else {
      // Reset when tab is closed
      setEditedContent('')
      editedContentRef.current = ''
      lastSavedContentRef.current = ''
      setSaveStatus('saved')
    }
  }, [tab?.id])

  // Listen for external file content changes from AI operations via IPC
  useEffect(() => {
    if (!window.api) return

    const handleExternalChange = (_event: unknown, data: { filePath: string; content: string }) => {
      if (!tab || tab.path !== data.filePath) return

      // Only update if content is actually different
      if (data.content !== editedContent) {
        setEditedContent(data.content)
        editedContentRef.current = data.content
        lastSavedContentRef.current = data.content
        setSaveStatus('saved')

        // Flash the editor to indicate external update
        const editorContainer = document.querySelector('.file-viewer')
        if (editorContainer) {
          editorContainer.classList.add('external-update-flash')
          setTimeout(() => {
            editorContainer.classList.remove('external-update-flash')
          }, 300)
        }
      }
    }

    const unsubscribe = window.api.onFileContentChanged(handleExternalChange)
    return () => {
      unsubscribe()
    }
  }, [tab?.path, editedContent])

  // Update content when tab content changes externally (e.g., AI operations)
  // Only update if the content change is from external source (AI), not from user editing
  // User editing updates are handled via onContentChange callback
  useEffect(() => {
    if (!tab) return
    
    // Only update if:
    // 1. Content is different from current edited content
    // 2. Tab is NOT dirty (dirty means user has unsaved changes)
    // 3. OR the content is significantly different (indicating external change, not user edit)
    if (tab.content !== editedContent && !tab.isDirty) {
      
      // Update edited content to match external content
      setEditedContent(tab.content)
      editedContentRef.current = tab.content
      lastSavedContentRef.current = tab.content
      setSaveStatus('saved')
    }
  }, [tab?.content, tab?.lastModified, tab?.id, tab?.isDirty])

  // Perform save
  const performSave = useCallback(async (content: string) => {
    if (!tab || !onSave) return false

    try {
      setIsSaving(true)
      setSaveStatus('saving')
      const success = await onSave(tab.id, content)
      if (success) {
        // 保存成功后更新本地状态，但不调用 onContentChange
        // 因为 onContentChange 会将 tab 标记为 dirty
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
    editedContentRef.current = newContent
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

  // Manual save handler - 使用 ref 避免依赖变化导致 MonacoEditor 重新绑定快捷键
  const handleManualSave = useCallback(async () => {
    const currentContent = editedContentRef.current
    if (currentContent !== lastSavedContentRef.current) {
      await performSave(currentContent)
    }
  }, [performSave])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [])

  // 快捷键由 MonacoEditor 处理，不在此处重复监听

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
    
    // 完整的语言映射表
    const langMap: Record<string, string> = {
      // JavaScript/TypeScript
      'js': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      
      // Web
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'less': 'less',
      'vue': 'vue',
      'svelte': 'html',
      
      // Data formats
      'json': 'json',
      'jsonc': 'json',
      'xml': 'xml',
      'svg': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'ini',
      'ini': 'ini',
      
      // Documentation
      'md': 'markdown',
      'markdown': 'markdown',
      
      // Python
      'py': 'python',
      'pyw': 'python',
      
      // Java
      'java': 'java',
      
      // C/C++
      'c': 'c',
      'cpp': 'cpp',
      'cxx': 'cpp',
      'cc': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      
      // C#
      'cs': 'csharp',
      
      // Go
      'go': 'go',
      
      // Rust
      'rs': 'rust',
      
      // Ruby
      'rb': 'ruby',
      
      // PHP
      'php': 'php',
      'phtml': 'php',
      
      // Shell
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      
      // SQL
      'sql': 'sql',
      
      // Other
      'lua': 'lua',
      'r': 'r',
      'perl': 'perl',
      'pl': 'perl',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'dart': 'dart',
      'graphql': 'graphql',
      'gql': 'graphql',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'cmake': 'cmake'
    }
    
    const mappedLang = langMap[ext]
    
    // 如果没有扩展名，基于文件名和内容检测
    if (!mappedLang && !ext) {
      const fileName = tab.path.split('/').pop() || ''
      
      // 检查常见脚本文件名
      if (fileName === 'rake' || fileName === 'gemfile') {
        return 'ruby'
      }
      
      // 对于artisan等文件，检查内容中的shebang
      if (editedContent) {
        const firstLine = editedContent.split('\n')[0]?.trim() || ''
        
        // Shebang检测
        if (firstLine.startsWith('#!')) {
          if (firstLine.includes('php')) return 'php'
          if (firstLine.includes('python')) return 'python'
          if (firstLine.includes('ruby')) return 'ruby'
          if (firstLine.includes('perl')) return 'perl'
          if (firstLine.includes('node')) return 'javascript'
          if (firstLine.includes('bash') || firstLine.includes('sh')) return 'shell'
        }
        
        // 内容特征检测（如果没有shebang）
        if (fileName === 'artisan' || firstLine.includes('<?php')) {
          return 'php'
        }
      }
    }
    
    return mappedLang || 'text'
  }, [tab?.path, editedContent])

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

  // 处理编辑器选择变化
  const handleEditorSelectionChange = useCallback((selection: string, startLine: number, endLine: number) => {
    setSelectedCode(selection)
    setSelectionRange({ startLine, endLine })
  }, [])

  // 监听 diff 预览事件
  useEffect(() => {
    const handleDiffPreview = (e: CustomEvent<{ diff: DiffData; pendingEditId: string }>) => {
      setDiffData(e.detail.diff)
      setPendingEditId(e.detail.pendingEditId)
      setShowDiff(true)
    }
    
    window.addEventListener('diff-preview', handleDiffPreview as EventListener)
    return () => window.removeEventListener('diff-preview', handleDiffPreview as EventListener)
  }, [])

  // 应用 diff
  const handleApplyDiff = async () => {
    if (!pendingEditId || !rootPath || !window.api?.diff) return
    try {
      const result = await window.api.diff.applyEdit(pendingEditId, rootPath)
      if (result.success) {
        setShowDiff(false)
        setDiffData(null)
        setPendingEditId(null)
      }
    } catch (error) {
      console.error('Failed to apply diff:', error)
    }
  }

  // 取消 diff
  const handleCancelDiff = async () => {
    if (!pendingEditId || !window.api?.diff) return
    try {
      await window.api.diff.cancelEdit(pendingEditId)
      setShowDiff(false)
      setDiffData(null)
      setPendingEditId(null)
    } catch (error) {
      console.error('Failed to cancel diff:', error)
    }
  }

  return (
    <div className="file-viewer">
      {/* 🔥 工具栏 */}
      {tab && rootPath && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#252526',
          borderBottom: '1px solid #333'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Breadcrumbs
              filePath={tab.path}
              rootPath={rootPath}
              onPathClick={(path) => {
                window.dispatchEvent(new CustomEvent('highlight-path', { detail: { path } }))
              }}
            />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* 保存状态 */}
            {getSaveStatusDisplay()}
          </div>
        </div>
      )}
      
      <div className="file-viewer-content" style={{ position: 'relative' }}>
        {isImage ? (
          <div className="file-viewer-image">
            <img src={`file://${tab.path}`} alt={fileName} />
          </div>
        ) : (
          <div className="code-editor-container" ref={editorRef}>
            <MonacoEditor
              value={editedContent}
              language={language}
              onChange={(value) => handleContentChange(value)}
              onSave={handleManualSave}
              onCursorPositionChange={onCursorPositionChange}
              onMount={onEditorMount}
              onSelectionChange={handleEditorSelectionChange}
              rootPath={rootPath}
              filePath={tab.path}
            />
          </div>
        )}
        
        {/* 🔥 Diff 预览 */}
        {showDiff && diffData && (
          <DiffPreview
            diff={diffData}
            pendingEditId={pendingEditId || ''}
            onApply={handleApplyDiff}
            onCancel={handleCancelDiff}
            onClose={() => setShowDiff(false)}
          />
        )}
      </div>

      {/* 🔥 Inline AI 对话框 */}
      {showInlineAI && selectedCode && selectionRange && tab && rootPath && (
        <InlineAI
          projectPath={rootPath}
          filePath={tab.path}
          selectedCode={selectedCode}
          startLine={selectionRange.startLine}
          endLine={selectionRange.endLine}
          language={language}
          onClose={() => setShowInlineAI(false)}
          onApply={(newCode) => {
            // 应用 AI 建议的代码
            const lines = editedContent.split('\n')
            const newLines = [
              ...lines.slice(0, selectionRange.startLine - 1),
              newCode,
              ...lines.slice(selectionRange.endLine)
            ]
            const newContent = newLines.join('\n')
            handleContentChange(newContent)
            setShowInlineAI(false)
          }}
        />
      )}
    </div>
  )
}

export default FileViewer
