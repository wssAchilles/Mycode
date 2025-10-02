import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

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
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '20px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
          textAlign: 'center',
          backgroundColor: '#1a1a1a',
          color: '#ffffff'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(255,59,48,0.1) 0%, rgba(255,149,0,0.1) 100%)',
            padding: '40px',
            borderRadius: '12px',
            border: '1px solid rgba(255,59,48,0.2)',
            maxWidth: '500px',
            width: '100%'
          }}>
            <h1 style={{ 
              fontSize: '48px', 
              margin: '0 0 16px 0', 
              color: '#ff3b30' 
            }}>
              😵‍💫
            </h1>
            <h2 style={{ 
              fontSize: '24px', 
              margin: '0 0 16px 0', 
              color: '#ffffff' 
            }}>
              React组件渲染错误
            </h2>
            <p style={{ 
              margin: '0 0 20px 0', 
              color: '#a0a0a0',
              lineHeight: '1.5'
            }}>
              应用遇到了一个React DOM错误，这通常是由于组件状态不一致导致的。
            </p>
            
            {this.state.error && (
              <div style={{
                textAlign: 'left',
                background: 'rgba(0,0,0,0.3)',
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '20px',
                fontSize: '12px',
                fontFamily: 'Monaco, "Cascadia Code", "Roboto Mono", monospace',
                color: '#ff6b6b',
                overflow: 'auto',
                maxHeight: '150px'
              }}>
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
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '12px 24px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease'
                }}
                onMouseOver={(e) => {
                  (e.target as HTMLElement).style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  (e.target as HTMLElement).style.transform = 'translateY(0)';
                }}
              >
                重试
              </button>
              
              <button
                onClick={() => window.location.href = '/login'}
                style={{
                  padding: '12px 24px',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease'
                }}
                onMouseOver={(e) => {
                  (e.target as HTMLElement).style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  (e.target as HTMLElement).style.transform = 'translateY(0)';
                }}
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
