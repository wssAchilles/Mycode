import { Router, Request, Response } from 'express';
import { getOnlineUsers, getUserStatus, searchUsers } from '../controllers/userController';
import { authenticateToken } from '../middleware/authMiddleware';
import User from '../models/User';
import UserMongo from '../models/UserMongo';

// 安全格式化日期（兼容 Date 对象和字符串）
function formatDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.split('T')[0];
  return null;
}

const router = Router();

// 所有用户相关的路由都需要认证
router.use(authenticateToken);

// 更新用户资料（demographics）
router.put('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: '未认证' });
      return;
    }

    const { birthDate, region, language } = req.body;

    // 校验 birthDate
    if (birthDate !== undefined && birthDate !== null) {
      const date = new Date(birthDate);
      if (isNaN(date.getTime())) {
        res.status(400).json({ error: '无效的出生日期格式' });
        return;
      }
      const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 13) {
        res.status(400).json({ error: '年龄必须大于等于13岁' });
        return;
      }
      if (age > 150) {
        res.status(400).json({ error: '无效的出生日期' });
        return;
      }
    }

    // 校验 region (ISO 3166-1 alpha-2)
    if (region !== undefined && region !== null && region !== '') {
      if (!/^[A-Z]{2}$/.test(region)) {
        res.status(400).json({ error: '地区必须为 ISO 3166-1 alpha-2 格式（如 CN、US）' });
        return;
      }
    }

    // 校验 language (ISO 639-1)
    if (language !== undefined && language !== null && language !== '') {
      if (!/^[a-z]{2}$/.test(language)) {
        res.status(400).json({ error: '语言必须为 ISO 639-1 格式（如 zh、en）' });
        return;
      }
    }

    // 构建更新数据
    const updateData: Record<string, any> = {};
    if (birthDate !== undefined) updateData.birthDate = birthDate || null;
    if (region !== undefined) updateData.region = region || null;
    if (language !== undefined) updateData.language = language || null;

    // 更新 PostgreSQL
    let pgUpdated = false;
    try {
      const [affectedRows] = await User.update(updateData, { where: { id: userId } });
      pgUpdated = affectedRows > 0;
    } catch (pgError) {
      console.warn('PostgreSQL 更新用户资料失败，尝试 MongoDB:', pgError);
    }

    // 更新 MongoDB（双写）
    let mongoUpdated = false;
    try {
      const mongoResult = await UserMongo.findByIdAndUpdate(userId, { $set: updateData }, { new: true });
      mongoUpdated = !!mongoResult;
    } catch (mongoError) {
      console.warn('MongoDB 更新用户资料失败:', mongoError);
    }

    if (!pgUpdated && !mongoUpdated) {
      res.status(404).json({ error: '用户不存在或更新失败' });
      return;
    }

    // 返回更新后的用户信息
    let updatedUser: any;
    try {
      updatedUser = await User.findByPk(userId);
    } catch {
      try {
        updatedUser = await UserMongo.findById(userId);
      } catch {
        // ignore
      }
    }

    res.status(200).json({
      message: '资料更新成功',
      user: updatedUser ? {
        id: updatedUser.id || updatedUser._id?.toString(),
        username: updatedUser.username,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatarUrl,
        birthDate: formatDate(updatedUser.birthDate),
        region: updatedUser.region,
        language: updatedUser.language,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      } : updateData,
    });
  } catch (error: any) {
    console.error('更新用户资料错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取在线用户列表
router.get('/online', getOnlineUsers);

// 获取用户状态
router.get('/:userId/status', getUserStatus);

// 搜索用户
router.get('/search', searchUsers);

export default router;
