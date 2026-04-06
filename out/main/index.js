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
    max_tokens: 4096,
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
    max_tokens: 4096,
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
    yield* streamAnthropicMessage(apiKey, model, messages, tools);
  } else {
    yield* streamOpenAIMessage(apiKey, model, messages, tools);
  }
}
async function* streamOpenAIMessage(apiKey, model, messages, tools) {
  const requestBody = {
    model,
    messages,
    max_tokens: 4096,
    stream: true
  };
  if (tools && tools.length > 0) {
    requestBody.tools = tools;
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
    max_tokens: 4096,
    stream: true
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
    const { stdout, stderr } = await execPromise$1(`${shell} ${shellArgs.map((a) => `"${a}"`).join(" ")}`, {
      cwd: currentWorkingDirectory,
      timeout: 6e4
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
async function executeCommand(commandName, prompt) {
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
const CODE_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the specified path. Use this to examine existing code before editing.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path to the file to read"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or overwrite an existing file with the specified content. Use this to create new files or completely replace file contents.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path where the file should be created"
          },
          content: {
            type: "string",
            description: "The complete content to write to the file"
          }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace specific text in a file with new text. Use this for targeted modifications when you only need to change part of a file. The old_string must match exactly (including whitespace) for the replacement to work.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path to the file to edit"
          },
          old_string: {
            type: "string",
            description: "The exact text to find and replace (must match exactly including whitespace)"
          },
          new_string: {
            type: "string",
            description: "The new text to replace the old_string with"
          }
        },
        required: ["path", "old_string", "new_string"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the contents of a directory. Use this to explore the project structure and find files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path to the directory to list"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or directory at the specified path. Use this to remove files or directories that are no longer needed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The absolute path to the file or directory to delete"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_bash",
      description: "Execute a bash/shell command. Use this to run commands like npm install, git operations, build commands, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute"
          }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description: "Search for code patterns in the project using grep. Use this to find specific functions, variables, or patterns across multiple files.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regex pattern to search for"
          },
          path: {
            type: "string",
            description: "The directory path to search in (optional, defaults to current working directory)"
          }
        },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_running_processes",
      description: "Get a list of all currently running processes managed by the application. Use this to check which services are running and get their process IDs for management.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "stop_process",
      description: "Stop a running process by its process ID. Use this to terminate specific services or processes that were started through the application.",
      parameters: {
        type: "object",
        properties: {
          process_id: {
            type: "string",
            description: "The process ID of the process to stop"
          }
        },
        required: ["process_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "restart_process",
      description: "Restart a running process by its process ID. This will stop the process and start it again. Use this to restart services after code changes.",
      parameters: {
        type: "object",
        properties: {
          process_id: {
            type: "string",
            description: "The process ID of the process to restart"
          }
        },
        required: ["process_id"]
      }
    }
  }
];
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
        createdAt: /* @__PURE__ */ new Date()
      };
      terminals.set(id, session);
      ptyProcess.onData((data) => {
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
const TERMINAL_PROCESS_PATTERNS = [
  // Node.js - match anywhere in command (for compound commands like "cd && npm run")
  /npm\s+(run|start|dev|serve)/i,
  /npm\s+run\s+\w+/i,
  /node\s+/i,
  /npx\s+/i,
  /yarn\s+(run|start|dev|serve)/i,
  /pnpm\s+(run|start|dev|serve)/i,
  // Python
  /python\w*\s+/i,
  /pip\s+/i,
  // Java
  /^java\s+/i,
  /^mvn\w*\s+/i,
  /^gradle\w*\s+/i,
  // Go
  /^go\s+(run|build|test)/i,
  // Rust
  /^cargo\s+(run|build|test)/i,
  // Docker
  /^docker\s+(run|up|compose)/i,
  /^docker-compose\s+/i,
  // Shell scripts
  /^\.\/\w+\.sh/i,
  /^bash\s+\w+\.sh/i,
  // Other dev servers
  /^vite\s+/i,
  /^webpack\s+/i,
  /^next\s+/i,
  /^nuxt\s+/i,
  /^vue-cli-service\s+/i,
  /^react-scripts\s+/i,
  // Custom scripts
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
  // Track command types to their process IDs for reuse
  commandTypeMap = /* @__PURE__ */ new Map();
  setWindow(window) {
    this.windowRef = window;
  }
  // Generate a command type key for grouping similar commands
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
    if (/python.*manage\.py.*runserver|flask.*run|uvicorn|fastapi/i.test(commandPart)) {
      return `${projectName}:python-server`;
    }
    return `${projectName}:${commandPart.split(" ")[0]}`;
  }
  // Extract the actual command part (after cd ... && or cd ... ;)
  extractCommandPart(command) {
    const cdMatch = command.match(/^cd\s+\S+\s*(&&|;|\n)\s*(.+)$/);
    if (cdMatch) {
      return cdMatch[2].trim();
    }
    return command.trim();
  }
  // Get a display name for the command (for terminal title)
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
    if (/docker.*up/i.test(commandPart)) {
      return "Docker";
    }
    const firstWord = commandPart.split(" ")[0];
    return projectName ? `${projectName} (${firstWord})` : firstWord;
  }
  // Check if a command should run in terminal
  shouldRunInTerminal(command) {
    const commandPart = this.extractCommandPart(command);
    return TERMINAL_PROCESS_PATTERNS.some((pattern) => pattern.test(commandPart));
  }
  // Start a process that will output to terminal
  async startProcess(command, cwd, terminalId) {
    try {
      const commandTypeKey = this.getCommandTypeKey(command, cwd);
      log.info(`[ProcessBridge] Command type key: ${commandTypeKey}`);
      const existingProcessId = this.commandTypeMap.get(commandTypeKey);
      if (existingProcessId) {
        const existingProcess = this.processes.get(existingProcessId);
        if (existingProcess && existingProcess.isRunning) {
          const terminals22 = getTerminals();
          if (existingProcess.terminalId && terminals22.has(existingProcess.terminalId)) {
            log.info(`[ProcessBridge] Found existing running process for ${commandTypeKey}, returning existing`);
            return {
              processId: existingProcessId,
              success: true,
              commandTypeKey
            };
          } else {
            log.info(`[ProcessBridge] Found existing process for ${commandTypeKey} but terminal ${existingProcess.terminalId} no longer exists, will recreate`);
            existingProcess.isRunning = false;
            this.commandTypeMap.delete(commandTypeKey);
          }
        }
      }
      const processId = uuid.v4();
      this.commandTypeMap.set(commandTypeKey, processId);
      let targetTerminalId = terminalId;
      const expectedTerminalId = `terminal-${commandTypeKey}`;
      if (!targetTerminalId) {
        const terminals22 = getTerminals();
        if (terminals22.has(expectedTerminalId)) {
          targetTerminalId = expectedTerminalId;
          log.info(`[ProcessBridge] Reusing existing terminal: ${targetTerminalId}`);
        } else {
          if (this.windowRef && !this.windowRef.isDestroyed()) {
            this.windowRef.webContents.send("terminal:create", {
              id: expectedTerminalId,
              cwd,
              title: this.getCommandDisplayName(command)
            });
            targetTerminalId = expectedTerminalId;
            log.info(`[ProcessBridge] Requested new terminal creation: ${expectedTerminalId}`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
      const terminals2 = getTerminals();
      if (!targetTerminalId || !terminals2.has(targetTerminalId)) {
        return {
          processId: "",
          success: false,
          error: "Failed to create terminal. Please try again.",
          commandTypeKey
        };
      }
      log.info(`[ProcessBridge] Using terminal: ${targetTerminalId}`);
      log.info(`[ProcessBridge] Writing command to terminal: ${command} in ${cwd}`);
      const managedProcess = {
        id: processId,
        command,
        process: null,
        output: [`$ ${command}`, `Working directory: ${cwd}`, "---"],
        isRunning: true,
        startTime: (/* @__PURE__ */ new Date()).toISOString(),
        cwd,
        terminalId: targetTerminalId
      };
      this.processes.set(processId, managedProcess);
      let foregroundCommand = command.replace(/\s*>\s*[^&]+?\s*2>&1\s*&?\s*$/, "").replace(/\s*>\s*[^&]+?\s*&?\s*$/, "").replace(/\s*2>&1\s*&?\s*$/, "").replace(/\s*&\s*$/, "").trim();
      log.info(`[ProcessBridge] Original command: ${command}`);
      log.info(`[ProcessBridge] Cleaned command for foreground: ${foregroundCommand}`);
      writeToTerminal(targetTerminalId, `${foregroundCommand}\r`);
      let outputBuffer = "";
      let lastOutputTime = Date.now();
      const BUFFER_TIMEOUT = 30;
      const colors = {
        reset: "\x1B[0m",
        bright: "\x1B[1m",
        dim: "\x1B[2m",
        red: "\x1B[31m",
        green: "\x1B[32m",
        yellow: "\x1B[33m",
        blue: "\x1B[34m",
        magenta: "\x1B[35m",
        cyan: "\x1B[36m",
        white: "\x1B[37m",
        brightRed: "\x1B[91m",
        brightGreen: "\x1B[92m",
        brightYellow: "\x1B[93m",
        brightBlue: "\x1B[94m",
        brightMagenta: "\x1B[95m"
      };
      const highlightOutput = (text) => {
        return text.replace(/(\[?ERROR\]?|\[?Error\]?|error:|Error:)/g, `${colors.brightRed}$1${colors.reset}`).replace(/(\[?WARN\]?|\[?Warn\]?|warning:|Warning:)/g, `${colors.brightYellow}$1${colors.reset}`).replace(/(\[?INFO\]?|\[?Info\]?|✓|✔|success|Success)/g, `${colors.brightGreen}$1${colors.reset}`).replace(/(http[s]?:\/\/[^\s]+)/g, `${colors.brightBlue}$1${colors.reset}`).replace(/(\/[^\s]+\.(js|ts|json|md|py|java|go|rs|cpp|c|h|jsx|tsx|vue|css|scss|less|html|xml|yml|yaml|sh|bash|zsh))/g, `${colors.cyan}$1${colors.reset}`).replace(/(npm|yarn|pnpm|npx)\s+/g, `${colors.brightMagenta}$1${colors.reset} `).replace(/(🚀|server running|listening on|started on)/gi, `${colors.brightGreen}$1${colors.reset}`);
      };
      const flushOutputBuffer = () => {
        if (outputBuffer.length === 0) return;
        const text = outputBuffer;
        outputBuffer = "";
        const errorPatterns = [
          /Error: Cannot find module/i,
          /MODULE_NOT_FOUND/i,
          /command not found/i,
          /npm ERR!/i,
          /error:.*failed/i,
          /Error:.*failed/i
        ];
        const hasError = errorPatterns.some((pattern) => pattern.test(text));
        if (hasError && managedProcess.isRunning) {
          log.warn(`[ProcessBridge] Detected error in process ${processId} output, marking as potentially failed`);
        }
        let normalizedText = text.replace(/\r?\n/g, "\r\n");
        normalizedText = highlightOutput(normalizedText);
        managedProcess.output.push(normalizedText);
        this.emit("process:data", { processId, data: normalizedText });
        if (this.windowRef && !this.windowRef.isDestroyed()) {
          this.windowRef.webContents.send("terminal:process-data", {
            terminalId: terminalId || "any",
            processId,
            data: normalizedText
          });
        }
      };
      log.info(`[ProcessBridge] Command written to terminal ${targetTerminalId}: ${command}`);
      if (this.windowRef && !this.windowRef.isDestroyed()) {
        this.windowRef.webContents.send("process:started", {
          processId,
          command,
          cwd,
          terminalId: terminalId || "any"
        });
      }
      return { processId, success: true };
    } catch (error) {
      log.error("[ProcessBridge] Failed to start process:", error);
      return {
        processId: "",
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  // Stop a process
  async stopProcess(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return { success: false, error: "Process not found" };
    }
    if (!managedProcess.isRunning) {
      return { success: true, actuallyStopped: true };
    }
    try {
      log.info(`[ProcessBridge] Stopping process ${processId}`);
      const terminalId = managedProcess.terminalId;
      let terminalExists = false;
      if (terminalId) {
        const terminals22 = getTerminals();
        terminalExists = terminals22.has(terminalId);
        if (terminalExists) {
          writeToTerminal(terminalId, "");
          log.info(`[ProcessBridge] Sent first Ctrl+C to terminal ${terminalId}`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          writeToTerminal(terminalId, "");
          log.info(`[ProcessBridge] Sent second Ctrl+C to terminal ${terminalId}`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          writeToTerminal(terminalId, "");
          log.info(`[ProcessBridge] Sent third Ctrl+C to terminal ${terminalId}`);
        } else {
          log.warn(`[ProcessBridge] Terminal ${terminalId} no longer exists, process may have already exited`);
          managedProcess.isRunning = false;
          managedProcess.output.push("\n--- Process already stopped (terminal closed) ---\n");
          return { success: true, actuallyStopped: true };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const terminals2 = getTerminals();
      const terminalStillExists = terminalId ? terminals2.has(terminalId) : false;
      managedProcess.isRunning = false;
      managedProcess.output.push("\n--- Process stopped by user ---\n");
      for (const [key, pid] of this.commandTypeMap.entries()) {
        if (pid === processId) {
          this.commandTypeMap.delete(key);
          log.info(`[ProcessBridge] Cleaned up command type mapping: ${key}`);
          break;
        }
      }
      return {
        success: true,
        actuallyStopped: terminalStillExists || !terminalExists
      };
    } catch (error) {
      log.error(`[ProcessBridge] Failed to stop process ${processId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  // Restart a process
  async restartProcess(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return { processId: "", success: false, error: "Process not found" };
    }
    const terminals2 = getTerminals();
    let terminalId = managedProcess.terminalId;
    if (terminalId && !terminals2.has(terminalId)) {
      log.info(`[ProcessBridge] Terminal ${terminalId} no longer exists, will create new terminal for restart`);
      terminalId = void 0;
    }
    await this.stopProcess(processId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.startProcess(
      managedProcess.command,
      managedProcess.cwd,
      terminalId
    );
  }
  // Get all processes
  getAllProcesses() {
    const terminals2 = getTerminals();
    const activeProcesses = [];
    for (const [id, p] of this.processes) {
      if (p.terminalId && !terminals2.has(p.terminalId)) {
        if (p.isRunning) {
          p.isRunning = false;
          log.info(`[ProcessBridge] Process ${id} marked as stopped - terminal ${p.terminalId} no longer exists`);
        }
        for (const [key, pid] of this.commandTypeMap.entries()) {
          if (pid === id) {
            this.commandTypeMap.delete(key);
            log.info(`[ProcessBridge] Cleaned up command type mapping: ${key}`);
            break;
          }
        }
      }
      activeProcesses.push({
        id: p.id,
        command: p.command,
        isRunning: p.isRunning,
        startTime: p.startTime,
        cwd: p.cwd,
        terminalId: p.terminalId
      });
    }
    return activeProcesses;
  }
  // Get process output
  getProcessOutput(processId) {
    const managedProcess = this.processes.get(processId);
    return managedProcess ? managedProcess.output : null;
  }
  // Get a specific process
  getProcess(processId) {
    return this.processes.get(processId);
  }
  // Clean up stopped processes
  cleanupProcess(processId) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess) {
      return false;
    }
    if (managedProcess.isRunning) {
      return false;
    }
    this.processes.delete(processId);
    return true;
  }
  // Clean up all processes
  cleanupAll() {
    for (const [id, managedProcess] of this.processes) {
      if (managedProcess.isRunning && managedProcess.process) {
        try {
          managedProcess.process.kill("SIGTERM");
        } catch (error) {
          log.error(`[ProcessBridge] Failed to kill process ${id}:`, error);
        }
      }
    }
    this.processes.clear();
    this.commandTypeMap.clear();
    log.info("[ProcessBridge] All processes and command type mappings cleaned up");
  }
  // Send input to a process (for interactive processes)
  sendInput(processId, input) {
    const managedProcess = this.processes.get(processId);
    if (!managedProcess || !managedProcess.isRunning) {
      return false;
    }
    if (managedProcess.terminalId) {
      return writeToTerminal(managedProcess.terminalId, input);
    }
    if (managedProcess.process?.stdin) {
      try {
        managedProcess.process.stdin.write(input);
        return true;
      } catch (error) {
        log.error(`[ProcessBridge] Failed to send input to process ${processId}:`, error);
      }
    }
    return false;
  }
  // Parse command into cmd and args
  parseCommand(command) {
    if (process.platform === "win32") {
      return { cmd: "cmd.exe", args: ["/c", command] };
    }
    return { cmd: process.env.SHELL || "/bin/bash", args: ["-c", command] };
  }
}
const processBridge = new ProcessTerminalBridge();
const execPromise = util.promisify(child_process.exec);
const recentCommands = /* @__PURE__ */ new Map();
const COMMAND_DEDUP_WINDOW = 5e3;
async function executeReadFile(filePath) {
  try {
    const targetPath = path__namespace.resolve(getCurrentWorkingDirectory(), filePath);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `File does not exist: ${filePath}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (stats.isDirectory()) {
      return { success: false, output: "", error: `Path is a directory: ${filePath}` };
    }
    const content = fs__namespace.readFileSync(targetPath, "utf-8");
    return { success: true, output: content };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeWriteFile(filePath, content) {
  try {
    const targetPath = path__namespace.resolve(getCurrentWorkingDirectory(), filePath);
    const parentDir = path__namespace.dirname(targetPath);
    if (!fs__namespace.existsSync(parentDir)) {
      fs__namespace.mkdirSync(parentDir, { recursive: true });
    }
    fs__namespace.writeFileSync(targetPath, content, "utf-8");
    return { success: true, output: `File written successfully: ${targetPath}` };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeEditFile(filePath, oldString, newString) {
  try {
    const targetPath = path__namespace.resolve(getCurrentWorkingDirectory(), filePath);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `File does not exist: ${filePath}` };
    }
    let content = fs__namespace.readFileSync(targetPath, "utf-8");
    if (!content.includes(oldString)) {
      return {
        success: false,
        output: "",
        error: `Could not find the exact text to replace in ${filePath}. The text must match exactly including whitespace.`
      };
    }
    content = content.replace(oldString, newString);
    fs__namespace.writeFileSync(targetPath, content, "utf-8");
    return { success: true, output: `File edited successfully: ${targetPath}` };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeListDirectory(dirPath) {
  try {
    const targetPath = path__namespace.resolve(getCurrentWorkingDirectory(), dirPath);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Directory does not exist: ${dirPath}` };
    }
    const stats = fs__namespace.statSync(targetPath);
    if (!stats.isDirectory()) {
      return { success: false, output: "", error: `Path is not a directory: ${dirPath}` };
    }
    const items = fs__namespace.readdirSync(targetPath);
    const output = items.filter((item) => !item.startsWith(".") && item !== "node_modules").map((item) => {
      const itemPath = path__namespace.join(targetPath, item);
      const itemStats = fs__namespace.statSync(itemPath);
      return itemStats.isDirectory() ? `${item}/` : item;
    }).join("\n");
    return { success: true, output: output || "(empty directory)" };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeDeleteFile(filePath) {
  try {
    const targetPath = path__namespace.resolve(getCurrentWorkingDirectory(), filePath);
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Path does not exist: ${filePath}` };
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
async function executeExecuteBash(command) {
  const baseCwd = getCurrentWorkingDirectory();
  const cwd = extractCwdFromCommand(command, baseCwd);
  const commandKey = `${cwd}:${command}`;
  const now = Date.now();
  const lastExecution = recentCommands.get(commandKey);
  if (lastExecution && now - lastExecution < COMMAND_DEDUP_WINDOW) {
    const commandTypeKey = processBridge.getCommandTypeKey(command, cwd);
    const runningProcesses = processBridge.getAllProcesses().filter(
      (p) => p.isRunning && p.terminalId === `terminal-${commandTypeKey}`
    );
    if (runningProcesses.length > 0) {
      log.warn(`Duplicate command detected and process is running, skipping: ${command}`);
      return {
        success: true,
        output: `Command is already running (duplicate detected). Process ID: ${runningProcesses[0].id}`
      };
    } else {
      log.info(`Command was recently executed but process not running, allowing re-execution: ${command}`);
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
  if (shouldRunInTerminal) {
    const result = await processBridge.startProcess(command, cwd);
    if (result.success) {
      return {
        success: true,
        output: `Started process in terminal (PID: ${result.processId}). Command: ${command}`
      };
    } else {
      return {
        success: false,
        output: "",
        error: `Failed to start process in terminal: ${result.error}`
      };
    }
  }
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd,
      timeout: 6e4,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      success: true,
      output: stdout || "(no output)",
      error: stderr || void 0
    };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || "",
      error: error.stderr || error.message || String(error)
    };
  }
}
async function executeSearchCode(pattern, searchPath) {
  try {
    const targetPath = searchPath ? path__namespace.resolve(getCurrentWorkingDirectory(), searchPath) : getCurrentWorkingDirectory();
    if (!fs__namespace.existsSync(targetPath)) {
      return { success: false, output: "", error: `Path does not exist: ${searchPath || "."}` };
    }
    const { stdout, stderr } = await execPromise(
      `grep -r "${pattern.replace(/"/g, '\\"')}" "${targetPath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.java" --include="*.go" --include="*.rs" -l 2>/dev/null || true`,
      { timeout: 3e4 }
    );
    if (stderr && !stdout) {
      return { success: false, output: "", error: stderr };
    }
    const files = stdout.trim().split("\n").filter((f) => f);
    if (files.length === 0) {
      return { success: true, output: "No matches found" };
    }
    return { success: true, output: files.join("\n") };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeGetRunningProcesses() {
  try {
    const processes = processBridge.getAllProcesses();
    const runningProcesses = processes.filter((p) => p.isRunning);
    if (runningProcesses.length === 0) {
      return { success: true, output: "No running processes found" };
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
    return { success: true, output };
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeStopProcess(processId) {
  try {
    if (!processId) {
      return { success: false, output: "", error: "Process ID is required" };
    }
    const result = await processBridge.stopProcess(processId);
    if (result.success) {
      if (result.actuallyStopped) {
        return { success: true, output: `Process ${processId} stopped successfully` };
      } else {
        return {
          success: true,
          output: `Stop signal sent to process ${processId}, but could not verify if process actually stopped. Please check the terminal to confirm.`
        };
      }
    } else {
      return { success: false, output: "", error: result.error || "Failed to stop process" };
    }
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeRestartProcess(processId) {
  try {
    if (!processId) {
      return { success: false, output: "", error: "Process ID is required" };
    }
    const result = await processBridge.restartProcess(processId);
    if (result.success) {
      return { success: true, output: `Process ${processId} restarted successfully. New process ID: ${result.processId}` };
    } else {
      return { success: false, output: "", error: result.error || "Failed to restart process" };
    }
  } catch (error) {
    return { success: false, output: "", error: String(error) };
  }
}
async function executeTool(name, args) {
  log.info(`Executing tool: ${name} with args:`, args);
  switch (name) {
    case "read_file":
      return executeReadFile(args.path);
    case "write_file":
      return executeWriteFile(args.path, args.content);
    case "edit_file":
      return executeEditFile(args.path, args.old_string, args.new_string);
    case "delete_file":
      return executeDeleteFile(args.path);
    case "list_directory":
      return executeListDirectory(args.path);
    case "execute_bash":
      return executeExecuteBash(args.command);
    case "search_code":
      return executeSearchCode(args.pattern, args.path);
    case "get_running_processes":
      return executeGetRunningProcesses();
    case "stop_process":
      return executeStopProcess(args.process_id);
    case "restart_process":
      return executeRestartProcess(args.process_id);
    default:
      return { success: false, output: "", error: `Unknown tool: ${name}` };
  }
}
let server = null;
const sessions = /* @__PURE__ */ new Map();
const managedProcesses = /* @__PURE__ */ new Map();
function getSessionsDir() {
  const dir = path.join(electron.app.getPath("userData"), "sessions");
  if (!fs__namespace.existsSync(dir)) {
    fs__namespace.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function saveSession(session) {
  const dir = getSessionsDir();
  const sessionPath = path.join(dir, `${session.id}.json`);
  try {
    fs__namespace.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  } catch (e) {
    log.error(`Failed to save session ${session.id}:`, e);
  }
}
function deleteSessionFromDisk(sessionId) {
  const dir = getSessionsDir();
  const sessionPath = path.join(dir, `${sessionId}.json`);
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
  expressApp.use(express.json());
  expressApp.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });
  const commandsService = getCommandsService();
  const toolsService = getToolsService();
  log.info(`API Server initialized: ${commandsService.getCount()} commands, ${toolsService.getCount()} tools`);
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
  expressApp.get("/api/subsystems", (_req, res) => {
    res.json([
      { name: "commands", file_count: commandsService.getCount(), notes: "Command surface" },
      { name: "tools", file_count: toolsService.getCount(), notes: "Tool surface" },
      { name: "runtime", file_count: 1, notes: "Runtime orchestration" },
      { name: "query_engine", file_count: 1, notes: "Query engine" },
      { name: "session_store", file_count: 1, notes: "Session storage" },
      { name: "permissions", file_count: 1, notes: "Permission management" }
    ]);
  });
  expressApp.post("/api/chat", async (req, res) => {
    try {
      const { apiKey, model, messages, tools, stream = false } = req.body;
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
        const result = {
          id: response.id,
          type: response.type,
          role: response.role,
          content: response.content,
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
    const { tool_calls } = req.body;
    if (!tool_calls || !Array.isArray(tool_calls)) {
      res.status(400).json({ error: "tool_calls array is required" });
      return;
    }
    const results = [];
    for (const toolCall of tool_calls) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args);
        results.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: result.success ? result.output : `Error: ${result.error || "Unknown error"}`
        });
      } catch (error) {
        results.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: `Error executing tool: ${String(error)}`
        });
      }
    }
    res.json({ results });
  });
  expressApp.post("/api/tools/execute-direct", async (req, res) => {
    const { tool, arguments: args, cwd } = req.body;
    if (!tool) {
      res.status(400).json({ error: "tool name is required" });
      return;
    }
    try {
      if (cwd) {
        setCurrentWorkingDirectory(cwd);
      }
      log.info(`Executing tool ${tool} with args:`, args, "in cwd:", cwd || getCurrentWorkingDirectory());
      const result = await executeTool(tool, args || {});
      res.json({ result });
    } catch (error) {
      log.error("Tool execution error:", error);
      res.status(500).json({ error: String(error) });
    }
  });
  expressApp.post("/api/sessions", (req, res) => {
    const id = uuid.v4();
    const session = {
      id,
      messages: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      inputTokens: 0,
      outputTokens: 0
    };
    sessions.set(id, session);
    saveSession(session);
    const { id: _sessionId, ...sessionWithoutId } = session;
    res.json({ id, ...sessionWithoutId });
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
      messageCount: s.messages.length
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
      const execResult = await executeCommand(command, prompt || "");
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
      const content = readFile(filePath);
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
  expressApp.post("/api/tools/execute", async (req, res) => {
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
log.transports.file.level = "info";
log.transports.console.level = "debug";
log.info("Application starting...");
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  electron.app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
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
    const commands = ["add-dir", "agents", "branch", "btw", "git", "npm", "docker", "build", "test", "deploy"];
    const tools = ["bash", "file", "glob", "grep", "edit", "write", "read", "mcp"];
    const matches = [];
    const lowerPrompt = prompt.toLowerCase();
    for (const cmd of commands) {
      if (lowerPrompt.includes(cmd)) {
        matches.push({ kind: "command", name: cmd, score: 1 });
      }
    }
    for (const tool of tools) {
      if (lowerPrompt.includes(tool)) {
        matches.push({ kind: "tool", name: tool, score: 1 });
      }
    }
    return matches.slice(0, 5);
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
  electron.ipcMain.handle("process:start-in-terminal", async (_event, { command, cwd, terminalId }) => {
    try {
      const result = await processBridge.startProcess(command, cwd, terminalId);
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
  log.info("Process bridge handlers registered");
}
electron.app.whenReady().then(async () => {
  log.info("App ready, initializing...");
  try {
    await startApiServer();
    log.info("API server started");
  } catch (error) {
    log.error("Failed to start API server:", error);
  }
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
