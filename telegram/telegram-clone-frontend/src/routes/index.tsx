import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
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

// 加载中占位组件（纯净淡色与 SVG 指示器）
const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#FFFFFF',
    color: '#536471',
    fontSize: '15px',
  }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1D9BF0"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ animation: 'tg-spin 0.8s linear infinite' }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <div style={{ fontWeight: 500, color: '#0F1419' }}>正在加载页面...</div>
    </div>
  </div>
);

const AppRoutes: React.FC = () => {
  const location = useLocation();

  return (
    <Suspense fallback={<LoadingFallback />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
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

          {/* 404 页面（极简淡色高对比） */}
          <Route
            path="*"
            element={
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                background: '#FFFFFF',
                fontFamily: 'var(--font-family)',
                textAlign: 'center',
                color: '#536471',
                padding: '24px'
              }}>
                <h1 style={{ fontSize: '56px', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px 0', color: '#0F1419' }}>404</h1>
                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0', color: '#0F1419' }}>页面未找到</h2>
                <p style={{ margin: '0 0 24px 0', fontSize: '15px', color: '#536471' }}>抱歉，您访问的页面不存在或已被移动。</p>
                <button
                  onClick={() => window.location.href = '/'}
                  style={{
                    padding: '11px 26px',
                    background: '#0F1419',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '9999px',
                    fontSize: '15px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#272C30';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1419';
                  }}
                >
                  返回首页
                </button>
              </div>
            }
          />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};

export default AppRoutes;
