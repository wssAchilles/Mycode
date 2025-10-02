import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authUtils } from '../services/apiClient';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// 受保护的路由组件
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const location = useLocation();
  const isAuthenticated = authUtils.isAuthenticated();

  if (!isAuthenticated) {
    // 保存当前尝试访问的页面，登录后重定向回来
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
