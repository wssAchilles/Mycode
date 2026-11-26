import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  initThemeSync,
  resolveTheme,
  useThemeStore,
} from '../core/theme/themeStore';

describe('Wave 5 主题状态与系统同步', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    useThemeStore.setState({ mode: 'light', resolvedTheme: 'light' });
  });

  it('setMode 能持久化到 localStorage 并同步 DOM data-theme 与 .dark', () => {
    useThemeStore.getState().setMode('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    const next = useThemeStore.getState().cycleMode();
    expect(next).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('system 模式能跟随 prefers-color-scheme 变化实时切换', () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null;
    const mockMql = {
      matches: true,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    };
    const matchMediaSpy = vi
      .spyOn(window, 'matchMedia')
      .mockReturnValue(mockMql as unknown as MediaQueryList);

    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const cleanup = initThemeSync();

    expect(useThemeStore.getState().mode).toBe('system');
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    mockMql.matches = false;
    listener?.({ matches: false } as MediaQueryListEvent);

    expect(useThemeStore.getState().resolvedTheme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    expect(resolveTheme('system', true)).toBe('dark');
    cleanup();
    matchMediaSpy.mockRestore();
  });
});
