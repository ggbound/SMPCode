import { useState, useEffect } from 'react'
import { FilePlus, FileEdit, Save } from 'lucide-react'

interface FileWriteStatus {
  path: string
  operation: 'writing' | 'editing' | 'creating'
  progress?: number
}

interface FileWriteIndicatorProps {
  status?: FileWriteStatus | null
}

export function useFileWriteStatus() {
  const [status, setStatus] = useState<FileWriteStatus | null>(null)

  useEffect(() => {
    // Listen for custom events from window
    const handleWriteStart = (e: CustomEvent<{ path: string; operation: 'writing' | 'editing' | 'creating' }>) => {
      setStatus({
        path: e.detail.path,
        operation: e.detail.operation
      })
    }

    const handleWriteEnd = () => {
      // Delay clearing to show completion state briefly
      setTimeout(() => {
        setStatus(null)
      }, 1500)
    }

    window.addEventListener('file-write-start', handleWriteStart as EventListener)
    window.addEventListener('file-write-end', handleWriteEnd as EventListener)

    // Listen for IPC events from main process
    const setupIPCListener = async () => {
      if (window.api?.onFileOperation) {
        const unsubscribe = await window.api.onFileOperation((_event: unknown, data: { operation: 'writing' | 'editing' | 'creating' | 'completed' | 'error'; path: string; timestamp: number; message?: string }) => {
          console.log('[FileWriteIndicator] Received file operation:', data.operation, data.path)
          if (data.operation === 'writing' || data.operation === 'editing' || data.operation === 'creating') {
            setStatus({
              path: data.path,
              operation: data.operation
            })
          }

          // Auto-clear after 2 seconds
          setTimeout(() => {
            setStatus(null)
          }, 2000)
        })

        return unsubscribe
      }
      return undefined
    }

    let unsubscribePromise: Promise<(() => void) | undefined> | undefined
    setupIPCListener().then(unsub => {
      unsubscribePromise = Promise.resolve(unsub)
    })

    return () => {
      window.removeEventListener('file-write-start', handleWriteStart as EventListener)
      window.removeEventListener('file-write-end', handleWriteEnd as EventListener)
      if (unsubscribePromise) {
        unsubscribePromise.then(unsub => unsub?.())
      }
    }
  }, [])

  return { status, setStatus }
}

function FileWriteIndicator({ status }: FileWriteIndicatorProps) {
  if (!status) return null

  const getIcon = () => {
    switch (status.operation) {
      case 'creating':
        return <FilePlus size={14} />
      case 'editing':
        return <FileEdit size={14} />
      case 'writing':
      default:
        return <Save size={14} />
    }
  }

  const getMessage = () => {
    const fileName = status.path.split('/').pop() || status.path
    switch (status.operation) {
      case 'creating':
        return `Creating ${fileName}...`
      case 'editing':
        return `Editing ${fileName}...`
      case 'writing':
      default:
        return `Writing ${fileName}...`
    }
  }

  return (
    <div className="file-write-indicator">
      <span className="file-write-icon">{getIcon()}</span>
      <span className="file-write-message">{getMessage()}</span>
      <span className="file-write-spinner"></span>
    </div>
  )
}

export default FileWriteIndicator
