import * as Comlink from 'comlink';
import { io, type Socket } from 'socket.io-client';
import { CHAT_CORE_PROTOCOL_VERSION } from '../chat/types';
import type {
  ChatCoreApi,
  ChatCoreInit,
  ChatPatch,
  ChatPrefetchTarget,
  ChatCoreRuntimeInfo,
  ChatSyncPhase,
  LoadSeq,
  SocketMessageSendAck,
  SocketMessageSendPayload,
} from '../chat/types';
import type { Message } from '../../types/chat';
import type { SocketRealtimeEvent } from '../chat/realtime';
import { throttleWithTickEnd } from './schedulers';
import { ChatCoreStore } from '../chat/store/chatCoreStore';
import {
  loadHotChatCandidates,
  loadMessagesBeforeSeq,
  loadMessagesByIds,
  loadRecentMessages,
  loadSyncPts,
  saveMessages,
  saveSyncPts,
} from '../chat/persist/idb';
import { getChatWasmApi } from '../wasm/chat_wasm/wasm';
import { WorkerMessageSearchService } from '../chat/search/messageSearchIndex';
import { runtimeFlags } from '../chat/runtimeFlags';

type FetchPaging = { hasMore: boolean; nextBeforeSeq: number | null; nextAfterSeq?: number | null };
type FetchCursor = { beforeSeq?: number; afterSeq?: number; limit?: number };

const CHAT_CACHE_LIMIT = 30;
const RECENT_LIMIT = 50;
const PAGE_LIMIT = 50;
const INITIAL_PAGE_LIMIT = 30;
const MAX_CHAT_MESSAGES = runtimeFlags.chatMemoryWindow;
const SEARCH_CACHE_WARM_LIMIT = 800;
const SEARCH_INDEX_MAX_MESSAGES = 6_000;
const SEARCH_FALLBACK_SCAN_LIMIT = 1_600;
const SEARCH_REMOTE_CACHE_TTL_MS = 20_000;
const SEARCH_REMOTE_CACHE_MAX_KEYS = 240;
const SEARCH_REMOTE_MIN_QUERY_LEN = 2;
const SEARCH_REMOTE_REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_REMOTE_LOCAL_HIT_SKIP_RATIO = 0.8;
const PREFETCH_NETWORK_COOLDOWN_MS = 25_000;
const PREFETCH_MAX_IN_FLIGHT = 2;
const BOOT_HOT_CHAT_PREFETCH_LIMIT = 12;
const BOOT_HOT_CHAT_PREFETCH_PRIORITY_COUNT = 4;
const CHAT_CORE_WORKER_BUILD_ID = (import.meta as any)?.env?.VITE_APP_BUILD_ID || '';
const WORKER_ENV = (import.meta as any)?.env || {};
const SAFETY_CHECK_BATCH_SIZE = 24;
const SAFETY_CHECK_QUEUE_LIMIT = 640;
const SAFETY_CHECK_DEDUP_WINDOW_MS = 5 * 60_000;
const SAFETY_CHECK_HISTORY_LIMIT = 4_000;
const SYNC_CONTRACT_RETRY_COOLDOWN_MS = 30_000;

const store = new ChatCoreStore(CHAT_CACHE_LIMIT);
const searchService = new WorkerMessageSearchService(SEARCH_INDEX_MAX_MESSAGES);

let apiBaseUrl = '';
let accessToken: string | null = null;
let currentUserId: string | null = null;
let isInited = false;

let socketConnected = true;
let workerSocketEnabled = runtimeFlags.workerSocketEnabled;
let socketUrl = '';
let workerSocket: Socket | null = null;
let workerSocketConnectRequested = false;
let workerSocketHandlersBound = false;
const WORKER_SOCKET_CONNECT_THROTTLE_MS = 1_000;
let workerSocketLastConnectAttemptAt = 0;
const desiredJoinedRooms = new Set<string>();
let workerSyncFallbackEnabled = runtimeFlags.workerSyncFallback;
let workerSafetyChecksEnabled = runtimeFlags.workerSafetyChecks;
let searchTieredIndexEnabled = runtimeFlags.searchTieredIndex;
let searchTieredWasmEnabled = runtimeFlags.searchTieredWasm;
let emergencySafeModeEnabled = false;
let runtimePolicyProfile: 'baseline' | 'canary' | 'safe' = 'baseline';
let runtimePolicyLocked = false;
let runtimePolicySource: 'percent_rollout' | 'manual_locked' | 'emergency_safe_mode' | 'default' = 'default';
let runtimePolicyMatrixVersion = 'unknown';

let syncPts = 0;
let syncAuthError = false;
let syncAbort: AbortController | null = null;
let syncTask: Promise<void> | null = null;
let syncPhase: ChatSyncPhase = 'idle';

// Abort controllers for chat history fetches to avoid wasted work during fast chat switching / paging.
let chatLatestAbort: AbortController | null = null;
let chatPagingAbort: AbortController | null = null;
let activeFetchEpoch = 0;
let pagingFetchEpoch = 0;

const prefetchInFlight = new Set<string>();
const prefetchLastAt = new Map<string, number>();
const prefetchQueue: ChatPrefetchTarget[] = [];
const prefetchQueued = new Set<string>();

function dropPrefetchTarget(chatId: string) {
  prefetchInFlight.delete(chatId);
  prefetchLastAt.delete(chatId);
  prefetchQueued.delete(chatId);
  if (!prefetchQueue.length) return;

  let write = 0;
  for (let read = 0; read < prefetchQueue.length; read += 1) {
    const item = prefetchQueue[read];
    if (item?.chatId === chatId) continue;
    prefetchQueue[write] = item;
    write += 1;
  }
  prefetchQueue.length = write;
}

const SYNC_POLL_TIMEOUT_MS = 30_000;
const SYNC_DIFF_LIMIT = 100;
const SYNC_PROTOCOL_VERSION = 2;
const SYNC_WATERMARK_FIELD = 'updateId';
const CHAT_CURSOR_PROTOCOL_VERSION = 1;
const SYNC_GAP_RECOVER_COOLDOWN_MS = 1_500;
const SYNC_GAP_RECOVER_MAX_STEPS = 10;
const SYNC_GAP_RECOVER_STALL_LIMIT = 2;
const SYNC_GAP_RECOVER_STEP_DELAY_MS = 24;
const SYNC_OVERFLOW_RECOVER_THRESHOLD = Math.max(8, SYNC_DIFF_LIMIT - 4);
const SYNC_EMPTY_POLL_FORCE_RECOVER_ROUNDS = 3;
const SYNC_BACKOFF_JITTER_MS = 180;
const SYNC_IDLE_LOOP_DELAY_MS = 320;
const SYNC_DISCONNECT_GRACE_MS = 800;

let syncGapRecoverInFlight = false;
let syncGapRecoverLastStartedAt = 0;
let reconnectGapRecoverAbort: AbortController | null = null;
let syncLoopGeneration = 0;
let syncStartGraceTimer: ReturnType<typeof setTimeout> | null = null;
let syncContractValidatedAt = 0;
let syncContractError: string | null = null;
let syncContractBackoffUntil = 0;

const pendingSafetyChecks = new Set<string>();
const recentSafetyChecks = new Map<string, number>();
let safetyCheckInFlight = false;

let wasmSeqOpsEnabled = false;
let wasmRuntimeVersion: string | null = null;
let wasmInitErrorCode: string | null = null;
let wasmApiRef: Awaited<ReturnType<typeof getChatWasmApi>> | null = null;
let workerInitCount = 0;

const workerInstanceId = Math.random().toString(36).slice(2, 10);
let traceSeq = 0;
const telemetry = {
  updatedAt: Date.now(),
  patchQueuePeak: 0,
  patchDispatchCount: 0,
  patchDroppedAsStale: 0,
  fetchCount: 0,
  fetchErrorCount: 0,
  syncLoopStarts: 0,
  gapRecoverRuns: 0,
  gapRecoverSkippedInFlight: 0,
  gapRecoverSkippedCooldown: 0,
  gapRecoverSkippedSocketConnected: 0,
  syncBackoffRetries: 0,
  socketConnects: 0,
  socketConnectErrors: 0,
  workerRestartsHint: 0,
};

const subscribers = new Set<(patches: ChatPatch[]) => void>();
let queuePressureWarned = false;

type PatchPriority = 'p0' | 'p1' | 'p2';
const patchQueues: Record<PatchPriority, ChatPatch[]> = {
  p0: [],
  p1: [],
  p2: [],
};
const PATCH_PRIORITY_ORDER: PatchPriority[] = ['p0', 'p1', 'p2'];

// Comlink transfer budget controls (industrial backpressure).
// Keep a single callback payload bounded so main-thread apply work remains predictable.
const PATCHES_PER_DISPATCH = 24;
const PATCH_OPS_PER_DISPATCH = 1_800;
const PATCH_PRIORITY_QUOTA: Record<PatchPriority, number> = {
  p0: 12,
  p1: 8,
  p2: 4,
};
const MAX_MESSAGES_PER_PATCH = 120;
const MAX_IDS_PER_PATCH = 256;
const MAX_UPDATES_PER_PATCH = 256;
const PATCH_QUEUE_WARN_AT = 300;

// Chat list meta updates (coalesced per tick).
const pendingMeta = {
  lastMessages: new Map<string, Message>(),
  unreadDelta: new Map<string, number>(),
  online: new Map<string, { isOnline: boolean; lastSeen?: string }>(),
  aiMessages: new Map<string, Message>(),
  chatUpserts: new Map<string, { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }>(),
  chatRemovals: new Set<string>(),
};

const remoteSearchCache = new Map<string, { cachedAt: number; messages: Message[] }>();
const remoteSearchInFlight = new Map<string, Promise<Message[]>>();
const remoteSearchAbortByChat = new Map<string, { key: string; controller: AbortController }>();
const searchHaystackCache = new Map<string, Map<string, string>>();

function markTelemetryUpdate() {
  telemetry.updatedAt = Date.now();
}

function resetTelemetryCounters() {
  telemetry.patchQueuePeak = 0;
  telemetry.patchDispatchCount = 0;
  telemetry.patchDroppedAsStale = 0;
  telemetry.fetchCount = 0;
  telemetry.fetchErrorCount = 0;
  telemetry.syncLoopStarts = 0;
  telemetry.gapRecoverRuns = 0;
  telemetry.gapRecoverSkippedInFlight = 0;
  telemetry.gapRecoverSkippedCooldown = 0;
  telemetry.gapRecoverSkippedSocketConnected = 0;
  telemetry.syncBackoffRetries = 0;
  telemetry.socketConnects = 0;
  telemetry.socketConnectErrors = 0;
  telemetry.workerRestartsHint = Math.max(0, workerInitCount - 1);
  markTelemetryUpdate();
}

function notePatchQueuePeak(size: number) {
  if (size > telemetry.patchQueuePeak) {
    telemetry.patchQueuePeak = size;
    markTelemetryUpdate();
  }
}

function nextTraceId(scope: string): string {
  traceSeq += 1;
  const now = Date.now().toString(36);
  const seq = traceSeq.toString(36);
  return `cw-${workerInstanceId}-${scope}-${now}-${seq}`;
}

store.setOnChatEvicted((chat) => {
  if (!chat?.chatId) return;
  searchService.clearChat(chat.chatId);
  clearRemoteSearchStateForChat(chat.chatId);
  clearSearchHaystackCacheForChat(chat.chatId);
  dropPrefetchTarget(chat.chatId);
});

const flushPatches = throttleWithTickEnd(() => {
  const hasMeta =
    pendingMeta.lastMessages.size > 0 ||
    pendingMeta.unreadDelta.size > 0 ||
    pendingMeta.online.size > 0 ||
    pendingMeta.aiMessages.size > 0 ||
    pendingMeta.chatUpserts.size > 0 ||
    pendingMeta.chatRemovals.size > 0;
  if (hasMeta) {
    const lastMessages =
      pendingMeta.lastMessages.size > 0
        ? Array.from(pendingMeta.lastMessages.entries()).map(([chatId, message]) => ({ chatId, message }))
        : undefined;
    const unreadDeltas =
      pendingMeta.unreadDelta.size > 0
        ? Array.from(pendingMeta.unreadDelta.entries()).map(([chatId, delta]) => ({ chatId, delta }))
        : undefined;
    const onlineUpdates =
      pendingMeta.online.size > 0
        ? Array.from(pendingMeta.online.entries()).map(([userId, v]) => ({ userId, ...v }))
        : undefined;
    const aiMessages =
      pendingMeta.aiMessages.size > 0
        ? Array.from(pendingMeta.aiMessages.values())
        : undefined;
    const chatUpserts =
      pendingMeta.chatUpserts.size > 0
        ? Array.from(pendingMeta.chatUpserts.entries()).map(([chatId, v]) => ({ chatId, ...v }))
        : undefined;
    const chatRemovals =
      pendingMeta.chatRemovals.size > 0
        ? Array.from(pendingMeta.chatRemovals.values()).map((chatId) => ({ chatId }))
        : undefined;

    pendingMeta.lastMessages.clear();
    pendingMeta.unreadDelta.clear();
    pendingMeta.online.clear();
    pendingMeta.aiMessages.clear();
    pendingMeta.chatUpserts.clear();
    pendingMeta.chatRemovals.clear();

    enqueuePatch({ kind: 'meta', lastMessages, unreadDeltas, onlineUpdates, aiMessages, chatUpserts, chatRemovals });
  }

  if (queuedPatchCount() === 0) return;

  const batch = runtimeFlags.workerQosPatchQueue ? dequeuePatchBatch() : dequeueAllPatches();
  if (!batch.length) return;
  telemetry.patchDispatchCount += 1;
  markTelemetryUpdate();
  subscribers.forEach((cb) => {
    try {
      // Comlink proxied function; may return a Promise, but we don't await.
      (cb as any)(batch);
    } catch {
      // ignore
    }
  });

  if (queuedPatchCount() > 0) {
    flushPatches();
  }
});

function emitPatch(patch: ChatPatch) {
  enqueuePatch(patch);
  flushPatches();
}

function isProjectionPatch(
  patch: ChatPatch,
): patch is Extract<ChatPatch, { kind: 'reset' | 'append' | 'prepend' | 'delete' | 'update' }> {
  return (
    patch.kind === 'reset' ||
    patch.kind === 'append' ||
    patch.kind === 'prepend' ||
    patch.kind === 'delete' ||
    patch.kind === 'update'
  );
}

