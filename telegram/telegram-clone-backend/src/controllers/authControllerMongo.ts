import { Request, Response } from 'express';
import UserMongo from '../models/UserMongo';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt';

// 用户注册（MongoDB版本）
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
    const query: any = {
      $or: [{ username }]
    };
    
    if (email) {
      query.$or.push({ email });
    }

    const existingUser = await UserMongo.findOne(query);

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
    const user = new UserMongo({
      username,
      password,
      email: email || undefined,
    });

    await user.save();

    // 生成 JWT 令牌
    const tokens = generateTokenPair({
      userId: user._id.toString(),
      username: user.username,
    });

    console.log(`✅ 新用户注册成功（MongoDB）: ${username} (${user._id})`);

    res.status(201).json({
      message: '注册成功',
      user: user.toJSON(),
      tokens,
    });
  } catch (error: any) {
    console.error('MongoDB 注册错误:', error);
    
    // 处理 MongoDB 特定错误
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const message = field === 'username' ? '用户名已被使用' : '邮箱已被使用';
      res.status(409).json({
        error: '注册失败',
        message,
      });
      return;
    }

    // 处理验证错误
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err: any) => err.message);
      res.status(400).json({
        error: '注册失败',
        message: messages.join(', '),
      });
      return;
    }
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '注册过程中发生错误，请稍后重试',
    });
  }
};

// 用户登录（MongoDB版本）
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
    const user = await UserMongo.findOne({
      $or: [
        { username: usernameOrEmail },
        { email: usernameOrEmail }
      ]
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
      userId: user._id.toString(),
      username: user.username,
    });

    console.log(`✅ 用户登录成功（MongoDB）: ${user.username} (${user._id})`);

    res.status(200).json({
      message: '登录成功',
      user: user.toJSON(),
      tokens,
    });
  } catch (error: any) {
    console.error('MongoDB 登录错误:', error);
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '登录过程中发生错误，请稍后重试',
    });
  }
};

// 刷新访问令牌（MongoDB版本）
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

    // 检查用户是否仍然存在
    const user = await UserMongo.findById(decoded.userId);
    if (!user) {
      res.status(401).json({
        error: '刷新令牌失败',
        message: '用户不存在',
      });
      return;
    }

    // 生成新的令牌对
    const tokens = generateTokenPair({
      userId: user._id.toString(),
      username: user.username,
    });

    res.status(200).json({
      message: '令牌刷新成功',
      tokens,
    });
  } catch (error: any) {
    console.error('MongoDB 刷新令牌错误:', error);
    
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

// 获取当前用户信息（MongoDB版本）
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

    const user = await UserMongo.findById(userId);
    if (!user) {
      res.status(404).json({
        error: '获取用户信息失败',
        message: '用户不存在',
      });
      return;
    }

    res.status(200).json({
      user: user.toJSON(),
    });
  } catch (error: any) {
    console.error('MongoDB 获取用户信息错误:', error);
    
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取用户信息时发生错误',
    });
  }
};
