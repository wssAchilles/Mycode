/**
 * db.ts - IndexedDB 数据库服务
 * P3: 使用 Dexie.js 实现消息持久化缓存
 */
import Dexie, { type Table } from 'dexie';
import type { Message } from '../types/chat';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

const env = import.meta.env;
function readIntEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) return fallback;
    const n = Math.floor(parsed);
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

const IDB_CHAT_HARD_CAP = readIntEnv('VITE_CHAT_IDB_PER_CHAT_CAP', 50_000, 10_000, 200_000);
const IDB_TOTAL_HARD_CAP = readIntEnv('VITE_CHAT_IDB_TOTAL_CAP', 300_000, 50_000, 2_000_000);
const IDB_PRUNE_MAX_BATCH = 20_000;

/**
 * 聊天元数据 - 记录每个聊天的同步状态
 */
export interface ChatMeta {
    chatId: string;       // 聊天 ID (主键)
    lastSeq: number;      // 本地已同步的最新 seq
    lastFetched: number;  // 最后一次从 API 拉取的时间戳
    messageCount: number; // 本地缓存的消息数量
}

export interface HotChatMeta extends ChatMeta {
    isGroup: boolean;
}

/**
 * 全局同步状态（pts / updateId）
 * - 以 userId 为主键，支持多用户切换
 */
export interface SyncState {
    userId: string;
    pts: number;
    updatedAt: number;
}

/**
 * TelegramDB - 本地数据库定义
 */
class TelegramDB extends Dexie {
    messages!: Table<Message>;
    chatMeta!: Table<ChatMeta>;
    syncState!: Table<SyncState>;

    constructor() {
        super('TelegramClone');

        // 定义数据库版本和表结构
        this.version(1).stores({
            // messages 表: 复合索引支持快速查询
            // id: 主键
            // chatId: 按聊天筛选
            // seq: 排序和增量同步
            // timestamp: 时间排序
            // senderId: 按发送者筛选
            messages: 'id, chatId, seq, timestamp, senderId, [chatId+seq]',
            // chatMeta 表: 聊天同步状态
            chatMeta: 'chatId',
        });

        // v2: 新增 syncState 表（只新增，不破坏旧表）
        this.version(2).stores({
            messages: 'id, chatId, seq, timestamp, senderId, [chatId+seq]',
            chatMeta: 'chatId',
            syncState: 'userId',
        });
    }
}

// 导出数据库单例
export const db = new TelegramDB();

const pendingPruneChats = new Set<string>();
let pruneInFlight = false;
let pruneScheduled = false;

function resolveMessageChatId(message: Message): string | null {
    return message.chatId
        || (message.groupId
            ? buildGroupChatId(message.groupId)
            : (message.receiverId ? buildPrivateChatId(message.senderId, message.receiverId) : null));
}

async function rebuildChatMeta(chatId: string): Promise<void> {
    if (!chatId) return;
    const [messageCount, latestRow] = await Promise.all([
        db.messages.where('chatId').equals(chatId).count(),
        db.messages
            .where('[chatId+seq]')
            .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
            .reverse()
            .limit(1)
            .toArray()
            .then((rows) => rows[0] || null)
            .catch(async () => {
                const fallback = await db.messages.where('chatId').equals(chatId).sortBy('timestamp');
                return fallback.length ? fallback[fallback.length - 1] : null;
            }),
    ]);

    if (messageCount <= 0) {
        await db.chatMeta.delete(chatId);
        return;
    }

    const seq = typeof latestRow?.seq === 'number' && latestRow.seq > 0 ? latestRow.seq : 0;
    await db.chatMeta.put({
        chatId,
        lastSeq: seq,
        lastFetched: Date.now(),
        messageCount,
    });
}

async function pruneChatOverflow(chatId: string): Promise<{ removed: number; affectedChatIds: Set<string> }> {
    const affected = new Set<string>();
    if (!chatId) return { removed: 0, affectedChatIds: affected };
    const count = await db.messages.where('chatId').equals(chatId).count();
    if (count <= IDB_CHAT_HARD_CAP) return { removed: 0, affectedChatIds: affected };

    const overflow = Math.min(IDB_PRUNE_MAX_BATCH, count - IDB_CHAT_HARD_CAP);
    if (overflow <= 0) return { removed: 0, affectedChatIds: affected };

    let victims: Message[] = [];
    try {
        victims = await db.messages
            .where('[chatId+seq]')
            .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
            .limit(overflow)
            .toArray();
    } catch {
        const fallback = await db.messages.where('chatId').equals(chatId).sortBy('timestamp');
        victims = fallback.slice(0, overflow);
    }
    if (!victims.length) {
        const fallback = await db.messages.where('chatId').equals(chatId).sortBy('timestamp');
        victims = fallback.slice(0, overflow);
    }

    const ids = victims.map((item) => item?.id).filter(Boolean) as string[];
    if (!ids.length) return { removed: 0, affectedChatIds: affected };
    await db.messages.bulkDelete(ids);
    affected.add(chatId);
    return { removed: ids.length, affectedChatIds: affected };
}

