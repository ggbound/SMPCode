import { vi } from 'vitest'

/**
 * 创建模拟的 IPC 响应
 */
export function createMockIPCResponse<T>(data: T, success = true): Promise<T> {
  return Promise.resolve(data)
}

/**
 * 创建失败的 IPC 响应
 */
export function createMockIPCError(error: string): Promise<never> {
  return Promise.reject(new Error(error))
}

/**
 * 等待指定时间
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 创建模拟的文件系统条目
 */
export function createMockFileEntry(
  name: string,
  isDirectory = false,
  children: any[] = []
): {
  name: string
  path: string
  isDirectory: boolean
  children: any[]
} {
  return {
    name,
    path: `/mock/path/${name}`,
    isDirectory,
    children
  }
}

/**
 * 创建模拟的消息
 */
export function createMockMessage(
  role: 'user' | 'assistant' | 'system' | 'tool' = 'user',
  content: string = 'Test message'
): {
  role: string
  content: string
  timestamp: number
} {
  return {
    role,
    content,
    timestamp: Date.now()
  }
}

/**
 * 创建模拟的会话
 */
export function createMockSession(
  id: string = `session-${Date.now()}`,
  title: string = 'Test Session'
): {
  id: string
  title: string
  createdAt: string
  messageCount: number
} {
  return {
    id,
    title,
    createdAt: new Date().toISOString(),
    messageCount: 0
  }
}

/**
 * 创建模拟的 Git 状态
 */
export function createMockGitStatus(
  overrides: Partial<{
    isRepo: boolean
    branch: string
    ahead: number
    behind: number
    staged: string[]
    modified: string[]
    untracked: string[]
    conflicted: string[]
  }> = {}
): {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  staged: string[]
  modified: string[]
  untracked: string[]
  conflicted: string[]
} {
  return {
    isRepo: true,
    branch: 'main',
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    conflicted: [],
    ...overrides
  }
}

/**
 * 模拟 Electron API
 */
export function mockElectronAPI(overrides: Partial<Window['api']> = {}): void {
  const defaultMock = {
    getConfig: vi.fn().mockResolvedValue({
      apiKey: 'test-key',
      model: 'claude-3',
      defaultModel: 'claude-3',
      permissionMode: 'workspace-write',
      providers: []
    }),
    saveAllConfig: vi.fn().mockResolvedValue(true),
    executeTool: vi.fn().mockResolvedValue({ success: true, output: 'Test output' }),
    saveConversation: vi.fn().mockResolvedValue(undefined),
    loadConversation: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    cliChat: {
      createSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'test-session' }),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      stopSession: vi.fn().mockResolvedValue({ success: true }),
      deleteSession: vi.fn().mockResolvedValue({ success: true }),
      onStreamChunk: vi.fn().mockReturnValue(vi.fn())
    },
    selectFolder: vi.fn().mockResolvedValue('/test/project'),
    openFile: vi.fn().mockResolvedValue('/test/file.ts'),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/test/saved.ts' }),
    getGitStatus: vi.fn().mockResolvedValue(createMockGitStatus()),
    getGitBranches: vi.fn().mockResolvedValue({
      current: 'main',
      all: ['main', 'develop'],
      branches: {
        main: { current: true, name: 'main' },
        develop: { current: false, name: 'develop' }
      }
    }),
    getGitCommits: vi.fn().mockResolvedValue([]),
    ...overrides
  }

  Object.defineProperty(window, 'api', {
    value: defaultMock,
    writable: true
  })
}

/**
 * 清理 DOM
 */
export function cleanupDOM(): void {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
}

/**
 * 模拟事件
 */
export function createMockEvent(type: string, data: any = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, data)
  return event
}

/**
 * 模拟拖放事件
 */
export function createMockDragEvent(
  type: string,
  data: { dataTransfer?: DataTransfer; [key: string]: any } = {}
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: data.dataTransfer || new DataTransfer()
  })
  Object.assign(event, data)
  return event
}

/**
 * 类型安全的 mock 函数
 */
export function typedMock<T extends (...args: any[]) => any>(
  implementation?: (...args: Parameters<T>) => ReturnType<T>
): T {
  return vi.fn(implementation) as T
}

export default {
  createMockIPCResponse,
  createMockIPCError,
  wait,
  createMockFileEntry,
  createMockMessage,
  createMockSession,
  createMockGitStatus,
  mockElectronAPI,
  cleanupDOM,
  createMockEvent,
  createMockDragEvent,
  typedMock
}
