import * as Comlink from 'comlink';
import type { ChatCoreApi, ChatCoreInit, ChatPatch, LoadSeq } from '../chat/types';
import type { Message } from '../../types/chat';
import { throttleWithTickEnd } from './schedulers';
import { ChatCoreStore } from '../chat/store/chatCoreStore';
import { loadRecentMessages, loadSyncPts, saveMessages, saveSyncPts } from '../chat/persist/idb';
import { getChatWasmApi } from '../wasm/chat_wasm/wasm';

type FetchPaging = { hasMore: boolean; nextBeforeSeq: number | null };

const CHAT_CACHE_LIMIT = 30;
const RECENT_LIMIT = 50;
const PAGE_LIMIT = 50;
const MAX_CHAT_MESSAGES = 10_000;

const store = new ChatCoreStore(CHAT_CACHE_LIMIT);

let apiBaseUrl = '';
let accessToken: string | null = null;
let currentUserId: string | null = null;
let isInited = false;

let socketConnected = true;

let syncPts = 0;
let syncAuthError = false;
let syncAbort: AbortController | null = null;
let syncTask: Promise<void> | null = null;

// Abort controllers for chat history fetches to avoid wasted work during fast chat switching / paging.
let chatLatestAbort: AbortController | null = null;
let chatPagingAbort: AbortController | null = null;

const SYNC_POLL_TIMEOUT_MS = 30_000;
const SYNC_DIFF_LIMIT = 100;

const subscribers = new Set<(patches: ChatPatch[]) => void>();
let pendingPatches: ChatPatch[] = [];

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
  if (!pendingPatches.length && !hasMeta) return;

  const batch = pendingPatches;
  pendingPatches = [];

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

    batch.push({ kind: 'meta', lastMessages, unreadDeltas, onlineUpdates, chatUpserts, chatRemovals });
  }

  subscribers.forEach((cb) => {
    try {
      // Comlink proxied function; may return a Promise, but we don't await.
      (cb as any)(batch);
    } catch {
      // ignore
    }
  });
});

function emitPatch(patch: ChatPatch) {
  pendingPatches.push(patch);
  flushPatches();
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

async function fetchChatMessagesLegacy(
  chatId: string,
  isGroup: boolean,
  beforeSeq?: number,
  page?: number,
  signal?: AbortSignal,
): Promise<{ messages: Message[]; paging: FetchPaging; page?: number } | null> {
  if (isGroup) {
    const groupId = chatId.startsWith('g:') ? chatId.substring(2) : chatId;
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (typeof beforeSeq === 'number') params.set('beforeSeq', String(beforeSeq));
    const url = `${apiBaseUrl}/api/messages/group/${encodeURIComponent(groupId)}?${params.toString()}`;
    let res: Response;
    let json: any;
    try {
      ({ res, json } = await fetchJson(url, { signal }));
    } catch (err: any) {
      if (err?.name === 'AbortError') return null;
      throw err;
    }
    if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
    if (!res.ok) throw new Error((json && (json.error || json.message)) || `HTTP_${res.status}`);

    const messages = Array.isArray(json?.messages) ? (json.messages as Message[]) : [];
    const paging: FetchPaging = {
      hasMore: !!json?.paging?.hasMore,
      nextBeforeSeq: typeof json?.paging?.nextBeforeSeq === 'number' ? json.paging.nextBeforeSeq : null,
    };
    return { messages, paging };
  }

  // Private legacy API is receiverId + page/limit.
  if (!currentUserId) throw new Error('NOT_INITED');
  const otherUserId = parsePrivateChatOtherUserId(chatId, currentUserId);
  if (!otherUserId) throw new Error('INVALID_CHAT');

  const nextPage = page ?? 1;
  const url = `${apiBaseUrl}/api/messages/conversation/${encodeURIComponent(otherUserId)}?page=${nextPage}&limit=${PAGE_LIMIT}`;
  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(url, { signal }));
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
  if (isAuthErrorStatus(res.status)) throw new Error('AUTH_ERROR');
  if (!res.ok) throw new Error((json && (json.error || json.message)) || `HTTP_${res.status}`);

  const messages = Array.isArray(json?.messages) ? (json.messages as Message[]) : [];
  const paging: FetchPaging = {
    hasMore: !!json?.pagination?.hasMore,
    nextBeforeSeq: null,
  };
  return { messages, paging, page: nextPage };
}

async function fetchChatMessagesUnified(
  chatId: string,
  beforeSeq?: number,
  signal?: AbortSignal,
): Promise<{ messages: Message[]; paging: FetchPaging } | null> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (typeof beforeSeq === 'number') params.set('beforeSeq', String(beforeSeq));

  const url = `${apiBaseUrl}/api/messages/chat/${encodeURIComponent(chatId)}?${params.toString()}`;
  let res: Response;
  let json: any;
  try {
    ({ res, json } = await fetchJson(url, { signal }));
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }

  if (res.status === 404) return null; // Not deployed yet; fallback to legacy endpoints.
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
  };
  return { messages, paging };
}