async function pruneGlobalOverflow(): Promise<{ removed: number; affectedChatIds: Set<string> }> {
    const affected = new Set<string>();
    const total = await db.messages.count();
    if (total <= IDB_TOTAL_HARD_CAP) return { removed: 0, affectedChatIds: affected };

    const overflow = Math.min(IDB_PRUNE_MAX_BATCH, total - IDB_TOTAL_HARD_CAP);
    if (overflow <= 0) return { removed: 0, affectedChatIds: affected };

    const victims = await db.messages.orderBy('timestamp').limit(overflow).toArray();
    const ids = victims.map((item) => item?.id).filter(Boolean) as string[];
    if (!ids.length) return { removed: 0, affectedChatIds: affected };

    for (const row of victims) {
        if (row?.chatId) affected.add(row.chatId);
    }

    await db.messages.bulkDelete(ids);
    return { removed: ids.length, affectedChatIds: affected };
}

function schedulePrune(chatIds: string[]) {
    for (const chatId of chatIds) {
        if (!chatId) continue;
        pendingPruneChats.add(chatId);
    }
    if (pruneScheduled) return;
    pruneScheduled = true;
    queueMicrotask(() => {
        pruneScheduled = false;
        void drainPruneQueue();
    });
}

async function drainPruneQueue(): Promise<void> {
    if (pruneInFlight) return;
    pruneInFlight = true;

    try {
        while (pendingPruneChats.size > 0) {
            const batch = Array.from(pendingPruneChats.values());
            pendingPruneChats.clear();

            const affectedChatIds = new Set<string>();
            for (const chatId of batch) {
                const result = await pruneChatOverflow(chatId);
                for (const affected of result.affectedChatIds) affectedChatIds.add(affected);
            }

            const globalPrune = await pruneGlobalOverflow();
            for (const affected of globalPrune.affectedChatIds) affectedChatIds.add(affected);

            if (affectedChatIds.size > 0) {
                await Promise.all(Array.from(affectedChatIds).map((chatId) => rebuildChatMeta(chatId)));
            }
        }
    } finally {
        pruneInFlight = false;
        if (pendingPruneChats.size > 0) {
            schedulePrune([]);
        }
    }
}

/**
 * 消息缓存操作
 */
