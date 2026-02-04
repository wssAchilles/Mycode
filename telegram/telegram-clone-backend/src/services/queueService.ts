/**
 * QueueService - BullMQ 消息队列服务
 * 用于高并发消息处理的异步任务队列
 */
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

// Redis 连接配置
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

// 队列名称常量
export const QUEUE_NAMES = {
    CHAT_MESSAGE: 'chat-message-queue',
    NOTIFICATION: 'notification-queue',
    FILE_PROCESS: 'file-process-queue',
    MESSAGE_FANOUT: 'message-fanout-queue',
} as const;

// 消息任务数据接口
export interface MessageJobData {
    messageId: string;
    senderId: string;
    receiverId: string;
    encryptedContent: string;
    type: number; // Signal 消息类型
    isGroupChat: boolean;
    timestamp: number;
}

// 通知任务数据接口
export interface NotificationJobData {
    userId: string;
    type: 'new_message' | 'contact_request' | 'mention' | 'system';
    title: string;
    body: string;
    data?: Record<string, any>;
}

// 文件处理任务数据接口
export interface FileProcessJobData {
    fileId: string;
    userId: string;
    action: 'thumbnail' | 'compress' | 'encrypt' | 'scan';
    filePath: string;
}

// 消息扩散任务数据接口 (P0 优化)
export interface MessageFanoutJobData {
    messageId: string;
    chatId: string;
    chatType: 'private' | 'group';
    seq: number;
    senderId: string;
    recipientIds: string[];
}

class QueueService {
    private queues: Map<string, Queue> = new Map();
    private workers: Map<string, Worker> = new Map();
    private queueEvents: Map<string, QueueEvents> = new Map();

    /**
     * 初始化所有队列
     */
    async initialize(): Promise<void> {
        // 创建消息队列
        this.createQueue(QUEUE_NAMES.CHAT_MESSAGE, {
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
                removeOnComplete: 100,
                removeOnFail: 500,
            },
        });

        // 创建通知队列
        this.createQueue(QUEUE_NAMES.NOTIFICATION, {
            defaultJobOptions: {
                attempts: 2,
                removeOnComplete: 50,
            },
        });

        // 创建文件处理队列
        this.createQueue(QUEUE_NAMES.FILE_PROCESS, {
            defaultJobOptions: {
                attempts: 3,
                timeout: 60000, // 1分钟超时
                removeOnComplete: 20,
            },
        });

        // 创建消息扩散队列 (P0 优化: 异步写扩散)
        this.createQueue(QUEUE_NAMES.MESSAGE_FANOUT, {
            defaultJobOptions: {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 500,
                },
                removeOnComplete: 200,
                removeOnFail: 1000,
            },
        });

        console.log('✅ 消息队列服务已初始化');
    }

    /**
     * 创建队列
     */
    private createQueue(name: string, options: any = {}): Queue {
        const queue = new Queue(name, {
            connection: redisConnection,
            ...options,
        });

        this.queues.set(name, queue);

        // 创建队列事件监听
        const queueEvents = new QueueEvents(name, {
            connection: redisConnection,
        });
        this.queueEvents.set(name, queueEvents);

        return queue;
    }

    /**
     * 获取队列
     */
    getQueue(name: string): Queue | undefined {
        return this.queues.get(name);
    }

    /**
     * 添加消息任务到队列
     */
    async addMessageJob(data: MessageJobData): Promise<Job<MessageJobData>> {
        const queue = this.queues.get(QUEUE_NAMES.CHAT_MESSAGE);
        if (!queue) {
            throw new Error('消息队列未初始化');
        }

        return queue.add('process-message', data, {
            priority: data.isGroupChat ? 2 : 1, // 私聊优先级更高
        });
    }

    /**
     * 添加通知任务到队列
     */
    async addNotificationJob(data: NotificationJobData): Promise<Job<NotificationJobData>> {
        const queue = this.queues.get(QUEUE_NAMES.NOTIFICATION);
        if (!queue) {
            throw new Error('通知队列未初始化');
        }

        return queue.add('send-notification', data);
    }

    /**
     * 添加文件处理任务
     */
    async addFileProcessJob(data: FileProcessJobData): Promise<Job<FileProcessJobData>> {
        const queue = this.queues.get(QUEUE_NAMES.FILE_PROCESS);
        if (!queue) {
            throw new Error('文件处理队列未初始化');
        }

        return queue.add(`file-${data.action}`, data);
    }

    /**
     * 添加消息扩散任务到队列 (P0 优化)
     */
    async addFanoutJob(data: MessageFanoutJobData): Promise<Job<MessageFanoutJobData>> {
        const queue = this.queues.get(QUEUE_NAMES.MESSAGE_FANOUT);
        if (!queue) {
            throw new Error('消息扩散队列未初始化');
        }

        return queue.add('fanout-message', data, {
            priority: data.chatType === 'private' ? 1 : 2, // 私聊优先
        });
    }

    /**
     * 注册消息处理 Worker
     */
    registerMessageWorker(
        processor: (job: Job<MessageJobData>) => Promise<any>
    ): Worker {
        const worker = new Worker(
            QUEUE_NAMES.CHAT_MESSAGE,
            processor,
            {
                connection: redisConnection,
                concurrency: 10, // 同时处理 10 个任务
            }
        );

        worker.on('completed', (job) => {
            console.log(`✅ 消息任务完成: ${job.id}`);
        });

        worker.on('failed', (job, err) => {
            console.error(`❌ 消息任务失败: ${job?.id}`, err.message);
        });

        this.workers.set(QUEUE_NAMES.CHAT_MESSAGE, worker);
        return worker;
    }

    /**
     * 注册通知处理 Worker
     */
    registerNotificationWorker(
        processor: (job: Job<NotificationJobData>) => Promise<any>
    ): Worker {
        const worker = new Worker(
            QUEUE_NAMES.NOTIFICATION,
            processor,
            {
                connection: redisConnection,
                concurrency: 20,
            }
        );

        this.workers.set(QUEUE_NAMES.NOTIFICATION, worker);
        return worker;
    }

    /**
     * 注册消息扩散 Worker (P0 优化)
     */
    registerFanoutWorker(
        processor: (job: Job<MessageFanoutJobData>) => Promise<any>
    ): Worker {
        const worker = new Worker(
            QUEUE_NAMES.MESSAGE_FANOUT,
            processor,
            {
                connection: redisConnection,
                concurrency: 5, // 控制并发，避免数据库压力过大
            }
        );

        worker.on('completed', (job) => {
            console.log(`✅ Fanout 任务完成: ${job.id}`);
        });

        worker.on('failed', (job, err) => {
            console.error(`❌ Fanout 任务失败: ${job?.id}`, err.message);
        });

        this.workers.set(QUEUE_NAMES.MESSAGE_FANOUT, worker);
        return worker;
    }

    /**
     * 获取队列统计信息
     */
    async getQueueStats(name: string): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }> {
        const queue = this.queues.get(name);
        if (!queue) {
            throw new Error(`队列 ${name} 不存在`);
        }

        const [waiting, active, completed, failed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
        ]);

        return { waiting, active, completed, failed };
    }

    /**
     * 关闭所有队列和 Worker
     */
    async close(): Promise<void> {
        for (const worker of this.workers.values()) {
            await worker.close();
        }
        for (const events of this.queueEvents.values()) {
            await events.close();
        }
        for (const queue of this.queues.values()) {
            await queue.close();
        }
        await redisConnection.quit();
    }
}

// 导出单例
export const queueService = new QueueService();
export default queueService;
