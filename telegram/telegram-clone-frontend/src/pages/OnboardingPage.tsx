import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  Check,
  ChevronLeft,
  Cpu,
  Film,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Microscope,
  Music,
  Newspaper,
  Palette,
  PawPrint,
  Plane,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Utensils,
} from 'lucide-react';
import { authAPI, authUtils } from '../services/apiClient';
import { spaceAPI, type RecommendedUser } from '../services/spaceApi';
import { detectCountryCode, detectLanguageCode, COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from '../utils/locale';
import { LoadingSpinner } from '../components/ui/Icons';
import { showToast } from '../components/ui/Toast';
import { Avatar } from '../components/common';
import {
  limitedMotionItems,
  motionDurations,
  motionStaggers,
  stagger,
  useAnimeScope,
  waapi,
} from '../core/animation';
import './OnboardingPage.css';

type OnboardingStep = 'welcome' | 'profile' | 'interests' | 'creators';

/** 预置兴趣标签（统一使用 Lucide 矢量图标，替代系统 Emoji） */
const INTEREST_TAGS = [
  { id: 'tech', label: '科技', Icon: Cpu },
  { id: 'news', label: '新闻', Icon: Newspaper },
  { id: 'sports', label: '体育', Icon: Trophy },
  { id: 'music', label: '音乐', Icon: Music },
  { id: 'gaming', label: '游戏', Icon: Gamepad2 },
  { id: 'food', label: '美食', Icon: Utensils },
  { id: 'travel', label: '旅行', Icon: Plane },
  { id: 'movies', label: '电影', Icon: Film },
  { id: 'science', label: '科学', Icon: Microscope },
  { id: 'finance', label: '财经', Icon: TrendingUp },
  { id: 'health', label: '健康', Icon: HeartPulse },
  { id: 'art', label: '艺术', Icon: Palette },
  { id: 'education', label: '教育', Icon: GraduationCap },
  { id: 'photography', label: '摄影', Icon: Camera },
  { id: 'fashion', label: '潮流', Icon: Sparkles },
  { id: 'pets', label: '宠物', Icon: PawPrint },
];

const STEPS_ORDER: OnboardingStep[] = ['welcome', 'profile', 'interests', 'creators'];

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [region, setRegion] = useState(detectCountryCode() || '');
  const [language, setLanguage] = useState(detectLanguageCode() || '');
  const [birthDate, setBirthDate] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [recommendedCreators, setRecommendedCreators] = useState<RecommendedUser[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [followingCreatorIds, setFollowingCreatorIds] = useState<Set<string>>(new Set());
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

  const loadCreators = useCallback(async () => {
    setLoadingCreators(true);
    try {
      const users = await spaceAPI.getRecommendedUsers(6);
      setRecommendedCreators(users);
      setFollowingCreatorIds(new Set(users.filter((u) => u.isFollowed).map((u) => u.id)));
    } catch {
      setRecommendedCreators([]);
    } finally {
      setLoadingCreators(false);
    }
  }, []);

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

  const handleSaveProfileAndInterests = async (): Promise<boolean> => {
    setSaving(true);
    setError('');
    try {
      const payload: {
        birthDate?: string;
        region?: string;
        language?: string;
        interests?: string[];
      } = {};
      if (region) payload.region = region;
      if (language) payload.language = language;
      if (birthDate) payload.birthDate = birthDate;
      if (selectedInterests.size > 0) {
        payload.interests = Array.from(selectedInterests);
      }

      if (Object.keys(payload).length > 0) {
        await authAPI.updateProfile(payload);
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存资料失败';
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleEnterCreatorsStep = async () => {
    const ok = await handleSaveProfileAndInterests();
    if (!ok) return;
    if (selectedInterests.size > 0) {
      localStorage.setItem('onboarding_interests', JSON.stringify([...selectedInterests]));
    }
    setStep('creators');
    void loadCreators();
  };

  const handleToggleCreatorFollow = async (creator: RecommendedUser) => {
    const currentlyFollowed = followingCreatorIds.has(creator.id);
    setFollowingCreatorIds((prev) => {
      const next = new Set(prev);
      if (currentlyFollowed) next.delete(creator.id);
      else next.add(creator.id);
      return next;
    });
    try {
      if (currentlyFollowed) {
        await spaceAPI.unfollowUser(creator.id);
      } else {
        await spaceAPI.followUser(creator.id);
      }
    } catch {
      setFollowingCreatorIds((prev) => {
        const next = new Set(prev);
        if (currentlyFollowed) next.add(creator.id);
        else next.delete(creator.id);
        return next;
      });
      showToast('关注操作失败，请稍后重试', 'error');
    }
  };

  const handleFollowAllCreators = async () => {
    const targets = recommendedCreators.filter((c) => !followingCreatorIds.has(c.id));
    if (targets.length === 0) return;
    setSaving(true);
    try {
      await Promise.allSettled(targets.map((c) => spaceAPI.followUser(c.id)));
      setFollowingCreatorIds(new Set(recommendedCreators.map((c) => c.id)));
      showToast(`已关注 ${targets.length} 位精选创作者`, 'success');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
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
        {/* 步骤一：欢迎引导 */}
        {step === 'welcome' && (
          <div className="onboarding-step">
            <div className="onboarding-hero">
              <div className="onboarding-logo" aria-hidden="true">
                <Sparkles size={26} />
              </div>
              <h1>欢迎加入</h1>
              <p className="onboarding-subtitle">
                只需一分钟完成偏好配置，即时生成契合你兴趣的首页推荐与关系网络
              </p>
            </div>
            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-btn primary"
                onClick={() => setStep('profile')}
              >
                开始设置
              </button>
              <button
                type="button"
                className="onboarding-btn ghost"
                onClick={handleSkip}
              >
                跳过，直接进入 Space
              </button>
            </div>
          </div>
        )}

        {/* 步骤二：基本资料 */}
        {step === 'profile' && (
          <div className="onboarding-step">
            <div className="onboarding-header">
              <button
                type="button"
                className="onboarding-back-link"
                onClick={() => setStep('welcome')}
                disabled={saving}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                <span>上一步</span>
              </button>
              <h2>基本资料</h2>
              <p>用于本地化时区、语种及冷启动内容匹配</p>
            </div>

            {error && (
              <div className="onboarding-error" role="alert">
                {error}
              </div>
            )}

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
                <span className="onboarding-hint">需年满 13 周岁</span>
              </div>
            </div>

            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-btn primary"
                onClick={() => setStep('interests')}
                disabled={saving}
              >
                下一步：选择兴趣
              </button>
              <button
                type="button"
                className="onboarding-btn ghost"
                onClick={() => setStep('interests')}
              >
                跳过此步
              </button>
            </div>
          </div>
        )}

        {/* 步骤三：兴趣标签选择（同步写回推荐系统冷启动画像） */}
        {step === 'interests' && (
          <div className="onboarding-step">
            <div className="onboarding-header">
              <button
                type="button"
                className="onboarding-back-link"
                onClick={() => setStep('profile')}
                disabled={saving}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                <span>上一步</span>
              </button>
              <h2>选择你的兴趣</h2>
              <p>已选 {selectedInterests.size} 个领域，将实时同步至推荐算法画像</p>
            </div>

            {error && (
              <div className="onboarding-error" role="alert">
                {error}
              </div>
            )}

            <div className="interest-grid">
              {INTEREST_TAGS.map(({ id, label, Icon }) => {
                const isSelected = selectedInterests.has(id);
                return (
                  <button
                    key={id}
                    className={`interest-tag ${isSelected ? 'selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      onboardingMotion.run('select', event.currentTarget);
                      toggleInterest(id);
                    }}
                    type="button"
                  >
                    <span className="interest-icon" aria-hidden="true">
                      <Icon size={20} strokeWidth={2} />
                    </span>
                    <span className="interest-label">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-btn primary"
                onClick={() => void handleEnterCreatorsStep()}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <LoadingSpinner size={18} color="#FFFFFF" />
                    正在同步画像...
                  </>
                ) : (
                  '下一步：发现精选创作者'
                )}
              </button>
              <button
                type="button"
                className="onboarding-btn ghost"
                onClick={() => {
                  setStep('creators');
                  void loadCreators();
                }}
                disabled={saving}
              >
                跳过此步
              </button>
            </div>
          </div>
        )}

        {/* 步骤四：一键推荐关注创作者 */}
        {step === 'creators' && (
          <div className="onboarding-step">
            <div className="onboarding-header">
              <button
                type="button"
                className="onboarding-back-link"
                onClick={() => setStep('interests')}
                disabled={saving}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                <span>上一步</span>
              </button>
              <h2>关注感兴趣的创作者</h2>
              <p>点亮首批好友动态流，进入 Space 即可看到他们的实时更新</p>
            </div>

            <div className="onboarding-creators-list">
              {loadingCreators ? (
                <div className="onboarding-creators-loading">
                  <LoadingSpinner size={22} color="#1D9BF0" />
                  <span>正在为你匹配活跃创作者...</span>
                </div>
              ) : recommendedCreators.length === 0 ? (
                <div className="onboarding-creators-empty">
                  暂无可推荐的创作者，可直接进入 Space 探索。
                </div>
              ) : (
                recommendedCreators.map((creator) => {
                  const isFollowed = followingCreatorIds.has(creator.id);
                  return (
                    <div key={creator.id} className="onboarding-creator-row">
                      <Avatar
                        name={creator.username}
                        src={creator.avatarUrl || undefined}
                        size="md"
                        online={Boolean(creator.isOnline)}
                      />
                      <div className="onboarding-creator-info">
                        <div className="onboarding-creator-name">{creator.username}</div>
                        <div className="onboarding-creator-reason">
                          {creator.reason || '社区活跃创作者'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`onboarding-creator-follow ${isFollowed ? 'is-followed' : ''}`}
                        onClick={() => void handleToggleCreatorFollow(creator)}
                      >
                        {isFollowed ? <Check size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
                        <span>{isFollowed ? '已关注' : '关注'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="onboarding-actions">
              {recommendedCreators.some((c) => !followingCreatorIds.has(c.id)) && (
                <button
                  type="button"
                  className="onboarding-btn ghost"
                  onClick={() => void handleFollowAllCreators()}
                  disabled={saving}
                >
                  <UserPlus size={16} aria-hidden="true" />
                  <span>一键关注以上全部创作者</span>
                </button>
              )}
              <button
                type="button"
                className="onboarding-btn primary"
                onClick={() => void handleComplete()}
                disabled={saving}
              >
                进入 Space
              </button>
            </div>
          </div>
        )}

        {/* 引导进度指示点 */}
        <div className="onboarding-progress" aria-label="引导步骤进度">
          {STEPS_ORDER.map((stepKey) => (
            <span key={stepKey} className={`dot ${step === stepKey ? 'active' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
