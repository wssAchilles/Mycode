import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { authAPI, authUtils } from '../services/apiClient';
import type { LoginCredentials } from '../types/auth';
import { ChatIcon, EyeIcon, EyeOffIcon, AlertIcon, LoadingSpinner, UserIcon } from '../components/ui/Icons';
import { motionDurations, useAnimeScope, waapi } from '../core/animation';
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
  const [capsLockOn, setCapsLockOn] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const authMotion = useAnimeScope<HTMLDivElement, {
    enter: () => void;
    error: () => void;
  }>(
    ({ root, reducedMotion, duration }) => ({
      enter: () => {
        if (reducedMotion || !root) return;
        const card = root.querySelector('.auth-card');
        if (!card) return;
        waapi.animate(card, {
          opacity: [0, 1],
          y: ['18px', '0px'],
          scale: [0.98, 1],
          duration: duration(motionDurations.normal),
          ease: 'out(4)',
        });
      },
      error: () => {
        if (reducedMotion || !root) return;
        const errorEl = root.querySelector('.error-message');
        if (!errorEl) return;
        waapi.animate(errorEl, {
          opacity: [0, 1],
          x: ['8px', '0px'],
          duration: duration(motionDurations.fast),
          ease: 'out(4)',
        });
      },
    }),
    [error],
  );

  // 如果已登录，重定向到聊天页面
  useEffect(() => {
    if (authUtils.isAuthenticated()) {
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/chat';
      navigate(from, { replace: true });
    }
  }, [navigate, location.state]);

  // 登录页空闲时提前预热 ChatPage chunk，消除登录成功后切页时的白屏/按钮卡死感
  useEffect(() => {
    const timer = window.setTimeout(() => {
      import('./ChatPage').catch(() => {
        // 预加载失败不影响正常路由懒加载
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    authMotion.run('enter');
  }, [authMotion]);

  useEffect(() => {
    if (error) {
      authMotion.run('error');
    }
  }, [authMotion, error]);

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
      usernameInputRef.current?.focus();
      return;
    }
    if (!formData.password) {
      setError('请输入密码');
      passwordInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError('');

    try {
      await authAPI.login(formData);

      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/chat';
      navigate(from, { replace: true });

    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : '登录失败，请重试');
      console.error('登录失败:', error);
      setLoading(false);
      window.setTimeout(() => {
        passwordInputRef.current?.focus();
        passwordInputRef.current?.select();
      }, 0);
    }
    // 成功情况下不设置loading=false，让跳转时保持loading状态
  };

  return (
    <div ref={authMotion.rootRef} className="auth-container auth-container--login">
      <div className="auth-login-shell">
        <section className="auth-login-showcase" aria-label="产品亮点">
          <div className="auth-login-showcase__inner">
            <div className="auth-login-showcase__brand">
              <div className="auth-login-showcase__brand-mark">
                <ChatIcon size={24} color="currentColor" />
              </div>
              <span className="auth-login-showcase__brand-name">Telegram Clone</span>
            </div>

            <div className="auth-login-showcase__copy">
              <span className="auth-login-showcase__eyebrow">Secure Messaging Platform</span>
              <p className="auth-login-showcase__headline">让每一次协作都即时抵达</p>
              <p className="auth-login-showcase__description">
                面向高频沟通场景打造的纯净轻量级即时通讯与实时动态空间，在速度、安全与跨端一致性之间保持平衡。
              </p>
            </div>

            <div className="auth-login-showcase__chips" aria-label="核心特性">
              <span>毫秒级实时消息同步</span>
              <span>Space 纯净动态流</span>
              <span>多模态 AI 协作助手</span>
              <span>跨设备无缝漫游</span>
            </div>
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
                <UserIcon size={28} color="#1D9BF0" />
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
                    ref={usernameInputRef}
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
                  <div className="auth-field-head__right">
                    {capsLockOn && (
                      <span className="auth-capslock-badge" role="status">
                        大写锁定已开启
                      </span>
                    )}
                    <span className="auth-field-inline-note">忘记密码请联系管理员</span>
                  </div>
                </div>
                <div className="auth-input-shell auth-input-shell--password">
                  <span className="auth-input-icon" aria-hidden="true">
                    <Lock size={18} />
                  </span>
                  <input
                    ref={passwordInputRef}
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    onKeyDown={(e) => setCapsLockOn(Boolean(e.getModifierState?.('CapsLock')))}
                    onKeyUp={(e) => setCapsLockOn(Boolean(e.getModifierState?.('CapsLock')))}
                    onBlur={() => setCapsLockOn(false)}
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
                    <LoadingSpinner size={20} color="#FFFFFF" />
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
