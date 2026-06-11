import { Router, Request, Response } from 'express';
import { buildRecommendationOps } from '../../services/ops/recommendation/buildRecommendationOps';
import { buildDailyRecommendationRefreshOps } from '../../services/ops/recommendation/dailyRefreshOps';
import { readOptionalInt } from '../../services/ops/shared/queryParsing';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/recommendation', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildRecommendationOps(_req.query as Record<string, unknown>));
});

router.get('/recommendation/daily-refresh', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, await buildDailyRecommendationRefreshOps({
    hours: readOptionalInt(req.query.hours),
  }));
});

export default router;
