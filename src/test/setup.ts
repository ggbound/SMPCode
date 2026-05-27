import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock window.api for Electron IPC
declare global {
  interface Window {
    api: {
      getConfig?: () => Promise<any>
      saveAllConfig?: (config: Record<string, unknown>) => Promise<boolean>
      executeTool?: (callId: string, toolName: string, args: Record<string, unknown>, cwd: string) => Promise<any>
      saveConversation?: (projectPath: string, sessionId: string, messages: any[], title?: string) => Promise<void>
      loadConversation?: (projectPath: string, sessionId: string) => Promise<any>
      listSessions?: (projectPath: string) => Promise<any>
      deleteSession?: (projectPath: string, sessionId: string) => Promise<void>
      cliChat?: {
        createSession?: (mode: 'chat' | 'agent', cwd: string, initialPrompt?: string) => Promise<any>
        sendMessage?: (sessionId: string, message: string, messages?: any[]) => Promise<any>
        stopSession?: (sessionId: string) => Promise<any>
        deleteSession?: (sessionId: string) => Promise<any>
        onStreamChunk?: (callback: (event: unknown, data: any) => void) => () => void
      }
      selectFolder?: () => Promise<string | null>
      openFile?: () => Promise<string | null>
      showSaveDialog?: (options?: any) => Promise<any>
      getGitStatus?: (repoPath: string) => Promise<any>
      getGitBranches?: (repoPath: string) => Promise<any>
      getGitCommits?: (repoPath: string, count?: number) => Promise<any[]>
    }
  }
}

// Setup window.api mock
Object.defineProperty(window, 'api', {
  value: {
    getConfig: vi.fn(),
    saveAllConfig: vi.fn(),
    executeTool: vi.fn(),
    saveConversation: vi.fn(),
    loadConversation: vi.fn(),
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    cliChat: {
      createSession: vi.fn(),
      sendMessage: vi.fn(),
      stopSession: vi.fn(),
      deleteSession: vi.fn(),
      onStreamChunk: vi.fn(() => vi.fn())
    },
    selectFolder: vi.fn(),
    openFile: vi.fn(),
    showSaveDialog: vi.fn(),
    getGitStatus: vi.fn(),
    getGitBranches: vi.fn(),
    getGitCommits: vi.fn()
  },
  writable: true
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver
})

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver
})

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  return setTimeout(callback, 0) as unknown as number
})

global.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id)
})

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks()
})
