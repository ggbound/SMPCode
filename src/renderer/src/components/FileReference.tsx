import { useState, useRef, useEffect } from 'react'
import { File, FileCode, Settings, Database, Globe } from 'lucide-react'
import { getLanguageFromPath, getLanguageLabel } from '../utils/languageMap'

interface FileReferenceProps {
  filePath: string
  onClick?: (path: string) => void
  onPreview?: (path: string) => Promise<string>
}

export function FileReference({ filePath, onClick, onPreview }: FileReferenceProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get file icon based on extension
  const getFileIconComponent = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'ts':
      case 'tsx':
        return <FileCode size={14} />
      case 'js':
      case 'jsx':
        return <FileCode size={14} />
      case 'json':
        return <FileCode size={14} />
      case 'css':
      case 'scss':
      case 'less':
        return <FileCode size={14} />
      case 'html':
        return <Globe size={14} />
      case 'md':
        return <FileCode size={14} />
      case 'py':
        return <FileCode size={14} />
      case 'java':
        return <FileCode size={14} />
      case 'go':
        return <FileCode size={14} />
      case 'rs':
        return <Settings size={14} />
      case 'c':
      case 'cpp':
      case 'h':
        return <FileCode size={14} />
      case 'sql':
        return <Database size={14} />
      case 'yml':
      case 'yaml':
        return <Settings size={14} />
      case 'dockerfile':
        return <FileCode size={14} />
      default:
        return <File size={14} />
    }
  }

  // Get file language for syntax highlighting (using unified language map)
  const getFileLanguage = (path: string) => {
    return getLanguageFromPath(path)
  }

  // Handle mouse enter for preview
  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(async () => {
      if (onPreview && !previewContent) {
        setLoading(true)
        try {
          const content = await onPreview(filePath)
          setPreviewContent(content)
        } catch (error) {
          console.error('Failed to load preview:', error)
        }
        setLoading(false)
      }
      setShowPreview(true)
    }, 500) // 500ms delay before showing preview
  }

  // Handle mouse leave
  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setShowPreview(false)
    }, 200)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleClick = () => {
    onClick?.(filePath)
  }

  // Format preview content (truncate if too long)
  const formatPreview = (content: string) => {
    const lines = content.split('\n')
    if (lines.length > 20) {
      return lines.slice(0, 20).join('\n') + '\n...'
    }
    return content
  }

  return (
    <span className="file-reference-wrapper">
      <span
        className="file-reference"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className="file-reference-icon">{getFileIconComponent(filePath)}</span>
        <span className="file-reference-text">@{filePath}</span>
      </span>
      
      {/* Preview tooltip */}
      {showPreview && (
        <div 
          className="file-reference-preview"
          onMouseEnter={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="file-preview-header">
            <span className="file-preview-icon">{getFileIconComponent(filePath)}</span>
            <span className="file-preview-path">{filePath}</span>
            <span className="file-preview-lang">{getFileLanguage(filePath)}</span>
          </div>
          <div className="file-preview-content">
            {loading ? (
              <div className="file-preview-loading">
                <span className="spinner-small" />
                加载中...
              </div>
            ) : previewContent ? (
              <pre className={`language-${getFileLanguage(filePath)}`}>
                <code>{formatPreview(previewContent)}</code>
              </pre>
            ) : (
              <div className="file-preview-empty">
                无法预览文件内容
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  )
}

export default FileReference
