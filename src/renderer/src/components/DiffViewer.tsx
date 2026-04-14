import { useState } from 'react'

interface DiffLine {
  type: 'add' | 'del' | 'unchanged'
  oldLineNum?: number
  newLineNum?: number
  content: string
}

interface DiffViewerProps {
  oldContent: string
  newContent: string
  oldPath?: string
  newPath?: string
}

export function DiffViewer({ oldContent, newContent, oldPath, newPath }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(true)

  // Simple diff algorithm
  const computeDiff = (): DiffLine[] => {
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const result: DiffLine[] = []
    
    let oldIdx = 0
    let newIdx = 0
    
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldLines[oldIdx]
      const newLine = newLines[newIdx]
      
      if (oldIdx >= oldLines.length) {
        // Only new lines remain
        result.push({
          type: 'add',
          newLineNum: newIdx + 1,
          content: newLine
        })
        newIdx++
      } else if (newIdx >= newLines.length) {
        // Only old lines remain
        result.push({
          type: 'del',
          oldLineNum: oldIdx + 1,
          content: oldLine
        })
        oldIdx++
      } else if (oldLine === newLine) {
        // Lines are identical
        result.push({
          type: 'unchanged',
          oldLineNum: oldIdx + 1,
          newLineNum: newIdx + 1,
          content: oldLine
        })
        oldIdx++
        newIdx++
      } else {
        // Lines differ - check if it's an addition or deletion
        // Simple heuristic: if next old line matches current new line, this is a deletion
        const nextOldMatch = oldLines[oldIdx + 1] === newLine
        const nextNewMatch = newLines[newIdx + 1] === oldLine
        
        if (nextOldMatch && !nextNewMatch) {
          // Deletion
          result.push({
            type: 'del',
            oldLineNum: oldIdx + 1,
            content: oldLine
          })
          oldIdx++
        } else if (nextNewMatch && !nextOldMatch) {
          // Addition
          result.push({
            type: 'add',
            newLineNum: newIdx + 1,
            content: newLine
          })
          newIdx++
        } else {
          // Replacement - treat as deletion then addition
          result.push({
            type: 'del',
            oldLineNum: oldIdx + 1,
            content: oldLine
          })
          result.push({
            type: 'add',
            newLineNum: newIdx + 1,
            content: newLine
          })
          oldIdx++
          newIdx++
        }
      }
    }
    
    return result
  }

  const diffLines = computeDiff()
  const addCount = diffLines.filter(l => l.type === 'add').length
  const delCount = diffLines.filter(l => l.type === 'del').length

  const getLineClass = (type: DiffLine['type']) => {
    switch (type) {
      case 'add':
        return 'diff-line-add'
      case 'del':
        return 'diff-line-del'
      default:
        return 'diff-line-unchanged'
    }
  }

  const getLineMarker = (type: DiffLine['type']) => {
    switch (type) {
      case 'add':
        return '+'
      case 'del':
        return '-'
      default:
        return ' '
    }
  }

  return (
    <div className="diff-container">
      <div className="diff-header">
        <span className="diff-title">
          {oldPath && newPath ? (
            oldPath === newPath ? oldPath : `${oldPath} → ${newPath}`
          ) : '代码变更'}
        </span>
        <div className="diff-stats">
          {addCount > 0 && (
            <span className="diff-stat-add">+{addCount}</span>
          )}
          {delCount > 0 && (
            <span className="diff-stat-del">-{delCount}</span>
          )}
          <button 
            className="collapse-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▼' : '▶'}
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="diff-content">
          {diffLines.map((line, idx) => (
            <div key={idx} className={`diff-line ${getLineClass(line.type)}`}>
              <span className="diff-line-num">
                {line.oldLineNum || ''}
              </span>
              <span className="diff-line-num">
                {line.newLineNum || ''}
              </span>
              <span className="diff-line-marker">
                {getLineMarker(line.type)}
              </span>
              <span className="diff-line-content">
                {line.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default DiffViewer
