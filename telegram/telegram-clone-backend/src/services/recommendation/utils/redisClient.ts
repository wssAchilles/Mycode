import type Redis from 'ioredis';
import { redis as sharedRedis } from '../../../config/redis';

function isRedisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST || process.env.REDIS_PORT);
}

/**
 * Return the shared Redis client used by the backend.
 *
 * Important:
 * - Avoid creating multiple Redis connections with different configs.
 * - Best-effort connect: do not block request path.
 */
export function getRedis(): Redis | null {
    if (!isRedisConfigured()) return null;

    try {
        const status = (sharedRedis as any)?.status;
        if (status !== 'ready' && status !== 'connecting') {
            sharedRedis.connect().catch(() => undefined);
        }
    } catch {
        // ignore
    }

    return sharedRedis as unknown as Redis;
}
