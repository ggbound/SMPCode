import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './styles/tool-execution.css'
import './styles/search.css'
import '@xterm/xterm/css/xterm.css'
import { initializeToolClient } from './services/tool-client'

// 初始化工具调用客户端
initializeToolClient()
console.log('[Main] Tool client initialized')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
)