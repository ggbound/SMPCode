/**
 * useTaskResumption - 任务恢复 Hook
 * 提供断点续传功能，支持检测和恢复中断的任务
 */

import { useState, useCallback, useEffect, useRef } from 'react'

// 可恢复任务信息
export interface ResumableTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'paused' | 'interrupted' | 'completed' | 'error'
  progress: string
  updatedAt: number
  canResume: boolean
}

// 恢复上下文
export interface ResumeContext {
  taskId: string
  description: string
  messages: Array<{
    role: string
    content: string
    tool_call_id?: string
    name?: string
  }>
  resumePrompt: string
  canFullyRestore: boolean
  missingContext?: string
}

// IPC API 类型
interface TaskResumptionAPI {
  getResumableTasks: () => Promise<{ success: boolean; tasks: ResumableTask[]; error?: string }>
  prepareTaskResume: (taskId: string) => Promise<{ success: boolean; context: ResumeContext | null; error?: string }>
  deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>
}

interface WindowAPI {
  taskResumption?: TaskResumptionAPI
}

function getIPCApi(): TaskResumptionAPI | null {
  const win = window as unknown as { api?: WindowAPI }
  return win.api?.taskResumption || null
}

/**
 * useTaskResumption Hook
 */
export function useTaskResumption() {
  const [resumableTasks, setResumableTasks] = useState<ResumableTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentResumeContext, setCurrentResumeContext] = useState<ResumeContext | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * 获取可恢复的任务列表
   */
  const fetchResumableTasks = useCallback(async () => {
    const api = getIPCApi()
    if (!api) {
      setError('Task resumption API not available')
      return
    }

    try {
      setIsLoading(true)
      const result = await api.getResumableTasks()
      if (result.success) {
        setResumableTasks(result.tasks)
        setError(null)
      } else {
        setError(result.error || 'Failed to fetch tasks')
      }
    } catch (err) {
      setError(`Failed to fetch tasks: ${String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * 准备任务恢复
   */
  const prepareResume = useCallback(async (taskId: string): Promise<ResumeContext | null> => {
    const api = getIPCApi()
    if (!api) {
      setError('Task resumption API not available')
      return null
    }

    try {
      setIsLoading(true)
      const result = await api.prepareTaskResume(taskId)
      if (result.success && result.context) {
        setCurrentResumeContext(result.context)
        return result.context
      }
      return null
    } catch (err) {
      setError(`Failed to prepare resume: ${String(err)}`)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * 删除任务
   */
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    const api = getIPCApi()
    if (!api) return false

    try {
      const result = await api.deleteTask(taskId)
      if (result.success) {
        // 刷新任务列表
        await fetchResumableTasks()
        if (currentResumeContext?.taskId === taskId) {
          setCurrentResumeContext(null)
        }
      }
      return result.success
    } catch (err) {
      setError(`Failed to delete task: ${String(err)}`)
      return false
    }
  }, [fetchResumableTasks, currentResumeContext])

  /**
   * 清除当前恢复上下文
   */
  const clearResumeContext = useCallback(() => {
    setCurrentResumeContext(null)
  }, [])

  /**
   * 开始轮询任务列表
   */
  const startPolling = useCallback((intervalMs: number = 5000) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }
    
    pollingRef.current = setInterval(() => {
      fetchResumableTasks()
    }, intervalMs)
  }, [fetchResumableTasks])

  /**
   * 停止轮询
   */
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  // 初始加载
  useEffect(() => {
    fetchResumableTasks()
  }, [fetchResumableTasks])

  return {
    // 状态
    resumableTasks,
    isLoading,
    error,
    currentResumeContext,
    
    // 方法
    fetchResumableTasks,
    prepareResume,
    deleteTask,
    clearResumeContext,
    startPolling,
    stopPolling
  }
}

export default useTaskResumption
