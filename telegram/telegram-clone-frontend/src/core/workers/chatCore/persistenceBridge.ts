/**
 * Persistence bridge — unified read/write interface over SQLite-OPFS and IndexedDB.
 *
 * Single responsibility: message persistence, sync pts, hot chat candidates.
 * No socket, no sync protocol, no search logic.
 */

import type { Message } from '../../../types/chat';
import {
  chatPersistence,
  configureChatPersistence,
  loadHotChatCandidates,
  loadMessagesBeforeSeq,
  loadMessagesByIds,
  loadRecentMessages,
  loadSyncPts,
  saveMessages,
  saveSyncPts,
} from '../../chat/persist/idb';
import { selectChatPersistenceDriver } from '../../chat/persist/driverSelection';
import { createSqliteOpfsDriver } from '../../chat/persist/sqliteOpfsDriver';
import type { RawSyncMessage } from './messageAssembler';
import { normalizeSyncMessages } from './messageAssembler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchPaging = {
  hasMore: boolean;
  nextBeforeSeq: number | null;
  nextAfterSeq?: number | null;
};

export type FetchCursor = {
  beforeSeq?: number;
  afterSeq?: number;
  limit?: number;
};

export interface PersistenceBridgeContext {
  getApiBaseUrl: () => string;
  getCurrentUserId: () => string | null;
  getStorageBackendPreference: () => string;
  getStorageShadowIdbEnabled: () => boolean;
  getStorageShadowReadCompareEnabled: () => boolean;
  getStorageShadowReadCompareSampleRate: () => number;
  getStorageMigrationEnabled: () => boolean;
  getStorageMigrationBatchSize: () => number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 50;
const CHAT_CURSOR_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortErrorMessage(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const message = getErrorMessage(err).toLowerCase();
  return name === 'AbortError' || message.includes('abort');
}

function isAuthErrorStatus(status: number): boolean {
  return status === 401 || status === 403;
}

// ---------------------------------------------------------------------------
// Cursor contract validation
// ---------------------------------------------------------------------------

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

function assertCursorContract(
  res: Response,
  json: Record<string, unknown> | null,
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

// ---------------------------------------------------------------------------
// Persistence bridge class
// ---------------------------------------------------------------------------

export class PersistenceBridge {
  private initialized = false;

  constructor(private readonly ctx: PersistenceBridgeContext) {}

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;

    const backend = this.ctx.getStorageBackendPreference() as 'sqlite-opfs' | 'idb';
    const shadowIdb = this.ctx.getStorageShadowIdbEnabled();

    if (backend === 'sqlite-opfs') {
      try {
        const driver = await createSqliteOpfsDriver();
        configureChatPersistence({
          driver,
          shadowIdb,
          readCompareEnabled: this.ctx.getStorageShadowReadCompareEnabled(),
          readCompareSampleRate: this.ctx.getStorageShadowReadCompareSampleRate(),
          migrationEnabled: this.ctx.getStorageMigrationEnabled(),
          migrationBatchSize: this.ctx.getStorageMigrationBatchSize(),
        });
      } catch {
        // Fallback to IDB
        configureChatPersistence({ driver: null, shadowIdb: false });
      }
    } else {
      configureChatPersistence({ driver: null, shadowIdb: false });
    }

    this.initialized = true;
  }

  // -------------------------------------------------------------------------
  // Message persistence
  // -------------------------------------------------------------------------

  async loadRecent(chatId: string, limit: number): Promise<Message[]> {
    return loadRecentMessages(chatId, limit);
  }

  async loadBefore(chatId: string, beforeSeq: number, limit: number): Promise<Message[]> {
    return loadMessagesBeforeSeq(chatId, beforeSeq, limit);
  }

  async loadByIds(ids: string[]): Promise<Message[]> {
    return loadMessagesByIds(ids);
  }

  async save(messages: Message[]): Promise<void> {
    if (!messages.length) return;
    await saveMessages(messages);
  }

  // -------------------------------------------------------------------------
  // Sync pts persistence
  // -------------------------------------------------------------------------

  async loadSyncPts(userId: string): Promise<number> {
    return loadSyncPts(userId);
  }

  async saveSyncPts(userId: string, pts: number): Promise<void> {
    await saveSyncPts(userId, pts);
  }

  // -------------------------------------------------------------------------
  // Hot chat candidates
  // -------------------------------------------------------------------------

  async loadHotChatCandidates(): Promise<string[]> {
    return loadHotChatCandidates();
  }

  // -------------------------------------------------------------------------
  // API fetch helpers
  // -------------------------------------------------------------------------

  async fetchChatMessagesUnified(
    chatId: string,
    cursor: FetchCursor = {},
    signal?: AbortSignal,
  ): Promise<{ messages: Message[]; paging: FetchPaging } | null> {
    const apiBaseUrl = this.ctx.getApiBaseUrl();
    if (!apiBaseUrl) return null;

    const resolvedLimit =
      typeof cursor.limit === 'number' && Number.isFinite(cursor.limit)
        ? Math.max(1, Math.min(100, Math.floor(cursor.limit)))
        : PAGE_LIMIT;
    const params = new URLSearchParams({ limit: String(resolvedLimit) });
    if (typeof cursor.beforeSeq === 'number') params.set('beforeSeq', String(cursor.beforeSeq));
    if (typeof cursor.afterSeq === 'number') params.set('afterSeq', String(cursor.afterSeq));

    const url = `${apiBaseUrl}/api/messages/chat/${encodeURIComponent(chatId)}?${params.toString()}`;
    let res: Response;
    let json: Record<string, unknown> | null;
    try {
      const headers: Record<string, string> = {};

      res = await fetch(url, {
        signal,
        headers,
      });
      json = await res.json().catch(() => null);
    } catch (err: unknown) {
      if (isAbortErrorMessage(err)) return null;
      throw err;
    }

    if (res.status === 404) {
      throw new Error('CHAT_CURSOR_API_NOT_AVAILABLE');
    }
    if (isAuthErrorStatus(res.status)) {
      throw new Error('AUTH_ERROR');
    }
    if (!res.ok) {
      const errMsg = (json && ((json.error as string) || (json.message as string))) || `HTTP_${res.status}`;
      throw new Error(errMsg);
    }

    const pagingJson = json?.paging as Record<string, unknown> | undefined;
    const paging: FetchPaging = {
      hasMore: !!pagingJson?.hasMore,
      nextBeforeSeq: typeof pagingJson?.nextBeforeSeq === 'number' ? pagingJson.nextBeforeSeq : null,
      nextAfterSeq: typeof pagingJson?.nextAfterSeq === 'number' ? pagingJson.nextAfterSeq : null,
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

  // -------------------------------------------------------------------------
  // Chat ID helpers
  // -------------------------------------------------------------------------

  parsePrivateChatOtherUserId(chatId: string, me: string): string | null {
    if (!chatId.startsWith('p:')) return null;
    const parts = chatId.substring(2).split(':').filter(Boolean);
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    if (a === me) return b;
    if (b === me) return a;
    return null;
  }

  chatListIdFromChatId(chatId: string, isGroup: boolean): string | null {
    if (isGroup) {
      if (chatId.startsWith('g:')) return chatId.substring(2);
      return chatId;
    }
    const userId = this.ctx.getCurrentUserId();
    if (!userId) return null;
    return this.parsePrivateChatOtherUserId(chatId, userId);
  }
}
