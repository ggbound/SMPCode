/**
 * TaskResumptionPanel - 任务恢复面板
 * 显示可恢复的任务列表，允许用户选择继续或删除
 */

import { useState, useEffect } from 'react'
import { useTaskResumption, type ResumableTask } from '../hooks'
import { RotateCcw, Trash2, Clock, AlertCircle, X } from 'lucide-react'

import type { ResumeContext } from '../hooks'

interface TaskResumptionPanelProps {
  onResumeTask: (taskId: string, context: ResumeContext) => void
  onDismiss?: () => void
}

export function TaskResumptionPanel({ onResumeTask, onDismiss }: TaskResumptionPanelProps) {
  const {
    resumableTasks,
    isLoading,
    error,
    fetchResumableTasks,
    deleteTask,
    prepareResume
  } = useTaskResumption()

  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(true)

  // 初始加载
  useEffect(() => {
    fetchResumableTasks()
  }, [fetchResumableTasks])

  // 过滤出真正可以恢复的任务（中断或暂停的）
  const activeTasks = resumableTasks.filter(
    task => task.status === 'interrupted' || task.status === 'paused' || task.status === 'running'
  )

  // 如果没有可恢复的任务，不显示
  if (!isVisible || activeTasks.length === 0) {
    return null
  }

  const handleResume = async (taskId: string) => {
    const context = await prepareResume(taskId)
    if (context) {
      onResumeTask(taskId, context)
    }
  }

  const handleDelete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingTaskId(taskId)
    await deleteTask(taskId)
    setDeletingTaskId(null)
  }

  const handleDismiss = () => {
    setIsVisible(false)
    onDismiss?.()
  }

  const getStatusIcon = (status: ResumableTask['status']) => {
    switch (status) {
      case 'interrupted':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      case 'paused':
        return <Clock className="w-4 h-4 text-blue-500" />
      case 'running':
        return <RotateCcw className="w-4 h-4 text-green-500 animate-spin" />
      default:
        return null
    }
  }

  const getStatusText = (status: ResumableTask['status']) => {
    switch (status) {
      case 'interrupted':
        return '已中断'
      case 'paused':
        return '已暂停'
      case 'running':
        return '进行中'
      default:
        return status
    }
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    // 小于1小时显示"X分钟前"
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000))
      return `${minutes} 分钟前`
    }
    // 小于24小时显示"X小时前"
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000))
      return `${hours} 小时前`
    }
    // 否则显示日期
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-4 shadow-sm">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <h3 className="font-semibold text-amber-900 dark:text-amber-100">
            发现 {activeTasks.length} 个可恢复的任务
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchResumableTasks()}
            disabled={isLoading}
            className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/50 rounded transition-colors"
            title="刷新"
          >
            <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/50 rounded transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-2">
        {activeTasks.map((task) => (
          <div
            key={task.id}
            className="group flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-amber-100 dark:border-amber-800/50 hover:border-amber-300 dark:hover:border-amber-600 transition-all cursor-pointer shadow-sm hover:shadow-md"
            onClick={() => handleResume(task.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {getStatusIcon(task.status)}
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300">
                  {getStatusText(task.status)}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {formatTime(task.updatedAt)}
                </span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {task.description}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {task.progress}
              </p>
            </div>
            
            <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleDelete(task.id, e)}
                disabled={deletingTaskId === task.id}
                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="删除任务"
              >
                <Trash2 className={`w-4 h-4 ${deletingTaskId === task.id ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 底部提示 */}
      <p className="mt-3 text-xs text-amber-600/70 dark:text-amber-400/70">
        点击任务卡片即可从中断点继续执行
      </p>
    </div>
  )
}

export default TaskResumptionPanel
