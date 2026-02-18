import * as Comlink from 'comlink';
import type {
  ChatCoreApi,
  ChatCoreInit,
  ChatPatch,
  ChatPrefetchTarget,
  ChatSyncPhase,
  LoadSeq,
} from '../chat/types';
import type { Message } from '../../types/chat';
import type { SocketRealtimeEvent } from '../chat/realtime';
import { throttleWithTickEnd } from './schedulers';
import { ChatCoreStore } from '../chat/store/chatCoreStore';
import { loadMessagesByIds, loadRecentMessages, loadSyncPts, saveMessages, saveSyncPts } from '../chat/persist/idb';
import { getChatWasmApi } from '../wasm/chat_wasm/wasm';
import { WorkerMessageSearchService } from '../chat/search/messageSearchIndex';

type FetchPaging = { hasMore: boolean; nextBeforeSeq: number | null; nextAfterSeq?: number | null };
type FetchCursor = { beforeSeq?: number; afterSeq?: number };

const CHAT_CACHE_LIMIT = 30;
const RECENT_LIMIT = 50;
const PAGE_LIMIT = 50;
const MAX_CHAT_MESSAGES = 10_000;
const SEARCH_CACHE_WARM_LIMIT = 800;
const SEARCH_INDEX_MAX_MESSAGES = 6_000;
const SEARCH_FALLBACK_SCAN_LIMIT = 1_600;
const PREFETCH_NETWORK_COOLDOWN_MS = 25_000;
const PREFETCH_MAX_IN_FLIGHT = 2;

const store = new ChatCoreStore(CHAT_CACHE_LIMIT);
const searchService = new WorkerMessageSearchService(SEARCH_INDEX_MAX_MESSAGES);

let apiBaseUrl = '';
let accessToken: string | null = null;
let currentUserId: string | null = null;
let isInited = false;

let socketConnected = true;

let syncPts = 0;
let syncAuthError = false;
let syncAbort: AbortController | null = null;
let syncTask: Promise<void> | null = null;
let syncPhase: ChatSyncPhase = 'idle';

// Abort controllers for chat history fetches to avoid wasted work during fast chat switching / paging.
let chatLatestAbort: AbortController | null = null;
let chatPagingAbort: AbortController | null = null;

const prefetchInFlight = new Set<string>();
const prefetchLastAt = new Map<string, number>();
const prefetchQueue: ChatPrefetchTarget[] = [];
const prefetchQueued = new Set<string>();

const SYNC_POLL_TIMEOUT_MS = 30_000;
const SYNC_DIFF_LIMIT = 100;

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
  chatUpserts: new Map<string, { isGroup: boolean; title?: string; avatarUrl?: string; memberCount?: number }>(),
  chatRemovals: new Set<string>(),
};

