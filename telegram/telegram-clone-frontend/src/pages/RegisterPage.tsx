import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI, authUtils } from '../services/apiClient';
import type { RegisterCredentials } from '../types/auth';
import { ChatIcon, EyeIcon, EyeOffIcon, AlertIcon, LoadingSpinner } from '../components/ui/Icons';
import { detectCountryCode, detectLanguageCode, COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from '../utils/locale';
import './AuthPages.css';

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<RegisterCredentials>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    region: detectCountryCode() || '',
    language: detectLanguageCode() || '',
    birthDate: '',
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
        hasToken: !!authUtils.getAccessToken()
      });

      // 注册成功，跳转到引导页
      console.log('🚀 准备跳转到引导页面...');
      setTimeout(() => {
        navigate('/onboarding', { replace: true });
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
            <div className="logo-icon">
              <ChatIcon size={28} color="white" />
            </div>
            <h1>Telegram Clone</h1>
          </div>
          <h2>创建新账户</h2>
          <p>注册以开始使用我们的聊天服务</p>
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

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="region">地区 (可选)</label>
              <select
                id="region"
                name="region"
                value={formData.region || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, region: e.target.value }))}
                disabled={loading}
              >
                <option value="">自动检测</option>
                {COUNTRY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="language">语言 (可选)</label>
              <select
                id="language"
                name="language"
                value={formData.language || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
                disabled={loading}
              >
                <option value="">自动检测</option>
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="birthDate">出生日期 (可选)</label>
            <input
              type="date"
              id="birthDate"
              name="birthDate"
              value={formData.birthDate || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, birthDate: e.target.value }))}
              disabled={loading}
              max={new Date(new Date().setFullYear(new Date().getFullYear() - 13)).toISOString().split('T')[0]}
            />
            <small className="form-hint">用于个性化推荐，需年满13岁</small>
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
                {showPassword ? <EyeIcon size={20} /> : <EyeOffIcon size={20} />}
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
                {showConfirmPassword ? <EyeIcon size={20} /> : <EyeOffIcon size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={`auth-button ${loading ? 'loading' : ''}`}
            disabled={loading}
            key="register-button"
          >
            {loading ? (
              <>
                <LoadingSpinner size={20} color="white" />
                注册中...
              </>
            ) : (
              '注册'
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
