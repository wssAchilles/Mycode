import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tg:theme-mode';

function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isValidThemeMode(raw) ? raw : 'light';
  } catch {
    return 'light';
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark = getSystemPrefersDark()): ResolvedTheme {
  if (mode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return mode;
}

export function applyResolvedThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#0B1117' : '#FFFFFF');
  }
}

function persistThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 忽略隐私模式异常
  }
}

interface ThemeStoreState {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => ThemeMode;
  syncFromSystemOrStorage: () => void;
}

const initialMode = readStoredThemeMode();
const initialResolved = resolveTheme(initialMode);

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  mode: initialMode,
  resolvedTheme: initialResolved,

  setMode: (mode) => {
    persistThemeMode(mode);
    const resolved = resolveTheme(mode);
    applyResolvedThemeToDocument(resolved);
    set({ mode, resolvedTheme: resolved });
  },

  cycleMode: () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const current = get().mode;
    const next = order[(order.indexOf(current) + 1) % order.length];
    get().setMode(next);
    return next;
  },

  syncFromSystemOrStorage: () => {
    const mode = readStoredThemeMode();
    const resolved = resolveTheme(mode);
    applyResolvedThemeToDocument(resolved);
    set({ mode, resolvedTheme: resolved });
  },
}));

let cleanupThemeListeners: (() => void) | null = null;

/**
 * 在应用启动初期同步主题属性并绑定系统深浅色与多标签变更监听
 */
export function initThemeSync(): () => void {
  if (cleanupThemeListeners) {
    return cleanupThemeListeners;
  }

  const currentMode = readStoredThemeMode();
  const resolved = resolveTheme(currentMode);
  applyResolvedThemeToDocument(resolved);
  useThemeStore.setState({ mode: currentMode, resolvedTheme: resolved });

  if (typeof window === 'undefined') {
    return () => {};
  }

  const mql = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  const handleSystemChange = () => {
    const state = useThemeStore.getState();
    if (state.mode === 'system') {
      const nextResolved = resolveTheme('system', mql?.matches ?? false);
      applyResolvedThemeToDocument(nextResolved);
      useThemeStore.setState({ resolvedTheme: nextResolved });
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      useThemeStore.getState().syncFromSystemOrStorage();
    }
  };

  mql?.addEventListener?.('change', handleSystemChange);
  window.addEventListener('storage', handleStorage);

  cleanupThemeListeners = () => {
    mql?.removeEventListener?.('change', handleSystemChange);
    window.removeEventListener('storage', handleStorage);
    cleanupThemeListeners = null;
  };

  return cleanupThemeListeners;
}

export function formatThemeModeLabel(mode: ThemeMode): string {
  if (mode === 'light') return '浅色模式';
  if (mode === 'dark') return '深色模式';
  return '跟随系统';
}
