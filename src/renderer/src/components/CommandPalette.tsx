import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { t } from '../i18n'

export interface Command {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  execute: () => void | Promise<void>
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  commands: Command[]
}

function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter commands based on search
  const filteredCommands = commands.filter(cmd => {
    const query = searchQuery.toLowerCase()
    return (
      cmd.label.toLowerCase().includes(query) ||
      cmd.description?.toLowerCase().includes(query) ||
      cmd.category?.toLowerCase().includes(query)
    )
  })

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      setSearchQuery('')
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].execute()
          onClose()
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [filteredCommands, selectedIndex, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!isOpen) return null

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="command-palette-input-wrapper">
          <span className="command-palette-icon"><Search size={16} /></span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Commands list */}
        <div className="command-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-no-results">
              No matching commands
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <div
                key={cmd.id}
                className={`command-palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  cmd.execute()
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="command-palette-item-content">
                  <span className="command-palette-item-label">{cmd.label}</span>
                  {cmd.description && (
                    <span className="command-palette-item-desc">{cmd.description}</span>
                  )}
                </div>
                {cmd.shortcut && (
                  <span className="command-palette-item-shortcut">{cmd.shortcut}</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span>↑↓ Navigate</span>
          <span>Enter Execute</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
