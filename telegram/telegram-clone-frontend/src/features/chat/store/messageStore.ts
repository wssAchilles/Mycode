import { create } from 'zustand';
import type { Message } from '../../../types/chat';
import { authUtils } from '../../../services/apiClient';
import {
  AUTH_TOKENS_UPDATED_EVENT,
  authStorage,
  type AuthTokensUpdatedDetail,
} from '../../../utils/authStorage';
import chatCoreClient from '../../../core/bridge/chatCoreClient';
import type { ChatPatch, SocketMessageSendPayload } from '../../../core/chat/types';
import { resolveChatRuntimePolicy } from '../../../core/chat/rolloutPolicy';
import { runtimeFlags } from '../../../core/chat/runtimeFlags';
import { throttleWithTickEnd } from '../../../core/workers/schedulers';
import { markChatSwitchEnd, markSyncPhaseTransition } from '../../../perf/marks';
import { useChatStore } from './chatStore';
import { compactMessagePatches, type MessagePatch } from './patchCompactor';
import type { SocketRealtimeEvent } from '../../../core/chat/realtime';
import { API_BASE_URL, SOCKET_URL } from '../../../utils/apiUrl';
import type { MessageState } from './messageTypes';
import {
  compareProjectionMessages,
  estimatePatchOps,
  buildOptimisticPendingMessage,
} from './messageUtils';

