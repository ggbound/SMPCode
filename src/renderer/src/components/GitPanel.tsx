/**
 * GitPanel - Git 版本控制面板
 * 提供完整的 Git 工作流界面
 */

import React, { useState, useCallback, useMemo } from 'react'
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  GitMerge,
  Plus,
  Minus,
  RefreshCw,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Stash,
  Clock,
  AlertCircle,
  ArrowUpCircle,
  ArrowDownCircle
} from 'lucide-react'
import { useGit } from '../hooks/useGit'

interface GitPanelProps {
  repoPath: string | null
}

interface FileItemProps {
  file: {
    path: string
    status: 'staged' | 'modified' | 'untracked' | 'conflicted'
    staged: boolean
  }
  selected: boolean
  onSelect: (selected: boolean) => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
}

// 文件状态图标
const FileStatusIcon: React.FC<{ status: string }> = ({ status }) => {
  const iconClass = 'w-3 h-3'
  switch (status) {
    case 'staged':
      return <span className={`${iconClass} text-green-400`}>●</span>
    case 'modified':
      return <span className={`${iconClass} text-yellow-400`}>M</span>
    case 'untracked':
      return <span className={`${iconClass} text-gray-400`}>?</span>
    case 'conflicted':
      return <span className={`${iconClass} text-red-400`}>!</span>
    default:
      return null
  }
}

