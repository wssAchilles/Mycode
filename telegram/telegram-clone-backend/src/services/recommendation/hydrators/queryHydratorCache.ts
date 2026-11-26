/**
 * QueryHydrator 本地 Redis 短时缓存辅助模块
 * 仅在 Redis 已就绪时生效，带严格超时守卫，失败或超时时静默回退数据库直查
 */
import { redis } from '../../../config/redis';

const DEFAULT_CACHE_READ_TIMEOUT_MS = 80;

/**
 * 读取短时缓存；Redis 未就绪、超时或反序列化失败均返回 null
 */
export async function readQueryHydratorCache<T>(
    key: string,
    timeoutMs: number = DEFAULT_CACHE_READ_TIMEOUT_MS,
): Promise<T | null> {
    if (redis.status !== 'ready') {
        return null;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        const timeoutPromise = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), timeoutMs);
        });
        const raw = await Promise.race([
            redis.get(key).catch(() => null),
            timeoutPromise,
        ]);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 异步回写短时缓存（fire-and-forget），绝不阻塞主请求链路
 */
export function writeQueryHydratorCache(
    key: string,
    value: unknown,
    ttlSec: number,
): void {
    if (redis.status !== 'ready' || ttlSec <= 0) {
        return;
    }

    try {
        const serialized = JSON.stringify(value);
        void redis.set(key, serialized, 'EX', ttlSec).catch(() => undefined);
    } catch {
        // 忽略序列化或写入异常
    }
}
