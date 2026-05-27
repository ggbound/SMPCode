import * as fs from 'fs'
import * as path from 'path'
import log from 'electron-log'
import simpleGit, { SimpleGit, StatusResult } from 'simple-git'

export interface GitStatus {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  staged: string[]
  modified: string[]
  untracked: string[]
  conflicted: string[]
  current: string | null
}

let gitInstance: SimpleGit | null = null
let currentRepoPath: string | null = null

// Initialize git instance for a repository
export function initGit(repoPath: string): SimpleGit | null {
  try {
    // Check if .git exists
    const gitDir = path.join(repoPath, '.git')
    if (!fs.existsSync(gitDir)) {
      log.info(`Not a git repository: ${repoPath}`)
      currentRepoPath = null
      return null
    }

    // Initialize or reuse git instance
    if (currentRepoPath !== repoPath || !gitInstance) {
      gitInstance = simpleGit(repoPath)
      currentRepoPath = repoPath
    }

    return gitInstance
  } catch (error) {
    log.error('Failed to initialize git:', error)
    return null
  }
}

// Get git status (async)
export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const defaultStatus: GitStatus = {
    isRepo: false,
    branch: '',
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    conflicted: [],
    current: null
  }

  try {
    const git = initGit(repoPath)
    if (!git) {
      return defaultStatus
    }

    const status = await git.status()

    return {
      isRepo: true,
      branch: status.current || 'unknown',
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added || [],
      conflicted: status.conflicted,
      current: status.current
    }
  } catch (error) {
    log.error('Failed to get git status:', error)
    return defaultStatus
  }
}

// Get git status (sync - uses cached result)
export function getGitStatusSync(repoPath: string): GitStatus {
  const defaultStatus: GitStatus = {
    isRepo: false,
    branch: '',
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    conflicted: [],
    current: null
  }

  try {
    const git = initGit(repoPath)
    if (!git) {
      return defaultStatus
    }

    // Use sync version - simple-git supports sync methods
    const gitSync = simpleGit(repoPath)
    const status: any = gitSync.status()

    return {
      isRepo: true,
      branch: status.current || 'unknown',
      ahead: status.ahead || 0,
      behind: status.behind || 0,
      staged: status.staged || [],
      modified: status.modified || [],
      untracked: status.not_added || [],
      conflicted: status.conflicted || [],
      current: status.current
    }
  } catch (error) {
    log.error('Failed to get git status:', error)
    return defaultStatus
  }
}

// Check if a path is in a git repository
export function isGitRepository(dirPath: string): boolean {
  try {
    const gitDir = path.join(dirPath, '.git')
    return fs.existsSync(gitDir)
  } catch {
    return false
  }
}

// Find the root of a git repository
export function findGitRoot(startPath: string): string | null {
  let currentPath = startPath

  while (currentPath !== path.dirname(currentPath)) {
    const gitDir = path.join(currentPath, '.git')
    if (fs.existsSync(gitDir)) {
      return currentPath
    }
    currentPath = path.dirname(currentPath)
  }

  return null
}

// Get file status (staged, modified, untracked)
export function getFileStatus(repoPath: string, filePath: string): string | null {
  try {
    const git = simpleGit(repoPath)
    const status: any = git.status()

    if (status.staged?.includes(filePath)) return 'staged'
    if (status.modified?.includes(filePath)) return 'modified'
    if (status.not_added?.includes(filePath)) return 'untracked'
    if (status.conflicted?.includes(filePath)) return 'conflicted'

    return 'clean'
  } catch (error) {
    log.error('Failed to get file status:', error)
    return null
  }
}

// Get recent commits
export async function getRecentCommits(repoPath: string, count: number = 10): Promise<Array<{
  hash: string
  message: string
  author: string
  date: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    const logResult = await git.log({ maxCount: count })

    return logResult.all.map(commit => ({
      hash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date
    }))
  } catch (error) {
    log.error('Failed to get recent commits:', error)
    return []
  }
}

// Get branches
export async function getBranches(repoPath: string): Promise<{
  current: string
  all: string[]
  branches: Record<string, { current: boolean; name: string }>
}> {
  try {
    const git = initGit(repoPath)
    if (!git) {
      return { current: '', all: [], branches: {} }
    }

    const branches = await git.branch()

    return {
      current: branches.current,
      all: branches.all,
      branches: branches.branches
    }
  } catch (error) {
    log.error('Failed to get branches:', error)
    return { current: '', all: [], branches: {} }
  }
}

