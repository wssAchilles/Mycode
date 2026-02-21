
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
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
