import { create } from 'zustand';

/**
 * 单条正在输入状态记录
 */
export interface TypingUserEntry {
  userId: string;
  username: string;
  expiresAt: number;
}

interface TypingState {
  // 键统一使用列表会话 ID（私聊为对方 userId，群聊为 groupId）
  byChatId: Record<string, TypingUserEntry[]>;
  setTyping: (chatId: string, userId: string, username: string, isTyping: boolean, now?: number) => void;
  pruneExpired: (now?: number) => void;
  clearChatTyping: (chatId: string) => void;
  clearAll: () => void;
}

const TYPING_TTL_MS = 5000;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCleanup() {
  if (typeof globalThis.setTimeout !== 'function') return;
  if (expiryTimer !== null) {
    globalThis.clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  const state = useTypingStore.getState();
  const now = Date.now();
  let earliestExpiry = Infinity;

  for (const entries of Object.values(state.byChatId)) {
    for (const entry of entries) {
      if (entry.expiresAt < earliestExpiry) {
        earliestExpiry = entry.expiresAt;
      }
    }
  }

  if (!Number.isFinite(earliestExpiry)) return;
  const delay = Math.max(80, earliestExpiry - now + 30);
  expiryTimer = globalThis.setTimeout(() => {
    expiryTimer = null;
    useTypingStore.getState().pruneExpired(Date.now());
  }, delay);
}

/**
 * 格式化输入状态指示文案
 */
export function formatTypingSummary(entries: TypingUserEntry[] | undefined, isGroup: boolean): string {
  if (!entries || entries.length === 0) return '';
  if (!isGroup) return '对方正在输入…';
  if (entries.length === 1) return `${entries[0].username || '有人'} 正在输入…`;
  return `${entries[0].username || '多人'} 等 ${entries.length} 人正在输入…`;
}

export const useTypingStore = create<TypingState>((set) => ({
  byChatId: {},

  setTyping: (chatId, userId, username, isTyping, now = Date.now()) => {
    if (!chatId || !userId) return;

    set((state) => {
      const current = (state.byChatId[chatId] || []).filter(
        (entry) => entry.expiresAt > now && entry.userId !== userId,
      );

      if (isTyping) {
        current.push({
          userId,
          username: username || '对方',
          expiresAt: now + TYPING_TTL_MS,
        });
      }

      const nextByChatId = { ...state.byChatId };
      if (current.length > 0) {
        nextByChatId[chatId] = current;
      } else {
        delete nextByChatId[chatId];
      }
      return { byChatId: nextByChatId };
    });

    scheduleCleanup();
  },

  pruneExpired: (now = Date.now()) => {
    set((state) => {
      let changed = false;
      const nextByChatId: Record<string, TypingUserEntry[]> = {};

      for (const [chatId, entries] of Object.entries(state.byChatId)) {
        const alive = entries.filter((entry) => entry.expiresAt > now);
        if (alive.length !== entries.length) changed = true;
        if (alive.length > 0) {
          nextByChatId[chatId] = alive;
        }
      }

      return changed ? { byChatId: nextByChatId } : state;
    });

    scheduleCleanup();
  },

  clearChatTyping: (chatId) => {
    if (!chatId) return;
    set((state) => {
      if (!state.byChatId[chatId]) return state;
      const nextByChatId = { ...state.byChatId };
      delete nextByChatId[chatId];
      return { byChatId: nextByChatId };
    });
  },

  clearAll: () => {
    if (expiryTimer !== null) {
      globalThis.clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    set({ byChatId: {} });
  },
}));
