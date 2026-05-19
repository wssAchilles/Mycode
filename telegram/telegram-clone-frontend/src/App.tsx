
import { useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import ErrorBoundary from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui/shadcn/tooltip';
import { authUtils } from './services/apiClient';
import { getExperimentAssignments } from './services/experimentService';
import './App.css';

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
          <div className="app">
            <AppRoutes />
          </div>
        </Router>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
