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

    const currentBranch = branch || (await git.status()).current || 'main'
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

    const currentBranch = branch || (await git.status()).current || 'main'
    await git.pull(remote, currentBranch)
    log.info(`Pulled from ${remote}/${currentBranch}`)
    return true
  } catch (error) {
    log.error('Failed to pull:', error)
    return false
  }
}

// Get file diff (working directory vs HEAD)
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

// Get commit file diff (specific commit vs its parent)
export async function getCommitFileDiff(repoPath: string, filePath: string, commitHash: string): Promise<string> {
  try {
    const git = initGit(repoPath)
    if (!git) return ''

    // Get diff between commit and its parent for specific file
    // Format: git diff <parent-commit> <commit-hash> -- <file-path>
    const diff = await git.diff([`${commitHash}^..${commitHash}`, '--', filePath])
    return diff || ''
  } catch (error) {
    log.error('Failed to get commit file diff:', error)
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

// ==================== Remote Branch Management ====================

// Fetch from remote
export async function fetchRemote(repoPath: string, remote = 'origin'): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.fetch(remote)
    log.info(`Fetched from ${remote}`)
    return true
  } catch (error) {
    log.error('Failed to fetch:', error)
    return false
  }
}

// Get remote branches
export async function getRemoteBranches(repoPath: string): Promise<Array<{
  name: string
  remote: string
  branch: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    const branches = await git.branch(['-r'])
    return branches.all.map(branchName => {
      const parts = branchName.split('/')
      const remote = parts[0]
      const branch = parts.slice(1).join('/')
      return {
        name: branchName,
        remote,
        branch
      }
    })
  } catch (error) {
    log.error('Failed to get remote branches:', error)
    return []
  }
}

// Delete remote branch
export async function deleteRemoteBranch(repoPath: string, remote: string, branch: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.raw(['push', remote, '--delete', branch])
    log.info(`Deleted remote branch ${remote}/${branch}`)
    return true
  } catch (error) {
    log.error('Failed to delete remote branch:', error)
    return false
  }
}

// Get remotes list
export async function getRemotes(repoPath: string): Promise<Array<{
  name: string
  url: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    const remotes = await git.getRemotes(true)
    return remotes.map(r => ({
      name: r.name,
      url: r.refs.fetch || r.refs.push || ''
    }))
  } catch (error) {
    log.error('Failed to get remotes:', error)
    return []
  }
}

// ==================== Merge Operations ====================

// Merge branch
export async function mergeBranch(repoPath: string, branchName: string, noFastForward = false): Promise<{
  success: boolean
  error?: string
  hasConflicts?: boolean
}> {
  try {
    const git = initGit(repoPath)
    if (!git) return { success: false, error: 'Not a git repository' }

    const options = noFastForward ? ['--no-ff'] : []
    await git.merge([branchName, ...options])
    log.info(`Merged branch: ${branchName}`)
    return { success: true }
  } catch (error: any) {
    log.error('Failed to merge branch:', error)
    const errorMessage = String(error)

    // Check if there are conflicts
    if (errorMessage.includes('CONFLICT') || errorMessage.includes('conflict')) {
      return { success: false, error: errorMessage, hasConflicts: true }
    }

    return { success: false, error: errorMessage }
  }
}

// Check for merge conflicts
export async function checkMergeConflicts(repoPath: string): Promise<{
  hasConflicts: boolean
  conflictedFiles: string[]
}> {
  try {
    const git = initGit(repoPath)
    if (!git) return { hasConflicts: false, conflictedFiles: [] }

    const status = await git.status()
    const conflictedFiles = status.conflicted || []

    return {
      hasConflicts: conflictedFiles.length > 0,
      conflictedFiles
    }
  } catch (error) {
    log.error('Failed to check merge conflicts:', error)
    return { hasConflicts: false, conflictedFiles: [] }
  }
}

// Abort merge
export async function abortMerge(repoPath: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.raw(['merge', '--abort'])
    log.info('Aborted merge')
    return true
  } catch (error) {
    log.error('Failed to abort merge:', error)
    return false
  }
}

// Continue merge (after resolving conflicts)
export async function continueMerge(repoPath: string, message?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    // Stage all resolved files
    await git.add('.')

    // Commit with custom message or default
    if (message) {
      await git.commit(message)
    } else {
      await git.raw(['commit', '-m', 'Merge commit'])
    }

    log.info('Continued merge')
    return true
  } catch (error) {
    log.error('Failed to continue merge:', error)
    return false
  }
}

// ==================== Tag Management ====================