// Stage files
export async function stageFiles(repoPath: string, files: string[]): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.add(files)
    log.info(`Staged files: ${files.join(', ')}`)
    return true
  } catch (error) {
    log.error('Failed to stage files:', error)
    return false
  }
}

// Unstage files
export async function unstageFiles(repoPath: string, files: string[]): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.reset(files)
    log.info(`Unstaged files: ${files.join(', ')}`)
    return true
  } catch (error) {
    log.error('Failed to unstage files:', error)
    return false
  }
}

// Commit changes
export async function commitChanges(repoPath: string, message: string, files?: string[]): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    // If specific files are provided, stage them first
    if (files && files.length > 0) {
      await git.add(files)
    }

    await git.commit(message)
    log.info(`Committed with message: ${message}`)
    return true
  } catch (error) {
    log.error('Failed to commit changes:', error)
    return false
  }
}

// Discard changes (checkout)
export async function discardChanges(repoPath: string, files: string[]): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.checkout(files)
    log.info(`Discarded changes in: ${files.join(', ')}`)
    return true
  } catch (error) {
    log.error('Failed to discard changes:', error)
    return false
  }
}

// Create branch
export async function createBranch(repoPath: string, branchName: string, checkout = true): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.checkoutLocalBranch(branchName)
    log.info(`Created branch: ${branchName}`)
    return true
  } catch (error) {
    log.error('Failed to create branch:', error)
    return false
  }
}

// Checkout branch
export async function checkoutBranch(repoPath: string, branchName: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.checkout(branchName)
    log.info(`Checked out branch: ${branchName}`)
    return true
  } catch (error) {
    log.error('Failed to checkout branch:', error)
    return false
  }
}

// Delete branch
export async function deleteBranch(repoPath: string, branchName: string, force = false): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (force) {
      await git.deleteLocalBranch(branchName, true)
    } else {
      await git.deleteLocalBranch(branchName, false)
    }
    log.info(`Deleted branch: ${branchName}`)
    return true
  } catch (error) {
    log.error('Failed to delete branch:', error)
    return false
  }
}

// Push to remote
export async function push(repoPath: string, remote = 'origin', branch?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    const currentBranch = branch || (await git.status()).current
    await git.push(remote, currentBranch)
    log.info(`Pushed to ${remote}/${currentBranch}`)
    return true
  } catch (error) {
    log.error('Failed to push:', error)
    return false
  }
}

// Pull from remote
export async function pull(repoPath: string, remote = 'origin', branch?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    const currentBranch = branch || (await git.status()).current
    await git.pull(remote, currentBranch)
    log.info(`Pulled from ${remote}/${currentBranch}`)
    return true
  } catch (error) {
    log.error('Failed to pull:', error)
    return false
  }
}

// Get file diff
export async function getFileDiff(repoPath: string, filePath: string, staged = false): Promise<string> {
  try {
    const git = initGit(repoPath)
    if (!git) return ''

    const diff = await git.diff([staged ? '--cached' : '', '--', filePath])
    return diff || ''
  } catch (error) {
    log.error('Failed to get file diff:', error)
    return ''
  }
}

// Get stash list
export async function getStashList(repoPath: string): Promise<Array<{
  index: number
  hash: string
  message: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    const stashList = await git.stashList()
    return stashList.all.map((stash, index) => ({
      index,
      hash: stash.hash.substring(0, 7),
      message: stash.message
    }))
  } catch (error) {
    log.error('Failed to get stash list:', error)
    return []
  }
}

// Stash changes
export async function stashChanges(repoPath: string, message?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (message) {
      await git.stash(['push', '-m', message])
    } else {
      await git.stash(['push'])
    }
    log.info(`Stashed changes${message ? `: ${message}` : ''}`)
    return true
  } catch (error) {
    log.error('Failed to stash changes:', error)
    return false
  }
}

// Pop stash
export async function popStash(repoPath: string, index = 0): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (index === 0) {
      await git.stash(['pop'])
    } else {
      await git.stash(['pop', `stash@{${index}}`])
    }
    log.info(`Popped stash at index ${index}`)
    return true
  } catch (error) {
    log.error('Failed to pop stash:', error)
    return false
  }
}