function isStaleProjectionPatch(patch: ChatPatch): boolean {
  if (!isProjectionPatch(patch)) return false;
  if (!store.activeChatId) return true;
  if (patch.chatId !== store.activeChatId) return true;
  if (patch.loadSeq !== store.activeLoadSeq) return true;
  return false;
}

function enqueuePatch(patch: ChatPatch) {
  if (isStaleProjectionPatch(patch)) {
    telemetry.patchDroppedAsStale += 1;
    markTelemetryUpdate();
    return;
  }
  const chunks = runtimeFlags.workerQosPatchQueue ? splitPatch(patch) : [patch];
  for (const p of chunks) {
    if (isStaleProjectionPatch(p)) {
      telemetry.patchDroppedAsStale += 1;
      markTelemetryUpdate();
      continue;
    }
    const priority = getPatchPriority(p);
    const queue = patchQueues[priority];
    if (runtimeFlags.workerQosPatchQueue && coalesceTailPatch(queue, p)) continue;
    queue.push(p);
  }

  const queued = queuedPatchCount();
  notePatchQueuePeak(queued);
  if (queued >= PATCH_QUEUE_WARN_AT) {
    if (!queuePressureWarned) {
      queuePressureWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[chat-core] patch queue pressure', queued);
    }
  } else if (queuePressureWarned && queued < Math.floor(PATCH_QUEUE_WARN_AT / 2)) {
    queuePressureWarned = false;
  }
}

function splitPatch(patch: ChatPatch): ChatPatch[] {
  if (patch.kind === 'append') {
    if (patch.messages.length <= MAX_MESSAGES_PER_PATCH) return [patch];
    return chunkArray(patch.messages, MAX_MESSAGES_PER_PATCH).map((messages) => ({
      kind: 'append',
      chatId: patch.chatId,
      loadSeq: patch.loadSeq,
      messages,
    }));
  }

  if (patch.kind === 'reset') {
    if (patch.messages.length <= MAX_MESSAGES_PER_PATCH) return [patch];
    const chunks = chunkArray(patch.messages, MAX_MESSAGES_PER_PATCH);
    const out: ChatPatch[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const messages = chunks[i];
      if (i === 0) {
        out.push({
          kind: 'reset',
          chatId: patch.chatId,
          loadSeq: patch.loadSeq,
          messages,
          hasMore: patch.hasMore,
          nextBeforeSeq: patch.nextBeforeSeq,
        });
      } else {
        out.push({
          kind: 'append',
          chatId: patch.chatId,
          loadSeq: patch.loadSeq,
          messages,
        });
      }
    }
    return out;
  }

  if (patch.kind === 'prepend') {
    if (patch.messages.length <= MAX_MESSAGES_PER_PATCH) return [patch];
    const chunks = chunkArray(patch.messages, MAX_MESSAGES_PER_PATCH);
    const out: ChatPatch[] = [];
    // Apply later chunks first to keep final order correct with `unshift`.
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      out.push({
        kind: 'prepend',
        chatId: patch.chatId,
        loadSeq: patch.loadSeq,
        messages: chunks[i],
        hasMore: patch.hasMore,
        nextBeforeSeq: patch.nextBeforeSeq,
      });
    }
    return out;
  }

  if (patch.kind === 'delete') {
    if (patch.ids.length <= MAX_IDS_PER_PATCH) return [patch];
    return chunkArray(patch.ids, MAX_IDS_PER_PATCH).map((ids) => ({
      kind: 'delete',
      chatId: patch.chatId,
      loadSeq: patch.loadSeq,
      ids,
    }));
  }

  if (patch.kind === 'update') {
    if (patch.updates.length <= MAX_UPDATES_PER_PATCH) return [patch];
    return chunkArray(patch.updates, MAX_UPDATES_PER_PATCH).map((updates) => ({
      kind: 'update',
      chatId: patch.chatId,
      loadSeq: patch.loadSeq,
      updates,
    }));
  }

  return [patch];
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  if (arr.length <= chunkSize) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    out.push(arr.slice(i, i + chunkSize));
  }
  return out;
}

function getPatchPriority(patch: ChatPatch): PatchPriority {
  if (patch.kind === 'reset' || patch.kind === 'delete' || patch.kind === 'sync') return 'p0';
  if (patch.kind === 'append' || patch.kind === 'prepend' || patch.kind === 'update') return 'p1';
  return 'p2';
}

function estimatePatchOps(patch: ChatPatch): number {
  if (patch.kind === 'reset' || patch.kind === 'append' || patch.kind === 'prepend') return patch.messages.length;
  if (patch.kind === 'delete') return patch.ids.length;
  if (patch.kind === 'update') return patch.updates.length;
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
  return 1;
}

function queuedPatchCount(): number {
  return patchQueues.p0.length + patchQueues.p1.length + patchQueues.p2.length;
}

function dequeuePatchBatch(): ChatPatch[] {
  const quotas: Record<PatchPriority, number> = {
    p0: PATCH_PRIORITY_QUOTA.p0,
    p1: PATCH_PRIORITY_QUOTA.p1,
    p2: PATCH_PRIORITY_QUOTA.p2,
  };

  const batch: ChatPatch[] = [];
  let ops = 0;

  while (batch.length < PATCHES_PER_DISPATCH) {
    let progressed = false;

    for (const priority of PATCH_PRIORITY_ORDER) {
      const queue = patchQueues[priority];
      while (queue.length > 0 && isStaleProjectionPatch(queue[0])) {
        queue.shift();
      }
      if (!queue.length) continue;

      const quotaLeft = quotas[priority];
      if (quotaLeft <= 0 && batch.length > 0) continue;

      const next = queue[0];
      const nextOps = estimatePatchOps(next);
      if (batch.length > 0 && ops + nextOps > PATCH_OPS_PER_DISPATCH) continue;

      queue.shift();
      batch.push(next);
      ops += nextOps;
      quotas[priority] = Math.max(0, quotaLeft - 1);
      progressed = true;

      if (batch.length >= PATCHES_PER_DISPATCH) break;
    }

    if (!progressed) break;
  }

  if (!batch.length) {
    for (const priority of PATCH_PRIORITY_ORDER) {
      const queue = patchQueues[priority];
      while (queue.length > 0 && isStaleProjectionPatch(queue[0])) {
        queue.shift();
      }
      if (!queue.length) continue;
      const next = queue.shift();
      if (next) {
        batch.push(next);
      }
      break;
    }
  }

  return batch;
}

function dequeueAllPatches(): ChatPatch[] {
  if (queuedPatchCount() === 0) return [];
  const out: ChatPatch[] = [];
  for (const priority of PATCH_PRIORITY_ORDER) {
    const queue = patchQueues[priority];
    if (!queue.length) continue;
    for (const patch of queue) {
      if (isStaleProjectionPatch(patch)) continue;
      out.push(patch);
    }
    queue.length = 0;
  }
  return out;
}

function coalesceTailPatch(queue: ChatPatch[], next: ChatPatch): boolean {
  if (!queue.length) return false;
  const last = queue[queue.length - 1];

  if (next.kind === 'append' && last.kind === 'append') {
    if (next.chatId !== last.chatId || next.loadSeq !== last.loadSeq) return false;
    const merged = last.messages.concat(next.messages);
    if (merged.length > MAX_MESSAGES_PER_PATCH) return false;
    queue[queue.length - 1] = {
      kind: 'append',
      chatId: last.chatId,
      loadSeq: last.loadSeq,
      messages: merged,
    };
    return true;
  }

  if (next.kind === 'delete' && last.kind === 'delete') {
    if (next.chatId !== last.chatId || next.loadSeq !== last.loadSeq) return false;
    const merged = last.ids.concat(next.ids);
    if (merged.length > MAX_IDS_PER_PATCH) return false;
    queue[queue.length - 1] = {
      kind: 'delete',
      chatId: last.chatId,
      loadSeq: last.loadSeq,
      ids: merged,
    };
    return true;
  }

  if (next.kind === 'update' && last.kind === 'update') {
    if (next.chatId !== last.chatId || next.loadSeq !== last.loadSeq) return false;
    const merged = last.updates.concat(next.updates);
    if (merged.length > MAX_UPDATES_PER_PATCH) return false;
    queue[queue.length - 1] = {
      kind: 'update',
      chatId: last.chatId,
      loadSeq: last.loadSeq,
      updates: merged,
    };
    return true;
  }

  return false;
}

function queueLastMessageMeta(listId: string, message: Message) {
  pendingMeta.lastMessages.set(listId, message);
  flushPatches();
}

function queueUnreadDeltaMeta(listId: string, delta: number) {
  if (!delta) return;
  pendingMeta.unreadDelta.set(listId, (pendingMeta.unreadDelta.get(listId) || 0) + delta);
  flushPatches();
}

function queueOnlineMeta(userId: string, isOnline: boolean, lastSeen?: string) {
  pendingMeta.online.set(userId, { isOnline, lastSeen });
  flushPatches();
}

function queueAiMessageMeta(message: Message) {
  if (!message?.id) return;
  pendingMeta.aiMessages.set(message.id, message);
  flushPatches();
}

function queueChatUpsertMeta(chatId: string, patch: { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }) {
  // If the chat was removed in this tick, keep the removal.
  if (pendingMeta.chatRemovals.has(chatId)) return;

  const cur = pendingMeta.chatUpserts.get(chatId);
  if (!cur) {
    pendingMeta.chatUpserts.set(chatId, patch);
  } else {
    pendingMeta.chatUpserts.set(chatId, {
      isGroup: patch.isGroup,
      title: patch.title ?? cur.title,
      avatarUrl: patch.avatarUrl ?? cur.avatarUrl,
      memberCount: typeof patch.memberCount === 'number' ? patch.memberCount : cur.memberCount,
    });
  }
  flushPatches();
}

function isAiChatId(chatId: string): boolean {
  if (!currentUserId) return false;
  return parsePrivateChatOtherUserId(chatId, currentUserId) === 'ai';
}

function queueChatRemovalMeta(chatId: string) {
  pendingMeta.chatUpserts.delete(chatId);
  pendingMeta.chatRemovals.add(chatId);
  flushPatches();
}

function rememberSafetyChecked(messageId: string, now = Date.now()) {
  recentSafetyChecks.set(messageId, now);
  if (recentSafetyChecks.size <= SAFETY_CHECK_HISTORY_LIMIT) return;

  const entries = Array.from(recentSafetyChecks.entries()).sort((a, b) => a[1] - b[1]);
  const overflow = entries.length - SAFETY_CHECK_HISTORY_LIMIT;
  for (let i = 0; i < overflow; i += 1) {
    recentSafetyChecks.delete(entries[i][0]);
  }
}

function enqueueSenderSafetyChecks(messages: Message[]) {
  if (!workerSafetyChecksEnabled) return;
  if (!currentUserId || !messages.length) return;

  const now = Date.now();
  for (const msg of messages) {
    const messageId = msg?.id ? String(msg.id) : '';
    if (!messageId) continue;
    if (msg.senderId !== currentUserId) continue;
    if (msg.type === 'system') continue;

    const checkedAt = recentSafetyChecks.get(messageId);
    if (checkedAt && now - checkedAt < SAFETY_CHECK_DEDUP_WINDOW_MS) continue;

    pendingSafetyChecks.add(messageId);
    rememberSafetyChecked(messageId, now);
    if (pendingSafetyChecks.size >= SAFETY_CHECK_QUEUE_LIMIT) break;
  }

  flushSafetyChecks();
}

async function performSafetyChecksBatch(ids: string[]): Promise<void> {
  if (!workerSafetyChecksEnabled) return;
  if (!ids.length || !currentUserId) return;

  const endpoint = resolveWorkerSafetyEndpoint();
  if (!endpoint) return;

  const payload = {
    items: ids.map((postId) => ({
      postId,
      userId: currentUserId,
    })),
  };

  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    }));
  } catch {
    return;
  }

  if (isAuthErrorStatus(res.status)) {
    syncAuthError = true;
    setSyncPhase('auth_error', 'safety_auth');
    return;
  }

  if (!res.ok) return;

  const fallbackHeader =
    res.headers.get('x-ml-fallback')
    || res.headers.get('X-ML-Fallback')
    || '';
  if (String(fallbackHeader).toLowerCase() === 'true') {
    return;
  }

  const data = unwrapSuccessData(json);
  const results = Array.isArray(data?.results) ? data.results : Array.isArray(json?.results) ? json.results : [];
  if (!results.length) return;

  for (const item of results) {
    const safe = !!item?.safe;
    if (safe) continue;
    const postId = item?.postId ? String(item.postId) : '';
    const reason = item?.reason ? String(item.reason) : 'blocked';
    if (!postId) continue;
    // eslint-disable-next-line no-console
    console.warn('[chat-core] sender content flagged by VF', { postId, reason });
  }
}

const flushSafetyChecks = throttleWithTickEnd(() => {
  if (safetyCheckInFlight) return;
  if (!pendingSafetyChecks.size) return;
  if (!workerSafetyChecksEnabled) {
    pendingSafetyChecks.clear();
    return;
  }

  safetyCheckInFlight = true;
  void (async () => {
    try {
      while (pendingSafetyChecks.size > 0) {
        const ids = Array.from(pendingSafetyChecks.values()).slice(0, SAFETY_CHECK_BATCH_SIZE);
        for (const id of ids) {
          pendingSafetyChecks.delete(id);
        }
        if (!ids.length) break;
        await performSafetyChecksBatch(ids);
      }
    } finally {
      safetyCheckInFlight = false;
      if (pendingSafetyChecks.size > 0) {
        flushSafetyChecks();
      }
    }
  })();
});

function buildAuthHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  telemetry.fetchCount += 1;
  markTelemetryUpdate();

  const traceId = nextTraceId('http');
  const headers = {
    ...buildAuthHeaders(),
    'X-Chat-Trace-Id': traceId,
    'X-Chat-Worker-Build': CHAT_CORE_WORKER_BUILD_ID || 'dev',
    'X-Chat-Runtime-Profile': runtimePolicyProfile,
    ...(init.headers as any),
  };

  try {
    const res = await fetch(url, {
      method: init.method || 'GET',
      headers,
      body: init.body,
      signal: init.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, json };
  } catch (err) {
    telemetry.fetchErrorCount += 1;
    markTelemetryUpdate();
    throw err;
  }
}

function isAuthErrorStatus(status: number) {
  return status === 401 || status === 403;
}

