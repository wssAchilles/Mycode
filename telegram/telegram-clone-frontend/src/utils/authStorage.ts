import type { User } from '../types/auth';

/**
 * Auth storage strategy
 *
 * Goal: allow multiple accounts in different tabs (sessionStorage isolation),
 * while keeping a best-effort "last login" in localStorage for convenience.
 */
const isBrowser = typeof window !== 'undefined';

const PRIMARY: Storage | null = isBrowser ? window.sessionStorage : null;
const SECONDARY: Storage | null = isBrowser ? window.localStorage : null;

const KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  user: 'user',
} as const;

const read = (key: string): string | null => {
  if (!isBrowser || !PRIMARY) return null;
  const v = PRIMARY.getItem(key);
  if (v != null) return v;
  if (!SECONDARY) return null;
  const v2 = SECONDARY.getItem(key);
  if (v2 != null) {
    // Migrate/copy into this tab's session for isolation.
    try {
      PRIMARY.setItem(key, v2);
    } catch {
      // ignore
    }
  }
  return v2;
};

const write = (key: string, value: string) => {
  if (!isBrowser || !PRIMARY) return;
  try {
    PRIMARY.setItem(key, value);
  } catch {
    // ignore
  }
  // Keep a best-effort last login snapshot for new tabs.
  if (SECONDARY) {
    try {
      SECONDARY.setItem(key, value);
    } catch {
      // ignore
    }
  }
};

const remove = (key: string) => {
  if (!isBrowser || !PRIMARY) return;
  try {
    PRIMARY.removeItem(key);
  } catch {
    // ignore
  }
  if (SECONDARY) {
    try {
      SECONDARY.removeItem(key);
    } catch {
      // ignore
    }
  }
};

export const authStorage = {
  getAccessToken(): string | null {
    return read(KEYS.accessToken);
  },
  getRefreshToken(): string | null {
    return read(KEYS.refreshToken);
  },
  getUser(): User | null {
    const raw = read(KEYS.user);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  },
  setTokens(accessToken: string, refreshToken: string) {
    write(KEYS.accessToken, accessToken);
    write(KEYS.refreshToken, refreshToken);
  },
  setUser(user: User | null) {
    if (!user) {
      remove(KEYS.user);
      return;
    }
    write(KEYS.user, JSON.stringify(user));
  },
  clear() {
    remove(KEYS.accessToken);
    remove(KEYS.refreshToken);
    remove(KEYS.user);
  },
};

