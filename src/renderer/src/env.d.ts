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
      getConfig: () => Promise<{
        apiKey: string
        model: string
        permissionMode: string
      }>
      setConfig: (key: string, value: unknown) => Promise<boolean>
      saveAllConfig: (config: Record<string, unknown>) => Promise<boolean>
      getSessionsDir: () => Promise<string>
      getCommands: () => Promise<Array<{ name: string; source_hint: string; responsibility: string }>>
      getTools: () => Promise<Array<{ name: string; source_hint: string; responsibility: string }>>
      selectFolder: () => Promise<string | null>
      checkForUpdates: () => Promise<unknown>
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      onNewSession: (callback: () => void) => () => void
      onOpenSession: (callback: () => void) => () => void
      onOpenSettings: (callback: () => void) => () => void
      onUpdateAvailable: (callback: () => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      // Terminal APIs
      createTerminal: (options?: { name?: string; cwd?: string }) => Promise<{ id: string; name: string }>
      writeTerminal: (id: string, data: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
      killTerminal: (id: string) => Promise<void>
      listTerminals: () => Promise<Array<{ id: string; name: string }>>
      renameTerminal: (id: string, name: string) => Promise<void>
      onTerminalData: (callback: (event: unknown, data: { id: string; data: string }) => void) => () => void
      onTerminalExit: (callback: (event: unknown, data: { id: string; exitCode: number }) => void) => () => void
      // Process management
      startProcessInTerminal: (command: string, cwd: string, terminalId: string) => Promise<{ processId: string; success: boolean; error?: string }>
      stopProcess: (processId: string) => Promise<boolean>
      restartProcess: (processId: string) => Promise<boolean>
      // Process management APIs
      getRunningProcesses: () => Promise<RunningProcess[]>
      killProcess: (processId: string) => Promise<boolean>
      shouldRunInTerminal: (command: string) => Promise<boolean>
      onProcessStarted: (callback: (event: unknown, data: { processId: string; command: string; cwd: string; terminalId?: string }) => void) => () => void
      onProcessData: (callback: (event: unknown, data: { terminalId: string; processId: string; data: string }) => void) => () => void
      onProcessExit: (callback: (event: unknown, data: { terminalId: string; processId: string; exitCode: number }) => void) => () => void
      onProcessError: (callback: (event: unknown, data: { terminalId: string; processId: string; error: string }) => void) => () => void
    }
  }
}