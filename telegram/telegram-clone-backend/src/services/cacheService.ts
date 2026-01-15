/**
 * CacheService - Redis 缓存服务层
 * 提供统一的缓存操作接口
 */
import Redis from 'ioredis';

// Redis 客户端实例 (延迟初始化)
let redisClient: Redis | null = null;
let isConnected = false;

// 获取 Redis 客户端
const getClient = (): Redis | null => {
    if (!redisClient) {
        try {
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            redisClient = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: true,
            });

            redisClient.on('connect', () => {
                isConnected = true;
                console.log('✅ Redis 缓存服务已连接');
            });

            redisClient.on('error', (err) => {
                isConnected = false;
                console.warn('⚠️ Redis 连接错误:', err.message);
            });

            redisClient.on('close', () => {
                isConnected = false;
            });

            // 尝试连接
            redisClient.connect().catch(() => {
                console.warn('⚠️ Redis 连接失败，缓存功能将被禁用');
            });
        } catch (err) {
            console.warn('⚠️ Redis 初始化失败:', err);
            return null;
        }
    }
    return redisClient;
};

class CacheService {
    /**
     * 检查缓存服务是否可用
     */
    isAvailable(): boolean {
        return isConnected && redisClient !== null;
    }

    /**
     * 获取缓存值
     */
    async get<T>(key: string): Promise<T | null> {
        const client = getClient();
        if (!client || !this.isAvailable()) {
            return null;
        }

        try {
            const value = await client.get(key);
            if (value) {
                return JSON.parse(value) as T;
            }
            return null;
        } catch (err) {
            console.warn(`⚠️ 缓存读取失败 [${key}]:`, err);
            return null;
        }
    }

    /**
     * 设置缓存值
     * @param key 缓存键
     * @param value 缓存值
     * @param ttl 过期时间(秒)，默认 600 秒 (10分钟)
     */
    async set<T>(key: string, value: T, ttl: number = 600): Promise<boolean> {
        const client = getClient();
        if (!client || !this.isAvailable()) {
            return false;
        }

        try {
            const serialized = JSON.stringify(value);
            await client.setex(key, ttl, serialized);
            return true;
        } catch (err) {
            console.warn(`⚠️ 缓存写入失败 [${key}]:`, err);
            return false;
        }
    }

    /**
     * 删除缓存
     */
    async delete(key: string): Promise<boolean> {
        const client = getClient();
        if (!client || !this.isAvailable()) {
            return false;
        }

        try {
            await client.del(key);
            return true;
        } catch (err) {
            console.warn(`⚠️ 缓存删除失败 [${key}]:`, err);
            return false;
        }
    }

    /**
     * 按模式删除缓存 (使用 SCAN 避免阻塞)
     */
    async deletePattern(pattern: string): Promise<number> {
        const client = getClient();
        if (!client || !this.isAvailable()) {
            return 0;
        }

        try {
            let deletedCount = 0;
            let cursor = '0';

            // 使用 SCAN 迭代器避免阻塞
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;

                if (keys.length > 0) {
                    await client.del(...keys);
                    deletedCount += keys.length;
                }
            } while (cursor !== '0');

            return deletedCount;
        } catch (err) {
            console.warn(`⚠️ 缓存模式删除失败 [${pattern}]:`, err);
            return 0;
        }
    }

    /**
     * 设置用户在线状态
     */
    async setUserOnline(userId: string, ttl: number = 300): Promise<boolean> {
        return this.set(`online:${userId}`, { online: true, lastSeen: new Date().toISOString() }, ttl);
    }

    /**
     * 设置用户离线状态
     */
    async setUserOffline(userId: string): Promise<boolean> {
        return this.delete(`online:${userId}`);
    }

    /**
     * 检查用户在线状态
     */
    async isUserOnline(userId: string): Promise<boolean> {
        const status = await this.get<{ online: boolean }>(`online:${userId}`);
        return status?.online || false;
    }

    /**
     * 递增计数器
     */
    async increment(key: string, amount: number = 1): Promise<number> {
        const client = getClient();
        if (!client || !this.isAvailable()) {
            return 0;
        }

        try {
            return await client.incrby(key, amount);
        } catch (err) {
            console.warn(`⚠️ 计数器递增失败 [${key}]:`, err);
            return 0;
        }
    }

    /**
     * 获取或设置缓存 (缓存穿透保护)
     */
    async getOrSet<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttl: number = 600
    ): Promise<T> {
        // 尝试从缓存获取
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // 从源获取数据
        const value = await fetchFn();

        // 写入缓存
        await this.set(key, value, ttl);

        return value;
    }

    /**
     * 关闭连接
     */
    async close(): Promise<void> {
        if (redisClient) {
            await redisClient.quit();
            redisClient = null;
            isConnected = false;
        }
    }
}

// 导出单例
export const cacheService = new CacheService();
export default cacheService;
