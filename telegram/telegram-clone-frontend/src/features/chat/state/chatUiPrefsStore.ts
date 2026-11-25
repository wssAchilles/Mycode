/**
 * 聊天界面轻量偏好与草稿持久化 Store
 * 按 userId 分区存储在 localStorage 中，避免多账号测试串态：
 * - 各会话消息草稿（draftByChatId）
 * - 置顶会话集合（pinnedChatIds）
 * - 免打扰会话集合（mutedChatIds）
 * - 桌面通知与提示音开关
 */

import { create } from 'zustand';

interface PersistedChatUiPrefs {
  draftByChatId: Record<string, string>;
  pinnedChatIds: string[];
  mutedChatIds: string[];
  desktopNotifyEnabled: boolean;
  soundEnabled: boolean;
}

export interface ChatUiPrefsState extends PersistedChatUiPrefs {
  currentUserId: string | null;
  hydrateForUser: (userId: string | null | undefined) => void;
  resetPrefs: () => void;
  setDraft: (chatId: string, content: string) => void;
  clearDraft: (chatId: string) => void;
  togglePinChat: (chatId: string) => boolean;
  toggleMuteChat: (chatId: string) => boolean;
  setDesktopNotifyEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

const STORAGE_PREFIX = 'tg_chat_ui_prefs:v1:';
const MAX_DRAFT_ENTRIES = 120;

const DEFAULT_PREFS: PersistedChatUiPrefs = {
  draftByChatId: {},
  pinnedChatIds: [],
  mutedChatIds: [],
  desktopNotifyEnabled: false,
  soundEnabled: true,
};

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedPrefs(userId: string): PersistedChatUiPrefs {
  const storage = getStorage();
  if (!storage || !userId) return { ...DEFAULT_PREFS, draftByChatId: {}, pinnedChatIds: [], mutedChatIds: [] };
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_PREFS, draftByChatId: {}, pinnedChatIds: [], mutedChatIds: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedChatUiPrefs>;
    return {
      draftByChatId:
        parsed.draftByChatId && typeof parsed.draftByChatId === 'object'
          ? { ...parsed.draftByChatId }
          : {},
      pinnedChatIds: Array.isArray(parsed.pinnedChatIds)
        ? parsed.pinnedChatIds.map(String).filter(Boolean)
        : [],
      mutedChatIds: Array.isArray(parsed.mutedChatIds)
        ? parsed.mutedChatIds.map(String).filter(Boolean)
        : [],
      desktopNotifyEnabled: Boolean(parsed.desktopNotifyEnabled),
      soundEnabled: parsed.soundEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS, draftByChatId: {}, pinnedChatIds: [], mutedChatIds: [] };
  }
}

function writePersistedPrefs(userId: string | null, prefs: PersistedChatUiPrefs): void {
  const storage = getStorage();
  if (!storage || !userId) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(prefs));
  } catch {
    // 忽略浏览器隐身/配额异常
  }
}

function pickPersisted(state: ChatUiPrefsState): PersistedChatUiPrefs {
  return {
    draftByChatId: state.draftByChatId,
    pinnedChatIds: state.pinnedChatIds,
    mutedChatIds: state.mutedChatIds,
    desktopNotifyEnabled: state.desktopNotifyEnabled,
    soundEnabled: state.soundEnabled,
  };
}

export const useChatUiPrefsStore = create<ChatUiPrefsState>((set, get) => ({
  currentUserId: null,
  ...DEFAULT_PREFS,

  hydrateForUser: (userId) => {
    const cleanId = userId ? String(userId).trim() : '';
    if (!cleanId) {
      get().resetPrefs();
      return;
    }
    if (get().currentUserId === cleanId) return;
    const loaded = readPersistedPrefs(cleanId);
    set({
      currentUserId: cleanId,
      ...loaded,
    });
  },

  resetPrefs: () => {
    set({
      currentUserId: null,
      draftByChatId: {},
      pinnedChatIds: [],
      mutedChatIds: [],
      desktopNotifyEnabled: false,
      soundEnabled: true,
    });
  },

  setDraft: (chatId, content) => {
    const cleanChatId = String(chatId || '').trim();
    if (!cleanChatId) return;

    set((state) => {
      const hasText = content.trim().length > 0;
      const nextDrafts = { ...state.draftByChatId };
      if (!hasText) {
        if (!(cleanChatId in nextDrafts)) return state;
        delete nextDrafts[cleanChatId];
      } else {
        if (nextDrafts[cleanChatId] === content) return state;
        nextDrafts[cleanChatId] = content;
        const keys = Object.keys(nextDrafts);
        if (keys.length > MAX_DRAFT_ENTRIES) {
          delete nextDrafts[keys[0]];
        }
      }

      const nextState = { ...state, draftByChatId: nextDrafts };
      writePersistedPrefs(state.currentUserId, pickPersisted(nextState));
      return { draftByChatId: nextDrafts };
    });
  },

  clearDraft: (chatId) => {
    get().setDraft(chatId, '');
  },

  togglePinChat: (chatId) => {
    const cleanChatId = String(chatId || '').trim();
    if (!cleanChatId) return false;
    let isNowPinned = false;

    set((state) => {
      const exists = state.pinnedChatIds.includes(cleanChatId);
      const nextPinned = exists
        ? state.pinnedChatIds.filter((id) => id !== cleanChatId)
        : [cleanChatId, ...state.pinnedChatIds];
      isNowPinned = !exists;
      const nextState = { ...state, pinnedChatIds: nextPinned };
      writePersistedPrefs(state.currentUserId, pickPersisted(nextState));
      return { pinnedChatIds: nextPinned };
    });

    return isNowPinned;
  },

  toggleMuteChat: (chatId) => {
    const cleanChatId = String(chatId || '').trim();
    if (!cleanChatId) return false;
    let isNowMuted = false;

    set((state) => {
      const exists = state.mutedChatIds.includes(cleanChatId);
      const nextMuted = exists
        ? state.mutedChatIds.filter((id) => id !== cleanChatId)
        : [...state.mutedChatIds, cleanChatId];
      isNowMuted = !exists;
      const nextState = { ...state, mutedChatIds: nextMuted };
      writePersistedPrefs(state.currentUserId, pickPersisted(nextState));
      return { mutedChatIds: nextMuted };
    });

    return isNowMuted;
  },

  setDesktopNotifyEnabled: (enabled) => {
    set((state) => {
      const nextState = { ...state, desktopNotifyEnabled: enabled };
      writePersistedPrefs(state.currentUserId, pickPersisted(nextState));
      return { desktopNotifyEnabled: enabled };
    });
  },

  setSoundEnabled: (enabled) => {
    set((state) => {
      const nextState = { ...state, soundEnabled: enabled };
      writePersistedPrefs(state.currentUserId, pickPersisted(nextState));
      return { soundEnabled: enabled };
    });
  },
}));
