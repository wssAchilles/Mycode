import { redis } from '../config/redis';

// 刷新令牌在 Redis 中的存储辅助方法
const KEY_PREFIX = 'refresh_token:';

const buildKey = (userId: string) => `${KEY_PREFIX}${userId}`;

export const storeRefreshToken = async (userId: string, jti: string, ttlSeconds: number) => {
  try {
    await redis.set(buildKey(userId), jti, 'EX', ttlSeconds);
  } catch (error) {
    console.error('❌ 存储刷新令牌 jti 失败:', error);
  }
};

export const validateRefreshToken = async (userId: string, jti?: string): Promise<boolean> => {
  if (!jti) return false;
  try {
    const stored = await redis.get(buildKey(userId));
    return stored === jti;
  } catch (error) {
    console.error('❌ 校验刷新令牌 jti 失败:', error);
    return false;
  }
};

export const revokeRefreshToken = async (userId: string) => {
  try {
    await redis.del(buildKey(userId));
  } catch (error) {
    console.error('❌ 撤销刷新令牌 jti 失败:', error);
  }
};
