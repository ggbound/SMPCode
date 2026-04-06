import Store from 'electron-store'
import log from 'electron-log'
import { app } from 'electron'
import { join } from 'path'

export interface ModelConfig {
  id: string
  name: string
  group?: string
}

export interface ProviderConfig {
  id: string
  name: string
  type: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  apiUrl: string
  enabled: boolean
  models: ModelConfig[]
}

export interface AppConfig {
  apiKey: string
  model: string
  defaultModel: string
  permissionMode: string
  providers: ProviderConfig[]
}

// Default configuration - all empty, user must configure manually
const defaultConfig: AppConfig = {
  apiKey: '',
  model: '',
  defaultModel: '',
  permissionMode: 'workspace-write',
  providers: []
}

// Store instance
let store: Store | null = null

/**
 * Initialize the config store with custom path for SMP Code
 */
export function initConfigStore(): void {
  try {
    // Use SMP Code as the app name for config storage
    const userDataPath = app.getPath('userData')
    const configPath = join(userDataPath, 'config.json')
    
    // Check if old config exists and migrate
    const oldConfigPath = join(userDataPath, '..', 'smp-code-web', 'config.json')
    const fs = require('fs')
    
    if (fs.existsSync(oldConfigPath) && !fs.existsSync(configPath)) {
      log.info(`Migrating config from ${oldConfigPath} to ${configPath}`)
      try {
        const oldConfig = fs.readFileSync(oldConfigPath, 'utf8')
        fs.writeFileSync(configPath, oldConfig)
        log.info('Config migrated successfully')
      } catch (e) {
        log.error('Failed to migrate config:', e)
      }
    }
    
    store = new Store({
      defaults: defaultConfig as unknown as Record<string, unknown>,
      cwd: userDataPath
    })
    log.info(`Config store initialized at ${store.path}, userData: ${userDataPath}`)
  } catch (error) {
    log.error('Failed to initialize config store:', error)
    throw error
  }
}

/**
 * Get store instance
 */
function getStore(): Store {
  if (!store) {
    initConfigStore()
  }
  return store!
}

/**
 * Save configuration to store
 */
export function saveConfig(config: AppConfig): boolean {
  try {
    const s = getStore()
    // Save each field individually to avoid nesting issues
    s.set('apiKey', config.apiKey)
    s.set('model', config.model)
    s.set('defaultModel', config.defaultModel)
    s.set('permissionMode', config.permissionMode)
    s.set('providers', config.providers)
    log.info('Config saved to store')
    return true
  } catch (error) {
    log.error('Failed to save config:', error)
    return false
  }
}

/**
 * Load configuration from store
 */
export function loadConfig(): AppConfig {
  try {
    const s = getStore()
    const rawProviders = s.get('providers')
    log.info(`Raw providers from store: ${JSON.stringify(rawProviders)}`)
    
    const config: AppConfig = {
      apiKey: s.get('apiKey', defaultConfig.apiKey) as string,
      model: s.get('model', defaultConfig.model) as string,
      defaultModel: s.get('defaultModel', defaultConfig.defaultModel) as string,
      permissionMode: s.get('permissionMode', defaultConfig.permissionMode) as string,
      providers: s.get('providers', defaultConfig.providers) as ProviderConfig[]
    }
    log.info(`Config loaded from store: ${config.providers?.length || 0} providers`)
    return config
  } catch (error) {
    log.error('Failed to load config:', error)
    return defaultConfig
  }
}

/**
 * Update specific config field
 */
export function updateConfigField<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K]
): boolean {
  try {
    const s = getStore()
    s.set(key, value)
    log.info(`Config field ${key} updated`)
    return true
  } catch (error) {
    log.error('Failed to update config field:', error)
    return false
  }
}

/**
 * Reset configuration to default
 */
export function resetConfig(): boolean {
  try {
    const s = getStore()
    s.set('apiKey', defaultConfig.apiKey)
    s.set('model', defaultConfig.model)
    s.set('defaultModel', defaultConfig.defaultModel)
    s.set('permissionMode', defaultConfig.permissionMode)
    s.set('providers', defaultConfig.providers)
    log.info('Config reset to default')
    return true
  } catch (error) {
    log.error('Failed to reset config:', error)
    return false
  }
}

/**
 * Get store file path
 */
export function getStorePath(): string {
  const s = getStore()
  return s.path
}
