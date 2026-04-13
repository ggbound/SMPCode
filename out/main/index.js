"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const express = require("express");
const uuid = require("uuid");
const child_process = require("child_process");
const util = require("util");
const events = require("events");
const pty = require("node-pty");
const os = require("os");
const Store = require("electron-store");
const commander = require("commander");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const OPENAI_API_URL = "https://coding.dashscope.aliyuncs.com/v1/chat/completions";
const ANTHROPIC_API_URL = "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages";
const ANTHROPIC_MODELS = [
  "claude-3-5-sonnet",
  "claude-3-7-sonnet"
];
function isAnthropicModel(model) {
  return ANTHROPIC_MODELS.some((m) => model.toLowerCase().includes(m.toLowerCase()));
}
async function sendChatMessage(request) {
  const { apiKey, model, messages, tools, stream = false } = request;
  if (isAnthropicModel(model)) {
    return sendAnthropicMessage(apiKey, model, messages, tools, stream);
  } else {
    return sendOpenAIMessage(apiKey, model, messages, tools, stream);
  }
}
async function sendOpenAIMessage(apiKey, model, messages, tools, stream = false) {
  const requestBody = {
    model,
    messages,
    max_tokens: 8192,
    stream
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }
  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const message = data.choices[0]?.message;
    const content = message?.content || "";
    const toolCalls = message?.tool_calls;
    const result = {
      id: data.id,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: content }],
      model: data.model,
      stop_reason: data.choices[0]?.finish_reason || "stop",
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0
      }
    };
    if (toolCalls && toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }
    return result;
  } catch (error) {
    log.error("OpenAI API error:", error);
    throw error;
  }
}
async function sendAnthropicMessage(apiKey, model, messages, tools, stream = false) {
  const requestBody = {
    model,
    messages,
    max_tokens: 8192,
    stream
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const result = {
      id: data.id,
      type: data.type || "message",
      role: data.role || "assistant",
      content: data.content || [{ type: "text", text: data.choices?.[0]?.message?.content || "" }],
      model: data.model,
      stop_reason: data.stop_reason || data.choices?.[0]?.finish_reason || "stop",
      usage: {
        input_tokens: data.usage?.input_tokens || data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.output_tokens || data.usage?.completion_tokens || 0
      }
    };
    if (data.tool_calls) {
      result.tool_calls = data.tool_calls;
    } else if (data.choices?.[0]?.message?.tool_calls) {
      result.tool_calls = data.choices[0].message.tool_calls;
    }
    return result;
  } catch (error) {
    log.error("Anthropic API error:", error);
    throw error;
  }
}
async function* streamChatMessage(request) {
  const { apiKey, model, messages, tools } = request;
  if (isAnthropicModel(model)) {
    yield* streamAnthropicMessage(apiKey, model, messages);
  } else {
    yield* streamOpenAIMessage(apiKey, model, messages);
  }
}
async function* streamOpenAIMessage(apiKey, model, messages, tools) {
  const requestBody = {
    model,
    messages,
    max_tokens: 8192,
    stream: true
  };
  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            yield {
              type: "content_block_delta",
              delta: { type: "text", text: parsed.choices[0]?.delta?.content || "" }
            };
          } catch (e) {
          }
        }
      }
    }
  } catch (error) {
    log.error("OpenAI Stream API error:", error);
    throw error;
  }
}
async function* streamAnthropicMessage(apiKey, model, messages, tools) {
  const requestBody = {
    model,
    messages,
    max_tokens: 8192,
    stream: true
  };
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            yield parsed;
          } catch (e) {
          }
        }
      }
    }
  } catch (error) {
    log.error("Anthropic Stream API error:", error);
    throw error;
  }
}
let instance$1 = null;
let cachedCommands = [];
function getResourcesPath$1() {
  const devPath = path.join(__dirname, "../../../../resources");
  const devReferencePath = path.join(devPath, "reference_data", "commands_snapshot.json");
  if (fs__namespace.existsSync(devReferencePath)) {
    return devPath;
  }
  return path.join(__dirname, "../../resources");
}
class CommandsService {
  resourcesPath;
  constructor() {
    this.resourcesPath = getResourcesPath$1();
    this.loadCommands();
  }
  /**
   * Load commands from reference data
   */
  loadCommands() {
    try {
      const commandsPath = path.join(this.resourcesPath, "reference_data", "commands_snapshot.json");
      if (fs__namespace.existsSync(commandsPath)) {
        const data = fs__namespace.readFileSync(commandsPath, "utf-8");
        cachedCommands = JSON.parse(data);
        log.info(`CommandsService: Loaded ${cachedCommands.length} commands`);
      } else {
        log.warn("CommandsService: commands_snapshot.json not found");
        cachedCommands = [];
      }
    } catch (error) {
      log.error("CommandsService: Failed to load commands:", error);
      cachedCommands = [];
    }
  }
  /**
   * Get all commands
   */
  getAll() {
    return cachedCommands;
  }
  /**
   * Get command count
   */
  getCount() {
    return cachedCommands.length;
  }
  /**
   * Search commands by query
   */
  search(query) {
    let results = [...cachedCommands];
    const limit = query.limit || 20;
    const searchQuery = query.query?.toLowerCase() || "";
    if (searchQuery) {
      results = results.filter(
        (cmd) => cmd.name.toLowerCase().includes(searchQuery) || cmd.source_hint.toLowerCase().includes(searchQuery) || cmd.responsibility?.toLowerCase().includes(searchQuery)
      );
    }
    return {
      count: results.length,
      commands: results.slice(0, limit)
    };
  }
  /**
   * Get command by exact name
   */
  getByName(name) {
    return cachedCommands.find((cmd) => cmd.name.toLowerCase() === name.toLowerCase());
  }
  /**
   * Get commands by prefix
   */
  getByPrefix(prefix, limit = 10) {
    const lowerPrefix = prefix.toLowerCase();
    return cachedCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(lowerPrefix)).slice(0, limit);
  }
  /**
   * Reload commands from disk
   */
  reload() {
    this.loadCommands();
  }
}
function getCommandsService() {
  if (!instance$1) {
    instance$1 = new CommandsService();
  }
  return instance$1;
}
let instance = null;
let cachedTools = [];
function getResourcesPath() {
  const devPath = path.join(__dirname, "../../../../resources");
  const devReferencePath = path.join(devPath, "reference_data", "tools_snapshot.json");
  if (fs__namespace.existsSync(devReferencePath)) {
    return devPath;
  }
  return path.join(__dirname, "../../resources");
}
class ToolsService {
  resourcesPath;
  constructor() {
    this.resourcesPath = getResourcesPath();
    this.loadTools();
  }
  /**
   * Load tools from reference data
   */
  loadTools() {
    try {
      const toolsPath = path.join(this.resourcesPath, "reference_data", "tools_snapshot.json");
      if (fs__namespace.existsSync(toolsPath)) {
        const data = fs__namespace.readFileSync(toolsPath, "utf-8");
        cachedTools = JSON.parse(data);
        log.info(`ToolsService: Loaded ${cachedTools.length} tools`);
      } else {
        log.warn("ToolsService: tools_snapshot.json not found");
        cachedTools = [];
      }
    } catch (error) {
      log.error("ToolsService: Failed to load tools:", error);
      cachedTools = [];
    }
  }
  /**
   * Get all tools
   */
  getAll() {
    return cachedTools;
  }
  /**
   * Get tool count
   */
  getCount() {
    return cachedTools.length;
  }
  /**
   * Search tools by query
   */
  search(query) {
    let results = [...cachedTools];
    const limit = query.limit || 20;
    const searchQuery = query.query?.toLowerCase() || "";
    if (searchQuery) {
      results = results.filter(
        (tool) => tool.name.toLowerCase().includes(searchQuery) || tool.source_hint.toLowerCase().includes(searchQuery) || tool.responsibility?.toLowerCase().includes(searchQuery)
      );
    }
    return {
      count: results.length,
      tools: results.slice(0, limit)
    };
  }
  /**
   * Get tool by exact name
   */
  getByName(name) {
    return cachedTools.find((tool) => tool.name.toLowerCase() === name.toLowerCase());
  }
  /**
   * Get tools by category (by source_hint prefix)
   */
  getByCategory(category, limit = 20) {
    const lowerCategory = category.toLowerCase();
    return cachedTools.filter((tool) => tool.source_hint.toLowerCase().includes(lowerCategory)).slice(0, limit);
  }
  /**
   * Get tools that match a pattern in name
   */
  getByPattern(pattern, limit = 20) {
    return cachedTools.filter((tool) => pattern.test(tool.name)).slice(0, limit);
  }
  /**
   * Reload tools from disk
   */
  reload() {
    this.loadTools();
  }
}
function getToolsService() {
  if (!instance) {
    instance = new ToolsService();
  }
  return instance;
}
const execPromise$1 = util.promisify(child_process.exec);
const platform = process.platform;
const isWindows = platform === "win32";
const isMacOS = platform === "darwin";
function getShellCommand() {
  if (isWindows) return "cmd.exe";
  if (isMacOS) return "/bin/zsh";
  return "/bin/bash";
}
function getShellArgs(command) {
  if (isWindows) return ["/c", command];
  return ["-c", command];
}
let currentWorkingDirectory = process.cwd();
function setCurrentWorkingDirectory(dir) {
  currentWorkingDirectory = dir;
}
function getCurrentWorkingDirectory() {
  return currentWorkingDirectory;
}
function parseArgs(prompt) {
  const args = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}
