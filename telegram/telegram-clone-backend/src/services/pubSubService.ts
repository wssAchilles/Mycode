/**
 * PubSubService - Redis Pub/Sub 广播服务
 * 用于 Socket.IO 集群间的消息广播
 */
import Redis from 'ioredis';

// 创建独立的 pub/sub 连接
const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 频道名称常量
export const CHANNELS = {
    NEW_MESSAGE: 'chat:new-message',
    MESSAGE_READ: 'chat:message-read',
    TYPING: 'chat:typing',
    USER_ONLINE: 'user:online',
    USER_OFFLINE: 'user:offline',
    NOTIFICATION: 'notification',
} as const;

// 消息事件接口
export interface NewMessageEvent {
    messageId: string;
    senderId: string;
    receiverId: string;
    pts: number;
    timestamp: number;
}

export interface TypingEvent {
    userId: string;
    targetId: string;
    isTyping: boolean;
}

export interface UserStatusEvent {
    userId: string;
    status: 'online' | 'offline';
    lastSeen?: number;
}

// 事件处理器类型
type EventHandler<T> = (data: T) => void;

class PubSubService {
    private handlers: Map<string, Set<EventHandler<any>>> = new Map();
    private isSubscribed = false;

    /**
     * 初始化 Pub/Sub 服务
     */
    async initialize(): Promise<void> {
        if (this.isSubscribed) return;

        // 订阅所有频道
        await subscriber.subscribe(
            CHANNELS.NEW_MESSAGE,
            CHANNELS.MESSAGE_READ,
            CHANNELS.TYPING,
            CHANNELS.USER_ONLINE,
            CHANNELS.USER_OFFLINE,
            CHANNELS.NOTIFICATION
        );

        // 监听消息
        subscriber.on('message', (channel, message) => {
            try {
                const data = JSON.parse(message);
                this.emit(channel, data);
            } catch (err) {
                console.error('PubSub 消息解析失败:', err);
            }
        });

        this.isSubscribed = true;
        console.log('✅ Redis Pub/Sub 服务已初始化');
    }

    /**
     * 发布消息
     */
    async publish<T>(channel: string, data: T): Promise<number> {
        const message = JSON.stringify(data);
        return publisher.publish(channel, message);
    }

    /**
     * 发布新消息事件
     */
    async publishNewMessage(event: NewMessageEvent): Promise<void> {
        await this.publish(CHANNELS.NEW_MESSAGE, event);
    }

    /**
     * 发布输入状态事件
     */
    async publishTyping(event: TypingEvent): Promise<void> {
        await this.publish(CHANNELS.TYPING, event);
    }

    /**
     * 发布用户状态变更
     */
    async publishUserStatus(event: UserStatusEvent): Promise<void> {
        const channel = event.status === 'online'
            ? CHANNELS.USER_ONLINE
            : CHANNELS.USER_OFFLINE;
        await this.publish(channel, event);
    }

    /**
     * 注册事件处理器
     */
    on<T>(channel: string, handler: EventHandler<T>): void {
        if (!this.handlers.has(channel)) {
            this.handlers.set(channel, new Set());
        }
        this.handlers.get(channel)!.add(handler);
    }

    /**
     * 移除事件处理器
     */
    off<T>(channel: string, handler: EventHandler<T>): void {
        const handlers = this.handlers.get(channel);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * 触发事件
     */
    private emit<T>(channel: string, data: T): void {
        const handlers = this.handlers.get(channel);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(data);
                } catch (err) {
                    console.error(`事件处理器错误 (${channel}):`, err);
                }
            });
        }
    }

    /**
     * 获取发布者连接 (用于 Socket.IO Adapter)
     */
    getPublisher(): Redis {
        return publisher;
    }

    /**
     * 获取订阅者连接 (用于 Socket.IO Adapter)
     */
    getSubscriber(): Redis {
        return subscriber;
    }

    /**
     * 关闭连接
     */
    async close(): Promise<void> {
        await Promise.all([
            publisher.quit(),
            subscriber.quit(),
        ]);
    }
}

// 导出单例
export const pubSubService = new PubSubService();
export default pubSubService;
