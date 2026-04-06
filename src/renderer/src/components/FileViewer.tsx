import { useState, useEffect } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { t } from '../i18n'

interface FileViewerProps {
  filePath: string | null
  content: string
  onContentChange?: (content: string) => void
  isEditable?: boolean
}

function FileViewer({ filePath, content, onContentChange, isEditable = false }: FileViewerProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [isSaving, setIsSaving] = useState(false)

  const API_BASE = 'http://localhost:3847/api'

  useEffect(() => {
    setEditedContent(content)
  }, [content])

  const getLanguage = (path: string | null): string => {
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
      'html': 'html',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'rb': 'ruby',
      'php': 'php',
      'sql': 'sql',
      'dockerfile': 'docker',
    }
    return langMap[ext || ''] || 'text'
  }

  const handleSave = async () => {
    if (!filePath || !onContentChange) return

    try {
      setIsSaving(true)
      const res = await fetch(`${API_BASE}/fs/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: editedContent })
      })

      if (res.ok) {
        onContentChange(editedContent)
        setIsEditing(false)
      } else {
        alert(t('saveFailed') || 'Save failed')
      }
    } catch (error) {
      console.error('Failed to save file:', error)
      alert(t('saveFailed') || 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditedContent(content)
    setIsEditing(false)
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content)
      alert(t('copied') || 'Copied!')
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (!filePath) {
    return (
      <div className="file-viewer file-viewer-empty">
        <div className="file-viewer-placeholder">
          <div className="placeholder-icon">📄</div>
          <p>{t('selectFileToView') || 'Select a file to view'}</p>
        </div>
      </div>
    )
  }

  const fileName = filePath.split('/').pop() || filePath
  const language = getLanguage(filePath)
  const isImage = /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i.test(filePath)

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <div className="file-viewer-info">
          <span className="file-viewer-name">{fileName}</span>
          <span className="file-viewer-path">{filePath}</span>
        </div>
        <div className="file-viewer-actions">
          {isEditable && (
            <>
              {isEditing ? (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    {t('cancel') || 'Cancel'}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsEditing(true)}
                >
                  {t('edit') || 'Edit'}
                </button>
              )}
            </>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={copyToClipboard}
            title={t('copy') || 'Copy'}
          >
            {t('copy') || 'Copy'}
          </button>
        </div>
      </div>

      <div className="file-viewer-content">
        {isImage ? (
          <div className="file-viewer-image">
            <img src={`file://${filePath}`} alt={fileName} />
          </div>
        ) : isEditing ? (
          <textarea
            className="file-editor"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="file-viewer-code">
            <SyntaxHighlighter
              language={language}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '16px',
                fontSize: '13px',
                lineHeight: '1.6',
                minHeight: '100%',
              }}
              showLineNumbers={true}
              lineNumberStyle={{
                color: '#6e7681',
                fontSize: '12px',
                minWidth: '2.5em'
              }}
            >
              {content || ''}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  )
}

export default FileViewer