function unwrapSuccessData(json: any): any {
  if (json && json.success === true && json.data !== undefined) return json.data;
  return json;
}

function readSyncProtocolVersion(input: unknown): number | null {
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  const next = Math.floor(n);
  return next > 0 ? next : null;
}

function readSyncWatermarkField(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const next = input.trim();
  return next ? next : null;
}

function assertSyncContract(res: Response, data: any): void {
  const headerProtocol = readSyncProtocolVersion(res.headers.get('x-sync-protocol-version'));
  const bodyProtocol = readSyncProtocolVersion(data?.protocolVersion)
    ?? readSyncProtocolVersion(data?.state?.protocolVersion);
  const protocolVersion = headerProtocol ?? bodyProtocol;

  if (protocolVersion !== SYNC_PROTOCOL_VERSION) {
    const found = protocolVersion === null ? 'missing' : String(protocolVersion);
    syncContractError = `SYNC_PROTOCOL_MISMATCH:${found}`;
    syncContractBackoffUntil = Date.now() + SYNC_CONTRACT_RETRY_COOLDOWN_MS;
    throw new Error(syncContractError);
  }

  const headerWatermark = readSyncWatermarkField(res.headers.get('x-sync-watermark-field'));
  const bodyWatermark = readSyncWatermarkField(data?.watermarkField)
    ?? readSyncWatermarkField(data?.state?.watermarkField);
  const watermarkField = headerWatermark ?? bodyWatermark;

  if (watermarkField !== SYNC_WATERMARK_FIELD) {
    const found = watermarkField || 'missing';
    syncContractError = `SYNC_WATERMARK_MISMATCH:${found}`;
    syncContractBackoffUntil = Date.now() + SYNC_CONTRACT_RETRY_COOLDOWN_MS;
    throw new Error(syncContractError);
  }

  syncContractError = null;
  syncContractValidatedAt = Date.now();
  syncContractBackoffUntil = 0;
}

function isSyncContractError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '');
  return message.startsWith('SYNC_PROTOCOL_MISMATCH') || message.startsWith('SYNC_WATERMARK_MISMATCH');
}

function withApiBase(url?: string | null): string | undefined {
  if (!url) return url || undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${apiBaseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

function resolveWasmVersion(api: Awaited<ReturnType<typeof getChatWasmApi>>): string | null {
  if (!api) return null;
  try {
    const version = api.chat_wasm_version();
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}

function deriveSocketUrl(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.pathname.startsWith('/api')) {
      u.pathname = '';
    }
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return apiUrl.replace(/\/$/, '');
  }
}

function readEnvBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveWorkerSafetyEndpoint(): string {
  const apiRoot = apiBaseUrl ? normalizeBaseUrl(apiBaseUrl) : '';
  const allowDirect = readEnvBool(WORKER_ENV.VITE_ALLOW_DIRECT_ML, false);
  const directVfEndpoint = typeof WORKER_ENV.VITE_VF_ENDPOINT === 'string' ? WORKER_ENV.VITE_VF_ENDPOINT.trim() : '';
  const mlProxyBase =
    typeof WORKER_ENV.VITE_ML_PROXY_URL === 'string' && WORKER_ENV.VITE_ML_PROXY_URL.trim()
      ? normalizeBaseUrl(WORKER_ENV.VITE_ML_PROXY_URL.trim())
      : apiRoot
        ? `${apiRoot}/api/ml`
        : '';

  if (allowDirect && directVfEndpoint) {
    return directVfEndpoint;
  }

  if (mlProxyBase) {
    return `${mlProxyBase}/vf/check`;
  }

  return '';
}

function cancelSyncStartGraceTimer() {
  if (!syncStartGraceTimer) return;
  clearTimeout(syncStartGraceTimer);
  syncStartGraceTimer = null;
}

function scheduleSyncLoopStart(reason: string) {
  cancelSyncStartGraceTimer();
  if (!workerSyncFallbackEnabled) {
    setSyncPhase(socketConnected ? 'live' : 'idle', `${reason}_fallback_disabled`);
    return;
  }

  const now = Date.now();
  const contractBackoffMs =
    syncContractBackoffUntil > now ? syncContractBackoffUntil - now : 0;
  const delayMs = Math.max(SYNC_DISCONNECT_GRACE_MS, contractBackoffMs);

  syncStartGraceTimer = setTimeout(() => {
    syncStartGraceTimer = null;
    if (!isInited || socketConnected || syncAuthError) return;
    startSyncLoop();
  }, delayMs);
}

async function setConnectivityFromSocket(next: boolean, reason: string) {
  const prev = socketConnected;
  socketConnected = next;
  if (next) {
    cancelSyncStartGraceTimer();
    if (prev && syncPhase === 'live') return;
    stopSyncLoop();
    setSyncPhase('live', reason);
    return;
  }

  if (!prev && syncTask) {
    setSyncPhase('disconnected', reason);
    return;
  }

  setSyncPhase('disconnected', reason);
  scheduleSyncLoopStart(reason);
}

function detachWorkerSocket() {
  if (!workerSocket) return;
  try {
    workerSocket.removeAllListeners();
    workerSocket.disconnect();
  } catch {
    // ignore
  }
  workerSocket = null;
  workerSocketHandlersBound = false;
  workerSocketConnectRequested = false;
  workerSocketLastConnectAttemptAt = 0;
}

function requestWorkerSocketConnect(force = false) {
  if (!workerSocket) return;
  const now = Date.now();
  if (!force && now - workerSocketLastConnectAttemptAt < WORKER_SOCKET_CONNECT_THROTTLE_MS) {
    return;
  }
  workerSocketLastConnectAttemptAt = now;
  workerSocketConnectRequested = true;
  workerSocket.connect();
}

function bindWorkerSocketHandlers(socket: Socket) {
  if (workerSocketHandlersBound) return;
  workerSocketHandlersBound = true;

  socket.on('connect', () => {
    telemetry.socketConnects += 1;
    markTelemetryUpdate();
    workerSocketConnectRequested = true;
    workerSocketLastConnectAttemptAt = Date.now();
    if (accessToken) {
      socket.emit('authenticate', { token: accessToken });
    }
    if (desiredJoinedRooms.size) {
      for (const roomId of desiredJoinedRooms.values()) {
        socket.emit('joinRoom', { roomId });
      }
    }
    void setConnectivityFromSocket(true, 'worker_socket_connected');
  });

  socket.on('disconnect', () => {
    workerSocketConnectRequested = false;
    void setConnectivityFromSocket(false, 'worker_socket_disconnected');
  });

  socket.on('connect_error', () => {
    telemetry.socketConnectErrors += 1;
    markTelemetryUpdate();
    workerSocketConnectRequested = false;
    void setConnectivityFromSocket(false, 'worker_socket_connect_error');
  });

  socket.on('authError', () => {
    syncAuthError = true;
    setSyncPhase('auth_error', 'socket_auth');
  });

  socket.on('realtimeBatch', (events: SocketRealtimeEvent[]) => {
    if (!Array.isArray(events) || !events.length) return;
    void apiImpl.ingestRealtimeEvents(events);
  });
}

async function connectWorkerSocketInternal(force = false): Promise<void> {
  if (!workerSocketEnabled) return;
  if (!isInited) return;
  if (!accessToken) return;
  if (!currentUserId) return;
  if (!socketUrl) {
    socketUrl = deriveSocketUrl(apiBaseUrl);
  }

  if (workerSocket) {
    if (!workerSocket.connected && (force || !workerSocketConnectRequested)) {
      requestWorkerSocketConnect(force);
    }
    return;
  }

  workerSocketConnectRequested = true;
  workerSocketLastConnectAttemptAt = Date.now();
  try {
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      forceNew: true,
    });
    workerSocket = socket;
    bindWorkerSocketHandlers(socket);
  } catch (err) {
    telemetry.socketConnectErrors += 1;
    markTelemetryUpdate();
    throw err;
  }
}

async function emitWorkerSocket(event: string, payload: any): Promise<void> {
  if (!workerSocketEnabled) return;
  await connectWorkerSocketInternal();
  if (!workerSocket) throw new Error('SOCKET_NOT_AVAILABLE');
  if (!workerSocket.connected) {
    requestWorkerSocketConnect();
    throw new Error('SOCKET_NOT_CONNECTED');
  }
  workerSocket.emit(event as any, payload as any);
}

async function emitWorkerSocketWithAck(
  event: string,
  payload: any,
  timeoutMs = 10_000,
): Promise<SocketMessageSendAck> {
  if (!workerSocketEnabled) {
    return { success: false, error: 'SOCKET_DISABLED' };
  }

  await connectWorkerSocketInternal();
  if (!workerSocket) {
    return { success: false, error: 'SOCKET_NOT_AVAILABLE' };
  }
  if (!workerSocket.connected) {
    requestWorkerSocketConnect();
    return { success: false, error: 'SOCKET_NOT_CONNECTED' };
  }

  return new Promise<SocketMessageSendAck>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ success: false, error: 'ACK_TIMEOUT' });
    }, timeoutMs);

    workerSocket!.emit(event as any, payload as any, (ack: SocketMessageSendAck) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ack || typeof ack.success !== 'boolean') {
        resolve({ success: false, error: 'ACK_INVALID' });
        return;
      }
      resolve(ack);
    });
  });
}

function normalizeSyncMessage(raw: any): Message | null {
  if (!raw) return null;

  const id = String(raw.id || raw._id || '');
  const chatId = raw.chatId ? String(raw.chatId) : '';
  if (!id || !chatId) return null;

  const chatType: Message['chatType'] =
    raw.chatType === 'group' || raw.isGroupChat || chatId.startsWith('g:') ? 'group' : 'private';

  const senderId = String(raw.senderId || raw.sender || raw.userId || 'unknown');
  const senderUsername = String(raw.senderUsername || raw.username || '未知用户');
  const receiverId = raw.receiverId || raw.receiver;

  const seq = typeof raw.seq === 'number' ? raw.seq : Number.isFinite(Number(raw.seq)) ? Number(raw.seq) : undefined;

  const timestamp =
    typeof raw.timestamp === 'string'
      ? raw.timestamp
      : raw.timestamp?.toString?.() || new Date().toISOString();

  return {
    id,
    chatId,
    chatType,
    seq,
    content: String(raw.content ?? ''),
    senderId,
    senderUsername,
    userId: senderId,
    username: senderUsername,
    receiverId: receiverId ? String(receiverId) : undefined,
    groupId: raw.groupId ? String(raw.groupId) : undefined,
    timestamp,
    type: (raw.type || 'text') as Message['type'],
    isGroupChat: chatType === 'group',
    status: (raw.status || 'delivered') as Message['status'],
    readCount: typeof raw.readCount === 'number' ? raw.readCount : undefined,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
    fileUrl: raw.fileUrl || undefined,
    fileName: raw.fileName || undefined,
    fileSize: typeof raw.fileSize === 'number' ? raw.fileSize : undefined,
    mimeType: raw.mimeType || undefined,
    thumbnailUrl: raw.thumbnailUrl || undefined,
  };
}

function normalizeSyncMessages(raw: any[]): Message[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: Message[] = [];
  for (const r of raw) {
    const m = normalizeSyncMessage(r);
    if (m) out.push(m);
  }
  return out;
}

function normalizeSyncUpdates(raw: any[], minUpdateIdExclusive: number): { updates: any[]; maxUpdateId: number } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { updates: [], maxUpdateId: minUpdateIdExclusive };
  }

  const byUpdateId = new Map<number, any>();
  let maxUpdateId = minUpdateIdExclusive;

  for (const item of raw) {
    const updateId = Number(item?.updateId);
    if (!Number.isFinite(updateId)) continue;
    if (updateId <= minUpdateIdExclusive) continue;
    byUpdateId.set(updateId, item);
    if (updateId > maxUpdateId) maxUpdateId = updateId;
  }

  if (!byUpdateId.size) {
    return { updates: [], maxUpdateId };
  }

  const updates = Array.from(byUpdateId.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  return { updates, maxUpdateId };
}

async function commitSyncPts(nextPts: number): Promise<void> {
  if (!currentUserId) return;
  if (!Number.isFinite(nextPts) || nextPts <= syncPts) return;
  syncPts = nextPts;
  saveSyncPts(currentUserId, syncPts).catch(() => undefined);
}

function setSyncPhase(next: ChatSyncPhase, reason?: string) {
  if (syncPhase === next) return;
  syncPhase = next;
  emitPatch({
    kind: 'sync',
    phase: syncPhase,
    pts: syncPts,
    socketConnected,
    reason,
    updatedAt: Date.now(),
  });
}

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function stopReconnectGapRecover() {
  if (reconnectGapRecoverAbort) {
    reconnectGapRecoverAbort.abort();
  }
  reconnectGapRecoverAbort = null;
}

function canStartGapRecover(force = false): boolean {
  if (syncGapRecoverInFlight) {
    telemetry.gapRecoverSkippedInFlight += 1;
    markTelemetryUpdate();
    return false;
  }
  if (force) return true;
  if (Date.now() - syncGapRecoverLastStartedAt >= SYNC_GAP_RECOVER_COOLDOWN_MS) {
    return true;
  }
  telemetry.gapRecoverSkippedCooldown += 1;
  markTelemetryUpdate();
  return false;
}

async function fetchSyncState(signal: AbortSignal): Promise<number | null> {
  const url = `${apiBaseUrl}/api/sync/state`;
  const { res, json } = await fetchJson(url, { signal });
  if (res.status === 404) return null;
  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
  const data = unwrapSuccessData(json);
  assertSyncContract(res, data);
  const pts = Number(data?.pts ?? data?.updateId ?? 0);
  return Number.isFinite(pts) ? pts : 0;
}

async function fetchSyncDifference(fromPts: number, signal: AbortSignal): Promise<{
  updates: any[];
  messages: any[];
  statePts: number;
  isLatest: boolean;
} | null> {
  const url = `${apiBaseUrl}/api/sync/difference`;
  const { res, json } = await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({ pts: fromPts, limit: SYNC_DIFF_LIMIT }),
    signal,
  });
  if (res.status === 404) return null;
  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
  const data = unwrapSuccessData(json);
  assertSyncContract(res, data);
  const updates = Array.isArray(data?.updates) ? data.updates : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const statePts = Number(data?.state?.pts ?? data?.state?.updateId ?? fromPts);
  const isLatest = !!data?.isLatest;
  return { updates, messages, statePts: Number.isFinite(statePts) ? statePts : fromPts, isLatest };
}

