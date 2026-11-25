
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import ErrorBoundary from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui/shadcn/tooltip';
import { SwUpdateBanner } from './components/ui/SwUpdateBanner';
import { RealtimeSessionBridge } from './features/realtime';
import { authUtils } from './services/apiClient';
import { getExperimentAssignments } from './services/experimentService';
import './App.css';

// 懒加载全局 Spotlight 命令面板，保持独立 Chunk 且不增加 ChatPage 首包体积
const CommandPalette = lazy(() => import('./components/command/CommandPalette'));

function App() {
  // 页面加载时预加载实验分配（仅已认证用户）
  useEffect(() => {
    if (authUtils.isAuthenticated()) {
      getExperimentAssignments().catch(() => {});
    }
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
          </Suspense>
          <SwUpdateBanner />
        </Router>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
