import { useState, useRef, useEffect } from 'react'
import { t } from '../i18n'

interface BrowserViewProps {
  initialUrl?: string
  onClose?: () => void
  onUrlChange?: (url: string) => void
}

function BrowserView({ initialUrl = '', onClose, onUrlChange }: BrowserViewProps) {
  const [url, setUrl] = useState(initialUrl)
  const [inputValue, setInputValue] = useState(initialUrl)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)

  // 当 initialUrl 变化时（切换标签），更新状态
  useEffect(() => {
    setUrl(initialUrl)
    setInputValue(initialUrl)
  }, [initialUrl])

  // 处理 URL 输入
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let targetUrl = inputValue.trim()
    
    // 如果没有协议，添加 https://
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl
    }
    
    setUrl(targetUrl)
    setInputValue(targetUrl)
    
    // 通知父组件 URL 变化
    onUrlChange?.(targetUrl)
    
    if (webviewRef.current) {
      webviewRef.current.src = targetUrl
    }
  }

  // 导航控制
  const handleGoBack = () => {
    if (webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack()
    }
  }

  const handleGoForward = () => {
    if (webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward()
    }
  }

  const handleReload = () => {
    if (webviewRef.current) {
      webviewRef.current.reload()
    }
  }

  // 监听 webview 事件
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleLoadStart = () => {
      setIsLoading(true)
    }

    const handleLoadStop = () => {
      setIsLoading(false)
      // 更新地址栏显示当前 URL
      const currentUrl = webview.getURL()
      if (currentUrl) {
        setInputValue(currentUrl)
        // 通知父组件 URL 变化
        onUrlChange?.(currentUrl)
      }
    }

    const handleNavigate = () => {
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const handleFailLoad = (event: Event) => {
      const failEvent = event as unknown as { errorCode: number; errorDescription: string; validatedURL: string }
      // ERR_ABORTED (-3) 是用户取消或页面跳转时的正常错误，不需要显示
      if (failEvent.errorCode === -3) {
        setIsLoading(false)
        return
      }
      console.error('[BrowserView] Failed to load:', failEvent.errorDescription, 'URL:', failEvent.validatedURL)
      setIsLoading(false)
    }

    webview.addEventListener('did-start-loading', handleLoadStart)
    webview.addEventListener('did-stop-loading', handleLoadStop)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      webview.removeEventListener('did-start-loading', handleLoadStart)
      webview.removeEventListener('did-stop-loading', handleLoadStop)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [])

  return (
    <div className="browser-view-container">
      {/* 浏览器工具栏 */}
      <div className="browser-toolbar">
        <div className="browser-nav-controls">
          <button 
            className="browser-nav-btn" 
            onClick={handleGoBack}
            disabled={!canGoBack}
            title="后退"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          
          <button 
            className="browser-nav-btn" 
            onClick={handleGoForward}
            disabled={!canGoForward}
            title="前进"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
          
          <button 
            className="browser-nav-btn" 
            onClick={handleReload}
            title="刷新"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
        </div>

        {/* URL 输入框 */}
        <form className="browser-url-bar" onSubmit={handleUrlSubmit}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入网址..."
            className="browser-url-input"
          />
          {isLoading && (
            <div className="browser-loading-indicator">
              <div className="loading-spinner"></div>
            </div>
          )}
        </form>

        {/* 关闭按钮 */}
        {onClose && (
          <button 
            className="browser-close-btn"
            onClick={onClose}
            title="关闭浏览器"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}
      </div>

      {/* Webview 容器 */}
      <div className="browser-webview-container">
        {url ? (
          <webview
            ref={webviewRef}
            src={url}
            className="browser-webview"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            allowpopups={true}
            plugins={true}
            nodeintegration={false}
            webpreferences="contextIsolation=yes,spellCheck=no"
          />
        ) : (
          <div className="browser-empty-state">
            <div className="empty-state-content">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
              <p>在上方地址栏输入网址开始浏览</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default BrowserView
