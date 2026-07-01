/**
 * UndoRedoButtons - 撤销/重做按钮
 * 集成到编辑器工具栏
 */

import React, { useState, useEffect } from 'react'
import { Undo, Redo } from 'lucide-react'

interface UndoRedoButtonsProps {
  projectPath: string
}

export const UndoRedoButtons: React.FC<UndoRedoButtonsProps> = ({ projectPath }) => {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // 检查状态
  const checkStatus = async () => {
    if (!window.api?.history || !projectPath) return
    try {
      const result = await window.api.history.get(projectPath)
      if (result.success) {
        setCanUndo(result.canUndo || false)
        setCanRedo(result.canRedo || false)
      }
    } catch (error) {
      console.error('Failed to check history status:', error)
    }
  }

  // 定期检查状态
  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 1000)
    return () => clearInterval(interval)
  }, [projectPath])

  // 撤销
  const handleUndo = async () => {
    if (!canUndo || isLoading || !window.api?.history) return
    setIsLoading(true)
    try {
      const result = await window.api.history.undo(projectPath)
      if (result.success) {
        await checkStatus()
      }
    } catch (error) {
      console.error('Failed to undo:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 重做
  const handleRedo = async () => {
    if (!canRedo || isLoading || !window.api?.history) return
    setIsLoading(true)
    try {
      const result = await window.api.history.redo(projectPath)
      if (result.success) {
        await checkStatus()
      }
    } catch (error) {
      console.error('Failed to redo:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      <button
        onClick={handleUndo}
        disabled={!canUndo || isLoading}
        title="撤销 (Ctrl+Z)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          backgroundColor: canUndo ? 'transparent' : 'rgba(255,255,255,0.05)',
          border: 'none',
          borderRadius: '4px',
          color: canUndo ? '#e2e8f0' : '#666',
          cursor: canUndo ? 'pointer' : 'not-allowed',
          opacity: canUndo ? 1 : 0.5,
          transition: 'all 0.2s'
        }}
      >
        <Undo size={16} />
      </button>
      <button
        onClick={handleRedo}
        disabled={!canRedo || isLoading}
        title="重做 (Ctrl+Y)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          backgroundColor: canRedo ? 'transparent' : 'rgba(255,255,255,0.05)',
          border: 'none',
          borderRadius: '4px',
          color: canRedo ? '#e2e8f0' : '#666',
          cursor: canRedo ? 'pointer' : 'not-allowed',
          opacity: canRedo ? 1 : 0.5,
          transition: 'all 0.2s'
        }}
      >
        <Redo size={16} />
      </button>
    </div>
  )
}

export default UndoRedoButtons
