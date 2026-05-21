import { Request, Response } from 'express';
import UserMongo from '../models/UserMongo';
import { generateTokenPair, verifyRefreshToken, getRefreshTtlSeconds } from '../utils/jwt';
import { storeRefreshToken, validateRefreshToken, revokeRefreshToken } from '../utils/refreshTokenStore';
import { createChildLogger } from '../utils/logger';
import { sendSuccess, sendCreated, errors } from '../utils/apiResponse';
import { catchAsync } from '../middleware/errorHandler';

const log = createChildLogger('authControllerMongo');

// 用户注册（MongoDB版本） — Zod registerSchema 已在路由层验证字段格式
export const register = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { username, password, email, birthDate, region, language } = req.body;

  // 检查用户名或邮箱是否已存在（DB 级检查）
  const query: Record<string, unknown> = {
    $or: [{ username }]
  };

  if (email) {
    (query.$or as unknown[]).push({ email });
  }

  const existingUser = await UserMongo.findOne(query);

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
  const user = new UserMongo({
    username,
    password,
    email: email || undefined,
    birthDate: birthDate || undefined,
    region: region || undefined,
    language: language || undefined,
  });

  await user.save();

  // 生成 JWT 令牌
  const tokens = generateTokenPair({
    userId: user._id.toString(),
    username: user.username,
  });
  await storeRefreshToken(user._id.toString(), tokens.refreshJti, getRefreshTtlSeconds());

  log.info({ username, userId: user._id.toString() }, '新用户注册成功（MongoDB）');

  sendCreated(res, {
    message: '注册成功',
    user: user.toJSON(),
    tokens,
  });
});

// 用户登录（MongoDB版本） — Zod loginSchema 已在路由层验证字段格式
export const login = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { usernameOrEmail, password } = req.body;

  // 查找用户（支持用户名或邮箱登录）
  const user = await UserMongo.findOne({
    $or: [
      { username: usernameOrEmail },
      { email: usernameOrEmail }
    ]
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
    userId: user._id.toString(),
    username: user.username,
  });
  await storeRefreshToken(user._id.toString(), tokens.refreshJti, getRefreshTtlSeconds());

  log.info({ username: user.username, userId: user._id.toString() }, '用户登录成功（MongoDB）');

  sendSuccess(res, {
    message: '登录成功',
    user: user.toJSON(),
    tokens,
  });
});

// 刷新访问令牌（MongoDB版本） — Zod refreshTokenSchema 已在路由层验证
export const refreshToken = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  // 验证刷新令牌
  const decoded = await verifyRefreshToken(refreshToken);

  const isValid = await validateRefreshToken(decoded.userId, decoded.jti);
  if (!isValid) {
    errors.unauthorized(res, '刷新令牌已失效，请重新登录');
    return;
  }

  // 检查用户是否仍然存在
  const user = await UserMongo.findById(decoded.userId);
  if (!user) {
    errors.unauthorized(res, '用户不存在');
    return;
  }

  // 生成新的令牌对
  const tokens = generateTokenPair({
    userId: user._id.toString(),
    username: user.username,
  });
  await storeRefreshToken(user._id.toString(), tokens.refreshJti, getRefreshTtlSeconds());

  sendSuccess(res, {
    message: '令牌刷新成功',
    tokens,
  });
});

// 获取当前用户信息（MongoDB版本）
export const getCurrentUser = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;

  if (!userId) {
    errors.unauthorized(res);
    return;
  }

  const user = await UserMongo.findById(userId);
  if (!user) {
    errors.notFound(res, '用户');
    return;
  }

  sendSuccess(res, {
    user: user.toJSON(),
  });
});

// 登出并撤销刷新令牌
export const logout = catchAsync(async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  if (userId) {
    await revokeRefreshToken(userId);
  }
  sendSuccess(res, { message: '登出成功，刷新令牌已撤销' });
});
