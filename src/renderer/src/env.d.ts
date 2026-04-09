export {}

interface RunningProcess {
  id: string
  command: string
  isRunning: boolean
  startTime: string
  cwd: string
  terminalId?: string
}

declare global {
  interface Window {
    api: {
      // Config
      getConfig: () => Promise<{
        apiKey: string
        model: string
        permissionMode: string
        defaultModel?: string
        providers?: Array<{ id: string; name: string; apiKey: string; baseUrl: string; enabled: boolean }>
      }>
      setConfig: (key: string, value: unknown) => Promise<boolean>
      saveAllConfig: (config: Record<string, unknown>) => Promise<boolean>
      
      // Sessions
      getSessionsDir: () => Promise<string>
      
      // Commands and Tools
      getCommands: () => Promise<Array<{ name: string; source_hint: string; responsibility: string; description?: string }>>
      getTools: () => Promise<Array<{ name: string; source_hint: string; responsibility: string; description?: string; parameters?: Record<string, unknown>; required?: string[] }>>
      
      // File System
      selectFolder: () => Promise<string | null>
      
      // Updates
      checkForUpdates: () => Promise<unknown>
      
      // Window controls
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      
      // Event listeners
      onNewSession: (callback: () => void) => () => void
      onOpenSession: (callback: () => void) => () => void
      onOpenSettings: (callback: () => void) => () => void
      onUpdateAvailable: (callback: () => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      
      // Terminal APIs
      createTerminal: (options?: { name?: string; cwd?: string; id?: string }) => Promise<{ id: string; name: string }>
      writeTerminal: (id: string, data: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
      killTerminal: (id: string) => Promise<void>
      listTerminals: () => Promise<Array<{ id: string; name: string }>>
      renameTerminal: (id: string, name: string) => Promise<void>
      onTerminalData: (callback: (event: unknown, data: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (event: unknown, data: { id: string; exitCode: number }) => void) => () => void
      onTerminalCreateRequest: (callback: (event: unknown, data: { id: string; cwd?: string; title?: string }) => void) => () => void
      
      // Process management - 支持AI意图
      startProcessInTerminal: (command: string, cwd: string, terminalId: string, aiPrompt?: string) => Promise<{ processId: string; success: boolean; error?: string }>
      stopProcess: (processId: string) => Promise<{ success: boolean; error?: string; actuallyStopped?: boolean }>
      restartProcess: (processId: string) => Promise<{ success: boolean; error?: string; processId?: string }>
      getRunningProcesses: () => Promise<RunningProcess[]>
      shouldRunInTerminal: (command: string) => Promise<boolean>
      
      // AI意图相关API
      getAIIntentContext: (processId: string) => Promise<{ taskType: string; originalPrompt: string } | undefined>
      getProjectAIHistory: (cwd: string) => Promise<Array<{ prompt: string; timestamp: string; taskType: string }>>
      
      // Process event listeners
      onProcessStarted: (callback: (event: unknown, data: { processId: string; command: string; cwd: string; terminalId?: string; aiIntentId?: string; taskType?: string }) => void) => () => void
      onProcessData: (callback: (event: unknown, data: { terminalId: string; processId: string; data: string }) => void) => () => void
      onProcessExit: (callback: (event: unknown, data: { terminalId: string; processId: string; exitCode: number }) => void) => () => void
      onProcessError: (callback: (event: unknown, data: { terminalId: string; processId: string; error: string }) => void) => () => void
    }
  }
}