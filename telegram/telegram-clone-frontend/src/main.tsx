import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/register'
import { initPerfMetrics, perfMonitor } from './perf/metrics'

function scheduleNonCriticalBootTasks() {
  const run = () => {
    registerServiceWorker()
    initPerfMetrics()
    perfMonitor.startLongFrameMonitoring()
  }

  if (typeof window === 'undefined') {
    run()
    return
  }

  const idle = 'requestIdleCallback' in window
    ? window.requestIdleCallback.bind(window)
    : undefined
  if (idle) {
    idle(() => run(), { timeout: 2000 })
    return
  }

  window.setTimeout(run, 0)
}

scheduleNonCriticalBootTasks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
