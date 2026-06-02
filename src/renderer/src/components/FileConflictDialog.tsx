/**
 * File Conflict Dialog - VSCode-style 文件冲突处理对话框
 * 当外部修改（AI 操作等）与本地编辑冲突时显示
 */

import { useState } from 'react'
import { AlertTriangle, FileText, Clock, Check, X } from 'lucide-react'
import '../styles/fileConflictDialog.css'

interface FileConflictDialogProps {
  isOpen: boolean
  filePath: string
  fileName: string
  diskContent: string      // 磁盘上的内容（外部修改）
  editedContent: string    // 本地编辑的内容
  onResolve: (strategy: 'keep-local' | 'use-external' | 'merge') => void
  onClose: () => void
}

export function FileConflictDialog({
  isOpen,
  filePath,
  fileName,
  diskContent,
  editedContent,
  onResolve,
  onClose
}: FileConflictDialogProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<'keep-local' | 'use-external' | 'merge'>('keep-local')
  const [isComparing, setIsComparing] = useState(false)

  // 计算差异统计
  const getDiffStats = () => {
    const diskLines = diskContent.split('\n').length
    const editedLines = editedContent.split('\n').length
    const diskChars = diskContent.length
    const editedChars = editedContent.length
    
    return {
      diskLines,
      editedLines,
      diskChars,
      editedChars,
      lineDiff: editedLines - diskLines,
      charDiff: editedChars - diskChars
    }
  }

  const stats = getDiffStats()

  // 获取内容预览（前 10 行）
  const getContentPreview = (content: string, maxLines: number = 10) => {
    const lines = content.split('\n')
    const preview = lines.slice(0, maxLines).join('\n')
    const hasMore = lines.length > maxLines
    return { preview, hasMore, totalLines: lines.length }
  }

  const diskPreview = getContentPreview(diskContent)
  const editedPreview = getContentPreview(editedContent)

  if (!isOpen) return null

  return (
    <div className="conflict-dialog-overlay" onClick={onClose}>
      <div className="conflict-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="conflict-dialog-header">
          <div className="conflict-dialog-icon">
            <AlertTriangle size={24} />
          </div>
          <div className="conflict-dialog-title">
            <h3>文件内容冲突</h3>
            <p className="conflict-dialog-subtitle">
              此文件在磁盘上已被修改，与您当前编辑的内容冲突
            </p>
          </div>
        </div>

        {/* File Info */}
        <div className="conflict-dialog-file-info">
          <FileText size={16} />
          <span className="file-path">{filePath}</span>
        </div>

        {/* Content Comparison */}
        <div className="conflict-dialog-comparison">
          {/* Disk Version */}
          <div className="conflict-version">
            <div className="version-header">
              <Clock size={14} />
              <span>磁盘版本 (外部修改)</span>
              <span className="version-stats">
                {stats.diskLines} 行, {stats.diskChars} 字符
              </span>
            </div>
            <div className="version-content">
              <pre>{diskPreview.preview}</pre>
              {diskPreview.hasMore && (
                <div className="version-more">... {diskPreview.totalLines - 10} 更多行</div>
              )}
            </div>
          </div>

          {/* Edited Version */}
          <div className="conflict-version">
            <div className="version-header">
              <FileText size={14} />
              <span>编辑版本 (本地修改)</span>
              <span className="version-stats">
                {stats.editedLines} 行, {stats.editedChars} 字符
              </span>
            </div>
            <div className="version-content">
              <pre>{editedPreview.preview}</pre>
              {editedPreview.hasMore && (
                <div className="version-more">... {editedPreview.totalLines - 10} 更多行</div>
              )}
            </div>
          </div>
        </div>

        {/* Resolution Options */}
        <div className="conflict-dialog-options">
          <h4>解决冲突</h4>
          
          <div className="option-list">
            {/* Keep Local */}
            <div 
              className={`option-item ${selectedStrategy === 'keep-local' ? 'selected' : ''}`}
              onClick={() => setSelectedStrategy('keep-local')}
            >
              <div className="option-radio">
                {selectedStrategy === 'keep-local' ? <Check size={16} /> : <div className="radio-circle" />}
              </div>
              <div className="option-content">
                <div className="option-title">
                  保留本地更改
                </div>
                <div className="option-description">
                  使用您编辑的内容覆盖磁盘上的文件
                </div>
              </div>
            </div>

            {/* Use External */}
            <div 
              className={`option-item ${selectedStrategy === 'use-external' ? 'selected' : ''}`}
              onClick={() => setSelectedStrategy('use-external')}
            >
              <div className="option-radio">
                {selectedStrategy === 'use-external' ? <Check size={16} /> : <div className="radio-circle" />}
              </div>
              <div className="option-content">
                <div className="option-title">
                  使用外部更改
                </div>
                <div className="option-description">
                  放弃本地编辑，使用磁盘上的版本
                </div>
              </div>
            </div>

            {/* Merge (if applicable) */}
            <div 
              className={`option-item ${selectedStrategy === 'merge' ? 'selected' : ''} ${isComparing ? 'disabled' : ''}`}
              onClick={() => !isComparing && setSelectedStrategy('merge')}
            >
              <div className="option-radio">
                {selectedStrategy === 'merge' ? <Check size={16} /> : <div className="radio-circle" />}
              </div>
              <div className="option-content">
                <div className="option-title">
                  合并更改
                </div>
                <div className="option-description">
                  尝试自动合并本地和外部更改（可能不完美）
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="conflict-dialog-actions">
          <button 
            className="conflict-btn conflict-btn-secondary"
            onClick={onClose}
          >
            <X size={16} />
            取消
          </button>
          <button 
            className="conflict-btn conflict-btn-primary"
            onClick={() => onResolve(selectedStrategy)}
          >
            <Check size={16} />
            应用
          </button>
        </div>
      </div>
    </div>
  )
}

export default FileConflictDialog
