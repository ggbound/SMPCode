import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, X, Trash2, Plus, Edit2, Check, Loader2, ChevronDown, Cloud, CloudOff, MessageSquare } from 'lucide-react'
import type { ProviderConfig, ModelConfig, FeishuConfig, SyncStatus } from '../store'
import { t } from '../i18n'

// 检测状态类型
type TestStatus = 'idle' | 'testing' | 'success' | 'error'

interface SettingsModalProps {
  apiKey: string
  model: string
  defaultModel: string
  permissionMode: string
  providers: ProviderConfig[]
  feishuConfig: FeishuConfig
  syncStatus: SyncStatus
  onSave: (apiKey: string, model: string, defaultModel: string, permissionMode: string, providers: ProviderConfig[]) => void
  onSaveFeishu: (config: FeishuConfig) => void
  onClose: () => void
}

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' }
]

const DEFAULT_API_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  custom: ''
}

function SettingsModal({ apiKey, model, defaultModel, permissionMode, providers, feishuConfig, syncStatus, onSave, onSaveFeishu, onClose }: SettingsModalProps) {
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localModel, setLocalModel] = useState(model)
  const [localDefaultModel, setLocalDefaultModel] = useState(defaultModel)
  const [localPermissionMode, setLocalPermissionMode] = useState(permissionMode)
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>(providers)
  const [localFeishuConfig, setLocalFeishuConfig] = useState<FeishuConfig>(feishuConfig)
  const [activeTab, setActiveTab] = useState<'general' | 'providers' | 'feishu'>('providers')
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id || '')
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [showAddModelModal, setShowAddModelModal] = useState(false)
  const [isEditingProvider, setIsEditingProvider] = useState(false)
  const [editingProviderName, setEditingProviderName] = useState('')
  
  // 保存状态管理
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle')

  // 默认模型下拉框状态
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  // API 连接检测状态
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  // 当 providers prop 变化时同步状态（解决重新打开应用后数据不显示的问题）
  useEffect(() => {
    setLocalProviders(providers)
    // 如果没有选中的供应商或当前选中的不在 providers 中，选择第一个
    if (providers.length > 0 && (!selectedProviderId || !providers.find(p => p.id === selectedProviderId))) {
      setSelectedProviderId(providers[0].id)
    }
  }, [providers])

  // 当 defaultModel prop 变化时同步状态
  useEffect(() => {
    setLocalDefaultModel(defaultModel)
  }, [defaultModel])

  // 当 model prop 变化时同步状态
  useEffect(() => {
    setLocalModel(model)
  }, [model])

  // 当 feishuConfig prop 变化时同步状态
  useEffect(() => {
    setLocalFeishuConfig(feishuConfig)
  }, [feishuConfig])

  // 当 providers 变化时，如果没有设置默认模型，自动选择第一个可用模型
  useEffect(() => {
    if (localProviders.length > 0 && !localDefaultModel) {
      const firstEnabledProvider = localProviders.find(p => p.enabled)
      if (firstEnabledProvider && firstEnabledProvider.models.length > 0) {
        const firstModel = firstEnabledProvider.models[0]
        setLocalDefaultModel(firstModel.id)
        setLocalModel(firstModel.id)
      }
    }
  }, [localProviders, localDefaultModel])

  // 点击外部关闭默认模型下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedProvider = localProviders.find(p => p.id === selectedProviderId) || localProviders[0] || null

  // 获取当前选中的模型信息
  const getSelectedModelInfo = () => {
    for (const provider of localProviders) {
      if (provider.enabled) {
        const model = provider.models.find(m => m.id === localDefaultModel)
        if (model) {
          return { provider, model }
        }
      }
    }
    return null
  }

  const selectedModelInfo = getSelectedModelInfo()

  // Save function that creates a deep copy to ensure data integrity
  const saveCurrentState = () => {
    // Create deep copy of providers to ensure we're passing the latest data
    const providersCopy = JSON.parse(JSON.stringify(localProviders))
    onSave(localApiKey, localModel, localDefaultModel, localPermissionMode, providersCopy)
    // 保存飞书配置
    onSaveFeishu(localFeishuConfig)
  }

  const handleSave = async () => {
    setSaveStatus('saving')
    saveCurrentState()
    
    // 模拟保存延迟后显示成功状态
    setTimeout(() => {
      setSaveStatus('success')
      // 2秒后恢复为idle状态
      setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
    }, 500)
  }

  // Handle close with auto-save
  const handleClose = () => {
    saveCurrentState()
    onClose()
  }

  // API 连接检测函数 - 支持多种 API 提供商
  const testConnection = async (provider: ProviderConfig) => {
    if (!provider.apiKey || !provider.apiUrl) {
      setTestStatus('error')
      setTestMessage('API Key 或 API URL 为空')
      return
    }

    setTestStatus('testing')
    setTestMessage('')

    try {
      // 根据提供商类型选择不同的检测策略
      const testResult = await testProviderConnection(provider)
      
      if (testResult.success) {
        setTestStatus('success')
        setTestMessage(t('testSuccess'))
      } else {
        setTestStatus('error')
        setTestMessage(testResult.message)
      }
    } catch (error) {
      setTestStatus('error')
      setTestMessage(error instanceof Error ? error.message : '连接失败')
    }

    // 3秒后清除状态
    setTimeout(() => {
      setTestStatus('idle')
      setTestMessage('')
    }, 3000)
  }

  // 通用 API 连接检测 - 尝试多种方式
  const testProviderConnection = async (provider: ProviderConfig): Promise<{ success: boolean; message: string }> => {
    const apiUrl = provider.apiUrl.replace(/\/$/, '') // 移除末尾斜杠
    
    // 尝试的端点列表（按优先级排序）
    const endpoints = [
      // OpenAI 兼容格式
      { url: `${apiUrl}/models`, method: 'GET' as const },
      // Anthropic 格式
      { url: `${apiUrl}/models`, method: 'GET' as const, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } },
      // 阿里 DashScope
      { url: `${apiUrl}/models`, method: 'GET' as const },
      // 通用 chat completions（使用简单请求测试）
      { url: `${apiUrl}/chat/completions`, method: 'POST' as const, body: { 
        model: provider.models[0]?.id || 'test',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      }},
    ]

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    }

    for (const endpoint of endpoints) {
      try {
        const requestHeaders = { ...headers, ...endpoint.headers }
        const options: RequestInit = {
          method: endpoint.method,
          headers: requestHeaders
        }
        
        if (endpoint.body) {
          options.body = JSON.stringify(endpoint.body)
        }

        const response = await fetch(endpoint.url, options)
        
        // 处理不同的响应状态
        if (response.ok) {
          return { success: true, message: '连接成功' }
        }
        
        // 401 表示认证问题（API Key 错误）
        if (response.status === 401) {
          return { success: false, message: 'API Key 无效或已过期' }
        }
        
        // 403 表示权限问题
        if (response.status === 403) {
          return { success: false, message: '没有访问权限' }
        }
        
        // 对于其他错误，继续尝试下一个端点
        if (response.status === 404) {
          continue // 尝试下一个端点
        }
        
        // 如果是最后一个端点，返回错误信息
        if (endpoint === endpoints[endpoints.length - 1]) {
          const errorData = await response.json().catch(() => null)
          return { 
            success: false, 
            message: errorData?.error?.message || `HTTP ${response.status}: ${response.statusText}` 
          }
        }
      } catch (error) {
        // 网络错误，继续尝试下一个端点
        if (error instanceof TypeError && error.message.includes('fetch')) {
          continue
        }
        throw error
      }
    }
    
    return { success: false, message: '无法连接到 API 服务器，请检查 URL 是否正确' }
  }

  const addProvider = (name: string, type: 'openai' | 'anthropic' | 'custom') => {
    const newProvider: ProviderConfig = {
      id: `provider-${Date.now()}`,
      name,
      type,
      apiKey: '',
      apiUrl: DEFAULT_API_URLS[type] || '',
      enabled: true,
      models: []
    }
    setLocalProviders([...localProviders, newProvider])
    setSelectedProviderId(newProvider.id)
    setShowAddProviderModal(false)
  }

  const updateProvider = (providerId: string, updates: Partial<ProviderConfig>) => {
    setLocalProviders(localProviders.map(p => 
      p.id === providerId ? { ...p, ...updates } : p
    ))
  }

  const removeProvider = (providerId: string) => {
    const newProviders = localProviders.filter(p => p.id !== providerId)
    setLocalProviders(newProviders)
    if (selectedProviderId === providerId && newProviders.length > 0) {
      setSelectedProviderId(newProviders[0].id)
    }
  }

  const toggleProviderEnabled = (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation()
    const provider = localProviders.find(p => p.id === providerId)
    if (provider) {
      updateProvider(providerId, { enabled: !provider.enabled })
    }
  }

  const startEditProvider = () => {
    if (selectedProvider) {
      setEditingProviderName(selectedProvider.name)
      setIsEditingProvider(true)
    }
  }

  const saveEditProvider = () => {
    if (selectedProvider && editingProviderName.trim()) {
      updateProvider(selectedProvider.id, { name: editingProviderName.trim() })
      setIsEditingProvider(false)
    }
  }

  const cancelEditProvider = () => {
    setIsEditingProvider(false)
    setEditingProviderName('')
  }

  const addModel = (providerId: string, modelId: string, modelName: string, group?: string, supportsVision?: boolean) => {
    const provider = localProviders.find(p => p.id === providerId)
    if (!provider) return

    const newModel: ModelConfig = {
      id: modelId,
      name: modelName,
      group,
      supportsVision
    }

    updateProvider(providerId, {
      models: [...provider.models, newModel]
    })
    setShowAddModelModal(false)
  }

  // 切换模型的视觉支持
  const toggleModelVisionSupport = (providerId: string, modelId: string) => {
    const provider = localProviders.find(p => p.id === providerId)
    if (!provider) return

    updateProvider(providerId, {
      models: provider.models.map(m =>
        m.id === modelId ? { ...m, supportsVision: !m.supportsVision } : m
      )
    })
  }

  const removeModel = (providerId: string, modelId: string) => {
    const provider = localProviders.find(p => p.id === providerId)
    if (!provider) return
    
    updateProvider(providerId, {
      models: provider.models.filter(m => m.id !== modelId)
    })
  }

  const getGroupedModels = (models: ModelConfig[]) => {
    const groups: Record<string, ModelConfig[]> = {}
    const ungrouped: ModelConfig[] = []
    
    models.forEach(model => {
      if (model.group) {
        if (!groups[model.group]) groups[model.group] = []
        groups[model.group].push(model)
      } else {
        ungrouped.push(model)
      }
    })
    
    return { groups, ungrouped }
  }

  return (
    <div className="settings-page" onClick={(e) => e.stopPropagation()}>
      <div className="settings-tabs">
        <button 
          className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          {t('general')}
        </button>
        <button 
          className={`tab-btn ${activeTab === 'providers' ? 'active' : ''}`}
          onClick={() => setActiveTab('providers')}
        >
          {t('providers')}
        </button>
        <button 
          className={`tab-btn ${activeTab === 'feishu' ? 'active' : ''}`}
          onClick={() => setActiveTab('feishu')}
        >
          飞书同步
        </button>
      </div>

      <div className="modal-body">
          {activeTab === 'feishu' ? (
            <FeishuSettings
              config={localFeishuConfig}
              onChange={setLocalFeishuConfig}
            />
          ) : activeTab === 'general' ? (
            <div className="general-settings">
              <div className="form-group">
                <label className="form-label">{t('defaultModel')}</label>
                <div className="custom-model-dropdown" ref={modelDropdownRef}>
                  <button
                    className="custom-model-dropdown-trigger"
                    onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                    type="button"
                  >
                    <div className="custom-model-dropdown-selected">
                      {selectedModelInfo ? (
                        <>
                          <span className="custom-model-dropdown-provider">{selectedModelInfo.provider.name}</span>
                          <span className="custom-model-dropdown-separator">/</span>
                          <span className="custom-model-dropdown-model">{selectedModelInfo.model.name}</span>
                        </>
                      ) : (
                        <span className="custom-model-dropdown-placeholder">选择模型</span>
                      )}
                    </div>
                    <ChevronDown size={16} className={`custom-model-dropdown-chevron ${isModelDropdownOpen ? 'open' : ''}`} />
                  </button>
                  {isModelDropdownOpen && (
                    <div className="custom-model-dropdown-menu">
                      {localProviders.filter(p => p.enabled).map(provider => (
                        <div key={provider.id} className="custom-model-dropdown-group">
                          <div className="custom-model-dropdown-group-label">{provider.name}</div>
                          {provider.models.map(m => (
                            <button
                              key={m.id}
                              className={`custom-model-dropdown-option ${m.id === localDefaultModel ? 'active' : ''}`}
                              onClick={() => {
                                setLocalDefaultModel(m.id)
                                setLocalModel(m.id)
                                setIsModelDropdownOpen(false)
                              }}
                              type="button"
                            >
                              <span className="custom-model-dropdown-option-name">{m.name}</span>
                              {m.id === localDefaultModel && (
                                <Check size={14} className="custom-model-dropdown-check" />
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span className="form-hint">{t('defaultModelHint')}</span>
              </div>

              {/* 权限模式配置项已移除 */}
            </div>
          ) : (
            <div className="providers-layout">
              <div className="providers-sidebar">
                <div className="providers-search">
                  <input 
                    type="text" 
                    placeholder={t('searchProviders')}
                    className="form-input"
                  />
                </div>
                <div className="providers-list">
                  {localProviders.map(provider => (
                    <div 
                      key={provider.id}
                      className={`provider-item ${selectedProviderId === provider.id ? 'active' : ''} ${!provider.enabled ? 'disabled' : ''}`}
                      onClick={() => setSelectedProviderId(provider.id)}
                    >
                      <div className="provider-icon">
                        {provider.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="provider-name">{provider.name}</span>
                      <span 
                        className={`provider-status ${provider.enabled ? 'on' : 'off'}`}
                        onClick={(e) => toggleProviderEnabled(e, provider.id)}
                        title={provider.enabled ? t('clickToDisable') : t('clickToEnable')}
                      >
                        {provider.enabled ? t('on') : t('off')}
                      </span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-add-provider" onClick={() => setShowAddProviderModal(true)}>
                  + {t('add')}
                </button>
              </div>

              <div className="provider-details">
                {selectedProvider ? (
                  <>
                    <div className="provider-details-header">
                      <div className="provider-title-section">
                        {isEditingProvider ? (
                          <div className="provider-title-edit">
                            <input
                              type="text"
                              className="form-input"
                              value={editingProviderName}
                              onChange={(e) => setEditingProviderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditProvider()
                                if (e.key === 'Escape') cancelEditProvider()
                              }}
                              autoFocus
                            />
                            <button className="btn btn-sm btn-primary" onClick={saveEditProvider}>{t('save')}</button>
                            <button className="btn btn-sm btn-secondary" onClick={cancelEditProvider}>{t('cancel')}</button>
                          </div>
                        ) : (
                          <>
                            <h3 className="provider-title">{selectedProvider.name}</h3>
                            <button className="btn btn-ghost btn-sm" onClick={startEditProvider}>{t('edit')}</button>
                          </>
                        )}
                      </div>
                      <div className="provider-actions">
                        <button 
                          className="btn btn-sm btn-danger" 
                          onClick={() => removeProvider(selectedProvider.id)}
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </div>

                    <div className="provider-form">
                      <div className="form-group">
                        <label className="form-label">{t('apiKey')}</label>
                        <div className="input-with-action">
                          <input
                            type="password"
                            className="form-input"
                            value={selectedProvider.apiKey}
                            onChange={(e) => updateProvider(selectedProvider.id, { apiKey: e.target.value })}
                            placeholder="sk-..."
                          />
                          <button 
                            className={`btn btn-sm btn-test ${testStatus === 'testing' ? 'testing' : ''} ${testStatus === 'success' ? 'success' : ''} ${testStatus === 'error' ? 'error' : ''}`}
                            onClick={() => testConnection(selectedProvider)}
                            disabled={testStatus === 'testing'}
                          >
                            {testStatus === 'testing' ? (
                              <>
                                <Loader2 size={14} className="spin" />
                                {t('testing')}
                              </>
                            ) : testStatus === 'success' ? (
                              <>
                                <Check size={14} />
                                {t('testSuccess')}
                              </>
                            ) : testStatus === 'error' ? (
                              <>
                                <X size={14} />
                                {t('testFailed')}
                              </>
                            ) : (
                              t('test')
                            )}
                          </button>
                          {testMessage && (
                            <span className={`test-message ${testStatus}`}>{testMessage}</span>
                          )}
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">{t('apiUrl')}</label>
                        <input
                          type="text"
                          className="form-input"
                          value={selectedProvider.apiUrl}
                          onChange={(e) => updateProvider(selectedProvider.id, { apiUrl: e.target.value })}
                          placeholder="https://api.example.com/v1"
                        />
                        <span className="form-hint">{t('apiUrlHint')}: {selectedProvider.apiUrl}/chat/completions</span>
                      </div>

                      <div className="form-group">
                        <div className="models-header">
                          <label className="form-label">{t('models')} ({selectedProvider.models.length})</label>
                          <button 
                            className="btn btn-sm btn-primary"
                            onClick={() => setShowAddModelModal(true)}
                          >
                            + {t('addModel')}
                          </button>
                        </div>
                        
                        <div className="models-list-container">
                          {(() => {
                            const { groups, ungrouped } = getGroupedModels(selectedProvider.models)
                            return (
                              <>
                                {Object.entries(groups).map(([groupName, models]) => (
                                  <div key={groupName} className="model-group">
                                    <div className="model-group-header">{groupName}</div>
                                    {models.map(model => (
                                      <div key={model.id} className="model-item">
                                        <span className="model-id">{model.id}</span>
                                        <span className="model-name">{model.name}</span>
                                        <span
                                          className={`model-vision-badge ${model.supportsVision ? 'active' : ''}`}
                                          onClick={() => toggleModelVisionSupport(selectedProvider.id, model.id)}
                                          title={model.supportsVision ? '支持视觉' : '点击启用视觉支持'}
                                          style={{
                                            marginRight: '8px',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            background: model.supportsVision ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                            color: model.supportsVision ? 'white' : 'var(--text-secondary)'
                                          }}
                                        >
                                          {model.supportsVision ? (
                                            <>
                                              <Eye size={12} style={{ marginRight: '4px' }} /> 视觉
                                            </>
                                          ) : (
                                            <EyeOff size={12} />
                                          )}
                                        </span>
                                        <button
                                          className="btn btn-icon btn-remove"
                                          onClick={() => removeModel(selectedProvider.id, model.id)}
                                          title="删除"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {ungrouped.map(model => (
                                  <div key={model.id} className="model-item">
                                    <span className="model-id">{model.id}</span>
                                    <span className="model-name">{model.name}</span>
                                    <span
                                      className={`model-vision-badge ${model.supportsVision ? 'active' : ''}`}
                                      onClick={() => toggleModelVisionSupport(selectedProvider.id, model.id)}
                                      title={model.supportsVision ? '支持视觉' : '点击启用视觉支持'}
                                      style={{
                                        marginRight: '8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background: model.supportsVision ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                                        color: model.supportsVision ? 'white' : 'var(--text-secondary)'
                                      }}
                                    >
                                      {model.supportsVision ? (
                                        <>
                                          <Eye size={12} style={{ marginRight: '4px' }} /> 视觉
                                        </>
                                      ) : (
                                        <EyeOff size={12} />
                                      )}
                                    </span>
                                    <button
                                      className="btn btn-icon btn-remove"
                                      onClick={() => removeModel(selectedProvider.id, model.id)}
                                      title="删除"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))}
                              </>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">{t('selectProvider')}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {saveStatus === 'success' && (
            <span className="save-success-message" style={{ 
              color: '#22c55e', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '14px'
            }}>
              <Check size={16} />
              保存成功
            </span>
          )}
          <button 
            className="btn btn-primary" 
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              opacity: saveStatus === 'saving' ? 0.7 : 1,
              cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer'
            }}
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 size={16} className="spinner" />
                保存中...
              </>
            ) : (
              t('save')
            )}
          </button>
        </div>

        {showAddProviderModal && (
          <AddProviderModal 
            onAdd={addProvider}
            onClose={() => setShowAddProviderModal(false)}
          />
        )}

        {showAddModelModal && selectedProvider && (
          <AddModelModal 
            onAdd={(modelId, modelName, group, supportsVision) => addModel(selectedProvider.id, modelId, modelName, group, supportsVision)}
            onClose={() => setShowAddModelModal(false)}
          />
        )}
    </div>
  )
}

interface AddProviderModalProps {
  onAdd: (name: string, type: 'openai' | 'anthropic' | 'custom') => void
  onClose: () => void
}

function AddProviderModal({ onAdd, onClose }: AddProviderModalProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'openai' | 'anthropic' | 'custom'>('openai')

  const handleSubmit = () => {
    if (name.trim()) {
      onAdd(name.trim(), type)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{t('addProviderTitle')}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('providerName')}</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('providerNamePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('providerType')}</label>
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as 'openai' | 'anthropic' | 'custom')}
            >
              {PROVIDER_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={handleSubmit}>{t('confirm')}</button>
        </div>
      </div>
    </div>
  )
}

// 飞书设置组件
function FeishuSettings({ config, onChange }: { config: FeishuConfig; onChange: (config: FeishuConfig) => void }) {
  const [localConfig, setLocalConfig] = useState<FeishuConfig>(config)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  const updateConfig = (updater: (prev: FeishuConfig) => FeishuConfig) => {
    const newConfig = updater(localConfig)
    setLocalConfig(newConfig)
    onChange(newConfig)
  }

  // 测试连接
  const testConnection = async () => {
    if (!localConfig.appId || !localConfig.appSecret) {
      setTestStatus('error')
      setTestMessage('请先填写 App ID 和 App Secret')
      return
    }

    setTestStatus('testing')
    setTestMessage('')

    try {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: localConfig.appId,
          app_secret: localConfig.appSecret
        })
      })

      const data = await response.json()

      if (data.code === 0) {
        setTestStatus('success')
        setTestMessage('连接成功！')
        // 保存访问令牌
        updateConfig(prev => ({
          ...prev,
          accessToken: data.tenant_access_token,
          tokenExpiry: Date.now() + (data.expire || 7200) * 1000
        }))
      } else {
        setTestStatus('error')
        setTestMessage(data.msg || '连接失败')
      }
    } catch (error) {
      setTestStatus('error')
      setTestMessage('网络错误')
    }
  }

  return (
    <div className="feishu-settings">
      <div className="feishu-header">
        <h3 className="feishu-title">
          {localConfig.botEnabled ? (
            <Cloud size={20} className="feishu-icon enabled" />
          ) : (
            <CloudOff size={20} className="feishu-icon disabled" />
          )}
          飞书机器人配置
        </h3>
        <div className="feishu-status">
          <span className={`status-badge ${localConfig.botEnabled ? 'enabled' : 'disabled'}`}>
            {localConfig.botEnabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      <div className="feishu-content">
        {/* 启用机器人开关 */}
        <div className="form-group feishu-enable-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div className={`toggle-switch ${localConfig.botEnabled ? 'enabled' : ''}`}>
              <input
                type="checkbox"
                checked={localConfig.botEnabled}
                onChange={(e) => updateConfig(prev => ({ ...prev, botEnabled: e.target.checked }))}
              />
              <span className="toggle-slider"></span>
            </div>
            <span>启用飞书机器人</span>
          </label>
          <span className="form-hint">
            开启后，可以在飞书群聊中 @机器人进行 AI 对话，AI 回复会自动发送到飞书
          </span>
        </div>

        {localConfig.botEnabled && (
          <>
            {/* App ID */}
            <div className="form-group">
              <label className="form-label">飞书 App ID</label>
              <input
                type="text"
                className="form-input"
                value={localConfig.appId}
                onChange={(e) => updateConfig(prev => ({ ...prev, appId: e.target.value }))}
                placeholder="cli_xxxxxxxxxxxxxxxx"
              />
              <span className="form-hint">在飞书开放平台创建应用后获取</span>
            </div>

            {/* App Secret */}
            <div className="form-group">
              <label className="form-label">飞书 App Secret</label>
              <div className="input-with-action">
                <input
                  type="password"
                  className="form-input"
                  value={localConfig.appSecret}
                  onChange={(e) => updateConfig(prev => ({ ...prev, appSecret: e.target.value }))}
                  placeholder="输入 App Secret"
                />
                <button
                  className={`btn btn-sm btn-test ${testStatus === 'testing' ? 'testing' : ''} ${testStatus === 'success' ? 'success' : ''} ${testStatus === 'error' ? 'error' : ''}`}
                  onClick={testConnection}
                  disabled={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      测试中...
                    </>
                  ) : testStatus === 'success' ? (
                    <>
                      <Check size={14} />
                      连接成功
                    </>
                  ) : testStatus === 'error' ? (
                    <>
                      <X size={14} />
                      连接失败
                    </>
                  ) : (
                    '测试连接'
                  )}
                </button>
              </div>
              {testMessage && (
                <span className={`test-message ${testStatus}`}>{testMessage}</span>
              )}
              <span className="form-hint">用于获取访问令牌，请妥善保管</span>
            </div>

            {/* 默认 Chat ID */}
            <div className="form-group">
              <label className="form-label">默认 Chat ID（可选）</label>
              <input
                type="text"
                className="form-input"
                value={localConfig.chatId || ''}
                onChange={(e) => updateConfig(prev => ({ ...prev, chatId: e.target.value || undefined }))}
                placeholder="oc_xxxxxxxxxxxxxxxx 或 ou_xxxxxxxxxxxxxxxx"
              />
              <span className="form-hint">默认发送消息的群聊 ID 或用户 ID，留空则根据消息来源回复</span>
            </div>

            {/* 使用说明 */}
            <div className="feishu-bot-instructions">
              <h5>配置步骤：</h5>
              <ol>
                <li>在飞书开放平台创建企业自建应用</li>
                <li>在应用详情页获取 App ID 和 App Secret</li>
                <li>在机器人页面开启机器人功能</li>
                <li>在事件订阅页面选择"使用长连接接收事件"</li>
                <li>添加订阅事件 "im.message.receive_v1"（接收消息）</li>
                <li>发布应用并通知管理员审核</li>
                <li>在群聊中添加机器人并 @它发送消息</li>
              </ol>
              <p className="feishu-note">
                注意：使用长连接方式不需要公网服务器和域名
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface AddModelModalProps {
  onAdd: (modelId: string, modelName: string, group?: string, supportsVision?: boolean) => void
  onClose: () => void
}

function AddModelModal({ onAdd, onClose }: AddModelModalProps) {
  const [modelIdValue, setModelIdValue] = useState('')
  const [modelNameValue, setModelNameValue] = useState('')
  const [group, setGroup] = useState('')
  const [supportsVision, setSupportsVision] = useState(false)

  const handleSubmit = () => {
    if (modelIdValue.trim() && modelNameValue.trim()) {
      onAdd(modelIdValue.trim(), modelNameValue.trim(), group.trim() || undefined, supportsVision)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{t('addModelTitle')}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('modelId')} *</label>
            <input
              type="text"
              className="form-input"
              value={modelIdValue}
              onChange={(e) => setModelIdValue(e.target.value)}
              placeholder={t('modelIdPlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('modelName')}</label>
            <input
              type="text"
              className="form-input"
              value={modelNameValue}
              onChange={(e) => setModelNameValue(e.target.value)}
              placeholder={t('modelNamePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('groupName')}</label>
            <input
              type="text"
              className="form-input"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('groupNamePlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={supportsVision}
                onChange={(e) => setSupportsVision(e.target.checked)}
              />
              <span>支持视觉/图片 (Vision)</span>
            </label>
            <span className="form-hint">启用后该模型可以处理图片输入</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={handleSubmit}>{t('addModel')}</button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
