/**
 * 全局用户偏好设置 Store
 * 管理：界面密度、阅读字号、聊天发送快捷键、文档属性应用与本地缓存估算/清理
 */

import { create } from 'zustand';
import { THEME_STORAGE_KEY } from '../../core/theme/themeStore';

export type UiDensity = 'comfortable' | 'compact';
export type UiFontScale = 'normal' | 'large';
export type ChatSendKey = 'enter' | 'mod+enter';

export const USER_PREFERENCES_STORAGE_KEY = 'tg_user_preferences_v1';

export interface UserPreferencesSnapshot {
  density: UiDensity;
  fontScale: UiFontScale;
  sendKey: ChatSendKey;
}

export interface UserPreferencesState extends UserPreferencesSnapshot {
  setDensity: (density: UiDensity) => void;
  setFontScale: (fontScale: UiFontScale) => void;
  setSendKey: (sendKey: ChatSendKey) => void;
  resetPreferences: () => void;
}

export interface LocalCacheStats {
  entryCount: number;
  totalBytes: number;
  clearableCount: number;
  clearableBytes: number;
}

const DEFAULT_PREFERENCES: UserPreferencesSnapshot = {
  density: 'comfortable',
  fontScale: 'normal',
  sendKey: 'enter',
};

const PROTECTED_STORAGE_KEYS = new Set<string>([
  'accessToken',
  'refreshToken',
  'user',
  USER_PREFERENCES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  'tg_theme_mode',
]);

const TRACKED_CACHE_PREFIXES = ['tg_', 'tg:', 'space_', 'chat_'];

function isValidDensity(value: unknown): value is UiDensity {
  return value === 'comfortable' || value === 'compact';
}

function isValidFontScale(value: unknown): value is UiFontScale {
  return value === 'normal' || value === 'large';
}

function isValidSendKey(value: unknown): value is ChatSendKey {
  return value === 'enter' || value === 'mod+enter';
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredUserPreferences(): UserPreferencesSnapshot {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_PREFERENCES };
  try {
    const raw = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<UserPreferencesSnapshot>;
    return {
      density: isValidDensity(parsed.density) ? parsed.density : DEFAULT_PREFERENCES.density,
      fontScale: isValidFontScale(parsed.fontScale) ? parsed.fontScale : DEFAULT_PREFERENCES.fontScale,
      sendKey: isValidSendKey(parsed.sendKey) ? parsed.sendKey : DEFAULT_PREFERENCES.sendKey,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function persistUserPreferences(snapshot: UserPreferencesSnapshot): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 忽略浏览器隐私模式或配额限制异常
  }
}

/**
 * 将密度与字号偏好写入根文档 dataset 属性，供全局 CSS 语义令牌读取
 */
export function applyPreferencesToDocument(
  prefs?: Partial<UserPreferencesSnapshot>,
): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const current = useUserPreferencesStore.getState();
  const density = prefs?.density ?? current.density;
  const fontScale = prefs?.fontScale ?? current.fontScale;

  document.documentElement.dataset.density = density;
  document.documentElement.dataset.fontScale = fontScale;
}

function isTrackedCacheKey(key: string): boolean {
  return TRACKED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isClearableCacheKey(key: string): boolean {
  if (PROTECTED_STORAGE_KEYS.has(key)) return false;
  if (isTrackedCacheKey(key)) return true;
  if (key.startsWith('draft_') || key.startsWith('scroll_')) return true;
  return false;
}

/**
 * 估算当前本地缓存条目数量与字节占用（按 UTF-16 双字节粗算）
 */
export function estimateLocalCacheStats(): LocalCacheStats {
  const storage = getStorage();
  if (!storage) {
    return {
      entryCount: 0,
      totalBytes: 0,
      clearableCount: 0,
      clearableBytes: 0,
    };
  }

  let entryCount = 0;
  let totalBytes = 0;
  let clearableCount = 0;
  let clearableBytes = 0;

  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (!isTrackedCacheKey(key) && !isClearableCacheKey(key)) continue;

      const value = storage.getItem(key) || '';
      const bytes = (key.length + value.length) * 2;
      entryCount += 1;
      totalBytes += bytes;

      if (isClearableCacheKey(key)) {
        clearableCount += 1;
        clearableBytes += bytes;
      }
    }
  } catch {
    // 忽略存储访问异常
  }

  return {
    entryCount,
    totalBytes,
    clearableCount,
    clearableBytes,
  };
}

/**
 * 清理可回收业务缓存（严格保留认证凭据、用户主题与偏好设置）
 */
export function clearAppLocalCaches(): number {
  const storage = getStorage();
  if (!storage) return 0;

  const keysToRemove: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && isClearableCacheKey(key)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  } catch {
    return 0;
  }

  return keysToRemove.length;
}

const initialPrefs = readStoredUserPreferences();

export const useUserPreferencesStore = create<UserPreferencesState>((set, get) => ({
  ...initialPrefs,

  setDensity: (density) => {
    const next: UserPreferencesSnapshot = {
      density,
      fontScale: get().fontScale,
      sendKey: get().sendKey,
    };
    persistUserPreferences(next);
    applyPreferencesToDocument(next);
    set({ density });
  },

  setFontScale: (fontScale) => {
    const next: UserPreferencesSnapshot = {
      density: get().density,
      fontScale,
      sendKey: get().sendKey,
    };
    persistUserPreferences(next);
    applyPreferencesToDocument(next);
    set({ fontScale });
  },

  setSendKey: (sendKey) => {
    const next: UserPreferencesSnapshot = {
      density: get().density,
      fontScale: get().fontScale,
      sendKey,
    };
    persistUserPreferences(next);
    set({ sendKey });
  },

  resetPreferences: () => {
    const next = { ...DEFAULT_PREFERENCES };
    persistUserPreferences(next);
    applyPreferencesToDocument(next);
    set(next);
  },
}));
