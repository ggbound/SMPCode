/**
 * MentionInput - @ 符号引用输入组件
 * 在聊天输入框中支持 @ 符号引用文件和符号
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'

interface MentionItem {
  id: string
  type: 'file' | 'symbol' | 'directory'
  name: string
  path: string
  description?: string
}

interface MentionInputProps {
  projectPath: string
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
}

export const MentionInput: React.FC<MentionInputProps> = ({
  projectPath,
  value,
  onChange,
  onSubmit,
  placeholder = '输入消息，使用 @ 引用文件或符号...'
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<MentionItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mentionQuery, setMentionQuery] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 搜索建议
  const searchSuggestions = useCallback(async (query: string) => {
    if (!window.api?.mention) {
      setSuggestions([])
      return
    }
    try {
      const result = await window.api.mention.suggestions(projectPath, query)
      if (result.success && result.items) {
        setSuggestions(result.items.slice(0, 10))
        setSelectedIndex(0)
      } else {
        setSuggestions([])
      }
    } catch (error) {
      console.error('Failed to search mentions:', error)
      setSuggestions([])
    }
  }, [projectPath])

  // 检测 @ 符号
  const detectMention = useCallback((currentValue?: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = (currentValue || value).slice(0, cursorPos)
    
    // 查找 @ 符号 - 匹配 @ 后面跟着非空白字符或为空
    const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/)
    if (mentionMatch) {
      const query = mentionMatch[1] || ''
      setMentionQuery(query)
      setCursorPosition(cursorPos)
      setShowSuggestions(true)
      setSelectedIndex(0)
      searchSuggestions(query)
    } else {
      setShowSuggestions(false)
    }
  }, [value, searchSuggestions])

  // 插入 @ 引用
  const insertMention = (item: MentionItem) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const textBeforeCursor = value.slice(0, cursorPosition)
    const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/)
    
    if (!mentionMatch) return
    
    const atPosition = mentionMatch.index
    const beforeAt = value.slice(0, atPosition)
    const afterMention = value.slice(cursorPosition)
    const mentionText = `@${item.name} `
    const newValue = beforeAt + mentionText + afterMention
    
    onChange(newValue)
    setShowSuggestions(false)
    setMentionQuery('')
    
    setTimeout(() => {
      textarea.focus()
      const newCursorPos = beforeAt.length + mentionText.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  // 键盘处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % suggestions.length)
          return
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
          return
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (suggestions[selectedIndex]) {
            insertMention(suggestions[selectedIndex])
          }
          return
        case 'Escape':
          setShowSuggestions(false)
          return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  // 输入处理
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    detectMention(newValue)
  }

  // 点击外部关闭建议
  useEffect(() => {
    const handleClickOutside = () => setShowSuggestions(false)
    if (showSuggestions) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSuggestions])

  return (
    <div className="mention-input-wrapper">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="mention-textarea"
      />
      
      {showSuggestions && (
        <div className="mention-suggestions" onClick={e => e.stopPropagation()}>
          {suggestions.length > 0 ? (
            suggestions.map((item, index) => (
              <div
                key={item.id}
                onClick={() => insertMention(item)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`mention-item ${index === selectedIndex ? 'selected' : ''}`}
              >
                <span className="mention-item-icon">
                  {item.type === 'file' ? '📄' : item.type === 'symbol' ? '🔧' : '📁'}
                </span>
                <div className="mention-item-info">
                  <div className="mention-item-name">{item.name}</div>
                  {item.description && (
                    <div className="mention-item-desc">{item.description}</div>
                  )}
                </div>
                <span className={`mention-item-type ${index === selectedIndex ? 'selected' : ''}`}>
                  {item.type}
                </span>
              </div>
            ))
          ) : (
            <div className="mention-empty">
              未找到匹配项
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MentionInput
