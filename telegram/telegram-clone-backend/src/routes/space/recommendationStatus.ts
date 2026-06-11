import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import { buildDailyRecommendationRefreshOps } from '../../services/ops/recommendation/dailyRefreshOps';
import { sendSuccess } from '../../utils/apiResponse';
import { log } from './shared';

const router = Router();

router.get('/recommendation/daily-refresh', authenticateToken, async (_req: Request, res: Response) => {
    try {
        return sendSuccess(res, await buildDailyRecommendationRefreshOps());
    } catch (error) {
        log.error({ err: error }, '获取推荐闭环状态失败');
        return res.status(500).json({ error: '获取推荐闭环状态失败' });
    }
});

export default router;
