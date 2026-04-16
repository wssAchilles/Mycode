import type { Message } from '../../../types/chat';
import type {
  ChatPersistenceDriver,
  ChatPersistenceMigrationInfo,
  ChatPersistenceMigrationRecord,
  ChatPersistenceShadowTelemetry,
  HotChatCandidate,
} from './contracts';
import { idbChatPersistenceDriver } from './idbDriver';
import {
  compareHotChats,
  compareMessages,
  compareSyncPts,
  createShadowTelemetry,
  shouldRunShadowCompare,
} from './shadow/comparison';

type SqliteInitModule = typeof import('@sqlite.org/sqlite-wasm');
type SqliteApi = Awaited<ReturnType<SqliteInitModule['default']>>;
type SqliteDb = InstanceType<SqliteApi['oo1']['DB']>;
type SqliteBindValue =
  | string
  | number
  | null
  | bigint
  | Uint8Array
  | Int8Array
  | ArrayBuffer
  | boolean
  | undefined;
type SqliteBind = readonly SqliteBindValue[];

interface MessageRow {
  id: string;
  payload_json: string;
}

interface ChatMetaRow {
  chat_id: string;
  last_fetched: number;
  last_seq: number;
  is_group: number;
}

interface SyncRow {
  pts: number;
}

interface RuntimeMetaRow {
  value_json: string;
}

export interface SqlitePersistenceBackend {
  loadRecentMessages(chatId: string, limit?: number): Promise<Message[]>;
  loadMessagesBeforeSeq(chatId: string, beforeSeq: number | null | undefined, limit?: number): Promise<Message[]>;
  loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  loadHotChatCandidates(limit?: number): Promise<HotChatCandidate[]>;
  loadSyncPts(userId: string): Promise<number>;
  saveSyncPts(userId: string, pts: number): Promise<void>;
  readMeta?(key: string): Promise<string | null>;
  writeMeta?(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateSqliteOpfsDriverOptions {
  backendFactory?: () => Promise<SqlitePersistenceBackend>;
  fallbackDriver?: ChatPersistenceDriver;
  shadowIdb?: boolean;
  shadowReadCompare?: boolean;
  shadowReadCompareSampleRate?: number;
  dbFile?: string;
  migrationEnabled?: boolean;
  migrationBatchSize?: number;
}

const env = import.meta.env;

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

const CHAT_HARD_CAP = readIntEnv('VITE_CHAT_IDB_PER_CHAT_CAP', 50_000, 10_000, 200_000);
const TOTAL_HARD_CAP = readIntEnv('VITE_CHAT_IDB_TOTAL_CAP', 300_000, 50_000, 2_000_000);
const PRUNE_MAX_BATCH = 20_000;
const DEFAULT_SQLITE_FILE = '/telegram-chat.sqlite3';
const MIGRATION_META_KEY = 'chat.persistence.idb-migration.v1';
const MIGRATION_VERSION = 1;

let sqliteDriverPromise: Promise<ChatPersistenceDriver> | null = null;

function messageOrderValue(message: Message): number {
  if (typeof message.seq === 'number' && Number.isFinite(message.seq)) {
    return message.seq;
  }
  return Date.parse(message.timestamp || '') || 0;
}

function sortMessagesAscending(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => {
    const bySeq = messageOrderValue(left) - messageOrderValue(right);
    if (bySeq !== 0) return bySeq;
    const byTimestamp = (left.timestamp || '').localeCompare(right.timestamp || '');
    if (byTimestamp !== 0) return byTimestamp;
    return left.id.localeCompare(right.id);
  });
}

function mergeMessages(messages: Message[], limit: number): Message[] {
  const deduped = new Map<string, Message>();
  for (const message of sortMessagesAscending(messages)) {
    if (!message?.id) continue;
    deduped.set(message.id, message);
  }
  const ordered = Array.from(deduped.values());
  if (ordered.length <= limit) return ordered;
  return ordered.slice(ordered.length - limit);
}

function parseMessageRows(rows: MessageRow[]): Message[] {
  const out: Message[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.payload_json) as Message);
    } catch {
      // ignore corrupt rows and keep runtime available
    }
  }
  return out;
}

function uniqueMessages(messages: Message[]): Message[] {
  return Array.from(new Map(messages.filter((message) => message?.id).map((message) => [message.id, message])).values());
}