async function fetchChatMessages(
  chatId: string,
  isGroup: boolean,
  opts: { beforeSeq?: number; page?: number } = {},
  signal?: AbortSignal,
) {
  const unified = await fetchChatMessagesUnified(chatId, opts.beforeSeq, signal);
  if (unified) return { ...unified, page: undefined };
  return fetchChatMessagesLegacy(chatId, isGroup, opts.beforeSeq, opts.page, signal);
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
    const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
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
  if (socketConnected) return;
  if (syncAuthError) return;
  if (syncTask) return;

  syncAbort = new AbortController();
  const signal = syncAbort.signal;

  syncTask = (async () => {
    try {
      await gapRecoverUntilLatest(signal);
    } catch (err: any) {
      if (String(err?.message || err) === 'AUTH_ERROR') {
        syncAuthError = true;
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
          return;
        }

        await sleepMs(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 10_000);
      }
    }
  })().finally(() => {
    syncAbort = null;
    syncTask = null;
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
          }
        : null,
    );

    try {
      syncPts = await loadSyncPts(params.userId);
    } catch {
      syncPts = 0;
    }

    // If the main thread already marked socket as disconnected before init, start sync now.
    startSyncLoop();
  },

  async updateTokens(nextAccessToken: string, nextRefreshToken?: string | null) {
    accessToken = nextAccessToken;
    // Keep signature compatible; refresh token is owned by main thread.
    void nextRefreshToken;

    if (syncAuthError) {
      syncAuthError = false;
      startSyncLoop();
    }
  },

  async setConnectivity(nextSocketConnected: boolean) {
    socketConnected = nextSocketConnected;

    if (socketConnected) {
      stopSyncLoop();
      if (!syncAuthError) {
        // Best-effort gap recovery on reconnect.
        const ctl = new AbortController();
        void gapRecoverUntilLatest(ctl.signal).catch(() => undefined);
      }
      return;
    }

    startSyncLoop();
  },

  async prefetchChat(chatId: string, isGroup: boolean) {
    // Best-effort warm: read from IndexedDB into worker memory (no patches emitted).
    const chat = store.getOrCreate(chatId, isGroup);
    if (chat.messages.length) return;

    try {
      const cached = await loadRecentMessages(chatId, RECENT_LIMIT);
      if (!cached.length) return;
      store.replaceMessages(chatId, isGroup, cached);
    } catch {
      // ignore
    }
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

    chatLatestAbort = new AbortController();
    const result = await fetchChatMessages(chatId, isGroup, {}, chatLatestAbort.signal);
    if (!result) return;
    if (!stillActive()) return;

    const incoming = result.messages || [];
    const incomingIds = new Set(incoming.map((m) => m.id));
    const extras = chat.messages.filter((m) => !incomingIds.has(m.id));
    store.replaceMessages(chatId, isGroup, [...incoming, ...extras]);

    chat.hasMore = result.paging.hasMore;
    chat.nextBeforeSeq = result.paging.nextBeforeSeq;
    if (typeof result.page === 'number') chat.currentPage = result.page;

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

    // Unified cursor uses beforeSeq; legacy private uses page.
    const nextPage = active.isGroup ? undefined : active.currentPage + 1;

    if (chatPagingAbort) {
      chatPagingAbort.abort();
    }
    chatPagingAbort = new AbortController();

    const result = await fetchChatMessages(chatId, active.isGroup, { beforeSeq, page: nextPage }, chatPagingAbort.signal);
    if (!result) return;
    if (store.activeChatId !== chatId || store.activeLoadSeq !== loadSeq) return;

    const incoming = result.messages || [];
    const { added } = store.mergeMessages(chatId, active.isGroup, incoming);

    const { removedIds } = store.trimOldest(chatId, MAX_CHAT_MESSAGES);
    const removedSet = removedIds.length ? new Set(removedIds) : null;
    const addedForPatch = removedSet ? added.filter((m) => !removedSet.has(m.id)) : added;

    active.hasMore = result.paging.hasMore;
    active.nextBeforeSeq = result.paging.nextBeforeSeq;
    if (typeof result.page === 'number') active.currentPage = result.page;

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
    pendingPatches = [];
    subscribers.clear();
    isInited = false;
    apiBaseUrl = '';
    accessToken = null;
    currentUserId = null;

    socketConnected = true;
    syncPts = 0;
    syncAuthError = false;
  },
};

Comlink.expose(apiImpl);
