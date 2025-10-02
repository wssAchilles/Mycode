
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import { useSocketEffect } from './hooks/useSocket';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  // 自动管理 Socket.IO 连接
  useSocketEffect();

  return (
    <ErrorBoundary>
      <Router>
        <div className="app">
          <AppRoutes />
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
