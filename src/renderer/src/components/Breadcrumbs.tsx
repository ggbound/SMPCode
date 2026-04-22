import { useMemo } from 'react'

interface BreadcrumbsProps {
  filePath: string
  rootPath: string
  onPathClick: (path: string) => void
}

function Breadcrumbs({ filePath, rootPath, onPathClick }: BreadcrumbsProps) {
  // Parse path into breadcrumb segments
  const segments = useMemo(() => {
    const relativePath = filePath.replace(rootPath, '').replace(/^\//, '')
    return relativePath.split('/').filter(Boolean)
  }, [filePath, rootPath])

  if (segments.length === 0) {
    return null
  }

  return (
    <div className="breadcrumbs">
      {segments.map((segment, index) => {
        const fullPath = rootPath + '/' + segments.slice(0, index + 1).join('/')
        
        return (
          <span key={index} className="breadcrumb-segment">
            {index > 0 && <span className="breadcrumb-separator">›</span>}
            <button
              className="breadcrumb-item"
              onClick={() => onPathClick(fullPath)}
              title={fullPath}
            >
              {segment}
            </button>
          </span>
        )
      })}
    </div>
  )
}

export default Breadcrumbs
