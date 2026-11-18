import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
    buildDailyRecommendationRefreshOps,
    type RecommendationDailyRefreshOps,
} from '../../services/ops/recommendation/dailyRefreshOps';
import { sendSuccess } from '../../utils/apiResponse';
import { log } from './shared';

const router = Router();

// Space 右侧状态卡片短期缓存（45s TTL + 单飞并发合并），避免每次刷新并发执行 15 条全表统计并脱敏内部异常
const DAILY_REFRESH_STATUS_CACHE_TTL_MS = 45_000;

let cachedStatus: { payload: RecommendationDailyRefreshOps; expiresAt: number } | null = null;
let inFlightLoad: Promise<RecommendationDailyRefreshOps> | null = null;

function sanitizePublicRecommendationStatus(
    raw: RecommendationDailyRefreshOps,
): RecommendationDailyRefreshOps {
    return {
        ...raw,
        latestRun: {
            ...raw.latestRun,
            // 对普通登录用户隐藏内部作业异常详情与敏感堆栈
            error: raw.latestRun.error ? 'refresh_job_degraded' : null,
        },
    };
}

async function loadPublicRecommendationStatusCached(): Promise<RecommendationDailyRefreshOps> {
    const now = Date.now();
    if (cachedStatus && cachedStatus.expiresAt > now) {
        return cachedStatus.payload;
    }

    if (!inFlightLoad) {
        inFlightLoad = (async () => {
            const raw = await buildDailyRecommendationRefreshOps();
            const sanitized = sanitizePublicRecommendationStatus(raw);
            cachedStatus = {
                payload: sanitized,
                expiresAt: Date.now() + DAILY_REFRESH_STATUS_CACHE_TTL_MS,
            };
            return sanitized;
        })().finally(() => {
            inFlightLoad = null;
        });
    }

    return inFlightLoad;
}

export function clearSpaceRecommendationStatusCache(): void {
    cachedStatus = null;
    inFlightLoad = null;
}

router.get('/recommendation/daily-refresh', authenticateToken, async (_req: Request, res: Response) => {
    try {
        return sendSuccess(res, await loadPublicRecommendationStatusCached());
    } catch (error) {
        log.error({ err: error }, '获取推荐闭环状态失败');
        return res.status(500).json({ error: '获取推荐闭环状态失败' });
    }
});

export default router;