// Get tags
export async function getTags(repoPath: string): Promise<Array<{
  name: string
  hash: string
  message: string
  date: string
  author: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    const tags = await git.tag(['-l', '-n1'])
    const tagList: Array<{
      name: string
      hash: string
      message: string
      date: string
      author: string
    }> = []

    // Get detailed info for each tag
    const tagNames = tags.split('\n').filter(t => t.trim())
    for (const tagLine of tagNames) {
      const tagName = tagLine.split(' ')[0]
      try {
        const logResult = await git.log({ from: tagName, to: tagName, maxCount: 1 })
        if (logResult.latest) {
          tagList.push({
            name: tagName,
            hash: logResult.latest.hash.substring(0, 7),
            message: logResult.latest.message,
            date: logResult.latest.date,
            author: logResult.latest.author_name
          })
        }
      } catch {
        // Tag might be lightweight, get the commit it points to
        try {
          const showResult = await git.show(['--no-patch', '--format=%H|%an|%ad|%s', tagName])
          const parts = showResult.split('|')
          if (parts.length >= 4) {
            tagList.push({
              name: tagName,
              hash: parts[0].substring(0, 7),
              message: parts[3],
              date: parts[2],
              author: parts[1]
            })
          }
        } catch {
          // Skip tags we can't parse
        }
      }
    }

    return tagList
  } catch (error) {
    log.error('Failed to get tags:', error)
    return []
  }
}

// Create tag
export async function createTag(repoPath: string, tagName: string, message?: string, commitHash?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (message) {
      // Annotated tag
      const target = commitHash || 'HEAD'
      await git.tag(['-a', tagName, target, '-m', message])
    } else {
      // Lightweight tag
      const target = commitHash || 'HEAD'
      await git.tag([tagName, target])
    }

    log.info(`Created tag: ${tagName}`)
    return true
  } catch (error) {
    log.error('Failed to create tag:', error)
    return false
  }
}

// Delete tag
export async function deleteTag(repoPath: string, tagName: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.tag(['-d', tagName])
    log.info(`Deleted tag: ${tagName}`)
    return true
  } catch (error) {
    log.error('Failed to delete tag:', error)
    return false
  }
}

// Push tag to remote
export async function pushTag(repoPath: string, tagName: string, remote = 'origin'): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.push(remote, tagName)
    log.info(`Pushed tag ${tagName} to ${remote}`)
    return true
  } catch (error) {
    log.error('Failed to push tag:', error)
    return false
  }
}

// Push all tags to remote
export async function pushAllTags(repoPath: string, remote = 'origin'): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.push(remote, '--tags')
    log.info(`Pushed all tags to ${remote}`)
    return true
  } catch (error) {
    log.error('Failed to push all tags:', error)
    return false
  }
}

// ==================== Commit History Operations ====================

// Revert commit
export async function revertCommit(repoPath: string, commitHash: string, noEdit = false): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (noEdit) {
      await git.raw(['revert', '--no-edit', commitHash])
    } else {
      await git.raw(['revert', commitHash])
    }
    log.info(`Reverted commit: ${commitHash}`)
    return true
  } catch (error) {
    log.error('Failed to revert commit:', error)
    return false
  }
}

// Reset to commit (soft, mixed, hard)
export async function resetToCommit(
  repoPath: string,
  commitHash: string,
  mode: 'soft' | 'mixed' | 'hard' = 'mixed'
): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    const resetMode = mode === 'mixed' ? '--mixed' : `--${mode}`
    await git.reset([resetMode, commitHash])
    log.info(`Reset to commit ${commitHash} with mode ${mode}`)
    return true
  } catch (error) {
    log.error('Failed to reset commit:', error)
    return false
  }
}

// Cherry-pick commit
export async function cherryPickCommit(repoPath: string, commitHash: string, noCommit = false): Promise<{
  success: boolean
  error?: string
  hasConflicts?: boolean
}> {
  try {
    const git = initGit(repoPath)
    if (!git) return { success: false, error: 'Not a git repository' }

    const options = noCommit ? ['-n'] : []
    await git.raw(['cherry-pick', ...options, commitHash])
    log.info(`Cherry-picked commit: ${commitHash}`)
    return { success: true }
  } catch (error: any) {
    log.error('Failed to cherry-pick commit:', error)
    const errorMessage = String(error)

    // Check if there are conflicts
    if (errorMessage.includes('CONFLICT') || errorMessage.includes('conflict')) {
      return { success: false, error: errorMessage, hasConflicts: true }
    }

    return { success: false, error: errorMessage }
  }
}

// Abort cherry-pick
export async function abortCherryPick(repoPath: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.raw(['cherry-pick', '--abort'])
    log.info('Aborted cherry-pick')
    return true
  } catch (error) {
    log.error('Failed to abort cherry-pick:', error)
    return false
  }
}

// Continue cherry-pick (after resolving conflicts)
export async function continueCherryPick(repoPath: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    await git.raw(['cherry-pick', '--continue'])
    log.info('Continued cherry-pick')
    return true
  } catch (error) {
    log.error('Failed to continue cherry-pick:', error)
    return false
  }
}

