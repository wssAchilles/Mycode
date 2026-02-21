/**
 * MessageService - 消息业务逻辑层
 * 封装消息相关的所有业务逻辑，与 Controller 解耦
 */
import Message, { MessageType, MessageStatus, IMessage } from '../models/Message';
import { waitForMongoReady } from '../config/db';
import { cacheService } from './cacheService';
import { createAndFanoutMessage } from './messageWriteService';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

// 消息创建参数
interface CreateMessageParams {
    sender: string;
    receiver: string;
    content: string;
    type?: MessageType;
    chatType?: 'private' | 'group';
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    replyTo?: string;
}

// Cursor 参数
interface CursorParams {
    beforeSeq?: number;
    afterSeq?: number;
    limit?: number;
}

// Cursor 返回结果
interface CursorMessages {
    messages: IMessage[];
    paging: {
        hasMore: boolean;
        nextBeforeSeq: number | null;
        nextAfterSeq: number | null;
        latestSeq: number | null;
        mode: 'before' | 'after';
        limit: number;
    };
}

class MessageService {
    private normalizeLimit(limit?: number, fallback = 50): number {
        if (!Number.isFinite(limit)) return fallback;
        return Math.max(1, Math.min(100, Math.floor(limit as number)));
    }

    private buildSeqCursorFilter(beforeSeq?: number, afterSeq?: number) {
        const filter: Record<string, number | string> = { $type: 'number' };
        if (typeof beforeSeq === 'number') filter.$lt = beforeSeq;
        if (typeof afterSeq === 'number') filter.$gt = afterSeq;
        return filter;
    }

    private toCursorResult(raw: any[], mode: 'before' | 'after', limit: number): CursorMessages {
        const hasMore = raw.length > limit;
        const page = hasMore ? raw.slice(0, limit) : raw;
        const ordered = mode === 'before' ? page.slice().reverse() : page;

        const firstSeq = ordered.length && typeof ordered[0]?.seq === 'number' ? ordered[0].seq : null;
        const lastSeq = ordered.length && typeof ordered[ordered.length - 1]?.seq === 'number' ? ordered[ordered.length - 1].seq : null;

        return {
            messages: ordered as IMessage[],
            paging: {
                hasMore,
                nextBeforeSeq: mode === 'before' ? firstSeq : null,
                nextAfterSeq: mode === 'after' ? lastSeq : null,
                latestSeq: lastSeq,
                mode,
                limit,
            },
        };
    }

    /**
     * 创建新消息
     */
    async createMessage(params: CreateMessageParams): Promise<IMessage> {
        await waitForMongoReady();

        const { message: savedMessage } = await createAndFanoutMessage({
            senderId: params.sender,
            receiverId: params.chatType === 'private' ? params.receiver : undefined,
            groupId: params.chatType === 'group' ? params.receiver : undefined,
            chatType: params.chatType,
            content: params.content,
            type: params.type || MessageType.TEXT,
            fileUrl: params.fileUrl,
            fileName: params.fileName,
            fileSize: params.fileSize,
            mimeType: params.mimeType,
            thumbnailUrl: params.thumbnailUrl,
            replyTo: params.replyTo,
        });

        // 清除相关缓存
        await this.invalidateConversationCache(params.sender, params.receiver);

        return savedMessage;
    }

    /**
     * 获取两个用户之间的会话消息
     */
    async getConversation(
        userId1: string,
        userId2: string,
        options: CursorParams = {}
    ): Promise<CursorMessages> {
        await waitForMongoReady();

        const limit = this.normalizeLimit(options.limit, 50);
        const mode: 'before' | 'after' = typeof options.afterSeq === 'number' ? 'after' : 'before';
        const sort = mode === 'after'
            ? ({ seq: 1 as const, _id: 1 as const })
            : ({ seq: -1 as const, _id: -1 as const });

        // 尝试从缓存获取
        const cacheKey = `conv:${[userId1, userId2].sort().join(':')}:${mode}:${options.beforeSeq || 0}:${options.afterSeq || 0}:${limit}`;
        const cached = await cacheService.get<CursorMessages>(cacheKey);
        if (cached) {
            return cached;
        }

        // 查询消息
        const chatId = buildPrivateChatId(userId1, userId2);
        const query: any = {
            $or: [
                { chatId },
                { sender: userId1, receiver: userId2 },
                { sender: userId2, receiver: userId1 },
            ],
            deletedAt: null,
            isGroupChat: false,
            seq: this.buildSeqCursorFilter(options.beforeSeq, options.afterSeq),
        };

        const raw = await Message.find(query)
            .sort(sort)
            .limit(limit + 1)
            .lean();

        const result = this.toCursorResult(raw, mode, limit);

        // 缓存结果 (10分钟)
        await cacheService.set(cacheKey, result, 600);

        return result;
    }

