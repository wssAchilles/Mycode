import { create } from 'zustand';
import type { Message } from '../../../types/chat';
import { authAPI, authUtils } from '../../../services/apiClient';
import { authStorage } from '../../../utils/authStorage';
import { buildGroupChatId, buildPrivateChatId } from '../../../utils/chat';
import chatCoreClient from '../../../core/bridge/chatCoreClient';
import type { ChatPatch } from '../../../core/chat/types';
import { throttleWithTickEnd } from '../../../core/workers/schedulers';
import { markChatSwitchEnd, markChatSwitchStart } from '../../../perf/marks';
import { useChatStore } from './chatStore';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const resolveChatId = (targetId: string, isGroup: boolean): string | null => {
  if (isGroup) return buildGroupChatId(targetId);
  const me = authUtils.getCurrentUser()?.id;
  if (!me) return null;
  return buildPrivateChatId(me, targetId);
};

interface MessageState {
  // Regular chat projection (active chat only).
  // Keep these as mutable structures; use version counters to trigger minimal rerenders.
  messageIds: string[];
  messageIdsVersion: number;
  entities: Map<string, Message>;

  // Local-only AI chat buffer (regular chat is driven by worker patches).
  aiMessages: Message[];

  // Active chat selection
  activeContactId: string | null;
  activeChatId: string | null;
  isGroupChat: boolean;

  // Paging state (unified cursor for groups/new endpoint; legacy private paging is handled in worker)
  hasMore: boolean;
  nextBeforeSeq: number | null;

  // Loading / errors
  isLoading: boolean;
  error: string | null;

  // Socket connectivity hint (for worker sync fallback)
  socketConnected: boolean;

  // Monotonic seq to ignore stale async work during fast chat switches.
  loadSeq: number;

