import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Lock, Mail, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import { authAPI, authUtils } from '../services/apiClient';
import type { LoginCredentials } from '../types/auth';
import { ChatIcon, EyeIcon, EyeOffIcon, AlertIcon, LoadingSpinner, UserIcon } from '../components/ui/Icons';
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

  const showcaseItems = [
    {
      title: '极速通信',
      description: '会话分发保持低延迟，让团队协作始终在同一拍点。',
      Icon: Zap,
    },
    {
      title: '安全加密',
      description: '关键消息和敏感内容通过更稳妥的链路完成传递。',
      Icon: ShieldCheck,
    },
    {
      title: '多端同步',
      description: '桌面、移动与通知流无缝衔接，状态切换始终连续。',
      Icon: Smartphone,
    },
  ];

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

  return (
    <div className="auth-container auth-container--login">
      <div className="auth-login-shell">
        <section className="auth-login-showcase" aria-label="产品亮点">
          <div className="auth-login-showcase__brand">
            <div className="auth-login-showcase__brand-mark">
              <ChatIcon size={26} color="currentColor" />
            </div>
            <span className="auth-login-showcase__brand-name">Telegram Clone</span>
          </div>

          <div className="auth-login-showcase__copy">
            <span className="auth-login-showcase__eyebrow">Secure Messaging Platform</span>
            <p className="auth-login-showcase__headline">让每一次协作都即时抵达</p>
            <p className="auth-login-showcase__description">
              面向高频沟通场景打造的沉浸式聊天体验，在速度、安全与跨端一致性之间保持平衡。
            </p>
          </div>

          <div className="auth-login-showcase__feature-list">
            {showcaseItems.map(({ title, description, Icon }) => (
              <article className="auth-login-feature" key={title}>
                <div className="auth-login-feature__icon" aria-hidden="true">
                  <Icon size={22} />
                </div>
                <div className="auth-login-feature__content">
                  <h2>{title}</h2>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="auth-login-showcase__chips" aria-label="产品特性标签">
            <span>实时同步</span>
            <span>端到端保护</span>
            <span>团队协作就绪</span>
          </div>
        </section>

        <section className="auth-login-pane" aria-labelledby="login-title">
          <div className="auth-card auth-card--login">
            <div className="auth-login-mobile-brand">
              <div className="auth-login-mobile-brand__mark">
                <ChatIcon size={20} color="currentColor" />
              </div>
              <span>Telegram Clone</span>
            </div>

            <div className="auth-login-card__header">
              <div className="auth-login-card__avatar" aria-hidden="true">
                <UserIcon size={28} color="var(--tg-blue)" />
              </div>
              <div className="auth-login-card__copy">
                <span className="auth-login-card__eyebrow">Secure Access</span>
                <h1 id="login-title">欢迎回来</h1>
                <p>登录您的账户，继续访问聊天、动态与实时通知。</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="auth-form auth-form--login">
              {error && (
                <div className="error-message" role="alert">
                  <span className="error-icon">
                    <AlertIcon size={18} />
                  </span>
                  {error}
                </div>
              )}

              <div className="form-group form-group--login">
                <div className="auth-field-head">
                  <label htmlFor="usernameOrEmail">用户名或邮箱</label>
                </div>
                <div className="auth-input-shell">
                  <span className="auth-input-icon" aria-hidden="true">
                    <Mail size={18} />
                  </span>
                  <input
                    type="text"
                    id="usernameOrEmail"
                    name="usernameOrEmail"
                    value={formData.usernameOrEmail}
                    onChange={handleInputChange}
                    placeholder="输入您的用户名或邮箱"
                    disabled={loading}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-group form-group--login">
                <div className="auth-field-head">
                  <label htmlFor="password">密码</label>
                  <span className="auth-field-inline-note">忘记密码请联系管理员</span>
                </div>
                <div className="auth-input-shell auth-input-shell--password">
                  <span className="auth-input-icon" aria-hidden="true">
                    <Lock size={18} />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="输入您的密码"
                    disabled={loading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-toggle password-toggle--login"
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
                className={`auth-button auth-button--login ${loading ? 'loading' : ''}`}
                disabled={loading}
                key="login-button"
              >
                {loading ? (
                  <>
                    <LoadingSpinner size={20} color="white" />
                    登录中...
                  </>
                ) : (
                  <>
                    立即登录
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="auth-footer auth-footer--login">
              <p>
                还没有账户？
                <Link to="/register" className="auth-link">
                  立即注册
                </Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
