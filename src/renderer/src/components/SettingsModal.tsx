import { useState, useEffect } from 'react'
import type { ProviderConfig, ModelConfig } from '../store'
import { t } from '../i18n'

interface SettingsModalProps {
  apiKey: string
  model: string
  defaultModel: string
  permissionMode: string
  providers: ProviderConfig[]
  onSave: (apiKey: string, model: string, defaultModel: string, permissionMode: string, providers: ProviderConfig[]) => void
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

function SettingsModal({ apiKey, model, defaultModel, permissionMode, providers, onSave, onClose }: SettingsModalProps) {
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localModel, setLocalModel] = useState(model)
  const [localDefaultModel, setLocalDefaultModel] = useState(defaultModel)
  const [localPermissionMode, setLocalPermissionMode] = useState(permissionMode)
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>(providers)
  const [activeTab, setActiveTab] = useState<'general' | 'providers'>('providers')
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id || '')
  const [showAddProviderModal, setShowAddProviderModal] = useState(false)
  const [showAddModelModal, setShowAddModelModal] = useState(false)
  const [isEditingProvider, setIsEditingProvider] = useState(false)
  const [editingProviderName, setEditingProviderName] = useState('')

  const selectedProvider = localProviders.find(p => p.id === selectedProviderId) || localProviders[0] || null

  // Save function that creates a deep copy to ensure data integrity
  const saveCurrentState = () => {
    // Create deep copy of providers to ensure we're passing the latest data
    const providersCopy = JSON.parse(JSON.stringify(localProviders))
    onSave(localApiKey, localModel, localDefaultModel, localPermissionMode, providersCopy)
  }

  const handleSave = () => {
    saveCurrentState()
  }

  // Handle close with auto-save
  const handleClose = () => {
    saveCurrentState()
    onClose()
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

  const addModel = (providerId: string, modelId: string, modelName: string, group?: string) => {
    const provider = localProviders.find(p => p.id === providerId)
    if (!provider) return

    const newModel: ModelConfig = {
      id: modelId,
      name: modelName,
      group
    }
    
    updateProvider(providerId, { 
      models: [...provider.models, newModel]
    })
    setShowAddModelModal(false)
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
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal settings-modal provider-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('settingsTitle')}</h2>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>
        
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
        </div>

        <div className="modal-body">
          {activeTab === 'general' ? (
            <div className="general-settings">
              <div className="form-group">
                <label className="form-label">{t('defaultModel')}</label>
                <select
                  className="form-select"
                  value={localDefaultModel}
                  onChange={(e) => {
                    setLocalDefaultModel(e.target.value)
                    setLocalModel(e.target.value)
                  }}
                >
                  {localProviders.filter(p => p.enabled).map(provider => (
                    <optgroup key={provider.id} label={provider.name}>
                      {provider.models.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="form-hint">{t('defaultModelHint')}</span>
              </div>

              <div className="form-group">
                <label className="form-label">{t('permissionMode')}</label>
                <select
                  className="form-select"
                  value={localPermissionMode}
                  onChange={(e) => setLocalPermissionMode(e.target.value)}
                >
                  <option value="read-only">{t('readOnly')}</option>
                  <option value="workspace-write">{t('workspaceWrite')}</option>
                  <option value="danger-full-access">{t('fullAccess')}</option>
                </select>
              </div>
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
                          <button className="btn btn-sm">{t('test')}</button>
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
                                        <button 
                                          className="btn btn-icon btn-remove"
                                          onClick={() => removeModel(selectedProvider.id, model.id)}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                                {ungrouped.map(model => (
                                  <div key={model.id} className="model-item">
                                    <span className="model-id">{model.id}</span>
                                    <span className="model-name">{model.name}</span>
                                    <button 
                                      className="btn btn-icon btn-remove"
                                      onClick={() => removeModel(selectedProvider.id, model.id)}
                                    >
                                      ×
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
          <button className="btn btn-secondary" onClick={handleClose}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave}>{t('save')}</button>
        </div>

        {showAddProviderModal && (
          <AddProviderModal 
            onAdd={addProvider}
            onClose={() => setShowAddProviderModal(false)}
          />
        )}

        {showAddModelModal && selectedProvider && (
          <AddModelModal 
            onAdd={(modelId, modelName, group) => addModel(selectedProvider.id, modelId, modelName, group)}
            onClose={() => setShowAddModelModal(false)}
          />
        )}
      </div>
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
          <button className="modal-close" onClick={onClose}>×</button>
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

interface AddModelModalProps {
  onAdd: (modelId: string, modelName: string, group?: string) => void
  onClose: () => void
}

function AddModelModal({ onAdd, onClose }: AddModelModalProps) {
  const [modelIdValue, setModelIdValue] = useState('')
  const [modelNameValue, setModelNameValue] = useState('')
  const [group, setGroup] = useState('')

  const handleSubmit = () => {
    if (modelIdValue.trim() && modelNameValue.trim()) {
      onAdd(modelIdValue.trim(), modelNameValue.trim(), group.trim() || undefined)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{t('addModelTitle')}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
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
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={handleSubmit}>{t('addModel')}</button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
