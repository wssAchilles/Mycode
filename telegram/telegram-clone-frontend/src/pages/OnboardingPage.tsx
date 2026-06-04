import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI, authUtils } from '../services/apiClient';
import { detectCountryCode, detectLanguageCode, COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from '../utils/locale';
import { LoadingSpinner } from '../components/ui/Icons';
import {
  limitedMotionItems,
  motionDurations,
  motionStaggers,
  stagger,
  useAnimeScope,
  waapi,
} from '../core/animation';
import './OnboardingPage.css';

/** 预置兴趣标签 */
const INTEREST_TAGS = [
  { id: 'tech', label: '科技', emoji: '💻' },
  { id: 'news', label: '新闻', emoji: '📰' },
  { id: 'sports', label: '体育', emoji: '⚽' },
  { id: 'music', label: '音乐', emoji: '🎵' },
  { id: 'gaming', label: '游戏', emoji: '🎮' },
  { id: 'food', label: '美食', emoji: '🍜' },
  { id: 'travel', label: '旅行', emoji: '✈️' },
  { id: 'movies', label: '电影', emoji: '🎬' },
  { id: 'science', label: '科学', emoji: '🔬' },
  { id: 'finance', label: '财经', emoji: '📈' },
  { id: 'health', label: '健康', emoji: '💪' },
  { id: 'art', label: '艺术', emoji: '🎨' },
  { id: 'education', label: '教育', emoji: '📚' },
  { id: 'photography', label: '摄影', emoji: '📷' },
  { id: 'fashion', label: '时尚', emoji: '👗' },
  { id: 'pets', label: '宠物', emoji: '🐱' },
];

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<'welcome' | 'profile' | 'interests'>('welcome');
  const [region, setRegion] = useState(detectCountryCode() || '');
  const [language, setLanguage] = useState(detectLanguageCode() || '');
  const [birthDate, setBirthDate] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const onboardingMotion = useAnimeScope<HTMLDivElement, {
    step: () => void;
    interests: () => void;
    select: (target: HTMLElement) => void;
    error: () => void;
  }>(
    ({ root, reducedMotion, duration }) => ({
      step: () => {
        if (reducedMotion || !root) return;
        const activeStep = root.querySelector('.onboarding-step');
        if (!activeStep) return;
        waapi.animate(activeStep, {
          opacity: [0, 1],
          x: ['10px', '0px'],
          duration: duration(motionDurations.normal),
          ease: 'out(4)',
        });
      },
      interests: () => {
        if (reducedMotion || !root) return;
        const tags = limitedMotionItems(root.querySelectorAll('.interest-tag'));
        if (tags.length === 0) return;
        waapi.animate(tags, {
          opacity: [0, 1],
          y: ['8px', '0px'],
          duration: duration(motionDurations.fast),
          delay: stagger(motionStaggers.tight),
          ease: 'out(4)',
        });
      },
      select: (target) => {
        if (reducedMotion) return;
        waapi.animate(target, {
          scale: [1, 0.96, 1],
          duration: duration(motionDurations.fast),
          ease: 'out(4)',
        });
      },
      error: () => {
        if (reducedMotion || !root) return;
        const errorEl = root.querySelector('.onboarding-error');
        if (!errorEl) return;
        waapi.animate(errorEl, {
          opacity: [0, 1],
          x: ['8px', '0px'],
          duration: duration(motionDurations.fast),
          ease: 'out(4)',
        });
      },
    }),
    [step, error],
  );

  useEffect(() => {
    if (!authUtils.isAuthenticated()) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    onboardingMotion.run('step');
    if (step === 'interests') {
      onboardingMotion.run('interests');
    }
  }, [onboardingMotion, step]);

  useEffect(() => {
    if (error) {
      onboardingMotion.run('error');
    }
  }, [error, onboardingMotion]);

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setError('');
    try {
      const updates: Record<string, string | null> = {};
      if (region) updates.region = region;
      if (language) updates.language = language;
      if (birthDate) updates.birthDate = birthDate;

      if (Object.keys(updates).length > 0) {
        await authAPI.updateProfile(updates);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const handleComplete = async () => {
    setSaving(true);
    await handleSaveProfile();
    // 兴趣标签暂时存到 localStorage，后续可扩展为 API
    if (selectedInterests.size > 0) {
      localStorage.setItem('onboarding_interests', JSON.stringify([...selectedInterests]));
    }
    localStorage.setItem('onboarding_completed', 'true');
    navigate('/space', { replace: true });
  };

  const handleSkip = () => {
    localStorage.setItem('onboarding_completed', 'true');
    navigate('/space', { replace: true });
  };

  return (
    <div className="onboarding-container">
      <div ref={onboardingMotion.rootRef} className="onboarding-card">
        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="onboarding-step">
            <div className="onboarding-hero">
              <div className="onboarding-logo">✦</div>
              <h1>欢迎加入</h1>
              <p className="onboarding-subtitle">
                个性化你的体验，让我们为你推荐更相关的内容
              </p>
            </div>
            <div className="onboarding-actions">
              <button
                className="onboarding-btn primary"
                onClick={() => setStep('profile')}
              >
                开始设置
              </button>
              <button
                className="onboarding-btn ghost"
                onClick={handleSkip}
              >
                跳过，稍后设置
              </button>
            </div>
          </div>
        )}

        {/* Step: Profile */}
        {step === 'profile' && (
          <div className="onboarding-step">
            <div className="onboarding-header">
              <h2>基本资料</h2>
              <p>帮助我们了解你，用于个性化推荐</p>
            </div>

            {error && <div className="onboarding-error">{error}</div>}

            <div className="onboarding-form">
              <div className="onboarding-field">
                <label htmlFor="onb-region">地区</label>
                <select
                  id="onb-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  disabled={saving}
                >
                  <option value="">自动检测</option>
                  {COUNTRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="onboarding-field">
                <label htmlFor="onb-language">语言</label>
                <select
                  id="onb-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={saving}
                >
                  <option value="">自动检测</option>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="onboarding-field">
                <label htmlFor="onb-birthdate">出生日期</label>
                <input
                  type="date"
                  id="onb-birthdate"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  disabled={saving}
                  max={new Date(new Date().setFullYear(new Date().getFullYear() - 13)).toISOString().split('T')[0]}
                />
                <span className="onboarding-hint">需年满13岁</span>
              </div>
            </div>

            <div className="onboarding-actions">
              <button
                className="onboarding-btn primary"
                onClick={() => setStep('interests')}
                disabled={saving}
              >
                下一步
              </button>
              <button
                className="onboarding-btn ghost"
                onClick={() => setStep('interests')}
              >
                跳过此步
              </button>
            </div>
          </div>
        )}

        {/* Step: Interests */}
        {step === 'interests' && (
          <div className="onboarding-step">
            <div className="onboarding-header">
              <h2>选择兴趣</h2>
              <p>选择你感兴趣的话题（可多选），帮助我们推荐更好的内容</p>
            </div>

            <div className="interest-grid">
              {INTEREST_TAGS.map((tag) => (
                <button
                  key={tag.id}
                  className={`interest-tag ${selectedInterests.has(tag.id) ? 'selected' : ''}`}
                  onClick={(event) => {
                    onboardingMotion.run('select', event.currentTarget);
                    toggleInterest(tag.id);
                  }}
                  type="button"
                >
                  <span className="interest-emoji">{tag.emoji}</span>
                  <span className="interest-label">{tag.label}</span>
                </button>
              ))}
            </div>

            <div className="onboarding-actions">
              <button
                className="onboarding-btn primary"
                onClick={handleComplete}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <LoadingSpinner size={18} color="white" />
                    保存中...
                  </>
                ) : (
                  '完成'
                )}
              </button>
              <button
                className="onboarding-btn ghost"
                onClick={handleSkip}
                disabled={saving}
              >
                跳过
              </button>
            </div>
          </div>
        )}

        {/* Progress dots */}
        <div className="onboarding-progress">
          <span className={`dot ${step === 'welcome' ? 'active' : ''}`} />
          <span className={`dot ${step === 'profile' ? 'active' : ''}`} />
          <span className={`dot ${step === 'interests' ? 'active' : ''}`} />
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
