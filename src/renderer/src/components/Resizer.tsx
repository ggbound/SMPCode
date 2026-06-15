/**
 * Resizer - 可拖动的分隔条组件
 * 用于调整左右两侧面板的宽度
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  className?: string
}

export function Resizer({
  direction,
  onResize,
  onResizeStart,
  onResizeEnd,
  className = ''
}: ResizerProps) {
  const [isResizing, setIsResizing] = useState(false)
  const startPosRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsResizing(true)
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY
    onResizeStart?.()

    // 添加 resizing 类到 body 以改变光标样式
    document.body.classList.add('resizing')
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [direction, onResizeStart])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = currentPos - startPosRef.current
      
      // 使用 requestAnimationFrame 优化性能
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      
      rafIdRef.current = requestAnimationFrame(() => {
        onResize(delta)
        startPosRef.current = currentPos
      })
    }

    const handleMouseUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      
      setIsResizing(false)
      onResizeEnd?.()
      document.body.classList.remove('resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // 添加事件监听
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    // 防止拖动时失去焦点
    document.addEventListener('mouseleave', handleMouseUp)

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mouseleave', handleMouseUp)
    }
  }, [isResizing, direction, onResize, onResizeEnd])

  return (
    <div
      className={`resizer ${direction} ${isResizing ? 'resizing' : ''} ${className}`}
      onMouseDown={handleMouseDown}
      title={direction === 'horizontal' ? '拖动调整宽度' : '拖动调整高度'}
    />
  )
}

export default Resizer