  // Actions
  setActiveContact: (contactId: string | null, isGroup?: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  prefetchChat: (targetId: string, isGroup?: boolean) => void;
  loadMoreMessages: () => Promise<void>;
  addMessage: (message: Message) => void;
  ingestSocketMessage: (raw: any) => void;
  ingestPresenceEvent: (event: { userId: string; isOnline: boolean; lastSeen?: string }) => void;
  ingestReadReceiptEvent: (event: { chatId: string; seq: number; readCount: number }) => void;
  ingestGroupUpdateEvent: (event: any) => void;
  applyReadReceipt: (chatId: string, seq: number, readCount: number, currentUserId: string) => void;
  clearMessages: () => void;
}

async function ensureChatCoreInitialized(patchHandler: (patches: ChatPatch[]) => void) {
  const user = authUtils.getCurrentUser();
  const accessToken = authStorage.getAccessToken();
  const refreshToken = authStorage.getRefreshToken();

  if (!user?.id || !accessToken) {
    throw new Error('NOT_AUTHENTICATED');
  }

  await chatCoreClient.init({
    userId: user.id,
    accessToken,
    refreshToken,
    apiBaseUrl: API_BASE_URL,
  });

  // Subscribe once (client is idempotent).
  await chatCoreClient.subscribe(patchHandler);
}

export const useMessageStore = create<MessageState>((set, get) => {
  const applyPatches = (patches: ChatPatch[]) => {
    // 1) Meta patches: update chat list regardless of active chat state.
    const metaLast = new Map<string, Message>();
    const metaUnread = new Map<string, number>();
    const metaOnline = new Map<string, { isOnline: boolean; lastSeen?: string }>();
    const metaChatUpserts = new Map<
      string,
      { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }
    >();
    const metaChatRemovals = new Set<string>();

    for (const p of patches) {
      if (p.kind !== 'meta') continue;

      if (Array.isArray(p.lastMessages)) {
        for (const item of p.lastMessages) {
          if (!item?.chatId || !item?.message) continue;
          metaLast.set(item.chatId, item.message);
        }
      }
      if (Array.isArray(p.unreadDeltas)) {
        for (const d of p.unreadDeltas) {
          if (!d?.chatId || typeof d?.delta !== 'number') continue;
          metaUnread.set(d.chatId, (metaUnread.get(d.chatId) || 0) + d.delta);
        }
      }
      if (Array.isArray(p.onlineUpdates)) {
        for (const u of p.onlineUpdates) {
          if (!u?.userId) continue;
          metaOnline.set(u.userId, { isOnline: !!u.isOnline, lastSeen: u.lastSeen });
        }
      }

      if (Array.isArray(p.chatUpserts)) {
        for (const u of p.chatUpserts) {
          if (!u?.chatId) continue;
          metaChatUpserts.set(u.chatId, {
            isGroup: !!u.isGroup,
            title: u.title,
            avatarUrl: u.avatarUrl,
            memberCount: typeof u.memberCount === 'number' ? u.memberCount : undefined,
          });
        }
      }

      if (Array.isArray(p.chatRemovals)) {
        for (const r of p.chatRemovals) {
          if (!r?.chatId) continue;
          metaChatRemovals.add(r.chatId);
        }
      }
    }

    if (metaLast.size || metaUnread.size || metaOnline.size || metaChatUpserts.size || metaChatRemovals.size) {
      useChatStore.getState().applyChatMetaBatch({
        lastMessages: metaLast.size
          ? Array.from(metaLast.entries()).map(([chatId, message]) => ({ chatId, message }))
          : undefined,
        unreadDeltas: metaUnread.size
          ? Array.from(metaUnread.entries()).map(([chatId, delta]) => ({ chatId, delta }))
          : undefined,
        onlineUpdates: metaOnline.size
          ? Array.from(metaOnline.entries()).map(([userId, v]) => ({ userId, ...v }))
          : undefined,
        chatUpserts: metaChatUpserts.size
          ? Array.from(metaChatUpserts.entries()).map(([chatId, v]) => ({ chatId, ...v }))
          : undefined,
        chatRemovals: metaChatRemovals.size
          ? Array.from(metaChatRemovals.values()).map((chatId) => ({ chatId }))
          : undefined,
      });
    }

    const s = get();
    // 2) Message patches: only apply when a regular chat is active.
    if (!s.activeChatId || !s.activeContactId) return;

    let appliedAny = false;
    let didIdsChange = false;

    let nextHasMore = s.hasMore;
    let nextBeforeSeq = s.nextBeforeSeq;
    let nextIsLoading = s.isLoading;
    let nextError = s.error;

    const ids = s.messageIds;
    const entities = s.entities;

    for (const patch of patches) {
      if (patch.kind === 'meta') continue;
      if (patch.chatId !== s.activeChatId) continue;
      if (patch.loadSeq !== s.loadSeq) continue;

      if (patch.kind === 'reset') {
        appliedAny = true;
        markChatSwitchEnd(patch.chatId, patch.loadSeq);
        ids.length = 0;
        entities.clear();
        for (const m of patch.messages) {
          if (!m?.id) continue;
          if (entities.has(m.id)) continue;
          entities.set(m.id, m);
          ids.push(m.id);
        }
        didIdsChange = true;
        nextHasMore = patch.hasMore;
        nextBeforeSeq = patch.nextBeforeSeq;
        nextIsLoading = false;
        nextError = null;
      } else if (patch.kind === 'append') {
        appliedAny = true;
        if (!patch.messages.length) {
          nextIsLoading = false;
          continue;
        }
        for (const m of patch.messages) {
          if (!m?.id) continue;
          if (entities.has(m.id)) continue;
          entities.set(m.id, m);
          ids.push(m.id);
          didIdsChange = true;
        }
        nextIsLoading = false;
        nextError = null;
      } else if (patch.kind === 'prepend') {
        appliedAny = true;
        if (patch.messages.length) {
          const addedIds: string[] = [];
          for (const m of patch.messages) {
            if (!m?.id) continue;
            if (entities.has(m.id)) continue;
            entities.set(m.id, m);
            addedIds.push(m.id);
          }
          if (addedIds.length) {
            ids.unshift(...addedIds);
            didIdsChange = true;
          }
        }
        nextHasMore = patch.hasMore;
        nextBeforeSeq = patch.nextBeforeSeq;
        nextIsLoading = false;
        nextError = null;
      } else if (patch.kind === 'delete') {
        appliedAny = true;
        if (patch.ids.length) {
          const removeSet = new Set(patch.ids);
          for (const id of patch.ids) entities.delete(id);

          // Filter in-place to avoid allocating a second 10k+ array.
          let w = 0;
          for (let r = 0; r < ids.length; r += 1) {
            const id = ids[r];
            if (removeSet.has(id)) {
              didIdsChange = true;
              continue;
            }
            ids[w] = id;
            w += 1;
          }
          ids.length = w;
        }
        nextIsLoading = false;
        nextError = null;
      } else if (patch.kind === 'update') {
        appliedAny = true;
        if (!patch.updates.length) continue;
        for (const u of patch.updates) {
          const cur = entities.get(u.id);
          if (!cur) continue;
          entities.set(u.id, { ...cur, ...u });
        }
      }
    }

    if (!appliedAny) return;

    // Trigger re-render only when needed.
    // - idsVersion: list mutations (reset/append/prepend/delete)
    // - isLoading/hasMore/paging/error: UI state
    // - entities: row-level subscriptions depend on store notifications; we still call set once here.
    set((state) => ({
      messageIdsVersion: didIdsChange ? state.messageIdsVersion + 1 : state.messageIdsVersion,
      hasMore: nextHasMore,
      nextBeforeSeq,
      isLoading: nextIsLoading,
      error: nextError,
    }));
  };

  // Reduce Comlink overhead by batching high-frequency ingests on tick-end.
  let ingestQueue: Message[] = [];
  const flushIngestQueue = throttleWithTickEnd(() => {
    if (!ingestQueue.length) return;
    const batch = ingestQueue;
    ingestQueue = [];
    void (async () => {
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.ingestMessages(batch);
      } catch {
        // ignore
      }
    })();
  });

  // Socket payloads should be normalized in the worker (not on the main thread).
  let socketQueue: any[] = [];
  const flushSocketQueue = throttleWithTickEnd(() => {
    if (!socketQueue.length) return;
    const batch = socketQueue;
    socketQueue = [];
    void (async () => {
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.ingestSocketMessages(batch);
      } catch {
        // ignore
      }
    })();
  });

