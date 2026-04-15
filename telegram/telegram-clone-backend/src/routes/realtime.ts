import { Router, Request, Response } from 'express';

import { authenticateToken } from '../middleware/authMiddleware';
import { sendSuccess } from '../utils/apiResponse';
import {
  REALTIME_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_WATERMARK_FIELD,
} from '../services/realtimeProtocol/contracts';
import {
  buildRealtimeBootstrapPayload,
  buildRealtimeHealthPayload,
} from '../services/realtimeProtocol/bootstrapService';

const router = Router();

function setRealtimeHeaders(res: Response): void {
  res.set('X-Realtime-Protocol-Version', String(REALTIME_PROTOCOL_VERSION));
  res.set('X-Realtime-Sync-Protocol-Version', String(SYNC_PROTOCOL_VERSION));
  res.set('X-Realtime-Sync-Watermark-Field', SYNC_WATERMARK_FIELD);
  res.set('Cache-Control', 'no-store');
}

router.get('/health', async (_req: Request, res: Response) => {
  setRealtimeHeaders(res);
  return sendSuccess(res, await buildRealtimeHealthPayload());
});

router.get('/bootstrap', authenticateToken, async (req: Request, res: Response) => {
  const userId = String(req.userId || req.user?.id || '').trim();
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'realtime bootstrap 需要有效用户上下文',
      },
    });
  }

  setRealtimeHeaders(res);
  return sendSuccess(res, await buildRealtimeBootstrapPayload(userId));
});

export default router;
