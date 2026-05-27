import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/authMiddleware';
import { createChildLogger } from '../utils/logger';
import { validate } from '../middleware/validate';
import { registerSchema, loginSchema, refreshTokenSchema } from '../schemas/authSchemas';

// 导入两套认证控制器
import * as authController from '../controllers/authController';
import * as authControllerMongo from '../controllers/authControllerMongo';
import { loginLimiter } from '../middleware/rateLimiter';

const log = createChildLogger('authRoutes');

// 延迟检测数据库可用性，首次请求时确定，之后缓存结果
let useMongoAuth: boolean | null = null;

async function resolveAuth(): Promise<typeof authController> {
  if (useMongoAuth !== null) {
    return useMongoAuth ? authControllerMongo : authController;
  }
  try {
    const { sequelize } = require('../config/sequelize');
    await sequelize.authenticate();
    useMongoAuth = false;
    return authController;
  } catch {
    log.info('PostgreSQL 不可用，使用 MongoDB 认证');
    useMongoAuth = true;
    return authControllerMongo;
  }
}

const router = Router();

// 用户注册
router.post('/register', validate(registerSchema), async (req, res, next) => {
  const auth = await resolveAuth();
  return auth.register(req, res, next);
});

// 用户登录
router.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  const auth = await resolveAuth();
  return auth.login(req, res, next);
});

// 刷新访问令牌
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '刷新令牌请求过于频繁' } },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), async (req, res, next) => {
  const auth = await resolveAuth();
  return auth.refreshToken(req, res, next);
});

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, async (req, res, next) => {
  const auth = await resolveAuth();
  return auth.getCurrentUser(req, res, next);
});

// 用户登出（可选实现 - 通常在客户端删除令牌即可）
router.post('/logout', authenticateToken, async (req, res, next) => {
  const auth = await resolveAuth();
  return auth.logout(req, res, next);
});

export default router;
