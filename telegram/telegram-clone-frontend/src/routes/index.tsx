import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import { authUtils } from '../services/apiClient';

// 路由代码分割 - 使用 React.lazy 延迟加载页面
const LoginPage = React.lazy(() => import('../pages/LoginPage'));
const RegisterPage = React.lazy(() => import('../pages/RegisterPage'));
const ChatPage = React.lazy(() => import('../pages/ChatPage'));
const SpacePage = React.lazy(() => import('../pages/SpacePage'));
const SpacePostDetailPage = React.lazy(() => import('../pages/SpacePostDetailPage'));
const SpaceProfilePage = React.lazy(() => import('../pages/SpaceProfilePage'));
const NewsDetailPage = React.lazy(() => import('../pages/NewsDetailPage'));
const OnboardingPage = React.lazy(() => import('../pages/OnboardingPage'));
const Dashboard = React.lazy(() => import('../components/admin/Dashboard'));
const ExperimentManager = React.lazy(() => import('../components/admin/ExperimentManager'));
const ChatRuntimeDashboard = React.lazy(() => import('../components/admin/ChatRuntimeDashboard'));

// 主题感知的零闪白轻量级路由占位：顶部细进度条 + SVG 指示器
const LoadingFallback = () => (
  <div
    style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--color-background, #FFFFFF)',
      color: 'var(--color-text-secondary, #536471)',
      fontSize: '14px',
    }}
  >
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: 'linear-gradient(90deg, transparent, var(--tg-blue, #1D9BF0), transparent)',
        opacity: 0.9,
      }}
    />
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--tg-blue, #1D9BF0)"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ animation: 'tg-spin 0.8s linear infinite' }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <div style={{ fontWeight: 500, color: 'var(--color-text-primary, #0F1419)' }}>正在加载页面...</div>
    </div>
  </div>
);

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
          {/* 根路径重定向 */}
          <Route
            path="/"
            element={
              authUtils.isAuthenticated()
                ? localStorage.getItem('onboarding_completed')
                  ? <Navigate to="/chat" replace />
                  : <Navigate to="/onboarding" replace />
                : <Navigate to="/login" replace />
            }
          />

          {/* 认证页面 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />

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

          {/* Space 动态详情页 */}
          <Route
            path="/space/post/:id"
            element={
              <ProtectedRoute>
                <SpacePostDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Space 个人主页 */}
          <Route
            path="/space/user/:id"
            element={
              <ProtectedRoute>
                <SpaceProfilePage />
              </ProtectedRoute>
            }
          />

          {/* 新闻详情页 */}
          <Route
            path="/news/:id"
            element={
              <ProtectedRoute>
                <NewsDetailPage />
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

          {/* Admin Chat Runtime 观测 */}
          <Route
            path="/admin/chat-runtime"
            element={
              <ProtectedRoute>
                <ChatRuntimeDashboard />
              </ProtectedRoute>
            }
          />

          {/* 404 页面（支持主题自适应的高对比排版） */}
          <Route
            path="*"
            element={
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                background: 'var(--color-background, #FFFFFF)',
                fontFamily: 'var(--font-family)',
                textAlign: 'center',
                color: 'var(--color-text-secondary, #536471)',
                padding: '24px'
              }}>
                <h1 style={{ fontSize: '56px', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px 0', color: 'var(--color-text-primary, #0F1419)' }}>404</h1>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--color-text-primary, #0F1419)' }}>页面未找到</h2>
                <p style={{ margin: '0 0 24px 0', fontSize: '15px', color: 'var(--color-text-secondary, #536471)' }}>抱歉，您访问的页面不存在或已被移动。</p>
                <button
                  onClick={() => window.location.href = '/'}
                  style={{
                    padding: '11px 26px',
                    background: 'var(--color-cta-solid, #0F1419)',
                    color: 'var(--color-background, #FFFFFF)',
                    border: 'none',
                    borderRadius: '9999px',
                    fontSize: '15px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease'
                  }}
                >
                  返回首页
                </button>
              </div>
            }
          />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
