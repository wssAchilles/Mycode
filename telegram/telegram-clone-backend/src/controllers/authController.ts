import { Request, Response } from 'express';
import { sendSuccess, sendCreated, errors } from '../utils/apiResponse';
import { catchAsync } from '../middleware/errorHandler';
import { createChildLogger } from '../utils/logger';


const log = createChildLogger('controllers:auth');

// Original imports
import { Op } from 'sequelize';
import User from '../models/User';
import { generateTokenPair, verifyRefreshToken, getRefreshTtlSeconds } from '../utils/jwt';
import { storeRefreshToken, validateRefreshToken, revokeRefreshToken } from '../utils/refreshTokenStore';

// 安全格式化日期（兼容 Date 对象和字符串）
function formatDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.split('T')[0];
  return null;
}

// 用户注册
export const register = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { username, password, email, birthDate, region, language } = req.body;

  // 验证必填字段
  if (!username || !password) {
    errors.badRequest(res, '用户名和密码为必填项');
    return;
  }

  // 验证用户名长度
  if (username.length < 3 || username.length > 50) {
    errors.badRequest(res, '用户名长度必须在 3-50 个字符之间');
    return;
  }

  // 验证密码长度
  if (password.length < 6 || password.length > 255) {
    errors.badRequest(res, '密码长度必须在 6-255 个字符之间');
    return;
  }

  // 验证用户名格式
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errors.badRequest(res, '用户名只能包含字母、数字和下划线');
    return;
  }

  // 检查用户名或邮箱是否已存在
  const existingUser = await User.findOne({
    where: {
      [Op.or]: [
        { username },
        ...(email ? [{ email }] : [])
      ]
    }
  });

  if (existingUser) {
    let message = '用户名已被使用';
    if (existingUser.username === username) {
      message = '用户名已被使用';
    } else if (existingUser.email === email) {
      message = '邮箱已被使用';
    }
    errors.conflict(res, message);
    return;
  }

  // 创建新用户
  const user = await User.create({
    username,
    password,
    email: email || undefined,
    birthDate: birthDate || undefined,
    region: region || undefined,
    language: language || undefined,
  });

  // 生成 JWT 令牌
  const tokens = generateTokenPair({
    userId: user.id,
    username: user.username,
  });
  // 存储刷新令牌 jti
  await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

  log.info({ username, userId: user.id }, '新用户注册成功');

  sendCreated(res, {
    message: '注册成功',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      birthDate: formatDate(user.birthDate),
      region: user.region,
      language: user.language,
      createdAt: user.createdAt,
    },
    tokens,
  });
});

// 用户登录
export const login = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { usernameOrEmail, password } = req.body;

  // 验证必填字段
  if (!usernameOrEmail || !password) {
    errors.badRequest(res, '用户名/邮箱和密码为必填项');
    return;
  }

  // 查找用户（支持用户名或邮箱登录）
  const user = await User.findOne({
    where: {
      [Op.or]: [
        { username: usernameOrEmail },
        { email: usernameOrEmail }
      ]
    }
  });

  if (!user) {
    errors.unauthorized(res, '用户名/邮箱或密码错误');
    return;
  }

  // 验证密码
  const isValidPassword = await user.validatePassword(password);
  if (!isValidPassword) {
    errors.unauthorized(res, '用户名/邮箱或密码错误');
    return;
  }

  // 生成 JWT 令牌
  const tokens = generateTokenPair({
    userId: user.id,
    username: user.username,
  });
  await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

  log.info({ username: user.username, userId: user.id }, '用户登录成功');

  sendSuccess(res, {
    message: '登录成功',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      birthDate: formatDate(user.birthDate),
      region: user.region,
      language: user.language,
      createdAt: user.createdAt,
    },
    tokens,
  });
});

// 刷新访问令牌
export const refreshToken = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    errors.badRequest(res, '缺少刷新令牌');
    return;
  }

  // 验证刷新令牌
  const decoded = await verifyRefreshToken(refreshToken);

  // 校验 jti 是否仍然有效
  const isValid = await validateRefreshToken(decoded.userId, decoded.jti);
  if (!isValid) {
    errors.unauthorized(res, '刷新令牌已失效，请重新登录');
    return;
  }

  // 检查用户是否仍然存在
  const user = await User.findByPk(decoded.userId);
  if (!user) {
    errors.unauthorized(res, '用户不存在');
    return;
  }

  // 生成新的令牌对并轮换 jti
  const tokens = generateTokenPair({
    userId: user.id,
    username: user.username,
  });
  await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

  sendSuccess(res, {
    message: '令牌刷新成功',
    tokens,
  });
});

// 获取当前用户信息
export const getCurrentUser = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;

  if (!userId) {
    errors.unauthorized(res, '用户未认证');
    return;
  }

  const user = await User.findByPk(userId);
  if (!user) {
    errors.notFound(res, '用户');
    return;
  }

  sendSuccess(res, {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      birthDate: formatDate(user.birthDate),
      region: user.region,
      language: user.language,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// 登出并撤销刷新令牌
export const logout = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    sendSuccess(res, { message: '已登出' });
    return;
  }
  await revokeRefreshToken(userId);
  sendSuccess(res, { message: '登出成功，刷新令牌已撤销' });
});
