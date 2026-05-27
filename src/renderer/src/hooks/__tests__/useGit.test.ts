import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGit } from '../useGit'
import { mockElectronAPI, createMockGitStatus } from '../../../test/utils'

describe('useGit', () => {
  beforeEach(() => {
    mockElectronAPI()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useGit({ repoPath: null }))

      expect(result.current.isRepo).toBe(false)
      expect(result.current.branch).toBe('')
      expect(result.current.files).toEqual([])
      expect(result.current.branches).toEqual([])
      expect(result.current.commits).toEqual([])
      expect(result.current.stashes).toEqual([])
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should refresh when repoPath changes', async () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      await waitFor(() => {
        expect(result.current.isRepo).toBe(true)
      })
    })
  })

  describe('file operations', () => {
    it('should select a file', () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      act(() => {
        result.current.selectFile('/test/file.ts', true)
      })

      expect(result.current.selectedFiles.has('/test/file.ts')).toBe(true)
    })

    it('should deselect a file', () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      act(() => {
        result.current.selectFile('/test/file.ts', true)
        result.current.selectFile('/test/file.ts', false)
      })

      expect(result.current.selectedFiles.has('/test/file.ts')).toBe(false)
    })

    it('should select all files by status', () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      // Mock files
      act(() => {
        result.current.stageFiles(['/test/file1.ts'])
        result.current.stageFiles(['/test/file2.ts'])
      })

      act(() => {
        result.current.selectAllFiles('staged', true)
      })

      expect(result.current.selectedFiles.size).toBeGreaterThan(0)
    })
  })

  describe('commit operations', () => {
    it('should set commit message', () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      act(() => {
        result.current.setCommitMessage('Test commit')
      })

      expect(result.current.commitMessage).toBe('Test commit')
    })

    it('should fail commit without message', async () => {
      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.commit()
      })

      expect(success).toBe(false)
      expect(result.current.error).toContain('请输入提交信息')
    })

    it('should commit with message', async () => {
      const mockCommit = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitCommit: mockCommit
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      act(() => {
        result.current.setCommitMessage('Test commit')
      })

      let success = false
      await act(async () => {
        success = await result.current.commit()
      })

      expect(success).toBe(true)
      expect(result.current.commitMessage).toBe('')
    })
  })

  describe('branch operations', () => {
    it('should create a branch', async () => {
      const mockCreateBranch = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitCreateBranch: mockCreateBranch
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.createBranch('feature-branch', true)
      })

      expect(success).toBe(true)
      expect(mockCreateBranch).toHaveBeenCalledWith('/test/repo', 'feature-branch', true)
    })

    it('should checkout a branch', async () => {
      const mockCheckoutBranch = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitCheckoutBranch: mockCheckoutBranch
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.checkoutBranch('develop')
      })

      expect(success).toBe(true)
      expect(mockCheckoutBranch).toHaveBeenCalledWith('/test/repo', 'develop')
    })

    it('should delete a branch', async () => {
      const mockDeleteBranch = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitDeleteBranch: mockDeleteBranch
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.deleteBranch('old-branch', false)
      })

      expect(success).toBe(true)
      expect(mockDeleteBranch).toHaveBeenCalledWith('/test/repo', 'old-branch', false)
    })
  })

  describe('remote operations', () => {
    it('should push to remote', async () => {
      const mockPush = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitPush: mockPush
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.push('origin', 'main')
      })

      expect(success).toBe(true)
      expect(mockPush).toHaveBeenCalledWith('/test/repo', 'origin', 'main')
    })

    it('should pull from remote', async () => {
      const mockPull = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitPull: mockPull
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.pull('origin', 'main')
      })

      expect(success).toBe(true)
      expect(mockPull).toHaveBeenCalledWith('/test/repo', 'origin', 'main')
    })
  })

  describe('stash operations', () => {
    it('should stash changes', async () => {
      const mockStash = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitStash: mockStash
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.stash('WIP: test changes')
      })

      expect(success).toBe(true)
      expect(mockStash).toHaveBeenCalledWith('/test/repo', 'WIP: test changes')
    })

    it('should pop stash', async () => {
      const mockStashPop = vi.fn().mockResolvedValue(true)
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitStashPop: mockStashPop
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.popStash(0)
      })

      expect(success).toBe(true)
      expect(mockStashPop).toHaveBeenCalledWith('/test/repo', 0)
    })
  })

  describe('diff operations', () => {
    it('should get file diff', async () => {
      const mockDiff = vi.fn().mockResolvedValue('@@ -1,1 +1,1 @@\n-test\n+modified')
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitDiff: mockDiff
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let diff = ''
      await act(async () => {
        diff = await result.current.getDiff('/test/file.ts', false)
      })

      expect(diff).toContain('@@')
      expect(mockDiff).toHaveBeenCalledWith('/test/repo', '/test/file.ts', false)
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockPush = vi.fn().mockRejectedValue(new Error('Network error'))
      Object.defineProperty(window, 'api', {
        value: {
          ...((window as any).api || {}),
          gitPush: mockPush
        },
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.push()
      })

      expect(success).toBe(false)
      expect(result.current.error).toBeDefined()
    })

    it('should handle missing API gracefully', async () => {
      Object.defineProperty(window, 'api', {
        value: {},
        writable: true
      })

      const { result } = renderHook(() => useGit({ repoPath: '/test/repo' }))

      let success = false
      await act(async () => {
        success = await result.current.push()
      })

      expect(success).toBe(false)
    })
  })
})
