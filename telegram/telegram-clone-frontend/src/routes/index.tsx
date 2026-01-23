import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import ChatPage from '../pages/ChatPage';
import SpacePage from '../pages/SpacePage';
import ProtectedRoute from '../components/ProtectedRoute';
import { Dashboard, ExperimentManager } from '../components/admin';
import { authUtils } from '../services/apiClient';

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* 根路径重定向 */}
      <Route
        path="/"
        element={
          authUtils.isAuthenticated()
            ? <Navigate to="/chat" replace />
            : <Navigate to="/login" replace />
        }
      />

      {/* 认证页面 */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* 受保护的聊天页面 */}
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />

      {/* Space 动态页面 */}
      <Route
        path="/space"
        element={
          <ProtectedRoute>
            <SpacePage />
          </ProtectedRoute>
        }
      />

      {/* Admin 监控看板 */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin 实验管理 */}
      <Route
        path="/admin/experiments"
        element={
          <ProtectedRoute>
            <ExperimentManager />
          </ProtectedRoute>
        }
      />

      {/* 404 页面 */}
      <Route
        path="*"
        element={
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
            textAlign: 'center',
            color: '#718096'
          }}>
            <h1 style={{ fontSize: '48px', margin: '0 0 16px 0' }}>404</h1>
            <h2 style={{ fontSize: '24px', margin: '0 0 8px 0', color: '#2d3748' }}>页面未找到</h2>
            <p style={{ margin: '0 0 24px 0' }}>抱歉，您访问的页面不存在。</p>
            <button
              onClick={() => window.location.href = '/'}
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
              返回首页
            </button>
          </div>
        }
      />
    </Routes>
  );
};

export default AppRoutes;
