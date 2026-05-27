import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './styles/tool-execution.css'
import './styles/search.css'
import './styles/lsp.css'
import '@xterm/xterm/css/xterm.css'
import { initializeToolClient } from './services/tool-client'
import { setupGlobalErrorHandler } from './services/error-handler'

// 初始化工具调用客户端
initializeToolClient()
console.log('[Main] Tool client initialized')

// 安装全局错误处理器
setupGlobalErrorHandler()
console.log('[Main] Global error handler installed')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
)