// 文件项组件
const FileItem: React.FC<FileItemProps> = ({ file, selected, onSelect, onStage, onUnstage, onDiscard }) => {
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer ${
        selected ? 'bg-blue-500/20' : ''
      }`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-white/20 bg-white/10"
      />
      <FileStatusIcon status={file.status} />
      <span className="flex-1 text-xs text-gray-300 truncate">{file.path}</span>

      {showActions && (
        <div className="flex items-center gap-1">
          {file.status !== 'staged' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStage()
              }}
              className="p-1 hover:bg-white/10 rounded"
              title="暂存"
            >
              <Plus className="w-3 h-3 text-green-400" />
            </button>
          )}
          {file.status === 'staged' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onUnstage()
              }}
              className="p-1 hover:bg-white/10 rounded"
              title="取消暂存"
            >
              <Minus className="w-3 h-3 text-yellow-400" />
            </button>
          )}
          {file.status !== 'staged' && file.status !== 'untracked' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDiscard()
              }}
              className="p-1 hover:bg-white/10 rounded"
              title="丢弃更改"
            >
              <X className="w-3 h-3 text-red-400" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const GitPanel: React.FC<GitPanelProps> = ({ repoPath }) => {
  const [activeTab, setActiveTab] = useState<'changes' | 'branches' | 'commits' | 'stashes'>('changes')
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [showNewBranchDialog, setShowNewBranchDialog] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [checkoutNewBranch, setCheckoutNewBranch] = useState(true)
  const [showStashDialog, setShowStashDialog] = useState(false)
  const [stashMessage, setStashMessage] = useState('')

  const {
    isRepo,
    branch,
    ahead,
    behind,
    files,
    branches,
    commits,
    stashes,
    selectedFiles,
    commitMessage,
    isLoading,
    error,
    refresh,
    selectFile,
    selectAllFiles,
    setCommitMessage,
    stageFiles,
    unstageFiles,
    commit,
    discardChanges,
    createBranch,
    checkoutBranch,
    deleteBranch,
    push,
    pull,
    stash,
    popStash
  } = useGit({ repoPath, autoRefresh: true, refreshInterval: 5000 })

  // 分组文件
  const groupedFiles = useMemo(() => {
    return {
      staged: files.filter(f => f.status === 'staged'),
      modified: files.filter(f => f.status === 'modified'),
      untracked: files.filter(f => f.status === 'untracked'),
      conflicted: files.filter(f => f.status === 'conflicted')
    }
  }, [files])

  // 处理提交
  const handleCommit = useCallback(async () => {
    const selectedFilePaths = Array.from(selectedFiles)
    if (selectedFilePaths.length === 0) {
      // 提交所有暂存的文件
      await commit()
    } else {
      // 只提交选中的文件
      await commit(commitMessage, selectedFilePaths)
    }
  }, [commit, commitMessage, selectedFiles])

  // 处理暂存选中文件
  const handleStageSelected = useCallback(async () => {
    const selectedFilePaths = Array.from(selectedFiles)
    await stageFiles(selectedFilePaths)
  }, [stageFiles, selectedFiles])

  // 处理取消暂存选中文件
  const handleUnstageSelected = useCallback(async () => {
    const selectedFilePaths = Array.from(selectedFiles)
    await unstageFiles(selectedFilePaths)
  }, [unstageFiles, selectedFiles])

  // 处理丢弃选中文件
  const handleDiscardSelected = useCallback(async () => {
    const selectedFilePaths = Array.from(selectedFiles)
    if (confirm('确定要丢弃选中的文件的更改吗？此操作无法撤销。')) {
      await discardChanges(selectedFilePaths)
    }
  }, [discardChanges, selectedFiles])

  // 处理创建新分支
  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return
    await createBranch(newBranchName, checkoutNewBranch)
    setNewBranchName('')
    setShowNewBranchDialog(false)
  }, [createBranch, newBranchName, checkoutNewBranch])

  // 处理 stash
  const handleStash = useCallback(async () => {
    await stash(stashMessage || undefined)
    setStashMessage('')
    setShowStashDialog(false)
  }, [stash, stashMessage])

  // 如果不是 Git 仓库
  if (!isRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-gray-400">
        <GitBranch className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">当前目录不是 Git 仓库</p>
        {repoPath && (
          <button
            onClick={refresh}
            className="mt-4 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded flex items-center gap-2"
          >
            <RefreshCw className="w-3 h-3" />
            刷新
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#252526]">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">{branch}</span>
          {ahead > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-green-400">
              <ArrowUpCircle className="w-3 h-3" />
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-yellow-400">
              <ArrowDownCircle className="w-3 h-3" />
              {behind}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowBranchMenu(!showBranchMenu)}
            className="p-1.5 hover:bg-white/10 rounded"
            title="分支操作"
          >
            <GitMerge className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={pull}
            className="p-1.5 hover:bg-white/10 rounded"
            title="拉取"
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={push}
            className="p-1.5 hover:bg-white/10 rounded"
            title="推送"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-1.5 hover:bg-white/10 rounded disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex border-b border-white/10">
        {[
          { key: 'changes', label: '更改', count: files.length },
          { key: 'branches', label: '分支', count: branches.length },
          { key: 'commits', label: '提交', count: commits.length },
          { key: 'stashes', label: '储藏', count: stashes.length }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-white bg-white/10 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 px-1 py-0.5 text-[10px] bg-white/20 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-3 p-2 bg-red-500/20 border border-red-500/30 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        {/* 更改标签 */}
        {activeTab === 'changes' && (
          <div className="flex flex-col h-full">
            {/* 操作栏 */}
            {selectedFiles.size > 0 && (
              <div className="flex items-center gap-1 p-2 border-b border-white/10 bg-white/5">
                <span className="text-xs text-gray-400 flex-1">
                  已选择 {selectedFiles.size} 个文件
                </span>
                <button
                  onClick={handleStageSelected}
                  className="px-2 py-1 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  暂存
                </button>
                <button
                  onClick={handleUnstageSelected}
                  className="px-2 py-1 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded flex items-center gap-1"
                >
                  <Minus className="w-3 h-3" />
                  取消暂存
                </button>
                <button
                  onClick={handleDiscardSelected}
                  className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  丢弃
                </button>
              </div>
            )}

            {/* 文件列表 */}
            <div className="flex-1 overflow-auto">
              {/* 暂存区 */}
              {groupedFiles.staged.length > 0 && (
                <div className="border-b border-white/10">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupedFiles.staged.every(f => selectedFiles.has(f.path))}
                        onChange={(e) => selectAllFiles('staged', e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/10"
                      />
                      <span className="text-xs font-medium text-green-400">
                        已暂存的更改 ({groupedFiles.staged.length})
                      </span>
                    </div>
                    <button
                      onClick={() => unstageFiles(groupedFiles.staged.map(f => f.path))}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      全部取消暂存
                    </button>
                  </div>
                  {groupedFiles.staged.map(file => (
                    <FileItem
                      key={file.path}
                      file={file}
                      selected={selectedFiles.has(file.path)}
                      onSelect={(selected) => selectFile(file.path, selected)}
                      onStage={() => {}}
                      onUnstage={() => unstageFiles([file.path])}
                      onDiscard={() => {}}
                    />
                  ))}
                </div>
              )}

              {/* 修改的文件 */}
              {groupedFiles.modified.length > 0 && (
                <div className="border-b border-white/10">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupedFiles.modified.every(f => selectedFiles.has(f.path))}
                        onChange={(e) => selectAllFiles('modified', e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/10"
                      />
                      <span className="text-xs font-medium text-yellow-400">
                        更改 ({groupedFiles.modified.length})
                      </span>
                    </div>
                    <button
                      onClick={() => stageFiles(groupedFiles.modified.map(f => f.path))}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      全部暂存
                    </button>
                  </div>
                  {groupedFiles.modified.map(file => (
                    <FileItem
                      key={file.path}
                      file={file}
                      selected={selectedFiles.has(file.path)}
                      onSelect={(selected) => selectFile(file.path, selected)}
                      onStage={() => stageFiles([file.path])}
                      onUnstage={() => {}}
                      onDiscard={() => {
                        if (confirm(`确定要丢弃 ${file.path} 的更改吗？`)) {
                          discardChanges([file.path])
                        }
                      }}
                    />
                  ))}
                </div>
              )}

              {/* 未跟踪的文件 */}
              {groupedFiles.untracked.length > 0 && (
                <div className="border-b border-white/10">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupedFiles.untracked.every(f => selectedFiles.has(f.path))}
                        onChange={(e) => selectAllFiles('untracked', e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/10"
                      />
                      <span className="text-xs font-medium text-gray-400">
                        未跟踪的文件 ({groupedFiles.untracked.length})
                      </span>
                    </div>
                    <button
                      onClick={() => stageFiles(groupedFiles.untracked.map(f => f.path))}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      全部暂存
                    </button>
                  </div>
                  {groupedFiles.untracked.map(file => (
                    <FileItem
                      key={file.path}
                      file={file}
                      selected={selectedFiles.has(file.path)}
                      onSelect={(selected) => selectFile(file.path, selected)}
                      onStage={() => stageFiles([file.path])}
                      onUnstage={() => {}}
                      onDiscard={() => {}}
                    />
                  ))}
                </div>
              )}

              {/* 冲突的文件 */}
              {groupedFiles.conflicted.length > 0 && (
                <div className="border-b border-white/10">
                  <div className="flex items-center justify-between px-3 py-2 bg-red-500/10">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupedFiles.conflicted.every(f => selectedFiles.has(f.path))}
                        onChange={(e) => selectAllFiles('conflicted', e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-white/10"
                      />
                      <span className="text-xs font-medium text-red-400">
                        冲突的文件 ({groupedFiles.conflicted.length})
                      </span>
                    </div>
                  </div>
                  {groupedFiles.conflicted.map(file => (
                    <FileItem
                      key={file.path}
                      file={file}
                      selected={selectedFiles.has(file.path)}
                      onSelect={(selected) => selectFile(file.path, selected)}
                      onStage={() => stageFiles([file.path])}
                      onUnstage={() => unstageFiles([file.path])}
                      onDiscard={() => {}}
                    />
                  ))}
                </div>
              )}

              {/* 空状态 */}
              {files.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <Check className="w-8 h-8 mb-2" />
                  <p className="text-xs">没有更改</p>
                  <p className="text-[10px] mt-1">工作区干净</p>
                </div>
              )}
            </div>

            {/* 提交输入框 */}
            <div className="p-3 border-t border-white/10 bg-[#1e1e1e]">
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="输入提交信息..."
                className="w-full h-16 px-2 py-1.5 text-xs bg-[#3c3c3c] border border-white/10 rounded resize-none focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
              />
              <div className="flex items-center justify-between mt-2">
                <button
                  onClick={() => setShowStashDialog(true)}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <Stash className="w-3 h-3" />
                  储藏更改
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">
                    {groupedFiles.staged.length} 个文件已暂存
                  </span>
                  <button
                    onClick={handleCommit}
                    disabled={groupedFiles.staged.length === 0 || !commitMessage.trim()}
                    className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded flex items-center gap-1"
                  >
                    <GitCommit className="w-3 h-3" />
                    提交
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 分支标签 */}
        {activeTab === 'branches' && (
          <div className="p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">本地分支</span>
              <button
                onClick={() => setShowNewBranchDialog(true)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                新建分支
              </button>
            </div>
            <div className="space-y-1">
              {branches.map(b => (
                <div
                  key={b.name}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                    b.current ? 'bg-blue-500/20' : 'hover:bg-white/5'
                  }`}
                  onClick={() => !b.current && checkoutBranch(b.name)}
                >
                  <GitBranch className={`w-3 h-3 ${b.current ? 'text-blue-400' : 'text-gray-500'}`} />
                  <span className={`text-xs ${b.current ? 'text-white font-medium' : 'text-gray-300'}`}>
                    {b.name}
                  </span>
                  {b.current && (
                    <span className="ml-auto text-[10px] text-blue-400">当前</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 提交历史标签 */}
        {activeTab === 'commits' && (
          <div className="p-2">
            <div className="space-y-1">
              {commits.map(c => (
                <div key={c.hash} className="flex items-start gap-2 px-2 py-1.5 hover:bg-white/5 rounded">
                  <GitCommit className="w-3 h-3 text-blue-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{c.message}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                      <span>{c.author}</span>
                      <span>•</span>
                      <span>{new Date(c.date).toLocaleDateString()}</span>
                      <span className="font-mono text-gray-600">{c.hash}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stash 标签 */}
        {activeTab === 'stashes' && (
          <div className="p-2">
            <div className="space-y-1">
              {stashes.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-xs">
                  没有储藏的更改
                </div>
              ) : (
                stashes.map(s => (
                  <div key={s.index} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded">
                    <Stash className="w-3 h-3 text-yellow-400" />
                    <div className="flex-1">
                      <p className="text-xs text-white">{s.message}</p>
                      <p className="text-[10px] text-gray-500">{s.hash}</p>
                    </div>
                    <button
                      onClick={() => popStash(s.index)}
                      className="px-2 py-1 text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded"
                    >
                      应用
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 新建分支对话框 */}
      {showNewBranchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#252526] border border-white/10 rounded-lg p-4 w-80">
            <h3 className="text-sm font-medium text-white mb-3">新建分支</h3>
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="分支名称"
              className="w-full px-3 py-2 text-sm bg-[#3c3c3c] border border-white/10 rounded focus:outline-none focus:border-blue-500 text-white"
            />
            <div className="flex items-center gap-2 mt-3">
              <input
                type="checkbox"
                checked={checkoutNewBranch}
                onChange={(e) => setCheckoutNewBranch(e.target.checked)}
                className="w-4 h-4 rounded border-white/20"
              />
              <span className="text-xs text-gray-300">切换到新分支</span>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewBranchDialog(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
                className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stash 对话框 */}
      {showStashDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#252526] border border-white/10 rounded-lg p-4 w-80">
            <h3 className="text-sm font-medium text-white mb-3">储藏更改</h3>
            <input
              type="text"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              placeholder="储藏描述（可选）"
              className="w-full px-3 py-2 text-sm bg-[#3c3c3c] border border-white/10 rounded focus:outline-none focus:border-blue-500 text-white"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowStashDialog(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={handleStash}
                className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded"
              >
                储藏
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GitPanel