const flushPatches = throttleWithTickEnd(() => {
  const hasMeta =
    pendingMeta.lastMessages.size > 0 ||
    pendingMeta.unreadDelta.size > 0 ||
    pendingMeta.online.size > 0 ||
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
    pendingMeta.chatUpserts.clear();
    pendingMeta.chatRemovals.clear();

    enqueuePatch({ kind: 'meta', lastMessages, unreadDeltas, onlineUpdates, chatUpserts, chatRemovals });
  }

  if (queuedPatchCount() === 0) return;

  const batch = dequeuePatchBatch();
  if (!batch.length) return;
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

function enqueuePatch(patch: ChatPatch) {
  const chunks = splitPatch(patch);
  for (const p of chunks) {
    const priority = getPatchPriority(p);
    const queue = patchQueues[priority];
    if (coalesceTailPatch(queue, p)) continue;
    queue.push(p);
  }

  const queued = queuedPatchCount();
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

function queueChatRemovalMeta(chatId: string) {
  pendingMeta.chatUpserts.delete(chatId);
  pendingMeta.chatRemovals.add(chatId);
  flushPatches();
}

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
  const headers = {
    ...buildAuthHeaders(),
    ...(init.headers as any),
  };

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
}

function isAuthErrorStatus(status: number) {
  return status === 401 || status === 403;
}

function unwrapSuccessData(json: any): any {
  if (json && json.success === true && json.data !== undefined) return json.data;
  return json;
}

function withApiBase(url?: string | null): string | undefined {
  if (!url) return url || undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${apiBaseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
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

async function fetchSyncState(signal: AbortSignal): Promise<number | null> {
  const url = `${apiBaseUrl}/api/sync/state`;
  const { res, json } = await fetchJson(url, { signal });
  if (res.status === 404) return null;
  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) throw new Error((unwrapSuccessData(json)?.error?.message as string) || `HTTP_${res.status}`);
  const data = unwrapSuccessData(json);
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

async function fetchChatMessagesUnified(
  chatId: string,
  cursor: FetchCursor = {},
  signal?: AbortSignal,
): Promise<{ messages: Message[]; paging: FetchPaging } | null> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
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

  const messages = Array.isArray(json?.messages) ? (json.messages as Message[]) : [];
  const paging: FetchPaging = {
    hasMore: !!json?.paging?.hasMore,
    nextBeforeSeq: typeof json?.paging?.nextBeforeSeq === 'number' ? json.paging.nextBeforeSeq : null,
    nextAfterSeq: typeof json?.paging?.nextAfterSeq === 'number' ? json.paging.nextAfterSeq : null,
  };
  return { messages, paging };
}

async function fetchChatMessages(chatId: string, cursor: FetchCursor = {}, signal?: AbortSignal) {
  return fetchChatMessagesUnified(chatId, cursor, signal);
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
  } catch {
    // ignore cache failures
  }
}

async function warmPrefetchFromNetwork(chatId: string, isGroup: boolean): Promise<void> {
  if (!isInited || !accessToken) return;
  if (store.activeChatId === chatId) return;

  const now = Date.now();
  const lastAt = prefetchLastAt.get(chatId) || 0;
  if (now - lastAt < PREFETCH_NETWORK_COOLDOWN_MS) return;
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
      store.mergeMessages(chatId, isGroup, incoming);
      searchService.upsert(chatId, incoming);
      const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
      if (removedIds.length) {
        searchService.remove(chatId, removedIds);
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

function enqueueNetworkPrefetch(chatId: string, isGroup: boolean) {
  if (prefetchInFlight.has(chatId) || prefetchQueued.has(chatId)) return;
  prefetchQueued.add(chatId);
  prefetchQueue.push({ chatId, isGroup });
  pumpPrefetchQueue();
}

async function prefetchChatsInternal(targets: ChatPrefetchTarget[]): Promise<void> {
  const normalized = normalizePrefetchTargets(targets);
  if (!normalized.length) return;

  for (const target of normalized) {
    await hydratePrefetchFromCache(target.chatId, target.isGroup);
    enqueueNetworkPrefetch(target.chatId, target.isGroup);
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
      }
    } catch {
      // ignore cache read failures
    }
  }

  const source = store.getOrCreate(chatId, isGroup).messages;
  if (!source.length) return [];

  searchService.ensureChat(chatId, source);
  const indexed = searchService.query(chatId, normalizedQuery, normalizedLimit);
  if (indexed.length) return indexed;

  // Fallback path: wasm substring matcher over latest N messages.
  const start = source.length > SEARCH_FALLBACK_SCAN_LIMIT ? source.length - SEARCH_FALLBACK_SCAN_LIMIT : 0;
  const candidates = source.slice(start).reverse();
  if (!candidates.length) return [];

  const wasm = await getChatWasmApi();
  if (wasm) {
    try {
      const haystacks = candidates.map(buildSearchHaystack);
      const idxs = Array.from(wasm.search_contains_indices(haystacks, normalizedQuery, normalizedLimit));
      if (idxs.length) {
        const out: Message[] = [];
        const seen = new Set<string>();
        for (const idx of idxs) {
          const msg = candidates[idx];
          if (!msg || seen.has(msg.id)) continue;
          seen.add(msg.id);
          out.push(msg);
          if (out.length >= normalizedLimit) break;
        }
        if (out.length) return out;
      }
    } catch {
      // fallback to JS matcher
    }
  }

  const out: Message[] = [];
  const seen = new Set<string>();
  const terms = normalizedQuery
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  for (const msg of candidates) {
    if (!msg?.id || seen.has(msg.id)) continue;
    const haystack = buildSearchHaystack(msg);
    let ok = true;
    for (const term of terms) {
      if (!haystack.includes(term)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    seen.add(msg.id);
    out.push(msg);
    if (out.length >= normalizedLimit) break;
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
    const { added } = store.mergeMessages(chatId, bucket.isGroup, bucket.messages);
    if (added.length) {
      searchService.upsert(chatId, added);
    }
    const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
    if (removedIds.length) {
      searchService.remove(chatId, removedIds);
    }
    const removedSet = removedIds.length ? new Set(removedIds) : null;
    const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

    // Chat list meta: last message preview and unread deltas.
    const listId = chatListIdFromChatId(chatId, bucket.isGroup);
    if (listId) {
      const chat = store.getOrCreate(chatId, bucket.isGroup);
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
  const messages = normalizeSyncMessages(rawMessages);
  if (messages.length) {
    await ingestMessagesInternal(messages);
  }

  if (currentUserId && Array.isArray(updates)) {
    const groupTasks: Array<Promise<void>> = [];
    for (const u of updates) {
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

  await commitSyncPts(nextPts);
}

async function gapRecoverUntilLatest(signal: AbortSignal): Promise<void> {
  if (!currentUserId) return;
  if (syncAuthError) return;
  setSyncPhase('catching_up', 'difference');

  const serverPts = await fetchSyncState(signal);
  if (serverPts === null) return; // sync API not deployed
  if (serverPts <= syncPts) {
    // Keep local pts monotonic.
    await commitSyncPts(serverPts);
    return;
  }

  // Fetch in batches until latest.
  while (!signal.aborted) {
    const from = syncPts;
    const diff = await fetchSyncDifference(from, signal);
    if (!diff) return;
    await processSyncPayload(diff.updates, diff.messages, diff.statePts);
    if (diff.isLatest) break;
    if (diff.statePts <= from && !diff.updates.length && !diff.messages.length) break;
  }
}

async function pollUpdatesOnce(signal: AbortSignal): Promise<void> {
  const from = syncPts;
  const res = await fetchSyncUpdates(from, signal);
  if (!res) return;

  if (res.updates.length || res.messages.length) {
    await processSyncPayload(res.updates, res.messages, res.statePts);
    // If server is far ahead, pull the rest via difference.
    if (res.updates.length >= SYNC_DIFF_LIMIT - 1) {
      await gapRecoverUntilLatest(signal);
    }
    return;
  }

  // Backend /updates is simplified and may return empty updates even when pts advanced.
  if (res.statePts > from) {
    await gapRecoverUntilLatest(signal);
  }

  // Long-poll loop is healthy.
  setSyncPhase('live', 'poll');
}

function stopSyncLoop() {
  if (syncAbort) {
    syncAbort.abort();
  }
  syncAbort = null;
  syncTask = null;
}

function stopChatFetches() {
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
  if (!isInited) return;
  if (socketConnected) {
    setSyncPhase('live', 'socket');
    return;
  }
  if (syncAuthError) {
    setSyncPhase('auth_error', 'auth');
    return;
  }
  if (syncTask) return;

  syncAbort = new AbortController();
  const signal = syncAbort.signal;
  setSyncPhase('disconnected', 'fallback');

  syncTask = (async () => {
    try {
      await gapRecoverUntilLatest(signal);
      if (!signal.aborted) {
        setSyncPhase('live', 'gap_recovered');
      }
    } catch (err: any) {
      if (String(err?.message || err) === 'AUTH_ERROR') {
        syncAuthError = true;
        setSyncPhase('auth_error', 'auth');
        return;
      }
    }

    let backoffMs = 1000;
    while (!signal.aborted && !socketConnected) {
      try {
        await pollUpdatesOnce(signal);
        backoffMs = 1000;
      } catch (err: any) {
        if (signal.aborted) return;

        if (String(err?.message || err) === 'AUTH_ERROR') {
          syncAuthError = true;
          setSyncPhase('auth_error', 'auth');
          return;
        }

        setSyncPhase('backoff', 'retry');
        await sleepMs(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 10_000);
      }
    }
  })().finally(() => {
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
  async init(params: ChatCoreInit) {
    apiBaseUrl = params.apiBaseUrl.replace(/\/$/, '');
    accessToken = params.accessToken;
    // Worker does not refresh tokens itself; main thread refreshes and calls `updateTokens`.
    void params.refreshToken;
    currentUserId = params.userId;
    isInited = true;

    // Best-effort: initialize Rust/WASM hot-path helpers.
    // If it fails, the worker continues with the TS fallback path.
    const wasm = await getChatWasmApi();
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
          }
        : null,
    );

    try {
      syncPts = await loadSyncPts(params.userId);
    } catch {
      syncPts = 0;
    }

    setSyncPhase(socketConnected ? 'live' : 'disconnected', 'init');

    // If the main thread already marked socket as disconnected before init, start sync now.
    startSyncLoop();
  },

  async updateTokens(nextAccessToken: string, nextRefreshToken?: string | null) {
    accessToken = nextAccessToken;
    // Keep signature compatible; refresh token is owned by main thread.
    void nextRefreshToken;

    if (syncAuthError) {
      syncAuthError = false;
      setSyncPhase(socketConnected ? 'live' : 'disconnected', 'token_refresh');
      startSyncLoop();
    }
  },

  async setConnectivity(nextSocketConnected: boolean) {
    socketConnected = nextSocketConnected;

    if (socketConnected) {
      stopSyncLoop();
      setSyncPhase('live', 'socket_connected');
      if (!syncAuthError) {
        // Best-effort gap recovery on reconnect.
        const ctl = new AbortController();
        void gapRecoverUntilLatest(ctl.signal)
          .then(() => {
            if (socketConnected && !syncAuthError) {
              setSyncPhase('live', 'socket_gap_recovered');
            }
          })
          .catch(() => undefined);
      }
      return;
    }

    setSyncPhase('disconnected', 'socket_disconnected');
    startSyncLoop();
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
          store.mergeMessages(chatId, isGroup, cached);
          searchService.upsert(chatId, cached);
          const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
          if (removedIds.length) {
            searchService.remove(chatId, removedIds);
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
    return searchMessagesInChat(chatId, isGroup, query, limit);
  },

  async setActiveChat(chatId: string, isGroup: boolean, loadSeq: LoadSeq) {
    if (!isInited) throw new Error('NOT_INITED');

    // Cancel any in-flight chat fetch/paging from the previous active chat.
    stopChatFetches();

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
      emitReset(chatId, loadSeq, store.getOrCreate(chatId, isGroup).messages, {
        hasMore: chat.hasMore,
        nextBeforeSeq: chat.nextBeforeSeq,
      });
    } catch {
      // ignore cache failures
    }

    // 2) Fetch latest from network.
    const stillActive = () => store.activeChatId === chatId && store.activeLoadSeq === loadSeq;
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
          const { added } = store.mergeMessages(chatId, isGroup, incoming);
          if (added.length) {
            searchService.upsert(chatId, added);
          }
          const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
          if (removedIds.length) {
            searchService.remove(chatId, removedIds);
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
    const result = await fetchChatMessages(chatId, {}, chatLatestAbort.signal);
    if (!result) return;
    if (!stillActive()) return;

    const incoming = result.messages || [];
    const incomingIds = new Set(incoming.map((m) => m.id));
    const extras = chat.messages.filter((m) => !incomingIds.has(m.id));
    store.replaceMessages(chatId, isGroup, [...incoming, ...extras]);
    searchService.replaceChat(chatId, store.getOrCreate(chatId, isGroup).messages);

    chat.hasMore = result.paging.hasMore;
    chat.nextBeforeSeq = result.paging.nextBeforeSeq;

    emitReset(chatId, loadSeq, store.getOrCreate(chatId, isGroup).messages, result.paging);

    // Best-effort persist.
    saveMessages(incoming).catch(() => undefined);
  },

  async clearActiveChat() {
    stopChatFetches();
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

    const result = await fetchChatMessages(chatId, { beforeSeq }, chatPagingAbort.signal);
    if (!result) return;
    if (store.activeChatId !== chatId || store.activeLoadSeq !== loadSeq) return;

    const incoming = result.messages || [];
    const { added } = store.mergeMessages(chatId, active.isGroup, incoming);
    if (added.length) {
      searchService.upsert(chatId, added);
    }

    const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
    if (removedIds.length) {
      searchService.remove(chatId, removedIds);
    }
    const removedSet = removedIds.length ? new Set(removedIds) : null;
    const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

    active.hasMore = result.paging.hasMore;
    active.nextBeforeSeq = result.paging.nextBeforeSeq;

    if (addedForPatch.length) {
      emitPrepend(chatId, loadSeq, addedForPatch, result.paging);
    } else {
      // Even if nothing was added (dedupe), refresh paging.
      emitPrepend(chatId, loadSeq, [], result.paging);
    }

    if (chatId === store.activeChatId && removedIds.length) {
      emitDelete(chatId, loadSeq, removedIds);
    }

    saveMessages(incoming).catch(() => undefined);
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

  async subscribe(cb: (patches: ChatPatch[]) => void) {
    subscribers.add(cb);
  },

  async ping() {
    return 'pong';
  },

  async shutdown() {
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
    pendingMeta.chatUpserts.clear();
    pendingMeta.chatRemovals.clear();
    subscribers.clear();
    isInited = false;
    apiBaseUrl = '';
    accessToken = null;
    currentUserId = null;

    socketConnected = true;
    syncPts = 0;
    syncAuthError = false;
    syncPhase = 'idle';
  },
};

Comlink.expose(apiImpl);
