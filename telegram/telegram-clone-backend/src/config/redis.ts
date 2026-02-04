import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// 支持 REDIS_URL (云端) 或 REDIS_HOST/PORT (本地)
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl
  ? new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined, // Upstash 需要 TLS
  })
  : new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  });

const connectRedis = async (): Promise<void> => {
  // 防止重复设置事件监听器
  redis.removeAllListeners();

  try {
    // 设置事件监听器（静默处理）
    redis.on('error', () => {
      // 静默处理错误，不输出重复错误
    });

    redis.on('connect', () => {
      console.log('🔄 Redis 连接成功');
    });

    redis.on('close', () => {
      // 静默处理关闭事件
    });

    await redis.connect();

    // 执行 ping 测试
    const pong = await redis.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis 连接成功');
    }

  } catch (error: any) {
    console.error('❌ Redis 连接失败:', error?.message || '连接被拒绝');
    throw error;
  }
};

export { redis, connectRedis };
