import { useState, useCallback, useRef, useEffect, ReactNode } from 'react'

export type SplitDirection = 'horizontal' | 'vertical'

interface SplitPaneProps {
  direction: SplitDirection
  children: [ReactNode, ReactNode]
  defaultSize?: number
  minSize?: number
  maxSize?: number
}

function SplitPane({ direction, children, defaultSize = 50, minSize = 100, maxSize }: SplitPaneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [splitSize, setSplitSize] = useState(defaultSize)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    
    let newSize: number
    if (direction === 'vertical') {
      newSize = ((e.clientX - rect.left) / rect.width) * 100
    } else {
      newSize = ((e.clientY - rect.top) / rect.height) * 100
    }

    // Apply constraints
    if (minSize) {
      const minPercent = (minSize / (direction === 'vertical' ? rect.width : rect.height)) * 100
      newSize = Math.max(newSize, minPercent)
    }
    if (maxSize) {
      const maxPercent = (maxSize / (direction === 'vertical' ? rect.width : rect.height)) * 100
      newSize = Math.min(newSize, maxPercent)
    }

    setSplitSize(Math.max(10, Math.min(90, newSize)))
  }, [isDragging, direction, minSize, maxSize])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  return (
    <div 
      ref={containerRef}
      className={`split-pane split-pane-${direction} ${isDragging ? 'dragging' : ''}`}
    >
      <div 
        className="split-pane-first"
        style={{
          [direction === 'vertical' ? 'width' : 'height']: `${splitSize}%`,
        }}
      >
        {children[0]}
      </div>
      <div 
        className="split-pane-divider"
        onMouseDown={handleMouseDown}
      >
        <div className="split-pane-divider-handle" />
      </div>
      <div className="split-pane-second">
        {children[1]}
      </div>
    </div>
  )
}

interface EditorSplitProps {
  leftContent: ReactNode
  rightContent: ReactNode
  isSplit: boolean
  splitDirection?: SplitDirection
  defaultSplitSize?: number
}

function EditorSplit({ 
  leftContent, 
  rightContent, 
  isSplit, 
  splitDirection = 'vertical',
  defaultSplitSize = 50 
}: EditorSplitProps) {
  if (!isSplit) {
    return <>{leftContent}</>
  }

  return (
    <SplitPane 
      direction={splitDirection}
      defaultSize={defaultSplitSize}
      minSize={150}
    >
      {[leftContent, rightContent]}
    </SplitPane>
  )
}

export { SplitPane, EditorSplit }
export default EditorSplit
