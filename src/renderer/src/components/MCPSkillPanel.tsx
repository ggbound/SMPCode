/**
 * MCP & Skill 配置面板组件 - VSCode 风格
 * 管理 MCP Server 和 Skill 的配置
 */
import React, { useState, useEffect } from 'react';
import { MCPServerConfig, MCPServerStatus, SkillConfig, MCPTransportType, SkillType } from '../../types/mcp-skill';
import './mcp-skill-panel.css';
import { Plus, RefreshCw, Play, Square, Edit3, Trash2, Zap, Shield, Bug, Code, Puzzle } from 'lucide-react';

// IPC 调用
const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]): Promise<any> => {
    console.log(`[IPC] ${channel}`, args);
    return { success: true };
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    console.log(`[IPC] Listening to ${channel}`);
  },
  removeAllListeners: (channel: string) => {
    console.log(`[IPC] Remove listeners from ${channel}`);
  },
};

const IPC_CHANNELS = {
  MCP_GET_SERVERS: 'mcp:get-servers',
  MCP_ADD_SERVER: 'mcp:add-server',
  MCP_UPDATE_SERVER: 'mcp:update-server',
  MCP_REMOVE_SERVER: 'mcp:remove-server',
  MCP_CONNECT_SERVER: 'mcp:connect-server',
  MCP_DISCONNECT_SERVER: 'mcp:disconnect-server',
  SKILL_GET_ALL: 'skill:get-all',
  SKILL_ADD: 'skill:add',
  SKILL_UPDATE: 'skill:update',
  SKILL_REMOVE: 'skill:remove',
  SKILL_EXECUTE: 'skill:execute',
  SKILL_SET_ENABLED: 'skill:set-enabled',
};

const SKILL_ICONS: Record<SkillType, React.ReactNode> = {
  'code-review': <Code size={14} />,
  'security': <Shield size={14} />,
  'debug': <Bug size={14} />,
  'mini-app': <Puzzle size={14} />,
  'custom': <Zap size={14} />,
};

const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  'code-review': '代码审查',
  'security': '安全审查',
  'debug': '调试',
  'mini-app': '小程序',
  'custom': '自定义',
};

