import { Router, Request, Response } from 'express';
import { buildRealtimeOps } from '../../services/ops/realtime/buildRealtimeOps';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/realtime', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildRealtimeOps());
});

export default router;
