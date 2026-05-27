/**
 * PluginManager - 插件管理组件
 * 提供插件管理界面
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Puzzle,
  Download,
  Trash2,
  RefreshCw,
  Search,
  Settings,
  Check,
  X,
  Star,
  DownloadIcon,
  Package,
  AlertCircle,
  Code
} from 'lucide-react'
import { getPluginManager, initializePlugins, PluginMarketplace, PluginListing } from '../services/plugins'
import type { Plugin } from '../services/plugins'

export interface PluginManagerProps {
  onClose: () => void
}

type Tab = 'installed' | 'marketplace' | 'settings'

export const PluginManagerUI: React.FC<PluginManagerProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('installed')
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([])
  const [marketplacePlugins, setMarketplacePlugins] = useState<PluginListing[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | PluginListing | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载已安装插件
  const loadInstalledPlugins = useCallback(async () => {
    setIsLoading(true)
    try {
      await initializePlugins()
      const manager = getPluginManager()
      setInstalledPlugins(manager.getAllPlugins())
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 搜索插件市场
  const searchMarketplace = useCallback(async (query: string) => {
    setIsLoading(true)
    try {
      const results = await PluginMarketplace.search(query)
      setMarketplacePlugins(results)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 激活/停用插件
  const togglePlugin = useCallback(async (pluginId: string, activate: boolean) => {
    const manager = getPluginManager()
    try {
      if (activate) {
        await manager.activatePlugin(pluginId)
      } else {
        await manager.deactivatePlugin(pluginId)
      }
      loadInstalledPlugins()
    } catch (err) {
      setError(String(err))
    }
  }, [loadInstalledPlugins])

  // 卸载插件
  const uninstallPlugin = useCallback(async (pluginId: string) => {
    const manager = getPluginManager()
    try {
      await manager.uninstallPlugin(pluginId)
      loadInstalledPlugins()
    } catch (err) {
      setError(String(err))
    }
  }, [loadInstalledPlugins])

  // 安装插件
  const installPlugin = useCallback(async (pluginId: string) => {
    setIsLoading(true)
    try {
      const success = await PluginMarketplace.install(pluginId)
      if (success) {
        await loadInstalledPlugins()
        setActiveTab('installed')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [loadInstalledPlugins])

  // 初始加载
  useEffect(() => {
    loadInstalledPlugins()
  }, [loadInstalledPlugins])

  // 搜索防抖
  useEffect(() => {
    if (activeTab === 'marketplace') {
      const timeout = setTimeout(() => {
        searchMarketplace(searchQuery)
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [searchQuery, activeTab, searchMarketplace])

  // 渲染已安装插件列表
  const renderInstalledPlugins = () => (
    <div className="space-y-2">
      {installedPlugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Package className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-sm">没有已安装的插件</p>
          <p className="text-xs mt-1">前往插件市场安装</p>
        </div>
      ) : (
        installedPlugins.map(plugin => (
          <div
            key={plugin.manifest.id}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
              selectedPlugin?.manifest?.id === plugin.manifest.id
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
            onClick={() => setSelectedPlugin(plugin)}
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <Code className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{plugin.manifest.name}</span>
                <span className="text-xs text-gray-500">v{plugin.manifest.version}</span>
                {plugin.isActive && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">
                    已激活
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                {plugin.manifest.description}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-gray-500">{plugin.manifest.author}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlugin(plugin.manifest.id, !plugin.isActive)
                }}
                className={`p-2 rounded transition-colors ${
                  plugin.isActive
                    ? 'text-green-400 hover:bg-green-500/20'
                    : 'text-gray-400 hover:bg-white/10'
                }`}
                title={plugin.isActive ? '停用' : '激活'}
              >
                {plugin.isActive ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`确定要卸载 ${plugin.manifest.name} 吗？`)) {
                    uninstallPlugin(plugin.manifest.id)
                  }
                }}
                className="p-2 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                title="卸载"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )

  // 渲染插件市场列表
  const renderMarketplace = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索插件..."
            className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={() => searchMarketplace(searchQuery)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {marketplacePlugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Search className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-sm">未找到插件</p>
          <p className="text-xs mt-1">尝试其他关键词</p>
        </div>
      ) : (
        marketplacePlugins.map(plugin => (
          <div
            key={plugin.id}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
              selectedPlugin?.id === plugin.id
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
            onClick={() => setSelectedPlugin(plugin)}
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Puzzle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{plugin.name}</span>
                <span className="text-xs text-gray-500">v{plugin.version}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                {plugin.description}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[10px] text-gray-500">{plugin.author}</span>
                <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                  <Star className="w-3 h-3" />
                  {plugin.rating.toFixed(1)}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-blue-400">
                  <DownloadIcon className="w-3 h-3" />
                  {plugin.downloads.toLocaleString()}
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                installPlugin(plugin.id)
              }}
              className="p-2 text-green-400 hover:bg-green-500/20 rounded transition-colors"
              title="安装"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        ))
      )}
    </div>
  )

  // 渲染插件详情
  const renderPluginDetail = () => {
    if (!selectedPlugin) return null

    const isInstalled = 'manifest' in selectedPlugin
    const plugin = isInstalled
      ? (selectedPlugin as Plugin).manifest
      : (selectedPlugin as PluginListing)

    return (
      <div className="border-t border-white/10 p-4 bg-white/5">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <Code className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-white">{plugin.name}</h3>
            <p className="text-xs text-gray-400 mt-1">{plugin.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
              <span>v{plugin.version}</span>
              <span>{plugin.author}</span>
            </div>
          </div>
        </div>

        {!isInstalled && (
          <div className="mt-4">
            <button
              onClick={() => installPlugin(plugin.id)}
              disabled={isLoading}
              className="w-full py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isLoading ? '安装中...' : '安装'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-[800px] h-[600px] bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex">
        {/* 侧边栏 */}
        <div className="w-64 border-r border-white/10 bg-[#252526]">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-blue-400" />
              插件管理
            </h2>
          </div>

          <nav className="p-2 space-y-1">
            {[
              { id: 'installed', label: '已安装', icon: Package },
              { id: 'marketplace', label: '插件市场', icon: Download },
              { id: 'settings', label: '设置', icon: Settings }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-gray-400 hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="text-xs text-gray-500">
              <p>已安装: {installedPlugins.length}</p>
              <p className="mt-1">已激活: {installedPlugins.filter(p => p.isActive).length}</p>
            </div>
          </div>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 flex flex-col">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-medium text-white">
              {activeTab === 'installed' && '已安装插件'}
              {activeTab === 'marketplace' && '插件市场'}
              {activeTab === 'settings' && '插件设置'}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 内容 */}
          <div className="flex-1 overflow-auto p-4">
            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-300 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {activeTab === 'installed' && renderInstalledPlugins()}
            {activeTab === 'marketplace' && renderMarketplace()}
            {activeTab === 'settings' && (
              <div className="space-y-4">
                <div className="p-4 bg-white/5 rounded-lg">
                  <h4 className="text-sm font-medium text-white mb-2">自动更新</h4>
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <input type="checkbox" className="rounded border-white/20" />
                    自动检查插件更新
                  </label>
                </div>
                <div className="p-4 bg-white/5 rounded-lg">
                  <h4 className="text-sm font-medium text-white mb-2">插件目录</h4>
                  <code className="text-xs text-gray-500 bg-black/30 px-2 py-1 rounded">
                    ~/.smp-code/plugins
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* 详情面板 */}
          {selectedPlugin && renderPluginDetail()}
        </div>
      </div>
    </div>
  )
}

export default PluginManagerUI
