import { Router } from 'express';
import { getOnlineUsers, getUserStatus, searchUsers } from '../controllers/userController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// 所有用户相关的路由都需要认证
router.use(authenticateToken);

// 获取在线用户列表
router.get('/online', getOnlineUsers);

// 获取用户状态
router.get('/:userId/status', getUserStatus);

// 搜索用户
router.get('/search', searchUsers);

export default router;
