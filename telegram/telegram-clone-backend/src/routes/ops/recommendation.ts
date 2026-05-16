import { Router, Request, Response } from 'express';
import { buildRecommendationOps } from '../../services/ops/recommendation/buildRecommendationOps';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/recommendation', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildRecommendationOps(_req.query as Record<string, unknown>));
});

export default router;
