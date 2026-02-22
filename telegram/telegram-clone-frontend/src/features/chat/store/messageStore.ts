import { create } from 'zustand';
import type { Message } from '../../../types/chat';
import { authAPI, authUtils } from '../../../services/apiClient';
import { authStorage } from '../../../utils/authStorage';
import { buildGroupChatId, buildPrivateChatId } from '../../../utils/chat';
import chatCoreClient from '../../../core/bridge/chatCoreClient';
import type { ChatPatch, ChatSyncPhase, SocketMessageSendPayload } from '../../../core/chat/types';
import { resolveChatRuntimePolicy } from '../../../core/chat/rolloutPolicy';
import { runtimeFlags } from '../../../core/chat/runtimeFlags';
import { throttleWithTickEnd } from '../../../core/workers/schedulers';
import { markChatSwitchEnd, markChatSwitchStart, markSyncPhaseTransition } from '../../../perf/marks';
import { useChatStore } from './chatStore';
import { compactMessagePatches, type MessagePatch } from './patchCompactor';
import type { SocketRealtimeEvent } from '../../../core/chat/realtime';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://telegram-clone-backend-88ez.onrender.com';

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
  visibleStart: number;
  visibleEnd: number;
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
  syncPhase: ChatSyncPhase;
  syncPts: number;
  syncUpdatedAt: number;

  // Monotonic seq to ignore stale async work during fast chat switches.
  loadSeq: number;

  // Actions
  setActiveContact: (contactId: string | null, isGroup?: boolean) => void;
  setVisibleRange: (start: number, end: number) => void;
  connectRealtime: () => void;
  disconnectRealtime: () => void;
  setSocketConnected: (connected: boolean) => void;
  sendRealtimeMessage: (payload: SocketMessageSendPayload) => Promise<{ success: boolean; messageId?: string; seq?: number; error?: string }>;
  joinRealtimeRoom: (roomId: string) => void;
  leaveRealtimeRoom: (roomId: string) => void;
  markChatRead: (chatId: string, seq: number) => void;
  prefetchChat: (targetId: string, isGroup?: boolean) => void;
  prefetchChats: (targets: Array<{ targetId: string; isGroup?: boolean }>) => void;
  searchActiveChat: (query: string, limit?: number) => Promise<Message[]>;
  loadMessageContext: (seq: number, limit?: number) => Promise<Message[]>;
  loadMoreMessages: () => Promise<void>;
  addMessage: (message: Message) => void;
  ingestSocketMessage: (raw: any) => void;
  ingestSocketMessages: (rawMessages: any[]) => void;
  ingestRealtimeEvents: (events: SocketRealtimeEvent[]) => void;
  ingestPresenceEvent: (event: { userId: string; isOnline: boolean; lastSeen?: string }) => void;
  ingestPresenceEvents: (events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>) => void;
  ingestReadReceiptEvent: (event: { chatId: string; seq: number; readCount: number }) => void;
  ingestReadReceiptEvents: (events: Array<{ chatId: string; seq: number; readCount: number }>) => void;
  ingestGroupUpdateEvent: (event: any) => void;
  ingestGroupUpdateEvents: (events: any[]) => void;
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

  const runtimePolicy = resolveChatRuntimePolicy(user.id);

  await chatCoreClient.init({
    userId: user.id,
    accessToken,
    refreshToken,
    apiBaseUrl: API_BASE_URL,
    socketUrl: SOCKET_URL,
    enableWorkerSocket: runtimePolicy.enableWorkerSocket,
    runtimeOverrides: {
      workerSyncFallback: runtimePolicy.enableWorkerSyncFallback,
      workerSafetyChecks: runtimePolicy.enableWorkerSafetyChecks,
      searchTieredIndex: runtimePolicy.enableSearchTieredIndex,
      searchTieredWasm: runtimePolicy.enableSearchTieredWasm,
      emergencySafeMode: runtimePolicy.emergencySafeMode,
      policyProfile: runtimePolicy.profile,
      policyLocked: runtimePolicy.profileLocked,
      policySource: runtimePolicy.profileSource,
      policyMatrixVersion: runtimePolicy.matrixVersion,
    },
  });

  // Subscribe once (client is idempotent).
  await chatCoreClient.subscribe(patchHandler);
}

