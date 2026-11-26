
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import ErrorBoundary from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui/shadcn/tooltip';
import { SwUpdateBanner } from './components/ui/SwUpdateBanner';
import { showToast } from './components/ui/Toast';
import { APP_SW_UPDATE_AVAILABLE_EVENT, applyPendingServiceWorkerUpdate } from './pwa/register';
import { RealtimeSessionBridge } from './features/realtime';
import { authUtils } from './services/apiClient';
import { getExperimentAssignments } from './services/experimentService';
import './App.css';

// 懒加载全局 Spotlight 命令面板与快捷键指南，保持独立 Chunk 且不增加首包体积
const CommandPalette = lazy(() => import('./components/command/CommandPalette'));
const ShortcutHelpModal = lazy(() => import('./components/command/ShortcutHelpModal'));

function App() {
  // 页面加载时预加载实验分配（仅已认证用户）
  useEffect(() => {
    if (authUtils.isAuthenticated()) {
      getExperimentAssignments().catch(() => {});
    }
  }, []);

  // 桌面端检测到新版 Service Worker 时弹出带「立即更新」操作条的非阻塞 Toast
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSwUpdate = () => {
      showToast('发现新版本，刷新即可体验最新功能', 'info', 15000, {
        actionLabel: '立即更新',
        onAction: () => applyPendingServiceWorkerUpdate(),
      });
    };
    window.addEventListener(APP_SW_UPDATE_AVAILABLE_EVENT, handleSwUpdate);
    return () => {
      window.removeEventListener(APP_SW_UPDATE_AVAILABLE_EVENT, handleSwUpdate);
    };
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Router>
          <RealtimeSessionBridge />
          <div className="app">
            <AppRoutes />
          </div>
          <Suspense fallback={null}>
            <CommandPalette />
            <ShortcutHelpModal />
          </Suspense>
          <SwUpdateBanner />
        </Router>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
