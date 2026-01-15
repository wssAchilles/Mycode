import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authAPI, authUtils } from '../services/apiClient';
import type { LoginCredentials } from '../types/auth';
import { ChatIcon, EyeIcon, EyeOffIcon, AlertIcon, LoadingSpinner } from '../components/ui/Icons';
import './AuthPages.css';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState<LoginCredentials>({
    usernameOrEmail: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 如果已登录，重定向到聊天页面
  useEffect(() => {
    if (authUtils.isAuthenticated()) {
      const from = (location.state as any)?.from?.pathname || '/chat';
      navigate(from, { replace: true });
    }
  }, [navigate, location.state]);

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    // 清除错误信息
    if (error) setError('');
  };

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 防止重复提交
    if (loading) {
      return;
    }

    // 基本验证
    if (!formData.usernameOrEmail.trim()) {
      setError('请输入用户名或邮箱');
      return;
    }
    if (!formData.password) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authAPI.login(formData);
      console.log('登录成功:', response.user.username);

      // 登录成功，延迟一下再跳转，避免DOM更新冲突
      const from = (location.state as any)?.from?.pathname || '/chat';
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 50);

    } catch (error: any) {
      setError(error.message || '登录失败，请重试');
      console.error('登录失败:', error);
      setLoading(false);
    }
    // 成功情况下不设置loading=false，让跳转时保持loading状态
  };

  // 键盘事件处理
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleSubmit(e as any);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <div className="logo-icon">
              <ChatIcon size={28} color="white" />
            </div>
            <h1>Telegram Clone</h1>
          </div>
          <h2>欢迎回来</h2>
          <p>登录您的账户开始聊天</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message">
              <span className="error-icon">
                <AlertIcon size={18} />
              </span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="usernameOrEmail">用户名或邮箱</label>
            <input
              type="text"
              id="usernameOrEmail"
              name="usernameOrEmail"
              value={formData.usernameOrEmail}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="输入您的用户名或邮箱"
              disabled={loading}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密码</label>
            <div className="password-input-group">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="输入您的密码"
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeIcon size={20} /> : <EyeOffIcon size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`auth-button ${loading ? 'loading' : ''}`}
            disabled={loading}
            key="login-button" // 添加key避免React重新创建节点
          >
            {loading ? (
              <>
                <LoadingSpinner size={20} color="white" />
                登录中...
              </>
            ) : (
              '登录'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            还没有账户？
            <Link to="/register" className="auth-link">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