async function fetchSyncUpdates(fromPts: number, signal: AbortSignal): Promise<{
  updates: any[];
  messages: any[];
  statePts: number;
} | null> {
  const params = new URLSearchParams({
    pts: String(fromPts),
    timeout: String(SYNC_POLL_TIMEOUT_MS),
  });
  const url = `${apiBaseUrl}/api/sync/updates?${params.toString()}`;
  const { res, json } = await fetchJson(url, { signal });
  if (res.status === 404) return null;
  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
  const data = unwrapSuccessData(json);
  assertSyncContract(res, data);
  const updates = Array.isArray(data?.updates) ? data.updates : [];
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const statePts = Number(data?.state?.pts ?? data?.state?.updateId ?? fromPts);
  return { updates, messages, statePts: Number.isFinite(statePts) ? statePts : fromPts };
}

function parsePrivateChatOtherUserId(chatId: string, me: string): string | null {
  if (!chatId.startsWith('p:')) return null;
  const parts = chatId.substring(2).split(':').filter(Boolean);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (a === me) return b;
  if (b === me) return a;
  return null;
}

function chatListIdFromChatId(chatId: string, isGroup: boolean): string | null {
  if (isGroup) {
    if (chatId.startsWith('g:')) return chatId.substring(2);
    return chatId;
  }
  if (!currentUserId) return null;
  return parsePrivateChatOtherUserId(chatId, currentUserId);
}

async function fetchGroupMeta(groupId: string): Promise<{ title?: string; avatarUrl?: string; memberCount?: number } | null> {
  const url = `${apiBaseUrl}/api/groups/${encodeURIComponent(groupId)}`;
  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(url));
  } catch {
    return null;
  }

  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) return null;

  // apiClient returns plain json; some endpoints may wrap { success, data }.
  const data = unwrapSuccessData(json);
  const group = data?.group || data;
  if (!group) return null;

  const title = typeof group?.name === 'string' ? group.name : undefined;
  const avatarUrl = typeof group?.avatarUrl === 'string' ? withApiBase(group.avatarUrl) : undefined;
  const memberCount = Number(group?.memberCount);
  return {
    title,
    avatarUrl,
    memberCount: Number.isFinite(memberCount) ? memberCount : undefined,
  };
}

async function processGroupUpdateEvent(raw: any): Promise<void> {
  if (!raw || !currentUserId) return;

  const action = String(raw.action || '');
  const groupId = raw.groupId ? String(raw.groupId) : '';
  if (!action || !groupId) return;

  // Sidebar id for groups is the raw groupId (no g: prefix).
  const listId = groupId;

  if (action === 'group_updated') {
    const title = typeof raw.name === 'string' ? raw.name : typeof raw.groupName === 'string' ? raw.groupName : undefined;
    const avatarUrl = typeof raw.avatarUrl === 'string' ? withApiBase(raw.avatarUrl) : undefined;
    queueChatUpsertMeta(listId, { isGroup: true, title, avatarUrl });
    return;
  }

  if (action === 'group_deleted') {
    queueChatRemovalMeta(listId);
    return;
  }

  if (action === 'member_removed' || action === 'member_left') {
    const targetId = raw.targetId ? String(raw.targetId) : '';
    if (targetId && targetId === currentUserId) {
      queueChatRemovalMeta(listId);
      desiredJoinedRooms.delete(groupId);
      emitWorkerSocket('leaveRoom', { roomId: groupId }).catch(() => undefined);
    }
    return;
  }

  if (action === 'member_added') {
    const memberIds = Array.isArray(raw.memberIds)
      ? raw.memberIds.map(String)
      : Array.isArray(raw.members)
        ? raw.members.map((m: any) => String(m?.user?.id || m?.userId || m?.user?.userId || '')).filter(Boolean)
        : [];

    if (!memberIds.includes(currentUserId)) return;

    // Upsert group into sidebar without a full reload.
    desiredJoinedRooms.add(groupId);
    emitWorkerSocket('joinRoom', { roomId: groupId }).catch(() => undefined);
    try {
      const meta = await fetchGroupMeta(groupId);
      queueChatUpsertMeta(listId, {
        isGroup: true,
        title: meta?.title || '群聊',
        avatarUrl: meta?.avatarUrl,
        memberCount: meta?.memberCount,
      });
    } catch {
      queueChatUpsertMeta(listId, { isGroup: true, title: '群聊' });
    }
    return;
  }
}

function validateCursorPage(
  chatId: string,
  cursor: FetchCursor,
  messages: Message[],
): string | null {
  let prevSeq = 0;
  const seenIds = new Set<string>();
  for (const msg of messages) {
    if (!msg?.id) continue;
    if (seenIds.has(msg.id)) {
      return `duplicate_message_id:${msg.id}`;
    }
    seenIds.add(msg.id);

    if (msg.chatId && msg.chatId !== chatId) {
      return `chat_mismatch:${msg.chatId}`;
    }

    const seq = typeof msg.seq === 'number' ? msg.seq : Number.NaN;
    if (!Number.isFinite(seq) || seq <= 0) continue;

    if (seq <= prevSeq) {
      return `non_monotonic_seq:${seq}`;
    }
    prevSeq = seq;

    if (typeof cursor.beforeSeq === 'number' && seq >= cursor.beforeSeq) {
      return `before_seq_violation:${seq}>=${cursor.beforeSeq}`;
    }
    if (typeof cursor.afterSeq === 'number' && seq <= cursor.afterSeq) {
      return `after_seq_violation:${seq}<=${cursor.afterSeq}`;
    }
  }
  return null;
}

function readCursorMode(input: unknown): 'before' | 'after' | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === 'before' || value === 'after') return value;
  return null;
}

function readCursorProtocolVersion(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  const next = Math.floor(value);
  return next > 0 ? next : null;
}

function readCursorCanonicalChatId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return value ? value : null;
}

function assertCursorContract(
  res: Response,
  json: any,
  chatId: string,
  cursor: FetchCursor,
  resolvedLimit: number,
  paging: FetchPaging,
): string | null {
  const expectedMode: 'before' | 'after' = typeof cursor.afterSeq === 'number' ? 'after' : 'before';

  const headerProtocol = readCursorProtocolVersion(res.headers.get('x-message-cursor-protocol-version'));
  const bodyProtocol = readCursorProtocolVersion(json?.protocolVersion)
    ?? readCursorProtocolVersion(json?.paging?.protocolVersion);
  const protocolVersion = headerProtocol ?? bodyProtocol;
  if (protocolVersion !== CHAT_CURSOR_PROTOCOL_VERSION) {
    return `protocol_version_mismatch:${protocolVersion ?? 'missing'}`;
  }

  const headerMode = readCursorMode(res.headers.get('x-message-cursor-mode'));
  const bodyMode = readCursorMode(json?.paging?.mode) ?? readCursorMode(json?.mode);
  const mode = headerMode ?? bodyMode;
  if (mode !== expectedMode) {
    return `mode_mismatch:${mode ?? 'missing'}!=${expectedMode}`;
  }

  const headerCanonical = readCursorCanonicalChatId(res.headers.get('x-message-cursor-canonical-chatid'));
  const bodyCanonical = readCursorCanonicalChatId(json?.canonicalChatId)
    ?? readCursorCanonicalChatId(json?.paging?.canonicalChatId);
  const canonicalChatId = headerCanonical ?? bodyCanonical;
  if (!canonicalChatId) {
    return 'canonical_chatid_missing';
  }
  if (canonicalChatId !== chatId) {
    return `canonical_chatid_mismatch:${canonicalChatId}`;
  }

  const headerLimit = readCursorProtocolVersion(res.headers.get('x-message-cursor-limit'));
  if (headerLimit !== null && headerLimit !== resolvedLimit) {
    return `limit_mismatch:${headerLimit}!=${resolvedLimit}`;
  }

  if (mode === 'before' && typeof paging.nextAfterSeq === 'number') {
    return `unexpected_next_after_seq:${paging.nextAfterSeq}`;
  }
  if (mode === 'after' && typeof paging.nextBeforeSeq === 'number') {
    return `unexpected_next_before_seq:${paging.nextBeforeSeq}`;
  }

  return null;
}

async function fetchChatMessagesUnified(
  chatId: string,
  cursor: FetchCursor = {},
  signal?: AbortSignal,
): Promise<{ messages: Message[]; paging: FetchPaging } | null> {
  const resolvedLimit =
    typeof cursor.limit === 'number' && Number.isFinite(cursor.limit)
      ? Math.max(1, Math.min(100, Math.floor(cursor.limit)))
      : PAGE_LIMIT;
  const params = new URLSearchParams({ limit: String(resolvedLimit) });
  if (typeof cursor.beforeSeq === 'number') params.set('beforeSeq', String(cursor.beforeSeq));
  if (typeof cursor.afterSeq === 'number') params.set('afterSeq', String(cursor.afterSeq));

  const url = `${apiBaseUrl}/api/messages/chat/${encodeURIComponent(chatId)}?${params.toString()}`;
  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(url, { signal }));
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }

  if (res.status === 404) {
    throw new Error('CHAT_CURSOR_API_NOT_AVAILABLE');
  }
  if (isAuthErrorStatus(res.status)) {
    throw new Error('AUTH_ERROR');
  }
  if (!res.ok) {
    throw new Error((json && (json.error || json.message)) || `HTTP_${res.status}`);
  }

  const paging: FetchPaging = {
    hasMore: !!json?.paging?.hasMore,
    nextBeforeSeq: typeof json?.paging?.nextBeforeSeq === 'number' ? json.paging.nextBeforeSeq : null,
    nextAfterSeq: typeof json?.paging?.nextAfterSeq === 'number' ? json.paging.nextAfterSeq : null,
  };

  const cursorContractViolation = assertCursorContract(res, json, chatId, cursor, resolvedLimit, paging);
  if (cursorContractViolation) {
    throw new Error(`CURSOR_CONTRACT_VIOLATION:${cursorContractViolation}`);
  }

  const messages = normalizeSyncMessages(Array.isArray(json?.messages) ? json.messages : []);
  const cursorViolation = validateCursorPage(chatId, cursor, messages);
  if (cursorViolation) {
    throw new Error(`CURSOR_CONTRACT_VIOLATION:${cursorViolation}`);
  }
  return { messages, paging };
}

async function fetchChatMessages(chatId: string, cursor: FetchCursor = {}, signal?: AbortSignal) {
  return fetchChatMessagesUnified(chatId, cursor, signal);
}

async function fetchMessageContextFromApi(
  chatId: string,
  seq: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ chatId: string; seq: number; messages: Message[]; hasMoreBefore: boolean; hasMoreAfter: boolean }> {
  const params = new URLSearchParams({
    chatId,
    seq: String(seq),
    limit: String(limit),
  });
  const url = `${apiBaseUrl}/api/messages/context?${params.toString()}`;

  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(url, { signal }));
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { chatId, seq, messages: [], hasMoreBefore: false, hasMoreAfter: false };
    }
    throw err;
  }

  if (isAuthErrorStatus(res.status)) {
    throw new Error('AUTH_ERROR');
  }
  if (!res.ok) {
    throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
  }

  const data = unwrapSuccessData(json);
  const contextChatId = data?.chatId ? String(data.chatId) : chatId;
  const contextSeq = Number(data?.seq ?? seq);
  const messages = normalizeSyncMessages(Array.isArray(data?.messages) ? data.messages : []);
  return {
    chatId: contextChatId,
    seq: Number.isFinite(contextSeq) ? contextSeq : seq,
    messages,
    hasMoreBefore: !!data?.hasMoreBefore,
    hasMoreAfter: !!data?.hasMoreAfter,
  };
}

function normalizePrefetchTargets(targets: ChatPrefetchTarget[]): ChatPrefetchTarget[] {
  const deduped = new Map<string, boolean>();
  for (const target of targets) {
    const chatId = target?.chatId ? String(target.chatId) : '';
    if (!chatId) continue;
    const isGroup = !!target?.isGroup;
    const prev = deduped.get(chatId);
    deduped.set(chatId, isGroup || !!prev);
  }
  return Array.from(deduped.entries()).map(([chatId, isGroup]) => ({ chatId, isGroup }));
}

async function hydratePrefetchFromCache(chatId: string, isGroup: boolean): Promise<void> {
  const chat = store.getOrCreate(chatId, isGroup);
  if (chat.messages.length) return;

  try {
    const cached = await loadRecentMessages(chatId, RECENT_LIMIT);
    if (!cached.length) return;
    store.replaceMessages(chatId, isGroup, cached);
    searchService.replaceChat(chatId, store.getOrCreate(chatId, isGroup).messages);
    pruneSearchHaystackCache(chatId, store.getOrCreate(chatId, isGroup).messages);
  } catch {
    // ignore cache failures
  }
}

async function warmPrefetchFromNetwork(
  chatId: string,
  isGroup: boolean,
  opts: { bypassCooldown?: boolean } = {},
): Promise<void> {
  if (!isInited || !accessToken) return;
  if (store.activeChatId === chatId) return;

  const now = Date.now();
  const lastAt = prefetchLastAt.get(chatId) || 0;
  if (!opts.bypassCooldown && now - lastAt < PREFETCH_NETWORK_COOLDOWN_MS) return;
  if (prefetchInFlight.has(chatId)) return;

  prefetchLastAt.set(chatId, now);
  prefetchInFlight.add(chatId);

  try {
    const chat = store.getOrCreate(chatId, isGroup);
    const localLatest = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
    const localLatestSeq = typeof localLatest?.seq === 'number' ? localLatest.seq : null;

    let result: { messages: Message[]; paging: FetchPaging } | null = null;
    if (typeof localLatestSeq === 'number') {
      try {
        result = await fetchChatMessages(chatId, { afterSeq: localLatestSeq });
      } catch (err: any) {
        if (String(err?.message || err) === 'AUTH_ERROR') throw err;
      }
    } else {
      result = await fetchChatMessages(chatId, {});
    }

    if (!result) return;
    const incoming = Array.isArray(result.messages) ? result.messages : [];
    if (incoming.length) {
      invalidateSearchHaystacks(chatId, incoming.map((m) => m.id).filter(Boolean));
      store.mergeMessages(chatId, isGroup, incoming);
      searchService.upsert(chatId, incoming);
      clearRemoteSearchCacheForChat(chatId);
      const { removedIds } = trimChatByRetention(chatId, isGroup);
      if (removedIds.length) {
        searchService.remove(chatId, removedIds);
        invalidateSearchHaystacks(chatId, removedIds);
      }
      saveMessages(incoming).catch(() => undefined);
    }

    const warmed = store.getOrCreate(chatId, isGroup);
    warmed.hasMore = result.paging.hasMore;
    warmed.nextBeforeSeq = result.paging.nextBeforeSeq;
  } catch (err: any) {
    if (String(err?.message || err) === 'AUTH_ERROR') {
      syncAuthError = true;
      setSyncPhase('auth_error', 'auth');
    }
  } finally {
    prefetchInFlight.delete(chatId);
  }
}

