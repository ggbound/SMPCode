import { useState, useCallback } from 'react'

interface InlineEditProps {
  visible: boolean
  originalCode: string
  editedCode: string
  explanation: string
  diff: string
  loading: boolean
  error?: string
  onAccept: () => void
  onReject: () => void
  onModify: (newCode: string) => void
  language?: string
}

/**
 * InlineEdit Component
 * Shows AI-suggested code edits with diff view and accept/reject options
 */
export function InlineEdit({
  visible,
  originalCode,
  editedCode,
  explanation,
  diff,
  loading,
  error,
  onAccept,
  onReject,
  onModify,
  language = 'typescript'
}: InlineEditProps) {
  const [showDiff, setShowDiff] = useState(true)
  const [editedLocally, setEditedLocally] = useState(editedCode)
  const [hasBeenModified, setHasBeenModified] = useState(false)

  // Update local state when editedCode changes
  if (editedCode !== editedLocally && !hasBeenModified) {
    setEditedLocally(editedCode)
  }

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedLocally(e.target.value)
    setHasBeenModified(true)
  }, [])

  const handleAccept = useCallback(() => {
    if (hasBeenModified) {
      onModify(editedLocally)
    } else {
      onAccept()
    }
  }, [hasBeenModified, editedLocally, onAccept, onModify])

  if (!visible) {
    return null
  }

  // Generate simple diff visualization
  const generateDiffLines = () => {
    const originalLines = originalCode.split('\n')
    const editedLines = editedLocally.split('\n')
    const diffLines: Array<{ type: 'unchanged' | 'added' | 'removed'; content: string; lineNum: number }> = []

    let origIdx = 0
    let editIdx = 0

    while (origIdx < originalLines.length || editIdx < editedLines.length) {
      if (origIdx >= originalLines.length) {
        // Only additions left
        diffLines.push({
          type: 'added',
          content: editedLines[editIdx],
          lineNum: editIdx + 1
        })
        editIdx++
      } else if (editIdx >= editedLines.length) {
        // Only removals left
        diffLines.push({
          type: 'removed',
          content: originalLines[origIdx],
          lineNum: origIdx + 1
        })
        origIdx++
      } else if (originalLines[origIdx] === editedLines[editIdx]) {
        // Unchanged
        diffLines.push({
          type: 'unchanged',
          content: originalLines[origIdx],
          lineNum: origIdx + 1
        })
        origIdx++
        editIdx++
      } else {
        // Changed - show as removal then addition
        diffLines.push({
          type: 'removed',
          content: originalLines[origIdx],
          lineNum: origIdx + 1
        })
        diffLines.push({
          type: 'added',
          content: editedLines[editIdx],
          lineNum: editIdx + 1
        })
        origIdx++
        editIdx++
      }
    }

    return diffLines
  }

  return (
    <div
      className="inline-edit-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
    >
      <div
        className="inline-edit-modal"
        style={{
          backgroundColor: 'var(--bg-primary, #1e1e1e)',
          border: '1px solid var(--border-color, #444)',
          borderRadius: '8px',
          width: '90%',
          maxWidth: '900px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, #444)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              AI Suggested Edit
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowDiff(!showDiff)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                border: '1px solid var(--border-color, #444)',
                borderRadius: '4px',
                backgroundColor: showDiff ? 'var(--accent-color, #007acc)' : 'transparent',
                color: showDiff ? 'white' : 'var(--text-primary, #ccc)',
                cursor: 'pointer'
              }}
            >
              Diff View
            </button>
            <button
              onClick={() => setShowDiff(!showDiff)}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                border: '1px solid var(--border-color, #444)',
                borderRadius: '4px',
                backgroundColor: !showDiff ? 'var(--accent-color, #007acc)' : 'transparent',
                color: !showDiff ? 'white' : 'var(--text-primary, #ccc)',
                cursor: 'pointer'
              }}
            >
              Edit
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 20px'
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
              <div className="spinner" style={{ marginRight: '12px' }} />
              <span>Generating edit...</span>
            </div>
          ) : error ? (
            <div style={{ color: '#ef4444', padding: '20px' }}>
              <strong>Error:</strong> {error}
            </div>
          ) : (
            <>
              {/* Explanation */}
              {explanation && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-secondary, #2d2d2d)',
                    borderRadius: '6px',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    fontSize: '14px',
                    lineHeight: 1.5
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--accent-color, #007acc)' }}>
                    What changed:
                  </div>
                  {explanation}
                </div>
              )}

              {/* Code View */}
              {showDiff ? (
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    backgroundColor: 'var(--bg-secondary, #2d2d2d)',
                    borderRadius: '6px',
                    overflow: 'hidden'
                  }}
                >
                  {generateDiffLines().map((line, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        backgroundColor: line.type === 'added'
                          ? 'rgba(34, 197, 94, 0.1)'
                          : line.type === 'removed'
                            ? 'rgba(239, 68, 68, 0.1)'
                            : 'transparent',
                        borderLeft: `3px solid ${
                          line.type === 'added' ? '#22c55e'
                            : line.type === 'removed' ? '#ef4444'
                              : 'transparent'
                        }`
                      }}
                    >
                      <span
                        style={{
                          width: '40px',
                          padding: '2px 8px',
                          textAlign: 'right',
                          color: 'var(--text-secondary, #888)',
                          borderRight: '1px solid var(--border-color, #444)',
                          userSelect: 'none'
                        }}
                      >
                        {line.lineNum}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          padding: '2px 12px',
                          whiteSpace: 'pre',
                          color: line.type === 'added'
                            ? '#22c55e'
                            : line.type === 'removed'
                              ? '#ef4444'
                              : 'var(--text-primary, #ccc)'
                        }}
                      >
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        {line.content}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  value={editedLocally}
                  onChange={handleCodeChange}
                  style={{
                    width: '100%',
                    minHeight: '300px',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    backgroundColor: 'var(--bg-secondary, #2d2d2d)',
                    color: 'var(--text-primary, #ccc)',
                    border: '1px solid var(--border-color, #444)',
                    borderRadius: '6px',
                    padding: '12px',
                    resize: 'vertical'
                  }}
                  spellCheck={false}
                />
              )}

              {hasBeenModified && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    borderRadius: '4px',
                    fontSize: '13px',
                    color: '#eab308'
                  }}
                >
                  You have modified the AI suggestion. Click "Accept" to apply your changes.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color, #444)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px'
          }}
        >
          <button
            onClick={onReject}
            disabled={loading}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              border: '1px solid var(--border-color, #444)',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              color: 'var(--text-primary, #ccc)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1
            }}
          >
            Discard
          </button>
          <button
            onClick={handleAccept}
            disabled={loading}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: 'var(--accent-color, #007acc)',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

export default InlineEdit
