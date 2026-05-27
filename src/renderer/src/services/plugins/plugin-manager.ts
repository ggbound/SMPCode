/**
 * Plugin Manager - 插件管理器
 * 管理插件的生命周期和 API 暴露
 */

import { PluginContext, StatusBarItem, MenuItem, WebviewPanel, WebviewOptions, ToolDefinition } from './plugin-api'
import type * as monaco from 'monaco-editor'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  main: string
  contributes?: {
    commands?: Array<{
      command: string
      title: string
      category?: string
      icon?: string
    }>
    keybindings?: Array<{
      key: string
      command: string
      when?: string
    }>
    menus?: {
      [location: string]: MenuItem[]
    }
    configuration?: {
      title: string
      properties: {
        [key: string]: {
          type: string
          default: any
          description: string
          enum?: string[]
        }
      }
    }
  }
  activationEvents?: string[]
  engines: {
    smpcode: string
  }
}

export interface Plugin {
  manifest: PluginManifest
  context: PluginContext
  exports: any
  isActive: boolean
  disposables: (() => void)[]
}

export interface PluginRegistration {
  manifest: PluginManifest
  load: () => Promise<Plugin>
  unload: () => Promise<void>
}

export type ActivationEvent =
  | { type: 'onLanguage'; language: string }
  | { type: 'onCommand'; command: string }
  | { type: 'onFile'; pattern: string }
  | { type: 'onStartupFinished' }
  | { type: '*'; } // 始终激活

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private manifestCache: Map<string, PluginManifest> = new Map()
  private contextFactory: (() => PluginContext) | null = null
  private activationListeners: Map<string, Set<() => void>> = new Map()
  private registeredCommands: Map<string, (...args: any[]) => any> = new Map()
  private statusBarItems: StatusBarItem[] = []
  private menuItems: Map<string, MenuItem[]> = new Map()

  constructor() {
    console.log('[PluginManager] Initialized')
  }

  /**
   * 设置上下文工厂
   */
  setContextFactory(factory: () => PluginContext): void {
    this.contextFactory = factory
  }

  /**
   * 加载插件清单
   */
  async loadManifest(pluginPath: string): Promise<PluginManifest | null> {
    try {
      // 通过 IPC 从主进程读取插件清单
      const ipc = (window as any).api?.plugin
      if (!ipc?.loadManifest) {
        throw new Error('Plugin IPC not available')
      }

      const manifest = await ipc.loadManifest(pluginPath)
      this.manifestCache.set(manifest.id, manifest)
      return manifest
    } catch (error) {
      console.error(`[PluginManager] Failed to load manifest from ${pluginPath}:`, error)
      return null
    }
  }

  /**
   * 安装插件
   */
  async installPlugin(source: string | File): Promise<{ success: boolean; manifest?: PluginManifest; error?: string }> {
    try {
      const ipc = (window as any).api?.plugin
      if (!ipc?.install) {
        throw new Error('Plugin IPC not available')
      }

      const result = await ipc.install(source)
      if (result.success && result.manifest) {
        this.manifestCache.set(result.manifest.id, result.manifest)
      }
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * 卸载插件
   */
  async uninstallPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (plugin) {
      await this.deactivatePlugin(pluginId)
    }

    try {
      const ipc = (window as any).api?.plugin
      if (ipc?.uninstall) {
        await ipc.uninstall(pluginId)
      }
      this.manifestCache.delete(pluginId)
      return true
    } catch (error) {
      console.error(`[PluginManager] Failed to uninstall plugin ${pluginId}:`, error)
      return false
    }
  }

  /**
   * 注册插件
   */
  registerPlugin(manifest: PluginManifest, module: any): void {
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginManager] Plugin ${manifest.id} already registered`)
      return
    }

    // 创建插件上下文
    const context = this.createPluginContext(manifest)

    const plugin: Plugin = {
      manifest,
      context,
      exports: {},
      isActive: false,
      disposables: []
    }

    this.plugins.set(manifest.id, plugin)
    console.log(`[PluginManager] Registered plugin: ${manifest.name} (${manifest.id})`)

    // 检查激活事件
    this.checkActivationEvents(manifest)
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      console.error(`[PluginManager] Plugin ${pluginId} not found`)
      return false
    }

    if (plugin.isActive) {
      return true
    }

    try {
      // 加载插件模块
      const ipc = (window as any).api?.plugin
      if (!ipc?.load) {
        throw new Error('Plugin IPC not available')
      }

      const module = await ipc.load(pluginId)

      // 调用激活函数
      if (module.activate) {
        const exports = await module.activate(plugin.context)
        plugin.exports = exports || {}
      }

      plugin.isActive = true
      console.log(`[PluginManager] Activated plugin: ${plugin.manifest.name}`)

      // 注册插件贡献的命令
      this.registerPluginContributions(plugin)

      return true
    } catch (error) {
      console.error(`[PluginManager] Failed to activate plugin ${pluginId}:`, error)
      return false
    }
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin || !plugin.isActive) {
      return true
    }

    try {
      // 调用停用函数
      if (plugin.exports.deactivate) {
        await plugin.exports.deactivate()
      }

      // 清理资源
      plugin.disposables.forEach(dispose => {
        try {
          dispose()
        } catch (error) {
          console.error('[PluginManager] Error during dispose:', error)
        }
      })
      plugin.disposables = []

      plugin.isActive = false
      plugin.exports = {}

      console.log(`[PluginManager] Deactivated plugin: ${plugin.manifest.name}`)
      return true
    } catch (error) {
      console.error(`[PluginManager] Failed to deactivate plugin ${pluginId}:`, error)
      return false
    }
  }

  /**
   * 创建插件上下文
   */
  private createPluginContext(manifest: PluginManifest): PluginContext {
    if (!this.contextFactory) {
      throw new Error('Context factory not set')
    }

    const baseContext = this.contextFactory()

    // 增强上下文，添加插件特定功能
    const context: PluginContext = {
      ...baseContext,

      // 存储 API（插件隔离）
      storage: {
        get: async <T>(key: string, defaultValue?: T): Promise<T | undefined> => {
          const fullKey = `plugin.${manifest.id}.${key}`
          const ipc = (window as any).api?.storage
          if (ipc?.get) {
            return await ipc.get(fullKey, defaultValue)
          }
          return defaultValue
        },
        set: async <T>(key: string, value: T): Promise<void> => {
          const fullKey = `plugin.${manifest.id}.${key}`
          const ipc = (window as any).api?.storage
          if (ipc?.set) {
            await ipc.set(fullKey, value)
          }
        },
        delete: async (key: string): Promise<void> => {
          const fullKey = `plugin.${manifest.id}.${key}`
          const ipc = (window as any).api?.storage
          if (ipc?.delete) {
            await ipc.delete(fullKey)
          }
        },
        onChange: (key: string, callback: (value: any) => void): (() => void) => {
          const fullKey = `plugin.${manifest.id}.${key}`
          const ipc = (window as any).api?.storage
          if (ipc?.onChange) {
            return ipc.onChange(fullKey, callback)
          }
          return () => {}
        }
      },

      // 日志 API（添加插件前缀）
      log: {
        debug: (message: string, ...args: any[]) => {
          console.debug(`[${manifest.id}]`, message, ...args)
        },
        info: (message: string, ...args: any[]) => {
          console.info(`[${manifest.id}]`, message, ...args)
        },
        warn: (message: string, ...args: any[]) => {
          console.warn(`[${manifest.id}]`, message, ...args)
        },
        error: (message: string, ...args: any[]) => {
          console.error(`[${manifest.id}]`, message, ...args)
        }
      }
    }

    return context
  }

  /**
   * 检查激活事件
   */
  private checkActivationEvents(manifest: PluginManifest): void {
    if (!manifest.activationEvents) return

    manifest.activationEvents.forEach(event => {
      if (event === '*') {
        // 始终激活
        this.activatePlugin(manifest.id)
      } else if (event === 'onStartupFinished') {
        // 启动完成后激活
        setTimeout(() => this.activatePlugin(manifest.id), 100)
      } else if (event.startsWith('onLanguage:')) {
        // 语言激活
        const language = event.replace('onLanguage:', '')
        this.listenForLanguage(language, () => this.activatePlugin(manifest.id))
      } else if (event.startsWith('onCommand:')) {
        // 命令激活
        const command = event.replace('onCommand:', '')
        this.listenForCommand(command, () => this.activatePlugin(manifest.id))
      }
    })
  }

  /**
   * 监听语言事件
   */
  private listenForLanguage(language: string, callback: () => void): void {
    if (!this.activationListeners.has(language)) {
      this.activationListeners.set(language, new Set())
    }
    this.activationListeners.get(language)!.add(callback)
  }

  /**
   * 监听命令事件
   */
  private listenForCommand(command: string, callback: () => void): void {
    if (!this.activationListeners.has(command)) {
      this.activationListeners.set(command, new Set())
    }
    this.activationListeners.get(command)!.add(callback)
  }

  /**
   * 触发语言激活
   */
  triggerLanguageActivation(language: string): void {
    const callbacks = this.activationListeners.get(language)
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb()
        } catch (error) {
          console.error('[PluginManager] Activation callback error:', error)
        }
      })
    }
  }

  /**
   * 注册插件贡献
   */
  private registerPluginContributions(plugin: Plugin): void {
    const { contributes } = plugin.manifest
    if (!contributes) return

    // 注册命令
    if (contributes.commands) {
      contributes.commands.forEach(cmd => {
        this.registerCommand(cmd.command, (...args: any[]) => {
          if (plugin.exports[cmd.command]) {
            return plugin.exports[cmd.command](...args)
          }
        })
      })
    }

    // 注册快捷键
    if (contributes.keybindings) {
      contributes.keybindings.forEach(kb => {
        // 通过 UI API 注册
        plugin.context.ui.registerKeybinding(kb.key, kb.command, kb.when)
      })
    }

    // 注册菜单项
    if (contributes.menus) {
      Object.entries(contributes.menus).forEach(([location, items]) => {
        items.forEach(item => {
          plugin.context.ui.registerMenuItem(location, item)
        })
      })
    }
  }

  /**
   * 注册命令
   */
  registerCommand(commandId: string, callback: (...args: any[]) => any): void {
    this.registeredCommands.set(commandId, callback)
  }

  /**
   * 执行命令
   */
  async executeCommand(commandId: string, ...args: any[]): Promise<any> {
    const command = this.registeredCommands.get(commandId)
    if (!command) {
      throw new Error(`Command ${commandId} not found`)
    }
    return await command(...args)
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * 获取已激活的插件
   */
  getActivePlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.isActive)
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId)
  }

  /**
   * 检查插件是否激活
   */
  isPluginActive(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    return plugin?.isActive || false
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    // 停用所有插件
    for (const [id] of this.plugins) {
      await this.deactivatePlugin(id)
    }

    this.plugins.clear()
    this.manifestCache.clear()
    this.activationListeners.clear()
    this.registeredCommands.clear()
    this.menuItems.clear()

    // 清理状态栏项
    this.statusBarItems.forEach(item => item.dispose())
    this.statusBarItems = []

    console.log('[PluginManager] Disposed')
  }
}

// 示例插件清单
export const ExamplePluginManifest: PluginManifest = {
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  description: 'An example plugin for SMP Code',
  author: 'SMP Code Team',
  main: 'index.js',
  contributes: {
    commands: [
      {
        command: 'example.hello',
        title: 'Hello World',
        category: 'Example'
      }
    ],
    keybindings: [
      {
        key: 'ctrl+shift+h',
        command: 'example.hello'
      }
    ]
  },
  activationEvents: ['onCommand:example.hello'],
  engines: {
    smpcode: '^0.1.0'
  }
}

export default PluginManager
