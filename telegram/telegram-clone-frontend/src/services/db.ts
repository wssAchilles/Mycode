/**
 * db.ts - IndexedDB 数据库服务
 * P3: 使用 Dexie.js 实现消息持久化缓存
 */
import Dexie, { type Table } from 'dexie';
import type { Message } from '../types/chat';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

/**
 * 聊天元数据 - 记录每个聊天的同步状态
 */
export interface ChatMeta {
    chatId: string;       // 聊天 ID (主键)
    lastSeq: number;      // 本地已同步的最新 seq
    lastFetched: number;  // 最后一次从 API 拉取的时间戳
    messageCount: number; // 本地缓存的消息数量
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
            const chatId =
                msg.chatId
                || (msg.groupId
                    ? buildGroupChatId(msg.groupId)
                    : (msg.receiverId ? buildPrivateChatId(msg.senderId, msg.receiverId) : null));
            if (!chatId) continue;
            if (!chatGroups.has(chatId)) {
                chatGroups.set(chatId, []);
            }
            chatGroups.get(chatId)!.push(msg);
        }

        // 更新每个聊天的元数据
        for (const [chatId, msgs] of chatGroups) {
            const maxSeq = Math.max(...msgs.map((m) => m.seq || 0));
            const existingMeta = await db.chatMeta.get(chatId);

            await db.chatMeta.put({
                chatId,
                lastSeq: Math.max(existingMeta?.lastSeq || 0, maxSeq),
                lastFetched: Date.now(),
                messageCount: (existingMeta?.messageCount || 0) + msgs.length,
            });
        }
    },

    /**
     * 保存单条消息到缓存
     */
    async saveMessage(message: Message): Promise<void> {
        await db.messages.put(message);

        const chatId =
            message.chatId
            || (message.groupId
                ? buildGroupChatId(message.groupId)
                : (message.receiverId ? buildPrivateChatId(message.senderId, message.receiverId) : null));
        if (!chatId) return;
        const existingMeta = await db.chatMeta.get(chatId);

        await db.chatMeta.put({
            chatId,
            lastSeq: Math.max(existingMeta?.lastSeq || 0, message.seq || 0),
            lastFetched: Date.now(),
            messageCount: (existingMeta?.messageCount || 0) + 1,
        });
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
