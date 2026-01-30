/**
 * Sync Routes - 消息同步 API
 * 实现 getDifference 等消息同步接口
 */
import { Router, Request, Response, NextFunction } from 'express';
import { updateService } from '../services/updateService';
import Message from '../models/Message';
import { sendSuccess, errors } from '../utils/apiResponse';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// 所有同步路由需要认证
router.use(authenticateToken);

/**
 * GET /api/sync/state
 * 获取当前用户的同步状态
 */
router.get('/state', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const updateId = await updateService.getUpdateId(userId);

        return sendSuccess(res, {
            pts: updateId,
            updateId,
            date: Math.floor(Date.now() / 1000),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/sync/difference
 * 获取缺失的消息 (Gap Recovery)
 */
router.post('/difference', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { pts, limit = 100 } = req.body;

        if (typeof pts !== 'number') {
            return errors.badRequest(res, '缺少 pts 参数');
        }

        // 获取服务端当前 updateId
        const serverPts = await updateService.getUpdateId(userId);

        if (pts >= serverPts) {
            // 客户端已是最新状态
            return sendSuccess(res, {
                updates: [],
                messages: [],
                state: { pts: serverPts, updateId: serverPts, date: Math.floor(Date.now() / 1000) },
                isLatest: true,
            });
        }

        const { updates, lastUpdateId } = await updateService.getUpdates(userId, pts, limit);
        const messageIds = updates.filter((u: any) => u.messageId).map((u: any) => u.messageId);
        const messages = messageIds.length
            ? await Message.find({ _id: { $in: messageIds } }).lean()
            : [];

        return sendSuccess(res, {
            updates,
            messages,
            state: {
                pts: lastUpdateId,
                updateId: lastUpdateId,
                date: Math.floor(Date.now() / 1000),
            },
            isLatest: lastUpdateId >= serverPts,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/sync/ack
 * 确认收到消息 (更新客户端 PTS)
 */
router.post('/ack', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { pts } = req.body;

        if (typeof pts !== 'number') {
            return errors.badRequest(res, '缺少 pts 参数');
        }

        // 记录客户端确认的 PTS (可用于离线消息推送优化)
        // 这里可以存储到 Redis 或数据库中
        // await redis.set(`ack:${userId}`, pts);

        return sendSuccess(res, {
            acknowledged: true,
            pts,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/sync/updates
 * 长轮询获取更新 (备用方案，WebSocket 不可用时使用)
 */
router.get('/updates', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const clientPts = parseInt(req.query.pts as string, 10) || 0;
        const timeout = Math.min(parseInt(req.query.timeout as string, 10) || 30000, 60000);

        const serverPts = await updateService.getUpdateId(userId);

        // 如果有新消息，立即返回
        if (serverPts > clientPts) {
            const { updates, lastUpdateId } = await updateService.getUpdates(userId, clientPts, Math.min(serverPts - clientPts, 100));
            const messageIds = updates.filter((u: any) => u.messageId).map((u: any) => u.messageId);
            const messages = messageIds.length
                ? await Message.find({ _id: { $in: messageIds } }).lean()
                : [];

            return sendSuccess(res, {
                updates,
                messages,
                state: { pts: lastUpdateId, updateId: lastUpdateId },
            });
        }

        // 否则等待新消息 (简化实现，生产环境应使用更高效的机制)
        // 这里使用简单的延迟返回
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 5000)));

        const newPts = await updateService.getUpdateId(userId);

        return sendSuccess(res, {
            updates: [],
            state: { pts: newPts, updateId: newPts },
        });
    } catch (err) {
        next(err);
    }
});

export default router;