export const messageCache = {
    /**
     * 获取指定聊天的缓存消息
     */
    async getMessages(chatId: string, limit = 50): Promise<Message[]> {
        if (!chatId) return [];

        // Use compound index `[chatId+seq]` to avoid loading the entire chat into memory.
        // This is critical when a chat has thousands of messages.
        try {
            const recent = await db.messages
                .where('[chatId+seq]')
                .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
                .reverse()
                .limit(limit)
                .toArray();
            return recent.reverse(); // ascending by seq
        } catch {
            // Fallback: slower path (e.g. index missing/migration mismatch).
            const all = await db.messages.where('chatId').equals(chatId).sortBy('seq');
            return all.slice(-limit);
        }
    },

    async getMessagesBeforeSeq(chatId: string, beforeSeq: number | null | undefined, limit = 50): Promise<Message[]> {
        if (!chatId) return [];
        const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
        const hasBefore = Number.isFinite(beforeSeq as number) && Number(beforeSeq) > 0;
        const upperSeq = hasBefore ? Number(beforeSeq) - 1 : Dexie.maxKey;

        try {
            const rows = await db.messages
                .where('[chatId+seq]')
                .between([chatId, Dexie.minKey], [chatId, upperSeq])
                .reverse()
                .limit(normalizedLimit)
                .toArray();
            return rows.reverse();
        } catch {
            // Fallback path when compound index is unavailable.
            const all = await db.messages.where('chatId').equals(chatId).sortBy('seq');
            const filtered = hasBefore
                ? all.filter((msg) => typeof msg.seq === 'number' && msg.seq > 0 && msg.seq < Number(beforeSeq))
                : all;
            if (filtered.length <= normalizedLimit) return filtered;
            return filtered.slice(filtered.length - normalizedLimit);
        }
    },

    async getMessagesByIds(chatId: string, ids: string[]): Promise<Message[]> {
        if (!chatId || !Array.isArray(ids) || ids.length === 0) return [];
        const uniqueIds = Array.from(new Set(ids.map((id) => String(id)).filter(Boolean)));
        if (!uniqueIds.length) return [];

        const rows = await db.messages
            .where('id')
            .anyOf(uniqueIds)
            .toArray();

        if (!rows.length) return [];

        const byId = new Map<string, Message>();
        for (const row of rows) {
            if (!row?.id || row.chatId !== chatId) continue;
            byId.set(row.id, row);
        }

        const out: Message[] = [];
        for (const id of uniqueIds) {
            const row = byId.get(id);
            if (row) out.push(row);
        }
        return out;
    },

    /**
     * 获取指定聊天的最新 seq
     */
    async getLastSeq(chatId: string): Promise<number> {
        const meta = await db.chatMeta.get(chatId);
        return meta?.lastSeq || 0;
    },

    /**
     * 保存消息到缓存
     */
    async saveMessages(messages: Message[]): Promise<void> {
        if (messages.length === 0) return;

        // 批量写入消息
        await db.messages.bulkPut(messages);

        // 按 chatId 分组更新 chatMeta
        const chatGroups = new Map<string, Message[]>();
        for (const msg of messages) {
            const chatId = resolveMessageChatId(msg);
            if (!chatId) continue;
            if (!chatGroups.has(chatId)) {
                chatGroups.set(chatId, []);
            }
            chatGroups.get(chatId)!.push(msg);
        }

        // 更新每个聊天的元数据
        for (const [chatId, msgs] of chatGroups) {
            const maxSeq = Math.max(...msgs.map((m) => m.seq || 0));
            const [existingMeta, count] = await Promise.all([
                db.chatMeta.get(chatId),
                db.messages.where('chatId').equals(chatId).count(),
            ]);

            await db.chatMeta.put({
                chatId,
                lastSeq: Math.max(existingMeta?.lastSeq || 0, maxSeq),
                lastFetched: Date.now(),
                messageCount: count,
            });
        }

        schedulePrune(Array.from(chatGroups.keys()));
    },

    /**
     * 保存单条消息到缓存
     */
    async saveMessage(message: Message): Promise<void> {
        await db.messages.put(message);

        const chatId = resolveMessageChatId(message);
        if (!chatId) return;
        const [existingMeta, count] = await Promise.all([
            db.chatMeta.get(chatId),
            db.messages.where('chatId').equals(chatId).count(),
        ]);

        await db.chatMeta.put({
            chatId,
            lastSeq: Math.max(existingMeta?.lastSeq || 0, message.seq || 0),
            lastFetched: Date.now(),
            messageCount: count,
        });

        schedulePrune([chatId]);
    },

    /**
     * 本地搜索消息
     */
    async searchMessages(query: string, limit = 50): Promise<Message[]> {
        if (!query.trim()) return [];

        const lowercaseQuery = query.toLowerCase();
        return db.messages
            .filter((msg) => msg.content?.toLowerCase().includes(lowercaseQuery))
            .limit(limit)
            .toArray();
    },

    /**
     * 清空指定聊天的缓存
     */
    async clearChat(chatId: string): Promise<void> {
        await db.messages.where('chatId').equals(chatId).delete();
        await db.chatMeta.delete(chatId);
    },

    /**
     * 清空所有缓存
     */
    async clearAll(): Promise<void> {
        await db.messages.clear();
        await db.chatMeta.clear();
        await db.syncState.clear();
    },

    /**
     * 获取缓存统计
     */
    async getStats(): Promise<{ messageCount: number; chatCount: number }> {
        const messageCount = await db.messages.count();
        const chatCount = await db.chatMeta.count();
        return { messageCount, chatCount };
    },

    /**
     * 获取最近活跃聊天，用于启动期预热。
     * 排序优先级:
     * 1) lastFetched 新 -> 旧
     * 2) lastSeq 大 -> 小
     */
    async getHotChats(limit = 12): Promise<HotChatMeta[]> {
        const normalizedLimit = Number.isFinite(limit)
            ? Math.max(1, Math.min(200, Math.floor(limit)))
            : 12;
        if (normalizedLimit <= 0) return [];

        const rows = await db.chatMeta.orderBy('lastFetched').reverse().limit(normalizedLimit * 4).toArray();
        if (!rows.length) return [];

        rows.sort((a, b) => {
            if (b.lastFetched !== a.lastFetched) return b.lastFetched - a.lastFetched;
            return (b.lastSeq || 0) - (a.lastSeq || 0);
        });

        const deduped = new Map<string, HotChatMeta>();
        for (const row of rows) {
            if (!row?.chatId) continue;
            if (deduped.has(row.chatId)) continue;
            deduped.set(row.chatId, {
                ...row,
                isGroup: row.chatId.startsWith('g:'),
            });
            if (deduped.size >= normalizedLimit) break;
        }

        return Array.from(deduped.values());
    },
};

/**
 * 同步状态缓存（pts / updateId）
 */
export const syncStateCache = {
    async getPts(userId: string): Promise<number> {
        if (!userId) return 0;
        const row = await db.syncState.get(userId);
        return row?.pts || 0;
    },

    async setPts(userId: string, pts: number): Promise<void> {
        if (!userId) return;
        await db.syncState.put({
            userId,
            pts: Number.isFinite(pts) ? pts : 0,
            updatedAt: Date.now(),
        });
    },

    async clear(userId: string): Promise<void> {
        if (!userId) return;
        await db.syncState.delete(userId);
    },
};

export default db;