async function maybeBackfillMessages(
  backend: SqlitePersistenceBackend,
  messages: Message[],
  existingMessages: Message[] = [],
): Promise<number> {
  const existingIds = new Set(existingMessages.map((message) => message.id));
  const unique = uniqueMessages(messages).filter((message) => !existingIds.has(message.id));
  if (!unique.length) return 0;
  await backend.saveMessages(unique);
  return unique.length;
}

class SqliteOpfsPersistenceBackend implements SqlitePersistenceBackend {
  private readonly db: SqliteDb;

  constructor(db: SqliteDb) {
    this.db = db;
  }

  private execRows<T extends object>(sql: string, bind: SqliteBind = []): T[] {
    const options = {
      bind,
      rowMode: 'object' as const,
      returnValue: 'resultRows' as const,
      resultRows: [] as Record<string, unknown>[],
    };
    return (this.db.exec as (...args: unknown[]) => unknown)(sql, options) as T[];
  }

  private execScalarNumber(sql: string, bind: SqliteBind = []): number {
    const rows = this.db.exec(sql, {
      bind,
      rowMode: 0,
      returnValue: 'resultRows',
      resultRows: [] as Array<number | null>,
    }) as Array<number | null>;
    const first = rows[0];
    return typeof first === 'number' && Number.isFinite(first) ? first : 0;
  }

  private withTransaction(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  }

  private updateChatMeta(chatId: string) {
    const count = this.execScalarNumber('SELECT COUNT(*) FROM messages WHERE chat_id = ?1', [chatId]);
    if (count <= 0) {
      this.db.exec('DELETE FROM chat_meta WHERE chat_id = ?1', { bind: [chatId] });
      return;
    }
    const lastSeq = this.execScalarNumber('SELECT COALESCE(MAX(seq), 0) FROM messages WHERE chat_id = ?1', [chatId]);
    this.db.exec(
      `
        INSERT INTO chat_meta(chat_id, last_seq, last_fetched, message_count, is_group)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(chat_id) DO UPDATE SET
          last_seq = excluded.last_seq,
          last_fetched = excluded.last_fetched,
          message_count = excluded.message_count,
          is_group = excluded.is_group
      `,
      {
        bind: [chatId, lastSeq, Date.now(), count, chatId.startsWith('g:') ? 1 : 0],
      },
    );
  }

  private collectIds(sql: string, bind: SqliteBind): string[] {
    const rows = this.execRows<{ id: string }>(sql, bind);
    return rows.map((row) => row.id).filter(Boolean);
  }

  private deleteIds(ids: string[]) {
    if (!ids.length) return;
    const placeholders = ids.map((_id, index) => `?${index + 1}`).join(', ');
    this.db.exec(`DELETE FROM messages WHERE id IN (${placeholders})`, { bind: ids });
  }

  private pruneChatOverflow(chatId: string): boolean {
    const count = this.execScalarNumber('SELECT COUNT(*) FROM messages WHERE chat_id = ?1', [chatId]);
    if (count <= CHAT_HARD_CAP) return false;
    const overflow = Math.min(PRUNE_MAX_BATCH, count - CHAT_HARD_CAP);
    const ids = this.collectIds(
      `
        SELECT id
        FROM messages
        WHERE chat_id = ?1
        ORDER BY COALESCE(seq, -1) ASC, timestamp ASC, id ASC
        LIMIT ?2
      `,
      [chatId, overflow],
    );
    this.deleteIds(ids);
    return ids.length > 0;
  }

  private pruneGlobalOverflow(): string[] {
    const total = this.execScalarNumber('SELECT COUNT(*) FROM messages');
    if (total <= TOTAL_HARD_CAP) return [];
    const overflow = Math.min(PRUNE_MAX_BATCH, total - TOTAL_HARD_CAP);
    const rows = this.execRows<{ id: string; chat_id: string }>(
      `
        SELECT id, chat_id
        FROM messages
        ORDER BY timestamp ASC, COALESCE(seq, -1) ASC, id ASC
        LIMIT ?1
      `,
      [overflow],
    );
    const ids = rows.map((row) => row.id).filter(Boolean);
    this.deleteIds(ids);
    return Array.from(new Set(rows.map((row) => row.chat_id).filter(Boolean)));
  }

