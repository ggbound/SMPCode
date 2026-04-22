import { useEffect, useCallback } from 'react'
import type { CompletionItem } from '../hooks/useCodeCompletion'

interface CodeCompletionProps {
  visible: boolean
  completions: CompletionItem[]
  activeIndex: number
  cursorPosition: { x: number; y: number }
  ghostText: string | null
  onAccept: (index?: number) => void
  onReject: () => void
  onNext: () => void
  onPrev: () => void
}

/**
 * CodeCompletion Component
 * Renders ghost text and completion UI for Copilot-style code completion
 */
export function CodeCompletion({
  visible,
  completions,
  activeIndex,
  cursorPosition,
  ghostText,
  onAccept,
  onReject,
  onNext,
  onPrev
}: CodeCompletionProps) {
  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return

    switch (e.key) {
      case 'Tab':
        e.preventDefault()
        onAccept()
        break
      case 'Escape':
        e.preventDefault()
        onReject()
        break
      case 'ArrowDown':
        if (completions.length > 1) {
          e.preventDefault()
          onNext()
        }
        break
      case 'ArrowUp':
        if (completions.length > 1) {
          e.preventDefault()
          onPrev()
        }
        break
    }
  }, [visible, completions.length, onAccept, onReject, onNext, onPrev])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Don't render if not visible or no ghost text
  if (!visible || !ghostText) {
    return null
  }

  const activeCompletion = completions[activeIndex]

  return (
    <>
      {/* Ghost Text Overlay */}
      <div
        className="copilot-ghost-text"
        style={{
          position: 'absolute',
          left: cursorPosition.x,
          top: cursorPosition.y,
          pointerEvents: 'none',
          color: 'var(--text-secondary, #888)',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          whiteSpace: 'pre',
          zIndex: 10,
          opacity: 0.6
        }}
      >
        {ghostText}
      </div>

      {/* Completion Widget */}
      {completions.length > 1 && (
        <div
          className="copilot-completion-widget"
          style={{
            position: 'absolute',
            left: cursorPosition.x,
            top: cursorPosition.y + 20,
            backgroundColor: 'var(--bg-secondary, #2d2d2d)',
            border: '1px solid var(--border-color, #444)',
            borderRadius: '4px',
            padding: '4px 0',
            minWidth: '200px',
            maxWidth: '400px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 1000
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              fontSize: '11px',
              color: 'var(--text-secondary, #888)',
              borderBottom: '1px solid var(--border-color, #444)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>Copilot Suggestions</span>
            <span>{activeIndex + 1}/{completions.length}</span>
          </div>

          {completions.map((completion, index) => (
            <div
              key={completion.id}
              className={`copilot-completion-item ${index === activeIndex ? 'active' : ''}`}
              onClick={() => onAccept(index)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '13px',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: index === activeIndex
                  ? 'var(--accent-color, #007acc)'
                  : 'transparent',
                color: index === activeIndex
                  ? 'white'
                  : 'var(--text-primary, #ccc)'
              }}
            >
              {completion.text.substring(0, 50)}
              {completion.text.length > 50 ? '...' : ''}
            </div>
          ))}

          <div
            style={{
              padding: '4px 12px',
              fontSize: '10px',
              color: 'var(--text-secondary, #888)',
              borderTop: '1px solid var(--border-color, #444)',
              display: 'flex',
              gap: '12px'
            }}
          >
            <span>Tab to accept</span>
            <span>Esc to dismiss</span>
            <span>↑↓ to navigate</span>
          </div>
        </div>
      )}

      {/* Single completion indicator */}
      {completions.length === 1 && (
        <div
          className="copilot-completion-hint"
          style={{
            position: 'absolute',
            left: cursorPosition.x,
            top: cursorPosition.y + 20,
            backgroundColor: 'var(--bg-secondary, #2d2d2d)',
            border: '1px solid var(--border-color, #444)',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
            color: 'var(--text-secondary, #888)',
            zIndex: 1000,
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }}
        >
          <span>Tab to accept</span>
          <span style={{ opacity: 0.5 }}>|</span>
          <span>Esc to dismiss</span>
        </div>
      )}
    </>
  )
}

export default CodeCompletion
