/**
 * MemCoder 控制面板组件
 * 功能包含：学习统计、记忆管理、配置选项、反馈历史
 */

import { useState, useEffect, useCallback } from 'react'
import { Trash2, Settings, Brain, History, RefreshCw, Check, X, GitCommit, Zap } from 'lucide-react'
import type { IntentCodeMapping, MemCoderConfig, FeedbackRecord } from '../types/memcoder'
import '../styles/components/memcoder.css'

interface MemCoderPanelProps {
  projectPath?: string | null
  onClose?: () => void
}

type ViewMode = 'stats' | 'memory' | 'config' | 'feedback'

export default function MemCoderPanel({ projectPath, onClose }: MemCoderPanelProps) {
  const [activeView, setActiveView] = useState<ViewMode>('stats')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [mappings, setMappings] = useState<IntentCodeMapping[]>([])
  const [config, setConfig] = useState<MemCoderConfig | null>(null)
  const [feedbackList, setFeedbackList] = useState<FeedbackRecord[]>([])
  const [memorySummary, setMemorySummary] = useState<string>('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 初始化加载
  const loadData = useCallback(async () => {
    if (!projectPath || !(window as any).api?.memcoder) return

    setLoading(true)
    try {
      const api = (window as any).api
      
      // 加载统计
      const statsResult = await api.memcoder.getStats(projectPath)
      if (statsResult.success) setStats(statsResult.stats)

      // 加载配置
      const configResult = await api.memcoder.getConfig(projectPath)
      if (configResult.success) setConfig(configResult.config)

      // 加载记忆摘要
      const summaryResult = await api.memcoder.getMemorySummary(projectPath)
      if (summaryResult.success) setMemorySummary(summaryResult.summary || '')

      // 搜索一些映射
      const mappingsResult = await api.memcoder.searchHistory(projectPath, '', 20)
      if (mappingsResult.success) setMappings(mappingsResult.mappings || [])

      // 加载反馈列表
      const feedbackResult = await api.memcoder.getFeedback(projectPath)
      if (feedbackResult.success) setFeedbackList(feedbackResult.feedback || [])
      
    } catch (error) {
      console.error('[MemCoderPanel] Failed to load data:', error)
      showMessage('加载数据失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 显示消息
  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  // 初始化 MemCoder
  const handleInitialize = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const api = (window as any).api
      const result = await api.memcoder.initialize(projectPath)
      if (result.success) {
        showMessage('MemCoder 初始化成功', 'success')
        await loadData()
      } else {
        showMessage(result.error || '初始化失败', 'error')
      }
    } catch (error) {
      console.error('[MemCoderPanel] Failed to initialize:', error)
      showMessage('初始化失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 分析 Git 历史
  const handleAnalyzeGit = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const api = (window as any).api
      const result = await api.memcoder.analyzeGit(projectPath, 100)
      if (result.success) {
        showMessage(`成功分析了 ${result.count} 条提交记录`, 'success')
        await loadData()
      } else {
        showMessage(result.error || '分析失败', 'error')
      }
    } catch (error) {
      console.error('[MemCoderPanel] Failed to analyze git:', error)
      showMessage('分析失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 保存配置
  const handleSaveConfig = async () => {
    if (!projectPath || !config) return
    try {
      const api = (window as any).api
      const result = await api.memcoder.updateConfig(projectPath, config)
      if (result.success) {
        showMessage('配置保存成功', 'success')
      } else {
        showMessage(result.error || '保存失败', 'error')
      }
    } catch (error) {
      console.error('[MemCoderPanel] Failed to save config:', error)
      showMessage('保存失败', 'error')
    }
  }

  // 清空记忆
  const handleClearMemory = async () => {
    if (!projectPath) return
    if (!confirm('确定要清空所有项目记忆吗？此操作不可撤销。')) return

    setLoading(true)
    try {
      const api = (window as any).api
      const result = await api.memcoder.clearMemory(projectPath)
      if (result.success) {
        showMessage('记忆已清空', 'success')
        await loadData()
      } else {
        showMessage(result.error || '清空失败', 'error')
      }
    } catch (error) {
      console.error('[MemCoderPanel] Failed to clear memory:', error)
      showMessage('清空失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 切换启用状态
  const handleToggleEnabled = async (enabled: boolean) => {
    if (!projectPath) return
    try {
      const api = (window as any).api
      const result = await api.memcoder.setEnabled(projectPath, enabled)
      if (result.success) {
        setConfig(prev => prev ? { ...prev, enabled } : null)
        showMessage(enabled ? 'MemCoder 已启用' : 'MemCoder 已禁用', 'success')
      }
    } catch (error) {
      console.error('[MemCoderPanel] Failed to toggle enabled:', error)
    }
  }

  // 提供反馈
  const handleProvideFeedback = async (mappingId: string, type: 'approve' | 'reject' | 'modify', comment: string) => {
    if (!projectPath) return
    try {
      const api = (window as any).api
      await api.memcoder.provideFeedback(projectPath, mappingId, type, comment)
      showMessage('反馈已提交', 'success')
    } catch (error) {
      console.error('[MemCoderPanel] Failed to provide feedback:', error)
      showMessage('提交反馈失败', 'error')
    }
  }

  // 获取置信度的样式类
  const getConfidenceClass = (confidence: number) => {
    if (confidence >= 0.8) return 'smp-memcoder__mapping-confidence--high'
    if (confidence >= 0.6) return 'smp-memcoder__mapping-confidence--medium'
    return 'smp-memcoder__mapping-confidence--low'
  }

  // 导航按钮
  const NavButton = ({ mode, label, icon: Icon }: { mode: ViewMode; label: string; icon: any }) => (
    <button
      onClick={() => setActiveView(mode)}
      className={`smp-memcoder__nav-btn ${activeView === mode ? 'smp-memcoder__nav-btn--active' : ''}`}
    >
      <Icon />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="smp-memcoder">
      {/* 顶部标题栏 */}
      <div className="smp-memcoder__header">
        <div className="smp-memcoder__title-wrapper">
          <Brain className="smp-memcoder__icon" size={18} />
          <h2 className="smp-memcoder__title">MemCoder</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="smp-memcoder__close-btn">
            <X size={18} />
          </button>
        )}
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`smp-memcoder__message smp-memcoder__message--${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 导航标签 */}
      <div className="smp-memcoder__nav">
        <NavButton mode="stats" label="统计" icon={Zap} />
        <NavButton mode="memory" label="记忆" icon={Brain} />
        <NavButton mode="config" label="配置" icon={Settings} />
        <NavButton mode="feedback" label="反馈" icon={History} />
      </div>

      {/* 内容区域 */}
      <div className="smp-memcoder__content">
        {loading && !projectPath ? (
          <div className="smp-memcoder__content-empty">请先打开一个项目文件夹</div>
        ) : loading ? (
          <div className="smp-memcoder__content-empty">加载中...</div>
        ) : (
          <>
            {/* 统计视图 */}
            {activeView === 'stats' && (
              <div>
                <div className="smp-memcoder__stats-grid">
                  <div className="smp-memcoder__stat-card">
                    <div className="smp-memcoder__stat-icon">
                      <Brain size={24} style={{ color: '#007acc' }} />
                    </div>
                    <div className="smp-memcoder__stat-value">{stats?.mappingsCount || 0}</div>
                    <div className="smp-memcoder__stat-label">学习映射</div>
                  </div>
                  <div className="smp-memcoder__stat-card">
                    <div className="smp-memcoder__stat-icon">
                      <GitCommit size={24} style={{ color: '#9575cd' }} />
                    </div>
                    <div className="smp-memcoder__stat-value">{stats?.patternsCount || 0}</div>
                    <div className="smp-memcoder__stat-label">项目模式</div>
                  </div>
                  <div className="smp-memcoder__stat-card">
                    <div className="smp-memcoder__stat-icon">
                      <Check size={24} style={{ color: '#89d185' }} />
                    </div>
                    <div className="smp-memcoder__stat-value">{stats?.feedbackCount || 0}</div>
                    <div className="smp-memcoder__stat-label">反馈记录</div>
                  </div>
                  <div className="smp-memcoder__stat-card">
                    <div className="smp-memcoder__stat-icon">
                      <History size={24} style={{ color: '#cca700' }} />
                    </div>
                    <div className="smp-memcoder__stat-value">
                      {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleDateString() : '-'}
                    </div>
                    <div className="smp-memcoder__stat-label">最后更新</div>
                  </div>
                </div>

                {/* 记忆摘要 */}
                {memorySummary && (
                  <div className="smp-memcoder__summary">
                    <h3 className="smp-memcoder__summary-title">项目记忆摘要</h3>
                    <pre className="smp-memcoder__summary-content">{memorySummary}</pre>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="smp-memcoder__actions">
                  {!stats && (
                    <button onClick={handleInitialize} className="smp-memcoder__btn smp-memcoder__btn--primary">
                      <Zap size={16} />
                      初始化 MemCoder
                    </button>
                  )}
                  <button onClick={handleAnalyzeGit} className="smp-memcoder__btn smp-memcoder__btn--secondary">
                    <GitCommit size={16} />
                    分析 Git 历史
                  </button>
                  <button onClick={loadData} className="smp-memcoder__btn smp-memcoder__btn--secondary">
                    <RefreshCw size={16} />
                    刷新
                  </button>
                </div>
              </div>
            )}

            {/* 记忆视图 */}
            {activeView === 'memory' && (
              <div>
                <div className="smp-memcoder__memory-header">
                  <h3 className="smp-memcoder__memory-title">意图-代码映射 ({mappings.length})</h3>
                  <button onClick={handleClearMemory} className="smp-memcoder__btn smp-memcoder__btn--danger">
                    <Trash2 size={16} />
                    清空记忆
                  </button>
                </div>

                {mappings.length > 0 ? (
                  <div className="smp-memcoder__mapping-list">
                    {mappings.map(mapping => (
                      <div key={mapping.id} className="smp-memcoder__mapping-card">
                        <div className="smp-memcoder__mapping-header">
                          <div className="smp-memcoder__mapping-intent">{mapping.intent}</div>
                          <div className="smp-memcoder__mapping-meta">
                            <span className={`smp-memcoder__mapping-confidence ${getConfidenceClass(mapping.confidence)}`}>
                              {Math.round(mapping.confidence * 100)}%
                            </span>
                            <span className="smp-memcoder__mapping-usage">{mapping.usageCount} 次使用</span>
                          </div>
                        </div>

                        <div className="smp-memcoder__mapping-files">
                          变更文件: {mapping.codeChanges.map((c: any) => c.filePath).join(', ')}
                          {mapping.commitHash && <span>提交: {mapping.commitHash}</span>}
                        </div>

                        <div className="smp-memcoder__mapping-actions">
                          <button
                            onClick={() => handleProvideFeedback(mapping.id, 'approve', '这个映射很有帮助')}
                            className="smp-memcoder__btn smp-memcoder__btn--primary"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            👍 有帮助
                          </button>
                          <button
                            onClick={() => handleProvideFeedback(mapping.id, 'reject', '这个映射不准确')}
                            className="smp-memcoder__btn smp-memcoder__btn--danger"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            👎 不准确
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="smp-memcoder__empty">
                    <Brain className="smp-memcoder__empty-icon" size={48} />
                    <p className="smp-memcoder__empty-text">还没有学习到任何映射</p>
                    <p className="smp-memcoder__empty-hint">尝试分析 Git 历史或者开始和 AI 对话</p>
                  </div>
                )}
              </div>
            )}

            {/* 配置视图 */}
            {activeView === 'config' && config && (
              <div>
                <div className="smp-memcoder__config-section">
                  <div className="smp-memcoder__config-toggle-row">
                    <div>
                      <h3 className="smp-memcoder__config-label">启用 MemCoder</h3>
                      <p className="smp-memcoder__config-field-desc">控制是否使用项目记忆增强 AI</p>
                    </div>
                    <div
                      className={`smp-memcoder__config-switch ${config.enabled ? 'smp-memcoder__config-switch--active' : ''}`}
                      onClick={() => handleToggleEnabled(!config.enabled)}
                    >
                      <div className="smp-memcoder__config-switch-knob" />
                    </div>
                  </div>
                </div>

                <div className="smp-memcoder__config-section">
                  <h3 className="smp-memcoder__config-title">配置选项</h3>
                  <div className="smp-memcoder__config-form">
                    <div className="smp-memcoder__config-field">
                      <label className="smp-memcoder__config-field-label">最大映射数量</label>
                      <p className="smp-memcoder__config-field-desc">保留的最多意图-代码映射记录</p>
                      <input
                        type="number"
                        value={config.maxMappings}
                        min="1"
                        max="5000"
                        onChange={(e) => setConfig({ ...config, maxMappings: Number(e.target.value) })}
                        className="smp-memcoder__config-input"
                      />
                    </div>

                    <div className="smp-memcoder__config-field">
                      <label className="smp-memcoder__config-field-label">最低置信度</label>
                      <p className="smp-memcoder__config-field-desc">低于此分数的映射不会被使用 (0-1)</p>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={config.minConfidence}
                        onChange={(e) => setConfig({ ...config, minConfidence: Number(e.target.value) })}
                        className="smp-memcoder__config-input"
                      />
                    </div>

                    <div className="smp-memcoder__config-field">
                      <label className="smp-memcoder__config-field-label">分析的最大提交数</label>
                      <p className="smp-memcoder__config-field-desc">初始化时分析的 Git 历史提交数量</p>
                      <input
                        type="number"
                        value={config.maxCommitHistory}
                        min="1"
                        max="1000"
                        onChange={(e) => setConfig({ ...config, maxCommitHistory: Number(e.target.value) })}
                        className="smp-memcoder__config-input"
                      />
                    </div>

                    <div className="smp-memcoder__config-toggle-row">
                      <div>
                        <label className="smp-memcoder__config-field-label">自动分析 Git 历史</label>
                        <p className="smp-memcoder__config-field-desc">项目打开时自动分析最近的提交</p>
                      </div>
                      <div
                        className={`smp-memcoder__config-switch ${config.autoAnalyze ? 'smp-memcoder__config-switch--active' : ''}`}
                        onClick={() => setConfig({ ...config, autoAnalyze: !config.autoAnalyze })}
                      >
                        <div className="smp-memcoder__config-switch-knob" />
                      </div>
                    </div>

                    <div className="smp-memcoder__config-toggle-row">
                      <div>
                        <label className="smp-memcoder__config-field-label">启动时分析</label>
                        <p className="smp-memcoder__config-field-desc">每次打开项目时运行分析</p>
                      </div>
                      <div
                        className={`smp-memcoder__config-switch ${config.analyzeOnStartup ? 'smp-memcoder__config-switch--active' : ''}`}
                        onClick={() => setConfig({ ...config, analyzeOnStartup: !config.analyzeOnStartup })}
                      >
                        <div className="smp-memcoder__config-switch-knob" />
                      </div>
                    </div>
                  </div>
                </div>

                <button onClick={handleSaveConfig} className="smp-memcoder__btn smp-memcoder__btn--primary smp-memcoder__config-save">
                  保存配置
                </button>
              </div>
            )}

            {/* 反馈历史视图 */}
            {activeView === 'feedback' && (
              <div>
                <h3 className="smp-memcoder__feedback-title">反馈历史</h3>

                {feedbackList.length > 0 ? (
                  <div className="smp-memcoder__feedback-list">
                    {feedbackList.map(feedback => (
                      <div key={feedback.id} className="smp-memcoder__feedback-card">
                        <div className="smp-memcoder__feedback-header">
                          <span className={`smp-memcoder__feedback-type smp-memcoder__feedback-type--${feedback.type}`}>
                            {feedback.type === 'approve' ? '👍 有帮助' :
                             feedback.type === 'reject' ? '👎 不准确' : '✏️ 修改'}
                          </span>
                          <span className="smp-memcoder__feedback-date">
                            {new Date(feedback.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {feedback.feedback && (
                          <p className="smp-memcoder__feedback-content">{feedback.feedback}</p>
                        )}
                        {feedback.correctedCode && (
                          <pre className="smp-memcoder__feedback-code">{feedback.correctedCode}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="smp-memcoder__empty">
                    <History className="smp-memcoder__empty-icon" size={48} />
                    <p className="smp-memcoder__empty-text">还没有反馈记录</p>
                    <p className="smp-memcoder__empty-hint">在对话中提供反馈后会显示在这里</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
