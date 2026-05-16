import { Router, Request, Response } from 'express';
import { buildPlatformBusOps } from '../../services/ops/platformBus/buildPlatformBusOps';
import { buildPlatformProbeOps } from '../../services/ops/platformBus/buildPlatformProbeOps';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/platform-bus', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildPlatformBusOps());
});

router.get('/platform-bus/probe', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildPlatformProbeOps());
});

export default router;
