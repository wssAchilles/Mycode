import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cacheService';
import { verifyAccessToken, JWTPayload } from '../utils/jwt';
import { errors } from '../utils/apiResponse';
import { createChildLogger } from '../utils/logger';
import User from '../models/User';

const log = createChildLogger('middleware:auth');

// 安全格式化日期（兼容 Date 对象和字符串）
function formatDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.split('T')[0];
  return null;
}

// 扩展 Express Request 接口
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email?: string;
        avatarUrl?: string;
        birthDate?: string;
        region?: string;
        language?: string;
      };
      userId?: string;
    }
  }
}

// 从缓存或数据库获取用户信息
async function getUserWithCache(userId: string) {
  const cacheKey = `auth:user:${userId}`;
  const cached = await cacheService.get<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const user = await User.findByPk(userId);
  if (user) {
    const json = user.toJSON();
    await cacheService.set(cacheKey, json, 30); // 缓存 30 秒
    return json;
  }
  return null;
}

// 认证中间件
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 从请求头中获取 token
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = tokenFromHeader || tokenFromQuery;

    if (!token) {
      errors.unauthorized(res, '缺少访问令牌');
      return;
    }

    // 特殊逻辑：允许 CRON_SECRET 绕过用户认证 (用于 ML 服务回调)
    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      req.userId = 'system-crawler';
      req.user = {
        id: 'system-crawler',
        username: 'SystemCrawler',
        email: 'crawler@system.local'
      };
      next();
      return;
    }

    const decoded: JWTPayload = await verifyAccessToken(token);
    const user = await getUserWithCache(decoded.userId);

    if (!user) {
      errors.unauthorized(res, '用户不存在');
      return;
    }

    // 将用户信息添加到请求对象
    req.user = {
      id: user.id as string,
      username: user.username as string,
      email: user.email as string | undefined,
      avatarUrl: user.avatarUrl as string | undefined,
      birthDate: formatDate(user.birthDate) ?? undefined,
      region: user.region as string | undefined,
      language: user.language as string | undefined,
    };
    req.userId = user.id as string;

    next();
  } catch (error: any) {
    let message = '无效的访问令牌';
    if (error.name === 'TokenExpiredError') {
      message = '访问令牌已过期';
    } else if (error.name === 'JsonWebTokenError') {
      message = '无效的访问令牌格式';
    }
    errors.unauthorized(res, message);
  }
};

// 可选认证中间件（用户可以已登录也可以未登录）
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      // 没有 token，继续处理但不设置用户信息
      next();
      return;
    }

    // 尝试验证 token
    const decoded: JWTPayload = await verifyAccessToken(token);
    const user = await getUserWithCache(decoded.userId);

    if (user) {
      req.user = {
        id: user.id as string,
        username: user.username as string,
        email: user.email as string | undefined,
        avatarUrl: user.avatarUrl as string | undefined,
        birthDate: formatDate(user.birthDate) ?? undefined,
        region: user.region as string | undefined,
        language: user.language as string | undefined,
      };
      req.userId = user.id as string;
    }

    next();
  } catch (error) {
    // 认证失败，但不阻止请求继续
    log.warn({ err: error }, '可选认证失败');
    next();
  }
};