export const MCPSkillPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'mcp' | 'skill'>('mcp');
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [serverStatuses, setServerStatuses] = useState<Record<string, MCPServerStatus>>({});
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const serversResult = await ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_SERVERS);
      if (serversResult.success) {
        setServers(serversResult.servers || []);
      }
      const skillsResult = await ipcRenderer.invoke(IPC_CHANNELS.SKILL_GET_ALL);
      if (skillsResult.success) {
        setSkills(skillsResult.skills || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'connected': return 'connected';
      case 'connecting': return 'connecting';
      case 'error': return 'error';
      default: return 'disconnected';
    }
  };

  const handleToggleServer = async (server: MCPServerConfig) => {
    const status = serverStatuses[server.id];
    if (status?.status === 'connected') {
      await ipcRenderer.invoke(IPC_CHANNELS.MCP_DISCONNECT_SERVER, server.id);
    } else {
      await ipcRenderer.invoke(IPC_CHANNELS.MCP_CONNECT_SERVER, server.id);
    }
  };

  const handleToggleSkill = async (skill: SkillConfig) => {
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.SKILL_SET_ENABLED, skill.id, !skill.enabled);
      setSkills(prev => prev.map(s => 
        s.id === skill.id ? { ...s, enabled: !s.enabled } : s
      ));
    } catch (error) {
      console.error('Failed to toggle skill:', error);
    }
  };

  return (
    <div className="mcp-skill-panel-container">
      <div className="mcp-skill-panel">
        {/* Header */}
        <div className="mcp-skill-panel-header">
          <h2>MCP & Skill</h2>
          <div className="mcp-skill-panel-header-actions">
            <button
              className="mcp-skill-panel-header-btn"
              onClick={activeTab === 'mcp' ? () => setShowAddServerModal(true) : () => setShowAddSkillModal(true)}
              title={activeTab === 'mcp' ? '添加 MCP Server' : '添加 Skill'}
            >
              <Plus size={16} />
            </button>
            {activeTab === 'mcp' && (
              <button
                className="mcp-skill-panel-header-btn"
                onClick={loadData}
                title="刷新"
              >
                <RefreshCw size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mcp-skill-panel-tabs">
          <div className="mcp-skill-panel-tabs-row">
            <button
              className={activeTab === 'mcp' ? 'active' : ''}
              onClick={() => setActiveTab('mcp')}
            >
              MCP
            </button>
            <button
              className={activeTab === 'skill' ? 'active' : ''}
              onClick={() => setActiveTab('skill')}
            >
              Skills
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="mcp-skill-panel-content">
          {isLoading ? (
            <div className="mcp-skill-loading">加载中...</div>
          ) : activeTab === 'mcp' ? (
            <MCPPanel
              servers={servers}
              serverStatuses={serverStatuses}
              selectedServerId={selectedServerId}
              onSelectServer={setSelectedServerId}
              onToggleServer={handleToggleServer}
            />
          ) : (
            <SkillPanel
              skills={skills}
              onToggleSkill={handleToggleSkill}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddServerModal && (
        <AddServerModal
          onClose={() => setShowAddServerModal(false)}
          onSubmit={async (config) => {
            await ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD_SERVER, config);
            loadData();
            setShowAddServerModal(false);
          }}
        />
      )}
      {showAddSkillModal && (
        <AddSkillModal
          onClose={() => setShowAddSkillModal(false)}
          onSubmit={async (config) => {
            await ipcRenderer.invoke(IPC_CHANNELS.SKILL_ADD, config);
            loadData();
            setShowAddSkillModal(false);
          }}
        />
      )}
    </div>
  );
};

// MCP Panel
interface MCPPanelProps {
  servers: MCPServerConfig[];
  serverStatuses: Record<string, MCPServerStatus>;
  selectedServerId: string | null;
  onSelectServer: (id: string | null) => void;
  onToggleServer: (server: MCPServerConfig) => void;
}

const MCPPanel: React.FC<MCPPanelProps> = ({
  servers,
  serverStatuses,
  selectedServerId,
  onSelectServer,
  onToggleServer,
}) => {
  const getStatusClass = (status?: string) => {
    switch (status) {
      case 'connected': return 'connected';
      case 'connecting': return 'connecting';
      case 'error': return 'error';
      default: return 'disconnected';
    }
  };

  return (
    <div className="mcp-skill-list">
      {/* Server List */}
      {servers.length === 0 ? (
        <div className="mcp-skill-empty">
          <div className="mcp-skill-empty-icon">🔌</div>
          <p className="mcp-skill-empty-text">暂无 MCP Server</p>
          <p className="mcp-skill-empty-hint">点击上方 + 按钮添加</p>
        </div>
      ) : (
        servers.map(server => {
          const status = serverStatuses[server.id];
          const isSelected = selectedServerId === server.id;
          return (
            <div
              key={server.id}
              className={`mcp-skill-item ${isSelected ? 'selected' : ''} ${!server.enabled ? 'disabled' : ''}`}
              onClick={() => onSelectServer(isSelected ? null : server.id)}
            >
              <div className={`mcp-skill-status ${getStatusClass(status?.status)}`} />
              <div className="mcp-skill-content">
                <div className="mcp-skill-header">
                  <span className="mcp-skill-name">{server.name}</span>
                  <span className={`mcp-skill-badge type-${server.transport}`}>{server.transport}</span>
                </div>
                <div className="mcp-skill-description">{server.description || '无描述'}</div>
                {status?.tools && status.tools.length > 0 && (
                  <div className="mcp-skill-tools-count">{status.tools.length} 个工具可用</div>
                )}
              </div>
              <div className="mcp-skill-actions">
                <button
                  className={`mcp-skill-action-btn toggle ${status?.status === 'connected' ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleServer(server);
                  }}
                  title={status?.status === 'connected' ? '断开' : '连接'}
                >
                  {status?.status === 'connected' ? <Square size={12} /> : <Play size={12} />}
                </button>
                <button className="mcp-skill-action-btn" title="编辑">
                  <Edit3 size={12} />
                </button>
                <button className="mcp-skill-action-btn delete" title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

// Skill Panel
interface SkillPanelProps {
  skills: SkillConfig[];
  onToggleSkill: (skill: SkillConfig) => void;
}

const SkillPanel: React.FC<SkillPanelProps> = ({ skills, onToggleSkill }) => {
  return (
    <div className="mcp-skill-list">
      {/* Skill List */}
      {skills.length === 0 ? (
        <div className="mcp-skill-empty">
          <div className="mcp-skill-empty-icon">⚡</div>
          <p className="mcp-skill-empty-text">暂无 Skill</p>
          <p className="mcp-skill-empty-hint">点击上方 + 按钮添加</p>
        </div>
      ) : (
        skills.map(skill => (
          <div
            key={skill.id}
            className={`mcp-skill-item ${!skill.enabled ? 'disabled' : ''}`}
          >
            <div className="mcp-skill-content">
              <div className="mcp-skill-header">
                <span className="mcp-skill-name">{skill.name}</span>
                <span className={`mcp-skill-badge type-${skill.type}`}>
                  {SKILL_TYPE_LABELS[skill.type]}
                </span>
              </div>
              <div className="mcp-skill-description">{skill.description}</div>
              <div className="mcp-skill-meta">v{skill.version}</div>
            </div>
            <div className="mcp-skill-actions">
              <label className="mcp-skill-toggle">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSkill(skill);
                  }}
                />
                <span className="mcp-skill-toggle-slider" />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// Add Server Modal
interface AddServerModalProps {
  onClose: () => void;
  onSubmit: (config: any) => void;
}

const AddServerModal: React.FC<AddServerModalProps> = ({ onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<MCPTransportType>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const config: any = {
      name,
      description,
      transport,
      enabled: true,
    };
    if (transport === 'stdio') {
      config.command = command;
      config.args = args.split(' ').filter(Boolean);
    } else {
      config.url = url;
    }
    onSubmit(config);
  };

  return (
    <div className="mcp-skill-modal-overlay" onClick={onClose}>
      <div className="mcp-skill-modal" onClick={e => e.stopPropagation()}>
        <div className="mcp-skill-modal-header">
          <h3>添加 MCP Server</h3>
          <button className="mcp-skill-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mcp-skill-modal-body">
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">名称 *</label>
              <input
                className="mcp-skill-form-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例如：文件系统服务器"
                required
              />
            </div>
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">描述</label>
              <input
                className="mcp-skill-form-input"
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="服务器功能描述"
              />
            </div>
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">传输方式 *</label>
              <select
                className="mcp-skill-form-select"
                value={transport}
                onChange={e => setTransport(e.target.value as MCPTransportType)}
              >
                <option value="stdio">stdio（本地命令）</option>
                <option value="http">HTTP</option>
                <option value="sse">SSE</option>
              </select>
            </div>
            {transport === 'stdio' ? (
              <>
                <div className="mcp-skill-form-group">
                  <label className="mcp-skill-form-label">命令 *</label>
                  <input
                    className="mcp-skill-form-input"
                    type="text"
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    placeholder="例如：npx"
                    required
                  />
                </div>
                <div className="mcp-skill-form-group">
                  <label className="mcp-skill-form-label">参数</label>
                  <input
                    className="mcp-skill-form-input"
                    type="text"
                    value={args}
                    onChange={e => setArgs(e.target.value)}
                    placeholder="例如：-y @modelcontextprotocol/server-filesystem"
                  />
                </div>
              </>
            ) : (
              <div className="mcp-skill-form-group">
                <label className="mcp-skill-form-label">URL *</label>
                <input
                  className="mcp-skill-form-input"
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="例如：http://localhost:3000/mcp"
                  required
                />
              </div>
            )}
          </div>
          <div className="mcp-skill-modal-footer">
            <button type="button" className="mcp-skill-btn mcp-skill-btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="mcp-skill-btn mcp-skill-btn-primary">
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Add Skill Modal
interface AddSkillModalProps {
  onClose: () => void;
  onSubmit: (config: any) => void;
}

const AddSkillModal: React.FC<AddSkillModalProps> = ({ onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SkillType>('custom');
  const [entry, setEntry] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      type,
      entry,
      version: '1.0.0',
      enabled: true,
    });
  };

  return (
    <div className="mcp-skill-modal-overlay" onClick={onClose}>
      <div className="mcp-skill-modal" onClick={e => e.stopPropagation()}>
        <div className="mcp-skill-modal-header">
          <h3>添加 Skill</h3>
          <button className="mcp-skill-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mcp-skill-modal-body">
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">名称 *</label>
              <input
                className="mcp-skill-form-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Skill 名称"
                required
              />
            </div>
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">描述 *</label>
              <input
                className="mcp-skill-form-input"
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Skill 功能描述"
                required
              />
            </div>
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">类型 *</label>
              <select
                className="mcp-skill-form-select"
                value={type}
                onChange={e => setType(e.target.value as SkillType)}
              >
                <option value="code-review">代码审查</option>
                <option value="security">安全审查</option>
                <option value="debug">调试</option>
                <option value="mini-app">小程序</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="mcp-skill-form-group">
              <label className="mcp-skill-form-label">入口文件 *</label>
              <input
                className="mcp-skill-form-input"
                type="text"
                value={entry}
                onChange={e => setEntry(e.target.value)}
                placeholder="例如：./skills/my-skill.ts"
                required
              />
            </div>
          </div>
          <div className="mcp-skill-modal-footer">
            <button type="button" className="mcp-skill-btn mcp-skill-btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="mcp-skill-btn mcp-skill-btn-primary">
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MCPSkillPanel;
