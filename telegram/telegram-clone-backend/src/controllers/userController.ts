import { Request, Response } from 'express';
import User from '../models/User';
import { redis } from '../config/redis';

// 获取在线用户列表
export const getOnlineUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlineUsersData = await redis.hgetall('online_users');
    const onlineUsers = [];

    for (const [userId, userData] of Object.entries(onlineUsersData)) {
      try {
        const user = JSON.parse(userData);
        onlineUsers.push({
          userId: user.userId,
          username: user.username,
          connectedAt: user.connectedAt,
        });
      } catch (error) {
        console.error('解析在线用户数据失败:', error);
        // 移除损坏的数据
        await redis.hdel('online_users', userId);
      }
    }

    res.status(200).json({
      message: '获取在线用户成功',
      onlineUsers,
      count: onlineUsers.length,
    });
  } catch (error: any) {
    console.error('获取在线用户失败:', error);
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取在线用户列表时发生错误',
    });
  }
};

// 获取用户状态（在线/离线/最后见过时间）
export const getUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        error: '参数错误',
        message: '缺少用户 ID',
      });
      return;
    }

    // 检查用户是否存在
    const user = await User.findByPk(userId);
    if (!user) {
      res.status(404).json({
        error: '用户不存在',
        message: '指定的用户不存在',
      });
      return;
    }

    // 检查是否在线
    const onlineUserData = await redis.hget('online_users', userId);
    
    if (onlineUserData) {
      const onlineUser = JSON.parse(onlineUserData);
      res.status(200).json({
        userId,
        username: user.username,
        status: 'online',
        connectedAt: onlineUser.connectedAt,
      });
    } else {
      // 获取最后见过时间
      const lastSeen = await redis.get(`user:${userId}:last_seen`);
      res.status(200).json({
        userId,
        username: user.username,
        status: 'offline',
        lastSeen: lastSeen || null,
      });
    }
  } catch (error: any) {
    console.error('获取用户状态失败:', error);
    res.status(500).json({
      error: '服务器内部错误',
      message: '获取用户状态时发生错误',
    });
  }
};

// 搜索用户
export const searchUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        error: '参数错误',
        message: '缺少搜索关键词',
      });
      return;
    }

    // 搜索用户名包含关键词的用户
    const users = await User.findAll({
      where: {
        username: {
          [require('sequelize').Op.iLike]: `%${query}%`,
        },
      },
      attributes: ['id', 'username', 'avatarUrl', 'createdAt'],
      limit: 20,
    });

    res.status(200).json({
      message: '搜索用户成功',
      users,
      count: users.length,
    });
  } catch (error: any) {
    console.error('搜索用户失败:', error);
    res.status(500).json({
      error: '服务器内部错误',
      message: '搜索用户时发生错误',
    });
  }
};
