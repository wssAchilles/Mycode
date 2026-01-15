import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../utils/jwt';
import User from '../models/User';

// 扩展 Express Request 接口
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email?: string;
        avatarUrl?: string;
      };
      userId?: string;
    }
  }
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
      res.status(401).json({
        error: '访问被拒绝',
        message: '缺少访问令牌',
      });
      return;
    }

    // 验证 token
    const decoded: JWTPayload = await verifyAccessToken(token);
    
    // 从数据库中获取用户信息（确保用户仍然存在）
    const user = await User.findByPk(decoded.userId);
    
    if (!user) {
      res.status(401).json({
        error: '访问被拒绝',
        message: '用户不存在',
      });
      return;
    }

    // 将用户信息添加到请求对象
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
    };
    req.userId = user.id;

    next();
  } catch (error: any) {
    console.error('认证中间件错误:', error);
    
    let message = '无效的访问令牌';
    if (error.name === 'TokenExpiredError') {
      message = '访问令牌已过期';
    } else if (error.name === 'JsonWebTokenError') {
      message = '无效的访问令牌格式';
    }

    res.status(401).json({
      error: '认证失败',
      message,
    });
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
    const user = await User.findByPk(decoded.userId);
    
    if (user) {
      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
      };
      req.userId = user.id;
    }

    next();
  } catch (error) {
    // 认证失败，但不阻止请求继续
    console.warn('可选认证失败:', error);
    next();
  }
};
