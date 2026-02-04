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

// 分页参数
interface PaginationParams {
    page?: number;
    limit?: number;
}

// 分页返回结果
interface PaginatedMessages {
    messages: IMessage[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalMessages: number;
        hasMore: boolean;
        limit: number;
    };
}

class MessageService {
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
        options: PaginationParams = {}
    ): Promise<PaginatedMessages> {
        await waitForMongoReady();

        const page = options.page || 1;
        const limit = options.limit || 50;

        // 尝试从缓存获取
        const cacheKey = `conv:${[userId1, userId2].sort().join(':')}:${page}:${limit}`;
        const cached = await cacheService.get<PaginatedMessages>(cacheKey);
        if (cached) {
            return cached;
        }

        // 查询消息
        const chatId = buildPrivateChatId(userId1, userId2);
        const query = {
            $or: [
                { chatId },
                { sender: userId1, receiver: userId2 },
                { sender: userId2, receiver: userId1 },
            ],
            deletedAt: null,
            isGroupChat: false,
        };

        const totalMessages = await Message.countDocuments(query);
        const totalPages = Math.ceil(totalMessages / limit);
        const skip = (page - 1) * limit;

        const messages = await Message.find(query)
            .sort({ seq: -1, timestamp: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        const result: PaginatedMessages = {
            messages: messages.reverse() as IMessage[],
            pagination: {
                currentPage: page,
                totalPages,
                totalMessages,
                hasMore: page < totalPages,
                limit,
            },
        };

        // 缓存结果 (10分钟)
        await cacheService.set(cacheKey, result, 600);

        return result;
    }

    /**
     * 获取群聊消息
     */
    async getGroupMessages(
        groupId: string,
        options: PaginationParams = {}
    ): Promise<PaginatedMessages> {
        await waitForMongoReady();

        const page = options.page || 1;
        const limit = options.limit || 50;

        const chatId = buildGroupChatId(groupId);
        const query = {
            chatId,
            deletedAt: null,
            isGroupChat: true,
        };

        const totalMessages = await Message.countDocuments(query);
        const totalPages = Math.ceil(totalMessages / limit);
        const skip = (page - 1) * limit;

        const messages = await Message.find(query)
            .sort({ seq: -1, timestamp: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        return {
            messages: messages.reverse() as IMessage[],
            pagination: {
                currentPage: page,
                totalPages,
                totalMessages,
                hasMore: page < totalPages,
                limit,
            },
        };
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
