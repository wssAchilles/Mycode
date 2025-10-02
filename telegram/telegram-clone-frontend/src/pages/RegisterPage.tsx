import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI, authUtils } from '../services/apiClient';
import type { RegisterCredentials } from '../types/auth';
import './AuthPages.css';

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<RegisterCredentials>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 如果已登录，重定向到聊天页面
  useEffect(() => {
    if (authUtils.isAuthenticated()) {
      navigate('/chat', { replace: true });
    }
  }, [navigate]);

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

  // 表单验证
  const validateForm = (): string | null => {
    if (!formData.username.trim()) {
      return '请输入用户名';
    }
    if (formData.username.length < 3) {
      return '用户名至少需要3个字符';
    }
    if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      return '用户名只能包含字母、数字和下划线';
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      return '请输入有效的邮箱地址';
    }
    if (!formData.password) {
      return '请输入密码';
    }
    if (formData.password.length < 6) {
      return '密码至少需要6个字符';
    }
    if (formData.password !== formData.confirmPassword) {
      return '密码和确认密码不匹配';
    }
    return null;
  };

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 防止重复提交
    if (loading) {
      return;
    }
    
    // 验证表单
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('🔄 开始注册流程...');
      const response = await authAPI.register(formData);
      console.log('✅ 注册API响应成功:', {
        username: response.user.username,
        userId: response.user.id,
        hasTokens: !!response.tokens
      });
      
      // 延迟一小段时间确保token完全存储
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log('📦 验证token存储状态:', {
        isAuthenticated: authUtils.isAuthenticated(),
        hasToken: !!localStorage.getItem('accessToken')
      });
      
      // 注册成功，延迟一下再跳转，避免DOM更新冲突
      console.log('🚀 准备跳转到聊天页面...');
      setTimeout(() => {
        navigate('/chat', { replace: true });
      }, 50);
      
    } catch (error: any) {
      setError(error.message || '注册失败，请重试');
      console.error('❌ 注册失败:', error);
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
            <div className="logo-icon">💬</div>
            <h1>Telegram Clone</h1>
          </div>
          <h2>创建新账户</h2>
          <p>注册以开始使用我们的聊天服务</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">用户名 *</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="输入您的用户名"
              disabled={loading}
              autoComplete="username"
              autoFocus
            />
            <small className="form-hint">
              至少3个字符，只能包含字母、数字和下划线
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="email">邮箱 (可选)</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder="输入您的邮箱地址"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密码 *</label>
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
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <small className="form-hint">至少6个字符</small>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">确认密码 *</label>
            <div className="password-input-group">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="再次输入您的密码"
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={loading}
                aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
              >
                {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`auth-button ${loading ? 'loading' : ''}`}
            disabled={loading}
            key="register-button" // 添加key避免React重新创建节点
          >
            {loading ? (
              <>
                <span className="loading-spinner" key="spinner"></span>
                注册中...
              </>
            ) : (
              <span key="register-text">注册</span>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            已有账户？
            <Link to="/login" className="auth-link">
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
