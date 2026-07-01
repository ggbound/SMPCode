/**
 * DiffPreview - 文件差异预览组件
 * 在编辑器中显示 diff 预览，支持应用/取消
 */

import React, { useState } from 'react'
import { GitCompare, Check, X, ChevronDown, ChevronUp } from 'lucide-react'

interface DiffLine {
  type: 'context' | 'addition' | 'deletion'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
}

interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

interface FileDiff {
  path: string
  oldContent: string
  newContent: string
  hunks: DiffHunk[]
  stats: {
    additions: number
    deletions: number
    changes: number
  }
}

interface DiffPreviewProps {
  diff: FileDiff
  pendingEditId: string
  onApply: () => Promise<void>
  onCancel: () => Promise<void>
  onClose: () => void
}

export const DiffPreview: React.FC<DiffPreviewProps> = ({
  diff,
  pendingEditId,
  onApply,
  onCancel,
  onClose
}) => {
  const [isApplying, setIsApplying] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleApply = async () => {
    setIsApplying(true)
    setError(null)
    try {
      await onApply()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用失败')
    } finally {
      setIsApplying(false)
    }
  }

  const handleCancel = async () => {
    try {
      await onCancel()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败')
    }
  }

  return (
    <div className="diff-preview-container" style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: '#1e1e1e',
      borderTop: '2px solid #333',
      zIndex: 100,
      maxHeight: isExpanded ? '50%' : '48px',
      transition: 'max-height 0.3s ease'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: '#252526',
        borderBottom: isExpanded ? '1px solid #333' : 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <GitCompare size={18} />
          <span style={{ fontWeight: 500 }}>{diff.path}</span>
          <span style={{ 
            fontSize: '12px',
            color: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.2)',
            padding: '2px 8px',
            borderRadius: '4px'
          }}>
            +{diff.stats.additions}
          </span>
          <span style={{ 
            fontSize: '12px',
            color: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            padding: '2px 8px',
            borderRadius: '4px'
          }}>
            -{diff.stats.deletions}
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: 'none',
              border: 'none',
              color: '#999',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            {isExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
          
          {isExpanded && (
            <>
              <button
                onClick={handleCancel}
                disabled={isApplying}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  backgroundColor: '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                <X size={16} />
                取消
              </button>
              <button
                onClick={handleApply}
                disabled={isApplying}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  backgroundColor: '#22c55e',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                <Check size={16} />
                {isApplying ? '应用中...' : '应用更改'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '10px 16px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {/* Diff Content */}
      {isExpanded && (
        <div style={{
          maxHeight: '400px',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: '1.5'
        }}>
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              {/* Hunk header */}
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#2d2d2d',
                color: '#666',
                fontSize: '12px',
                borderBottom: '1px solid #333'
              }}>
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              
              {/* Hunk lines */}
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  style={{
                    display: 'flex',
                    padding: '4px 16px',
                    backgroundColor: line.type === 'addition' ? 'rgba(34, 197, 94, 0.1)' :
                                    line.type === 'deletion' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                    borderLeft: line.type === 'addition' ? '3px solid #22c55e' :
                                line.type === 'deletion' ? '3px solid #ef4444' : '3px solid transparent'
                  }}
                >
                  {/* Line numbers */}
                  <div style={{
                    display: 'flex',
                    width: '80px',
                    color: '#666',
                    fontSize: '12px'
                  }}>
                    <span style={{ width: '40px', textAlign: 'right', paddingRight: '8px' }}>
                      {line.oldLineNumber || ''}
                    </span>
                    <span style={{ width: '40px', textAlign: 'right', paddingRight: '8px' }}>
                      {line.newLineNumber || ''}
                    </span>
                  </div>
                  
                  {/* Content */}
                  <div style={{
                    flex: 1,
                    color: line.type === 'addition' ? '#22c55e' :
                           line.type === 'deletion' ? '#ef4444' : '#e2e8f0',
                    whiteSpace: 'pre'
                  }}>
                    {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                    {line.content}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default DiffPreview
