/**
 * 模型选择器组件
 * 参考 ChatArea.tsx 中的模型选择器实现
 */

import { useState, useRef, useEffect, memo } from 'react'
import { Cpu, ChevronDown } from 'lucide-react'

interface Model {
  id: string
  name: string
}

interface Provider {
  id: string
  name: string
  enabled: boolean
  models: Model[]
}

interface ModelSelectorProps {
  providers: Provider[]
  currentModel: string
  onModelChange: (modelId: string) => void
}

export const ModelSelector = memo(function ModelSelector({
  providers,
  currentModel,
  onModelChange
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 获取当前选中的模型信息
  const getCurrentModelInfo = () => {
    for (const provider of providers) {
      if (!provider.enabled) continue
      const model = provider.models.find(m => m.id === currentModel)
      if (model) {
        return { provider, model }
      }
    }
    return null
  }

  const currentInfo = getCurrentModelInfo()

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // 如果没有启用的 provider，不显示
  const enabledProviders = providers.filter(p => p.enabled)
  if (enabledProviders.length === 0) {
    return null
  }

  return (
    <div className="kilo-model-selector" ref={containerRef}>
      <button
        className="kilo-model-button"
        onClick={() => setIsOpen(!isOpen)}
        title={currentInfo?.model.name || currentModel || '选择模型'}
      >
        <Cpu size={14} className="kilo-model-icon" />
        <span className="kilo-model-name">
          {currentInfo?.model.name || currentModel || '选择模型'}
        </span>
        <ChevronDown
          size={12}
          className={`kilo-model-chevron ${isOpen ? 'open' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className="kilo-model-overlay" onClick={() => setIsOpen(false)} />
          <div className="kilo-model-dropdown">
            <div className="kilo-model-header">选择模型</div>
            <div className="kilo-model-list">
              {enabledProviders.map(provider => (
                <div key={provider.id} className="kilo-model-provider">
                  <div className="kilo-model-provider-name">{provider.name}</div>
                  {provider.models.map(model => (
                    <button
                      key={model.id}
                      className={`kilo-model-option ${model.id === currentModel ? 'active' : ''}`}
                      onClick={() => {
                        onModelChange(model.id)
                        setIsOpen(false)
                      }}
                    >
                      <span className="kilo-model-option-name">{model.name}</span>
                      {model.id === currentModel && (
                        <div className="kilo-model-active-indicator" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
})