// Action creators
import { createChatActions } from './actions/chatActions';
import { createRealtimeActions } from './actions/realtimeActions';
import { createLoadActions } from './actions/loadActions';
import { createPrefetchActions } from './actions/prefetchActions';
import { createIngestActions } from './actions/ingestActions';

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
      storageBackend: runtimePolicy.storageBackend,
      storageShadowIdb: runtimePolicy.storageShadowIdb,
      storageShadowReadCompare: runtimePolicy.storageShadowReadCompare,
      storageShadowReadCompareSampleRate: runtimePolicy.storageShadowReadCompareSampleRate,
      storageMigrationEnabled: runtimePolicy.storageMigrationEnabled,
      storageMigrationBatchSize: runtimePolicy.storageMigrationBatchSize,
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
  const optimisticMessageIdByTempId = new Map<string, string>();
  const deferredEntityUpdates = new Map<string, { status?: Message['status']; readCount?: number }>();
  let resolveMissingInFlight = false;
  let resolveMissingQueue = new Set<string>();
  let projectionToken = 0;

  const resetProjectionCaches = () => {
    projectionToken += 1;
    knownMessageIds.clear();
    optimisticMessageIdByTempId.clear();
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

  const removeOptimisticMappingForMessageId = (id: string) => {
    for (const [clientTempId, messageId] of optimisticMessageIdByTempId.entries()) {
      if (messageId === id) {
        optimisticMessageIdByTempId.delete(clientTempId);
      }
    }
  };

  const removeProjectionMessageById = (ids: string[], id: string): boolean => {
    const index = ids.indexOf(id);
    if (index < 0) return false;
    ids.splice(index, 1);
    knownMessageIds.delete(id);
    removeOptimisticMappingForMessageId(id);
    entityCache.delete(id);
    deferredEntityUpdates.delete(id);
    return true;
  };

  const findInsertIndex = (ids: string[], message: Message): number => {
    for (let i = 0; i < ids.length; i += 1) {
      const existing = entityCache.get(ids[i]);
      if (!existing) continue;
      if (compareProjectionMessages(message, existing) < 0) {
        return i;
      }
    }
    return ids.length;
  };

  const upsertProjectionMessage = (
    ids: string[],
    message: Message,
    opts: { optimistic?: boolean } = {},
  ): { idChanged: boolean; entityChanged: boolean } => {
    if (!message?.id) {
      return { idChanged: false, entityChanged: false };
    }

    let idChanged = false;
    let entityChanged = false;
    const clientTempId =
      typeof message.clientTempId === 'string' && message.clientTempId.trim()
        ? message.clientTempId.trim()
        : undefined;

    if (clientTempId) {
      const optimisticId = optimisticMessageIdByTempId.get(clientTempId);
      if (optimisticId && optimisticId !== message.id) {
        if (removeProjectionMessageById(ids, optimisticId)) {
          idChanged = true;
          entityChanged = true;
        }
      }
    }

    if (knownMessageIds.has(message.id)) {
      touchEntityCache(message);
      entityChanged = true;
      if (clientTempId) {
        optimisticMessageIdByTempId.set(clientTempId, message.id);
      }
      return { idChanged, entityChanged };
    }

    knownMessageIds.add(message.id);
    touchEntityCache(message);
    if (clientTempId && (opts.optimistic || message.status === 'pending')) {
      optimisticMessageIdByTempId.set(clientTempId, message.id);
    } else if (clientTempId) {
      optimisticMessageIdByTempId.delete(clientTempId);
    }
    ids.splice(findInsertIndex(ids, message), 0, message.id);
    return { idChanged: true, entityChanged: true };
  };

  const insertOptimisticPendingMessage = (payload: SocketMessageSendPayload) => {
    const optimistic = buildOptimisticPendingMessage(payload);
    if (!optimistic) return;

    const state = get();
    if (state.activeChatId !== optimistic.chatId) return;

    const result = upsertProjectionMessage(state.messageIds, optimistic, { optimistic: true });
    if (!result.idChanged && !result.entityChanged) return;
    set((current) => ({
      messageIdsVersion: result.idChanged ? current.messageIdsVersion + 1 : current.messageIdsVersion,
    }));
  };

  const removeOptimisticPendingMessage = (clientTempId?: string) => {
    if (!clientTempId) return;
    const optimisticId = optimisticMessageIdByTempId.get(clientTempId);
    if (!optimisticId) return;
    const state = get();
    if (!removeProjectionMessageById(state.messageIds, optimisticId)) return;
    optimisticMessageIdByTempId.delete(clientTempId);
    set((current) => ({
      messageIdsVersion: current.messageIdsVersion + 1,
    }));
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
          const result = upsertProjectionMessage(ids, m);
          didIdsChange = didIdsChange || result.idChanged;
          didEntityChange = didEntityChange || result.entityChanged;
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
          const result = upsertProjectionMessage(ids, m);
          didIdsChange = didIdsChange || result.idChanged;
          didEntityChange = didEntityChange || result.entityChanged;
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
        for (const m of patch.messages) {
          const result = upsertProjectionMessage(ids, m);
          didIdsChange = didIdsChange || result.idChanged;
          didEntityChange = didEntityChange || result.entityChanged;
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
          removeOptimisticMappingForMessageId(id);
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

  const syncWorkerTokensAfterAuthRefresh = (event: Event) => {
    const detail = (event as CustomEvent<AuthTokensUpdatedDetail>).detail;
    const nextAccessToken = detail?.accessToken;
    const nextRefreshToken = detail?.refreshToken;
    const userId = authUtils.getCurrentUser()?.id || '';

    if (!userId || !nextAccessToken || !coreReadyPromise) return;

    const nextKey = `${userId}:${nextAccessToken}`;
    void (async () => {
      try {
        await coreReadyPromise.catch(() => undefined);
        await chatCoreClient.updateTokens(nextAccessToken, nextRefreshToken);
        coreReadyKey = nextKey;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[message-store] worker token sync failed after auth refresh:', err);
      }
    })();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(AUTH_TOKENS_UPDATED_EVENT, syncWorkerTokensAfterAuthRefresh);
  }

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
  let workerRealtimeModeActive = false;

  const shouldBridgeLegacyRealtime = () =>
    runtimeFlags.socketLegacyRealtimeFallback || !workerRealtimeModeActive;

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
    if (!shouldBridgeLegacyRealtime()) {
      realtimeQueue.length = 0;
      realtimeInFlight = false;
      return;
    }
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

  const enqueueRealtimeBatch = (events: Array<SocketRealtimeEvent | null | undefined>) => {
    if (!shouldBridgeLegacyRealtime()) return;
    if (!Array.isArray(events) || events.length === 0) return;
    for (const event of events) {
      if (!event) continue;
      realtimeQueue.push(event);
    }
    trimRealtimeQueue();
    flushRealtimeQueue();
  };

  const enqueueRealtimeEvent = (event: SocketRealtimeEvent | null | undefined) => {
    if (!event) return;
    enqueueRealtimeBatch([event]);
  };

  // Build deps for action creators.
  const deps = {
    PREFETCH_COOLDOWN_MS,
    resetProjectionCaches,
    rebuildVisibleEntities,
    insertOptimisticPendingMessage,
    removeOptimisticPendingMessage,
    pendingPatches,
    ensureCoreReady,
    ingestQueue,
    trimIngestQueue,
    flushIngestQueue,
    enqueueRealtimeEvent,
    enqueueRealtimeBatch,
    setWorkerRealtimeMode: (active: boolean) => { workerRealtimeModeActive = active; },
    clearRealtimeQueue: () => { realtimeQueue.length = 0; realtimeInFlight = false; },
    shouldBridgeLegacyRealtime,
    prefetchInFlight,
    prefetchLastAt,
  };

  // Create action groups.
  const chatActions = createChatActions(set, get, deps);
  const realtimeActions = createRealtimeActions(set, get, deps);
  const loadActions = createLoadActions(set, get, deps);
  const prefetchActions = createPrefetchActions(set, get, deps);
  const ingestActions = createIngestActions(set, get, deps);

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

    ...chatActions,
    ...realtimeActions,
    ...loadActions,
    ...prefetchActions,
    ...ingestActions,
  };
});

// Selectors (keep call sites stable)
export const selectMessageIds = (state: MessageState) => state.messageIds;
export const selectIsLoadingMessages = (state: MessageState) => state.isLoading;
export const selectHasMoreMessages = (state: MessageState) => state.hasMore;
export const selectActiveContactId = (state: MessageState) => state.activeContactId;