async function executeAddDir(args) {
  try {
    const dirName = args[0];
    if (!dirName) {
      return { success: false, output: "", error: "Directory name is required" };
    }
    const targetPath = path__namespace.resolve(currentWorkingDirectory, dirName);
    if (fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Directory already exists: ${dirName}` };
    }
    fs__namespace.mkdirSync(targetPath, { recursive: true });
    return { success: true, output: `Created directory: ${targetPath}` };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeClear() {
  return { success: true, output: "Screen cleared" };
}
async function executeLs(args) {
  try {
    const targetPath = args[0] ? path__namespace.resolve(currentWorkingDirectory, args[0]) : currentWorkingDirectory;
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Path does not exist: ${args[0] || "."}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (!stats.isDirectory()) {
      return { success: false, output: "", error: `Not a directory: ${args[0] || "."}` };
    }
    const items = fs__namespace.readdirSync(targetPath);
    const output = items.filter((item) => !item.startsWith(".") && item !== "node_modules").map((item) => {
      const itemPath = path__namespace.join(targetPath, item);
      const itemStats = fs__namespace.statSync(itemPath);
      const type = itemStats.isDirectory() ? "d" : "-";
      const size = itemStats.isFile() ? ` ${formatBytes(itemStats.size)}` : "";
      return `${type} ${item}${size}`;
    }).join("\n");
    return { success: true, output: output || "(empty directory)" };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executePwd() {
  return { success: true, output: currentWorkingDirectory };
}
async function executeCd(args) {
  try {
    const dirName = args[0];
    if (!dirName) {
      return { success: false, output: "", error: "Directory path is required" };
    }
    const targetPath = path__namespace.resolve(currentWorkingDirectory, dirName);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Directory does not exist: ${dirName}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (!stats.isDirectory()) {
      return { success: false, output: "", error: `Not a directory: ${dirName}` };
    }
    currentWorkingDirectory = targetPath;
    return { success: true, output: `Changed directory to: ${targetPath}` };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeCat(args) {
  try {
    const filePath = args[0];
    if (!filePath) {
      return { success: false, output: "", error: "File path is required" };
    }
    const targetPath = path__namespace.resolve(currentWorkingDirectory, filePath);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `File does not exist: ${filePath}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (stats.isDirectory()) {
      return { success: false, output: "", error: `Is a directory: ${filePath}` };
    }
    const content = fs__namespace.readFileSync(targetPath, "utf-8");
    return { success: true, output: content };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeRm(args) {
  try {
    const target = args[0];
    if (!target) {
      return { success: false, output: "", error: "Path is required" };
    }
    const targetPath = path__namespace.resolve(currentWorkingDirectory, target);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Path does not exist: ${target}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (stats.isDirectory()) {
      fs__namespace.rmdirSync(targetPath, { recursive: true });
      return { success: true, output: `Removed directory: ${targetPath}` };
    } else {
      fs__namespace.unlinkSync(targetPath);
      return { success: true, output: `Removed file: ${targetPath}` };
    }
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeTouch(args) {
  try {
    const fileName = args[0];
    if (!fileName) {
      return { success: false, output: "", error: "File name is required" };
    }
    const targetPath = path__namespace.resolve(currentWorkingDirectory, fileName);
    if (!fs__namespace.existsSync(targetPath)) {
      fs__namespace.writeFileSync(targetPath, "", "utf-8");
      return { success: true, output: `Created file: ${targetPath}` };
    } else {
      const now = /* @__PURE__ */ new Date();
      fs__namespace.utimesSync(targetPath, now, now);
      return { success: true, output: `Updated timestamp: ${targetPath}` };
    }
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeBash(args) {
  try {
    const command = args.join(" ");
    if (!command) {
      return { success: false, output: "", error: "Command is required" };
    }
    const shell = getShellCommand();
    const shellArgs = getShellArgs(command);
    log.info(`Executing on ${platform}: ${shell} ${shellArgs.join(" ")}`);
    const pathDirs = [
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      `${process.env.HOME}/.local/bin`,
      `${process.env.HOME}/bin`,
      `${process.env.HOME}/.npm-global/bin`,
      "/usr/local/share/npm/bin",
      process.env.PATH || ""
    ].filter(Boolean);
    const env = {
      ...process.env,
      PATH: pathDirs.join(":")
    };
    log.info(`[executeBash] PATH: ${env.PATH}`);
    const { stdout, stderr } = await execPromise$1(`${shell} ${shellArgs.map((a) => `"${a}"`).join(" ")}`, {
      cwd: currentWorkingDirectory,
      timeout: 6e4,
      env
    });
    return {
      success: !stderr,
      output: stdout || "(no output)",
      error: stderr || void 0
    };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeGit(args) {
  return executeBash(["git", ...args]);
}
async function executeNpm(args) {
  return executeBash(["npm", ...args]);
}
const MIRRORED_COMMANDS = [
  "agents",
  "branch",
  "btw",
  "docker",
  "build",
  "test",
  "deploy",
  "advisor",
  "ant-trace",
  "autofix-pr",
  "backfill-sessions",
  "break-cache",
  "bridge",
  "bridge-kick",
  "brief",
  "bughunter",
  "chrome",
  "claw",
  "commit",
  "config",
  "context",
  "cost",
  "create-agent",
  "create-skill",
  "dashboard",
  "debug",
  "diff",
  "doctor",
  "edit",
  "explain",
  "fetch",
  "fix",
  "glob",
  "grep",
  "help",
  "history",
  "init",
  "install",
  "lint",
  "list",
  "load",
  "log",
  "merge",
  "migrate",
  "mode",
  "move",
  "open",
  "optimize",
  "patch",
  "plan",
  "plugin",
  "port",
  "preview",
  "profile",
  "pr",
  "push",
  "query",
  "read",
  "refactor",
  "release",
  "remote",
  "rename",
  "replace",
  "report",
  "review",
  "run",
  "save",
  "search",
  "serve",
  "session",
  "set",
  "setup",
  "show",
  "skill",
  "start",
  "status",
  "stop",
  "sync",
  "task",
  "teleport",
  "test",
  "todo",
  "tool",
  "trace",
  "undo",
  "update",
  "upgrade",
  "validate",
  "verify",
  "version",
  "view",
  "watch",
  "write"
];
function isMirroredCommand(name) {
  return MIRRORED_COMMANDS.includes(name.toLowerCase());
}
async function executeCommand$1(commandName, prompt) {
  log.info(`Executing command: ${commandName}, prompt: ${prompt}`);
  const parts = parseArgs(prompt);
  const args = parts.slice(1);
  const lowerCommand = commandName.toLowerCase();
  switch (lowerCommand) {
    case "add-dir":
      return executeAddDir(args);
    case "clear":
    case "cls":
      return executeClear();
    case "ls":
    case "dir":
      return executeLs(args);
    case "pwd":
      return executePwd();
    case "cd":
      return executeCd(args);
    case "cat":
    case "type":
      return executeCat(args);
    case "rm":
    case "del":
      return executeRm(args);
    case "touch":
      return executeTouch(args);
    case "bash":
    case "sh":
    case "cmd":
      return executeBash(args);
    case "git":
      return executeGit(args);
    case "npm":
      return executeNpm(args);
    default:
      if (isMirroredCommand(commandName)) {
        log.info(`Executing mirrored command via bash: ${prompt}`);
        return executeBash(parts);
      }
      return {
        success: false,
        output: "",
        error: `Command "${commandName}" is not implemented yet. Available commands: add-dir, ls, pwd, cd, cat, rm, touch, clear, bash, git, npm, and mirrored commands (agents, branch, btw, etc.)`
      };
  }
}
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function listDirectory(dirPath) {
  try {
    if (!fs__namespace.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }
    const stats = fs__namespace.statSync(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }
    const items = fs__namespace.readdirSync(dirPath);
    const nodes = [];
    for (const item of items) {
      if (item.startsWith(".") || item === "node_modules") {
        continue;
      }
      const itemPath = path__namespace.join(dirPath, item);
      try {
        const itemStats = fs__namespace.statSync(itemPath);
        nodes.push({
          name: item,
          path: itemPath,
          isDirectory: itemStats.isDirectory()
        });
      } catch (e) {
        log.warn(`Failed to stat ${itemPath}:`, e);
      }
    }
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  } catch (error) {
    log.error("Failed to list directory:", error);
    throw error;
  }
}
function readFile(filePath) {
  try {
    if (!fs__namespace.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    const stats = fs__namespace.statSync(filePath);
    if (stats.isDirectory()) {
      throw new Error(`Is a directory: ${filePath}`);
    }
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error(`File too large: ${filePath}`);
    }
    return fs__namespace.readFileSync(filePath, "utf-8");
  } catch (error) {
    log.error("Failed to read file:", error);
    throw error;
  }
}
function writeFile(filePath, content) {
  try {
    const parentDir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(parentDir)) {
      fs__namespace.mkdirSync(parentDir, { recursive: true });
    }
    fs__namespace.writeFileSync(filePath, content, "utf-8");
  } catch (error) {
    log.error("Failed to write file:", error);
    throw error;
  }
}
let ToolRegistry$1 = class ToolRegistry {
  tools = /* @__PURE__ */ new Map();
  middlewares = [];
  /**
   * 注册工具
   */
  register(tool) {
    this.tools.set(tool.name, tool);
    log.info(`[ToolRegistry] Registered tool: ${tool.name}`);
  }
  /**
   * 注销工具
   */
  unregister(name) {
    this.tools.delete(name);
    log.info(`[ToolRegistry] Unregistered tool: ${name}`);
  }
  /**
   * 获取工具
   */
  get(name) {
    return this.tools.get(name);
  }
  /**
   * 获取所有工具
   */
  getAll() {
    return Array.from(this.tools.values());
  }
  /**
   * 检查工具是否存在
   */
  has(name) {
    return this.tools.has(name);
  }
  /**
   * 获取工具数量
   */
  count() {
    return this.tools.size;
  }
  /**
   * 转换为 OpenAI 格式的工具定义
   */
  toOpenAIDefinitions() {
    return this.getAll().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters,
          required: tool.required
        }
      }
    }));
  }
  /**
   * 添加中间件
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }
  /**
   * 获取中间件
   */
  getMiddlewares() {
    return [...this.middlewares];
  }
  /**
   * 清空所有工具和中间件
   */
  clear() {
    this.tools.clear();
    this.middlewares = [];
  }
};
const toolRegistry$1 = new ToolRegistry$1();
async function executeToolWithMiddleware(toolName, args, context) {
  const tool = toolRegistry$1.get(toolName);
  if (!tool) {
    return {
      success: false,
      output: "",
      error: `Unknown tool: ${toolName}`,
      metadata: {
        toolName,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  const middlewares = toolRegistry$1.getMiddlewares();
  const middlewareContext = {
    toolName,
    args,
    executionContext: context
  };
  let index = 0;
  const executeNext = async () => {
    if (index < middlewares.length) {
      const middleware = middlewares[index++];
      return middleware(middlewareContext, executeNext);
    }
    const startTime = Date.now();
    const result = await tool.execute(args, context);
    const executionTime = Date.now() - startTime;
    return {
      ...result,
      metadata: {
        ...result.metadata,
        executionTime,
        toolName,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  };
  return executeNext();
}
function validateToolArgs(toolName, args, executor) {
  const errors = [];
  for (const required of executor.required) {
    if (executor.name === "search_code" && required === "pattern") {
      if (!("pattern" in args && args.pattern !== void 0 && args.pattern !== null || "query" in args && args.query !== void 0 && args.query !== null)) {
        errors.push(`Missing required parameter: pattern (or query)`);
      }
    } else if (!(required in args) || args[required] === void 0 || args[required] === null) {
      errors.push(`Missing required parameter: ${required}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (executor.name === "search_code" && key === "query") {
      continue;
    }
    const paramDef = executor.parameters[key];
    if (!paramDef) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }
    if (paramDef.type === "string" && typeof value !== "string") {
      errors.push(`Parameter ${key} must be a string`);
    } else if (paramDef.type === "number" && typeof value !== "number") {
      errors.push(`Parameter ${key} must be a number`);
    } else if (paramDef.type === "boolean" && typeof value !== "boolean") {
      errors.push(`Parameter ${key} must be a boolean`);
    } else if (paramDef.type === "array" && !Array.isArray(value)) {
      errors.push(`Parameter ${key} must be an array`);
    } else if (paramDef.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      errors.push(`Parameter ${key} must be an object`);
    }
    if (paramDef.enum && !paramDef.enum.includes(String(value))) {
      errors.push(`Parameter ${key} must be one of: ${paramDef.enum.join(", ")}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
function formatToolResult(result) {
  if (result.success) {
    return result.output;
  }
  return `Error: ${result.error || "Unknown error"}`;
}
function toToolResult(toolCallId, toolName, result) {
  return {
    tool_call_id: toolCallId,
    role: "tool",
    name: toolName,
    content: formatToolResult(result)
  };
}
function parseToolCallsFromText(text) {
  const toolCalls = [];
  const codeBlockCalls = parseCodeBlocks(text);
  toolCalls.push(...codeBlockCalls);
  const inlineCalls = parseInlineJSON(text);
  toolCalls.push(...inlineCalls);
  const seen = /* @__PURE__ */ new Set();
  return toolCalls.filter((tc) => {
    const key = `${tc.tool}:${JSON.stringify(tc.arguments)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function parseCodeBlocks(text) {
  const calls = [];
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (isValidToolCall(parsed)) {
        calls.push({ tool: parsed.tool, arguments: parsed.arguments });
        continue;
      }
    } catch (e) {
    }
    const lines = blockContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isValidToolCall(parsed)) {
          calls.push({ tool: parsed.tool, arguments: parsed.arguments });
        }
      } catch (e) {
        const jsonMatch = extractJSONObject(trimmed);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch);
            if (isValidToolCall(parsed)) {
              calls.push({ tool: parsed.tool, arguments: parsed.arguments });
            }
          } catch (e2) {
          }
        }
      }
    }
  }
  return calls;
}
function parseInlineJSON(text) {
  const calls = [];
  const jsonObjectRegex = /\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
  let match;
  while ((match = jsonObjectRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (isValidToolCall(parsed)) {
        calls.push({ tool: parsed.tool, arguments: parsed.arguments });
      }
    } catch (e) {
    }
  }
  return calls;
}
function isValidToolCall(obj) {
  return typeof obj === "object" && obj !== null && "tool" in obj && typeof obj.tool === "string" && "arguments" in obj && typeof obj.arguments === "object" && obj.arguments !== null;
}
function extractJSONObject(text) {
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) return null;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") braceCount++;
      else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          return text.substring(jsonStart, i + 1);
        }
      }
    }
  }
  return null;
}
function createExecutionContext(cwd, options) {
  return {
    cwd,
    sessionId: options?.sessionId,
    userId: options?.userId,
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    startTime: Date.now(),
    metadata: options?.metadata
  };
}
function createSuccessResult(output, metadata) {
  return {
    success: true,
    output,
    metadata
  };
}
function createErrorResult(error, output = "", metadata) {
  return {
    success: false,
    output,
    error,
    metadata
  };
}
const toolsCore = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createErrorResult,
  createExecutionContext,
  createSuccessResult,
  executeToolWithMiddleware,
  formatToolResult,
  parseToolCallsFromText,
  toToolResult,
  toolRegistry: toolRegistry$1,
  validateToolArgs
}, Symbol.toStringTag, { value: "Module" }));
const terminals = /* @__PURE__ */ new Map();
let windowRef = null;
function getShell() {
  if (process.platform === "win32") {
    return { command: "powershell.exe", args: [] };
  }
  if (process.platform === "darwin") {
    const possibleShells2 = [
      process.env.SHELL,
      "/bin/zsh",
      "/bin/bash",
      "/usr/local/bin/zsh",
      "/usr/local/bin/bash",
      "/opt/homebrew/bin/zsh",
      "/opt/homebrew/bin/bash"
    ];
    for (const shell of possibleShells2) {
      if (shell && fs.existsSync(shell)) {
        log.info(`Using macOS shell: ${shell}`);
        return { command: shell, args: [] };
      }
    }
    log.warn("No shell found, falling back to /bin/zsh");
    return { command: "/bin/zsh", args: [] };
  }
  const possibleShells = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/usr/bin/zsh",
    "/usr/bin/bash"
  ];
  for (const shell of possibleShells) {
    if (shell && fs.existsSync(shell)) {
      log.info(`Using shell: ${shell}`);
      return { command: shell, args: [] };
    }
  }
  log.warn("No shell found, falling back to /bin/bash");
  return { command: "/bin/bash", args: [] };
}
function getSafeCwd(cwd) {
  if (cwd && fs.existsSync(cwd)) {
    return cwd;
  }
  try {
    const pcwd = process.cwd();
    if (fs.existsSync(pcwd)) {
      return pcwd;
    }
  } catch (e) {
  }
  const home = os.homedir();
  if (home && fs.existsSync(home)) {
    return home;
  }
  return "/";
}
function initTerminalService(mainWindow2) {
  windowRef = mainWindow2;
  electron.ipcMain.handle("terminal:create", async (_, options) => {
    try {
      const id = options?.id || uuid.v4();
      const shellConfig = getShell();
      const cwd = getSafeCwd(options?.cwd);
      log.info(`Creating terminal with command: ${shellConfig.command}, args: ${JSON.stringify(shellConfig.args)}, cwd: ${cwd}`);
      if (!fs.existsSync(shellConfig.command)) {
        throw new Error(`Shell not found: ${shellConfig.command}`);
      }
      const env = { ...process.env };
      const pathDirs = [
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/opt/homebrew/bin",
        path.join(os.homedir(), ".local", "bin"),
        path.join(os.homedir(), "bin")
      ];
      const currentPath = env.PATH || "";
      const newPath = [...pathDirs, ...currentPath.split(":")].filter(Boolean).join(":");
      env.PATH = newPath;
      log.info(`Creating PTY with cwd: ${cwd}, shell: ${shellConfig.command}`);
      const spawnOptions = {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd,
        env
      };
      let ptyProcess;
      try {
        if (process.platform === "darwin" && shellConfig.args.length === 0) {
          ptyProcess = pty__namespace.spawn(shellConfig.command, [], spawnOptions);
        } else {
          ptyProcess = pty__namespace.spawn(shellConfig.command, shellConfig.args, spawnOptions);
        }
      } catch (spawnError) {
        log.warn(`Failed to spawn with default options, trying fallback: ${spawnError}`);
        const fallbackShell = process.env.SHELL || "/bin/bash";
        ptyProcess = pty__namespace.spawn(fallbackShell, [], spawnOptions);
      }
      const session = {
        id,
        name: options?.name || `Terminal ${terminals.size + 1}`,
        pty: ptyProcess,
        createdAt: /* @__PURE__ */ new Date(),
        outputBuffer: [],
        onDataCallbacks: /* @__PURE__ */ new Set()
      };
      terminals.set(id, session);
      ptyProcess.onData((data) => {
        session.outputBuffer.push(data);
        if (session.outputBuffer.length > 1e4) {
          session.outputBuffer = session.outputBuffer.slice(-5e3);
        }
        session.onDataCallbacks.forEach((callback) => callback(data));
        if (windowRef && !windowRef.isDestroyed()) {
          windowRef.webContents.send("terminal:data", { id, data });
        }
      });
      ptyProcess.onExit(({ exitCode }) => {
        log.info(`Terminal ${id} exited with code ${exitCode}`);
        if (windowRef && !windowRef.isDestroyed()) {
          windowRef.webContents.send("terminal:exit", { id, exitCode });
        }
        terminals.delete(id);
      });
      log.info(`Created terminal ${id} with shell ${shellConfig.command}`);
      return { id, name: session.name };
    } catch (error) {
      log.error("Failed to create terminal:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("terminal:write", async (_, { id, data }) => {
    const session = terminals.get(id);
    if (session) {
      session.pty.write(data);
    }
  });
  electron.ipcMain.handle("terminal:resize", async (_, { id, cols, rows }) => {
    const session = terminals.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  });
  electron.ipcMain.handle("terminal:kill", async (_, { id }) => {
    const session = terminals.get(id);
    if (session) {
      session.pty.kill();
      terminals.delete(id);
      log.info(`Killed terminal ${id}`);
    }
  });
  electron.ipcMain.handle("terminal:list", async () => {
    return Array.from(terminals.values()).map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt
    }));
  });
  electron.ipcMain.handle("terminal:rename", async (_, { id, name }) => {
    const session = terminals.get(id);
    if (session) {
      session.name = name;
    }
  });
}
function cleanupTerminals() {
  for (const [id, session] of terminals) {
    try {
      session.pty.kill();
      log.info(`Cleaned up terminal ${id}`);
    } catch (error) {
      log.error(`Failed to cleanup terminal ${id}:`, error);
    }
  }
  terminals.clear();
}
function getTerminals() {
  return terminals;
}
function writeToTerminal(id, data) {
  const session = terminals.get(id);
  if (session) {
    session.pty.write(data);
    return true;
  }
  return false;
}
function onTerminalData(id, callback) {
  const session = terminals.get(id);
  if (session) {
    session.onDataCallbacks.add(callback);
    return () => {
      session.onDataCallbacks.delete(callback);
    };
  }
  return null;
}
const TERMINAL_PROCESS_PATTERNS = [
  /npm\s+(run|start|dev|serve)/i,
  /npm\s+run\s+\w+/i,
  /npm\s+(install|i|add|remove|uninstall|ci)/i,
  /node\s+/i,
  /npx\s+/i,
  /yarn\s+(run|start|dev|serve|install|add|remove)/i,
  /pnpm\s+(run|start|dev|serve|install|add|remove)/i,
  /python\w*\s+/i,
  /pip\s+/i,
  /^java\s+/i,
  /^mvn\w*\s+/i,
  /^gradle\w*\s+/i,
  /^go\s+(run|build|test)/i,
  /^cargo\s+(run|build|test)/i,
  /^docker\s+(run|up|compose)/i,
  /^docker-compose\s+/i,
  /^\.\/\w+\.sh/i,
  /^bash\s+\w+\.sh/i,
  /^vite\s+/i,
  /^webpack\s+/i,
  /^next\s+/i,
  /^nuxt\s+/i,
  /^vue-cli-service\s+/i,
  /^react-scripts\s+/i,
  /^start\.sh/i,
  /^dev\.sh/i,
  /^run\.sh/i,
  /^server\.sh/i,
  /^\.\/start/i,
  /^\.\/dev/i,
  /^\.\/run/i,
  /^\.\/server/i
];
class ProcessTerminalBridge extends events.EventEmitter {
  processes = /* @__PURE__ */ new Map();
  windowRef = null;
  commandTypeMap = /* @__PURE__ */ new Map();
  aiIntents = /* @__PURE__ */ new Map();
  setWindow(window) {
    this.windowRef = window;
  }
  // 推断任务类型
  inferTaskType(command) {
    const cmd = command.toLowerCase();
    if (/npm\s+run\s+dev|vite|next\s+dev|nuxt\s+dev/.test(cmd)) return "dev-server";
    if (/npm\s+run\s+build|vite\s+build|next\s+build/.test(cmd)) return "build";
    if (/npm\s+test|jest|vitest|pytest/.test(cmd)) return "test";
    if (/npm\s+run\s+start|serve/.test(cmd)) return "production-server";
    if (/docker.*up|docker-compose/.test(cmd)) return "docker-deploy";
    if (/pip\s+install|npm\s+install|yarn\s+install/.test(cmd)) return "install";
    return "command";
  }
  // 推断项目类型
  inferProjectType(command) {
    const cmd = command.toLowerCase();
    if (/npm|yarn|pnpm|node|vite|next|nuxt/.test(cmd)) return "node";
    if (/python|pip|uvicorn|fastapi|flask/.test(cmd)) return "python";
    if (/java|mvn|gradle/.test(cmd)) return "java";
    if (/go\s+/.test(cmd)) return "go";
    if (/cargo|rust/.test(cmd)) return "rust";
    if (/docker/.test(cmd)) return "docker";
    return "unknown";
  }
  // 提取命令类型键
  getCommandTypeKey(command, cwd) {
    const projectName = cwd.split("/").pop() || cwd;
    const commandPart = this.extractCommandPart(command);
    if (/npm\s+run\s+dev|npm\s+run\s+serve|npm\s+run\s+start/i.test(commandPart)) {
      return `${projectName}:npm-dev`;
    }
    if (/npm\s+run\s+\w+/i.test(commandPart)) {
      const match = commandPart.match(/npm\s+run\s+(\w+)/i);
      return `${projectName}:npm-${match?.[1] || "run"}`;
    }
    if (/vite/i.test(commandPart)) {
      return `${projectName}:vite`;
    }
    if (/node\s+.*server|ts-node.*server|node\s+dist\/index/i.test(commandPart)) {
      return `${projectName}:server`;
    }
    if (/docker.*up|docker-compose.*up/i.test(commandPart)) {
      return `${projectName}:docker`;
    }
    return `${projectName}:${commandPart.split(" ")[0]}`;
  }
  // 提取实际命令部分
  extractCommandPart(command) {
    const cdMatch = command.match(/^cd\s+\S+\s*(&&|;|\n)\s*(.+)$/);
    if (cdMatch) {
      return cdMatch[2].trim();
    }
    return command.trim();
  }
  // 获取显示名称
  getCommandDisplayName(command) {
    const commandPart = this.extractCommandPart(command);
    const projectMatch = command.match(/cd\s+(?:.*?\/)*([^/]+)\s*&&/);
    const projectName = projectMatch ? projectMatch[1] : "";
    if (/npm\s+run\s+dev|vite/i.test(commandPart)) {
      return projectName ? `${projectName} (dev)` : "Dev Server";
    }
    if (/npm\s+run\s+start|npm\s+run\s+serve/i.test(commandPart)) {
      return projectName ? `${projectName} (start)` : "Start Server";
    }
    if (/node.*server|ts-node.*server/i.test(commandPart)) {
      return projectName ? `${projectName} (server)` : "Server";
    }
    const firstWord = commandPart.split(" ")[0];
    return projectName ? `${projectName} (${firstWord})` : firstWord;
  }
  // 检查命令是否应在终端运行
  shouldRunInTerminal(command) {
    const commandPart = this.extractCommandPart(command);
    return TERMINAL_PROCESS_PATTERNS.some((pattern) => pattern.test(commandPart));
  }
  // 提取端口
  extractPort(command) {
    const portMatch = command.match(/:(\d+)/);
    return portMatch ? parseInt(portMatch[1]) : void 0;
  }
  // 创建AI意图
  createAIIntent(originalPrompt, command, cwd) {
    const projectName = cwd.split("/").pop() || cwd;
    const intent = {
      intentId: `intent-${uuid.v4()}`,
      originalPrompt,
      taskType: this.inferTaskType(command),
      projectContext: {
        name: projectName,
        path: cwd,
        type: this.inferProjectType(command)
      },
      expectedOutcome: "long-running-service",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastAccessedAt: (/* @__PURE__ */ new Date()).toISOString(),
      accessCount: 0
    };
    this.aiIntents.set(intent.intentId, intent);
    return intent;
  }
  // 启动进程
  async startProcess(command, cwd, terminalId, aiPrompt) {
    try {
      const commandTypeKey = this.getCommandTypeKey(command, cwd);
      log.info(`[ProcessBridge] Starting process: ${commandTypeKey}`);
      const existingProcessId = this.commandTypeMap.get(commandTypeKey);
      if (existingProcessId) {
        const existingProcess = this.processes.get(existingProcessId);
        if (existingProcess) {
          const isRunning = await this.isProcessActuallyRunning(existingProcessId);
          if (isRunning) {
            log.info(`[ProcessBridge] Reusing existing process: ${existingProcessId}`);
            return { processId: existingProcessId, success: true, reused: true };
          } else {
            log.info(`[ProcessBridge] Cleaning up stopped process: ${existingProcessId}`);
            this.cleanupProcessRecord(existingProcessId);
          }
        } else {
          this.commandTypeMap.delete(commandTypeKey);
        }
      }
      const processId = uuid.v4();
      const port = this.extractPort(command);
      let targetTerminalId = terminalId;
      const expectedTerminalId = `terminal-${commandTypeKey}`;
      if (!targetTerminalId) {
        const terminals22 = getTerminals();
        if (terminals22.has(expectedTerminalId)) {
          targetTerminalId = expectedTerminalId;
          log.info(`[ProcessBridge] Reusing existing terminal: ${targetTerminalId}, stopping any existing process`);
          await this.stopTerminalProcess(targetTerminalId);
          await new Promise((resolve) => setTimeout(resolve, 800));
        } else if (this.windowRef && !this.windowRef.isDestroyed()) {
          this.windowRef.webContents.send("terminal:create", {
            id: expectedTerminalId,
            cwd,
            title: this.getCommandDisplayName(command)
          });
          targetTerminalId = expectedTerminalId;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      const terminals2 = getTerminals();
      if (!targetTerminalId || !terminals2.has(targetTerminalId)) {
        return { processId: "", success: false, error: "Failed to create terminal" };
      }
      const doubleCheckProcessId = this.commandTypeMap.get(commandTypeKey);
      if (doubleCheckProcessId && doubleCheckProcessId !== processId) {
        const doubleCheckProcess = this.processes.get(doubleCheckProcessId);
        if (doubleCheckProcess) {
          const isRunning = await this.isProcessActuallyRunning(doubleCheckProcessId);
          if (isRunning) {
            log.info(`[ProcessBridge] Found running process during double-check: ${doubleCheckProcessId}`);
            return { processId: doubleCheckProcessId, success: true, reused: true };
          }
        }
      }
      const managedProcess = {
        id: processId,
        command,
        output: [`$ ${command}`, `Working directory: ${cwd}`, "---"],
        isRunning: true,
        startTime: (/* @__PURE__ */ new Date()).toISOString(),
        cwd,
        terminalId: targetTerminalId,
        aiIntent: aiPrompt ? this.createAIIntent(aiPrompt, command, cwd) : void 0,
        commandTypeKey,
        port
      };
      this.processes.set(processId, managedProcess);
      this.commandTypeMap.set(commandTypeKey, processId);
      if (targetTerminalId) {
        const unsubscribe = onTerminalData(targetTerminalId, (data) => {
          managedProcess.output.push(data);
          if (managedProcess.output.length > 1e4) {
            managedProcess.output = managedProcess.output.slice(-5e3);
          }
        });
        managedProcess.unsubscribeTerminal = unsubscribe;
      }
      const foregroundCommand = command.replace(/\s*>\s*[^&]+?\s*2>&1\s*&?\s*$/, "").replace(/\s*>\s*[^&]+?\s*&?\s*$/, "").replace(/\s*2>&1\s*&?\s*$/, "").replace(/\s*&\s*$/, "").trim();
      writeToTerminal(targetTerminalId, "\n");
      await new Promise((resolve) => setTimeout(resolve, 200));
      log.info(`[ProcessBridge] Executing command in terminal: ${foregroundCommand}`);
      writeToTerminal(targetTerminalId, `${foregroundCommand}
`);
      if (this.windowRef && !this.windowRef.isDestroyed()) {
        this.windowRef.webContents.send("process:started", {
          processId,
          command,
          cwd,
          terminalId: targetTerminalId,
          aiIntentId: managedProcess.aiIntent?.intentId,
          taskType: managedProcess.aiIntent?.taskType
        });
      }
      log.info(`[ProcessBridge] Process started: ${processId}`);
      return { processId, success: true, reused: false };
    } catch (error) {
      log.error("[ProcessBridge] Failed to start process:", error);
      return { processId: "", success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  // 停止进程 - 确保真正停止
  async stopProcess(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return { success: false, error: "Process not found" };
    }
    if (!managedProcess.isRunning) {
      this.cleanupProcessRecord(processId);
      return { success: true, actuallyStopped: true };
    }
    try {
      log.info(`[ProcessBridge] Stopping process: ${processId}, command: ${managedProcess.command}`);
      const { terminalId, port, cwd, command, commandTypeKey } = managedProcess;
      if (terminalId) {
        const terminals2 = getTerminals();
        if (terminals2.has(terminalId)) {
          log.info(`[ProcessBridge] Sending Ctrl+C to terminal: ${terminalId}`);
          for (let i = 0; i < 3; i++) {
            writeToTerminal(terminalId, "");
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          writeToTerminal(terminalId, "\n");
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        } else {
          log.warn(`[ProcessBridge] Terminal ${terminalId} not found during stop`);
        }
      }
      let actuallyStopped = true;
      if (port) {
        const portInUse = await this.checkPortInUse(port);
        if (portInUse) {
          log.warn(`[ProcessBridge] Port ${port} still in use, force killing`);
          await this.killProcessByPort(port);
          await new Promise((resolve) => setTimeout(resolve, 1e3));
          const stillInUse = await this.checkPortInUse(port);
          actuallyStopped = !stillInUse;
        }
      }
      await this.forceKillByCommand(command, cwd);
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      if (port && actuallyStopped) {
        const stillInUse = await this.checkPortInUse(port);
        actuallyStopped = !stillInUse;
      }
      managedProcess.isRunning = false;
      managedProcess.output.push("\n--- Process stopped ---\n");
      this.commandTypeMap.delete(commandTypeKey);
      log.info(`[ProcessBridge] Removed commandTypeKey mapping: ${commandTypeKey}`);
      log.info(`[ProcessBridge] Process ${processId} stopped: ${actuallyStopped}`);
      return { success: actuallyStopped, actuallyStopped };
    } catch (error) {
      log.error(`[ProcessBridge] Failed to stop process ${processId}:`, error);
      managedProcess.isRunning = false;
      this.commandTypeMap.delete(managedProcess.commandTypeKey);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  // 重启进程
  async restartProcess(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return { processId: "", success: false, error: "Process not found" };
    }
    const { command, cwd, terminalId, aiIntent, commandTypeKey } = managedProcess;
    log.info(`[ProcessBridge] Restarting process ${processId}`);
    const stopResult = await this.stopProcess(processId);
    if (!stopResult.success) {
      log.error(`[ProcessBridge] Failed to stop process for restart:`, stopResult.error);
    }
    this.commandTypeMap.delete(commandTypeKey);
    log.info(`[ProcessBridge] Deleted commandTypeKey for restart: ${commandTypeKey}`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const terminals2 = getTerminals();
    let targetTerminalId = terminalId;
    if (targetTerminalId && !terminals2.has(targetTerminalId)) {
      log.info(`[ProcessBridge] Terminal ${targetTerminalId} no longer exists, will create new`);
      targetTerminalId = void 0;
    }
    log.info(`[ProcessBridge] Starting new process after restart: ${command}`);
    const result = await this.startProcess(
      command,
      cwd,
      targetTerminalId,
      aiIntent?.originalPrompt
    );
    if (result.success) {
      log.info(`[ProcessBridge] Restart successful, new process: ${result.processId}`);
    } else {
      log.error(`[ProcessBridge] Restart failed:`, result.error);
    }
    return result;
  }
  // 获取所有进程
  getAllProcesses() {
    this.cleanupInvalidProcesses();
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      command: p.command,
      isRunning: p.isRunning,
      startTime: p.startTime,
      cwd: p.cwd,
      terminalId: p.terminalId,
      aiIntent: p.aiIntent
    }));
  }
  // 获取进程输出
  getProcessOutput(processId) {
    const managedProcess = this.processes.get(processId);
    return managedProcess ? managedProcess.output : null;
  }
  // 获取特定进程
  getProcess(processId) {
    return this.processes.get(processId);
  }
  // 等待进程执行完成
  async waitForProcess(processId, timeoutMs = 12e4) {
    const startTime = Date.now();
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return { success: false, output: "", error: "Process not found" };
    }
    log.info(`[ProcessBridge] Waiting for process ${processId} to complete (timeout: ${timeoutMs}ms)`);
    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        log.warn(`[ProcessBridge] Process ${processId} timed out after ${timeoutMs}ms`);
        const unsubscribe = managedProcess.unsubscribeTerminal;
        if (unsubscribe) {
          unsubscribe();
        }
        return {
          success: false,
          output: managedProcess.output.join("\n"),
          error: `Process timed out after ${timeoutMs}ms`,
          exitCode: -1
        };
      }
      const isRunning = await this.isProcessActuallyRunning(processId);
      if (!isRunning) {
        const unsubscribe = managedProcess.unsubscribeTerminal;
        if (unsubscribe) {
          unsubscribe();
          log.info(`[ProcessBridge] Unsubscribed terminal data for process ${processId}`);
        }
        const exitCode = managedProcess.exitCode ?? 0;
        const output = managedProcess.output.join("\n");
        log.info(`[ProcessBridge] Process ${processId} completed with exit code ${exitCode}, output length: ${output.length}`);
        return {
          success: exitCode === 0,
          output: output || "(no output)",
          exitCode
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // 获取AI意图上下文
  getAIIntentContext(processId) {
    const process2 = this.processes.get(processId);
    return process2?.aiIntent;
  }
  // 清理所有进程
  cleanupAll() {
    for (const [id, managedProcess] of this.processes) {
      if (managedProcess.isRunning && managedProcess.terminalId) {
        this.stopProcess(id).catch((err) => {
          log.error(`[ProcessBridge] Failed to cleanup process ${id}:`, err);
        });
      }
    }
    this.processes.clear();
    this.commandTypeMap.clear();
    this.aiIntents.clear();
    log.info("[ProcessBridge] All processes cleaned up");
  }
  // 发送输入到进程
  sendInput(processId, input) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess?.isRunning || !managedProcess.terminalId) {
      return false;
    }
    return writeToTerminal(managedProcess.terminalId, input);
  }
  // ============ 私有辅助方法 ============
  // 检查进程是否真正在运行
  async isProcessActuallyRunning(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} not found`);
      return false;
    }
    if (!managedProcess.isRunning) {
      log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} isRunning=false`);
      return false;
    }
    if (managedProcess.terminalId) {
      const terminals2 = getTerminals();
      if (!terminals2.has(managedProcess.terminalId)) {
        log.info(`[ProcessBridge] isProcessActuallyRunning: terminal ${managedProcess.terminalId} not found, process ended`);
        managedProcess.isRunning = false;
        return false;
      }
      if (!managedProcess._startTimeForTimeout) {
        managedProcess._startTimeForTimeout = Date.now();
      }
      const runningTime = Date.now() - (managedProcess._startTimeForTimeout || Date.now());
      if (!managedProcess.port && runningTime > 3e4) {
        log.info(`[ProcessBridge] isProcessActuallyRunning: process ${processId} running for ${runningTime}ms without port, assuming completed`);
        managedProcess.isRunning = false;
        managedProcess.exitCode = 0;
        return false;
      }
      return managedProcess.isRunning;
    }
    if (managedProcess.port) {
      const portInUse = await this.checkPortInUse(managedProcess.port);
      log.info(`[ProcessBridge] isProcessActuallyRunning: port ${managedProcess.port} in use = ${portInUse}`);
      return portInUse;
    }
    return managedProcess.isRunning;
  }
  // 停止终端中的进程
  async stopTerminalProcess(terminalId) {
    const terminals2 = getTerminals();
    if (!terminals2.has(terminalId)) return;
    log.info(`[ProcessBridge] Stopping processes in terminal: ${terminalId}`);
    for (let i = 0; i < 5; i++) {
      writeToTerminal(terminalId, "");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    writeToTerminal(terminalId, "\n");
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (let i = 0; i < 3; i++) {
      writeToTerminal(terminalId, "");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    log.info(`[ProcessBridge] Finished stopping processes in terminal: ${terminalId}`);
  }
  // 检查端口是否被占用
  async checkPortInUse(port) {
    return new Promise((resolve) => {
      const checkCmd = `lsof -i :${port} | grep LISTEN`;
      child_process.exec(checkCmd, (error, stdout) => {
        resolve(!error && stdout.length > 0);
      });
    });
  }
  // 通过端口 kill 进程
  async killProcessByPort(port) {
    return new Promise((resolve) => {
      const killCmd = `lsof -i :${port} | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true`;
      child_process.exec(killCmd, () => resolve());
    });
  }
  // 通过命令和目录强制 kill
  async forceKillByCommand(command, cwd) {
    const commandPart = this.extractCommandPart(command);
    const mainCmd = commandPart.split(" ")[0];
    const projectName = cwd.split("/").pop() || "";
    return new Promise((resolve) => {
      const killCmds = [
        `pkill -f "${mainCmd}.*${projectName}" 2>/dev/null || true`,
        `pkill -f "node.*${projectName}" 2>/dev/null || true`,
        `pkill -f "npm.*${projectName}" 2>/dev/null || true`
      ];
      let completed = 0;
      killCmds.forEach((cmd) => {
        child_process.exec(cmd, () => {
          completed++;
          if (completed === killCmds.length) resolve();
        });
      });
    });
  }
  // 清理进程记录
  cleanupProcessRecord(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) return;
    for (const [key, pid] of this.commandTypeMap.entries()) {
      if (pid === processId) {
        this.commandTypeMap.delete(key);
        break;
      }
    }
    this.processes.delete(processId);
    if (managedProcess.aiIntent) {
      this.aiIntents.delete(managedProcess.aiIntent.intentId);
    }
    log.info(`[ProcessBridge] Cleaned up process record: ${processId}`);
  }
  // 清理无效进程记录
  cleanupInvalidProcesses() {
    const terminals2 = getTerminals();
    for (const [id, process2] of this.processes) {
      if (process2.terminalId && !terminals2.has(process2.terminalId) && process2.isRunning) {
        process2.isRunning = false;
        this.cleanupProcessRecord(id);
      }
    }
  }
}
const processBridge = new ProcessTerminalBridge();
const execPromise = util.promisify(child_process.exec);
const pathParam = {
  type: "string",
  description: "The absolute path to the file or directory",
  required: true
};
const contentParam = {
  type: "string",
  description: "The complete content to write to the file",
  required: true
};
const oldStringParam = {
  type: "string",
  description: "The exact text to find and replace (must match exactly including whitespace)",
  required: true
};
const newStringParam = {
  type: "string",
  description: "The new text to replace the old_string with",
  required: true
};
const commandParam = {
  type: "string",
  description: "The bash command to execute",
  required: true
};
const patternParam = {
  type: "string",
  description: 'The regex pattern or search query to find (e.g., "export const postApi", "function handleClick", "import React")',
  required: true
};
const searchPathParam = {
  type: "string",
  description: "The directory path to search in (optional, defaults to current working directory)",
  required: false
};
const processIdParam = {
  type: "string",
  description: "The process ID of the process to manage",
  required: true
};
const recentCommands = /* @__PURE__ */ new Map();
const COMMAND_DEDUP_WINDOW = 5e3;
function extractCwdFromCommand(command, defaultCwd) {
  const cdMatch = command.match(/^cd\s+(\S+)\s*(&&|;|\n)/);
  if (cdMatch) {
    const extractedPath = cdMatch[1];
    if (extractedPath.startsWith("/")) {
      return extractedPath;
    }
    return path__namespace.resolve(defaultCwd, extractedPath);
  }
  return defaultCwd;
}
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LINES = 100;
const MAX_OUTPUT_LENGTH = 5e4;
const readFileTool = {
  name: "read_file",
  description: "Read the contents of a file at the specified path. Use this to examine existing code before editing. Supports offset and limit for large files. Best practice: Always read a file before modifying it to understand its structure and content.",
  parameters: {
    path: pathParam,
    offset: {
      type: "number",
      description: "The line offset to start reading from (0-based). Use this to read specific sections of large files.",
      required: false
    },
    limit: {
      type: "number",
      description: "The maximum number of lines to read. Default is 100 lines. Use larger values for big files.",
      required: false
    }
  },
  required: ["path"],
  execute: async (args, context) => {
    try {
      const filePath = args.path;
      const offset = args.offset;
      const limit = args.limit;
      const targetPath = path__namespace.resolve(context.cwd, filePath);
      log.info(`[read_file] Reading file: ${targetPath}, offset: ${offset}, limit: ${limit}`);
      if (!fs__namespace.existsSync(targetPath)) {
        log.warn(`[read_file] File does not exist: ${targetPath}`);
        return createErrorResult(`File does not exist: ${filePath}`);
      }
      const stats = fs__namespace.statSync(targetPath);
      if (stats.isDirectory()) {
        return createErrorResult(`Path is a directory: ${filePath}`);
      }
      if (stats.size > MAX_FILE_SIZE) {
        log.warn(`[read_file] File too large: ${stats.size} bytes, max: ${MAX_FILE_SIZE}`);
        return createErrorResult(`File is too large (${stats.size} bytes). Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB. Use offset and limit parameters to read partial content.`);
      }
      let content = fs__namespace.readFileSync(targetPath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;
      const startLine = offset || 0;
      const lineLimit = limit !== void 0 ? limit : DEFAULT_MAX_LINES;
      const endLine = Math.min(startLine + lineLimit, totalLines);
      const limitedLines = lines.slice(startLine, endLine);
      content = limitedLines.join("\n");
      if (content.length > MAX_OUTPUT_LENGTH) {
        content = content.substring(0, MAX_OUTPUT_LENGTH) + "\n\n... (内容已截断，使用 offset 和 limit 参数读取更多内容)";
      }
      const isPartial = endLine < totalLines;
      return createSuccessResult(content, {
        filePath: targetPath,
        size: stats.size,
        startLine: startLine + 1,
        // Convert to 1-based
        endLine,
        totalLines,
        isPartial,
        hasMore: isPartial
      });
    } catch (error) {
      log.error(`[read_file] Error reading file:`, error);
      return createErrorResult(String(error));
    }
  }
};
const writeFileTool = {
  name: "write_file",
  description: "Create a new file or overwrite an existing file with the specified content. Use this to create new files or completely replace file contents. Warning: This will overwrite existing files without confirmation.",
  parameters: {
    path: pathParam,
    content: contentParam
  },
  required: ["path", "content"],
  execute: async (args, context) => {
    try {
      const filePath = args.path;
      const content = args.content;
      const targetPath = path__namespace.resolve(context.cwd, filePath);
      const parentDir = path__namespace.dirname(targetPath);
      if (!fs__namespace.existsSync(parentDir)) {
        fs__namespace.mkdirSync(parentDir, { recursive: true });
      }
      fs__namespace.writeFileSync(targetPath, content, "utf-8");
      return createSuccessResult(`File written successfully: ${targetPath}`, { filePath: targetPath });
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const editFileTool = {
  name: "edit_file",
  description: "Replace specific text in a file with new text. Use this for targeted modifications when you only need to change part of a file. CRITICAL: The old_string must match EXACTLY (including whitespace, indentation, and line breaks) for the replacement to work. Best practice: Always read the file first to get the exact text.",
  parameters: {
    path: pathParam,
    old_string: oldStringParam,
    new_string: newStringParam
  },
  required: ["path", "old_string", "new_string"],
  execute: async (args, context) => {
    try {
      const filePath = args.path;
      const oldString = args.old_string;
      const newString = args.new_string;
      const targetPath = path__namespace.resolve(context.cwd, filePath);
      const parentDir = path__namespace.dirname(targetPath);
      if (!fs__namespace.existsSync(parentDir)) {
        fs__namespace.mkdirSync(parentDir, { recursive: true });
      }
      if (!fs__namespace.existsSync(targetPath)) {
        fs__namespace.writeFileSync(targetPath, newString, "utf-8");
        return createSuccessResult(`File created (did not exist): ${targetPath}`, { filePath: targetPath, created: true });
      }
      let content = fs__namespace.readFileSync(targetPath, "utf-8");
      if (content.includes(oldString)) {
        content = content.replace(oldString, newString);
        fs__namespace.writeFileSync(targetPath, content, "utf-8");
        return createSuccessResult(`File edited successfully: ${targetPath}`, { filePath: targetPath });
      }
      const normalizedOld = oldString.replace(/\s+/g, " ").trim();
      const normalizedContent = content.replace(/\s+/g, " ");
      if (normalizedContent.includes(normalizedOld)) {
        const lines = oldString.split("\n");
        const firstLine = lines[0].trim();
        const lastLine = lines[lines.length - 1].trim();
        const contentLines = content.split("\n");
        let startIdx = -1;
        let endIdx = -1;
        for (let i = 0; i < contentLines.length; i++) {
          if (contentLines[i].trim() === firstLine && startIdx === -1) {
            startIdx = i;
          }
          if (contentLines[i].trim() === lastLine && startIdx !== -1) {
            endIdx = i;
            break;
          }
        }
        if (startIdx !== -1 && endIdx !== -1) {
          const actualOldString = contentLines.slice(startIdx, endIdx + 1).join("\n");
          content = content.replace(actualOldString, newString);
          fs__namespace.writeFileSync(targetPath, content, "utf-8");
          return createSuccessResult(`File edited successfully (with whitespace normalization): ${targetPath}`, { filePath: targetPath });
        }
      }
      let errorMsg = `Could not find the exact text to replace in ${filePath}.

`;
      errorMsg += `The text must match exactly including whitespace, indentation, and line breaks.

`;
      errorMsg += `Looking for (${oldString.length} characters):
`;
      errorMsg += `---
${oldString.substring(0, 200)}${oldString.length > 200 ? "..." : ""}
---

`;
      const preview = content.substring(0, 500);
      errorMsg += `File content preview (${content.length} characters total):
`;
      errorMsg += `---
${preview}${content.length > 500 ? "..." : ""}
---

`;
      errorMsg += `Suggestion: Use read_file to get the exact text including all whitespace.`;
      return createErrorResult(errorMsg);
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const appendFileTool = {
  name: "append_file",
  description: "Append content to the end of an existing file. Use this to add content to large files without rewriting the entire file. If the file does not exist, it will be created. Best for: adding log entries, adding new functions to the end of files, building large files incrementally.",
  parameters: {
    path: pathParam,
    content: contentParam
  },
  required: ["path", "content"],
  execute: async (args, context) => {
    try {
      const filePath = args.path;
      const content = args.content;
      const targetPath = path__namespace.resolve(context.cwd, filePath);
      const parentDir = path__namespace.dirname(targetPath);
      if (!fs__namespace.existsSync(parentDir)) {
        fs__namespace.mkdirSync(parentDir, { recursive: true });
      }
      fs__namespace.appendFileSync(targetPath, content, "utf-8");
      const action = fs__namespace.existsSync(targetPath) ? "Appended to" : "Created";
      return createSuccessResult(`${action} file: ${targetPath}`, { filePath: targetPath });
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const listDirectoryTool = {
  name: "list_directory",
  description: "List the contents of a directory. Use this to explore the project structure and find files. Best practice: Use this before read_file to understand the project layout and locate relevant files.",
  parameters: {
    path: pathParam
  },
  required: ["path"],
  execute: async (args, context) => {
    try {
      const dirPath = args.path;
      const targetPath = path__namespace.resolve(context.cwd, dirPath);
      if (!fs__namespace.existsSync(targetPath)) {
        return createErrorResult(`Directory does not exist: ${dirPath}`);
      }
      const stats = fs__namespace.statSync(targetPath);
      if (!stats.isDirectory()) {
        return createErrorResult(`Path is not a directory: ${dirPath}`);
      }
      const items = fs__namespace.readdirSync(targetPath);
      const output = items.filter((item) => !item.startsWith(".") && item !== "node_modules").map((item) => {
        const itemPath = path__namespace.join(targetPath, item);
        const itemStats = fs__namespace.statSync(itemPath);
        return itemStats.isDirectory() ? `${item}/` : item;
      }).join("\n");
      return createSuccessResult(output || "(empty directory)", { dirPath: targetPath, itemCount: items.length });
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const deleteFileTool = {
  name: "delete_file",
  description: "Delete a file or directory at the specified path. Use this to remove files or directories that are no longer needed. Warning: This action is permanent and cannot be undone. Use with caution.",
  parameters: {
    path: pathParam
  },
  required: ["path"],
  execute: async (args, context) => {
    try {
      const filePath = args.path;
      const targetPath = path__namespace.resolve(context.cwd, filePath);
      if (!fs__namespace.existsSync(targetPath)) {
        return createErrorResult(`Path does not exist: ${filePath}`);
      }
      const stats = fs__namespace.statSync(targetPath);
      if (stats.isDirectory()) {
        fs__namespace.rmdirSync(targetPath, { recursive: true });
        return createSuccessResult(`Removed directory: ${targetPath}`, { path: targetPath, type: "directory" });
      } else {
        fs__namespace.unlinkSync(targetPath);
        return createSuccessResult(`Removed file: ${targetPath}`, { path: targetPath, type: "file" });
      }
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const executeBashTool = {
  name: "execute_bash",
  description: 'Execute a bash/shell command. Use this to run commands like npm install, git operations, build commands, etc. Commands run in an integrated terminal. Long-running commands like "npm run dev" will start in the background and return immediately.',
  parameters: {
    command: commandParam
  },
  required: ["command"],
  execute: async (args) => {
    try {
      const command = args.command;
      const baseCwd = getCurrentWorkingDirectory();
      const cwd = extractCwdFromCommand(command, baseCwd);
      const commandKey = `${cwd}:${command}`;
      const now = Date.now();
      const lastExecution = recentCommands.get(commandKey);
      if (lastExecution && now - lastExecution < COMMAND_DEDUP_WINDOW) {
        const runningProcesses = processBridge.getAllProcesses().filter((p) => {
          if (!p.isRunning || !p.terminalId) return false;
          return p.cwd === cwd;
        });
        if (runningProcesses.length > 0) {
          log.warn(`Duplicate command detected and process is running, skipping: ${command}`);
          return createSuccessResult(
            `Command is already running (duplicate detected). Process ID: ${runningProcesses[0].id}`,
            { processId: runningProcesses[0].id, duplicate: true }
          );
        }
      }
      recentCommands.set(commandKey, now);
      for (const [key, timestamp] of recentCommands.entries()) {
        if (now - timestamp > COMMAND_DEDUP_WINDOW) {
          recentCommands.delete(key);
        }
      }
      log.info(`Executing bash command: ${command} in ${cwd} (base: ${baseCwd})`);
      const shouldRunInTerminal = processBridge.shouldRunInTerminal(command);
      const isBackgroundCommand = /&\s*$/.test(command.trim()) || /&\s*\n/.test(command);
      const isDevServerCommand = /npm\s+run\s+(dev|serve|start)|vite|next\s+dev|nuxt\s+dev|vue-cli-service\s+serve/i.test(command);
      if (shouldRunInTerminal && !isBackgroundCommand) {
        const result = await processBridge.startProcess(command, cwd);
        if (result.success) {
          if (isDevServerCommand) {
            log.info(`[execute_bash] Dev server command started, not waiting for completion: ${result.processId}`);
            await new Promise((resolve) => setTimeout(resolve, 3e3));
            const initialOutput = processBridge.getProcessOutput(result.processId);
            const outputText = initialOutput ? initialOutput.join("\n") : "Process started in terminal";
            return createSuccessResult(
              `Development server started in terminal.

Initial output:
${outputText}`,
              { processId: result.processId, terminal: true, devServer: true }
            );
          }
          log.info(`[execute_bash] Waiting for process ${result.processId} to complete...`);
          const waitResult = await processBridge.waitForProcess(result.processId, 12e4);
          if (waitResult.success) {
            return createSuccessResult(
              waitResult.output,
              { processId: result.processId, terminal: true, exitCode: waitResult.exitCode }
            );
          } else {
            return createErrorResult(
              waitResult.error || "Process execution failed",
              waitResult.output
            );
          }
        } else {
          return createErrorResult(`Failed to start process in terminal: ${result.error}`);
        }
      }
      if (isBackgroundCommand) {
        log.info(`[execute_bash] Background command detected, executing directly: ${command.substring(0, 100)}`);
      }
      const pathDirs = [
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        `${process.env.HOME}/.local/bin`,
        `${process.env.HOME}/bin`,
        `${process.env.HOME}/.npm-global/bin`,
        "/usr/local/share/npm/bin",
        process.env.PATH || ""
      ].filter(Boolean);
      const env = {
        ...process.env,
        PATH: pathDirs.join(":")
      };
      log.info(`[execute_bash] Direct execution PATH: ${env.PATH}`);
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        timeout: 6e4,
        maxBuffer: 10 * 1024 * 1024,
        env
      });
      return createSuccessResult(stdout || "(no output)", { stderr: stderr || void 0 });
    } catch (error) {
      return createErrorResult(
        error.stderr || error.message || String(error),
        error.stdout || ""
      );
    }
  }
};
const searchCodeTool = {
  name: "search_code",
  description: "Search for code patterns in the project using grep. Use this to find specific functions, variables, imports, or patterns across multiple files. Best for: finding where a function is defined, finding all usages of a variable, searching for specific code patterns.",
  parameters: {
    pattern: patternParam,
    path: searchPathParam
  },
  required: ["pattern"],
  execute: async (args, context) => {
    try {
      const pattern = args.pattern || args.query;
      if (!pattern) {
        return createErrorResult("Missing required parameter: pattern (or query)");
      }
      const searchPath = args.path;
      const targetPath = searchPath ? path__namespace.resolve(context.cwd, searchPath) : context.cwd;
      if (!fs__namespace.existsSync(targetPath)) {
        return createErrorResult(`Path does not exist: ${searchPath || "."}`);
      }
      const escapedPattern = pattern.replace(/'/g, `'"'"'`).replace(/\\/g, "\\\\");
      const { stdout, stderr } = await execPromise(
        `grep -r '${escapedPattern}' "${targetPath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.java" --include="*.go" --include="*.rs" -l 2>/dev/null || true`,
        { timeout: 3e4 }
      );
      if (stderr && !stdout) {
        return createErrorResult(stderr);
      }
      const files = stdout.trim().split("\n").filter((f) => f);
      if (files.length === 0) {
        return createSuccessResult("No matches found");
      }
      return createSuccessResult(files.join("\n"), { matchCount: files.length });
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const getRunningProcessesTool = {
  name: "get_running_processes",
  description: "Get a list of all currently running processes managed by the application. Use this to check which services are running and get their process IDs for management.",
  parameters: {},
  required: [],
  execute: async () => {
    try {
      const processes = processBridge.getAllProcesses();
      const runningProcesses = processes.filter((p) => p.isRunning);
      if (runningProcesses.length === 0) {
        return createSuccessResult("No running processes found");
      }
      const output = runningProcesses.map((p) => {
        const startTime = new Date(p.startTime).toLocaleString();
        return `Process ID: ${p.id}
Command: ${p.command}
Working Directory: ${p.cwd}
Started: ${startTime}
Terminal ID: ${p.terminalId || "N/A"}
---`;
      }).join("\n");
      return createSuccessResult(output, { processCount: runningProcesses.length });
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const stopProcessTool = {
  name: "stop_process",
  description: "Stop a running process by its process ID. Use this to terminate specific services or processes that were started through the application.",
  parameters: {
    process_id: processIdParam
  },
  required: ["process_id"],
  execute: async (args) => {
    try {
      const processId = args.process_id;
      if (!processId) {
        return createErrorResult("Process ID is required");
      }
      const result = await processBridge.stopProcess(processId);
      if (result.success) {
        if (result.actuallyStopped) {
          return createSuccessResult(`Process ${processId} stopped successfully`, { processId });
        } else {
          return createSuccessResult(
            `Stop signal sent to process ${processId}, but could not verify if process actually stopped. Please check the terminal to confirm.`,
            { processId, verified: false }
          );
        }
      } else {
        return createErrorResult(result.error || "Failed to stop process", "", { processId });
      }
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
const restartProcessTool = {
  name: "restart_process",
  description: "Restart a running process by its process ID. This will stop the process and start it again. Use this to restart services after code changes.",
  parameters: {
    process_id: processIdParam
  },
  required: ["process_id"],
  execute: async (args) => {
    try {
      const processId = args.process_id;
      if (!processId) {
        return createErrorResult("Process ID is required");
      }
      const result = await processBridge.restartProcess(processId);
      if (result.success) {
        return createSuccessResult(
          `Process ${processId} restarted successfully. New process ID: ${result.processId}`,
          { oldProcessId: processId, newProcessId: result.processId }
        );
      } else {
        return createErrorResult(result.error || "Failed to restart process", "", { processId });
      }
    } catch (error) {
      return createErrorResult(String(error));
    }
  }
};
function registerAllTools() {
  toolRegistry$1.register(readFileTool);
  toolRegistry$1.register(writeFileTool);
  toolRegistry$1.register(editFileTool);
  toolRegistry$1.register(appendFileTool);
  toolRegistry$1.register(listDirectoryTool);
  toolRegistry$1.register(deleteFileTool);
  toolRegistry$1.register(executeBashTool);
  toolRegistry$1.register(searchCodeTool);
  toolRegistry$1.register(getRunningProcessesTool);
  toolRegistry$1.register(stopProcessTool);
  toolRegistry$1.register(restartProcessTool);
  log.info(`[ToolDefinitions] Registered ${toolRegistry$1.count()} tools`);
}
const CODE_TOOLS = toolRegistry$1.toOpenAIDefinitions();
async function executeTool$1(name, args, cwd) {
  const { executeToolWithMiddleware: executeToolWithMiddleware2, createExecutionContext: createExecutionContext2 } = await Promise.resolve().then(() => toolsCore);
  const context = createExecutionContext2(cwd || getCurrentWorkingDirectory());
  return executeToolWithMiddleware2(name, args, context);
}
async function executeToolCalls(toolCalls, options) {
  const context = createExecutionContext(options.cwd, {
    sessionId: options.sessionId,
    userId: options.userId,
    metadata: options.metadata
  });
  const results = [];
  for (const toolCall of toolCalls) {
    try {
      let args;
      if (typeof toolCall.function.arguments === "string") {
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          results.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: toolCall.function.name,
            content: `Error: Failed to parse tool arguments: ${String(e)}`
          });
          continue;
        }
      } else {
        args = toolCall.function.arguments;
      }
      const result = await executeToolWithMiddleware(toolCall.function.name, args, context);
      results.push(toToolResult(toolCall.id, toolCall.function.name, result));
    } catch (error) {
      results.push({
        tool_call_id: toolCall.id,
        role: "tool",
        name: toolCall.function.name,
        content: `Error executing tool: ${String(error)}`
      });
    }
  }
  return results;
}
const loggingMiddleware = async (context, next) => {
  const startTime = Date.now();
  log.info(`[ToolExecution] Starting ${context.toolName}`, {
    args: context.args,
    cwd: context.executionContext.cwd,
    requestId: context.executionContext.requestId
  });
  try {
    const result = await next();
    const duration = Date.now() - startTime;
    log.info(`[ToolExecution] Completed ${context.toolName}`, {
      success: result.success,
      duration,
      requestId: context.executionContext.requestId
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`[ToolExecution] Failed ${context.toolName}`, {
      error: String(error),
      duration,
      requestId: context.executionContext.requestId
    });
    throw error;
  }
};
const validationMiddleware = async (context, next) => {
  const tool = toolRegistry$1.get(context.toolName);
  if (!tool) {
    return createErrorResult(`Unknown tool: ${context.toolName}`);
  }
  const validation = validateToolArgs(context.toolName, context.args, tool);
  if (!validation.valid) {
    return createErrorResult(`Validation failed: ${validation.errors.join(", ")}`);
  }
  return next();
};
const errorHandlingMiddleware = async (context, next) => {
  try {
    return await next();
  } catch (error) {
    log.error(`[ToolExecution] Unhandled error in ${context.toolName}:`, error);
    return createErrorResult(`Unexpected error: ${String(error)}`);
  }
};
const formattingMiddleware = async (context, next) => {
  const result = await next();
  const MAX_OUTPUT_LENGTH2 = 1e5;
  if (result.output && result.output.length > MAX_OUTPUT_LENGTH2) {
    return {
      ...result,
      output: result.output.substring(0, MAX_OUTPUT_LENGTH2) + "\n\n[Output truncated due to length]"
    };
  }
  return result;
};
function initializeToolExecutor() {
  toolRegistry$1.use(errorHandlingMiddleware);
  toolRegistry$1.use(validationMiddleware);
  toolRegistry$1.use(loggingMiddleware);
  toolRegistry$1.use(formattingMiddleware);
  log.info("[ToolExecutor] Initialized with default middlewares");
}
initializeToolExecutor();
const IGNORE_PATTERNS = [
  /^\./,
  // 隐藏文件
  /^node_modules$/,
  // Node.js 依赖
  /^dist$/,
  // 构建输出
  /^build$/,
  // 构建输出
  /^out$/,
  // 输出目录
  /^\.git$/,
  // Git 目录
  /^\.svn$/,
  // SVN 目录
  /^\.hg$/,
  // Mercurial 目录
  /^__pycache__$/,
  // Python 缓存
  /^\.pytest_cache$/,
  // Pytest 缓存
  /^target$/,
  // Rust 构建输出
  /^\.idea$/,
  // IntelliJ IDEA
  /^\.vscode$/,
  // VS Code 配置
  /^coverage$/,
  // 测试覆盖率报告
  /^\.next$/,
  // Next.js 构建输出
  /^\.nuxt$/,
  // Nuxt.js 构建输出
  /^vendor$/,
  // 依赖目录
  /^bin$/,
  // 二进制目录
  /^obj$/
  // 编译输出
];
const CACHEABLE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".vue",
  ".svelte",
  ".php",
  ".rb"
]);
let projectContext = null;
let currentRootPath = null;
function shouldIgnore(name) {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(name));
}
function shouldCacheContent(filePath) {
  const ext = path__namespace.extname(filePath).toLowerCase();
  return CACHEABLE_EXTENSIONS.has(ext);
}
async function scanDirectory(dirPath, relativePath = "", maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return [];
  }
  const nodes = [];
  try {
    const entries = await fs__namespace.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnore(entry.name)) {
        continue;
      }
      const fullPath = path__namespace.join(dirPath, entry.name);
      const entryRelativePath = relativePath ? path__namespace.join(relativePath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, entryRelativePath, maxDepth, currentDepth + 1);
        const stat = await fs__namespace.promises.stat(fullPath);
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          isDirectory: true,
          children,
          modifiedAt: stat.mtime.getTime()
        });
      } else {
        const stat = await fs__namespace.promises.stat(fullPath);
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          isDirectory: false,
          size: stat.size,
          modifiedAt: stat.mtime.getTime()
        });
      }
    }
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    log.error(`[ProjectContext] Error scanning directory ${dirPath}:`, error);
  }
  return nodes;
}
function calculateStats(fileTree) {
  let totalFiles = 0;
  let totalDirectories = 0;
  let totalSize = 0;
  const fileTypes = {};
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.isDirectory) {
        totalDirectories++;
        if (node.children) {
          traverse(node.children);
        }
      } else {
        totalFiles++;
        totalSize += node.size || 0;
        const ext = path__namespace.extname(node.name).toLowerCase() || "(no extension)";
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      }
    }
  }
  traverse(fileTree);
  return { totalFiles, totalDirectories, totalSize, fileTypes };
}
async function cacheImportantFiles(rootPath, fileTree, maxCacheSize = 1024 * 1024) {
  const fileContents = /* @__PURE__ */ new Map();
  let currentCacheSize = 0;
  const priorityFiles = [
    "package.json",
    "tsconfig.json",
    "README.md",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "main.ts",
    "index.ts",
    "app.ts",
    "server.ts",
    "main.py",
    "app.py",
    "manage.py"
  ];
  async function traverseAndCache(nodes) {
    for (const node of nodes) {
      if (node.isDirectory && node.children) {
        await traverseAndCache(node.children);
      } else if (shouldCacheContent(node.path)) {
        const fullPath = path__namespace.join(rootPath, node.path);
        const isPriority = priorityFiles.includes(node.name.toLowerCase());
        if (isPriority || node.size && node.size < 5e4) {
          try {
            const content = await fs__namespace.promises.readFile(fullPath, "utf-8");
            const contentSize = Buffer.byteLength(content, "utf8");
            if (currentCacheSize + contentSize < maxCacheSize) {
              fileContents.set(node.path, content);
              currentCacheSize += contentSize;
            }
          } catch (error) {
          }
        }
      }
    }
  }
  await traverseAndCache(fileTree);
  log.info(`[ProjectContext] Cached ${fileContents.size} files (${Math.round(currentCacheSize / 1024)}KB)`);
  return fileContents;
}
async function scanProject(rootPath) {
  log.info(`[ProjectContext] Scanning project: ${rootPath}`);
  const startTime = Date.now();
  const fileTree = await scanDirectory(rootPath);
  const stats = calculateStats(fileTree);
  const fileContents = await cacheImportantFiles(rootPath, fileTree);
  projectContext = {
    rootPath,
    scannedAt: Date.now(),
    fileTree,
    stats,
    fileContents
  };
  currentRootPath = rootPath;
  const duration = Date.now() - startTime;
  log.info(`[ProjectContext] Scan completed in ${duration}ms:`, {
    files: stats.totalFiles,
    directories: stats.totalDirectories,
    cachedFiles: fileContents.size
  });
  return projectContext;
}
function getProjectContext() {
  return projectContext;
}
function getFileTreeText(maxDepth = 3, maxFiles = 100) {
  if (!projectContext) {
    return "(No project context available)";
  }
  const lines = [];
  let fileCount = 0;
  function renderNode(node, depth, isLast, prefix = "") {
    if (depth > maxDepth) return;
    if (!node.isDirectory && fileCount >= maxFiles) return;
    const connector = isLast ? "└── " : "├── ";
    const line = prefix + connector + node.name + (node.isDirectory ? "/" : "");
    lines.push(line);
    if (!node.isDirectory) {
      fileCount++;
    }
    if (node.children && depth < maxDepth) {
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      node.children.forEach((child, index) => {
        renderNode(child, depth + 1, index === node.children.length - 1, childPrefix);
      });
    }
  }
  lines.push(path__namespace.basename(projectContext.rootPath) + "/");
  projectContext.fileTree.forEach((node, index) => {
    renderNode(node, 0, index === projectContext.fileTree.length - 1);
  });
  if (fileCount >= maxFiles) {
    lines.push("... (truncated)");
  }
  return lines.join("\n");
}
function getProjectOverview() {
  if (!projectContext) {
    return "";
  }
  const { stats, rootPath } = projectContext;
  const topFileTypes = Object.entries(stats.fileTypes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ext, count]) => `${ext}: ${count}`).join(", ");
  return `Project: ${path__namespace.basename(rootPath)}
Location: ${rootPath}
Files: ${stats.totalFiles}, Directories: ${stats.totalDirectories}
Main file types: ${topFileTypes}`;
}
function getCachedFileContent(filePath) {
  if (!projectContext) return void 0;
  if (projectContext.fileContents.has(filePath)) {
    return projectContext.fileContents.get(filePath);
  }
  const relativePath = path__namespace.relative(projectContext.rootPath, filePath);
  return projectContext.fileContents.get(relativePath);
}
function shouldRefreshContext(rootPath) {
  if (!projectContext) return true;
  if (currentRootPath !== rootPath) return true;
  const age = Date.now() - projectContext.scannedAt;
  const maxAge = 5 * 60 * 1e3;
  return age > maxAge;
}
async function refreshProjectContext(rootPath) {
  log.info(`[ProjectContext] Refreshing context for: ${rootPath}`);
  return scanProject(rootPath);
}
function clearProjectContext() {
  projectContext = null;
  currentRootPath = null;
  log.info("[ProjectContext] Context cleared");
}
function getProjectStructureForAI(includeFileTree = true, maxTreeDepth = 3) {
  if (!projectContext) {
    return "";
  }
  const parts = [];
  parts.push("=== PROJECT OVERVIEW ===");
  parts.push(getProjectOverview());
  parts.push("");
  if (includeFileTree) {
    parts.push("=== PROJECT STRUCTURE ===");
    parts.push(getFileTreeText(maxTreeDepth));
    parts.push("");
  }
  const keyFiles = [];
  const importantFiles = ["package.json", "tsconfig.json", "README.md", "Cargo.toml"];
  for (const fileName of importantFiles) {
    const content = getCachedFileContent(fileName);
    if (content) {
      keyFiles.push(`=== ${fileName} ===
${content.substring(0, 1e3)}${content.length > 1e3 ? "\n... (truncated)" : ""}`);
    }
  }
  if (keyFiles.length > 0) {
    parts.push("=== KEY FILES ===");
    parts.push(keyFiles.join("\n\n"));
    parts.push("");
  }
  return parts.join("\n");
}
function createPortingModule(name, responsibility, sourceHint, status = "mirrored") {
  return {
    name,
    responsibility,
    sourceHint,
    status
  };
}
class HistoryLogImpl {
  entries = [];
  add(type, message) {
    this.entries.push({
      type,
      message,
      timestamp: Date.now()
    });
  }
  asMarkdown() {
    const lines = ["## History Log", ""];
    for (const entry of this.entries) {
      const time = new Date(entry.timestamp).toISOString();
      lines.push(`- [${entry.type}] ${time}: ${entry.message}`);
    }
    return lines.join("\n");
  }
}
class UsageSummaryImpl {
  inputTokens;
  outputTokens;
  constructor(inputTokens = 0, outputTokens = 0) {
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
  }
  addTurn(prompt, output) {
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    return new UsageSummaryImpl(
      this.inputTokens + inputTokens,
      this.outputTokens + outputTokens
    );
  }
}
class TranscriptStoreImpl {
  entries = [];
  flushed = false;
  append(entry) {
    this.entries.push(entry);
  }
  compact(limit) {
    if (this.entries.length > limit) {
      this.entries = this.entries.slice(-limit);
    }
  }
  replay() {
    return [...this.entries];
  }
  flush() {
    this.flushed = true;
  }
}
const SNAPSHOT_PATH$1 = path__namespace.join(__dirname, "..", "..", "..", "resources", "reference_data", "commands_snapshot.json");
let commandSnapshotCache = null;
function loadCommandSnapshot() {
  if (commandSnapshotCache) {
    return commandSnapshotCache;
  }
  try {
    const rawEntries = JSON.parse(fs__namespace.readFileSync(SNAPSHOT_PATH$1, "utf-8"));
    const modules = rawEntries.map(
      (entry) => createPortingModule(
        entry.name,
        entry.responsibility,
        entry.source_hint,
        "mirrored"
      )
    );
    commandSnapshotCache = modules;
    return modules;
  } catch (error) {
    console.error("Failed to load command snapshot:", error);
    return [];
  }
}
const PORTED_COMMANDS = loadCommandSnapshot();
function getCommand(name) {
  const needle = name.toLowerCase();
  for (const module2 of PORTED_COMMANDS) {
    if (module2.name.toLowerCase() === needle) {
      return module2;
    }
  }
  return null;
}
function getCommands(cwd, includePluginCommands = true, includeSkillCommands = true) {
  let commands = [...PORTED_COMMANDS];
  if (!includePluginCommands) {
    commands = commands.filter((module2) => !module2.sourceHint.toLowerCase().includes("plugin"));
  }
  if (!includeSkillCommands) {
    commands = commands.filter((module2) => !module2.sourceHint.toLowerCase().includes("skills"));
  }
  return commands;
}
function findCommands(query, limit = 20) {
  const needle = query.toLowerCase();
  const matches = PORTED_COMMANDS.filter(
    (module2) => module2.name.toLowerCase().includes(needle) || module2.sourceHint.toLowerCase().includes(needle)
  );
  return matches.slice(0, limit);
}
function executeCommand(name, prompt = "") {
  const module2 = getCommand(name);
  if (module2 === null) {
    return {
      name,
      sourceHint: "",
      prompt,
      handled: false,
      message: `Unknown mirrored command: ${name}`
    };
  }
  const action = `Mirrored command '${module2.name}' from ${module2.sourceHint} would handle prompt ${JSON.stringify(prompt)}.`;
  return {
    name: module2.name,
    sourceHint: module2.sourceHint,
    prompt,
    handled: true,
    message: action
  };
}
const SNAPSHOT_PATH = path__namespace.join(__dirname, "..", "..", "..", "resources", "reference_data", "tools_snapshot.json");
let toolSnapshotCache = null;
function loadToolSnapshot() {
  if (toolSnapshotCache) {
    return toolSnapshotCache;
  }
  try {
    const rawEntries = JSON.parse(fs__namespace.readFileSync(SNAPSHOT_PATH, "utf-8"));
    const modules = rawEntries.map(
      (entry) => createPortingModule(
        entry.name,
        entry.responsibility,
        entry.source_hint,
        "mirrored"
      )
    );
    toolSnapshotCache = modules;
    return modules;
  } catch (error) {
    console.error("Failed to load tool snapshot:", error);
    return [];
  }
}
const PORTED_TOOLS = loadToolSnapshot();
function getTool(name) {
  const needle = name.toLowerCase();
  for (const module2 of PORTED_TOOLS) {
    if (module2.name.toLowerCase() === needle) {
      return module2;
    }
  }
  return null;
}
function getTools(simpleMode = false, includeMcp = true, permissionContext) {
  let tools = [...PORTED_TOOLS];
  if (!includeMcp) {
    tools = tools.filter((module2) => !module2.sourceHint.toLowerCase().includes("mcp"));
  }
  if (permissionContext) {
    tools = tools.filter((module2) => !permissionContext.blocks(module2.name));
  }
  if (simpleMode) {
    const basicToolNames = ["read_file", "write_file", "edit_file", "search_codebase", "grep_code"];
    tools = tools.filter((module2) => basicToolNames.includes(module2.name.toLowerCase()));
  }
  return tools;
}
function findTools(query, limit = 20) {
  const needle = query.toLowerCase();
  const matches = PORTED_TOOLS.filter(
    (module2) => module2.name.toLowerCase().includes(needle) || module2.sourceHint.toLowerCase().includes(needle)
  );
  return matches.slice(0, limit);
}
function executeTool(name, payload = "") {
  const module2 = getTool(name);
  if (module2 === null) {
    return {
      name,
      sourceHint: "",
      payload,
      handled: false,
      message: `Unknown mirrored tool: ${name}`
    };
  }
  const action = `Mirrored tool '${module2.name}' from ${module2.sourceHint} would process payload ${JSON.stringify(payload)}.`;
  return {
    name: module2.name,
    sourceHint: module2.sourceHint,
    payload,
    handled: true,
    message: action
  };
}
function buildPortContext(cwd) {
  const workingDir = process.cwd();
  let pythonFileCount = 0;
  try {
    const entries = fs__namespace.readdirSync(workingDir);
    for (const entry of entries) {
      if (entry.endsWith(".py")) {
        pythonFileCount++;
      }
    }
  } catch {
  }
  const archiveAvailable = fs__namespace.existsSync(path__namespace.join(workingDir, ".claude", "archive"));
  return {
    pythonFileCount,
    archiveAvailable,
    cwd: workingDir
  };
}
function renderContext(context) {
  return [
    `- Python files: ${context.pythonFileCount}`,
    `- Archive available: ${context.archiveAvailable}`,
    `- Working directory: ${context.cwd}`
  ].join("\n");
}
function runSetup(trusted = false) {
  const setup = {
    pythonVersion: process.version,
    implementation: "Node.js",
    platformName: `${os__namespace.platform()} ${os__namespace.arch()}`,
    testCommand: "npm test"
  };
  return {
    setup,
    startupSteps: [
      "Loaded command snapshot",
      "Loaded tool snapshot",
      "Initialized query engine",
      "Built port context",
      trusted ? "Running in trusted mode" : "Running in standard mode"
    ]
  };
}
function buildSystemInitMessage(trusted = false) {
  const lines = [
    "System initialized successfully.",
    "",
    "Available capabilities:",
    "- Command routing and execution",
    "- Tool routing and execution",
    "- Multi-turn conversation loop",
    "- Session persistence",
    "- Stream processing",
    ""
  ];
  if (trusted) {
    lines.push("Running in trusted mode with elevated permissions.");
  }
  return lines.join("\n");
}
class PortManifestImpl {
  topLevelModules = [];
  constructor() {
    this.buildFromWorkspace();
  }
  buildFromWorkspace() {
    const coreDir = path__namespace.resolve(__dirname);
    if (fs__namespace.existsSync(coreDir)) {
      const entries = fs__namespace.readdirSync(coreDir);
      for (const entry of entries) {
        const entryPath = path__namespace.join(coreDir, entry);
        const stat = fs__namespace.statSync(entryPath);
        if (stat.isFile() && entry.endsWith(".ts")) {
          this.topLevelModules.push({
            name: entry.replace(".ts", ""),
            fileCount: 1,
            notes: "Core module"
          });
        }
      }
    }
  }
  toMarkdown() {
    const lines = [
      "# Port Manifest",
      "",
      `## Top Level Modules (${this.topLevelModules.length})`,
      ""
    ];
    for (const module2 of this.topLevelModules) {
      lines.push(`- ${module2.name}: ${module2.fileCount} files - ${module2.notes}`);
    }
    return lines.join("\n");
  }
}
function buildPortManifest() {
  return new PortManifestImpl();
}
const SESSIONS_DIR = path__namespace.join(electron.app.getPath("userData"), "sessions");
function ensureSessionsDir() {
  if (!fs__namespace.existsSync(SESSIONS_DIR)) {
    fs__namespace.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}
function saveSession$1(session) {
  ensureSessionsDir();
  const filePath = path__namespace.join(SESSIONS_DIR, `${session.sessionId}.json`);
  const data = {
    ...session,
    updatedAt: Date.now()
  };
  fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}
function loadSession(sessionId) {
  const filePath = path__namespace.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs__namespace.existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
    return {
      sessionId: data.sessionId,
      messages: data.messages || [],
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now()
    };
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error);
    return null;
  }
}
function listSessions() {
  ensureSessionsDir();
  const sessions2 = [];
  const files = fs__namespace.readdirSync(SESSIONS_DIR);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const sessionId = file.replace(".json", "");
      const session = loadSession(sessionId);
      if (session) {
        sessions2.push(session);
      }
    }
  }
  return sessions2.sort((a, b) => b.updatedAt - a.updatedAt);
}
function deleteSession(sessionId) {
  const filePath = path__namespace.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs__namespace.existsSync(filePath)) {
    return false;
  }
  try {
    fs__namespace.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error);
    return false;
  }
}
function createStoredSession(sessionId, messages = [], inputTokens = 0, outputTokens = 0) {
  const now = Date.now();
  return {
    sessionId,
    messages,
    inputTokens,
    outputTokens,
    createdAt: now,
    updatedAt: now
  };
}
class QueryEnginePort {
  manifest;
  config;
  sessionId;
  mutableMessages = [];
  permissionDenials = [];
  totalUsage;
  transcriptStore;
  constructor(manifest, config, sessionId) {
    this.manifest = manifest;
    this.config = config || {
      maxTurns: 8,
      maxBudgetTokens: 2e3,
      compactAfterTurns: 12,
      structuredOutput: false,
      structuredRetryLimit: 2
    };
    this.sessionId = sessionId || uuid.v4().replace(/-/g, "");
    this.totalUsage = new UsageSummaryImpl();
    this.transcriptStore = new TranscriptStoreImpl();
  }
  static fromWorkspace() {
    return new QueryEnginePort(buildPortManifest());
  }
  static fromSavedSession(sessionId) {
    const stored = loadSession(sessionId);
    if (!stored) {
      return null;
    }
    const transcript = new TranscriptStoreImpl();
    transcript.entries = [...stored.messages];
    transcript.flushed = true;
    const engine = new QueryEnginePort(buildPortManifest(), void 0, sessionId);
    engine.mutableMessages = [...stored.messages];
    engine.totalUsage = new UsageSummaryImpl(stored.inputTokens, stored.outputTokens);
    engine.transcriptStore = transcript;
    return engine;
  }
  submitMessage(prompt, matchedCommands = [], matchedTools = [], deniedTools = []) {
    if (this.mutableMessages.length >= this.config.maxTurns) {
      const output2 = `Max turns reached before processing prompt: ${prompt}`;
      return {
        prompt,
        output: output2,
        matchedCommands,
        matchedTools,
        permissionDenials: deniedTools,
        usage: this.totalUsage,
        stopReason: "max_turns_reached"
      };
    }
    const summaryLines = [
      `Prompt: ${prompt}`,
      `Matched commands: ${matchedCommands.length > 0 ? matchedCommands.join(", ") : "none"}`,
      `Matched tools: ${matchedTools.length > 0 ? matchedTools.join(", ") : "none"}`,
      `Permission denials: ${deniedTools.length}`
    ];
    const output = this.formatOutput(summaryLines);
    const projectedUsage = this.totalUsage.addTurn(prompt, output);
    let stopReason = "completed";
    if (projectedUsage.inputTokens + projectedUsage.outputTokens > this.config.maxBudgetTokens) {
      stopReason = "max_budget_reached";
    }
    this.mutableMessages.push(prompt);
    this.transcriptStore.append(prompt);
    this.permissionDenials.push(...deniedTools);
    this.totalUsage = projectedUsage;
    this.compactMessagesIfNeeded();
    return {
      prompt,
      output,
      matchedCommands,
      matchedTools,
      permissionDenials: deniedTools,
      usage: this.totalUsage,
      stopReason
    };
  }
  *streamSubmitMessage(prompt, matchedCommands = [], matchedTools = [], deniedTools = []) {
    yield { type: "message_start", sessionId: this.sessionId, prompt };
    if (matchedCommands.length > 0) {
      yield { type: "command_match", commands: matchedCommands };
    }
    if (matchedTools.length > 0) {
      yield { type: "tool_match", tools: matchedTools };
    }
    if (deniedTools.length > 0) {
      yield { type: "permission_denial", denials: deniedTools.map((d) => d.toolName) };
    }
    const result = this.submitMessage(prompt, matchedCommands, matchedTools, deniedTools);
    yield { type: "message_delta", text: result.output };
    yield {
      type: "message_stop",
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      stopReason: result.stopReason,
      transcriptSize: this.transcriptStore.entries.length
    };
  }
  compactMessagesIfNeeded() {
    if (this.mutableMessages.length > this.config.compactAfterTurns) {
      this.mutableMessages = this.mutableMessages.slice(-this.config.compactAfterTurns);
    }
    this.transcriptStore.compact(this.config.compactAfterTurns);
  }
  replayUserMessages() {
    return this.transcriptStore.replay();
  }
  flushTranscript() {
    this.transcriptStore.flush();
  }
  persistSession() {
    this.flushTranscript();
    const session = createStoredSession(
      this.sessionId,
      this.mutableMessages,
      this.totalUsage.inputTokens,
      this.totalUsage.outputTokens
    );
    return saveSession$1(session);
  }
  formatOutput(summaryLines) {
    if (this.config.structuredOutput) {
      const payload = {
        summary: summaryLines,
        sessionId: this.sessionId
      };
      return this.renderStructuredOutput(payload);
    }
    return summaryLines.join("\n");
  }
  renderStructuredOutput(payload) {
    let lastError = null;
    for (let i = 0; i < this.config.structuredRetryLimit; i++) {
      try {
        return JSON.stringify(payload, null, 2);
      } catch (exc) {
        lastError = exc;
        payload = { summary: ["structured output retry"], sessionId: this.sessionId };
      }
    }
    throw new Error("structured output rendering failed", { cause: lastError });
  }
  renderSummary() {
    const sections = [
      "# Query Engine Summary",
      "",
      this.manifest.toMarkdown(),
      "",
      `Session id: ${this.sessionId}`,
      `Conversation turns stored: ${this.mutableMessages.length}`,
      `Permission denials tracked: ${this.permissionDenials.length}`,
      `Usage totals: in=${this.totalUsage.inputTokens} out=${this.totalUsage.outputTokens}`,
      `Max turns: ${this.config.maxTurns}`,
      `Max budget tokens: ${this.config.maxBudgetTokens}`,
      `Transcript flushed: ${this.transcriptStore.flushed}`
    ];
    return sections.join("\n");
  }
}
class ExecutionRegistry {
  commands = /* @__PURE__ */ new Map();
  tools = /* @__PURE__ */ new Map();
  registerCommand(executor) {
    this.commands.set(executor.name.toLowerCase(), executor);
  }
  registerTool(executor) {
    this.tools.set(executor.name.toLowerCase(), executor);
  }
  getCommand(name) {
    return this.commands.get(name.toLowerCase());
  }
  getTool(name) {
    return this.tools.get(name.toLowerCase());
  }
  hasCommand(name) {
    return this.commands.has(name.toLowerCase());
  }
  hasTool(name) {
    return this.tools.has(name.toLowerCase());
  }
  unregisterCommand(name) {
    return this.commands.delete(name.toLowerCase());
  }
  unregisterTool(name) {
    return this.tools.delete(name.toLowerCase());
  }
  getCommandNames() {
    return Array.from(this.commands.keys());
  }
  getToolNames() {
    return Array.from(this.tools.keys());
  }
  clear() {
    this.commands.clear();
    this.tools.clear();
  }
}
let globalRegistry = null;
function buildExecutionRegistry() {
  if (!globalRegistry) {
    globalRegistry = new ExecutionRegistry();
  }
  return globalRegistry;
}
class ToolPermissionContextImpl {
  deniedTools = [];
  deniedPrefixes = [];
  static fromIterables(deniedTools = [], deniedPrefixes = []) {
    const context = new ToolPermissionContextImpl();
    context.deniedTools = deniedTools.map((t) => t.toLowerCase());
    context.deniedPrefixes = deniedPrefixes.map((p) => p.toLowerCase());
    return context;
  }
  blocks(toolName) {
    const lowerName = toolName.toLowerCase();
    if (this.deniedTools.includes(lowerName)) {
      return true;
    }
    for (const prefix of this.deniedPrefixes) {
      if (lowerName.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
}
function inferPermissionDenials(toolNames, context) {
  const denials = [];
  for (const toolName of toolNames) {
    if (toolName.toLowerCase().includes("bash") || toolName.toLowerCase().includes("shell")) {
      if (context.blocks(toolName)) {
        denials.push({
          toolName,
          reason: "Destructive shell execution remains gated"
        });
      }
    }
  }
  return denials;
}
class RuntimeSessionImpl {
  prompt;
  context;
  setup;
  setupReport;
  systemInitMessage;
  history;
  routedMatches;
  turnResult;
  commandExecutionMessages;
  toolExecutionMessages;
  streamEvents;
  persistedSessionPath;
  constructor(prompt, context, setup, setupReport, systemInitMessage, history, routedMatches, turnResult, commandExecutionMessages, toolExecutionMessages, streamEvents, persistedSessionPath) {
    this.prompt = prompt;
    this.context = context;
    this.setup = setup;
    this.setupReport = setupReport;
    this.systemInitMessage = systemInitMessage;
    this.history = history;
    this.routedMatches = routedMatches;
    this.turnResult = turnResult;
    this.commandExecutionMessages = commandExecutionMessages;
    this.toolExecutionMessages = toolExecutionMessages;
    this.streamEvents = streamEvents;
    this.persistedSessionPath = persistedSessionPath;
  }
  asMarkdown() {
    const lines = [
      "# Runtime Session",
      "",
      `Prompt: ${this.prompt}`,
      "",
      "## Context",
      renderContext(this.context),
      "",
      "## Setup",
      `- Node.js: ${this.setup.pythonVersion} (${this.setup.implementation})`,
      `- Platform: ${this.setup.platformName}`,
      `- Test command: ${this.setup.testCommand}`,
      "",
      "## Startup Steps",
      ...this.setupReport.startupSteps.map((step) => `- ${step}`),
      "",
      "## System Init",
      this.systemInitMessage,
      "",
      "## Routed Matches",
      ...this.routedMatches.length > 0 ? this.routedMatches.map(
        (match) => `- [${match.kind}] ${match.name} (${match.score}) — ${match.sourceHint}`
      ) : ["- none"],
      "",
      "## Command Execution",
      ...this.commandExecutionMessages.length > 0 ? this.commandExecutionMessages : ["none"],
      "",
      "## Tool Execution",
      ...this.toolExecutionMessages.length > 0 ? this.toolExecutionMessages : ["none"],
      "",
      "## Stream Events",
      ...this.streamEvents.map((event) => `- ${event.type}: ${JSON.stringify(event)}`),
      "",
      "## Turn Result",
      this.turnResult.output,
      "",
      `Persisted session path: ${this.persistedSessionPath}`,
      "",
      this.history.asMarkdown()
    ];
    return lines.join("\n");
  }
}
class PortRuntime {
  routePrompt(prompt, limit = 5) {
    const tokens = new Set(
      prompt.toLowerCase().replace(/[/\-]/g, " ").split(/\s+/).filter((token) => token.length > 0)
    );
    const byKind = {
      command: this.collectMatches(tokens, PORTED_COMMANDS, "command"),
      tool: this.collectMatches(tokens, PORTED_TOOLS, "tool")
    };
    const selected = [];
    for (const kind of ["command", "tool"]) {
      if (byKind[kind].length > 0) {
        selected.push(byKind[kind].shift());
      }
    }
    const leftovers = [...byKind["command"], ...byKind["tool"]].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.name.localeCompare(b.name);
    });
    selected.push(...leftovers.slice(0, Math.max(0, limit - selected.length)));
    return selected.slice(0, limit);
  }
  bootstrapSession(prompt, limit = 5) {
    const context = buildPortContext();
    const setupReport = runSetup(true);
    const setup = setupReport.setup;
    const history = new HistoryLogImpl();
    const engine = QueryEnginePort.fromWorkspace();
    history.add("context", `python_files=${context.pythonFileCount}, archive_available=${context.archiveAvailable}`);
    history.add("registry", `commands=${PORTED_COMMANDS.length}, tools=${PORTED_TOOLS.length}`);
    const matches = this.routePrompt(prompt, limit);
    const registry = buildExecutionRegistry();
    const commandExecs = [];
    const toolExecs = [];
    for (const match of matches) {
      if (match.kind === "command") {
        const executor = registry.getCommand(match.name);
        if (executor) {
          commandExecs.push(executor.execute(prompt));
        }
      } else if (match.kind === "tool") {
        const executor = registry.getTool(match.name);
        if (executor) {
          toolExecs.push(executor.execute(prompt));
        }
      }
    }
    const denials = this.inferPermissionDenials(matches);
    const streamEvents = [];
    const streamGenerator = engine.streamSubmitMessage(
      prompt,
      matches.filter((m) => m.kind === "command").map((m) => m.name),
      matches.filter((m) => m.kind === "tool").map((m) => m.name),
      denials
    );
    for (const event of streamGenerator) {
      streamEvents.push(event);
    }
    const turnResult = engine.submitMessage(
      prompt,
      matches.filter((m) => m.kind === "command").map((m) => m.name),
      matches.filter((m) => m.kind === "tool").map((m) => m.name),
      denials
    );
    const persistedSessionPath = engine.persistSession();
    history.add("routing", `matches=${matches.length} for prompt=${JSON.stringify(prompt)}`);
    history.add("execution", `command_execs=${commandExecs.length} tool_execs=${toolExecs.length}`);
    history.add(
      "turn",
      `commands=${turnResult.matchedCommands.length} tools=${turnResult.matchedTools.length} denials=${turnResult.permissionDenials.length} stop=${turnResult.stopReason}`
    );
    history.add("session_store", persistedSessionPath);
    return new RuntimeSessionImpl(
      prompt,
      context,
      setup,
      setupReport,
      buildSystemInitMessage(true),
      history,
      matches,
      turnResult,
      commandExecs,
      toolExecs,
      streamEvents,
      persistedSessionPath
    );
  }
  runTurnLoop(prompt, limit = 5, maxTurns = 3, structuredOutput = false) {
    const engine = QueryEnginePort.fromWorkspace();
    engine.config = {
      ...engine.config,
      maxTurns,
      structuredOutput
    };
    const matches = this.routePrompt(prompt, limit);
    const commandNames = matches.filter((m) => m.kind === "command").map((m) => m.name);
    const toolNames = matches.filter((m) => m.kind === "tool").map((m) => m.name);
    const results = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const turnPrompt = turn === 0 ? prompt : `${prompt} [turn ${turn + 1}]`;
      const result = engine.submitMessage(turnPrompt, commandNames, toolNames, []);
      results.push(result);
      if (result.stopReason !== "completed") {
        break;
      }
    }
    return results;
  }
  inferPermissionDenials(matches) {
    const toolNames = matches.filter((m) => m.kind === "tool").map((m) => m.name);
    const context = new ToolPermissionContextImpl();
    return inferPermissionDenials(toolNames, context);
  }
  collectMatches(tokens, modules, kind) {
    const matches = [];
    for (const module2 of modules) {
      const score = this.score(tokens, module2);
      if (score > 0) {
        matches.push({
          kind,
          name: module2.name,
          sourceHint: module2.sourceHint,
          score
        });
      }
    }
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
    return matches;
  }
  score(tokens, module2) {
    const haystacks = [
      module2.name.toLowerCase(),
      module2.sourceHint.toLowerCase(),
      module2.responsibility.toLowerCase()
    ];
    let score = 0;
    for (const token of tokens) {
      if (haystacks.some((haystack) => haystack.includes(token))) {
        score++;
      }
    }
    return score;
  }
}
let server = null;
const sessions = /* @__PURE__ */ new Map();
const managedProcesses = /* @__PURE__ */ new Map();
function getDebugLogPath() {
  const dir = path__namespace.join(electron.app.getPath("userData"), "logs");
  if (!fs__namespace.existsSync(dir)) {
    fs__namespace.mkdirSync(dir, { recursive: true });
  }
  return path__namespace.join(dir, "api-debug.log");
}
function writeDebugLog(label, data) {
  const logPath = getDebugLogPath();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const logEntry = `[${timestamp}] ${label}:
${typeof data === "string" ? data : JSON.stringify(data, null, 2)}

`;
  try {
    fs__namespace.appendFileSync(logPath, logEntry, "utf-8");
  } catch (e) {
    console.error("Failed to write debug log:", e);
  }
}
function convertSpecialFormatToJSON(text) {
  const specialSectionPattern = /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g;
  const callPattern = /<\|tool_call_begin\|>functions\.([\w-]+)(?::\d+)?<\|tool_call_args\|>([\s\S]*?)<\|tool_call_end\|>/g;
  let result = text;
  result = result.replace(specialSectionPattern, (section) => {
    const toolCalls = [];
    let match;
    callPattern.lastIndex = 0;
    while ((match = callPattern.exec(section)) !== null) {
      const toolName = match[1];
      const argsJson = match[2].trim();
      try {
        const args = JSON.parse(argsJson);
        toolCalls.push(`\`\`\`json
{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}
\`\`\``);
      } catch (e) {
        log.warn("[FormatConverter] Failed to parse args:", argsJson);
      }
    }
    return toolCalls.length > 0 ? toolCalls.join("\n\n") : "";
  });
  const standalonePattern = /<\|tool_call_begin\|>functions\.([\w-]+)(?::\d+)?<\|tool_call_args\|>([\s\S]*?)<\|tool_call_end\|>/g;
  result = result.replace(standalonePattern, (match, toolName, argsJson) => {
    try {
      const args = JSON.parse(argsJson.trim());
      return `\`\`\`json
{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}
\`\`\``;
    } catch (e) {
      log.warn("[FormatConverter] Failed to parse standalone args:", argsJson);
      return match;
    }
  });
  const markdownToolPattern = /```\s*functions\.([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\})\s*```/g;
  result = result.replace(markdownToolPattern, (match, toolName, argsJson) => {
    try {
      let braceCount = 0;
      let jsonEnd = 0;
      for (let i = 0; i < argsJson.length; i++) {
        if (argsJson[i] === "{") braceCount++;
        else if (argsJson[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
      const validJson = argsJson.substring(0, jsonEnd);
      const args = JSON.parse(validJson.trim());
      return `\`\`\`json
{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}
\`\`\``;
    } catch (e) {
      log.warn("[FormatConverter] Failed to parse markdown tool args:", argsJson);
      return match;
    }
  });
  const inlineToolPattern = /```functions\.([a-zA-Z0-9_-]+):(\d+)\s*(\{[\s\S]*?\})\s*```/g;
  result = result.replace(inlineToolPattern, (match, toolName, index, argsJson) => {
    try {
      const args = JSON.parse(argsJson.trim());
      return `\`\`\`json
{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}
\`\`\``;
    } catch (e) {
      log.warn("[FormatConverter] Failed to parse inline tool args:", argsJson);
      return match;
    }
  });
  const simpleInlinePattern = /functions\.([a-zA-Z0-9_-]+)(?::\d+)?\s*(\{[^\n]*?\})/g;
  result = result.replace(simpleInlinePattern, (match, toolName, argsJson) => {
    try {
      const openBraces = (argsJson.match(/\{/g) || []).length;
      const closeBraces = (argsJson.match(/\}/g) || []).length;
      if (openBraces !== closeBraces || openBraces === 0) {
        return match;
      }
      const args = JSON.parse(argsJson.trim());
      return `\`\`\`json
{"tool": "${toolName}", "arguments": ${JSON.stringify(args)}}
\`\`\``;
    } catch (e) {
      return match;
    }
  });
  return result;
}
function getSessionsDir() {
  const dir = path__namespace.join(electron.app.getPath("userData"), "sessions");
  if (!fs__namespace.existsSync(dir)) {
    fs__namespace.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function saveSession(session) {
  const dir = getSessionsDir();
  const sessionPath = path__namespace.join(dir, `${session.id}.json`);
  try {
    fs__namespace.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  } catch (e) {
    log.error(`Failed to save session ${session.id}:`, e);
  }
}
function deleteSessionFromDisk(sessionId) {
  const dir = getSessionsDir();
  const sessionPath = path__namespace.join(dir, `${sessionId}.json`);
  try {
    if (fs__namespace.existsSync(sessionPath)) {
      fs__namespace.unlinkSync(sessionPath);
    }
  } catch (e) {
    log.error(`Failed to delete session ${sessionId}:`, e);
  }
}
async function startApiServer() {
  const expressApp = express();
  expressApp.use(express.json({ limit: "100mb" }));
  expressApp.use(express.urlencoded({ limit: "100mb", extended: true }));
  expressApp.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (_req.method === "OPTIONS") {
      res.sendStatus(200);
    } else {
      next();
    }
  });
  const commandsService = getCommandsService();
  const toolsService = getToolsService();
  registerAllTools();
  log.info(`API Server initialized: ${commandsService.getCount()} commands, ${toolsService.getCount()} tools, ${toolRegistry$1.count()} executors`);
  expressApp.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      commands: commandsService.getCount(),
      tools: toolsService.getCount()
    });
  });
  expressApp.get("/api/commands", (_req, res) => {
    res.json({
      count: commandsService.getCount(),
      commands: commandsService.getAll()
    });
  });
  expressApp.get("/api/commands/search", (req, res) => {
    const result = commandsService.search({
      query: req.query.q,
      limit: parseInt(req.query.limit) || 20
    });
    res.json(result);
  });
  expressApp.get("/api/commands/:name", (req, res) => {
    const command = commandsService.getByName(req.params.name);
    if (!command) {
      res.status(404).json({ error: "Command not found" });
      return;
    }
    res.json(command);
  });
  expressApp.get("/api/tools", (_req, res) => {
    res.json({
      count: toolsService.getCount(),
      tools: toolsService.getAll()
    });
  });
  expressApp.get("/api/tools/search", (req, res) => {
    const result = toolsService.search({
      query: req.query.q,
      limit: parseInt(req.query.limit) || 20
    });
    res.json(result);
  });
  expressApp.get("/api/tools/:name", (req, res) => {
    const tool = toolsService.getByName(req.params.name);
    if (!tool) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }
    res.json(tool);
  });
  expressApp.post("/api/route", (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }
    const lowerPrompt = prompt.toLowerCase();
    const matches = [];
    const commands = commandsService.getAll();
    for (const cmd of commands) {
      const parts = cmd.name.toLowerCase().split("-");
      const score = parts.filter((part) => lowerPrompt.includes(part)).length;
      if (score > 0) {
        matches.push({ kind: "command", name: cmd.name, score, source_hint: cmd.source_hint });
      }
    }
    const tools = toolsService.getAll();
    for (const tool of tools) {
      const parts = tool.name.toLowerCase().split(/(?=[A-Z])/);
      const score = parts.filter((part) => lowerPrompt.includes(part.toLowerCase())).length;
      if (score > 0) {
        matches.push({ kind: "tool", name: tool.name, score, source_hint: tool.source_hint });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    res.json({ matches: matches.slice(0, 5) });
  });
  expressApp.get("/api/port/manifest", (_req, res) => {
    const manifest = buildPortManifest();
    res.json({ manifest: manifest.toMarkdown() });
  });
  expressApp.get("/api/port/commands", (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const query = req.query.query;
    const noPluginCommands = req.query.noPluginCommands === "true";
    const noSkillCommands = req.query.noSkillCommands === "true";
    if (query) {
      res.json({ commands: findCommands(query, limit) });
    } else {
      const commands = getCommands(void 0, !noPluginCommands, !noSkillCommands);
      res.json({
        count: commands.length,
        commands: commands.slice(0, limit)
      });
    }
  });
  expressApp.get("/api/port/tools", (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const query = req.query.query;
    const simpleMode = req.query.simpleMode === "true";
    const noMcp = req.query.noMcp === "true";
    const denyTool = (req.query.denyTool || "").split(",").filter(Boolean);
    const denyPrefix = (req.query.denyPrefix || "").split(",").filter(Boolean);
    const permissionContext = ToolPermissionContextImpl.fromIterables(denyTool, denyPrefix);
    if (query) {
      res.json({ tools: findTools(query, limit) });
    } else {
      const tools = getTools(simpleMode, !noMcp, permissionContext);
      res.json({
        count: tools.length,
        tools: tools.slice(0, limit)
      });
    }
  });
  expressApp.post("/api/port/route", (req, res) => {
    const { prompt, limit = 5 } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }
    const runtime = new PortRuntime();
    const matches = runtime.routePrompt(prompt, limit);
    res.json({
      matches: matches.map((m) => ({
        kind: m.kind,
        name: m.name,
        source_hint: m.sourceHint,
        score: m.score
      }))
    });
  });
  expressApp.post("/api/port/bootstrap", (req, res) => {
    const { prompt, limit = 5 } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }
    const runtime = new PortRuntime();
    const session = runtime.bootstrapSession(prompt, limit);
    res.json({
      session: {
        prompt: session.prompt,
        context: session.context,
        setup: session.setup,
        routedMatches: session.routedMatches,
        turnResult: session.turnResult,
        persistedSessionPath: session.persistedSessionPath
      }
    });
  });
  expressApp.post("/api/port/turn-loop", (req, res) => {
    const { prompt, limit = 5, maxTurns = 3, structuredOutput = false } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }
    const runtime = new PortRuntime();
    const results = runtime.runTurnLoop(prompt, limit, maxTurns, structuredOutput);
    res.json({ results });
  });
  expressApp.post("/api/port/bootstrap/stream", (req, res) => {
    const { prompt, limit = 5 } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const runtime = new PortRuntime();
    const matches = runtime.routePrompt(prompt, limit);
    const engine = QueryEnginePort.fromWorkspace();
    const denials = matches.filter((m) => m.kind === "tool" && m.name.toLowerCase().includes("bash")).map((m) => ({ toolName: m.name, reason: "Destructive shell execution remains gated" }));
    const generator = engine.streamSubmitMessage(
      prompt,
      matches.filter((m) => m.kind === "command").map((m) => m.name),
      matches.filter((m) => m.kind === "tool").map((m) => m.name),
      denials
    );
    for (const event of generator) {
      res.write(`data: ${JSON.stringify(event)}

`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
  expressApp.post("/api/port/exec-command", (req, res) => {
    const { name, prompt = "" } = req.body;
    if (!name) {
      res.status(400).json({ error: "Command name is required" });
      return;
    }
    const result = executeCommand(name, prompt);
    res.json({ result });
  });
  expressApp.post("/api/port/exec-tool", (req, res) => {
    const { name, payload = "" } = req.body;
    if (!name) {
      res.status(400).json({ error: "Tool name is required" });
      return;
    }
    const result = executeTool(name, payload);
    res.json({ result });
  });
  expressApp.get("/api/port/sessions", (_req, res) => {
    const sessions2 = listSessions();
    res.json({ sessions: sessions2 });
  });
  expressApp.post("/api/port/sessions", (_req, res) => {
    const sessionId = uuid.v4();
    const session = createStoredSession(sessionId);
    saveSession$1(session);
    log.info(`[API] Created new port session: ${sessionId}`);
    res.json({ session });
  });
  expressApp.get("/api/port/sessions/:id", (req, res) => {
    const session = loadSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ session });
  });
  expressApp.delete("/api/port/sessions/:id", (req, res) => {
    const success = deleteSession(req.params.id);
    if (!success) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ success: true });
  });
  expressApp.get("/api/project-context", async (req, res) => {
    const projectPath = req.query.path;
    if (!projectPath) {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }
    try {
      if (shouldRefreshContext(projectPath)) {
        log.info(`[API] Scanning project context for: ${projectPath}`);
        await scanProject(projectPath);
      }
      const context = getProjectContext();
      if (!context) {
        res.status(404).json({ error: "Failed to scan project" });
        return;
      }
      const aiContext = getProjectStructureForAI(true, 4);
      res.json({
        context: aiContext,
        stats: context.stats,
        scannedAt: context.scannedAt
      });
    } catch (error) {
      log.error("[API] Failed to get project context:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/project-context/refresh", async (req, res) => {
    const { path: projectPath } = req.body;
    if (!projectPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      log.info(`[API] Refreshing project context for: ${projectPath}`);
      const context = await refreshProjectContext(projectPath);
      const aiContext = getProjectStructureForAI(true, 4);
      res.json({
        context: aiContext,
        stats: context.stats,
        scannedAt: context.scannedAt
      });
    } catch (error) {
      log.error("[API] Failed to refresh project context:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/project-context/clear", (_req, res) => {
    clearProjectContext();
    res.json({ success: true });
  });
  expressApp.get("/api/subsystems", (_req, res) => {
    res.json([
      { name: "commands", file_count: commandsService.getCount(), notes: "Command surface" },
      { name: "tools", file_count: toolsService.getCount(), notes: "Tool surface" },
      { name: "runtime", file_count: 1, notes: "Runtime orchestration" },
      { name: "query_engine", file_count: 1, notes: "Query engine" },
      { name: "session_store", file_count: 1, notes: "Session storage" },
      { name: "permissions", file_count: 1, notes: "Permission management" },
      { name: "ported_commands", file_count: PORTED_COMMANDS.length, notes: "Ported command surface" },
      { name: "ported_tools", file_count: PORTED_TOOLS.length, notes: "Ported tool surface" }
    ]);
  });
  expressApp.post("/api/chat", async (req, res) => {
    try {
      const { apiKey, model, messages, tools, stream = false } = req.body;
      log.info("[API] /api/chat called with", messages?.length, "messages");
      if (!apiKey) {
        res.status(400).json({ error: "API key is required" });
        return;
      }
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const asyncIter = streamChatMessage({ apiKey, model, messages, tools, stream });
        for await (const chunk of asyncIter) {
          res.write(`data: ${JSON.stringify(chunk)}

`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const response = await sendChatMessage({ apiKey, model, messages, tools, stream });
        writeDebugLog("ORIGINAL_RESPONSE", response.content);
        let convertedContent = response.content;
        if (typeof convertedContent === "string") {
          convertedContent = convertSpecialFormatToJSON(convertedContent);
        } else if (Array.isArray(convertedContent)) {
          convertedContent = convertedContent.map((item) => {
            if (typeof item === "object" && item !== null && "text" in item) {
              return { ...item, text: convertSpecialFormatToJSON(item.text) };
            }
            return item;
          });
        }
        writeDebugLog("CONVERTED_RESPONSE", convertedContent);
        const result = {
          id: response.id,
          type: response.type,
          role: response.role,
          content: convertedContent,
          model: response.model,
          stop_reason: response.stop_reason,
          usage: response.usage
        };
        if (response.tool_calls && response.tool_calls.length > 0) {
          result.tool_calls = response.tool_calls;
        }
        res.json(result);
      }
    } catch (error) {
      log.error("Chat error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.get("/api/tools/definitions", (_req, res) => {
    res.json({ tools: CODE_TOOLS });
  });
  expressApp.post("/api/tools/execute", async (req, res) => {
    const { tool_calls, cwd } = req.body;
    if (!tool_calls || !Array.isArray(tool_calls)) {
      res.status(400).json({ error: "tool_calls array is required" });
      return;
    }
    try {
      const workingDir = cwd || getCurrentWorkingDirectory();
      const results = await executeToolCalls(tool_calls, {
        cwd: workingDir
      });
      res.json({ results });
    } catch (error) {
      log.error("Tool execution error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/tools/execute-direct", async (req, res) => {
    const { tool, arguments: args, cwd } = req.body;
    if (!tool) {
      res.status(400).json({ error: "tool name is required" });
      return;
    }
    try {
      const workingDir = cwd || getCurrentWorkingDirectory();
      if (cwd) {
        setCurrentWorkingDirectory(cwd);
      }
      log.info(`[API] Executing tool ${tool} with args:`, args, "in cwd:", workingDir);
      writeDebugLog(`TOOL_EXECUTE_${tool}`, { args, cwd: workingDir });
      const startTime = Date.now();
      const result = await executeTool$1(tool, args || {}, workingDir);
      const duration = Date.now() - startTime;
      log.info(`[API] Tool ${tool} completed in ${duration}ms, success:`, result.success);
      writeDebugLog(`TOOL_RESULT_${tool}`, { result, duration });
      res.json({ result });
    } catch (error) {
      log.error("Tool execution error:", error);
      writeDebugLog(`TOOL_ERROR_${tool}`, { error: String(error), stack: error instanceof Error ? error.stack : void 0 });
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/tools/parse-and-execute", async (req, res) => {
    const { text, cwd } = req.body;
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      const workingDir = cwd || getCurrentWorkingDirectory();
      const toolCalls = parseToolCallsFromText(text);
      if (toolCalls.length === 0) {
        res.json({ toolCalls: [], results: [] });
        return;
      }
      const toolCallArray = toolCalls.map((call, index) => ({
        id: `call_${index + 1}_${Date.now()}`,
        type: "function",
        function: {
          name: call.tool,
          arguments: call.arguments
        }
      }));
      const results = await executeToolCalls(toolCallArray, {
        cwd: workingDir
      });
      res.json({ toolCalls, results });
    } catch (error) {
      log.error("Parse and execute error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/sessions", (req, res) => {
    const id = uuid.v4();
    const { projectPath } = req.body || {};
    const session = {
      id,
      messages: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      inputTokens: 0,
      outputTokens: 0,
      projectPath: projectPath || void 0
    };
    sessions.set(id, session);
    saveSession(session);
    const { id: _sessionId, ...sessionWithoutId } = session;
    res.json({ id, ...sessionWithoutId });
  });
  expressApp.get("/api/sessions/by-project", (req, res) => {
    const projectPath = req.query.path;
    if (!projectPath) {
      res.status(400).json({ error: "project path is required" });
      return;
    }
    const projectSessions = Array.from(sessions.values()).filter((s) => s.projectPath === projectPath).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (projectSessions.length > 0) {
      res.json({ found: true, session: projectSessions[0] });
    } else {
      res.json({ found: false, message: "No session found for this project" });
    }
  });
  expressApp.patch("/api/sessions/:id/project-path", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const { projectPath } = req.body;
    session.projectPath = projectPath || void 0;
    saveSession(session);
    res.json(session);
  });
  expressApp.delete("/api/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    sessions.delete(req.params.id);
    deleteSessionFromDisk(req.params.id);
    res.json({ success: true });
  });
  expressApp.get("/api/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });
  expressApp.get("/api/sessions", (_req, res) => {
    const sessionList = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      messageCount: s.messages.length,
      projectPath: s.projectPath
    }));
    res.json(sessionList);
  });
  expressApp.post("/api/sessions/:id/messages", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const { role, content } = req.body;
    session.messages.push({ role, content });
    res.json(session);
  });
  expressApp.post("/api/commands/execute", async (req, res) => {
    const { command, prompt } = req.body;
    try {
      const commandsService2 = getCommandsService();
      const cmd = commandsService2.getByName(command);
      if (!cmd) {
        res.status(404).json({ error: `Command not found: ${command}` });
        return;
      }
      const execResult = await executeCommand$1(command, prompt || "");
      const result = {
        command: cmd.name,
        source_hint: cmd.source_hint,
        responsibility: cmd.responsibility,
        prompt: prompt || "",
        handled: true,
        success: execResult.success,
        output: execResult.output,
        error: execResult.error,
        cwd: getCurrentWorkingDirectory()
      };
      res.json({ result });
    } catch (error) {
      log.error("Command execution error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.get("/api/cwd", (_req, res) => {
    res.json({ cwd: getCurrentWorkingDirectory() });
  });
  expressApp.post("/api/cwd", (req, res) => {
    const { cwd } = req.body;
    if (cwd) {
      setCurrentWorkingDirectory(cwd);
      res.json({ cwd: getCurrentWorkingDirectory() });
    } else {
      res.status(400).json({ error: "cwd is required" });
    }
  });
  expressApp.get("/api/fs/list", (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      const items = listDirectory(dirPath);
      res.json({ items });
    } catch (error) {
      log.error("Failed to list directory:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.get("/api/fs/read", (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      const resolvedPath = path__namespace.isAbsolute(filePath) ? filePath : path__namespace.join(getCurrentWorkingDirectory() || process.cwd(), filePath);
      const content = readFile(resolvedPath);
      res.json({ content });
    } catch (error) {
      log.error("Failed to read file:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/fs/write", (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === void 0) {
      res.status(400).json({ error: "path and content are required" });
      return;
    }
    try {
      writeFile(filePath, content);
      res.json({ success: true });
    } catch (error) {
      log.error("Failed to write file:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/tools/execute-legacy", async (req, res) => {
    const { tool, parameters } = req.body;
    try {
      let result;
      switch (tool) {
        case "BashTool": {
          const { command } = parameters;
          const { exec } = await import("child_process");
          const util2 = await import("util");
          const execPromise2 = util2.promisify(exec);
          try {
            const { stdout, stderr } = await execPromise2(command, { timeout: 6e4 });
            result = { output: stdout || stderr, error: stderr ? true : false };
          } catch (error) {
            result = { output: String(error), error: true };
          }
          break;
        }
        case "FileReadTool": {
          const { file_path } = parameters;
          const content = fs__namespace.readFileSync(file_path, "utf-8");
          result = { content };
          break;
        }
        case "FileEditTool": {
          const { file_path, old_string, new_string } = parameters;
          let content = fs__namespace.readFileSync(file_path, "utf-8");
          content = content.replace(old_string, new_string);
          fs__namespace.writeFileSync(file_path, content, "utf-8");
          result = { success: true };
          break;
        }
        case "FileWriteTool": {
          const { file_path, content } = parameters;
          fs__namespace.writeFileSync(file_path, content, "utf-8");
          result = { success: true };
          break;
        }
        default:
          result = { error: `Unknown tool: ${tool}` };
      }
      res.json({ result });
    } catch (error) {
      log.error("Tool execution error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.get("/api/processes", (_req, res) => {
    const processes = Array.from(managedProcesses.values()).map((p) => ({
      id: p.id,
      command: p.command,
      output: p.output,
      isRunning: p.isRunning,
      startTime: p.startTime
    }));
    res.json({ processes });
  });
  expressApp.post("/api/processes/start", (req, res) => {
    const { command } = req.body;
    if (!command) {
      res.status(400).json({ error: "Command is required" });
      return;
    }
    try {
      const processId = uuid.v4();
      const cwd = getCurrentWorkingDirectory();
      log.info(`Starting managed process: ${command} in ${cwd}`);
      const parts = command.split(" ");
      const cmd = parts[0];
      const args = parts.slice(1);
      const childProcess = child_process.spawn(cmd, args, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "1" }
      });
      const managedProcess = {
        id: processId,
        command,
        process: childProcess,
        output: [`$ ${command}`, `Working directory: ${cwd}`, "---"],
        isRunning: true,
        startTime: (/* @__PURE__ */ new Date()).toISOString()
      };
      managedProcesses.set(processId, managedProcess);
      childProcess.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n").filter((line) => line.length > 0);
        managedProcess.output.push(...lines);
        if (managedProcess.output.length > 1e3) {
          managedProcess.output = managedProcess.output.slice(-1e3);
        }
      });
      childProcess.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n").filter((line) => line.length > 0);
        managedProcess.output.push(...lines.map((l) => `[stderr] ${l}`));
        if (managedProcess.output.length > 1e3) {
          managedProcess.output = managedProcess.output.slice(-1e3);
        }
      });
      childProcess.on("close", (code) => {
        managedProcess.isRunning = false;
        managedProcess.output.push(`---`);
        managedProcess.output.push(`Process exited with code ${code}`);
        log.info(`Managed process ${processId} exited with code ${code}`);
      });
      childProcess.on("error", (error) => {
        managedProcess.isRunning = false;
        managedProcess.output.push(`[Error] ${error.message}`);
        log.error(`Managed process ${processId} error:`, error);
      });
      res.json({ processId, message: "Process started" });
    } catch (error) {
      log.error("Failed to start process:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/processes/:id/stop", (req, res) => {
    const { id } = req.params;
    const managedProcess = managedProcesses.get(id);
    if (!managedProcess) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    try {
      if (managedProcess.isRunning) {
        if (process.platform === "win32") {
          child_process.spawn("taskkill", ["/pid", managedProcess.process.pid?.toString() || "", "/f", "/t"]);
        } else {
          managedProcess.process.kill("SIGTERM");
          setTimeout(() => {
            if (!managedProcess.process.killed) {
              managedProcess.process.kill("SIGKILL");
            }
          }, 5e3);
        }
        managedProcess.isRunning = false;
        managedProcess.output.push("---");
        managedProcess.output.push("Process stopped by user");
      }
      res.json({ message: "Process stopped" });
    } catch (error) {
      log.error("Failed to stop process:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.delete("/api/processes/:id", (req, res) => {
    const { id } = req.params;
    const managedProcess = managedProcesses.get(id);
    if (!managedProcess) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    if (managedProcess.isRunning) {
      res.status(400).json({ error: "Cannot delete running process" });
      return;
    }
    managedProcesses.delete(id);
    res.json({ message: "Process deleted" });
  });
  const PORT = 3847;
  return new Promise((resolve, reject) => {
    server = expressApp.listen(PORT, () => {
      log.info(`API server running on port ${PORT}`);
      resolve();
    });
    server.on("error", (err) => {
      log.error("Server error:", err);
      reject(err);
    });
  });
}
function stopApiServer() {
  if (server) {
    for (const [id, managedProcess] of managedProcesses) {
      if (managedProcess.isRunning) {
        try {
          managedProcess.process.kill("SIGTERM");
        } catch (error) {
          log.error(`Failed to kill process ${id}:`, error);
        }
      }
    }
    managedProcesses.clear();
    server.close();
    server = null;
    log.info("API server stopped");
  }
}
const defaultConfig = {
  apiKey: "",
  model: "",
  defaultModel: "",
  permissionMode: "workspace-write",
  providers: []
};
let store = null;
function initConfigStore() {
  try {
    const userDataPath = electron.app.getPath("userData");
    const configPath = path.join(userDataPath, "config.json");
    const oldConfigPath = path.join(userDataPath, "..", "smp-code-web", "config.json");
    const fs2 = require("fs");
    if (fs2.existsSync(oldConfigPath) && !fs2.existsSync(configPath)) {
      log.info(`Migrating config from ${oldConfigPath} to ${configPath}`);
      try {
        const oldConfig = fs2.readFileSync(oldConfigPath, "utf8");
        fs2.writeFileSync(configPath, oldConfig);
        log.info("Config migrated successfully");
      } catch (e) {
        log.error("Failed to migrate config:", e);
      }
    }
    store = new Store({
      defaults: defaultConfig,
      cwd: userDataPath
    });
    log.info(`Config store initialized at ${store.path}, userData: ${userDataPath}`);
  } catch (error) {
    log.error("Failed to initialize config store:", error);
    throw error;
  }
}
function getStore() {
  if (!store) {
    initConfigStore();
  }
  return store;
}
function saveConfig(config) {
  try {
    const s = getStore();
    s.set("apiKey", config.apiKey);
    s.set("model", config.model);
    s.set("defaultModel", config.defaultModel);
    s.set("permissionMode", config.permissionMode);
    s.set("providers", config.providers);
    log.info("Config saved to store");
    return true;
  } catch (error) {
    log.error("Failed to save config:", error);
    return false;
  }
}
function loadConfig() {
  try {
    const s = getStore();
    const rawProviders = s.get("providers");
    log.info(`Raw providers from store: ${JSON.stringify(rawProviders)}`);
    const config = {
      apiKey: s.get("apiKey", defaultConfig.apiKey),
      model: s.get("model", defaultConfig.model),
      defaultModel: s.get("defaultModel", defaultConfig.defaultModel),
      permissionMode: s.get("permissionMode", defaultConfig.permissionMode),
      providers: s.get("providers", defaultConfig.providers)
    };
    log.info(`Config loaded from store: ${config.providers?.length || 0} providers`);
    return config;
  } catch (error) {
    log.error("Failed to load config:", error);
    return defaultConfig;
  }
}
function updateConfigField(key, value) {
  try {
    const s = getStore();
    s.set(key, value);
    log.info(`Config field ${key} updated`);
    return true;
  } catch (error) {
    log.error("Failed to update config field:", error);
    return false;
  }
}
function getStorePath() {
  const s = getStore();
  return s.path;
}
class CommandRegistry {
  commands = /* @__PURE__ */ new Map();
  /**
   * 注册命令
   */
  register(command) {
    this.commands.set(command.name.toLowerCase(), command);
    log.info(`[CommandRegistry] Registered command: ${command.name}`);
  }
  /**
   * 注销命令
   */
  unregister(name) {
    this.commands.delete(name.toLowerCase());
    log.info(`[CommandRegistry] Unregistered command: ${name}`);
  }
  /**
   * 获取命令
   */
  get(name) {
    return this.commands.get(name.toLowerCase());
  }
  /**
   * 获取所有命令
   */
  getAll() {
    return Array.from(this.commands.values());
  }
  /**
   * 检查命令是否存在
   */
  has(name) {
    return this.commands.has(name.toLowerCase());
  }
  /**
   * 搜索命令
   */
  search(query, limit = 20) {
    const needle = query.toLowerCase();
    const matches = this.getAll().filter(
      (cmd) => cmd.name.toLowerCase().includes(needle) || cmd.sourceHint.toLowerCase().includes(needle) || cmd.responsibility.toLowerCase().includes(needle)
    );
    return matches.slice(0, limit);
  }
  /**
   * 路由提示到匹配的命令
   */
  routePrompt(prompt, limit = 5) {
    const tokens = new Set(
      prompt.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 0)
    );
    const matches = [];
    for (const cmd of this.getAll()) {
      const haystacks = [cmd.name.toLowerCase(), cmd.sourceHint.toLowerCase(), cmd.responsibility.toLowerCase()];
      let score = 0;
      for (const token of Array.from(tokens)) {
        if (haystacks.some((h) => h.includes(token))) {
          score += 1;
        }
      }
      if (score > 0) {
        matches.push({ kind: "command", name: cmd.name, score, sourceHint: cmd.sourceHint });
      }
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  /**
   * 执行命令
   */
  async execute(name, prompt, context) {
    const command = this.get(name);
    if (!command) {
      return {
        success: false,
        handled: false,
        message: `Unknown command: ${name}`
      };
    }
    try {
      return await command.execute(prompt, context);
    } catch (error) {
      log.error(`[CommandRegistry] Error executing command ${name}:`, error);
      return {
        success: false,
        handled: true,
        message: `Error executing command ${name}: ${String(error)}`
      };
    }
  }
}
const commandRegistry = new CommandRegistry();
function getAllCommands() {
  return commandRegistry.getAll();
}
class ToolRegistry2 {
  tools = /* @__PURE__ */ new Map();
  deniedPrefixes = [];
  deniedTools = [];
  /**
   * 注册工具
   */
  register(tool) {
    this.tools.set(tool.name.toLowerCase(), tool);
    log.info(`[ToolRegistry] Registered tool: ${tool.name}`);
  }
  /**
   * 注销工具
   */
  unregister(name) {
    this.tools.delete(name.toLowerCase());
    log.info(`[ToolRegistry] Unregistered tool: ${name}`);
  }
  /**
   * 获取工具
   */
  get(name) {
    return this.tools.get(name.toLowerCase());
  }
  /**
   * 获取所有工具
   */
  getAll() {
    return Array.from(this.tools.values());
  }
  /**
   * 检查工具是否存在
   */
  has(name) {
    return this.tools.has(name.toLowerCase());
  }
  /**
   * 设置权限控制
   */
  setPermissions(deniedTools = [], deniedPrefixes = []) {
    this.deniedTools = deniedTools.map((t) => t.toLowerCase());
    this.deniedPrefixes = deniedPrefixes.map((p) => p.toLowerCase());
  }
  /**
   * 检查工具是否被允许
   */
  isAllowed(name) {
    const lowerName = name.toLowerCase();
    if (this.deniedTools.includes(lowerName)) {
      return { allowed: false, reason: `Tool '${name}' is explicitly denied` };
    }
    for (const prefix of this.deniedPrefixes) {
      if (lowerName.startsWith(prefix)) {
        return { allowed: false, reason: `Tool '${name}' matches denied prefix '${prefix}'` };
      }
    }
    return { allowed: true };
  }
  /**
   * 搜索工具
   */
  search(query, limit = 20) {
    const needle = query.toLowerCase();
    const matches = this.getAll().filter(
      (tool) => tool.name.toLowerCase().includes(needle) || tool.sourceHint.toLowerCase().includes(needle) || tool.responsibility.toLowerCase().includes(needle)
    );
    return matches.slice(0, limit);
  }
  /**
   * 路由提示到匹配的工具
   */
  routePrompt(prompt, limit = 5) {
    const tokens = new Set(
      prompt.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 0)
    );
    const matches = [];
    for (const tool of this.getAll()) {
      const haystacks = [tool.name.toLowerCase(), tool.sourceHint.toLowerCase(), tool.responsibility.toLowerCase()];
      let score = 0;
      for (const token of Array.from(tokens)) {
        if (haystacks.some((h) => h.includes(token))) {
          score += 1;
        }
      }
      if (score > 0) {
        matches.push({ kind: "tool", name: tool.name, score, sourceHint: tool.sourceHint });
      }
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  /**
   * 执行工具
   */
  async execute(name, args, context) {
    const tool = this.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${name}`
      };
    }
    const permission = this.isAllowed(name);
    if (!permission.allowed) {
      return {
        success: false,
        output: "",
        error: `Permission denied: ${permission.reason}`
      };
    }
    if (context.permissionMode === "strict" && name.toLowerCase().includes("bash")) {
      return {
        success: false,
        output: "",
        error: `Permission denied: bash execution is gated in strict mode`
      };
    }
    try {
      return await tool.execute(args, context);
    } catch (error) {
      log.error(`[ToolRegistry] Error executing tool ${name}:`, error);
      return {
        success: false,
        output: "",
        error: `Error executing tool ${name}: ${String(error)}`
      };
    }
  }
  /**
   * 验证工具参数
   */
  validateArgs(tool, args) {
    const errors = [];
    for (const required of tool.required) {
      if (!(required in args) || args[required] === void 0 || args[required] === null) {
        errors.push(`Missing required parameter: ${required}`);
      }
    }
    for (const [key, value] of Object.entries(args)) {
      const paramDef = tool.parameters[key];
      if (!paramDef) {
        errors.push(`Unknown parameter: ${key}`);
        continue;
      }
      if (paramDef.type === "string" && typeof value !== "string") {
        errors.push(`Parameter ${key} must be a string`);
      } else if (paramDef.type === "number" && typeof value !== "number") {
        errors.push(`Parameter ${key} must be a number`);
      } else if (paramDef.type === "boolean" && typeof value !== "boolean") {
        errors.push(`Parameter ${key} must be a boolean`);
      } else if (paramDef.type === "array" && !Array.isArray(value)) {
        errors.push(`Parameter ${key} must be an array`);
      }
      if (paramDef.enum && !paramDef.enum.includes(String(value))) {
        errors.push(`Parameter ${key} must be one of: ${paramDef.enum.join(", ")}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
  /**
   * 转换为 OpenAI 格式
   */
  toOpenAIDefinitions() {
    return this.getAll().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.responsibility,
        parameters: {
          type: "object",
          properties: tool.parameters,
          required: tool.required
        }
      }
    }));
  }
}
const toolRegistry = new ToolRegistry2();
function getAllTools() {
  return toolRegistry.getAll();
}
class RuntimeEngine {
  sessions = /* @__PURE__ */ new Map();
  config;
  constructor(config = {}) {
    this.config = {
      maxTurns: 8,
      maxBudgetTokens: 2e3,
      permissionMode: "moderate",
      compactAfterTurns: 12,
      ...config
    };
  }
  /**
   * 创建新会话
   */
  createSession(prompt, cwd) {
    const session = {
      id: uuid.v4(),
      prompt,
      cwd,
      createdAt: /* @__PURE__ */ new Date(),
      messages: [],
      commandResults: [],
      toolResults: [],
      permissionDenials: [],
      inputTokens: 0,
      outputTokens: 0
    };
    this.sessions.set(session.id, session);
    log.info(`[RuntimeEngine] Created session: ${session.id}`);
    return session;
  }
  /**
   * 获取会话
   */
  getSession(id) {
    return this.sessions.get(id);
  }
  /**
   * 获取所有会话
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }
  /**
   * 路由提示到匹配的命令和工具
   */
  routePrompt(prompt, limit = 5) {
    const commandMatches = commandRegistry.routePrompt(prompt, limit);
    const toolMatches = toolRegistry.routePrompt(prompt, limit);
    const allMatches = [
      ...commandMatches.map((m) => ({ ...m, kind: "command" })),
      ...toolMatches.map((m) => ({ ...m, kind: "tool" }))
    ];
    return allMatches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  /**
   * 执行单个回合
   */
  async executeTurn(sessionId, prompt) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.messages.length >= this.config.maxTurns) {
      return {
        prompt,
        output: `Max turns (${this.config.maxTurns}) reached`,
        matchedCommands: [],
        matchedTools: [],
        permissionDenials: [],
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        stopReason: "max_turns_reached"
      };
    }
    const matches = this.routePrompt(prompt, 5);
    const commandNames = matches.filter((m) => m.kind === "command").map((m) => m.name);
    const toolNames = matches.filter((m) => m.kind === "tool").map((m) => m.name);
    const commandContext = {
      cwd: session.cwd,
      sessionId: session.id,
      config: {}
    };
    for (const name of commandNames) {
      const result = await commandRegistry.execute(name, prompt, commandContext);
      session.commandResults.push(result);
    }
    const toolContext = {
      cwd: session.cwd,
      sessionId: session.id,
      permissionMode: this.config.permissionMode
    };
    const permissionDenials = [];
    for (const name of toolNames) {
      const permission = toolRegistry.isAllowed(name);
      if (!permission.allowed) {
        permissionDenials.push({ toolName: name, reason: permission.reason });
        continue;
      }
      const result = await toolRegistry.execute(name, {}, toolContext);
      session.toolResults.push(result);
    }
    session.permissionDenials.push(...permissionDenials);
    const outputLines = [
      `Prompt: ${prompt}`,
      `Matched commands: ${commandNames.join(", ") || "none"}`,
      `Matched tools: ${toolNames.join(", ") || "none"}`,
      `Permission denials: ${permissionDenials.length}`
    ];
    for (const result of session.commandResults.slice(-commandNames.length)) {
      if (result.handled) {
        outputLines.push(`[Command] ${result.message}`);
      }
    }
    for (const result of session.toolResults.slice(-toolNames.length)) {
      outputLines.push(`[Tool] ${result.success ? "Success" : "Failed"}: ${result.output || result.error}`);
    }
    const output = outputLines.join("\n");
    session.messages.push({ role: "user", content: prompt });
    session.messages.push({ role: "assistant", content: output });
    session.inputTokens += prompt.length / 4;
    session.outputTokens += output.length / 4;
    const totalTokens = session.inputTokens + session.outputTokens;
    const stopReason = totalTokens > this.config.maxBudgetTokens ? "max_budget_reached" : "completed";
    session.stopReason = stopReason;
    this.compactSessionIfNeeded(session);
    return {
      prompt,
      output,
      matchedCommands: commandNames,
      matchedTools: toolNames,
      permissionDenials,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      stopReason
    };
  }
  /**
   * 运行多回合循环
   */
  async runTurnLoop(prompt, cwd, maxTurns) {
    const session = this.createSession(prompt, cwd);
    const results = [];
    const turns = maxTurns || this.config.maxTurns;
    for (let i = 0; i < turns; i++) {
      const turnPrompt = i === 0 ? prompt : `${prompt} [turn ${i + 1}]`;
      const result = await this.executeTurn(session.id, turnPrompt);
      results.push(result);
      if (result.stopReason !== "completed") {
        break;
      }
    }
    return results;
  }
  /**
   * 压缩会话消息历史
   */
  compactSessionIfNeeded(session) {
    if (session.messages.length > this.config.compactAfterTurns) {
      const systemMessages = session.messages.filter((m) => m.role === "system");
      const recentMessages = session.messages.slice(-this.config.compactAfterTurns);
      session.messages = [...systemMessages, ...recentMessages];
      log.info(`[RuntimeEngine] Compacted session ${session.id}`);
    }
  }
  /**
   * 渲染会话摘要
   */
  renderSessionSummary(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return `Session not found: ${sessionId}`;
    }
    const lines = [
      "# Runtime Session",
      "",
      `Session ID: ${session.id}`,
      `Prompt: ${session.prompt}`,
      `Working Directory: ${session.cwd}`,
      `Created At: ${session.createdAt.toISOString()}`,
      "",
      "## Statistics",
      `- Messages: ${session.messages.length}`,
      `- Command Executions: ${session.commandResults.length}`,
      `- Tool Executions: ${session.toolResults.length}`,
      `- Permission Denials: ${session.permissionDenials.length}`,
      `- Input Tokens: ${session.inputTokens}`,
      `- Output Tokens: ${session.outputTokens}`,
      `- Stop Reason: ${session.stopReason || "N/A"}`,
      ""
    ];
    if (session.permissionDenials.length > 0) {
      lines.push("## Permission Denials");
      for (const denial of session.permissionDenials) {
        lines.push(`- ${denial.toolName}: ${denial.reason}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  /**
   * 删除会话
   */
  deleteSession(id) {
    const deleted = this.sessions.delete(id);
    if (deleted) {
      log.info(`[RuntimeEngine] Deleted session: ${id}`);
    }
    return deleted;
  }
  /**
   * 清理所有会话
   */
  cleanup() {
    this.sessions.clear();
    log.info("[RuntimeEngine] Cleaned up all sessions");
  }
}
const runtimeEngine = new RuntimeEngine();
function createSession(prompt, cwd) {
  return runtimeEngine.createSession(prompt, cwd);
}
function runTurnLoop(prompt, cwd, maxTurns) {
  return runtimeEngine.runTurnLoop(prompt, cwd, maxTurns);
}
const packagePath = path.join(__dirname, "../../../../package.json");
let version = "0.1.0";
try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
  version = pkg.version;
} catch {
}
let programInstance = null;
function getCLIProgram() {
  if (!programInstance) {
    initConfigStore();
    programInstance = createCLIProgram();
  }
  return programInstance;
}
function createCLIProgram() {
  const program = new commander.Command();
  program.name("smp-code").description("SMP Code - AI-powered coding assistant CLI").version(version).option("-v, --verbose", "verbose output").option("--cwd <path>", "working directory", process.cwd());
  program.command("chat").description("Start an interactive chat session").option("-m, --model <model>", "AI model to use").option("-s, --session <id>", "resume existing session").action(async (options) => {
    try {
      log.info("[CLI] Starting chat session...");
      const config = loadConfig();
      console.log("╔════════════════════════════════════╗");
      console.log("║     SMP Code - Interactive Chat    ║");
      console.log("╚════════════════════════════════════╝");
      console.log(`Working Directory: ${program.opts().cwd}`);
      console.log(`Model: ${options.model || config.defaultModel || "default"}`);
      console.log('\nType your message or "exit" to quit.\n');
      const session = createSession("Interactive chat", program.opts().cwd);
      console.log(`Session created: ${session.id}`);
      console.log("\nNote: Full interactive mode requires readline integration.");
      console.log('Use "smp-code run <prompt>" for single-turn execution.');
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  program.command("run <prompt>").description("Execute a single prompt").option("-t, --turns <n>", "maximum number of turns", "3").option("--strict", "strict permission mode").option("--json", "output as JSON").action(async (prompt, options) => {
    try {
      log.info(`[CLI] Executing prompt: ${prompt}`);
      const cwd = program.opts().cwd;
      const maxTurns = parseInt(options.turns, 10);
      console.log(`Executing: "${prompt}"`);
      console.log(`Working Directory: ${cwd}`);
      console.log(`Max Turns: ${maxTurns}`);
      console.log("─".repeat(50));
      const results = await runTurnLoop(prompt, cwd, maxTurns);
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          console.log(`
## Turn ${i + 1}`);
          console.log(result.output);
          console.log(`
Stop Reason: ${result.stopReason}`);
          console.log(`Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
        }
      }
      const lastResult = results[results.length - 1];
      console.log("\n" + "─".repeat(50));
      console.log(`Total Turns: ${results.length}`);
      console.log(`Final Stop Reason: ${lastResult.stopReason}`);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  program.command("exec <command>").description("Execute a specific command").option("-p, --prompt <text>", "prompt for the command", "").option("--json", "output as JSON").action(async (commandName, options) => {
    try {
      log.info(`[CLI] Executing command: ${commandName}`);
      const cwd = program.opts().cwd;
      const result = await commandRegistry.execute(commandName, options.prompt, {
        cwd,
        config: loadConfig()
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.message);
        if (!result.success) {
          process.exit(1);
        }
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  program.command("status").description("Show system status").option("--json", "output as JSON").action(async (options) => {
    try {
      const config = loadConfig();
      const commands = getAllCommands();
      const tools = getAllTools();
      const sessions2 = runtimeEngine.getAllSessions();
      const status = {
        version,
        cwd: program.opts().cwd,
        config: {
          providers: config.providers?.length || 0,
          defaultModel: config.defaultModel || "not set"
        },
        registry: {
          commands: commands.length,
          tools: tools.length
        },
        sessions: {
          active: sessions2.length,
          totalTokens: sessions2.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0)
        }
      };
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("╔════════════════════════════════════╗");
        console.log("║         SMP Code Status            ║");
        console.log("╚════════════════════════════════════╝");
        console.log(`Version: ${status.version}`);
        console.log(`Working Directory: ${status.cwd}`);
        console.log("\n## Configuration");
        console.log(`  Providers: ${status.config.providers}`);
        console.log(`  Default Model: ${status.config.defaultModel}`);
        console.log("\n## Registry");
        console.log(`  Commands: ${status.registry.commands}`);
        console.log(`  Tools: ${status.registry.tools}`);
        console.log("\n## Sessions");
        console.log(`  Active: ${status.sessions.active}`);
        console.log(`  Total Tokens: ${status.sessions.totalTokens}`);
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  const configCmd = program.command("config").description("Manage configuration");
  configCmd.command("show").description("Show current configuration").option("--json", "output as JSON").action(async (options) => {
    try {
      const config = loadConfig();
      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log("╔════════════════════════════════════╗");
        console.log("║      SMP Code Configuration        ║");
        console.log("╚════════════════════════════════════╝");
        console.log(JSON.stringify(config, null, 2));
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  configCmd.command("set <key> <value>").description("Set a configuration value").action(async (key, value) => {
    try {
      const config = loadConfig();
      let parsedValue = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
      }
      const configRecord = config;
      configRecord[key] = parsedValue;
      console.log(`Set ${key} = ${JSON.stringify(parsedValue)}`);
      console.log("Note: Use the GUI or edit config file to persist changes.");
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  program.command("commands").description("List available commands").option("-q, --query <text>", "search query").option("-l, --limit <n>", "limit results", "20").action(async (options) => {
    try {
      const limit = parseInt(options.limit, 10);
      const commands = options.query ? commandRegistry.search(options.query, limit) : getAllCommands().slice(0, limit);
      console.log(`Command entries: ${commands.length}`);
      console.log("");
      for (const cmd of commands) {
        console.log(`- ${cmd.name} — ${cmd.sourceHint}`);
        console.log(`  ${cmd.responsibility}`);
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  program.command("tools").description("List available tools").option("-q, --query <text>", "search query").option("-l, --limit <n>", "limit results", "20").action(async (options) => {
    try {
      const limit = parseInt(options.limit, 10);
      const tools = options.query ? toolRegistry.search(options.query, limit) : getAllTools().slice(0, limit);
      console.log(`Tool entries: ${tools.length}`);
      console.log("");
      for (const tool of tools) {
        console.log(`- ${tool.name} — ${tool.sourceHint}`);
        console.log(`  ${tool.responsibility}`);
        console.log(`  Parameters: ${Object.keys(tool.parameters).join(", ")}`);
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  const sessionCmd = program.command("session").description("Manage sessions");
  sessionCmd.command("list").description("List active sessions").action(async () => {
    const sessions2 = runtimeEngine.getAllSessions();
    console.log(`Active sessions: ${sessions2.length}`);
    console.log("");
    for (const session of sessions2) {
      console.log(`- ${session.id}`);
      console.log(`  Prompt: ${session.prompt}`);
      console.log(`  Messages: ${session.messages.length}`);
      console.log(`  Tokens: ${session.inputTokens} in / ${session.outputTokens} out`);
    }
  });
  sessionCmd.command("show <id>").description("Show session details").action(async (id) => {
    const summary = runtimeEngine.renderSessionSummary(id);
    console.log(summary);
  });
  sessionCmd.command("delete <id>").description("Delete a session").action(async (id) => {
    const deleted = runtimeEngine.deleteSession(id);
    if (deleted) {
      console.log(`Deleted session: ${id}`);
    } else {
      console.error(`Session not found: ${id}`);
      process.exit(1);
    }
  });
  program.command("route <prompt>").description("Route a prompt and show matches").option("-l, --limit <n>", "limit results", "5").action(async (prompt, options) => {
    try {
      const limit = parseInt(options.limit, 10);
      const matches = runtimeEngine.routePrompt(prompt, limit);
      console.log(`Prompt: "${prompt}"`);
      console.log(`Matches: ${matches.length}`);
      console.log("");
      for (const match of matches) {
        console.log(`[${match.kind}] ${match.name} (score: ${match.score})`);
        console.log(`  Source: ${match.sourceHint}`);
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });
  return program;
}
const cliEntry = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getCLIProgram
}, Symbol.toStringTag, { value: "Module" }));
log.transports.file.level = "info";
log.transports.console.level = "debug";
log.info("Application starting...");
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-error", {
      type: "uncaughtException",
      message: String(error),
      stack: error instanceof Error ? error.stack : void 0
    });
  }
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-error", {
      type: "unhandledRejection",
      message: String(reason)
    });
  }
});
let mainWindow = null;
let isQuitting = false;
initConfigStore();
log.info(`Config store path: ${getStorePath()}`);
function createWindow() {
  log.info("Creating main window...");
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "SMP Code",
    backgroundColor: electron.nativeTheme.shouldUseDarkColors ? "#1a1a1a" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  const menuTemplate = [
    {
      label: "SMP Code",
      submenu: [
        { label: "About SMP Code", role: "about" },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("open-settings") },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => {
          isQuitting = true;
          electron.app.quit();
        } }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", role: "reload" },
        { label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R", role: "forceReload" },
        { label: "Toggle DevTools", accelerator: "F12", role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { type: "separator" },
        { label: "Toggle Full Screen", accelerator: "F11", role: "togglefullscreen" }
      ]
    },
    {
      label: "Session",
      submenu: [
        { label: "New Session", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("new-session") },
        { label: "New Session (Global)", accelerator: "CmdOrCtrl+Shift+N", click: () => mainWindow?.webContents.send("new-session") }
      ]
    },
    {
      label: "Window",
      submenu: [
        { label: "Minimize", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "Close", accelerator: "CmdOrCtrl+W", role: "close" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: async () => {
            await electron.shell.openExternal("https://github.com/instructkr/claw-code");
          }
        },
        {
          label: "Report Issue",
          click: async () => {
            await electron.shell.openExternal("https://github.com/instructkr/claw-code/issues");
          }
        }
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level === 0) log.debug(`[Renderer] ${message}`);
    else if (level === 1) log.info(`[Renderer] ${message}`);
    else if (level === 2) log.warn(`[Renderer] ${message}`);
    else log.error(`[Renderer] ${message}`);
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      return false;
    }
    return true;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  log.info("Main window created");
}
function createTray() {
  try {
    log.info("Tray functionality available");
  } catch (error) {
    log.warn("Failed to create tray:", error);
  }
}
function registerGlobalShortcuts() {
  electron.globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  log.info("Global shortcuts registered");
}
function setupIpcHandlers() {
  electron.ipcMain.handle("get-config", () => {
    const config = loadConfig();
    log.info(`Config loaded with ${config.providers?.length || 0} providers`);
    return config;
  });
  electron.ipcMain.handle("set-config", (_event, key, value) => {
    const success = updateConfigField(key, value);
    log.info(`Config field ${key} saved, success: ${success}`);
    return success;
  });
  electron.ipcMain.handle("save-all-config", (_event, newConfig) => {
    if (newConfig.providers && Array.isArray(newConfig.providers)) {
      log.info(`Saving config with ${newConfig.providers.length} providers`);
    }
    const success = saveConfig(newConfig);
    log.info(`All config saved, success: ${success}`);
    if (success) {
      try {
        const verify = loadConfig();
        log.info(`Config verified: ${verify.providers?.length || 0} providers in store`);
      } catch (e) {
        log.error("Failed to verify saved config:", e);
      }
    }
    return success;
  });
  electron.ipcMain.handle("get-commands", () => {
    try {
      const devPath = path.join(__dirname, "../../../../resources/reference_data/commands_snapshot.json");
      const prodPath = path.join(__dirname, "../../resources/reference_data/commands_snapshot.json");
      const commandsPath = fs.existsSync(devPath) ? devPath : prodPath;
      if (fs.existsSync(commandsPath)) {
        const data = fs.readFileSync(commandsPath, "utf-8");
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error("Failed to load commands:", error);
      return [];
    }
  });
  electron.ipcMain.handle("get-tools", () => {
    try {
      const devPath = path.join(__dirname, "../../../../resources/reference_data/tools_snapshot.json");
      const prodPath = path.join(__dirname, "../../resources/reference_data/tools_snapshot.json");
      const toolsPath = fs.existsSync(devPath) ? devPath : prodPath;
      if (fs.existsSync(toolsPath)) {
        const data = fs.readFileSync(toolsPath, "utf-8");
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      log.error("Failed to load tools:", error);
      return [];
    }
  });
  electron.ipcMain.handle("get-subsystems", () => {
    return [
      { name: "commands", file_count: 1, notes: "Command surface" },
      { name: "tools", file_count: 1, notes: "Tool surface" },
      { name: "runtime", file_count: 1, notes: "Runtime orchestration" },
      { name: "query_engine", file_count: 1, notes: "Query engine" },
      { name: "session_store", file_count: 1, notes: "Session storage" },
      { name: "permissions", file_count: 1, notes: "Permission management" }
    ];
  });
  electron.ipcMain.handle("route-prompt", (_event, prompt) => {
    const matches = runtimeEngine.routePrompt(prompt, 5);
    return matches;
  });
  electron.ipcMain.handle("cli:execute-command", async (_event, { name, prompt, cwd }) => {
    try {
      const result = await commandRegistry.execute(name, prompt, {
        cwd,
        sessionId: void 0,
        config: {}
      });
      return result;
    } catch (error) {
      log.error("Failed to execute command:", error);
      return {
        success: false,
        handled: false,
        message: `Error: ${String(error)}`
      };
    }
  });
  electron.ipcMain.handle("cli:execute-tool", async (_event, { name, args, cwd }) => {
    try {
      const result = await toolRegistry.execute(name, args, {
        cwd,
        sessionId: void 0,
        permissionMode: "moderate"
      });
      return result;
    } catch (error) {
      log.error("Failed to execute tool:", error);
      return {
        success: false,
        output: "",
        error: String(error)
      };
    }
  });
  electron.ipcMain.handle("cli:create-session", (_event, { prompt, cwd }) => {
    const session = runtimeEngine.createSession(prompt, cwd);
    return {
      id: session.id,
      prompt: session.prompt,
      cwd: session.cwd,
      createdAt: session.createdAt.toISOString()
    };
  });
  electron.ipcMain.handle("cli:execute-turn", async (_event, { sessionId, prompt }) => {
    try {
      const result = await runtimeEngine.executeTurn(sessionId, prompt);
      return result;
    } catch (error) {
      log.error("Failed to execute turn:", error);
      return {
        prompt,
        output: `Error: ${String(error)}`,
        matchedCommands: [],
        matchedTools: [],
        permissionDenials: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: "error"
      };
    }
  });
  electron.ipcMain.handle("cli:get-commands", () => {
    return commandRegistry.getAll().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      sourceHint: cmd.sourceHint,
      responsibility: cmd.responsibility
    }));
  });
  electron.ipcMain.handle("cli:get-tools", () => {
    return toolRegistry.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      sourceHint: tool.sourceHint,
      responsibility: tool.responsibility,
      parameters: tool.parameters,
      required: tool.required
    }));
  });
  electron.ipcMain.handle("window-minimize", () => {
    mainWindow?.minimize();
  });
  electron.ipcMain.handle("window-maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  electron.ipcMain.handle("window-close", () => {
    mainWindow?.close();
  });
  electron.ipcMain.handle("show-open-dialog", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return electron.dialog.showOpenDialog(mainWindow, options);
  });
  electron.ipcMain.handle("show-save-dialog", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: void 0 };
    return electron.dialog.showSaveDialog(mainWindow, options);
  });
  electron.ipcMain.handle("select-folder", async () => {
    if (!mainWindow) return null;
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Folder"
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
  log.info("IPC handlers registered");
}
function setupProcessBridgeHandlers() {
  electron.ipcMain.handle("process:start-in-terminal", async (_event, { command, cwd, terminalId, aiPrompt }) => {
    try {
      const result = await processBridge.startProcess(command, cwd, terminalId, aiPrompt);
      return result;
    } catch (error) {
      log.error("Failed to start process in terminal:", error);
      return { processId: "", success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("process:stop", async (_event, { processId }) => {
    try {
      const result = await processBridge.stopProcess(processId);
      return result;
    } catch (error) {
      log.error("Failed to stop process:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("process:restart", async (_event, { processId }) => {
    try {
      const result = await processBridge.restartProcess(processId);
      return result;
    } catch (error) {
      log.error("Failed to restart process:", error);
      return { processId: "", success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle("process:list", async () => {
    try {
      const processes = processBridge.getAllProcesses();
      return processes;
    } catch (error) {
      log.error("Failed to list processes:", error);
      return [];
    }
  });
  electron.ipcMain.handle("process:should-run-in-terminal", (_event, { command }) => {
    return processBridge.shouldRunInTerminal(command);
  });
  electron.ipcMain.handle("process:get-ai-intent", async (_event, { processId }) => {
    try {
      return processBridge.getAIIntentContext(processId);
    } catch (error) {
      log.error("Failed to get AI intent:", error);
      return void 0;
    }
  });
  electron.ipcMain.handle("process:get-ai-history", async (_event, { cwd }) => {
    try {
      return processBridge.getProjectAIHistory(cwd);
    } catch (error) {
      log.error("Failed to get AI history:", error);
      return [];
    }
  });
  log.info("Process bridge handlers registered");
}
function initializeCLIRegistries() {
  commandRegistry.register({
    name: "help",
    description: "Show help information",
    sourceHint: "builtin",
    responsibility: "Provide help and documentation",
    execute: async () => ({
      success: true,
      handled: true,
      message: "Available commands: help, version, status, clear. Use --help for more details."
    })
  });
  commandRegistry.register({
    name: "version",
    description: "Show version information",
    sourceHint: "builtin",
    responsibility: "Display application version",
    execute: async () => ({
      success: true,
      handled: true,
      message: `SMP Code v${electron.app.getVersion() || "0.1.0"}`
    })
  });
  commandRegistry.register({
    name: "clear",
    description: "Clear the screen",
    sourceHint: "builtin",
    responsibility: "Clear terminal output",
    execute: async () => ({
      success: true,
      handled: true,
      message: "\x1Bc"
      // ANSI clear screen
    })
  });
  commandRegistry.register({
    name: "pwd",
    description: "Print working directory",
    sourceHint: "builtin",
    responsibility: "Show current working directory",
    execute: async (_prompt, context) => ({
      success: true,
      handled: true,
      message: context.cwd
    })
  });
  toolRegistry.register({
    name: "echo",
    description: "Echo a message",
    sourceHint: "builtin",
    responsibility: "Echo input back to the user",
    parameters: {
      message: {
        type: "string",
        description: "The message to echo",
        required: true
      }
    },
    required: ["message"],
    execute: async (args) => ({
      success: true,
      output: String(args.message || ""),
      data: { echoed: args.message }
    })
  });
  toolRegistry.register({
    name: "file_read",
    description: "Read file contents",
    sourceHint: "builtin",
    responsibility: "Read the contents of a file",
    parameters: {
      path: {
        type: "string",
        description: "The path to the file to read",
        required: true
      }
    },
    required: ["path"],
    execute: async (args, context) => {
      try {
        const fs2 = require("fs");
        const path2 = require("path");
        const filePath = path2.resolve(context.cwd, String(args.path));
        const content = fs2.readFileSync(filePath, "utf-8");
        return {
          success: true,
          output: content,
          data: { path: filePath, size: content.length }
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: String(error)
        };
      }
    }
  });
  toolRegistry.register({
    name: "file_write",
    description: "Write content to a file",
    sourceHint: "builtin",
    responsibility: "Write content to a file",
    parameters: {
      path: {
        type: "string",
        description: "The path to the file to write",
        required: true
      },
      content: {
        type: "string",
        description: "The content to write",
        required: true
      }
    },
    required: ["path", "content"],
    execute: async (args, context) => {
      try {
        const fs2 = require("fs");
        const path2 = require("path");
        const filePath = path2.resolve(context.cwd, String(args.path));
        fs2.writeFileSync(filePath, String(args.content), "utf-8");
        return {
          success: true,
          output: `File written: ${filePath}`,
          data: { path: filePath }
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: String(error)
        };
      }
    }
  });
  toolRegistry.register({
    name: "bash",
    description: "Execute a bash command",
    sourceHint: "builtin",
    responsibility: "Execute bash commands in the terminal",
    parameters: {
      command: {
        type: "string",
        description: "The bash command to execute",
        required: true
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds",
        required: false
      }
    },
    required: ["command"],
    execute: async (args, context) => {
      if (context.permissionMode === "strict") {
        return {
          success: false,
          output: "",
          error: "bash execution is gated in strict permission mode"
        };
      }
      try {
        const { execSync } = require("child_process");
        const command = String(args.command);
        const timeout = args.timeout || 3e4;
        const output = execSync(command, {
          cwd: context.cwd,
          encoding: "utf-8",
          timeout,
          stdio: ["pipe", "pipe", "pipe"]
        });
        return {
          success: true,
          output,
          data: { command, cwd: context.cwd }
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: String(error)
        };
      }
    }
  });
  toolRegistry.register({
    name: "glob",
    description: "Find files matching a pattern",
    sourceHint: "builtin",
    responsibility: "Find files using glob patterns",
    parameters: {
      pattern: {
        type: "string",
        description: "The glob pattern to match",
        required: true
      }
    },
    required: ["pattern"],
    execute: async (args, context) => {
      try {
        const glob = require("glob");
        const pattern = String(args.pattern);
        const files = glob.sync(pattern, { cwd: context.cwd });
        return {
          success: true,
          output: files.join("\n"),
          data: { pattern, matches: files.length, files }
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: String(error)
        };
      }
    }
  });
  log.info(`CLI registries initialized: ${commandRegistry.getAll().length} commands, ${toolRegistry.getAll().length} tools`);
}
function isCLIMode() {
  const args = process.argv;
  const isPackaged = electron.app.isPackaged;
  if (isPackaged && args.length <= 2) {
    return false;
  }
  const userArgs = args.slice(2);
  if (userArgs.length === 0) {
    return false;
  }
  return userArgs.includes("--cli") || userArgs.includes("chat") || userArgs.includes("run") || userArgs.includes("exec") || userArgs.includes("status") || userArgs.includes("config") || userArgs.includes("commands") || userArgs.includes("tools") || userArgs.includes("session") || userArgs.includes("route");
}
async function runCLIMode() {
  log.info("Starting CLI mode...");
  const args = process.argv.slice(2).filter((arg) => arg !== "--cli");
  initializeCLIRegistries();
  try {
    const { getCLIProgram: getCLIProgram2 } = await Promise.resolve().then(() => cliEntry);
    const cliProgram = getCLIProgram2();
    await cliProgram.parseAsync(args.length > 0 ? args : ["--help"]);
  } catch (error) {
    log.error("CLI error:", error);
    console.error("Error:", error);
    process.exit(1);
  }
  runtimeEngine.cleanup();
  process.exit(0);
}
electron.app.whenReady().then(async () => {
  log.info("App ready, initializing...");
  if (isCLIMode()) {
    await runCLIMode();
    return;
  }
  try {
    await startApiServer();
    log.info("API server started");
  } catch (error) {
    log.error("Failed to start API server:", error);
  }
  initializeCLIRegistries();
  setupIpcHandlers();
  createWindow();
  if (mainWindow) {
    initTerminalService(mainWindow);
    processBridge.setWindow(mainWindow);
    log.info("Terminal service initialized");
  } else {
    log.error("Failed to initialize terminal service: mainWindow is null");
  }
  setupProcessBridgeHandlers();
  createTray();
  registerGlobalShortcuts();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  isQuitting = true;
  electron.globalShortcut.unregisterAll();
  cleanupTerminals();
  processBridge.cleanupAll();
  stopApiServer();
  log.info("Application quitting");
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
});
