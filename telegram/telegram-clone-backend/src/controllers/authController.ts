import { Request, Response } from 'express';
import { Op } from 'sequelize';
import User from '../models/User';
import { generateTokenPair, verifyRefreshToken, getRefreshTtlSeconds } from '../utils/jwt';
import { storeRefreshToken, validateRefreshToken, revokeRefreshToken } from '../utils/refreshTokenStore';

// 用户注册
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, email } = req.body;

    // 验证必填字段
    if (!username || !password) {
      res.status(400).json({
        error: '注册失败',
        message: '用户名和密码为必填项',
      });
      return;
    }

    // 验证用户名长度
    if (username.length < 3 || username.length > 50) {
      res.status(400).json({
        error: '注册失败',
        message: '用户名长度必须在 3-50 个字符之间',
      });
      return;
    }

    // 验证密码长度
    if (password.length < 6 || password.length > 255) {
      res.status(400).json({
        error: '注册失败',
        message: '密码长度必须在 6-255 个字符之间',
      });
      return;
    }

    // 验证用户名格式
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      res.status(400).json({
        error: '注册失败',
        message: '用户名只能包含字母、数字和下划线',
      });
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
      
      res.status(409).json({
        error: '注册失败',
        message,
      });
      return;
    }

    // 创建新用户
    const user = await User.create({
      username,
      password,
      email: email || undefined,
    });

    // 生成 JWT 令牌
    const tokens = generateTokenPair({
      userId: user.id,
      username: user.username,
    });
    // 存储刷新令牌 jti
    await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

    console.log(`✅ 新用户注册成功: ${username} (${user.id})`);

    res.status(201).json({
      message: '注册成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      tokens,
    });
  } catch (error: any) {
    console.error('注册错误:', error);
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '注册过程中发生错误，请稍后重试',
    });
  }
};

// 用户登录
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { usernameOrEmail, password } = req.body;

    // 验证必填字段
    if (!usernameOrEmail || !password) {
      res.status(400).json({
        error: '登录失败',
        message: '用户名/邮箱和密码为必填项',
      });
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
      res.status(401).json({
        error: '登录失败',
        message: '用户名/邮箱或密码错误',
      });
      return;
    }

    // 验证密码
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      res.status(401).json({
        error: '登录失败',
        message: '用户名/邮箱或密码错误',
      });
      return;
    }

    // 生成 JWT 令牌
    const tokens = generateTokenPair({
      userId: user.id,
      username: user.username,
    });
    await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

    console.log(`✅ 用户登录成功: ${user.username} (${user.id})`);

    res.status(200).json({
      message: '登录成功',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      tokens,
    });
  } catch (error: any) {
    console.error('登录错误:', error);
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '登录过程中发生错误，请稍后重试',
    });
  }
};

// 刷新访问令牌
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        error: '刷新令牌失败',
        message: '缺少刷新令牌',
      });
      return;
    }

    // 验证刷新令牌
    const decoded = await verifyRefreshToken(refreshToken);

    // 校验 jti 是否仍然有效
    const isValid = await validateRefreshToken(decoded.userId, decoded.jti);
    if (!isValid) {
      res.status(401).json({
        error: '刷新令牌失败',
        message: '刷新令牌已失效，请重新登录',
      });
      return;
    }

    // 检查用户是否仍然存在
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      res.status(401).json({
        error: '刷新令牌失败',
        message: '用户不存在',
      });
      return;
    }

    // 生成新的令牌对并轮换 jti
    const tokens = generateTokenPair({
      userId: user.id,
      username: user.username,
    });
    await storeRefreshToken(user.id, tokens.refreshJti, getRefreshTtlSeconds());

    res.status(200).json({
      message: '令牌刷新成功',
      tokens,
    });
  } catch (error: any) {
    console.error('刷新令牌错误:', error);
    
    let message = '无效的刷新令牌';
    if (error.name === 'TokenExpiredError') {
      message = '刷新令牌已过期';
    }

    res.status(401).json({
      error: '刷新令牌失败',
      message,
    });
  }
};

// 获取当前用户信息
export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: '获取用户信息失败',
        message: '用户未认证',
      });
      return;
    }

    const user = await User.findByPk(userId);
    if (!user) {
      res.status(404).json({
        error: '获取用户信息失败',
        message: '用户不存在',
      });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('获取用户信息错误:', error);
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取用户信息时发生错误',
    });
  }
};

// 登出并撤销刷新令牌
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(200).json({ message: '已登出' });
      return;
    }
    await revokeRefreshToken(userId);
    res.status(200).json({ message: '登出成功，刷新令牌已撤销' });
  } catch (error: any) {
    console.error('登出失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