function pumpPrefetchQueue() {
  while (prefetchInFlight.size < PREFETCH_MAX_IN_FLIGHT && prefetchQueue.length) {
    const next = prefetchQueue.shift()!;
    prefetchQueued.delete(next.chatId);
    void warmPrefetchFromNetwork(next.chatId, next.isGroup).finally(() => {
      pumpPrefetchQueue();
    });
  }
}

function enqueueNetworkPrefetch(chatId: string, isGroup: boolean, highPriority = false) {
  if (prefetchInFlight.has(chatId) || prefetchQueued.has(chatId)) return;
  prefetchQueued.add(chatId);
  if (highPriority) {
    prefetchQueue.unshift({ chatId, isGroup });
  } else {
    prefetchQueue.push({ chatId, isGroup });
  }
  pumpPrefetchQueue();
}

async function prefetchChatsInternal(targets: ChatPrefetchTarget[]): Promise<void> {
  const normalized = normalizePrefetchTargets(targets);
  if (!normalized.length) return;

  await Promise.all(
    normalized.map((target) =>
      hydratePrefetchFromCache(target.chatId, target.isGroup).catch(() => undefined),
    ),
  );
  for (let i = 0; i < normalized.length; i += 1) {
    const target = normalized[i];
    enqueueNetworkPrefetch(target.chatId, target.isGroup, i < 3);
  }
}

async function bootstrapHotChatPrefetch(): Promise<void> {
  if (!isInited) return;

  let candidates: Array<{ chatId: string; isGroup: boolean }> = [];
  try {
    const hot = await loadHotChatCandidates(BOOT_HOT_CHAT_PREFETCH_LIMIT);
    if (!hot.length) return;
    candidates = hot.map((item) => ({ chatId: item.chatId, isGroup: item.isGroup }));
  } catch {
    return;
  }

  if (!candidates.length) return;

  // Phase 1: hydrate in-memory caches from IndexedDB so first switch can reset immediately.
  await Promise.all(
    candidates.map((target) =>
      hydratePrefetchFromCache(target.chatId, target.isGroup).catch(() => undefined),
    ),
  );

  // Phase 2: prioritize top hot chats for network warm-up (kept bounded by queue concurrency).
  for (let i = 0; i < candidates.length; i += 1) {
    const target = candidates[i];
    enqueueNetworkPrefetch(
      target.chatId,
      target.isGroup,
      i < BOOT_HOT_CHAT_PREFETCH_PRIORITY_COUNT,
    );
  }
}

function buildSearchHaystack(message: Message): string {
  const chunks: string[] = [];
  if (message.content) chunks.push(message.content);
  if (message.fileName) chunks.push(message.fileName);
  if (message.senderUsername) chunks.push(message.senderUsername);
  if (Array.isArray(message.attachments) && message.attachments.length) {
    for (const file of message.attachments) {
      if (file?.fileName) chunks.push(file.fileName);
    }
  }
  return chunks.join(' ').toLowerCase();
}

function clearSearchHaystackCacheForChat(chatId: string) {
  if (!chatId) return;
  searchHaystackCache.delete(chatId);
}

function pruneSearchHaystackCache(chatId: string, messages: Message[]) {
  if (!chatId) return;
  const cache = searchHaystackCache.get(chatId);
  if (!cache || !cache.size) return;

  const validIds = new Set(messages.map((m) => m.id).filter(Boolean));
  for (const id of cache.keys()) {
    if (validIds.has(id)) continue;
    cache.delete(id);
  }
  if (!cache.size) {
    searchHaystackCache.delete(chatId);
  }
}

function invalidateSearchHaystacks(chatId: string, ids: string[]) {
  if (!chatId || !ids.length) return;
  const cache = searchHaystackCache.get(chatId);
  if (!cache || !cache.size) return;
  for (const id of ids) {
    if (!id) continue;
    cache.delete(id);
  }
  if (!cache.size) {
    searchHaystackCache.delete(chatId);
  }
}

function getSearchHaystack(chatId: string, message: Message): string {
  if (!message?.id) {
    return buildSearchHaystack(message);
  }
  let cache = searchHaystackCache.get(chatId);
  if (!cache) {
    cache = new Map<string, string>();
    searchHaystackCache.set(chatId, cache);
  }
  const cached = cache.get(message.id);
  if (cached !== undefined) {
    return cached;
  }
  const next = buildSearchHaystack(message);
  cache.set(message.id, next);
  return next;
}

function shouldFetchRemoteSearch(localCount: number, limit: number, query: string): boolean {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < SEARCH_REMOTE_MIN_QUERY_LEN) return false;
  if (localCount >= limit) return false;

  const skipThreshold = Math.floor(limit * SEARCH_REMOTE_LOCAL_HIT_SKIP_RATIO);
  if (skipThreshold > 0 && localCount >= skipThreshold) return false;

  return true;
}

async function searchMessagesInChat(chatId: string, isGroup: boolean, query: string, limit: number): Promise<Message[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
  const chat = store.getOrCreate(chatId, isGroup);
  if (!chat.messages.length) {
    try {
      const cached = await loadRecentMessages(chatId, SEARCH_CACHE_WARM_LIMIT);
      if (cached.length) {
        store.replaceMessages(chatId, isGroup, cached);
        searchService.replaceChat(chatId, store.getOrCreate(chatId, isGroup).messages);
        pruneSearchHaystackCache(chatId, store.getOrCreate(chatId, isGroup).messages);
      }
    } catch {
      // ignore cache read failures
    }
  }

  const source = store.getOrCreate(chatId, isGroup).messages;
  if (!source.length) return [];
  searchService.ensureChat(chatId, source);

  // Keep search scope bounded for stable latency.
  const start = source.length > SEARCH_FALLBACK_SCAN_LIMIT ? source.length - SEARCH_FALLBACK_SCAN_LIMIT : 0;
  const candidates = source.slice(start).reverse();
  if (!candidates.length) return [];

  // Tier 1: inverted index query (recent + full merged) for repeated searches.
  let local = searchTieredIndexEnabled
    ? searchService.queryLayered(chatId, normalizedQuery, normalizedLimit)
    : searchService.query(chatId, normalizedQuery, normalizedLimit);
  if (local.length >= normalizedLimit) {
    return local.slice(0, normalizedLimit);
  }

  // Tier 2: WASM scan over bounded recent window to fill recall gaps with stable latency.
  const wasm = searchTieredWasmEnabled && runtimeFlags.wasmSearchFallback ? wasmApiRef : null;
  if (wasm && local.length < normalizedLimit) {
    try {
      const haystacks = candidates.map((msg) => getSearchHaystack(chatId, msg));
      const wasmLimit = Math.min(normalizedLimit * 2, 240);
      const idxs = Array.from(wasm.search_contains_indices(haystacks, normalizedQuery, wasmLimit));
      if (idxs.length) {
        const wasmHits: Message[] = [];
        const seen = new Set<string>();
        for (const idx of idxs) {
          const msg = candidates[idx];
          if (!msg || seen.has(msg.id)) continue;
          seen.add(msg.id);
          wasmHits.push(msg);
          if (wasmHits.length >= wasmLimit) break;
        }
        if (wasmHits.length) {
          local = mergeSearchResults(local, wasmHits, normalizedLimit);
          if (local.length >= normalizedLimit) {
            return local.slice(0, normalizedLimit);
          }
        }
      }
    } catch {
      // fallback to non-wasm path
    }
  }

  // Tier 3: JS substring fallback over bounded candidates (for tokenization edge cases).
  const jsHits: Message[] = [];
  const seen = new Set<string>();
  const terms = normalizedQuery
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  for (const msg of candidates) {
    if (!msg?.id || seen.has(msg.id)) continue;
    const haystack = getSearchHaystack(chatId, msg);
    let ok = true;
    for (const term of terms) {
      if (!haystack.includes(term)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    seen.add(msg.id);
    jsHits.push(msg);
    if (jsHits.length >= normalizedLimit) break;
  }

  return mergeSearchResults(local, jsHits, normalizedLimit);
}

function deriveSearchTargetId(chatId: string, isGroup: boolean): string | null {
  if (isGroup) {
    return chatId.startsWith('g:') ? chatId.slice(2) : chatId;
  }
  if (!currentUserId) return null;
  return parsePrivateChatOtherUserId(chatId, currentUserId);
}

function makeRemoteSearchCacheKey(chatId: string, query: string, limit: number): string {
  const normalizedQuery = query.trim().toLowerCase();
  return `${chatId}::${normalizedQuery}::${limit}`;
}

function trimRemoteSearchCache() {
  if (remoteSearchCache.size <= SEARCH_REMOTE_CACHE_MAX_KEYS) return;
  const entries = Array.from(remoteSearchCache.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt);
  const overflow = entries.length - SEARCH_REMOTE_CACHE_MAX_KEYS;
  for (let i = 0; i < overflow; i += 1) {
    remoteSearchCache.delete(entries[i][0]);
  }
}

function clearRemoteSearchCacheForChat(chatId: string) {
  if (!chatId || !remoteSearchCache.size) return;
  const prefix = `${chatId}::`;
  for (const key of remoteSearchCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    remoteSearchCache.delete(key);
  }
}

function clearRemoteSearchControlForChat(chatId: string) {
  const control = remoteSearchAbortByChat.get(chatId);
  if (!control) return;
  try {
    control.controller.abort();
  } catch {
    // ignore
  }
  remoteSearchAbortByChat.delete(chatId);
}

function clearRemoteSearchStateForChat(chatId: string) {
  clearRemoteSearchControlForChat(chatId);
  clearRemoteSearchCacheForChat(chatId);
}

function getCachedRemoteSearch(chatId: string, query: string, limit: number): Message[] | null {
  const key = makeRemoteSearchCacheKey(chatId, query, limit);
  const cached = remoteSearchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > SEARCH_REMOTE_CACHE_TTL_MS) {
    remoteSearchCache.delete(key);
    return null;
  }
  return cached.messages.slice();
}

function setCachedRemoteSearch(chatId: string, query: string, limit: number, messages: Message[]) {
  const key = makeRemoteSearchCacheKey(chatId, query, limit);
  remoteSearchCache.set(key, { cachedAt: Date.now(), messages: messages.slice() });
  trimRemoteSearchCache();
}

function isAbortError(err: unknown): boolean {
  return (
    (err as any)?.name === 'AbortError' ||
    String((err as any)?.message || '').toLowerCase().includes('abort')
  );
}

async function searchMessagesRemote(
  chatId: string,
  isGroup: boolean,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Message[]> {
  const cached = getCachedRemoteSearch(chatId, query, limit);
  if (cached) return cached;

  const targetId = deriveSearchTargetId(chatId, isGroup);
  if (!targetId) return [];
  if (!apiBaseUrl) return [];

  const params = new URLSearchParams({
    q: query,
    targetId,
    limit: String(limit),
  });
  const url = `${apiBaseUrl}/api/messages/search?${params.toString()}`;
  const key = makeRemoteSearchCacheKey(chatId, query, limit);

  const inFlight = remoteSearchInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    try {
      const { res, json } = await fetchJson(url, { signal });
      if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
      if (!res.ok) return [];
      const data = unwrapSuccessData(json);
      const messagesRaw = Array.isArray(data?.messages) ? data.messages : Array.isArray(json?.messages) ? json.messages : [];
      const normalized = normalizeSyncMessages(messagesRaw);
      setCachedRemoteSearch(chatId, query, limit, normalized);
      return normalized;
    } catch (err) {
      if ((err as any)?.message === 'AUTH_ERROR') {
        throw err;
      }
      if (isAbortError(err)) return [];
      return [];
    } finally {
      remoteSearchInFlight.delete(key);
    }
  })();

  remoteSearchInFlight.set(key, task);
  return task;
}

