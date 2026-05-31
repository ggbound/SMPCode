/**
 * DiffViewer - 文件差异对比视图组件
 * 显示文件修改前后的对比
 */

import React, { useState, useEffect, useCallback } from 'react'
import { X, FileCode, GitCommit, ChevronLeft, ChevronRight } from 'lucide-react'
import '../styles/vscode-sidebar.css'

interface DiffViewerProps {
  filePath: string
  commitHash?: string
  repoPath: string
  onClose: () => void
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ filePath, commitHash, repoPath, onClose }) => {
  const [diffContent, setDiffContent] = useState<string>('')
  const [parsedDiff, setParsedDiff] = useState<DiffLine[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [oldContent, setOldContent] = useState<string>('')
  const [newContent, setNewContent] = useState<string>('')
  const [commitFiles, setCommitFiles] = useState<Array<{path: string; status: string}>>([])

  const fileName = filePath.split('/').pop() || filePath

  // 解析 diff 内容
  const parseDiff = useCallback((diff: string): DiffLine[] => {
    const lines: DiffLine[] = []
    const diffLines = diff.split('\n')
    
    let oldLine = 0
    let newLine = 0
    let inHunk = false

    for (const line of diffLines) {
      // Diff header lines
      if (line.startsWith('diff --git') || line.startsWith('index ') || 
          line.startsWith('--- ') || line.startsWith('+++ ')) {
        lines.push({
          type: 'header',
          content: line
        })
        continue
      }

      // Hunk header @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1])
        newLine = parseInt(hunkMatch[2])
        inHunk = true
        lines.push({
          type: 'header',
          oldLineNumber: oldLine,
          newLineNumber: newLine,
          content: line
        })
        continue
      }

      if (!inHunk) {
        // Context line before hunk
        lines.push({
          type: 'context',
          content: line
        })
        continue
      }

      // Added line
      if (line.startsWith('+')) {
        lines.push({
          type: 'added',
          newLineNumber: newLine,
          content: line.substring(1)
        })
        newLine++
      }
      // Removed line
      else if (line.startsWith('-')) {
        lines.push({
          type: 'removed',
          oldLineNumber: oldLine,
          content: line.substring(1)
        })
        oldLine++
      }
      // Context line
      else {
        lines.push({
          type: 'context',
          oldLineNumber: oldLine,
          newLineNumber: newLine,
          content: line.startsWith(' ') ? line.substring(1) : line
        })
        oldLine++
        newLine++
      }
    }

    return lines
  }, [])

  // 加载 diff 内容
  useEffect(() => {
    const loadDiff = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        const api = (window as any).api
        const relativePath = filePath.replace(repoPath + '/', '')
        
        if (commitHash) {
          // 获取提交详情（包含文件列表）
          const commitDetails = await api?.gitCommitDetails?.(repoPath, commitHash)
          if (commitDetails?.files) {
            // 构建文件列表显示
            const filesList = commitDetails.files.map((f: string) => ({
              path: f,
              status: 'modified' as const
            }))
            setCommitFiles(filesList)
          }
          
          // 获取提交中的文件 diff（该提交与父提交的对比）
          const diffResult = await api?.gitCommitDiff?.(repoPath, relativePath, commitHash)
          if (diffResult) {
            setDiffContent(diffResult)
            setParsedDiff(parseDiff(diffResult))
          }
        } else {
          // 获取工作区 diff
          const result = await api?.gitDiff?.(repoPath, relativePath, false)
          if (result) {
            setDiffContent(result)
            setParsedDiff(parseDiff(result))
          }
        }
      } catch (err) {
        console.error('Failed to load diff:', err)
        setError('加载差异失败')
      } finally {
        setIsLoading(false)
      }
    }

    if (filePath && repoPath) {
      loadDiff()
    }
  }, [filePath, commitHash, repoPath, parseDiff])

  // 渲染 diff 行
  const renderDiffLine = (line: DiffLine, index: number) => {
    const oldNum = line.oldLineNumber !== undefined ? line.oldLineNumber.toString() : ''
    const newNum = line.newLineNumber !== undefined ? line.newLineNumber.toString() : ''
    
    return (
      <div key={index} className={`vscode-diff-line ${line.type}`}>
        <div className="vscode-diff-line-number old">{oldNum}</div>
        <div className="vscode-diff-line-number new">{newNum}</div>
        <div className="vscode-diff-line-content">{line.content}</div>
      </div>
    )
  }

  // 简化的 diff 渲染 - 使用 Monaco Editor 的 diff 模式
  return (
    <div className="vscode-diff-viewer">
      <div className="vscode-diff-header">
        <div className="vscode-diff-header-left">
          <FileCode size={16} style={{ color: '#58a6ff' }} />
          <span className="vscode-diff-title">{fileName}</span>
          {commitHash && (
            <span className="vscode-diff-subtitle">
              <GitCommit size={12} />
              {commitHash.substring(0, 7)}
            </span>
          )}
        </div>
      </div>
      
      <div className="vscode-diff-content">
        {isLoading ? (
          <div className="vscode-diff-empty">加载中...</div>
        ) : error ? (
          <div className="vscode-diff-empty" style={{ color: '#f85149' }}>{error}</div>
        ) : parsedDiff.length === 0 ? (
          <div className="vscode-diff-empty">无差异</div>
        ) : (
          <div className="vscode-diff-lines">
            {parsedDiff.map((line, index) => renderDiffLine(line, index))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DiffViewer
