import { Router, Request, Response } from 'express';
import {
  buildCapabilitiesOps,
  buildControlPlaneOps,
  buildControlPlaneSummaryOps,
  validateTaskPacketOps,
} from '../../services/ops/controlPlane/buildControlPlaneOps';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/capabilities', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildCapabilitiesOps());
});

router.get('/control-plane', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildControlPlaneOps());
});

router.get('/control-plane/summary', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildControlPlaneSummaryOps());
});

router.post('/control-plane/task-packets/validate', verifyOpsToken, (req: Request, res: Response) => {
  const result = validateTaskPacketOps(req.body || {});
  if (!result.ok) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'task packet 校验失败',
        details: result.errors,
      },
    });
  }

  return sendSuccess(res, result.packet);
});

export default router;
