/**
 * 推送通知路由
 * - POST /api/push/subscribe — 保存推送订阅
 * - POST /api/push/unsubscribe — 删除推送订阅
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('routes:push');
const router = Router();

// 内存存储（生产环境应使用数据库）
const subscriptions = new Map<string, { endpoint: string; keys: { p256dh: string; auth: string }; userId: string }>();

/**
 * POST /api/push/subscribe
 * 保存推送订阅
 */
router.post('/subscribe', authenticateToken, (req: Request, res: Response) => {
  const { endpoint, keys } = req.body;
  const userId = (req as any).user?.id;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_SUBSCRIPTION', message: '缺少必要的订阅参数' },
    });
  }

  subscriptions.set(endpoint, { endpoint, keys, userId });
  log.info({ userId, endpoint: endpoint.substring(0, 50) }, '推送订阅已保存');

  res.json({ success: true, message: '订阅已保存' });
});

/**
 * POST /api/push/unsubscribe
 * 删除推送订阅
 */
router.post('/unsubscribe', authenticateToken, (req: Request, res: Response) => {
  const { endpoint } = req.body;

  if (!endpoint) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: '缺少 endpoint 参数' },
    });
  }

  subscriptions.delete(endpoint);
  log.info({ endpoint: endpoint.substring(0, 50) }, '推送订阅已删除');

  res.json({ success: true, message: '订阅已删除' });
});

/**
 * GET /api/push/status
 * 获取推送服务状态
 */
router.get('/status', authenticateToken, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      supported: true,
      subscriptionCount: subscriptions.size,
    },
  });
});

export default router;
