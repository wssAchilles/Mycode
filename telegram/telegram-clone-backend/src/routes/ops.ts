import { Router, Request, Response, NextFunction } from 'express';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';
import { runtimeControlPlane } from '../services/controlPlane/runtimeControlPlane';
import { validateTaskPacket } from '../services/controlPlane/taskPacket';
import { sendSuccess } from '../utils/apiResponse';
import { chatFanoutCommandBus } from '../services/chatDelivery/fanoutCommandBus';

async function readMessageFanoutQueueStats(): Promise<{ available: boolean; stats: Record<string, number> | null }> {
  try {
    const { QUEUE_NAMES, queueService } = await import('../services/queueService');
    const stats = await queueService.getQueueStats(QUEUE_NAMES.MESSAGE_FANOUT);
    return {
      available: true,
      stats,
    };
  } catch {
    return {
      available: false,
      stats: null,
    };
  }
}

const router = Router();

function readBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const value = String(auth).trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function verifyOpsToken(req: Request, res: Response, next: NextFunction): void {
  const expected = String(process.env.OPS_METRICS_TOKEN || '').trim();
  if (!expected) {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'OPS_METRICS_TOKEN 未配置，生产环境下拒绝访问',
        },
      });
      return;
    }
    next();
    return;
  }

  const incoming = String(req.header('x-ops-token') || '').trim() || readBearerToken(req) || '';
  if (incoming !== expected) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'ops token 无效',
      },
    });
    return;
  }
  next();
}

router.get('/chat-runtime', verifyOpsToken, (_req: Request, res: Response) => {
  return sendSuccess(res, chatRuntimeMetrics.snapshot());
});

router.post('/chat-runtime/reset', verifyOpsToken, (_req: Request, res: Response) => {
  chatRuntimeMetrics.reset();
  return sendSuccess(res, {
    reset: true,
    at: new Date().toISOString(),
  });
});

router.get('/control-plane', verifyOpsToken, (_req: Request, res: Response) => {
  return sendSuccess(res, runtimeControlPlane.snapshot());
});

router.get('/control-plane/summary', verifyOpsToken, (_req: Request, res: Response) => {
  return sendSuccess(res, {
    summary: runtimeControlPlane.summary(),
  });
});

router.get('/chat-delivery', verifyOpsToken, async (_req: Request, res: Response) => {
  const queue = await readMessageFanoutQueueStats();

  return sendSuccess(res, {
    snapshot: chatFanoutCommandBus.snapshot(),
    queue,
  });
});

router.post('/control-plane/task-packets/validate', verifyOpsToken, (req: Request, res: Response) => {
  const result = validateTaskPacket(req.body || {});
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
