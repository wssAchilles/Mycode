import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
    if (redis) return redis;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    redis = new Redis(url, {
        lazyConnect: true,
    });
    redis.on('error', (err) => {
        console.error('[Redis] error', err);
    });
    // 尝试连接，但不阻塞
    redis.connect().catch((err) => {
        console.error('[Redis] connect error', err);
    });
    return redis;
}
