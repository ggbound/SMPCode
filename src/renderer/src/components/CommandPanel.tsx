import { useState } from 'react'
import { Command, Tool } from '../store'
import { t } from '../i18n'

interface CommandPanelProps {
  commands: Command[]
  tools: Tool[]
  onClose: () => void
}

type TabType = 'commands' | 'tools'

function CommandPanel({ commands, tools, onClose }: CommandPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('commands')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (cmd.responsibility && cmd.responsibility.toLowerCase().includes(searchQuery.toLowerCase()))
  ).slice(0, 50)

  const filteredTools = tools.filter(tool =>
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (tool.responsibility && tool.responsibility.toLowerCase().includes(searchQuery.toLowerCase()))
  ).slice(0, 50)

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'commands' ? 'active' : ''}`}
            onClick={() => setActiveTab('commands')}
          >
            {t('commandsTab')} ({commands.length})
          </button>
          <button
            className={`tab ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            {t('toolsTab')} ({tools.length})
          </button>
        </div>
        <button className="btn-close" onClick={onClose}>×</button>
      </div>

      <div className="search-box">
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="command-list">
        {activeTab === 'commands' ? (
          filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => (
              <div key={idx} className="command-item">
                <div className="command-name">/{cmd.name}</div>
                {cmd.responsibility && (
                  <div className="command-desc">{cmd.responsibility.replace('Command module mirrored from archived TypeScript path ', '').replace('commands/', '')}</div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">{t('noCommands')}</div>
          )
        ) : (
          filteredTools.length > 0 ? (
            filteredTools.map((tool, idx) => (
              <div key={idx} className="tool-item">
                <div className="tool-name">{tool.name}</div>
                {tool.responsibility && (
                  <div className="tool-desc">{tool.responsibility.replace('Tool module mirrored from archived TypeScript path ', '').replace('tools/', '')}</div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">{t('noTools')}</div>
          )
        )}
      </div>
    </div>
  )
}

export default CommandPanel