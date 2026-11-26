import { beforeEach, describe, expect, it } from 'vitest';
import {
  USER_PREFERENCES_STORAGE_KEY,
  applyPreferencesToDocument,
  clearAppLocalCaches,
  estimateLocalCacheStats,
  useUserPreferencesStore,
} from './userPreferencesStore';
import { THEME_STORAGE_KEY } from '../../core/theme/themeStore';
import { extractFirstPreviewableUrl } from '../../components/common/LinkPreviewCard';

describe('Wave 4 User Preferences & Link Extraction', () => {
  beforeEach(() => {
    localStorage.clear();
    useUserPreferencesStore.getState().resetPreferences();
  });

  it('persists density, fontScale, and sendKey and updates document dataset attributes', () => {
    const store = useUserPreferencesStore.getState();
    store.setDensity('compact');
    store.setFontScale('large');
    store.setSendKey('mod+enter');

    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.dataset.fontScale).toBe('large');

    const raw = localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      density: 'compact',
      fontScale: 'large',
      sendKey: 'mod+enter',
    });

    store.resetPreferences();
    applyPreferencesToDocument();
    expect(document.documentElement.dataset.density).toBe('comfortable');
    expect(document.documentElement.dataset.fontScale).toBe('normal');
  });

  it('clears app caches while strictly preserving auth tokens and user preferences', () => {
    localStorage.setItem('accessToken', 'jwt-access-token');
    localStorage.setItem('refreshToken', 'jwt-refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'u-1', username: 'alice' }));
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    useUserPreferencesStore.getState().setDensity('compact');

    localStorage.setItem('space_feed_snapshot_v1', 'cached-feed');
    localStorage.setItem('tg_chat_scroll_v1', 'cached-scroll');

    const before = estimateLocalCacheStats();
    expect(before.clearableCount).toBe(2);

    const removed = clearAppLocalCaches();
    expect(removed).toBe(2);

    expect(localStorage.getItem('accessToken')).toBe('jwt-access-token');
    expect(localStorage.getItem('refreshToken')).toBe('jwt-refresh-token');
    expect(localStorage.getItem('user')).toContain('alice');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)).toContain('compact');
    expect(localStorage.getItem('space_feed_snapshot_v1')).toBeNull();
    expect(localStorage.getItem('tg_chat_scroll_v1')).toBeNull();
  });

  it('extracts valid external URLs and strips trailing punctuation', () => {
    expect(extractFirstPreviewableUrl('推荐阅读 https://openai.com/research，非常清晰！')).toBe(
      'https://openai.com/research',
    );
    expect(extractFirstPreviewableUrl('看看 http://localhost:5173/space 吧')).toBeNull();
    expect(extractFirstPreviewableUrl('附件 https://cdn.example.com/api/uploads/test.png')).toBeNull();
    expect(extractFirstPreviewableUrl('纯文本没有链接')).toBeNull();
  });
});
