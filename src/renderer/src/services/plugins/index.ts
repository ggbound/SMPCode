/**
 * Plugins Module - 插件模块
 */

export { PluginManager, PluginManifest, Plugin, PluginRegistration, ActivationEvent, ExamplePluginManifest } from './plugin-manager'
export {
  PluginContext,
  StatusBarItem,
  MenuItem,
  WebviewPanel,
  WebviewOptions,
  ToolDefinition,
  AISendOptions,
  DecorationOptions,
  DecorationAttachment,
  CodeLens,
  CodeAction,
  CompletionItem,
  Hover
} from './plugin-api'

// 插件管理器实例
import { PluginManager } from './plugin-manager'

let pluginManager: PluginManager | null = null

/**
 * 获取插件管理器实例
 */
export function getPluginManager(): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager()
  }
  return pluginManager
}

/**
 * 初始化插件系统
 */
export async function initializePlugins(): Promise<void> {
  const manager = getPluginManager()

  // 加载已安装的插件
  try {
    const ipc = (window as any).api?.plugin
    if (ipc?.listInstalled) {
      const installedPlugins = await ipc.listInstalled()
      for (const pluginInfo of installedPlugins) {
        const manifest = await manager.loadManifest(pluginInfo.path)
        if (manifest) {
          manager.registerPlugin(manifest, {})
        }
      }
    }
  } catch (error) {
    console.error('[Plugins] Failed to load installed plugins:', error)
  }
}

/**
 * 插件类型守卫
 */
export function isPluginActive(pluginId: string): boolean {
  return getPluginManager().isPluginActive(pluginId)
}

/**
 * 检查插件是否存在
 */
export function hasPlugin(pluginId: string): boolean {
  return !!getPluginManager().getPlugin(pluginId)
}

/**
 * 执行插件命令
 */
export async function executePluginCommand(commandId: string, ...args: any[]): Promise<any> {
  return await getPluginManager().executeCommand(commandId, ...args)
}

/**
 * 插件市场相关
 */
export namespace PluginMarketplace {
  export interface PluginListing {
    id: string
    name: string
    version: string
    description: string
    author: string
    downloads: number
    rating: number
    icon?: string
    tags: string[]
    lastUpdated: string
  }

  export interface PluginDetail extends PluginListing {
    readme: string
    changelog: string
    screenshots: string[]
    dependencies: string[]
    size: number
  }

  export async function search(query: string): Promise<PluginListing[]> {
    try {
      const ipc = (window as any).api?.plugin
      if (ipc?.marketplace?.search) {
        return await ipc.marketplace.search(query)
      }
      return []
    } catch (error) {
      console.error('[Plugins] Marketplace search failed:', error)
      return []
    }
  }

  export async function getDetails(pluginId: string): Promise<PluginDetail | null> {
    try {
      const ipc = (window as any).api?.plugin
      if (ipc?.marketplace?.getDetails) {
        return await ipc.marketplace.getDetails(pluginId)
      }
      return null
    } catch (error) {
      console.error('[Plugins] Failed to get plugin details:', error)
      return null
    }
  }

  export async function install(pluginId: string): Promise<boolean> {
    try {
      const ipc = (window as any).api?.plugin
      if (ipc?.marketplace?.install) {
        return await ipc.marketplace.install(pluginId)
      }
      return false
    } catch (error) {
      console.error('[Plugins] Failed to install plugin:', error)
      return false
    }
  }
}

// 导出示例
export * as ExamplePlugin from './example-plugin'

// 默认导出
export default {
  getPluginManager,
  initializePlugins,
  isPluginActive,
  hasPlugin,
  executePluginCommand,
  PluginMarketplace
}
