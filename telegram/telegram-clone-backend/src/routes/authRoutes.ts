import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';

// 导入两套认证控制器
import * as authController from '../controllers/authController';
import * as authControllerMongo from '../controllers/authControllerMongo';

// 检查数据库连接状态
let useMongoAuth = false;

// 尝试检测 PostgreSQL 连接状态
try {
  const { sequelize } = require('../config/sequelize');
  sequelize.authenticate().catch(() => {
    console.log('⚠️ PostgreSQL 不可用，切换到 MongoDB 认证');
    useMongoAuth = true;
  });
} catch (error) {
  console.log('⚠️ PostgreSQL 配置错误，使用 MongoDB 认证');
  useMongoAuth = true;
}

// 选择合适的控制器
const auth = useMongoAuth ? authControllerMongo : authController;

const router = Router();

// 用户注册
router.post('/register', auth.register);

// 用户登录  
router.post('/login', auth.login);

// 刷新访问令牌
router.post('/refresh', auth.refreshToken);

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, auth.getCurrentUser);

// 用户登出（可选实现 - 通常在客户端删除令牌即可）
router.post('/logout', authenticateToken, (req, res) => {
  // 在真实应用中，可以将令牌加入黑名单
  // 这里简单返回成功消息
  res.status(200).json({
    message: '登出成功',
  });
});

export default router;
