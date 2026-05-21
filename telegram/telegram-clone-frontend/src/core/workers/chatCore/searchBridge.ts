/**
 * Search bridge — local + remote message search with tiered fallback.
 *
 * Single responsibility: search orchestration (inverted index → WASM → JS → remote).
 * No socket, no sync, no persistence writes.
 */

import type { Message } from '../../../types/chat';
import { WorkerMessageSearchService } from '../../chat/search/messageSearchIndex';
import { runtimeFlags } from '../../chat/runtimeFlags';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchBridgeContext {
  getApiBaseUrl: () => string;
  getCurrentUserId: () => string | null;
  getWasmApiRef: () => any | null;
  telemetry: Record<string, number>;
  markTelemetryUpdate: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_CACHE_WARM_LIMIT = 800;
const SEARCH_INDEX_MAX_MESSAGES = 6_000;
const SEARCH_FALLBACK_SCAN_LIMIT = 1_600;
const SEARCH_REMOTE_CACHE_TTL_MS = 20_000;
const SEARCH_REMOTE_CACHE_MAX_KEYS = 240;
const SEARCH_REMOTE_MIN_QUERY_LEN = 2;
const SEARCH_REMOTE_REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_REMOTE_LOCAL_HIT_SKIP_RATIO = 0.8;

// ---------------------------------------------------------------------------
// Search bridge
// ---------------------------------------------------------------------------

export class SearchBridge {
  private readonly searchService = new WorkerMessageSearchService(SEARCH_INDEX_MAX_MESSAGES);
  private readonly searchHaystackCache = new Map<string, Map<string, string>>();
  private readonly remoteSearchCache = new Map<string, { messages: Message[]; cachedAt: number }>();
  private readonly remoteSearchInFlight = new Map<string, Promise<Message[]>>();
  private readonly remoteSearchControl = new Map<string, { lastAt: number; backoffMs: number }>();

  private searchTieredIndexEnabled = runtimeFlags.searchTieredIndex;
  private searchTieredWasmEnabled = runtimeFlags.searchTieredWasm;

  constructor(private readonly ctx: SearchBridgeContext) {}

  // -------------------------------------------------------------------------
  // Haystack cache
  // -------------------------------------------------------------------------

  private buildSearchHaystack(message: Message): string {
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

  clearSearchHaystackCacheForChat(chatId: string): void {
    if (!chatId) return;
    this.searchHaystackCache.delete(chatId);
  }

  pruneSearchHaystackCache(chatId: string, messages: Message[]): void {
    if (!chatId) return;
    const cache = this.searchHaystackCache.get(chatId);
    if (!cache || !cache.size) return;

    const validIds = new Set(messages.map((m) => m.id).filter(Boolean));
    for (const id of cache.keys()) {
      if (validIds.has(id)) continue;
      cache.delete(id);
    }
    if (!cache.size) {
      this.searchHaystackCache.delete(chatId);
    }
  }

  invalidateSearchHaystacks(chatId: string, ids: string[]): void {
    if (!chatId || !ids.length) return;
    const cache = this.searchHaystackCache.get(chatId);
    if (!cache || !cache.size) return;
    for (const id of ids) {
      if (!id) continue;
      cache.delete(id);
    }
    if (!cache.size) {
      this.searchHaystackCache.delete(chatId);
    }
  }

  private getSearchHaystack(chatId: string, message: Message): string {
    if (!message?.id) {
      return this.buildSearchHaystack(message);
    }
    let cache = this.searchHaystackCache.get(chatId);
    if (!cache) {
      cache = new Map<string, string>();
      this.searchHaystackCache.set(chatId, cache);
    }
    const cached = cache.get(message.id);
    if (cached !== undefined) {
      return cached;
    }
    const next = this.buildSearchHaystack(message);
    cache.set(message.id, next);
    return next;
  }

  // -------------------------------------------------------------------------
  // Local search
  // -------------------------------------------------------------------------

  private shouldFetchRemoteSearch(localCount: number, limit: number, query: string): boolean {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < SEARCH_REMOTE_MIN_QUERY_LEN) return false;
    if (localCount >= limit) return false;

    const skipThreshold = Math.floor(limit * SEARCH_REMOTE_LOCAL_HIT_SKIP_RATIO);
    if (skipThreshold > 0 && localCount >= skipThreshold) return false;

    return true;
  }

  searchMessagesLocal(
    chatId: string,
    query: string,
    limit: number,
    messages: Message[],
  ): Message[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;

    if (!messages.length) return [];
    this.searchService.ensureChat(chatId, messages);

    // Keep search scope bounded for stable latency.
    const start = messages.length > SEARCH_FALLBACK_SCAN_LIMIT ? messages.length - SEARCH_FALLBACK_SCAN_LIMIT : 0;
    const candidates = messages.slice(start).reverse();
    if (!candidates.length) return [];

    // Tier 1: inverted index query
    let local = this.searchTieredIndexEnabled
      ? this.searchService.queryLayered(chatId, normalizedQuery, normalizedLimit)
      : this.searchService.query(chatId, normalizedQuery, normalizedLimit);
    if (local.length >= normalizedLimit) {
      return local.slice(0, normalizedLimit);
    }

    // Tier 2: WASM scan over bounded recent window
    const wasm = this.searchTieredWasmEnabled && runtimeFlags.wasmSearchFallback ? this.ctx.getWasmApiRef() : null;
    if (wasm && local.length < normalizedLimit) {
      try {
        const haystacks = candidates.map((msg) => this.getSearchHaystack(chatId, msg));
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
            local = this.mergeSearchResults(local, wasmHits, normalizedLimit);
            if (local.length >= normalizedLimit) {
              return local.slice(0, normalizedLimit);
            }
          }
        }
      } catch {
        // fallback to non-wasm path
      }
    }

    // Tier 3: JS substring fallback
    const jsHits: Message[] = [];
    const seen = new Set<string>();
    const terms = normalizedQuery
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    for (const msg of candidates) {
      if (!msg?.id || seen.has(msg.id)) continue;
      const haystack = this.getSearchHaystack(chatId, msg);
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

    return this.mergeSearchResults(local, jsHits, normalizedLimit);
  }

  // -------------------------------------------------------------------------
  // Remote search
  // -------------------------------------------------------------------------

  private makeRemoteSearchCacheKey(chatId: string, query: string, limit: number): string {
    const normalizedQuery = query.trim().toLowerCase();
    return `${chatId}::${normalizedQuery}::${limit}`;
  }

  private trimRemoteSearchCache(): void {
    if (this.remoteSearchCache.size <= SEARCH_REMOTE_CACHE_MAX_KEYS) return;
    const entries = Array.from(this.remoteSearchCache.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const overflow = entries.length - SEARCH_REMOTE_CACHE_MAX_KEYS;
    for (let i = 0; i < overflow; i += 1) {
      this.remoteSearchCache.delete(entries[i][0]);
    }
  }

  clearRemoteSearchCacheForChat(chatId: string): void {
    if (!chatId || !this.remoteSearchCache.size) return;
    const prefix = `${chatId}::`;
    for (const key of this.remoteSearchCache.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.remoteSearchCache.delete(key);
    }
  }

  clearRemoteSearchControlForChat(chatId: string): void {
    if (!chatId) return;
    const prefix = `${chatId}::`;
    for (const key of this.remoteSearchControl.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.remoteSearchControl.delete(key);
    }
  }

  clearRemoteSearchStateForChat(chatId: string): void {
    this.clearRemoteSearchCacheForChat(chatId);
    this.clearRemoteSearchControlForChat(chatId);
    this.clearSearchHaystackCacheForChat(chatId);
  }

  getCachedRemoteSearch(chatId: string, query: string, limit: number): Message[] | null {
    const key = this.makeRemoteSearchCacheKey(chatId, query, limit);
    const entry = this.remoteSearchCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > SEARCH_REMOTE_CACHE_TTL_MS) {
      this.remoteSearchCache.delete(key);
      return null;
    }
    return entry.messages;
  }

  setCachedRemoteSearch(chatId: string, query: string, limit: number, messages: Message[]): void {
    const key = this.makeRemoteSearchCacheKey(chatId, query, limit);
    this.remoteSearchCache.set(key, { messages, cachedAt: Date.now() });
    this.trimRemoteSearchCache();
  }

  async searchMessagesRemote(
    chatId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return [];

    const cached = this.getCachedRemoteSearch(chatId, query, limit);
    if (cached) return cached;

    const cacheKey = this.makeRemoteSearchCacheKey(chatId, query, limit);
    const inFlight = this.remoteSearchInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const control = this.remoteSearchControl.get(chatId);
    if (control) {
      const elapsed = Date.now() - control.lastAt;
      if (elapsed < control.backoffMs) return [];
    }

    const promise = this.doRemoteSearch(chatId, query, limit, apiBaseUrl, signal);
    this.remoteSearchInFlight.set(cacheKey, promise);

    try {
      const result = await promise;
      if (result.length) {
        this.setCachedRemoteSearch(chatId, query, limit, result);
        this.remoteSearchControl.delete(chatId);
      } else {
        const prev = this.remoteSearchControl.get(chatId);
        this.remoteSearchControl.set(chatId, {
          lastAt: Date.now(),
          backoffMs: prev ? Math.min(prev.backoffMs * 2, 60_000) : 5_000,
        });
      }
      return result;
    } finally {
      this.remoteSearchInFlight.delete(cacheKey);
    }
  }

  private async doRemoteSearch(
    chatId: string,
    query: string,
    limit: number,
    apiBaseUrl: string,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    const params = new URLSearchParams({
      chatId,
      q: query,
      limit: String(limit),
    });
    const url = `${apiBaseUrl}/api/messages/search?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_REMOTE_REQUEST_TIMEOUT_MS);

    const combinedSignal = signal
      ? this.combineAbortSignals(signal, controller.signal)
      : controller.signal;

    try {
      const res = await fetch(url, { signal: combinedSignal });
      if (!res.ok) return [];

      const json = await res.json().catch(() => null);
      const data = json?.data ?? json;
      const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
      return rawMessages.map((m: any) => this.normalizeRemoteMessage(m)).filter(Boolean);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeRemoteMessage(raw: any): Message | null {
    if (!raw) return null;
    const id = String(raw.id || raw._id || '');
    const chatId = raw.chatId ? String(raw.chatId) : '';
    if (!id || !chatId) return null;

    return {
      id,
      chatId,
      chatType: raw.chatType === 'group' ? 'group' : 'private',
      content: String(raw.content ?? ''),
      senderId: String(raw.senderId || raw.sender || 'unknown'),
      senderUsername: String(raw.senderUsername || raw.username || '未知用户'),
      timestamp: raw.timestamp || new Date().toISOString(),
      type: (raw.type || 'text') as Message['type'],
      status: (raw.status || 'delivered') as Message['status'],
    };
  }

  private combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (a.aborted || b.aborted) {
      controller.abort();
      return controller.signal;
    }
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
  }

  // -------------------------------------------------------------------------
  // Result merging
  // -------------------------------------------------------------------------

  mergeSearchResults(local: Message[], remote: Message[], limit: number): Message[] {
    const seen = new Set<string>();
    const merged: Message[] = [];

    for (const msg of local) {
      if (!msg?.id || seen.has(msg.id)) continue;
      seen.add(msg.id);
      merged.push(msg);
      if (merged.length >= limit) break;
    }

    for (const msg of remote) {
      if (!msg?.id || seen.has(msg.id)) continue;
      seen.add(msg.id);
      merged.push(msg);
      if (merged.length >= limit) break;
    }

    return merged;
  }

  // -------------------------------------------------------------------------
  // Search index management
  // -------------------------------------------------------------------------

  replaceChat(chatId: string, messages: Message[]): void {
    this.searchService.replaceChat(chatId, messages);
    this.pruneSearchHaystackCache(chatId, messages);
  }

  ensureChat(chatId: string, messages: Message[]): void {
    this.searchService.ensureChat(chatId, messages);
  }

  removeChat(chatId: string): void {
    this.searchService.removeChat(chatId);
    this.clearRemoteSearchStateForChat(chatId);
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  setTieredIndexEnabled(enabled: boolean): void {
    this.searchTieredIndexEnabled = enabled;
  }

  setTieredWasmEnabled(enabled: boolean): void {
    this.searchTieredWasmEnabled = enabled;
  }
}
