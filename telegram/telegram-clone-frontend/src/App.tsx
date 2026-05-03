
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import ErrorBoundary from './components/ErrorBoundary';
import { TooltipProvider } from './components/ui/shadcn/tooltip';
import './App.css';

function App() {
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
