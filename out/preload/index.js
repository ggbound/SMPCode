"use strict";
const electron = require("electron");
const api = {
  // Config
  getConfig: () => electron.ipcRenderer.invoke("get-config"),
  setConfig: (key, value) => electron.ipcRenderer.invoke("set-config", key, value),
  saveAllConfig: (config) => electron.ipcRenderer.invoke("save-all-config", config),
  // Sessions
  getSessionsDir: () => electron.ipcRenderer.invoke("get-sessions-dir"),
  // Commands and Tools
  getCommands: () => electron.ipcRenderer.invoke("get-commands"),
  getTools: () => electron.ipcRenderer.invoke("get-tools"),
  // File System
  selectFolder: () => electron.ipcRenderer.invoke("select-folder"),
  // Updates
  checkForUpdates: () => electron.ipcRenderer.invoke("check-for-updates"),
  // Window controls
  minimizeWindow: () => electron.ipcRenderer.send("minimize-window"),
  maximizeWindow: () => electron.ipcRenderer.send("maximize-window"),
  closeWindow: () => electron.ipcRenderer.send("close-window"),
  // Terminal
  createTerminal: (options) => electron.ipcRenderer.invoke("terminal:create", options),
  writeTerminal: (id, data) => electron.ipcRenderer.invoke("terminal:write", { id, data }),
  resizeTerminal: (id, cols, rows) => electron.ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  killTerminal: (id) => electron.ipcRenderer.invoke("terminal:kill", { id }),
  listTerminals: () => electron.ipcRenderer.invoke("terminal:list"),
  renameTerminal: (id, name) => electron.ipcRenderer.invoke("terminal:rename", { id, name }),
  // Event listeners
  onNewSession: (callback) => {
    electron.ipcRenderer.on("new-session", callback);
    return () => electron.ipcRenderer.removeListener("new-session", callback);
  },
  onOpenSession: (callback) => {
    electron.ipcRenderer.on("open-session", callback);
    return () => electron.ipcRenderer.removeListener("open-session", callback);
  },
  onOpenSettings: (callback) => {
    electron.ipcRenderer.on("open-settings", callback);
    return () => electron.ipcRenderer.removeListener("open-settings", callback);
  },
  onUpdateAvailable: (callback) => {
    electron.ipcRenderer.on("update-available", callback);
    return () => electron.ipcRenderer.removeListener("update-available", callback);
  },
  onUpdateDownloaded: (callback) => {
    electron.ipcRenderer.on("update-downloaded", callback);
    return () => electron.ipcRenderer.removeListener("update-downloaded", callback);
  },
  onTerminalData: (callback) => {
    electron.ipcRenderer.on("terminal:data", callback);
    return () => electron.ipcRenderer.removeListener("terminal:data", callback);
  },
  onTerminalExit: (callback) => {
    electron.ipcRenderer.on("terminal:exit", callback);
    return () => electron.ipcRenderer.removeListener("terminal:exit", callback);
  },
  onTerminalCreateRequest: (callback) => {
    electron.ipcRenderer.on("terminal:create", callback);
    return () => electron.ipcRenderer.removeListener("terminal:create", callback);
  },
  // Process management - 支持AI意图
  startProcessInTerminal: (command, cwd, terminalId, aiPrompt) => electron.ipcRenderer.invoke("process:start-in-terminal", { command, cwd, terminalId, aiPrompt }),
  stopProcess: (processId) => electron.ipcRenderer.invoke("process:stop", { processId }),
  restartProcess: (processId) => electron.ipcRenderer.invoke("process:restart", { processId }),
  getRunningProcesses: () => electron.ipcRenderer.invoke("process:list"),
  shouldRunInTerminal: (command) => electron.ipcRenderer.invoke("process:should-run-in-terminal", { command }),
  // AI意图相关API
  getAIIntentContext: (processId) => electron.ipcRenderer.invoke("process:get-ai-intent", { processId }),
  getProjectAIHistory: (cwd) => electron.ipcRenderer.invoke("process:get-ai-history", { cwd }),
  // Conversation storage - TRAE风格项目级对话存储
  saveConversation: (projectPath, sessionId, messages, sessionTitle) => electron.ipcRenderer.invoke("conversation:save", { projectPath, sessionId, messages, sessionTitle }),
  loadConversation: (projectPath, sessionId) => electron.ipcRenderer.invoke("conversation:load", { projectPath, sessionId }),
  listSessions: (projectPath) => electron.ipcRenderer.invoke("conversation:list-sessions", { projectPath }),
  deleteSession: (projectPath, sessionId) => electron.ipcRenderer.invoke("conversation:delete-session", { projectPath, sessionId }),
  autoSaveAllSessions: (projectPath, sessions) => electron.ipcRenderer.invoke("conversation:auto-save-all", { projectPath, sessions }),
  // Process event listeners - 支持AI意图数据
  onProcessStarted: (callback) => {
    electron.ipcRenderer.on("process:started", callback);
    return () => electron.ipcRenderer.removeListener("process:started", callback);
  },
  onProcessData: (callback) => {
    electron.ipcRenderer.on("terminal:process-data", callback);
    return () => electron.ipcRenderer.removeListener("terminal:process-data", callback);
  },
  onProcessExit: (callback) => {
    electron.ipcRenderer.on("terminal:process-exit", callback);
    return () => electron.ipcRenderer.removeListener("terminal:process-exit", callback);
  },
  onProcessError: (callback) => {
    electron.ipcRenderer.on("terminal:process-error", callback);
    return () => electron.ipcRenderer.removeListener("terminal:process-error", callback);
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
