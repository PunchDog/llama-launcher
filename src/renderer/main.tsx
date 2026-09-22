import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastViewport } from './components/ui'
import { startBridge } from './stores/bridge'
import './styles/index.css'

// 唯一 IPC 订阅点：必须在首帧之前起来，否则历史日志与初始状态会漏
startBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <ToastViewport />
    </ErrorBoundary>
  </React.StrictMode>
)