function mergeSearchResults(local: Message[], remote: Message[], limit: number): Message[] {
  if (!remote.length) return local.slice(0, limit);
  const out: Message[] = [];
  const seen = new Set<string>();

  for (const source of [local, remote]) {
    for (const item of source) {
      const id = item?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function emitReset(chatId: string, loadSeq: LoadSeq, messages: Message[], paging: FetchPaging) {
  emitPatch({
    kind: 'reset',
    chatId,
    loadSeq,
    messages,
    hasMore: paging.hasMore,
    nextBeforeSeq: paging.nextBeforeSeq,
  });
}

function emitPrepend(chatId: string, loadSeq: LoadSeq, messages: Message[], paging: FetchPaging) {
  emitPatch({
    kind: 'prepend',
    chatId,
    loadSeq,
    messages,
    hasMore: paging.hasMore,
    nextBeforeSeq: paging.nextBeforeSeq,
  });
}

function emitDelete(chatId: string, loadSeq: LoadSeq, ids: string[]) {
  if (!ids.length) return;
  emitPatch({ kind: 'delete', chatId, loadSeq, ids });
}

function trimChatByRetention(chatId: string, isGroup: boolean): { removedIds: string[] } {
  const chat = store.getOrCreate(chatId, isGroup);
  const preferHistory = chatId === store.activeChatId && chat.retentionAnchor === 'history';
  return preferHistory
    ? store.trimNewest(chatId, MAX_CHAT_MESSAGES)
    : store.trimOldest(chatId, MAX_CHAT_MESSAGES);
}

async function ingestMessagesInternal(messages: Message[]) {
  if (!messages?.length) return;

  const grouped = new Map<string, { isGroup: boolean; messages: Message[] }>();

  for (const msg of messages) {
    const chatId = msg.chatId || (msg.groupId ? `g:${msg.groupId}` : null);
    if (!chatId) continue;
    const isGroup = chatId.startsWith('g:') || !!msg.isGroupChat;
    const bucket = grouped.get(chatId);
    if (bucket) {
      bucket.messages.push(msg);
    } else {
      grouped.set(chatId, { isGroup, messages: [msg] });
    }
  }

  for (const [chatId, bucket] of grouped.entries()) {
    const chat = store.getOrCreate(chatId, bucket.isGroup);
    invalidateSearchHaystacks(chatId, bucket.messages.map((m) => m.id).filter(Boolean));
    const { added } = store.mergeMessages(chatId, bucket.isGroup, bucket.messages);
    if (added.length) {
      enqueueSenderSafetyChecks(added);
      clearRemoteSearchCacheForChat(chatId);
    }
    if (added.length) {
      searchService.upsert(chatId, added);
    }
    const { removedIds } = trimChatByRetention(chatId, bucket.isGroup);
    if (removedIds.length) {
      searchService.remove(chatId, removedIds);
      invalidateSearchHaystacks(chatId, removedIds);
    }
    const removedSet = removedIds.length ? new Set(removedIds) : null;
    const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

    if (isAiChatId(chatId) && addedForPatch.length) {
      for (const msg of addedForPatch) {
        queueAiMessageMeta(msg);
      }
    }

    // Chat list meta: last message preview and unread deltas.
    const listId = chatListIdFromChatId(chatId, bucket.isGroup);
    if (listId) {
      const last = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
      if (last) queueLastMessageMeta(listId, last);

      if (currentUserId && store.activeChatId !== chatId) {
        let delta = 0;
        for (const m of added) {
          if (m?.senderId && m.senderId !== currentUserId) delta += 1;
        }
        if (delta) queueUnreadDeltaMeta(listId, delta);
      }
    }

    // Persist best-effort (batch).
    saveMessages(bucket.messages).catch(() => undefined);

    // Only patch active chat view.
    if (chatId === store.activeChatId && addedForPatch.length) {
      emitPatch({ kind: 'append', chatId, loadSeq: store.activeLoadSeq, messages: addedForPatch });
    }
    if (chatId === store.activeChatId && removedIds.length) {
      emitDelete(chatId, store.activeLoadSeq, removedIds);
    }
  }
}

function applyReadReceiptInternal(chatId: string, seq: number, readCount: number, senderUserId: string) {
  const updates = store.applyReadReceipt(chatId, seq, readCount, senderUserId);
  if (!updates.length) return;
  if (chatId !== store.activeChatId) return;
  emitPatch({ kind: 'update', chatId, loadSeq: store.activeLoadSeq, updates });
}

async function processSyncPayload(updates: any[], rawMessages: any[], nextPts: number) {
  const minPts = syncPts;
  const normalizedUpdates = normalizeSyncUpdates(updates, minPts);
  const effectiveNextPts = Number.isFinite(nextPts)
    ? Math.max(nextPts, normalizedUpdates.maxUpdateId, minPts)
    : Math.max(normalizedUpdates.maxUpdateId, minPts);

  const messages = normalizeSyncMessages(rawMessages);
  if (messages.length) {
    await ingestMessagesInternal(messages);
  }

  if (currentUserId && normalizedUpdates.updates.length) {
    const groupTasks: Array<Promise<void>> = [];
    for (const u of normalizedUpdates.updates) {
      if (u?.type === 'read') {
        const chatId = u?.chatId;
        const seq = u?.seq;
        if (typeof chatId !== 'string') continue;
        if (typeof seq !== 'number') continue;
        const readCount = typeof u?.payload?.readCount === 'number' ? u.payload.readCount : 1;
        applyReadReceiptInternal(chatId, seq, readCount, currentUserId);
        continue;
      }

      if (u?.type === 'member_change') {
        const payload = u?.payload;
        if (!payload) continue;
        groupTasks.push(processGroupUpdateEvent(payload));
        continue;
      }
    }

    if (groupTasks.length) {
      await Promise.all(groupTasks);
    }
  }

  await commitSyncPts(effectiveNextPts);
}

async function gapRecoverUntilLatest(
  signal: AbortSignal,
  opts: { force?: boolean; allowWhenSocketConnected?: boolean; reason?: string } = {},
): Promise<boolean> {
  if (!currentUserId) return false;
  if (syncAuthError) return false;
  if (!opts.allowWhenSocketConnected && socketConnected) {
    telemetry.gapRecoverSkippedSocketConnected += 1;
    markTelemetryUpdate();
    return false;
  }
  if (!canStartGapRecover(!!opts.force)) return false;

  syncGapRecoverInFlight = true;
  syncGapRecoverLastStartedAt = Date.now();
  telemetry.gapRecoverRuns += 1;
  markTelemetryUpdate();
  setSyncPhase('catching_up', opts.reason || 'difference');

  try {
    const serverPts = await fetchSyncState(signal);
    if (serverPts === null) return false; // sync API not deployed
    if (serverPts <= syncPts) {
      // Keep local pts monotonic.
      await commitSyncPts(serverPts);
      return false;
    }

    let hadProgress = false;
    let steps = 0;
    let stalledRounds = 0;

    // Fetch in bounded batches until latest.
    while (!signal.aborted && steps < SYNC_GAP_RECOVER_MAX_STEPS) {
      const from = syncPts;
      const diff = await fetchSyncDifference(from, signal);
      if (!diff) return hadProgress;

      await processSyncPayload(diff.updates, diff.messages, diff.statePts);

      const progressed = syncPts > from || diff.statePts > from || diff.updates.length > 0 || diff.messages.length > 0;
      if (progressed) {
        hadProgress = true;
        stalledRounds = 0;
      } else {
        stalledRounds += 1;
      }

      if (diff.isLatest) break;
      if (stalledRounds >= SYNC_GAP_RECOVER_STALL_LIMIT) break;

      steps += 1;
      if (SYNC_GAP_RECOVER_STEP_DELAY_MS > 0) {
        await sleepMs(SYNC_GAP_RECOVER_STEP_DELAY_MS, signal);
      }
    }

    return hadProgress;
  } finally {
    syncGapRecoverInFlight = false;
  }
}

async function pollUpdatesOnce(signal: AbortSignal): Promise<'progress' | 'idle'> {
  const from = syncPts;
  const res = await fetchSyncUpdates(from, signal);
  if (!res) {
    setSyncPhase('disconnected', 'sync_api_unavailable');
    return 'idle';
  }

  if (res.updates.length || res.messages.length) {
    await processSyncPayload(res.updates, res.messages, res.statePts);
    // If server is far ahead, pull the rest via difference.
    if (res.updates.length >= SYNC_OVERFLOW_RECOVER_THRESHOLD) {
      await gapRecoverUntilLatest(signal, { reason: 'poll_overflow' });
    }
    return 'progress';
  }

  // Backend /updates is simplified and may return empty updates even when pts advanced.
  if (res.statePts > from) {
    const recovered = await gapRecoverUntilLatest(signal, { reason: 'poll_state_ahead' });
    return recovered ? 'progress' : 'idle';
  }

  // Long-poll loop is healthy.
  setSyncPhase('live', 'poll');
  return 'idle';
}

function stopSyncLoop() {
  cancelSyncStartGraceTimer();
  syncLoopGeneration += 1;
  if (syncAbort) {
    syncAbort.abort();
  }
  syncAbort = null;
  syncTask = null;
  syncGapRecoverInFlight = false;
}

function stopChatFetches() {
  activeFetchEpoch += 1;
  pagingFetchEpoch += 1;

  if (chatLatestAbort) {
    chatLatestAbort.abort();
  }
  chatLatestAbort = null;

  if (chatPagingAbort) {
    chatPagingAbort.abort();
  }
  chatPagingAbort = null;
}

function startSyncLoop() {
  cancelSyncStartGraceTimer();
  if (!workerSyncFallbackEnabled) {
    setSyncPhase(socketConnected ? 'live' : 'idle', 'sync_fallback_disabled');
    return;
  }
  if (!isInited) return;
  if (socketConnected) {
    setSyncPhase('live', 'socket');
    return;
  }
  if (syncAuthError) {
    setSyncPhase('auth_error', 'auth');
    return;
  }
  if (syncContractError && Date.now() < syncContractBackoffUntil) {
    setSyncPhase('backoff', 'sync_contract_cooldown');
    scheduleSyncLoopStart('sync_contract_cooldown');
    return;
  }
  if (syncTask) return;
  telemetry.syncLoopStarts += 1;
  markTelemetryUpdate();

  const loopGeneration = syncLoopGeneration + 1;
  syncLoopGeneration = loopGeneration;
  syncAbort = new AbortController();
  const signal = syncAbort.signal;
  setSyncPhase('disconnected', 'fallback');

  syncTask = (async () => {
    try {
      await gapRecoverUntilLatest(signal, { force: true, reason: 'difference_start' });
      if (!signal.aborted) {
        setSyncPhase('live', 'gap_recovered');
      }
    } catch (err: any) {
      if (String(err?.message || err) === 'AUTH_ERROR') {
        syncAuthError = true;
        setSyncPhase('auth_error', 'auth');
        return;
      }
      if (isSyncContractError(err)) {
        setSyncPhase('backoff', 'sync_contract_mismatch');
        return;
      }
    }

    let backoffMs = 1000;
    let idleRounds = 0;
    while (!signal.aborted && !socketConnected && syncLoopGeneration === loopGeneration) {
      try {
        const state = await pollUpdatesOnce(signal);
        if (state === 'progress') {
          idleRounds = 0;
        } else {
          idleRounds += 1;
          if (idleRounds >= SYNC_EMPTY_POLL_FORCE_RECOVER_ROUNDS) {
            idleRounds = 0;
            await gapRecoverUntilLatest(signal, { force: true, reason: 'idle_probe' });
          }
          if (SYNC_IDLE_LOOP_DELAY_MS > 0) {
            await sleepMs(SYNC_IDLE_LOOP_DELAY_MS, signal);
          }
        }
        backoffMs = 1000;
      } catch (err: any) {
        if (signal.aborted) return;
        if (syncLoopGeneration !== loopGeneration) return;

        if (String(err?.message || err) === 'AUTH_ERROR') {
          syncAuthError = true;
          setSyncPhase('auth_error', 'auth');
          return;
        }
        if (isSyncContractError(err)) {
          setSyncPhase('backoff', 'sync_contract_mismatch');
          return;
        }

        setSyncPhase('backoff', 'retry');
        telemetry.syncBackoffRetries += 1;
        markTelemetryUpdate();
        const jitter = Math.floor(Math.random() * SYNC_BACKOFF_JITTER_MS);
        await sleepMs(backoffMs + jitter, signal);
        backoffMs = Math.min(backoffMs * 2, 10_000);
      }
    }
  })().finally(() => {
    if (syncLoopGeneration !== loopGeneration) return;
    syncAbort = null;
    syncTask = null;
    if (syncAuthError) {
      setSyncPhase('auth_error', 'auth');
    } else if (socketConnected) {
      setSyncPhase('live', 'socket');
    } else if (isInited) {
      setSyncPhase('disconnected', 'stopped');
    } else {
      setSyncPhase('idle', 'stopped');
    }
  });
}

const apiImpl: ChatCoreApi = {
  async getRuntimeInfo(): Promise<ChatCoreRuntimeInfo> {
    return {
      protocolVersion: CHAT_CORE_PROTOCOL_VERSION,
      workerBuildId: CHAT_CORE_WORKER_BUILD_ID,
      runtimePolicy: {
        emergencySafeMode: emergencySafeModeEnabled,
        profile: runtimePolicyProfile,
        profileLocked: runtimePolicyLocked,
        profileSource: runtimePolicySource,
        matrixVersion: runtimePolicyMatrixVersion,
      },
      flags: {
        chatMemoryWindow: MAX_CHAT_MESSAGES,
        wasmSeqOps: wasmSeqOpsEnabled,
        wasmRequired: runtimeFlags.wasmRequired,
        wasmSearchFallback: runtimeFlags.wasmSearchFallback,
        searchTieredIndex: searchTieredIndexEnabled,
        searchTieredWasm: searchTieredWasmEnabled,
        workerSyncFallback: workerSyncFallbackEnabled,
        workerQosPatchQueue: runtimeFlags.workerQosPatchQueue,
        workerSocketEnabled,
        workerSafetyChecks: workerSafetyChecksEnabled,
      },
      wasm: {
        enabled: wasmSeqOpsEnabled,
        version: wasmRuntimeVersion,
        initError: wasmInitErrorCode,
      },
      sync: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        watermarkField: SYNC_WATERMARK_FIELD,
        contractValidatedAt: syncContractValidatedAt,
        contractError: syncContractError,
        contractBackoffUntil: syncContractBackoffUntil,
      },
      telemetry: {
        updatedAt: telemetry.updatedAt,
        patchQueuePeak: telemetry.patchQueuePeak,
        patchDispatchCount: telemetry.patchDispatchCount,
        patchDroppedAsStale: telemetry.patchDroppedAsStale,
        fetchCount: telemetry.fetchCount,
        fetchErrorCount: telemetry.fetchErrorCount,
        syncLoopStarts: telemetry.syncLoopStarts,
        gapRecoverRuns: telemetry.gapRecoverRuns,
        gapRecoverSkippedInFlight: telemetry.gapRecoverSkippedInFlight,
        gapRecoverSkippedCooldown: telemetry.gapRecoverSkippedCooldown,
        gapRecoverSkippedSocketConnected: telemetry.gapRecoverSkippedSocketConnected,
        syncBackoffRetries: telemetry.syncBackoffRetries,
        socketConnects: telemetry.socketConnects,
        socketConnectErrors: telemetry.socketConnectErrors,
        workerRestartsHint: telemetry.workerRestartsHint,
      },
    };
  },

  async init(params: ChatCoreInit) {
    apiBaseUrl = params.apiBaseUrl.replace(/\/$/, '');
    accessToken = params.accessToken;
    // Worker does not refresh tokens itself; main thread refreshes and calls `updateTokens`.
    void params.refreshToken;
    currentUserId = params.userId;
    runtimePolicyProfile = params.runtimeOverrides?.policyProfile || 'baseline';
    emergencySafeModeEnabled = !!params.runtimeOverrides?.emergencySafeMode;
    runtimePolicyLocked = !!params.runtimeOverrides?.policyLocked;
    runtimePolicySource = params.runtimeOverrides?.policySource || 'default';
    runtimePolicyMatrixVersion = params.runtimeOverrides?.policyMatrixVersion || 'unknown';

    workerSyncFallbackEnabled = params.runtimeOverrides?.workerSyncFallback ?? runtimeFlags.workerSyncFallback;
    workerSafetyChecksEnabled = params.runtimeOverrides?.workerSafetyChecks ?? runtimeFlags.workerSafetyChecks;
    searchTieredIndexEnabled = params.runtimeOverrides?.searchTieredIndex ?? runtimeFlags.searchTieredIndex;
    searchTieredWasmEnabled = params.runtimeOverrides?.searchTieredWasm ?? runtimeFlags.searchTieredWasm;
    workerSocketEnabled = params.enableWorkerSocket ?? runtimeFlags.workerSocketEnabled;

    if (emergencySafeModeEnabled) {
      runtimePolicyProfile = 'safe';
      runtimePolicySource = 'emergency_safe_mode';
      workerSocketEnabled = false;
      workerSyncFallbackEnabled = true;
      workerSafetyChecksEnabled = false;
      searchTieredWasmEnabled = false;
    }

    socketUrl = (params.socketUrl || deriveSocketUrl(apiBaseUrl)).replace(/\/$/, '');
    isInited = true;
    workerInitCount += 1;
    resetTelemetryCounters();
    syncContractValidatedAt = 0;
    syncContractError = null;
    syncContractBackoffUntil = 0;
    pendingSafetyChecks.clear();
    recentSafetyChecks.clear();
    safetyCheckInFlight = false;
    pendingMeta.lastMessages.clear();
    pendingMeta.unreadDelta.clear();
    pendingMeta.online.clear();
    pendingMeta.aiMessages.clear();
    pendingMeta.chatUpserts.clear();
    pendingMeta.chatRemovals.clear();
    for (const control of remoteSearchAbortByChat.values()) {
      try {
        control.controller.abort();
      } catch {
        // ignore
      }
    }
    remoteSearchAbortByChat.clear();
    remoteSearchInFlight.clear();
    remoteSearchCache.clear();
    searchHaystackCache.clear();

    // Best-effort: initialize Rust/WASM hot-path helpers.
    // If it fails, the worker continues with the TS fallback path.
    wasmApiRef = runtimeFlags.wasmSeqOps ? await getChatWasmApi() : null;
    const wasm = wasmApiRef;
    wasmSeqOpsEnabled = !!wasm;
    wasmRuntimeVersion = resolveWasmVersion(wasm);
    wasmInitErrorCode = runtimeFlags.wasmSeqOps && !wasm
      ? (runtimeFlags.wasmRequired ? 'WASM_REQUIRED_INIT_FAILED' : 'WASM_INIT_FAILED')
      : null;

    if (runtimeFlags.wasmSeqOps && runtimeFlags.wasmRequired && !wasm) {
      throw new Error('WASM_REQUIRED_INIT_FAILED');
    }

    store.setSeqMergeOps(
      wasm
        ? {
            mergeSortedUnique: (existing: number[], incoming: number[]) => {
              const a = Uint32Array.from(existing);
              const b = Uint32Array.from(incoming);
              return Array.from(wasm.merge_sorted_unique_u32(a, b));
            },
            diffSortedUnique: (existing: number[], incoming: number[]) => {
              const a = Uint32Array.from(existing);
              const b = Uint32Array.from(incoming);
              return Array.from(wasm.diff_sorted_unique_u32(a, b));
            },
            mergeAndDiffSortedUnique: (existing: number[], incoming: number[]) => {
              const a = Uint32Array.from(existing);
              const b = Uint32Array.from(incoming);
              const plan = wasm.merge_and_diff_sorted_unique_u32(a, b);
              return {
                merged: Array.from(plan.merged),
                added: Array.from(plan.added),
              };
            },
          }
        : null,
    );

    try {
      syncPts = await loadSyncPts(params.userId);
    } catch {
      syncPts = 0;
    }

    void bootstrapHotChatPrefetch();

    if (workerSocketEnabled) {
      socketConnected = false;
      setSyncPhase('disconnected', 'worker_socket_boot');
      await connectWorkerSocketInternal(true);
      startSyncLoop();
    } else {
      setSyncPhase(socketConnected ? 'live' : 'disconnected', 'init');
      // If the main thread already marked socket as disconnected before init, start sync now.
      if (socketConnected) {
        stopSyncLoop();
      } else {
        scheduleSyncLoopStart('init_mainthread_socket');
      }
    }
  },

  async updateTokens(nextAccessToken: string, nextRefreshToken?: string | null) {
    accessToken = nextAccessToken;
    // Keep signature compatible; refresh token is owned by main thread.
    void nextRefreshToken;

    if (workerSocketEnabled && workerSocket?.connected) {
      workerSocket.emit('authenticate', { token: nextAccessToken });
    }

    if (syncAuthError) {
      syncAuthError = false;
      setSyncPhase(socketConnected ? 'live' : 'disconnected', 'token_refresh');
      startSyncLoop();
    }
  },

  async setConnectivity(nextSocketConnected: boolean) {
    if (workerSocketEnabled) {
      // Worker socket mode owns connectivity state via socket events.
      if (nextSocketConnected) {
        await connectWorkerSocketInternal(true);
      } else {
        await apiImpl.disconnectRealtime();
      }
      return;
    }

    const prevConnected = socketConnected;
    socketConnected = nextSocketConnected;
    if (prevConnected === nextSocketConnected) {
      if (!socketConnected) {
        scheduleSyncLoopStart('socket_state_repeat');
      }
      return;
    }

    if (socketConnected) {
      stopReconnectGapRecover();
      stopSyncLoop();
      setSyncPhase('live', 'socket_connected');
      if (!syncAuthError) {
        // Best-effort gap recovery on reconnect (throttled + single-flight).
        const ctl = new AbortController();
        reconnectGapRecoverAbort = ctl;
        void gapRecoverUntilLatest(ctl.signal, {
          force: true,
          allowWhenSocketConnected: true,
          reason: 'socket_reconnect',
        })
          .then((didRecover) => {
            if (didRecover && socketConnected && !syncAuthError) {
              setSyncPhase('live', 'socket_gap_recovered');
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (reconnectGapRecoverAbort === ctl) {
              reconnectGapRecoverAbort = null;
            }
          });
      }
      return;
    }

    stopReconnectGapRecover();
    setSyncPhase('disconnected', 'socket_disconnected');
    scheduleSyncLoopStart('socket_disconnected');
  },

  async connectRealtime() {
    if (!workerSocketEnabled) return;
    await connectWorkerSocketInternal(true);
    if (workerSocket?.connected && accessToken) {
      workerSocket.emit('authenticate', { token: accessToken });
    }
  },

  async disconnectRealtime() {
    if (!workerSocketEnabled) return;
    detachWorkerSocket();
    await setConnectivityFromSocket(false, 'worker_socket_manual_disconnect');
  },

  async prefetchChat(chatId: string, isGroup: boolean) {
    await prefetchChatsInternal([{ chatId, isGroup }]);
  },

  async prefetchChats(targets: ChatPrefetchTarget[]) {
    await prefetchChatsInternal(targets);
  },

  async getSnapshot(chatId: string, isGroup: boolean) {
    const existing = store.getOrCreate(chatId, isGroup);
    if (!existing.messages.length) {
      await hydratePrefetchFromCache(chatId, isGroup);
    }

    const chat = store.getOrCreate(chatId, isGroup);
    const messages =
      chat.messages.length > RECENT_LIMIT ? chat.messages.slice(chat.messages.length - RECENT_LIMIT) : chat.messages.slice();

    return {
      chatId,
      messages,
      hasMore: chat.hasMore,
      nextBeforeSeq: chat.nextBeforeSeq,
    };
  },

  async getMessageContext(chatId: string, seq: number, limit: number) {
    if (!isInited) throw new Error('NOT_INITED');
    if (!chatId || !Number.isFinite(seq) || seq <= 0) {
      return {
        chatId,
        seq,
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      };
    }

    const normalizedSeq = Math.floor(seq);
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30;
    const context = await fetchMessageContextFromApi(chatId, normalizedSeq, normalizedLimit);

    if (context.messages.length) {
      const isGroup = context.chatId.startsWith('g:');
      invalidateSearchHaystacks(context.chatId, context.messages.map((m) => m.id).filter(Boolean));
      const { added } = store.mergeMessages(context.chatId, isGroup, context.messages);
      if (added.length) {
        searchService.upsert(context.chatId, added);
        clearRemoteSearchCacheForChat(context.chatId);
      }
      const { removedIds } = trimChatByRetention(context.chatId, isGroup);
      if (removedIds.length) {
        searchService.remove(context.chatId, removedIds);
        invalidateSearchHaystacks(context.chatId, removedIds);
      }
      saveMessages(context.messages).catch(() => undefined);
    }

    return context;
  },

  async resolveMessages(chatId: string, isGroup: boolean, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const unique = Array.from(new Set(ids.map((id) => String(id)).filter(Boolean)));
    if (!unique.length) return [];

    const chat = store.getOrCreate(chatId, isGroup);
    const found = new Map<string, Message>();
    const missing: string[] = [];

    for (const id of unique) {
      const local = chat.entityById.get(id);
      if (local) {
        found.set(id, local);
      } else {
        missing.push(id);
      }
    }

    if (missing.length) {
      try {
        const cached = await loadMessagesByIds(chatId, missing);
        if (cached.length) {
          invalidateSearchHaystacks(chatId, cached.map((m) => m.id).filter(Boolean));
          store.mergeMessages(chatId, isGroup, cached);
          searchService.upsert(chatId, cached);
          clearRemoteSearchCacheForChat(chatId);
          const { removedIds } = trimChatByRetention(chatId, isGroup);
          if (removedIds.length) {
            searchService.remove(chatId, removedIds);
            invalidateSearchHaystacks(chatId, removedIds);
          }
          for (const msg of cached) {
            if (msg?.id) found.set(msg.id, msg);
          }
        }
      } catch {
        // ignore cache failures
      }
    }

    const out: Message[] = [];
    for (const id of unique) {
      const msg = found.get(id);
      if (msg) out.push(msg);
    }
    return out;
  },

  async searchMessages(chatId: string, isGroup: boolean, query: string, limit: number) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    const local = await searchMessagesInChat(chatId, isGroup, normalizedQuery, normalizedLimit);

    if (!shouldFetchRemoteSearch(local.length, normalizedLimit, normalizedQuery)) {
      return local.slice(0, normalizedLimit);
    }

    const requestKey = makeRemoteSearchCacheKey(chatId, normalizedQuery, normalizedLimit);
    const previous = remoteSearchAbortByChat.get(chatId);
    if (previous && previous.key !== requestKey) {
      try {
        previous.controller.abort();
      } catch {
        // ignore
      }
      remoteSearchAbortByChat.delete(chatId);
    }

    let controller: AbortController;
    const activeControl = remoteSearchAbortByChat.get(chatId);
    if (activeControl && activeControl.key === requestKey) {
      controller = activeControl.controller;
    } else {
      controller = new AbortController();
      remoteSearchAbortByChat.set(chatId, { key: requestKey, controller });
    }

    const timeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, SEARCH_REMOTE_REQUEST_TIMEOUT_MS);

    let remote: Message[] = [];
    try {
      remote = await searchMessagesRemote(chatId, isGroup, normalizedQuery, normalizedLimit, controller.signal);
    } finally {
      clearTimeout(timeout);
      const cur = remoteSearchAbortByChat.get(chatId);
      if (cur && cur.controller === controller && cur.key === requestKey) {
        remoteSearchAbortByChat.delete(chatId);
      }
    }

    if (remote.length) {
      invalidateSearchHaystacks(chatId, remote.map((msg) => msg.id).filter(Boolean));
      const { added } = store.mergeMessages(chatId, isGroup, remote);
      if (added.length) {
        searchService.upsert(chatId, added);
      }
      const { removedIds } = trimChatByRetention(chatId, isGroup);
      if (removedIds.length) {
        searchService.remove(chatId, removedIds);
        invalidateSearchHaystacks(chatId, removedIds);
      }
    }

    return mergeSearchResults(local, remote, normalizedLimit);
  },

  async setActiveChat(chatId: string, isGroup: boolean, loadSeq: LoadSeq) {
    if (!isInited) throw new Error('NOT_INITED');

    const prevActiveChatId = store.activeChatId;
    // Cancel any in-flight chat fetch/paging from the previous active chat.
    stopChatFetches();
    if (prevActiveChatId && prevActiveChatId !== chatId) {
      clearRemoteSearchControlForChat(prevActiveChatId);
    }
    const fetchEpoch = activeFetchEpoch;

    const chat = store.setActive(chatId, isGroup, loadSeq);

    // 1) Emit cached messages ASAP (instant switch).
    try {
      const cached = await loadRecentMessages(chatId, RECENT_LIMIT);
      // Keep any already-ingested messages (e.g. socket) that are newer than cache.
      const incomingIds = new Set(cached.map((m) => m.id));
      const extras = chat.messages.filter((m) => !incomingIds.has(m.id));
      const merged = cached.length ? [...cached, ...extras] : [...extras];
      store.replaceMessages(chatId, isGroup, merged);
      searchService.replaceChat(chatId, store.getOrCreate(chatId, isGroup).messages);
      pruneSearchHaystackCache(chatId, store.getOrCreate(chatId, isGroup).messages);
      emitReset(chatId, loadSeq, store.getOrCreate(chatId, isGroup).messages, {
        hasMore: chat.hasMore,
        nextBeforeSeq: chat.nextBeforeSeq,
      });
    } catch {
      // ignore cache failures
    }

    // 2) Fetch latest from network.
    const stillActive = () =>
      activeFetchEpoch === fetchEpoch && store.activeChatId === chatId && store.activeLoadSeq === loadSeq;
    if (!stillActive()) return;

    // 2.1) Warm-chat fast path: only request deltas after local latest seq.
    const localMessages = store.getOrCreate(chatId, isGroup).messages;
    const localLatest = localMessages.length ? localMessages[localMessages.length - 1] : null;
    const localLatestSeq = typeof localLatest?.seq === 'number' ? localLatest.seq : null;

    if (typeof localLatestSeq === 'number') {
      chatLatestAbort = new AbortController();
      try {
        const delta = await fetchChatMessages(chatId, { afterSeq: localLatestSeq }, chatLatestAbort.signal);
        if (!delta) return;
        if (!stillActive()) return;

        const incoming = delta.messages || [];
        if (incoming.length) {
          invalidateSearchHaystacks(chatId, incoming.map((m) => m.id).filter(Boolean));
          const { added } = store.mergeMessages(chatId, isGroup, incoming);
          if (added.length) {
            searchService.upsert(chatId, added);
            clearRemoteSearchCacheForChat(chatId);
          }
          const { removedIds } = trimChatByRetention(chatId, isGroup);
          if (removedIds.length) {
            searchService.remove(chatId, removedIds);
            invalidateSearchHaystacks(chatId, removedIds);
          }
          const removedSet = removedIds.length ? new Set(removedIds) : null;
          const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

          if (addedForPatch.length) {
            emitPatch({ kind: 'append', chatId, loadSeq, messages: addedForPatch });
          }
          if (removedIds.length) {
            emitDelete(chatId, loadSeq, removedIds);
          }

          saveMessages(incoming).catch(() => undefined);
        }
        return;
      } catch (err: any) {
        if (String(err?.message || err) === 'AUTH_ERROR') {
          throw err;
        }
        // Fallback to full refresh when afterSeq path is unavailable or inconsistent.
      }
    }

    // 2.2) Cold-chat / fallback path: fetch latest page and reset projection.
    chatLatestAbort = new AbortController();
    let result: { messages: Message[]; paging: FetchPaging } | null = null;
    let fullFetchError: unknown = null;
    try {
      result = await fetchChatMessages(
        chatId,
        { limit: INITIAL_PAGE_LIMIT },
        chatLatestAbort.signal,
      );
    } catch (err) {
      if (String((err as any)?.message || err) === 'AUTH_ERROR') {
        throw err;
      }
      fullFetchError = err;
    }

    if (!result) {
      const cached = store.getOrCreate(chatId, isGroup).messages;
      if (cached.length) {
        return;
      }
      if (fullFetchError) {
        throw fullFetchError;
      }
      return;
    }
    if (!stillActive()) return;

    const incoming = result.messages || [];
    const incomingIds = new Set(incoming.map((m) => m.id));
    const extras = chat.messages.filter((m) => !incomingIds.has(m.id));
    store.replaceMessages(chatId, isGroup, [...incoming, ...extras]);
    searchService.replaceChat(chatId, store.getOrCreate(chatId, isGroup).messages);
    pruneSearchHaystackCache(chatId, store.getOrCreate(chatId, isGroup).messages);
    if (incoming.length) {
      clearRemoteSearchCacheForChat(chatId);
    }

    chat.hasMore = result.paging.hasMore;
    chat.nextBeforeSeq = result.paging.nextBeforeSeq;

    emitReset(chatId, loadSeq, store.getOrCreate(chatId, isGroup).messages, result.paging);

    // Best-effort persist.
    saveMessages(incoming).catch(() => undefined);
  },

  async clearActiveChat() {
    stopChatFetches();
    if (store.activeChatId) {
      clearRemoteSearchControlForChat(store.activeChatId);
    }
    store.clearActive();
  },

  async loadMoreBefore(chatId: string, loadSeq: LoadSeq) {
    const active = store.getActive();
    if (!active || active.chatId !== chatId || store.activeLoadSeq !== loadSeq) return;
    if (!active.hasMore) return;

    const beforeSeq = active.nextBeforeSeq ?? undefined;

    if (chatPagingAbort) {
      chatPagingAbort.abort();
    }
    chatPagingAbort = new AbortController();
    const currentPagingEpoch = ++pagingFetchEpoch;

    let result: { messages: Message[]; paging: FetchPaging } | null = null;
    let networkError: unknown = null;
    try {
      result = await fetchChatMessages(chatId, { beforeSeq }, chatPagingAbort.signal);
    } catch (err) {
      if (String((err as any)?.message || err) === 'AUTH_ERROR') {
        throw err;
      }
      networkError = err;
    }
    if (!result && !networkError) return;
    if (
      currentPagingEpoch !== pagingFetchEpoch ||
      store.activeChatId !== chatId ||
      store.activeLoadSeq !== loadSeq
    ) {
      return;
    }

    let incoming = result?.messages || [];
    let paging: FetchPaging;
    if (result) {
      paging = result.paging;
    } else {
      const cached = await loadMessagesBeforeSeq(chatId, beforeSeq ?? null, PAGE_LIMIT).catch(() => []);
      if (!cached.length) {
        if (networkError) throw networkError;
        return;
      }
      incoming = cached;
      const headSeq =
        cached.length && typeof cached[0]?.seq === 'number' && cached[0].seq > 0
          ? cached[0].seq
          : active.nextBeforeSeq;
      paging = {
        hasMore: active.hasMore,
        nextBeforeSeq: typeof headSeq === 'number' ? headSeq : active.nextBeforeSeq,
        nextAfterSeq: null,
      };
    }

    invalidateSearchHaystacks(chatId, incoming.map((m) => m.id).filter(Boolean));
    const { added } = store.mergeMessages(chatId, active.isGroup, incoming);
    if (added.length) {
      searchService.upsert(chatId, added);
      clearRemoteSearchCacheForChat(chatId);
    }

    // Paging older history should preserve old pages in memory.
    // When the in-memory window exceeds limit, trim newest tail first.
    active.retentionAnchor = 'history';
    const { removedIds } = store.trimNewest(chatId, MAX_CHAT_MESSAGES);
    if (removedIds.length) {
      searchService.remove(chatId, removedIds);
      invalidateSearchHaystacks(chatId, removedIds);
    }
    const removedSet = removedIds.length ? new Set(removedIds) : null;
    const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

    active.hasMore = paging.hasMore;
    active.nextBeforeSeq = paging.nextBeforeSeq;

    if (addedForPatch.length) {
      emitPrepend(chatId, loadSeq, addedForPatch, paging);
    } else {
      // Even if nothing was added (dedupe), refresh paging.
      emitPrepend(chatId, loadSeq, [], paging);
    }

    if (chatId === store.activeChatId && removedIds.length) {
      emitDelete(chatId, loadSeq, removedIds);
    }

    if (result) {
      saveMessages(incoming).catch(() => undefined);
    }
  },

  async ingestMessages(messages: Message[]) {
    await ingestMessagesInternal(messages);
  },

  async ingestSocketMessages(rawMessages: any[]) {
    const normalized = normalizeSyncMessages(rawMessages);
    if (!normalized.length) return;

    // Mirror main-thread guard: ignore empty messages (no text/file/attachments),
    // but still allow explicit system messages.
    const filtered = normalized.filter((m) => {
      if (m.type === 'system') return true;
      if (m.content) return true;
      if (m.fileUrl) return true;
      if (Array.isArray(m.attachments) && m.attachments.length) return true;
      return false;
    });

    if (!filtered.length) return;
    await ingestMessagesInternal(filtered);
  },

  async ingestRealtimeEvents(events: SocketRealtimeEvent[]) {
    if (!Array.isArray(events) || events.length === 0) return;

    const rawMessages: any[] = [];
    const presenceByUser = new Map<string, { userId: string; isOnline: boolean; lastSeen?: string }>();
    const readByChatSeq = new Map<string, { chatId: string; seq: number; readCount: number }>();
    const groupEvents: any[] = [];

    for (const event of events) {
      if (!event) continue;

      if (event.type === 'message') {
        if (event.payload) rawMessages.push(event.payload);
        continue;
      }

      if (event.type === 'presence') {
        const userId = event.payload?.userId ? String(event.payload.userId) : '';
        if (!userId) continue;
        presenceByUser.set(userId, {
          userId,
          isOnline: !!event.payload.isOnline,
          lastSeen: event.payload.lastSeen,
        });
        continue;
      }

      if (event.type === 'readReceipt') {
        const chatId = event.payload?.chatId ? String(event.payload.chatId) : '';
        const seq = event.payload?.seq;
        if (!chatId || typeof seq !== 'number') continue;
        const key = `${chatId}:${seq}`;
        const readCount = typeof event.payload.readCount === 'number' ? event.payload.readCount : 1;
        const cur = readByChatSeq.get(key);
        if (!cur || readCount >= cur.readCount) {
          readByChatSeq.set(key, { chatId, seq, readCount });
        }
        continue;
      }

      if (event.type === 'groupUpdate') {
        if (event.payload) groupEvents.push(event.payload);
      }
    }

    if (rawMessages.length) {
      await apiImpl.ingestSocketMessages(rawMessages);
    }

    if (presenceByUser.size) {
      await apiImpl.ingestPresenceEvents(Array.from(presenceByUser.values()));
    }

    if (readByChatSeq.size && currentUserId) {
      const receipts = Array.from(readByChatSeq.values());
      await apiImpl.applyReadReceiptsBatch(receipts, currentUserId);
    }

    if (groupEvents.length) {
      await apiImpl.ingestGroupUpdates(groupEvents);
    }
  },

  async ingestPresenceEvents(events: Array<{ userId: string; isOnline: boolean; lastSeen?: string }>) {
    if (!Array.isArray(events) || !events.length) return;
    for (const e of events) {
      const userId = e?.userId;
      if (!userId) continue;
      queueOnlineMeta(String(userId), !!e.isOnline, e.lastSeen);
    }
  },

  async ingestGroupUpdates(events: any[]) {
    if (!Array.isArray(events) || !events.length) return;
    const tasks: Array<Promise<void>> = [];
    for (const e of events) {
      tasks.push(
        processGroupUpdateEvent(e).catch(() => {
          // ignore
        }),
      );
    }
    if (tasks.length) {
      await Promise.all(tasks);
    }
  },

  async applyReadReceipt(chatId: string, seq: number, readCount: number, currentUserId: string) {
    applyReadReceiptInternal(chatId, seq, readCount, currentUserId);
  },

  async applyReadReceiptsBatch(receipts: Array<{ chatId: string; seq: number; readCount: number }>, currentUserId: string) {
    if (!Array.isArray(receipts) || receipts.length === 0) return;

    // Coalesce to reduce repeated scans over large chats during bursty read receipts.
    const latestByChat = new Map<string, { seq: number; readCount: number }>();
    for (const r of receipts) {
      const chatId = r?.chatId;
      const seq = r?.seq;
      if (typeof chatId !== 'string') continue;
      if (typeof seq !== 'number') continue;
      const readCount = typeof r?.readCount === 'number' ? r.readCount : 1;

      const cur = latestByChat.get(chatId);
      if (!cur || seq > cur.seq || (seq === cur.seq && readCount > cur.readCount)) {
        latestByChat.set(chatId, { seq, readCount });
      }
    }

    for (const [chatId, v] of latestByChat.entries()) {
      applyReadReceiptInternal(chatId, v.seq, v.readCount, currentUserId);
    }
  },

  async sendSocketMessage(payload: SocketMessageSendPayload): Promise<SocketMessageSendAck> {
    if (!payload || !payload.content) {
      return { success: false, error: 'EMPTY_MESSAGE' };
    }

    if (!workerSocketEnabled) {
      return { success: false, error: 'SOCKET_DISABLED' };
    }

    const chatType = payload.chatType === 'group' ? 'group' : 'private';
    if (chatType === 'private' && !payload.receiverId) {
      return { success: false, error: 'receiverId required' };
    }
    if (chatType === 'group' && !payload.groupId) {
      return { success: false, error: 'groupId required' };
    }

    return emitWorkerSocketWithAck('sendMessage', {
      ...payload,
      chatType,
    });
  },

  async joinRoom(roomId: string) {
    if (!roomId) return;
    desiredJoinedRooms.add(roomId);
    await emitWorkerSocket('joinRoom', { roomId });
  },

  async leaveRoom(roomId: string) {
    if (!roomId) return;
    desiredJoinedRooms.delete(roomId);
    await emitWorkerSocket('leaveRoom', { roomId });
  },

  async markChatRead(chatId: string, seq: number) {
    if (!chatId || typeof seq !== 'number' || seq <= 0) return;
    await emitWorkerSocket('readChat', { chatId, seq });
  },

  async subscribe(cb: (patches: ChatPatch[]) => void) {
    subscribers.add(cb);
  },

  async ping() {
    return 'pong';
  },

  async shutdown() {
    detachWorkerSocket();
    desiredJoinedRooms.clear();
    stopReconnectGapRecover();
    stopSyncLoop();
    stopChatFetches();
    store.clearAll();
    searchService.clearAll();
    prefetchInFlight.clear();
    prefetchLastAt.clear();
    prefetchQueue.length = 0;
    prefetchQueued.clear();
    patchQueues.p0.length = 0;
    patchQueues.p1.length = 0;
    patchQueues.p2.length = 0;
    queuePressureWarned = false;
    pendingMeta.lastMessages.clear();
    pendingMeta.unreadDelta.clear();
    pendingMeta.online.clear();
    pendingMeta.aiMessages.clear();
    pendingMeta.chatUpserts.clear();
    pendingMeta.chatRemovals.clear();
    pendingSafetyChecks.clear();
    recentSafetyChecks.clear();
    safetyCheckInFlight = false;
    subscribers.clear();
    isInited = false;
    apiBaseUrl = '';
    accessToken = null;
    currentUserId = null;

    socketConnected = true;
    workerSocketEnabled = runtimeFlags.workerSocketEnabled;
    workerSyncFallbackEnabled = runtimeFlags.workerSyncFallback;
    workerSafetyChecksEnabled = runtimeFlags.workerSafetyChecks;
    searchTieredIndexEnabled = runtimeFlags.searchTieredIndex;
    searchTieredWasmEnabled = runtimeFlags.searchTieredWasm;
    emergencySafeModeEnabled = false;
    runtimePolicyProfile = 'baseline';
    runtimePolicyLocked = false;
    runtimePolicySource = 'default';
    runtimePolicyMatrixVersion = 'unknown';
    socketUrl = '';
    syncPts = 0;
    syncAuthError = false;
    syncPhase = 'idle';
    syncGapRecoverInFlight = false;
    syncGapRecoverLastStartedAt = 0;
    syncLoopGeneration += 1;
    syncContractValidatedAt = 0;
    syncContractError = null;
    syncContractBackoffUntil = 0;
    wasmSeqOpsEnabled = false;
    wasmRuntimeVersion = null;
    wasmInitErrorCode = null;
    wasmApiRef = null;
    for (const control of remoteSearchAbortByChat.values()) {
      try {
        control.controller.abort();
      } catch {
        // ignore
      }
    }
    remoteSearchAbortByChat.clear();
    remoteSearchInFlight.clear();
    remoteSearchCache.clear();
    searchHaystackCache.clear();
    resetTelemetryCounters();
  },
};

Comlink.expose(apiImpl);
