/**
 * GitArboristPanel - 使用 react-arborist 的 Git 面板
 * 提供分支和提交的树形结构展示
 */

import React, { useState, useCallback, useMemo } from 'react'
import { Tree } from 'react-arborist'
import { GitBranch, GitCommit, GitMerge, Circle, File, Folder } from 'lucide-react'
import { GitBranch as GitBranchType, GitCommit as GitCommitType } from '../hooks/useGit'
import CommitDetailPanel from './CommitDetailPanel'

interface GitArboristPanelProps {
  repoPath: string | null
  branches: GitBranchType[]
  commits: GitCommitType[]
}

// 树节点数据类型
interface TreeNode {
  id: string
  name: string
  type: 'root' | 'branch' | 'commit' | 'file'
  data?: any
  children?: TreeNode[]
}

// 构建树形数据
const buildTreeData = (branches: GitBranchType[], commits: GitCommitType[]): TreeNode[] => {
  const root: TreeNode = {
    id: 'root',
    name: 'Git 仓库',
    type: 'root',
    children: [],
  }

  // 本地分支组
  const localBranches: TreeNode = {
    id: 'local-branches',
    name: '本地分支',
    type: 'root',
    children: [],
  }

  // 远程分支组
  const remoteBranches: TreeNode = {
    id: 'remote-branches',
    name: '远程分支',
    type: 'root',
    children: [],
  }

  // 提交历史组
  const commitHistory: TreeNode = {
    id: 'commit-history',
    name: '提交历史',
    type: 'root',
    children: [],
  }

  // 添加本地分支
  branches
    .filter((b) => !b.name.startsWith('remotes/'))
    .forEach((branch) => {
      const branchNode: TreeNode = {
        id: `branch-${branch.name}`,
        name: branch.name + (branch.current ? ' (当前)' : ''),
        type: 'branch',
        data: branch,
        children: [],
      }
      localBranches.children?.push(branchNode)
    })

  // 添加远程分支
  branches
    .filter((b) => b.name.startsWith('remotes/'))
    .forEach((branch) => {
      const branchNode: TreeNode = {
        id: `branch-${branch.name}`,
        name: branch.name.replace('remotes/', ''),
        type: 'branch',
        data: branch,
        children: [],
      }
      remoteBranches.children?.push(branchNode)
    })

  // 添加提交历史
  commits.forEach((commit, index) => {
    const commitNode: TreeNode = {
      id: `commit-${commit.hash}`,
      name: commit.message.split('\n')[0] || '无消息',
      type: 'commit',
      data: commit,
      children: [],
    }
    commitHistory.children?.push(commitNode)
  })

  root.children = [localBranches, remoteBranches, commitHistory]
  return [root]
}

// 节点渲染组件
const NodeRenderer: React.FC<{ node: any; style: React.CSSProperties }> = ({ node, style }) => {
  const data = node.data as TreeNode
  const isSelected = node.isSelected
  const isOpen = node.isOpen

  const getIcon = () => {
    switch (data.type) {
      case 'root':
        return <Folder size={16} style={{ marginRight: 6, color: '#8b949e' }} />
      case 'branch':
        return data.data?.current ? (
          <GitBranch size={16} style={{ marginRight: 6, color: '#238636' }} />
        ) : (
          <GitBranch size={16} style={{ marginRight: 6, color: '#58a6ff' }} />
        )
      case 'commit':
        return <Circle size={10} style={{ marginRight: 8, color: '#8957e5' }} fill="#8957e5" />
      default:
        return <File size={16} style={{ marginRight: 6, color: '#8b949e' }} />
    }
  }

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        padding: '4px 8px',
        cursor: 'pointer',
        backgroundColor: isSelected ? '#1f6feb33' : 'transparent',
        borderRadius: '4px',
        margin: '2px 4px',
        transition: 'background-color 0.15s ease',
      }}
      onClick={() => {
        node.select()
        if (data.type === 'root' || data.type === 'branch') {
          node.toggle()
        }
      }}
    >
      {/* 展开/折叠指示器 */}
      <div
        style={{
          width: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 4,
          opacity: data.children && data.children.length > 0 ? 1 : 0,
        }}
      >
        {data.children && data.children.length > 0 && (
          <span style={{ fontSize: 10, color: '#8b949e' }}>
            {isOpen ? '▼' : '▶'}
          </span>
        )}
      </div>

      {/* 图标 */}
      {getIcon()}

      {/* 名称 */}
      <span
        style={{
          fontSize: 13,
          color: isSelected ? '#58a6ff' : data.type === 'root' ? '#c9d1d9' : '#e6edf3',
          fontWeight: data.type === 'root' ? 600 : 400,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.name}
      </span>

      {/* 提交信息 */}
      {data.type === 'commit' && data.data && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: '#8b949e',
            fontFamily: 'monospace',
          }}
        >
          {data.data.hash.substring(0, 7)}
        </span>
      )}
    </div>
  )
}

export const GitArboristPanel: React.FC<GitArboristPanelProps> = ({
  repoPath,
  branches,
  commits,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // 构建树形数据
  const treeData = useMemo(() => {
    if (!repoPath || (branches.length === 0 && commits.length === 0)) {
      return []
    }
    return buildTreeData(branches, commits)
  }, [repoPath, branches, commits])

  // 处理节点选择
  const handleSelect = useCallback((nodes: any[]) => {
    if (nodes.length > 0) {
      const node = nodes[0]
      const data = node.data as TreeNode
      if (data.type === 'commit') {
        setSelectedNodeId(data.data?.hash)
      } else {
        setSelectedNodeId(null)
      }
    }
  }, [])

  if (!repoPath) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '40px',
          color: '#8b949e',
          background: '#0D1117',
        }}
      >
        <GitBranch size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>
          未打开 Git 仓库
        </div>
        <div style={{ fontSize: '13px', opacity: 0.7 }}>
          请打开一个包含 Git 仓库的项目
        </div>
      </div>
    )
  }

  if (treeData.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '40px',
          color: '#8b949e',
          background: '#0D1117',
        }}
      >
        <GitCommit size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <div style={{ fontSize: '14px' }}>暂无分支数据</div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'hidden',
        background: '#0D1117',
        display: 'flex',
      }}
    >
      {/* 左侧树形结构 */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'auto',
        }}
      >
        <Tree
          data={treeData}
          width="100%"
          height={800}
          indent={24}
          rowHeight={28}
          openByDefault={true}
          selectionFollowsFocus={false}
          onSelect={handleSelect}
        >
          {NodeRenderer}
        </Tree>
      </div>

      {/* 右侧提交详情 */}
      <div
        style={{
          width: '320px',
          minWidth: '320px',
          borderLeft: '1px solid #30363d',
          background: '#0D1117',
          overflow: 'hidden',
        }}
      >
        <CommitDetailPanel commitId={selectedNodeId} repoPath={repoPath} />
      </div>
    </div>
  )
}

export default GitArboristPanel
