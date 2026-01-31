import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // 更新 state，下次渲染会显示错误页面
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 React Error Boundary 捕获到错误:', error);
    console.error('📍 错误详情:', errorInfo);
    
    // 记录错误信息到状态
    this.setState({
      error,
      errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <h1 className="error-boundary__icon">😵‍💫</h1>
            <h2 className="error-boundary__title">React组件渲染错误</h2>
            <p className="error-boundary__desc">
              应用遇到了一个React DOM错误，这通常是由于组件状态不一致导致的。
            </p>

            {this.state.error && (
              <div className="error-boundary__details">
                <strong>错误信息:</strong><br />
                {this.state.error.message}
                {this.state.errorInfo && (
                  <>
                    <br /><br />
                    <strong>组件栈:</strong><br />
                    {this.state.errorInfo.componentStack}
                  </>
                )}
              </div>
            )}

            <div className="error-boundary__actions">
              <button
                onClick={this.handleRetry}
                className="error-boundary__btn error-boundary__btn--primary"
              >
                重试
              </button>

              <button
                onClick={() => window.location.href = '/login'}
                className="error-boundary__btn error-boundary__btn--ghost"
              >
                返回登录
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