// Get commit details
export async function getCommitDetails(repoPath: string, commitHash: string): Promise<{
  hash: string
  message: string
  author: string
  email: string
  date: string
  body: string
  files: string[]
} | null> {
  try {
    const git = initGit(repoPath)
    if (!git) return null

    // Use show to get commit info and files in one command
    const showResult = await git.show(['--name-only', '--pretty=format:%H|%s|%an|%ae|%ad|%b', commitHash])
    
    if (!showResult) return null

    const lines = showResult.split('\n')
    const headerLine = lines[0]
    const [hash, message, author, email, date, ...bodyParts] = headerLine.split('|')
    
    if (!hash) return null

    // Get files from remaining lines
    const files = lines.slice(1).filter(f => f.trim())

    return {
      hash,
      message,
      author,
      email,
      date,
      body: bodyParts.join('\n') || '',
      files
    }
  } catch (error) {
    log.error('Failed to get commit details:', error)
    return null
  }
}

// ==================== Submodule Management ====================

// Get submodules
export async function getSubmodules(repoPath: string): Promise<Array<{
  name: string
  path: string
  url: string
  branch?: string
  commit?: string
}>> {
  try {
    const git = initGit(repoPath)
    if (!git) return []

    // Read .gitmodules file
    const gitmodulesPath = path.join(repoPath, '.gitmodules')
    if (!fs.existsSync(gitmodulesPath)) {
      return []
    }

    const content = fs.readFileSync(gitmodulesPath, 'utf-8')
    const submodules: Array<{
      name: string
      path: string
      url: string
      branch?: string
      commit?: string
    }> = []

    // Parse .gitmodules
    const submoduleRegex = /\[submodule "([^"]+)"\]([^[]*)/g
    let match
    while ((match = submoduleRegex.exec(content)) !== null) {
      const name = match[1]
      const section = match[2]

      const pathMatch = section.match(/path\s*=\s*(.+)/)
      const urlMatch = section.match(/url\s*=\s*(.+)/)
      const branchMatch = section.match(/branch\s*=\s*(.+)/)

      if (pathMatch && urlMatch) {
        const submodulePath = pathMatch[1].trim()
        const submoduleUrl = urlMatch[1].trim()
        const submoduleBranch = branchMatch ? branchMatch[1].trim() : undefined

        // Get current commit of submodule
        let commit: string | undefined
        try {
          const submoduleGitPath = path.join(repoPath, submodulePath, '.git')
          if (fs.existsSync(submoduleGitPath)) {
            const submoduleGit = simpleGit(path.join(repoPath, submodulePath))
            const logResult = await submoduleGit.log({ maxCount: 1 })
            commit = logResult.latest?.hash.substring(0, 7)
          }
        } catch {
          // Submodule might not be initialized
        }

        submodules.push({
          name,
          path: submodulePath,
          url: submoduleUrl,
          branch: submoduleBranch,
          commit
        })
      }
    }

    return submodules
  } catch (error) {
    log.error('Failed to get submodules:', error)
    return []
  }
}

// Add submodule
export async function addSubmodule(repoPath: string, url: string, submodulePath: string, branch?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (branch) {
      await git.raw(['submodule', 'add', '-b', branch, url, submodulePath])
    } else {
      await git.raw(['submodule', 'add', url, submodulePath])
    }
    log.info(`Added submodule: ${submodulePath} from ${url}`)
    return true
  } catch (error) {
    log.error('Failed to add submodule:', error)
    return false
  }
}

// Remove submodule
export async function removeSubmodule(repoPath: string, submodulePath: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    // Deinitialize submodule
    await git.raw(['submodule', 'deinit', '-f', submodulePath])

    // Remove from .git/modules
    const gitModulesPath = path.join(repoPath, '.git', 'modules', submodulePath)
    if (fs.existsSync(gitModulesPath)) {
      fs.rmSync(gitModulesPath, { recursive: true, force: true })
    }

    // Remove from index
    await git.raw(['rm', '-f', submodulePath])

    log.info(`Removed submodule: ${submodulePath}`)
    return true
  } catch (error) {
    log.error('Failed to remove submodule:', error)
    return false
  }
}

// Update submodule
export async function updateSubmodule(repoPath: string, submodulePath?: string, init = false): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    const options = init ? ['--init'] : []
    if (submodulePath) {
      await git.subModule(['update', ...options, '--', submodulePath])
    } else {
      await git.subModule(['update', ...options, '--recursive'])
    }

    log.info(`Updated submodule${submodulePath ? `: ${submodulePath}` : 's'}`)
    return true
  } catch (error) {
    log.error('Failed to update submodule:', error)
    return false
  }
}

// Sync submodule
export async function syncSubmodule(repoPath: string, submodulePath?: string): Promise<boolean> {
  try {
    const git = initGit(repoPath)
    if (!git) return false

    if (submodulePath) {
      await git.subModule(['sync', '--', submodulePath])
    } else {
      await git.subModule(['sync'])
    }

    log.info(`Synced submodule${submodulePath ? `: ${submodulePath}` : 's'}`)
    return true
  } catch (error) {
    log.error('Failed to sync submodule:', error)
    return false
  }
}