  type PresenceEvent = { userId: string; isOnline: boolean; lastSeen?: string };
  let presenceQueue: PresenceEvent[] = [];
  const flushPresenceQueue = throttleWithTickEnd(() => {
    if (!presenceQueue.length) return;
    const batch = presenceQueue;
    presenceQueue = [];
    void (async () => {
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.ingestPresenceEvents(batch);
      } catch {
        // ignore
      }
    })();
  });

  let groupUpdateQueue: any[] = [];
  const flushGroupUpdateQueue = throttleWithTickEnd(() => {
    if (!groupUpdateQueue.length) return;
    const batch = groupUpdateQueue;
    groupUpdateQueue = [];
    void (async () => {
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.ingestGroupUpdates(batch);
      } catch {
        // ignore
      }
    })();
  });

  type ReadReceiptItem = { chatId: string; seq: number; readCount: number; currentUserId: string };
  let readReceiptQueue: ReadReceiptItem[] = [];
  const flushReadReceiptQueue = throttleWithTickEnd(() => {
    if (!readReceiptQueue.length) return;
    const batch = readReceiptQueue;
    readReceiptQueue = [];

    const currentUserId = batch[batch.length - 1]?.currentUserId;
    if (!currentUserId) return;

    const receipts = batch.map((r) => ({ chatId: r.chatId, seq: r.seq, readCount: r.readCount }));
    void (async () => {
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.applyReadReceiptsBatch(receipts, currentUserId);
      } catch {
        // ignore
      }
    })();
  });

  const prefetchInFlight = new Set<string>();

  return {
    messageIds: [],
    messageIdsVersion: 0,
    entities: new Map(),
    aiMessages: [],
    activeContactId: null,
    activeChatId: null,
    isGroupChat: false,
    hasMore: true,
    nextBeforeSeq: null,
    isLoading: false,
    error: null,
    socketConnected: false,
    loadSeq: 0,

    setActiveContact: (contactId, isGroup = false) => {
      const { activeContactId, isGroupChat } = get();
      if (activeContactId === contactId && isGroupChat === isGroup) return;

      const nextLoadSeq = get().loadSeq + 1;
      const activeChatId = contactId ? resolveChatId(contactId, isGroup) : null;

      // Switching away from regular chat: show AI buffer (if any).
      if (!contactId) {
        // Ensure worker doesn't treat the last opened chat as "active" (unread counts, etc).
        void (async () => {
          try {
            await ensureChatCoreInitialized(applyPatches);
            await chatCoreClient.clearActiveChat();
          } catch {
            // ignore
          }
        })();

        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: null,
          activeChatId: null,
          isGroupChat: false,
          hasMore: false,
          nextBeforeSeq: null,
          isLoading: false,
          error: null,
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      if (!activeChatId) {
        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: contactId,
          activeChatId: null,
          isGroupChat: isGroup,
          hasMore: true,
          nextBeforeSeq: null,
          isLoading: false,
          error: '无法解析 chatId（请重新登录）',
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      // Reset UI state immediately (instant shell).
      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: contactId,
        activeChatId,
        isGroupChat: isGroup,
        hasMore: true,
        nextBeforeSeq: null,
        isLoading: true,
        error: null,
        loadSeq: nextLoadSeq,
        messageIdsVersion: get().messageIdsVersion + 1,
      });

      markChatSwitchStart(activeChatId, nextLoadSeq);

      // Fire-and-forget worker work; patches will stream back in batches.
      void (async () => {
        try {
          await ensureChatCoreInitialized(applyPatches);
          await chatCoreClient.setActiveChat(activeChatId, isGroup, nextLoadSeq);
        } catch (err: any) {
          // Handle auth expiry by refreshing token in main thread, then update worker tokens and retry once.
          if (String(err?.message || err) === 'AUTH_ERROR') {
            try {
              const tokens = await authAPI.refreshToken();
              await chatCoreClient.updateTokens(tokens.accessToken, tokens.refreshToken);
              await chatCoreClient.setActiveChat(activeChatId, isGroup, nextLoadSeq);
              return;
            } catch (refreshErr: any) {
              set({ error: refreshErr?.message || '认证失败，请重新登录', isLoading: false });
              return;
            }
          }

          set({ error: err?.message || '加载消息失败', isLoading: false });
        }
      })();
    },

    setSocketConnected: (connected: boolean) => {
      if (get().socketConnected === connected) return;
      set({ socketConnected: connected });

      // Let the worker decide whether to start long-poll sync fallback.
      void (async () => {
        try {
          await ensureChatCoreInitialized(applyPatches);
          await chatCoreClient.setConnectivity(connected);
        } catch {
          // ignore (e.g. not authenticated yet)
        }
      })();
    },

    prefetchChat: (targetId: string, isGroup = false) => {
      const chatId = resolveChatId(targetId, isGroup);
      if (!chatId) return;
      if (prefetchInFlight.has(chatId)) return;

      prefetchInFlight.add(chatId);
      void (async () => {
        try {
          await ensureChatCoreInitialized(applyPatches);
          await chatCoreClient.prefetchChat(chatId, isGroup);
        } catch {
          // ignore
        } finally {
          prefetchInFlight.delete(chatId);
        }
      })();
    },

    loadMoreMessages: async () => {
      const { activeChatId, activeContactId, hasMore, isLoading, loadSeq } = get();
      if (!activeChatId || !activeContactId) return;
      if (isLoading || !hasMore) return;

      set({ isLoading: true, error: null });
      try {
        await ensureChatCoreInitialized(applyPatches);
        await chatCoreClient.loadMoreBefore(activeChatId, loadSeq);
      } catch (err: any) {
        if (String(err?.message || err) === 'AUTH_ERROR') {
          try {
            const tokens = await authAPI.refreshToken();
            await chatCoreClient.updateTokens(tokens.accessToken, tokens.refreshToken);
            await chatCoreClient.loadMoreBefore(activeChatId, loadSeq);
            return;
          } catch (refreshErr: any) {
            set({ error: refreshErr?.message || '认证失败，请重新登录', isLoading: false });
            return;
          }
        }
        set({ error: err?.message || '加载更多消息失败', isLoading: false });
      } finally {
        // If worker patches come back later, they'll set isLoading=false again; that's fine.
        if (get().activeChatId === activeChatId && get().loadSeq === loadSeq) {
          // Keep loading state if we are still waiting for patches.
          if (!get().isLoading) {
            set({ isLoading: false });
          }
        }
      }

      // For legacy private paging, worker manages its own page counter; nothing else to do here.
    },

    addMessage: (message) => {
      const { activeContactId } = get();

      // AI mode: store locally (no worker).
      if (!activeContactId) {
        const isAiMessage = message.receiverId === 'ai' || message.senderId === 'ai';
        if (!isAiMessage) return;
        set((state) => {
          if (state.aiMessages.find((m) => m.id === message.id)) return state;
          const nextAi = [...state.aiMessages, message];
          return { aiMessages: nextAi };
        });
        return;
      }

      // Regular chats: forward to worker (batched patches will update UI).
      ingestQueue.push(message);
      flushIngestQueue();
    },

    ingestSocketMessage: (raw) => {
      // Always forward socket messages to worker so its caches stay warm even when UI is in AI mode.
      socketQueue.push(raw);
      flushSocketQueue();
    },

    ingestPresenceEvent: (event) => {
      if (!event?.userId) return;
      presenceQueue.push(event);
      flushPresenceQueue();
    },

    ingestReadReceiptEvent: (event) => {
      if (!event?.chatId || typeof event.seq !== 'number') return;
      const currentUserId = authUtils.getCurrentUser()?.id;
      if (!currentUserId) return;
      const readCount = typeof event.readCount === 'number' ? event.readCount : 1;
      readReceiptQueue.push({ chatId: event.chatId, seq: event.seq, readCount, currentUserId });
      flushReadReceiptQueue();
    },

    ingestGroupUpdateEvent: (event) => {
      if (!event) return;
      groupUpdateQueue.push(event);
      flushGroupUpdateQueue();
    },

    applyReadReceipt: (chatId, seq, readCount, currentUserId) => {
      // Worker owns the authoritative state for regular chats.
      readReceiptQueue.push({ chatId, seq, readCount, currentUserId });
      flushReadReceiptQueue();
    },

    clearMessages: () => {
      const nextLoadSeq = get().loadSeq + 1;
      const isInAiMode = !get().activeContactId;

      if (isInAiMode) {
        set({
          aiMessages: [],
          error: null,
          isLoading: false,
          loadSeq: nextLoadSeq,
        });
        return;
      }

      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: null,
        activeChatId: null,
        isGroupChat: false,
        hasMore: true,
        nextBeforeSeq: null,
        isLoading: false,
        error: null,
        loadSeq: nextLoadSeq,
        messageIdsVersion: get().messageIdsVersion + 1,
      });
    },
  };
});

// Selectors (keep call sites stable)
export const selectMessageIds = (state: MessageState) => state.messageIds;
export const selectIsLoadingMessages = (state: MessageState) => state.isLoading;
export const selectHasMoreMessages = (state: MessageState) => state.hasMore;
export const selectActiveContactId = (state: MessageState) => state.activeContactId;
