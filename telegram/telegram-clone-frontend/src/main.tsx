import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/register'
import { initPerfMetrics } from './perf/metrics'

function scheduleNonCriticalBootTasks() {
  const run = () => {
    registerServiceWorker()
    initPerfMetrics()
  }

  if (typeof window === 'undefined') {
    run()
    return
  }

  const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined
  if (idle) {
    idle(() => run(), { timeout: 2000 })
    return
  }

  window.setTimeout(run, 0)
}

scheduleNonCriticalBootTasks()

createRoot(document.getElementById('root')!).render(
  <App />
)
