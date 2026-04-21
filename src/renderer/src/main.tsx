import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './styles/tool-execution.css'
import '@xterm/xterm/css/xterm.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
)