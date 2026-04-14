interface TimeoutPromptProps {
  onContinue?: () => void
  onStop?: () => void
  message?: string
}

export function TimeoutPrompt({ 
  onContinue, 
  onStop,
  message = '请求超时，可点击继续'
}: TimeoutPromptProps) {
  return (
    <div className="timeout-prompt">
      <div className="timeout-prompt-content">
        <div className="timeout-prompt-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div className="timeout-prompt-text">
          <p className="timeout-prompt-title">{message}</p>
          <p className="timeout-prompt-desc">AI响应时间较长，您可以选择继续等待或停止当前请求</p>
        </div>
      </div>
      <div className="timeout-prompt-actions">
        {onStop && (
          <button 
            className="timeout-prompt-btn secondary"
            onClick={onStop}
          >
            停止
          </button>
        )}
        {onContinue && (
          <button 
            className="timeout-prompt-btn primary"
            onClick={onContinue}
          >
            继续
          </button>
        )}
      </div>
    </div>
  )
}

export default TimeoutPrompt
