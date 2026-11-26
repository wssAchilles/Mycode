import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  HardDrive,
  Keyboard,
  Monitor,
  Moon,
  RotateCcw,
  Settings,
  Sliders,
  Sun,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { authUtils } from '../../services/apiClient';
import { useThemeStore, type ThemeMode } from '../../core/theme/themeStore';
import { useChatUiPrefsStore } from '../../features/chat/state/chatUiPrefsStore';
import {
  clearAppLocalCaches,
  estimateLocalCacheStats,
  useUserPreferencesStore,
  type ChatSendKey,
  type LocalCacheStats,
  type UiDensity,
  type UiFontScale,
} from '../../features/preferences/userPreferencesStore';
import {
  playMessageChime,
  requestDesktopNotificationPermission,
} from '../../features/realtime/browserNotifier';
import { showToast } from '../ui/Toast';
import './PreferencesModal.css';

export const OPEN_PREFERENCES_MODAL_EVENT = 'tg:open-preferences';

/**
 * 触发打开统一偏好设置弹窗
 */
export function openPreferencesModal(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_PREFERENCES_MODAL_EVENT));
}

function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

export const PreferencesModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [cacheStats, setCacheStats] = useState<LocalCacheStats>(() => estimateLocalCacheStats());

  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  const density = useUserPreferencesStore((state) => state.density);
  const fontScale = useUserPreferencesStore((state) => state.fontScale);
  const sendKey = useUserPreferencesStore((state) => state.sendKey);
  const setDensity = useUserPreferencesStore((state) => state.setDensity);
  const setFontScale = useUserPreferencesStore((state) => state.setFontScale);
  const setSendKey = useUserPreferencesStore((state) => state.setSendKey);
  const resetPreferences = useUserPreferencesStore((state) => state.resetPreferences);

  const desktopNotifyEnabled = useChatUiPrefsStore((state) => state.desktopNotifyEnabled);
  const soundEnabled = useChatUiPrefsStore((state) => state.soundEnabled);
  const setDesktopNotifyEnabled = useChatUiPrefsStore((state) => state.setDesktopNotifyEnabled);
  const setSoundEnabled = useChatUiPrefsStore((state) => state.setSoundEnabled);

  const refreshCacheStats = useCallback(() => {
    setCacheStats(estimateLocalCacheStats());
  }, []);

  useEffect(() => {
    if (open) {
      refreshCacheStats();
    }
  }, [open, refreshCacheStats]);

  useEffect(() => {
    const handleOpenEvent = () => {
      if (!authUtils.isAuthenticated()) return;
      setOpen(true);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        if (!authUtils.isAuthenticated()) return;
        if (isEditableElement(event.target) && !open) return;
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener(OPEN_PREFERENCES_MODAL_EVENT, handleOpenEvent);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener(OPEN_PREFERENCES_MODAL_EVENT, handleOpenEvent);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!open) return null;

  const handleToggleDesktopNotify = async (next: boolean) => {
    if (next) {
      const permission = await requestDesktopNotificationPermission();
      if (permission === 'denied') {
        setDesktopNotifyEnabled(false);
        showToast('浏览器通知权限已被拒绝，请在地址栏权限设置中放行', 'error');
        return;
      }
      if (permission === 'unsupported') {
        setDesktopNotifyEnabled(false);
        showToast('当前环境不支持浏览器桌面通知', 'info');
        return;
      }
    }
    setDesktopNotifyEnabled(next);
    showToast(next ? '已开启桌面通知' : '已关闭桌面通知', 'info');
  };

  const handleTestSound = () => {
    playMessageChime();
    showToast('已播放新消息提示音', 'info');
  };

  const handleClearCaches = () => {
    const removedCount = clearAppLocalCaches();
    refreshCacheStats();
    if (removedCount > 0) {
      showToast(`已清理 ${removedCount} 项动态与草稿缓存（登录状态已保留）`, 'success');
    } else {
      showToast('当前没有需要清理的额外缓存', 'info');
    }
  };

  const handleResetDefaults = () => {
    resetPreferences();
    setThemeMode('light');
    showToast('外观与输入偏好已恢复默认', 'info');
  };

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: '浅色', icon: <Sun size={15} /> },
    { value: 'dark', label: '深色', icon: <Moon size={15} /> },
    { value: 'system', label: '跟随系统', icon: <Monitor size={15} /> },
  ];

  const densityOptions: Array<{ value: UiDensity; label: string; desc: string }> = [
    { value: 'comfortable', label: '舒适', desc: '默认留白，阅读轻松' },
    { value: 'compact', label: '紧凑', desc: '同屏展示更多对话与动态' },
  ];

  const fontScaleOptions: Array<{ value: UiFontScale; label: string }> = [
    { value: 'normal', label: '标准字号' },
    { value: 'large', label: '偏大字号' },
  ];

  const sendKeyOptions: Array<{ value: ChatSendKey; title: string; hint: string }> = [
    { value: 'enter', title: 'Enter 发送', hint: 'Shift + Enter 换行' },
    { value: 'mod+enter', title: '⌘ / Ctrl + Enter 发送', hint: 'Enter 直接换行，适合长文本编写' },
  ];

  return (
    <div
      className="tg-prefs-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tg-preferences-modal-title"
      onClick={() => setOpen(false)}
    >
      <div className="tg-prefs-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="tg-prefs-header">
          <div className="tg-prefs-header__title-wrap">
            <span className="tg-prefs-header__icon" aria-hidden="true">
              <Settings size={18} />
            </span>
            <div>
              <h2 id="tg-preferences-modal-title" className="tg-prefs-header__title">
                偏好设置
              </h2>
              <p className="tg-prefs-header__subtitle">
                全局视觉密度、发送键位、通知声音与本地存储管理（快捷键 ⌘/,）
              </p>
            </div>
          </div>
          <button
            type="button"
            className="tg-prefs-close-btn"
            onClick={() => setOpen(false)}
            aria-label="关闭偏好设置"
            title="关闭 (Esc)"
          >
            <X size={18} />
          </button>
        </header>

        <div className="tg-prefs-body">
          {/* 1. 外观与阅读 */}
          <section className="tg-prefs-section">
            <h3 className="tg-prefs-section__title">
              <Sliders size={15} />
              <span>外观与阅读</span>
            </h3>

            <div className="tg-prefs-row">
              <div className="tg-prefs-row__label">
                <strong>主题外观</strong>
                <span>选择浅色、深色或跟随系统时间自动切换</span>
              </div>
              <div className="tg-prefs-segmented" role="radiogroup" aria-label="主题外观">
                {themeOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={themeMode === item.value}
                    className={`tg-prefs-segment-btn ${themeMode === item.value ? 'is-active' : ''}`}
                    onClick={() => setThemeMode(item.value)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="tg-prefs-row">
              <div className="tg-prefs-row__label">
                <strong>界面信息密度</strong>
                <span>调整消息列表与 Space 卡片的内边距和行距</span>
              </div>
              <div className="tg-prefs-segmented" role="radiogroup" aria-label="界面信息密度">
                {densityOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={density === item.value}
                    className={`tg-prefs-segment-btn ${density === item.value ? 'is-active' : ''}`}
                    title={item.desc}
                    onClick={() => setDensity(item.value)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="tg-prefs-row">
              <div className="tg-prefs-row__label">
                <strong>阅读字号</strong>
                <span>仅温和放大对话与动态正文，保持界面结构稳定</span>
              </div>
              <div className="tg-prefs-segmented" role="radiogroup" aria-label="阅读字号">
                {fontScaleOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={fontScale === item.value}
                    className={`tg-prefs-segment-btn ${fontScale === item.value ? 'is-active' : ''}`}
                    onClick={() => setFontScale(item.value)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 2. 输入与发送 */}
          <section className="tg-prefs-section">
            <h3 className="tg-prefs-section__title">
              <Keyboard size={15} />
              <span>输入与发送</span>
            </h3>
            <div className="tg-prefs-choice-grid" role="radiogroup" aria-label="聊天发送快捷键">
              {sendKeyOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={sendKey === item.value}
                  className={`tg-prefs-choice-card ${sendKey === item.value ? 'is-active' : ''}`}
                  onClick={() => setSendKey(item.value)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {/* 3. 通知与提示音 */}
          <section className="tg-prefs-section">
            <h3 className="tg-prefs-section__title">
              <Bell size={15} />
              <span>通知与提示音</span>
            </h3>

            <div className="tg-prefs-row">
              <div className="tg-prefs-row__label">
                <strong>桌面系统通知</strong>
                <span>标签页不在前台时推送新消息系统横幅通知</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={desktopNotifyEnabled}
                className={`tg-prefs-switch ${desktopNotifyEnabled ? 'is-on' : ''}`}
                onClick={() => void handleToggleDesktopNotify(!desktopNotifyEnabled)}
              >
                <span className="tg-prefs-switch__thumb" />
              </button>
            </div>

            <div className="tg-prefs-row">
              <div className="tg-prefs-row__label">
                <strong>新消息提示音</strong>
                <span>收到未静音会话新消息时播放轻量双音提示</span>
              </div>
              <div className="tg-prefs-row__controls">
                <button
                  type="button"
                  className="tg-prefs-ghost-btn"
                  onClick={handleTestSound}
                  title="立即试听提示音"
                >
                  <Volume2 size={14} />
                  <span>试听</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundEnabled}
                  className={`tg-prefs-switch ${soundEnabled ? 'is-on' : ''}`}
                  onClick={() => {
                    setSoundEnabled(!soundEnabled);
                    showToast(!soundEnabled ? '已开启新消息提示音' : '已静音提示音', 'info');
                  }}
                >
                  <span className="tg-prefs-switch__thumb" />
                </button>
              </div>
            </div>
          </section>

          {/* 4. 本地缓存管理 */}
          <section className="tg-prefs-section">
            <h3 className="tg-prefs-section__title">
              <HardDrive size={15} />
              <span>本地缓存管理</span>
            </h3>

            <div className="tg-prefs-storage-card">
              <div className="tg-prefs-storage-meta">
                <strong>
                  可清理缓存：{cacheStats.clearableCount} 项（约 {formatBytesLabel(cacheStats.clearableBytes)}）
                </strong>
                <span>
                  总占用 {cacheStats.entryCount} 项 / {formatBytesLabel(cacheStats.totalBytes)}；清理不会退出账号登录，也不会重置你的设置。
                </span>
              </div>
              <button
                type="button"
                className="tg-prefs-danger-btn"
                onClick={handleClearCaches}
                disabled={cacheStats.clearableCount === 0}
              >
                <Trash2 size={14} />
                <span>清理动态与草稿缓存</span>
              </button>
            </div>
          </section>
        </div>

        <footer className="tg-prefs-footer">
          <button
            type="button"
            className="tg-prefs-ghost-btn"
            onClick={handleResetDefaults}
          >
            <RotateCcw size={14} />
            <span>恢复默认视觉设置</span>
          </button>
          <button
            type="button"
            className="tg-prefs-primary-btn"
            onClick={() => setOpen(false)}
          >
            完成
          </button>
        </footer>
      </div>
    </div>
  );
};

export default PreferencesModal;
