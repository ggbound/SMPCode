/**
 * CommitDetailPanel - 自定义提交详情面板
 * 使用纯 React 实现，不依赖任何 Git UI 插件
 */

import React, { useState, useEffect } from 'react'
import { GitCommit, User, Clock, FileCode, ChevronDown, ChevronRight, Plus, Minus, FileText } from 'lucide-react'

interface CommitDetailPanelProps {
  commitId: string | null
  repoPath: string | null
  onClose?: () => void
}

interface CommitDetail {
  hash: string
  message: string
  author: string
  email: string
  date: string
  files: string[]
}

interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions?: number
  deletions?: number
}

// 模拟获取提交详情
const fetchCommitDetail = async (
  repoPath: string,
  commitId: string
): Promise<CommitDetail | null> => {
  // 这里应该调用实际的 Git API
  // 现在返回模拟数据
  return {
    hash: commitId,
    message: '提交信息',
    author: 'Unknown',
    email: '',
    date: new Date().toISOString(),
    files: [],
  }
}

// 模拟获取文件变更
const fetchFileChanges = async (
  repoPath: string,
  commitId: string
): Promise<FileChange[]> => {
  // 这里应该调用实际的 Git API
  return []
}

// 获取文件图标
const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const colorMap: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f1e05a',
    jsx: '#f1e05a',
    json: '#f1e05a',
    css: '#563d7c',
    scss: '#563d7c',
    html: '#e34c26',
    md: '#083fa1',
    vue: '#41b883',
    py: '#3572A5',
    java: '#b07219',
    go: '#00ADD8',
  }
  return colorMap[ext] || '#8b949e'
}

// 获取状态标签样式
const getStatusStyle = (status: string) => {
  switch (status) {
    case 'added':
      return { bg: '#238636', text: 'A' }
    case 'modified':
      return { bg: '#1f6feb', text: 'M' }
    case 'deleted':
      return { bg: '#da3633', text: 'D' }
    case 'renamed':
      return { bg: '#8957e5', text: 'R' }
    default:
      return { bg: '#6e7681', text: '?' }
  }
}

export const CommitDetailPanel: React.FC<CommitDetailPanelProps> = ({
  commitId,
  repoPath,
  onClose,
}) => {
  const [commit, setCommit] = useState<CommitDetail | null>(null)
  const [fileChanges, setFileChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!commitId || !repoPath) {
      setCommit(null)
      setFileChanges([])
      return
    }

    setLoading(true)
    Promise.all([fetchCommitDetail(repoPath, commitId), fetchFileChanges(repoPath, commitId)])
      .then(([detail, changes]) => {
        setCommit(detail)
        setFileChanges(changes)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [commitId, repoPath])

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }

  if (!commitId) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          color: '#8b949e',
          background: '#0D1117',
        }}
      >
        <GitCommit size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <div style={{ fontSize: '14px' }}>选择提交查看详情</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8b949e',
          background: '#0D1117',
        }}
      >
        <div style={{ fontSize: '14px' }}>加载中...</div>
      </div>
    )
  }

  if (!commit) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          color: '#8b949e',
          background: '#0D1117',
        }}
      >
        <FileText size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <div style={{ fontSize: '14px' }}>无法加载提交详情</div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: '#0D1117',
        color: '#e6edf3',
      }}
    >
      {/* 提交信息头部 */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #30363d',
          background: '#161b22',
        }}
      >
        {/* Commit Hash */}
        <div
          style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#58a6ff',
            marginBottom: '12px',
            cursor: 'pointer',
          }}
          onClick={() => {
            navigator.clipboard.writeText(commit.hash)
          }}
        >
          {commit.hash}
        </div>

        {/* 提交信息 */}
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            lineHeight: 1.5,
            marginBottom: '16px',
            color: '#e6edf3',
          }}
        >
          {commit.message}
        </div>

        {/* 作者信息 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <User size={14} style={{ color: '#8b949e' }} />
          <span style={{ fontSize: '13px', color: '#e6edf3' }}>{commit.author}</span>
          {commit.email && (
            <span style={{ fontSize: '12px', color: '#8b949e' }}>&lt;{commit.email}&gt;</span>
          )}
        </div>

        {/* 提交时间 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Clock size={14} style={{ color: '#8b949e' }} />
          <span style={{ fontSize: '12px', color: '#8b949e' }}>
            {new Date(commit.date).toLocaleString('zh-CN')}
          </span>
        </div>
      </div>

      {/* 文件变更列表 */}
      <div style={{ padding: '8px 0' }}>
        <div
          style={{
            padding: '8px 16px',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: '#8b949e',
            borderBottom: '1px solid #30363d',
          }}
        >
          文件变更 ({fileChanges.length})
        </div>

        {fileChanges.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#8b949e',
              fontSize: '13px',
            }}
          >
            暂无文件变更信息
          </div>
        ) : (
          fileChanges.map((file) => {
            const statusStyle = getStatusStyle(file.status)
            const isExpanded = expandedFiles.has(file.path)

            return (
              <div key={file.path}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #21262d',
                    transition: 'background-color 0.15s ease',
                  }}
                  onClick={() => toggleFile(file.path)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#161b22'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  {/* 展开/折叠图标 */}
                  <div style={{ marginRight: '8px', color: '#8b949e' }}>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>

                  {/* 状态标签 */}
                  <div
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '3px',
                      backgroundColor: statusStyle.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#fff',
                      marginRight: '8px',
                    }}
                  >
                    {statusStyle.text}
                  </div>

                  {/* 文件图标 */}
                  <FileCode size={14} style={{ marginRight: '8px', color: getFileIcon(file.path) }} />

                  {/* 文件路径 */}
                  <div
                    style={{
                      flex: 1,
                      fontSize: '12px',
                      color: '#e6edf3',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.path}
                  </div>

                  {/* 添加/删除行数 */}
                  {(file.additions || file.deletions) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
                      {file.additions && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#238636', fontSize: '11px' }}>
                          <Plus size={10} />
                          {file.additions}
                        </div>
                      )}
                      {file.deletions && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#da3633', fontSize: '11px' }}>
                          <Minus size={10} />
                          {file.deletions}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 文件差异预览（展开时） */}
                {isExpanded && (
                  <div
                    style={{
                      padding: '12px 16px',
                      background: '#0D1117',
                      borderBottom: '1px solid #21262d',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px',
                        background: '#161b22',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: '#8b949e',
                        fontFamily: 'monospace',
                      }}
                    >
                      文件差异预览功能待实现...
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default CommitDetailPanel