    /**
     * 获取群聊消息
     */
    async getGroupMessages(
        groupId: string,
        options: CursorParams = {}
    ): Promise<CursorMessages> {
        await waitForMongoReady();

        const limit = this.normalizeLimit(options.limit, 50);
        const mode: 'before' | 'after' = typeof options.afterSeq === 'number' ? 'after' : 'before';
        const sort = mode === 'after'
            ? ({ seq: 1 as const, _id: 1 as const })
            : ({ seq: -1 as const, _id: -1 as const });

        const chatId = buildGroupChatId(groupId);
        const query: any = {
            chatId,
            deletedAt: null,
            isGroupChat: true,
            seq: this.buildSeqCursorFilter(options.beforeSeq, options.afterSeq),
        };

        const raw = await Message.find(query)
            .sort(sort)
            .limit(limit + 1)
            .lean();

        return this.toCursorResult(raw, mode, limit);
    }

    /**
     * 标记消息为已读
     */
    async markAsRead(messageIds: string[], userId: string): Promise<number> {
        await waitForMongoReady();

        const result = await Message.updateMany(
            {
                _id: { $in: messageIds },
                receiver: userId,
                status: { $ne: MessageStatus.READ },
            },
            {
                $set: { status: MessageStatus.READ },
            }
        );

        return result.modifiedCount;
    }

    /**
     * 软删除消息
     */
    async deleteMessage(
        messageId: string,
        userId: string
    ): Promise<IMessage | null> {
        await waitForMongoReady();

        const message = await Message.findOne({
            _id: messageId,
            sender: userId,
            deletedAt: null,
        });

        if (!message) {
            return null;
        }

        message.deletedAt = new Date();
        await message.save();

        // 清除缓存
        await this.invalidateConversationCache(message.sender, message.receiver);

        return message;
    }

    /**
     * 编辑消息
     */
    async editMessage(
        messageId: string,
        userId: string,
        newContent: string
    ): Promise<IMessage | null> {
        await waitForMongoReady();

        const message = await Message.findOne({
            _id: messageId,
            sender: userId,
            deletedAt: null,
        });

        if (!message) {
            return null;
        }

        // 检查消息是否可编辑 (15分钟内)
        const editWindow = 15 * 60 * 1000;
        const messageAge = Date.now() - message.timestamp.getTime();
        if (messageAge > editWindow) {
            throw new Error('消息已超过编辑时限');
        }

        message.content = newContent;
        message.editedAt = new Date();
        await message.save();

        // 清除缓存
        await this.invalidateConversationCache(message.sender, message.receiver);

        return message;
    }

    /**
     * 获取用户未读消息计数
     */
    async getUnreadCount(userId: string): Promise<number> {
        await waitForMongoReady();

        // 尝试从缓存获取
        const cacheKey = `unread:${userId}`;
        const cached = await cacheService.get<number>(cacheKey);
        if (cached !== null) {
            return cached;
        }

        const count = await Message.countDocuments({
            receiver: userId,
            status: { $ne: MessageStatus.READ },
            deletedAt: null,
            isGroupChat: false,
        });

        // 缓存1小时
        await cacheService.set(cacheKey, count, 3600);

        return count;
    }

    /**
     * 清除会话缓存
     */
    private async invalidateConversationCache(
        userId1: string,
        userId2: string
    ): Promise<void> {
        const pattern = `conv:${[userId1, userId2].sort().join(':')}:*`;
        await cacheService.deletePattern(pattern);
        await cacheService.delete(`unread:${userId1}`);
        await cacheService.delete(`unread:${userId2}`);
    }
}

// 导出单例
export const messageService = new MessageService();
export default messageService;