  async loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
    if (!chatId) return [];
    const rows = this.execRows<MessageRow>(
      `
        SELECT id, payload_json
        FROM messages
        WHERE chat_id = ?1
        ORDER BY COALESCE(seq, -1) DESC, timestamp DESC, id DESC
        LIMIT ?2
      `,
      [chatId, limit],
    );
    return parseMessageRows(rows).reverse();
  }

  async loadMessagesBeforeSeq(chatId: string, beforeSeq: number | null | undefined, limit = 50): Promise<Message[]> {
    if (!chatId) return [];
    const hasBefore = Number.isFinite(beforeSeq as number) && Number(beforeSeq) > 0;
    const rows = hasBefore
      ? this.execRows<MessageRow>(
          `
            SELECT id, payload_json
            FROM messages
            WHERE chat_id = ?1 AND COALESCE(seq, -1) < ?2
            ORDER BY COALESCE(seq, -1) DESC, timestamp DESC, id DESC
            LIMIT ?3
          `,
          [chatId, Number(beforeSeq), limit],
        )
      : this.execRows<MessageRow>(
          `
            SELECT id, payload_json
            FROM messages
            WHERE chat_id = ?1
            ORDER BY COALESCE(seq, -1) DESC, timestamp DESC, id DESC
            LIMIT ?2
          `,
          [chatId, limit],
        );
    return parseMessageRows(rows).reverse();
  }

  async loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
    if (!chatId || !ids.length) return [];
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return [];
    const placeholders = uniqueIds.map((_id, index) => `?${index + 2}`).join(', ');
    const rows = this.execRows<MessageRow>(
      `
        SELECT id, payload_json
        FROM messages
        WHERE chat_id = ?1 AND id IN (${placeholders})
      `,
      [chatId, ...uniqueIds],
    );
    const byId = new Map(parseMessageRows(rows).map((message) => [message.id, message]));
    return uniqueIds.map((id) => byId.get(id)).filter((message): message is Message => !!message);
  }

  async saveMessages(messages: Message[]): Promise<void> {
    const unique = uniqueMessages(messages);
    if (!unique.length) return;
    const affectedChatIds = Array.from(new Set(unique.map((message) => message.chatId).filter(Boolean)));

    this.withTransaction(() => {
      const statement = this.db.prepare(
        `
          INSERT OR REPLACE INTO messages(
            id,
            chat_id,
            seq,
            timestamp,
            sender_id,
            content,
            payload_json
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        `,
      );
      try {
        for (const message of unique) {
          statement.bind([
            message.id,
            message.chatId,
            typeof message.seq === 'number' ? message.seq : null,
            message.timestamp,
            message.senderId,
            message.content,
            JSON.stringify(message),
          ]).stepReset();
        }
      } finally {
        statement.finalize();
      }

      for (const chatId of affectedChatIds) {
        this.updateChatMeta(chatId);
      }
      const globallyAffectedChatIds = this.pruneGlobalOverflow();
      for (const chatId of affectedChatIds) {
        if (this.pruneChatOverflow(chatId)) {
          this.updateChatMeta(chatId);
        }
      }
      for (const chatId of globallyAffectedChatIds) {
        this.updateChatMeta(chatId);
      }
    });
  }

  async saveMessage(message: Message): Promise<void> {
    await this.saveMessages([message]);
  }

  async loadHotChatCandidates(limit = 12): Promise<HotChatCandidate[]> {
    const rows = this.execRows<ChatMetaRow>(
      `
        SELECT chat_id, last_fetched, last_seq, is_group
        FROM chat_meta
        ORDER BY last_fetched DESC, last_seq DESC, chat_id ASC
        LIMIT ?1
      `,
      [limit],
    );
    return rows.map((row) => ({
      chatId: row.chat_id,
      isGroup: !!row.is_group,
      lastFetched: Number(row.last_fetched) || 0,
      lastSeq: Number(row.last_seq) || 0,
    }));
  }

  async loadSyncPts(userId: string): Promise<number> {
    if (!userId) return 0;
    const rows = this.execRows<SyncRow>(
      'SELECT pts FROM sync_state WHERE user_id = ?1 LIMIT 1',
      [userId],
    );
    return Number(rows[0]?.pts) || 0;
  }

  async saveSyncPts(userId: string, pts: number): Promise<void> {
    if (!userId) return;
    this.db.exec(
      `
        INSERT INTO sync_state(user_id, pts, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(user_id) DO UPDATE SET
          pts = excluded.pts,
          updated_at = excluded.updated_at
      `,
      {
        bind: [userId, Number.isFinite(pts) ? pts : 0, Date.now()],
      },
    );
  }

  async readMeta(key: string): Promise<string | null> {
    if (!key) return null;
    const rows = this.execRows<RuntimeMetaRow>(
      'SELECT value_json FROM runtime_meta WHERE key = ?1 LIMIT 1',
      [key],
    );
    return rows[0]?.value_json ?? null;
  }

  async writeMeta(key: string, value: string): Promise<void> {
    if (!key) return;
    this.db.exec(
      `
        INSERT INTO runtime_meta(key, value_json)
        VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json
      `,
      {
        bind: [key, value],
      },
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

async function initSqliteApi(): Promise<SqliteApi> {
  const scope = globalThis as typeof globalThis & {
    crossOriginIsolated?: boolean;
    document?: unknown;
  };
  if (scope.document) {
    throw new Error('sqlite-opfs requires a dedicated worker runtime');
  }
  if (!scope.crossOriginIsolated) {
    throw new Error('sqlite-opfs requires crossOriginIsolated');
  }
  const module = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await module.default();
  if (!sqlite3.oo1?.OpfsDb) {
    throw new Error('sqlite-opfs VFS is unavailable');
  }
  return sqlite3;
}

async function createSqlitePersistenceBackend(dbFile = DEFAULT_SQLITE_FILE): Promise<SqlitePersistenceBackend> {
  const sqlite3 = await initSqliteApi();
  const normalizedFile = dbFile.startsWith('/') ? dbFile : `/${dbFile}`;
  const db = new sqlite3.oo1.OpfsDb(normalizedFile, 'c');
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      seq INTEGER,
      timestamp TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_seq
      ON messages(chat_id, seq);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp
      ON messages(chat_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp
      ON messages(timestamp);
    CREATE TABLE IF NOT EXISTS chat_meta (
      chat_id TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0,
      last_fetched INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      is_group INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chat_meta_last_fetched
      ON chat_meta(last_fetched DESC, last_seq DESC);
    CREATE TABLE IF NOT EXISTS sync_state (
      user_id TEXT PRIMARY KEY,
      pts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS runtime_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);
  return new SqliteOpfsPersistenceBackend(db);
}

function mergeHotChats(primary: HotChatCandidate[], secondary: HotChatCandidate[], limit: number): HotChatCandidate[] {
  const merged = new Map<string, HotChatCandidate>();
  for (const row of [...primary, ...secondary]) {
    if (!row?.chatId || merged.has(row.chatId)) continue;
    merged.set(row.chatId, row);
  }
  return Array.from(merged.values())
    .sort((left, right) => {
      if (right.lastFetched !== left.lastFetched) return right.lastFetched - left.lastFetched;
      if (right.lastSeq !== left.lastSeq) return right.lastSeq - left.lastSeq;
      return left.chatId.localeCompare(right.chatId);
    })
    .slice(0, limit);
}

function createMigrationState(source: string): ChatPersistenceMigrationInfo {
  return {
    version: MIGRATION_VERSION,
    source,
    phase: 'idle',
    startedAt: 0,
    updatedAt: 0,
    completedAt: null,
    importedMessages: 0,
    totalMessages: 0,
    importedSyncStates: 0,
    totalSyncStates: 0,
    lastError: null,
  };
}

function parseMigrationRecord(raw: string | null, fallbackSource: string): ChatPersistenceMigrationRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatPersistenceMigrationRecord>;
    if (parsed.version !== MIGRATION_VERSION) return null;
    return {
      version: MIGRATION_VERSION,
      source: parsed.source || fallbackSource,
      phase: parsed.phase || 'idle',
      startedAt: Number(parsed.startedAt) || 0,
      updatedAt: Number(parsed.updatedAt) || 0,
      completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : null,
      importedMessages: Number(parsed.importedMessages) || 0,
      totalMessages: Number(parsed.totalMessages) || 0,
      importedSyncStates: Number(parsed.importedSyncStates) || 0,
      totalSyncStates: Number(parsed.totalSyncStates) || 0,
      lastError: parsed.lastError ? String(parsed.lastError) : null,
    };
  } catch {
    return null;
  }
}

export async function createSqliteOpfsDriver(
  options: CreateSqliteOpfsDriverOptions = {},
): Promise<ChatPersistenceDriver> {
  const fallbackDriver = options.fallbackDriver ?? idbChatPersistenceDriver;
  const backend = await (options.backendFactory ?? (() => createSqlitePersistenceBackend(options.dbFile ?? DEFAULT_SQLITE_FILE)))();
  const shadowIdb = options.shadowIdb ?? false;
  const shadowReadCompare = options.shadowReadCompare ?? false;
  const shadowReadCompareSampleRate = Math.max(
    0,
    Math.min(100, Math.floor(options.shadowReadCompareSampleRate ?? 0)),
  );
  const migrationState = createMigrationState(fallbackDriver.name);
  const shadowState: ChatPersistenceShadowTelemetry = createShadowTelemetry(
    shadowReadCompareSampleRate,
    shadowReadCompare,
  );
  const migrationSource = fallbackDriver.migrationSource;
  const migrationEnabled = options.migrationEnabled ?? true;
  const migrationBatchSize = Math.max(1, Math.min(5000, Math.floor(options.migrationBatchSize ?? 500)));

  const recordShadowMismatch = (reason: string) => {
    shadowState.mismatches += 1;
    shadowState.lastMismatchAt = Date.now();
    shadowState.lastMismatchReason = reason;
  };

  const maybeCompareShadowRead = (
    operation: string,
    scope: string,
    compare: () => string | null,
  ) => {
    if (!shadowState.enabled) return;
    if (!shouldRunShadowCompare(scope, operation, shadowState.sampleRate)) return;
    shadowState.readsCompared += 1;
    shadowState.lastComparedAt = Date.now();
    const mismatchReason = compare();
    if (mismatchReason) {
      recordShadowMismatch(`${operation}:${mismatchReason}`);
    }
  };

  const persistMigrationState = async () => {
    if (!backend.writeMeta) return;
    await backend.writeMeta(MIGRATION_META_KEY, JSON.stringify(migrationState));
  };

  const beginMigration = async () => {
    if (!migrationEnabled || !migrationSource) {
      migrationState.phase = 'idle';
      migrationState.updatedAt = Date.now();
      return;
    }

    migrationState.phase = 'running';
    migrationState.startedAt = migrationState.startedAt || Date.now();
    migrationState.updatedAt = Date.now();
    migrationState.lastError = null;

    try {
      const stats = await migrationSource.getMigrationStats();
      migrationState.totalMessages = stats.messageCount;
      migrationState.totalSyncStates = stats.syncStateCount;
      migrationState.updatedAt = Date.now();

      for (let offset = 0; offset < stats.messageCount; offset += migrationBatchSize) {
        const batch = await migrationSource.getMigrationMessages(offset, migrationBatchSize);
        if (!batch.length) break;
        await backend.saveMessages(batch);
        migrationState.importedMessages += batch.length;
        migrationState.updatedAt = Date.now();
      }

      for (let offset = 0; offset < stats.syncStateCount; offset += migrationBatchSize) {
        const batch = await migrationSource.getMigrationSyncStates(offset, migrationBatchSize);
        if (!batch.length) break;
        for (const row of batch) {
          if (!row?.userId) continue;
          await backend.saveSyncPts(row.userId, row.pts);
          migrationState.importedSyncStates += 1;
        }
        migrationState.updatedAt = Date.now();
      }

      migrationState.phase = 'completed';
      migrationState.completedAt = Date.now();
      migrationState.updatedAt = migrationState.completedAt;
      await persistMigrationState();
    } catch (error) {
      migrationState.phase = 'degraded';
      migrationState.updatedAt = Date.now();
      migrationState.lastError = String((error as Error)?.message || error || 'sqlite migration failed');
    }
  };

  if (migrationEnabled && migrationSource) {
    const persisted = parseMigrationRecord(await backend.readMeta?.(MIGRATION_META_KEY) ?? null, fallbackDriver.name);
    if (persisted?.phase === 'completed') {
      Object.assign(migrationState, persisted);
    } else {
      migrationState.phase = 'pending';
      migrationState.updatedAt = Date.now();
      queueMicrotask(() => {
        void beginMigration();
      });
    }
  }

  return {
    name: 'sqlite-opfs',
    capabilities: {
      localSearch: true,
      hotChats: true,
      syncPts: true,
      opfsBacked: true,
    },
    inspectRuntime: () => ({
      migration: { ...migrationState },
      shadow: { ...shadowState },
    }),
    async loadRecentMessages(chatId: string, limit = 50): Promise<Message[]> {
      const primary = await backend.loadRecentMessages(chatId, limit);
      let fallback: Message[] | null = null;
      if (primary.length < limit || shadowState.enabled) {
        fallback = await fallbackDriver.loadRecentMessages(chatId, limit);
      }
      if (!fallback?.length) return primary;
      const backfilled = await maybeBackfillMessages(backend, fallback, primary);
      shadowState.backfillWrites += backfilled;
      const merged = mergeMessages([...primary, ...fallback], limit);
      maybeCompareShadowRead('loadRecentMessages', `${chatId}:${limit}`, () => compareMessages(merged, fallback));
      return merged;
    },
    async loadMessagesBeforeSeq(chatId: string, beforeSeq: number | null | undefined, limit = 50): Promise<Message[]> {
      const primary = await backend.loadMessagesBeforeSeq(chatId, beforeSeq, limit);
      let fallback: Message[] | null = null;
      if (primary.length < limit || shadowState.enabled) {
        fallback = await fallbackDriver.loadMessagesBeforeSeq(chatId, beforeSeq, limit);
      }
      if (!fallback?.length) return primary;
      const backfilled = await maybeBackfillMessages(backend, fallback, primary);
      shadowState.backfillWrites += backfilled;
      const merged = mergeMessages([...primary, ...fallback], limit);
      maybeCompareShadowRead(
        'loadMessagesBeforeSeq',
        `${chatId}:${beforeSeq ?? 'latest'}:${limit}`,
        () => compareMessages(merged, fallback),
      );
      return merged;
    },
    async loadMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
      const primary = await backend.loadMessagesByIds(chatId, ids);
      let fallback: Message[] = [];
      if (primary.length < ids.length || shadowState.enabled) {
        const primaryIds = new Set(primary.map((message) => message.id));
        const targetIds = shadowState.enabled ? ids : ids.filter((id) => !primaryIds.has(id));
        if (targetIds.length) {
          fallback = await fallbackDriver.loadMessagesByIds(chatId, targetIds);
        }
        if (fallback.length) {
          const backfilled = await maybeBackfillMessages(backend, fallback, primary);
          shadowState.backfillWrites += backfilled;
        }
      }
      const merged = mergeMessages([...primary, ...fallback], ids.length);
      if (fallback.length) {
        const expected = shadowState.enabled
          ? ids.map((id) => fallback.find((message) => message.id === id)).filter((message): message is Message => !!message)
          : fallback;
        maybeCompareShadowRead('loadMessagesByIds', `${chatId}:${ids.join(',')}`, () => compareMessages(merged, expected));
      }
      return merged;
    },
    async saveMessages(messages: Message[]): Promise<void> {
      await backend.saveMessages(messages);
      if (shadowIdb) {
        await fallbackDriver.saveMessages(messages);
        shadowState.shadowMessageWrites += uniqueMessages(messages).length;
      }
    },
    async saveMessage(message: Message): Promise<void> {
      await backend.saveMessage(message);
      if (shadowIdb) {
        await fallbackDriver.saveMessage(message);
        shadowState.shadowMessageWrites += 1;
      }
    },
    async loadHotChatCandidates(limit = 12): Promise<HotChatCandidate[]> {
      const primary = await backend.loadHotChatCandidates(limit);
      let fallback: HotChatCandidate[] = [];
      if (primary.length < limit || shadowState.enabled) {
        fallback = await fallbackDriver.loadHotChatCandidates(limit);
      }
      if (!fallback.length) return primary;
      const merged = mergeHotChats(primary, fallback, limit);
      maybeCompareShadowRead('loadHotChatCandidates', String(limit), () => compareHotChats(merged, fallback));
      return merged;
    },
    async loadSyncPts(userId: string): Promise<number> {
      const primary = await backend.loadSyncPts(userId);
      let fallback = 0;
      if (primary <= 0 || shadowState.enabled) {
        fallback = await fallbackDriver.loadSyncPts(userId);
      }
      if (primary > 0 && !shadowState.enabled) return primary;
      if (fallback > 0 && primary <= 0) {
        await backend.saveSyncPts(userId, fallback);
        shadowState.backfillWrites += 1;
      }
      const resolved = primary > 0 ? primary : fallback;
      maybeCompareShadowRead('loadSyncPts', userId, () => compareSyncPts(resolved, fallback || resolved));
      return resolved;
    },
    async saveSyncPts(userId: string, pts: number): Promise<void> {
      await backend.saveSyncPts(userId, pts);
      if (shadowIdb) {
        await fallbackDriver.saveSyncPts(userId, pts);
        shadowState.shadowSyncWrites += 1;
      }
    },
  };
}

export async function getOrCreateSqliteOpfsDriver(): Promise<ChatPersistenceDriver> {
  if (!sqliteDriverPromise) {
    sqliteDriverPromise = createSqliteOpfsDriver();
  }
  return sqliteDriverPromise;
}
