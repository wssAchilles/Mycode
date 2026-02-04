/**
 * db.ts - IndexedDB 数据库服务
 * P3: 使用 Dexie.js 实现消息持久化缓存
 */
import Dexie, { type Table } from 'dexie';
import type { Message } from '../types/chat';

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
 * TelegramDB - 本地数据库定义
 */
class TelegramDB extends Dexie {
    messages!: Table<Message>;
    chatMeta!: Table<ChatMeta>;

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
        return db.messages
            .where('chatId')
            .equals(chatId)
            .reverse()
            .sortBy('seq')
            .then((msgs) => msgs.slice(0, limit).reverse());
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
            const chatId = msg.chatId || (msg.groupId ? `g:${msg.groupId}` : `p:${msg.senderId}:${msg.receiverId}`);
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

        const chatId = message.chatId || (message.groupId ? `g:${message.groupId}` : `p:${message.senderId}:${message.receiverId}`);
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

export default db;
