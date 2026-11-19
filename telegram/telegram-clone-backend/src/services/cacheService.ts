/**
 * CacheService - Redis 缓存服务层
 * 提供统一的缓存操作接口
 */
import Redis from 'ioredis';
import { createChildLogger } from '../utils/logger';
const log = createChildLogger('services:cacheService');

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
                log.info('✅ Redis 缓存服务已连接');
            });

            redisClient.on('error', (err) => {
                isConnected = false;
                log.warn({ data: err.message }, '⚠️ Redis 连接错误');
            });

            redisClient.on('close', () => {
                isConnected = false;
            });

            // 尝试连接
            redisClient.connect().catch(() => {
                log.warn('⚠️ Redis 连接失败，缓存功能将被禁用');
            });
        } catch (err) {
            log.warn({ err: err }, '⚠️ Redis 初始化失败');
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
            log.warn({ err: err }, '⚠️ 缓存读取失败 [${key}]');
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
            log.warn({ err: err }, '⚠️ 缓存写入失败 [${key}]');
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
            log.warn({ err: err }, '⚠️ 缓存删除失败 [${key}]');
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
            log.warn({ err: err }, '⚠️ 缓存模式删除失败 [${pattern}]');
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
     * 检查单个用户在线状态（优先读取 Rust 网关会话注册表，兼容 legacy online:<userId> 键）
     */
    async isUserOnline(userId: string): Promise<boolean> {
        const cleanId = String(userId || '').trim();
        if (!cleanId) return false;
        const map = await this.areUsersOnline([cleanId]);
        return map.get(cleanId) ?? false;
    }

    /**
     * 批量查询目标用户列表的实时在线状态（基于 Redis 会话注册表并校验心跳新鲜度）
     */
    async areUsersOnline(
        userIds: string[],
        staleAfterSecs: number = Number(process.env.GATEWAY_REALTIME_HEARTBEAT_STALE_SECS || 120),
    ): Promise<Map<string, boolean>> {
        const targets = Array.from(
            new Set(
                (userIds || [])
                    .map((id) => String(id || '').trim())
                    .filter((id) => id.length > 0 && id !== 'ai'),
            ),
        );
        const result = new Map<string, boolean>();
        for (const uid of targets) {
            result.set(uid, false);
        }
        if (targets.length === 0) {
            return result;
        }

        const client = getClient();
        if (!client || !this.isAvailable()) {
            return result;
        }

        try {
            const pipe = client.pipeline();
            for (const uid of targets) {
                pipe.sunion(`rt:user:${uid}`, `rt:user_sessions:${uid}`);
                pipe.get(`online:${uid}`);
            }
            const pipeRes = await pipe.exec();
            if (!pipeRes) {
                return result;
            }

            const sidToUids = new Map<string, Set<string>>();
            for (let i = 0; i < targets.length; i += 1) {
                const uid = targets[i];
                const [sunionErr, sunionVal] = pipeRes[i * 2] || [];
                const [legacyErr, legacyVal] = pipeRes[i * 2 + 1] || [];

                if (!legacyErr && typeof legacyVal === 'string' && legacyVal) {
                    try {
                        const parsedLegacy = JSON.parse(legacyVal) as { online?: boolean };
                        if (parsedLegacy?.online) {
                            result.set(uid, true);
                        }
                    } catch {
                        // 忽略损坏的旧版缓存数据
                    }
                }

                if (!sunionErr && Array.isArray(sunionVal)) {
                    for (const rawSid of sunionVal) {
                        const sid = String(rawSid || '').trim();
                        if (!sid) continue;
                        let uids = sidToUids.get(sid);
                        if (!uids) {
                            uids = new Set<string>();
                            sidToUids.set(sid, uids);
                        }
                        uids.add(uid);
                    }
                }
            }

            if (sidToUids.size === 0) {
                return result;
            }

            const candidateSids = Array.from(sidToUids.keys());
            const sessionKeys = candidateSids.map((sid) => `rt:session:${sid}`);
            const rawSessions = await client.mget(...sessionKeys);
            const nowMs = Date.now();
            const staleThresholdMs =
                Number.isFinite(staleAfterSecs) && staleAfterSecs > 0
                    ? staleAfterSecs * 1000
                    : 0;

            for (let i = 0; i < candidateSids.length; i += 1) {
                const raw = rawSessions[i];
                if (!raw) continue;
                try {
                    const record = JSON.parse(raw) as {
                        authenticated?: boolean;
                        user_id?: string | null;
                        last_heartbeat_at?: string;
                        last_event_at?: string;
                    };
                    if (!record?.authenticated) continue;

                    if (staleThresholdMs > 0) {
                        const ts = record.last_heartbeat_at || record.last_event_at;
                        if (ts) {
                            const parsedMs = Date.parse(ts);
                            if (Number.isFinite(parsedMs) && nowMs - parsedMs > staleThresholdMs) {
                                continue;
                            }
                        }
                    }

                    const recordUid = typeof record.user_id === 'string' ? record.user_id.trim() : '';
                    if (recordUid && result.has(recordUid)) {
                        result.set(recordUid, true);
                    }
                } catch {
                    // 忽略格式异常的会话记录
                }
            }

            return result;
        } catch (err) {
            log.warn({ err }, '⚠️ 批量查询用户在线状态失败');
            return result;
        }
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
            log.warn({ err: err }, '⚠️ 计数器递增失败 [${key}]');
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
