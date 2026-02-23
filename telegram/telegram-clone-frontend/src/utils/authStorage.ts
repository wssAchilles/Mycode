import type { User } from '../types/auth';

/**
 * Auth storage strategy
 *
 * Goal: allow multiple accounts in different tabs (sessionStorage isolation),
 * while keeping a safe best-effort "last login" snapshot in localStorage.
 *
 * IMPORTANT:
 * Never mix user/token fields across accounts. We always validate snapshot
 * consistency (JWT identity vs user object) before exposing auth state.
 */
const isBrowser = typeof window !== 'undefined';

const PRIMARY: Storage | null = isBrowser ? window.sessionStorage : null;
const SECONDARY: Storage | null = isBrowser ? window.localStorage : null;
const SNAPSHOT_KEY = 'authSnapshot:v2';

const KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  user: 'user',
} as const;

type AuthSnapshot = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

type TokenIdentity = {
  userId?: string;
  username?: string;
};

const decodeBase64Url = (input: string): string | null => {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    if (typeof atob === 'function') {
      return atob(padded);
    }
    const maybeBuffer = (globalThis as any).Buffer;
    if (maybeBuffer) {
      return maybeBuffer.from(padded, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
};

const parseTokenIdentity = (token: string | null): TokenIdentity | null => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const rawPayload = decodeBase64Url(parts[1]);
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload) as Record<string, unknown>;
    const userId = typeof payload.userId === 'string' ? payload.userId : undefined;
    const username = typeof payload.username === 'string' ? payload.username : undefined;
    if (!userId && !username) return null;
    return { userId, username };
  } catch {
    return null;
  }
};

const parseUser = (raw: string | null): User | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

const isUserTokenConsistent = (snapshot: AuthSnapshot): boolean => {
  const identity = parseTokenIdentity(snapshot.accessToken) || parseTokenIdentity(snapshot.refreshToken);
  if (!identity) return true;

  if (identity.userId && snapshot.user.id && identity.userId !== snapshot.user.id) {
    return false;
  }

  if (identity.username && snapshot.user.username) {
    if (identity.username.toLowerCase() !== snapshot.user.username.toLowerCase()) {
      return false;
    }
  }

  return true;
};

const clearPrimary = () => {
  if (!PRIMARY) return;
  try {
    PRIMARY.removeItem(KEYS.accessToken);
    PRIMARY.removeItem(KEYS.refreshToken);
    PRIMARY.removeItem(KEYS.user);
  } catch {
    // ignore
  }
};

const clearSecondary = () => {
  if (!SECONDARY) return;
  try {
    SECONDARY.removeItem(KEYS.accessToken);
    SECONDARY.removeItem(KEYS.refreshToken);
    SECONDARY.removeItem(KEYS.user);
    SECONDARY.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
};

const readPrimarySnapshot = (): AuthSnapshot | null => {
  if (!PRIMARY) return null;
  const accessToken = PRIMARY.getItem(KEYS.accessToken);
  const refreshToken = PRIMARY.getItem(KEYS.refreshToken);
  const userRaw = PRIMARY.getItem(KEYS.user);

  if (!accessToken && !refreshToken && !userRaw) return null;
  if (!accessToken || !refreshToken || !userRaw) return null;

  const user = parseUser(userRaw);
  if (!user) return null;

  return { accessToken, refreshToken, user };
};

const readSecondarySnapshot = (): AuthSnapshot | null => {
  if (!SECONDARY) return null;

  // Preferred path: atomic snapshot.
  const rawSnapshot = SECONDARY.getItem(SNAPSHOT_KEY);
  if (rawSnapshot) {
    try {
      const parsed = JSON.parse(rawSnapshot) as Partial<AuthSnapshot>;
      if (
        typeof parsed.accessToken === 'string' &&
        typeof parsed.refreshToken === 'string' &&
        parsed.user &&
        typeof parsed.user === 'object'
      ) {
        return {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          user: parsed.user as User,
        };
      }
    } catch {
      // ignore and try legacy keys
    }
  }

  // Legacy path: three independent keys (may be stale/mixed).
  const accessToken = SECONDARY.getItem(KEYS.accessToken);
  const refreshToken = SECONDARY.getItem(KEYS.refreshToken);
  const userRaw = SECONDARY.getItem(KEYS.user);
  if (!accessToken || !refreshToken || !userRaw) return null;
  const user = parseUser(userRaw);
  if (!user) return null;
  return { accessToken, refreshToken, user };
};

const writePrimarySnapshot = (snapshot: AuthSnapshot) => {
  if (!PRIMARY) return;
  try {
    PRIMARY.setItem(KEYS.accessToken, snapshot.accessToken);
    PRIMARY.setItem(KEYS.refreshToken, snapshot.refreshToken);
    PRIMARY.setItem(KEYS.user, JSON.stringify(snapshot.user));
  } catch {
    // ignore
  }
};

const persistSecondaryFromPrimary = () => {
  if (!SECONDARY) return;
  const snapshot = readPrimarySnapshot();
  if (!snapshot) return;
  if (!isUserTokenConsistent(snapshot)) {
    clearPrimary();
    clearSecondary();
    return;
  }

  if (SECONDARY) {
    try {
      SECONDARY.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
      // Keep legacy keys for compatibility with old code paths.
      SECONDARY.setItem(KEYS.accessToken, snapshot.accessToken);
      SECONDARY.setItem(KEYS.refreshToken, snapshot.refreshToken);
      SECONDARY.setItem(KEYS.user, JSON.stringify(snapshot.user));
    } catch {
      // ignore
    }
  }
};

const resolveSnapshot = (): AuthSnapshot | null => {
  if (!isBrowser || !PRIMARY) return null;

  const primary = readPrimarySnapshot();
  if (primary && isUserTokenConsistent(primary)) {
    return primary;
  }

  const secondary = readSecondarySnapshot();
  if (secondary && isUserTokenConsistent(secondary)) {
    writePrimarySnapshot(secondary);
    return secondary;
  }

  // Corrupted/mixed auth state must be hard-reset.
  clearPrimary();
  clearSecondary();
  return null;
};

export const authStorage = {
  getAccessToken(): string | null {
    return resolveSnapshot()?.accessToken ?? null;
  },
  getRefreshToken(): string | null {
    return resolveSnapshot()?.refreshToken ?? null;
  },
  getUser(): User | null {
    return resolveSnapshot()?.user ?? null;
  },
  setTokens(accessToken: string, refreshToken: string) {
    if (!isBrowser || !PRIMARY) return;
    try {
      PRIMARY.setItem(KEYS.accessToken, accessToken);
      PRIMARY.setItem(KEYS.refreshToken, refreshToken);
    } catch {
      // ignore
    }
    persistSecondaryFromPrimary();
  },
  setUser(user: User | null) {
    if (!isBrowser || !PRIMARY) return;
    if (!user) {
      try {
        PRIMARY.removeItem(KEYS.user);
      } catch {
        // ignore
      }
      // Keep behavior deterministic: user removal means not authenticated.
      if (SECONDARY) {
        try {
          SECONDARY.removeItem(KEYS.user);
          SECONDARY.removeItem(SNAPSHOT_KEY);
        } catch {
          // ignore
        }
      }
      return;
    }
    try {
      PRIMARY.setItem(KEYS.user, JSON.stringify(user));
    } catch {
      // ignore
    }
    persistSecondaryFromPrimary();
  },
  clear() {
    clearPrimary();
    clearSecondary();
  },
};