export const useMessageStore = create<MessageState>((set, get) => {
  // Main-thread patch apply budget:
  // keep each synchronous apply chunk small to avoid long tasks when worker emits bursts.
  const PATCH_APPLY_MAX_PATCHES = 12;
  const PATCH_APPLY_MAX_OPS = 900;
  const PATCH_QUEUE_WARN_AT = 360;
  const PATCH_QUEUE_COMPACT_AT = 220;
  const PATCH_QUEUE_HARD_MAX = 520;
  const INGEST_BATCH_SIZE = 160;
  const INGEST_QUEUE_HARD_MAX = 4_800;
  const REALTIME_BATCH_SIZE = 260;
  const REALTIME_QUEUE_HARD_MAX = 6_000;
  const PREFETCH_COOLDOWN_MS = 10_000;
  const ENTITY_CACHE_LIMIT = Math.max(1_800, Math.min(12_000, Math.floor(runtimeFlags.chatMemoryWindow * 0.35)));
  const ENTITY_WINDOW_PADDING = Math.max(120, Math.min(480, Math.floor(runtimeFlags.chatMemoryWindow * 0.02)));
  const RESOLVE_IDS_BATCH_SIZE = 240;

  const entityCache = new Map<string, Message>();
  const knownMessageIds = new Set<string>();
  const deferredEntityUpdates = new Map<string, { status?: Message['status']; readCount?: number }>();
  let resolveMissingInFlight = false;
  let resolveMissingQueue = new Set<string>();
  let projectionToken = 0;

  const resetProjectionCaches = () => {
    projectionToken += 1;
    knownMessageIds.clear();
    entityCache.clear();
    deferredEntityUpdates.clear();
    resolveMissingQueue = new Set<string>();
    resolveMissingInFlight = false;
  };

  const touchEntityCache = (raw: Message) => {
    if (!raw?.id) return;

    const deferred = deferredEntityUpdates.get(raw.id);
    let next = raw;
    if (deferred) {
      next = {
        ...raw,
        status: deferred.status ?? raw.status,
        readCount: deferred.readCount ?? raw.readCount,
      };
      deferredEntityUpdates.delete(raw.id);
    }

    if (entityCache.has(next.id)) {
      entityCache.delete(next.id);
    }
    entityCache.set(next.id, next);

    while (entityCache.size > ENTITY_CACHE_LIMIT) {
      const oldestId = entityCache.keys().next().value as string | undefined;
      if (!oldestId) break;
      entityCache.delete(oldestId);
    }
  };

  const getEntityFromCache = (id: string): Message | undefined => {
    const cached = entityCache.get(id);
    if (!cached) return undefined;
    entityCache.delete(id);
    entityCache.set(id, cached);
    return cached;
  };

  const queueEntityResolve = (ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) {
      if (!id) continue;
      resolveMissingQueue.add(id);
    }
    flushResolveMissing();
  };

  const rebuildVisibleEntities = () => {
    const s = get();
    const chatId = s.activeChatId;
    if (!chatId || !s.activeContactId) {
      if (s.entities.size) {
        set({ entities: new Map() });
      }
      return;
    }

    const ids = s.messageIds;
    if (!ids.length) {
      if (s.entities.size) {
        set({ entities: new Map() });
      }
      return;
    }

    const rawStart = Number.isFinite(s.visibleStart) ? s.visibleStart : -1;
    const rawEnd = Number.isFinite(s.visibleEnd) ? s.visibleEnd : -1;
    const fallbackStart = Math.max(0, ids.length - 64);
    const fallbackEnd = ids.length - 1;

    const normalizedStart = rawStart >= 0 ? Math.min(rawStart, ids.length - 1) : fallbackStart;
    const normalizedEnd = rawEnd >= normalizedStart ? Math.min(rawEnd, ids.length - 1) : fallbackEnd;

    const windowStart = Math.max(0, normalizedStart - ENTITY_WINDOW_PADDING);
    const windowEnd = Math.min(ids.length - 1, normalizedEnd + ENTITY_WINDOW_PADDING);

    const nextEntities = new Map<string, Message>();
    const missing: string[] = [];

    for (let i = windowStart; i <= windowEnd; i += 1) {
      const id = ids[i];
      if (!id) continue;
      const cached = getEntityFromCache(id);
      if (!cached) {
        missing.push(id);
        continue;
      }
      nextEntities.set(id, cached);
    }

    const prev = s.entities;
    let same = prev.size === nextEntities.size;
    if (same) {
      for (const [id, msg] of nextEntities.entries()) {
        if (prev.get(id) !== msg) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      set({ entities: nextEntities });
    }

    if (missing.length) {
      queueEntityResolve(missing);
    }
  };

  const flushResolveMissing = throttleWithTickEnd(() => {
    if (resolveMissingInFlight || resolveMissingQueue.size === 0) return;

    const { activeChatId, activeContactId, isGroupChat, loadSeq } = get();
    if (!activeChatId || !activeContactId) {
      resolveMissingQueue = new Set<string>();
      return;
    }

    const batch = Array.from(resolveMissingQueue.values()).slice(0, RESOLVE_IDS_BATCH_SIZE);
    for (const id of batch) {
      resolveMissingQueue.delete(id);
    }
    if (!batch.length) return;

    const token = projectionToken;
    resolveMissingInFlight = true;
    void (async () => {
      try {
        await ensureCoreReady();
        const resolved = await chatCoreClient.resolveMessages(activeChatId, isGroupChat, batch);
        if (!resolved.length) return;

        if (projectionToken !== token) return;
        const s = get();
        if (s.activeChatId !== activeChatId || s.loadSeq !== loadSeq) return;

        for (const msg of resolved) {
          touchEntityCache(msg);
        }
      } catch {
        // ignore cache resolve failures
      } finally {
        resolveMissingInFlight = false;
        rebuildVisibleEntities();
        if (resolveMissingQueue.size) {
          flushResolveMissing();
        }
      }
    })();
  });

  const applyPatches = (patches: ChatPatch[]) => {
    // 1) Meta + sync patches are global, independent from active chat.
    const metaLast = new Map<string, Message>();
    const metaUnread = new Map<string, number>();
    const metaOnline = new Map<string, { isOnline: boolean; lastSeen?: string }>();
    const metaAiMessages = new Map<string, Message>();
    const metaChatUpserts = new Map<
      string,
      { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }
    >();
    const metaChatRemovals = new Set<string>();
    let latestSync: Extract<ChatPatch, { kind: 'sync' }> | null = null;

    for (const p of patches) {
      if (p.kind === 'sync') {
        latestSync = p;
        continue;
      }
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
      if (Array.isArray(p.aiMessages)) {
        for (const m of p.aiMessages) {
          if (!m?.id) continue;
          metaAiMessages.set(m.id, m);
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

    if (latestSync) {
      markSyncPhaseTransition(latestSync.phase, latestSync.reason);
      set({
        socketConnected: latestSync.socketConnected,
        syncPhase: latestSync.phase,
        syncPts: latestSync.pts,
        syncUpdatedAt: latestSync.updatedAt,
      });
    }

    if (metaAiMessages.size) {
      set((state) => {
        const next = state.aiMessages.slice();
        const seen = new Set(next.map((m) => m.id));
        let changed = false;
        for (const msg of metaAiMessages.values()) {
          if (!msg?.id || seen.has(msg.id)) continue;
          seen.add(msg.id);
          next.push(msg);
          changed = true;
        }
        if (!changed) return state;
        next.sort((a, b) => {
          const aSeq = typeof a.seq === 'number' ? a.seq : -1;
          const bSeq = typeof b.seq === 'number' ? b.seq : -1;
          if (aSeq >= 0 && bSeq >= 0) return aSeq - bSeq;
          const aTs = Date.parse(a.timestamp || '');
          const bTs = Date.parse(b.timestamp || '');
          if (Number.isFinite(aTs) && Number.isFinite(bTs)) return aTs - bTs;
          return 0;
        });
        return { aiMessages: next };
      });
    }

    const s = get();
    if (!s.activeChatId || !s.activeContactId) return;

    // 2) Message patches: apply only when chatId/loadSeq matches the active projection.
    const messagePatchesRaw: MessagePatch[] = [];
    for (const p of patches) {
      if (p.kind === 'meta' || p.kind === 'sync') continue;
      if (p.chatId !== s.activeChatId) continue;
      if (p.loadSeq !== s.loadSeq) continue;
      messagePatchesRaw.push(p);
    }
    if (!messagePatchesRaw.length) return;

    const messagePatches = compactMessagePatches(messagePatchesRaw);

    let appliedAny = false;
    let didIdsChange = false;
    let didEntityChange = false;

    let nextHasMore = s.hasMore;
    let nextBeforeSeq = s.nextBeforeSeq;
    let nextIsLoading = s.isLoading;
    let nextError = s.error;

    const ids = s.messageIds;

    for (const patch of messagePatches) {
      if (patch.kind === 'reset') {
        appliedAny = true;
        didIdsChange = true;
        didEntityChange = true;
        markChatSwitchEnd(patch.chatId, patch.loadSeq);

        resetProjectionCaches();
        ids.length = 0;
        for (const m of patch.messages) {
          if (!m?.id) continue;
          if (knownMessageIds.has(m.id)) continue;
          knownMessageIds.add(m.id);
          ids.push(m.id);
          touchEntityCache(m);
        }

        nextHasMore = patch.hasMore;
        nextBeforeSeq = patch.nextBeforeSeq;
        nextIsLoading = false;
        nextError = null;
        continue;
      }

      if (patch.kind === 'append') {
        appliedAny = true;
        nextIsLoading = false;
        nextError = null;
        if (!patch.messages.length) continue;

        for (const m of patch.messages) {
          if (!m?.id) continue;
          if (knownMessageIds.has(m.id)) continue;
          knownMessageIds.add(m.id);
          ids.push(m.id);
          touchEntityCache(m);
          didIdsChange = true;
          didEntityChange = true;
        }
        continue;
      }

      if (patch.kind === 'prepend') {
        appliedAny = true;
        nextHasMore = patch.hasMore;
        nextBeforeSeq = patch.nextBeforeSeq;
        nextIsLoading = false;
        nextError = null;

        if (!patch.messages.length) continue;
        const addedIds: string[] = [];
        for (const m of patch.messages) {
          if (!m?.id) continue;
          if (knownMessageIds.has(m.id)) continue;
          knownMessageIds.add(m.id);
          addedIds.push(m.id);
          touchEntityCache(m);
          didEntityChange = true;
        }
        if (addedIds.length) {
          ids.unshift(...addedIds);
          didIdsChange = true;
        }
        continue;
      }

      if (patch.kind === 'delete') {
        appliedAny = true;
        nextIsLoading = false;
        nextError = null;
        if (!patch.ids.length) continue;

        const removeSet = new Set(patch.ids);
        for (const id of patch.ids) {
          knownMessageIds.delete(id);
          entityCache.delete(id);
          deferredEntityUpdates.delete(id);
        }

        // Filter in-place to avoid allocating a second 10k+ array.
        let w = 0;
        for (let r = 0; r < ids.length; r += 1) {
          const id = ids[r];
          if (removeSet.has(id)) {
            didIdsChange = true;
            didEntityChange = true;
            continue;
          }
          ids[w] = id;
          w += 1;
        }
        ids.length = w;
        continue;
      }

      if (patch.kind === 'update') {
        appliedAny = true;
        if (!patch.updates.length) continue;

        for (const u of patch.updates) {
          if (!u?.id) continue;

          const current = entityCache.get(u.id);
          if (current) {
            const nextStatus = u.status ?? current.status;
            const nextReadCount = u.readCount ?? current.readCount;
            if (nextStatus === current.status && nextReadCount === current.readCount) continue;
            touchEntityCache({
              ...current,
              status: nextStatus,
              readCount: nextReadCount,
            });
            didEntityChange = true;
            continue;
          }

          const prevDeferred = deferredEntityUpdates.get(u.id);
          const nextDeferred = {
            status: u.status ?? prevDeferred?.status,
            readCount: u.readCount ?? prevDeferred?.readCount,
          };
          deferredEntityUpdates.set(u.id, nextDeferred);
        }
      }
    }

    if (!appliedAny) return;

    set((state) => ({
      messageIdsVersion: didIdsChange ? state.messageIdsVersion + 1 : state.messageIdsVersion,
      hasMore: nextHasMore,
      nextBeforeSeq,
      isLoading: nextIsLoading,
      error: nextError,
    }));

    if (didEntityChange || didIdsChange) {
      rebuildVisibleEntities();
    }
  };

  const estimatePatchOps = (patch: ChatPatch): number => {
    if (patch.kind === 'meta') {
      return (
        (patch.lastMessages?.length || 0) +
        (patch.unreadDeltas?.length || 0) +
        (patch.onlineUpdates?.length || 0) +
        (patch.aiMessages?.length || 0) +
        (patch.chatUpserts?.length || 0) +
        (patch.chatRemovals?.length || 0)
      );
    }
    if (patch.kind === 'reset' || patch.kind === 'append' || patch.kind === 'prepend') {
      return patch.messages.length;
    }
    if (patch.kind === 'update') return patch.updates.length;
    if (patch.kind === 'delete') return patch.ids.length;
    return 1;
  };

  const pendingPatches: ChatPatch[] = [];
  let patchQueueWarned = false;
  const compactPendingPatches = () => {
    if (!pendingPatches.length) return;

    const latestSync = pendingPatches.reduce<Extract<ChatPatch, { kind: 'sync' }> | null>((acc, p) => {
      if (p.kind !== 'sync') return acc;
      if (!acc) return p;
      return p.updatedAt >= acc.updatedAt ? p : acc;
    }, null);

    const metaLast = new Map<string, Message>();
    const metaUnread = new Map<string, number>();
    const metaOnline = new Map<string, { isOnline: boolean; lastSeen?: string }>();
    const metaAiMessages = new Map<string, Message>();
    const metaChatUpserts = new Map<string, { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }>();
    const metaChatRemovals = new Set<string>();

    const byProjection = new Map<string, MessagePatch[]>();
    const projectionOrder: string[] = [];

    for (const patch of pendingPatches) {
      if (patch.kind === 'sync') continue;
      if (patch.kind === 'meta') {
        if (Array.isArray(patch.lastMessages)) {
          for (const item of patch.lastMessages) {
            if (!item?.chatId || !item?.message) continue;
            metaLast.set(item.chatId, item.message);
          }
        }
        if (Array.isArray(patch.unreadDeltas)) {
          for (const item of patch.unreadDeltas) {
            if (!item?.chatId || typeof item?.delta !== 'number') continue;
            metaUnread.set(item.chatId, (metaUnread.get(item.chatId) || 0) + item.delta);
          }
        }
        if (Array.isArray(patch.onlineUpdates)) {
          for (const item of patch.onlineUpdates) {
            if (!item?.userId) continue;
            metaOnline.set(item.userId, { isOnline: !!item.isOnline, lastSeen: item.lastSeen });
          }
        }
        if (Array.isArray(patch.aiMessages)) {
          for (const item of patch.aiMessages) {
            if (!item?.id) continue;
            metaAiMessages.set(item.id, item);
          }
        }
        if (Array.isArray(patch.chatUpserts)) {
          for (const item of patch.chatUpserts) {
            if (!item?.chatId) continue;
            if (metaChatRemovals.has(item.chatId)) continue;
            metaChatUpserts.set(item.chatId, {
              isGroup: !!item.isGroup,
              title: item.title,
              avatarUrl: item.avatarUrl,
              memberCount: item.memberCount,
            });
          }
        }
        if (Array.isArray(patch.chatRemovals)) {
          for (const item of patch.chatRemovals) {
            if (!item?.chatId) continue;
            metaChatUpserts.delete(item.chatId);
            metaChatRemovals.add(item.chatId);
          }
        }
        continue;
      }

      const key = `${patch.chatId}:${patch.loadSeq}`;
      let list = byProjection.get(key);
      if (!list) {
        list = [];
        byProjection.set(key, list);
        projectionOrder.push(key);
      }
      list.push(patch);
    }

    const compacted: ChatPatch[] = [];

    if (
      metaLast.size ||
      metaUnread.size ||
      metaOnline.size ||
      metaAiMessages.size ||
      metaChatUpserts.size ||
      metaChatRemovals.size
    ) {
      compacted.push({
        kind: 'meta',
        lastMessages: metaLast.size
          ? Array.from(metaLast.entries()).map(([chatId, message]) => ({ chatId, message }))
          : undefined,
        unreadDeltas: metaUnread.size
          ? Array.from(metaUnread.entries()).map(([chatId, delta]) => ({ chatId, delta }))
          : undefined,
        onlineUpdates: metaOnline.size
          ? Array.from(metaOnline.entries()).map(([userId, v]) => ({ userId, ...v }))
          : undefined,
        aiMessages: metaAiMessages.size
          ? Array.from(metaAiMessages.values())
          : undefined,
        chatUpserts: metaChatUpserts.size
          ? Array.from(metaChatUpserts.entries()).map(([chatId, v]) => ({ chatId, ...v }))
          : undefined,
        chatRemovals: metaChatRemovals.size
          ? Array.from(metaChatRemovals.values()).map((chatId) => ({ chatId }))
          : undefined,
      });
    }

    if (latestSync) {
      compacted.push(latestSync);
    }

    for (const key of projectionOrder) {
      const patches = byProjection.get(key);
      if (!patches || patches.length === 0) continue;
      compacted.push(...compactMessagePatches(patches));
    }

    pendingPatches.length = 0;
    pendingPatches.push(...compacted);
  };

  const dropPatchPressure = () => {
    if (pendingPatches.length <= PATCH_QUEUE_HARD_MAX) return;

    for (let i = 0; i < pendingPatches.length && pendingPatches.length > PATCH_QUEUE_HARD_MAX; i += 1) {
      const patch = pendingPatches[i];
      if (patch.kind === 'meta' || patch.kind === 'sync') continue;
      pendingPatches.splice(i, 1);
      i -= 1;
    }

    if (pendingPatches.length > PATCH_QUEUE_HARD_MAX) {
      pendingPatches.splice(0, pendingPatches.length - PATCH_QUEUE_HARD_MAX);
    }
  };

  const drainPatchQueue = throttleWithTickEnd(() => {
    if (!pendingPatches.length) return;

    let take = 0;
    let ops = 0;
    while (take < pendingPatches.length && take < PATCH_APPLY_MAX_PATCHES) {
      const nextOps = estimatePatchOps(pendingPatches[take]);
      if (take > 0 && ops + nextOps > PATCH_APPLY_MAX_OPS) break;
      ops += nextOps;
      take += 1;
    }
    if (take === 0) take = 1;

    const chunk = pendingPatches.splice(0, take);
    applyPatches(chunk);

    if (patchQueueWarned && pendingPatches.length < Math.floor(PATCH_QUEUE_WARN_AT / 2)) {
      patchQueueWarned = false;
    }

    if (pendingPatches.length) {
      drainPatchQueue();
    }
  });

  const enqueuePatches = (patches: ChatPatch[]) => {
    if (!Array.isArray(patches) || patches.length === 0) return;
    const { activeChatId, loadSeq } = get();
    for (const patch of patches) {
      if (!patch) continue;
      if (patch.kind === 'meta' || patch.kind === 'sync') {
        pendingPatches.push(patch);
        continue;
      }
      if (!activeChatId) continue;
      if (patch.chatId !== activeChatId) continue;
      if (patch.loadSeq !== loadSeq) continue;
      pendingPatches.push(patch);
    }

    if (!pendingPatches.length) return;
    if (pendingPatches.length >= PATCH_QUEUE_COMPACT_AT) {
      compactPendingPatches();
    }
    if (pendingPatches.length > PATCH_QUEUE_HARD_MAX) {
      dropPatchPressure();
    }

    if (pendingPatches.length >= PATCH_QUEUE_WARN_AT && !patchQueueWarned) {
      patchQueueWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[message-store] patch apply queue pressure', pendingPatches.length);
    }

    drainPatchQueue();
  };

  let coreReadyPromise: Promise<void> | null = null;
  let coreReadyKey: string | null = null;
  const buildCoreReadyKey = () => {
    const userId = authUtils.getCurrentUser()?.id || '';
    const token = authStorage.getAccessToken() || '';
    if (!userId || !token) return null;
    return `${userId}:${token}`;
  };

  const ensureCoreReady = async () => {
    const key = buildCoreReadyKey();
    if (!key) {
      coreReadyPromise = null;
      coreReadyKey = null;
      throw new Error('NOT_AUTHENTICATED');
    }

    if (!coreReadyPromise || coreReadyKey !== key) {
      coreReadyKey = key;
      coreReadyPromise = ensureChatCoreInitialized(enqueuePatches);
    }

    try {
      await coreReadyPromise;
    } catch (error) {
      if (coreReadyKey === key) {
        coreReadyPromise = null;
        coreReadyKey = null;
      }
      throw error;
    }
  };

  // Reduce Comlink overhead by batching high-frequency ingests on tick-end.
  const ingestQueue: Message[] = [];
  let ingestQueueDropWarned = false;
  const trimIngestQueue = () => {
    if (ingestQueue.length <= INGEST_QUEUE_HARD_MAX) return;
    const overflow = ingestQueue.length - INGEST_QUEUE_HARD_MAX;
    if (overflow <= 0) return;
    ingestQueue.splice(0, overflow);
    if (!ingestQueueDropWarned) {
      ingestQueueDropWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[message-store] ingest queue overflow; dropped oldest messages');
    }
  };

  let ingestInFlight = false;
  const flushIngestQueue = throttleWithTickEnd(() => {
    if (ingestInFlight || !ingestQueue.length) return;
    ingestInFlight = true;
    void (async () => {
      try {
        while (ingestQueue.length) {
          const batch = ingestQueue.splice(0, INGEST_BATCH_SIZE);
          if (!batch.length) break;
          try {
            await ensureCoreReady();
            await chatCoreClient.ingestMessages(batch);
          } catch {
            // ignore
          }
        }
      } finally {
        ingestInFlight = false;
        if (ingestQueue.length) flushIngestQueue();
      }
    })();
  });

  const prefetchInFlight = new Set<string>();
  const prefetchLastAt = new Map<string, number>();
  const realtimeQueue: SocketRealtimeEvent[] = [];
  let realtimeQueueDropWarned = false;

  const trimRealtimeQueue = () => {
    if (realtimeQueue.length <= REALTIME_QUEUE_HARD_MAX) return;

    // Worker already performs event-type coalescing; keep main thread trim O(1) style.
    // Reserve soft compaction as a one-pass drop when bursts exceed the hard limit.
    const overflow = realtimeQueue.length - REALTIME_QUEUE_HARD_MAX;
    if (overflow > 0) {
      realtimeQueue.splice(0, overflow);
    }

    if (!realtimeQueueDropWarned) {
      realtimeQueueDropWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[message-store] realtime queue overflow; dropped oldest events');
    }
  };

  let realtimeInFlight = false;
  const flushRealtimeQueue = throttleWithTickEnd(() => {
    if (realtimeInFlight || !realtimeQueue.length) return;
    realtimeInFlight = true;
    void (async () => {
      try {
        while (realtimeQueue.length) {
          const batch = realtimeQueue.splice(0, REALTIME_BATCH_SIZE);
          if (!batch.length) break;
          try {
            await ensureCoreReady();
            await chatCoreClient.ingestRealtimeEvents(batch);
          } catch {
            // ignore
          }
        }
      } finally {
        realtimeInFlight = false;
        if (realtimeQueue.length) flushRealtimeQueue();
      }
    })();
  });

  const enqueueRealtimeEvent = (event: SocketRealtimeEvent | null | undefined) => {
    if (!event) return;
    realtimeQueue.push(event);
    trimRealtimeQueue();
  };

  const enqueueRealtimeBatch = (events: Array<SocketRealtimeEvent | null | undefined>) => {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const event of events) {
      if (!event) continue;
      realtimeQueue.push(event);
    }
    trimRealtimeQueue();
  };

  return {
    messageIds: [],
    messageIdsVersion: 0,
    visibleStart: -1,
    visibleEnd: -1,
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
    syncPhase: 'idle',
    syncPts: 0,
    syncUpdatedAt: 0,
    loadSeq: 0,

    setActiveContact: (contactId, isGroup = false) => {
      const { activeContactId, isGroupChat } = get();
      if (activeContactId === contactId && isGroupChat === isGroup) return;

      const nextLoadSeq = get().loadSeq + 1;
      const activeChatId = contactId ? resolveChatId(contactId, isGroup) : null;

      // Switching away from regular chat: show AI buffer (if any).
      if (!contactId) {
        pendingPatches.length = 0;
        // Ensure worker doesn't treat the last opened chat as "active" (unread counts, etc).
        void (async () => {
          try {
            await ensureCoreReady();
            await chatCoreClient.clearActiveChat();
          } catch {
            // ignore
          }
        })();

        resetProjectionCaches();
        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: null,
          activeChatId: null,
          isGroupChat: false,
          hasMore: false,
          nextBeforeSeq: null,
          visibleStart: -1,
          visibleEnd: -1,
          isLoading: false,
          error: null,
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      if (!activeChatId) {
        pendingPatches.length = 0;
        resetProjectionCaches();
        get().messageIds.length = 0;
        get().entities.clear();
        set({
          activeContactId: contactId,
          activeChatId: null,
          isGroupChat: isGroup,
          hasMore: true,
          nextBeforeSeq: null,
          visibleStart: -1,
          visibleEnd: -1,
          isLoading: false,
          error: '无法解析 chatId（请重新登录）',
          loadSeq: nextLoadSeq,
          messageIdsVersion: get().messageIdsVersion + 1,
        });
        return;
      }

      // Reset UI state immediately (instant shell).
      pendingPatches.length = 0;
      resetProjectionCaches();
      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: contactId,
        activeChatId,
        isGroupChat: isGroup,
        hasMore: true,
        nextBeforeSeq: null,
        visibleStart: -1,
        visibleEnd: -1,
        isLoading: true,
        error: null,
        loadSeq: nextLoadSeq,
        messageIdsVersion: get().messageIdsVersion + 1,
      });

      markChatSwitchStart(activeChatId, nextLoadSeq);

      // Fire-and-forget worker work; patches will stream back in batches.
      void (async () => {
        try {
          await ensureCoreReady();

          // Fast path: paint from worker memory snapshot first, then continue with authoritative refresh.
          try {
            const snapshot = await chatCoreClient.getSnapshot(activeChatId, isGroup);
            if (
              snapshot.messages.length &&
              get().activeChatId === activeChatId &&
              get().loadSeq === nextLoadSeq
            ) {
              enqueuePatches([
                {
                  kind: 'reset',
                  chatId: activeChatId,
                  loadSeq: nextLoadSeq,
                  messages: snapshot.messages,
                  hasMore: snapshot.hasMore,
                  nextBeforeSeq: snapshot.nextBeforeSeq,
                },
              ]);
            }
          } catch {
            // snapshot is best-effort only
          }

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

    setVisibleRange: (start: number, end: number) => {
      const normalizedStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : -1;
      const normalizedEnd =
        Number.isFinite(end) && normalizedStart >= 0 ? Math.max(normalizedStart, Math.floor(end)) : -1;

      const s = get();
      if (s.visibleStart === normalizedStart && s.visibleEnd === normalizedEnd) return;

      set({
        visibleStart: normalizedStart,
        visibleEnd: normalizedEnd,
      });
      rebuildVisibleEntities();
    },

    connectRealtime: () => {
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.connectRealtime();
        } catch {
          // ignore
        }
      })();
    },

    disconnectRealtime: () => {
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.disconnectRealtime();
        } catch {
          // ignore
        }
      })();
    },

    setSocketConnected: (connected: boolean) => {
      if (get().socketConnected === connected) return;
      set({ socketConnected: connected, syncPhase: connected ? 'live' : 'disconnected' });

      // Let the worker decide whether to start long-poll sync fallback.
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.setConnectivity(connected);
        } catch {
          // ignore (e.g. not authenticated yet)
        }
      })();
    },

    sendRealtimeMessage: async (payload) => {
      if (!payload?.content) {
        return { success: false, error: 'EMPTY_MESSAGE' };
      }

      try {
        await ensureCoreReady();
        return await chatCoreClient.sendSocketMessage(payload);
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'SEND_FAILED',
        };
      }
    },

    joinRealtimeRoom: (roomId: string) => {
      if (!roomId) return;
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.joinRoom(roomId);
        } catch {
          // ignore
        }
      })();
    },

    leaveRealtimeRoom: (roomId: string) => {
      if (!roomId) return;
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.leaveRoom(roomId);
        } catch {
          // ignore
        }
      })();
    },

    markChatRead: (chatId: string, seq: number) => {
      if (!chatId || typeof seq !== 'number' || seq <= 0) return;
      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.markChatRead(chatId, seq);
        } catch {
          // ignore
        }
      })();
    },

    prefetchChat: (targetId: string, isGroup = false) => {
      get().prefetchChats([{ targetId, isGroup }]);
    },

    prefetchChats: (targets) => {
      if (!Array.isArray(targets) || targets.length === 0) return;

      const activeChatId = get().activeChatId;
      const now = Date.now();
      const accepted: Array<{ chatId: string; isGroup: boolean }> = [];

      for (const target of targets) {
        const chatId = resolveChatId(target?.targetId || '', !!target?.isGroup);
        if (!chatId) continue;
        if (chatId === activeChatId) continue;
        if (prefetchInFlight.has(chatId)) continue;

        const lastAt = prefetchLastAt.get(chatId) || 0;
        if (now - lastAt < PREFETCH_COOLDOWN_MS) continue;

        prefetchLastAt.set(chatId, now);
        prefetchInFlight.add(chatId);
        accepted.push({ chatId, isGroup: !!target?.isGroup });
      }

      if (!accepted.length) return;

      void (async () => {
        try {
          await ensureCoreReady();
          await chatCoreClient.prefetchChats(accepted);
        } catch {
          // ignore
        } finally {
          for (const target of accepted) {
            prefetchInFlight.delete(target.chatId);
          }
        }
      })();
    },

    searchActiveChat: async (query: string, limit = 50) => {
      const { activeChatId, activeContactId, isGroupChat } = get();
      if (!activeChatId || !activeContactId) return [];

      const keyword = query.trim();
      if (!keyword) return [];

      try {
        await ensureCoreReady();
        return await chatCoreClient.searchMessages(activeChatId, isGroupChat, keyword, limit);
      } catch {
        return [];
      }
    },

    loadMessageContext: async (seq: number, limit = 30) => {
      const { activeChatId, activeContactId } = get();
      if (!activeChatId || !activeContactId) return [];
      if (!Number.isFinite(seq) || seq <= 0) return [];

      const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

      try {
        await ensureCoreReady();
        const context = await chatCoreClient.getMessageContext(
          activeChatId,
          Math.floor(seq),
          normalizedLimit,
        );
        return Array.isArray(context?.messages) ? context.messages : [];
      } catch {
        return [];
      }
    },

    loadMoreMessages: async () => {
      const { activeChatId, activeContactId, hasMore, isLoading, loadSeq } = get();
      if (!activeChatId || !activeContactId) return;
      if (isLoading || !hasMore) return;

      set({ isLoading: true, error: null });
      try {
        await ensureCoreReady();
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

      // Unified cursor paging is fully managed inside ChatCoreWorker.
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
      trimIngestQueue();
      flushIngestQueue();
    },

    ingestSocketMessage: (raw) => {
      // Always forward socket messages to worker so its caches stay warm even when UI is in AI mode.
      if (!raw) return;
      enqueueRealtimeEvent({ type: 'message', payload: raw });
      flushRealtimeQueue();
    },

    ingestSocketMessages: (rawMessages) => {
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) return;
      enqueueRealtimeBatch(rawMessages.map((payload) => ({ type: 'message', payload } as SocketRealtimeEvent)));
      flushRealtimeQueue();
    },

    ingestRealtimeEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      enqueueRealtimeBatch(events);
      flushRealtimeQueue();
    },

    ingestPresenceEvent: (event) => {
      if (!event?.userId) return;
      enqueueRealtimeEvent({
        type: 'presence',
        payload: { userId: event.userId, isOnline: !!event.isOnline, lastSeen: event.lastSeen },
      });
      flushRealtimeQueue();
    },

    ingestPresenceEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event?.userId) continue;
        batch.push({
          type: 'presence',
          payload: { userId: event.userId, isOnline: !!event.isOnline, lastSeen: event.lastSeen },
        });
      }
      if (!batch.length) return;
      enqueueRealtimeBatch(batch);
      flushRealtimeQueue();
    },

    ingestReadReceiptEvent: (event) => {
      if (!event?.chatId || typeof event.seq !== 'number') return;
      const readCount = typeof event.readCount === 'number' ? event.readCount : 1;
      enqueueRealtimeEvent({
        type: 'readReceipt',
        payload: { chatId: event.chatId, seq: event.seq, readCount },
      });
      flushRealtimeQueue();
    },

    ingestReadReceiptEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event?.chatId || typeof event.seq !== 'number') continue;
        const readCount = typeof event.readCount === 'number' ? event.readCount : 1;
        batch.push({
          type: 'readReceipt',
          payload: { chatId: event.chatId, seq: event.seq, readCount },
        });
      }
      if (!batch.length) return;
      enqueueRealtimeBatch(batch);
      flushRealtimeQueue();
    },

    ingestGroupUpdateEvent: (event) => {
      if (!event) return;
      enqueueRealtimeEvent({ type: 'groupUpdate', payload: event });
      flushRealtimeQueue();
    },

    ingestGroupUpdateEvents: (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      const batch: SocketRealtimeEvent[] = [];
      for (const event of events) {
        if (!event) continue;
        batch.push({ type: 'groupUpdate', payload: event });
      }
      if (!batch.length) return;
      enqueueRealtimeBatch(batch);
      flushRealtimeQueue();
    },

    applyReadReceipt: (chatId, seq, readCount, currentUserId) => {
      // Worker owns the authoritative state for regular chats.
      void currentUserId;
      enqueueRealtimeEvent({
        type: 'readReceipt',
        payload: { chatId, seq, readCount: typeof readCount === 'number' ? readCount : 1 },
      });
      flushRealtimeQueue();
    },

    clearMessages: () => {
      const nextLoadSeq = get().loadSeq + 1;
      const isInAiMode = !get().activeContactId;

      if (isInAiMode) {
        resetProjectionCaches();
        set({
          aiMessages: [],
          visibleStart: -1,
          visibleEnd: -1,
          error: null,
          isLoading: false,
          loadSeq: nextLoadSeq,
        });
        return;
      }

      resetProjectionCaches();
      get().messageIds.length = 0;
      get().entities.clear();
      set({
        activeContactId: null,
        activeChatId: null,
        isGroupChat: false,
        hasMore: true,
        nextBeforeSeq: null,
        visibleStart: -1,
        visibleEnd: -1,
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
