import { Router, Request, Response, NextFunction } from 'express';
import { chatRuntimeMetrics } from '../services/chatRuntimeMetrics';
import { runtimeControlPlane } from '../services/controlPlane/runtimeControlPlane';
import { validateTaskPacket } from '../services/controlPlane/taskPacket';
import { sendSuccess } from '../utils/apiResponse';
import { chatFanoutCommandBus } from '../services/chatDelivery/fanoutCommandBus';
import { chatDeliveryEventPublisher } from '../services/chatDelivery/eventPublisher';
import { createChatDeliveryReplayService } from '../services/chatDelivery/replayService';
import { createChatDeliveryPrimaryFallbackService } from '../services/chatDelivery/primaryFallbackService';
import { getChatDeliveryExecutionPolicySummary } from '../services/chatDelivery/executionPolicy';
import { readDeliveryConsumerOpsSummary } from '../services/chatDelivery/deliveryConsumerOps';
import { readDeliveryCanaryStreamSummary } from '../services/chatDelivery/deliveryCanaryOps';
import { chatDeliveryConsistencyService } from '../services/chatDelivery/chatDeliveryConsistencyService';
import { assessChatDeliveryRollout } from '../services/chatDelivery/rolloutAssessment';
import { REALTIME_PROTOCOL_VERSION, buildRealtimeTransportCatalog } from '../services/realtimeProtocol/contracts';
import { realtimeOps } from '../services/realtimeProtocol/realtimeOps';
import { realtimeSessionRegistry } from '../services/realtimeProtocol/realtimeSessionRegistry';
import { realtimeEventPublisher } from '../services/realtimeProtocol/realtimeEventPublisher';

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

function readChatType(value: unknown): 'private' | 'group' | undefined {
  return value === 'private' || value === 'group' ? value : undefined;
}

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
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  const [queue, eventBus, consumer, canary, consistency, fallback] = await Promise.all([
    readMessageFanoutQueueStats(),
    chatDeliveryEventPublisher.buildSummary(),
    readDeliveryConsumerOpsSummary(),
    readDeliveryCanaryStreamSummary(),
    chatDeliveryConsistencyService.buildSummary(),
    fallbackService.buildSummary(),
  ]);
  const rollout = getChatDeliveryExecutionPolicySummary();
  const policy = assessChatDeliveryRollout({
    rollout,
    consumer,
    canary,
    consistency,
    fallback,
  });

  return sendSuccess(res, {
    snapshot: await chatFanoutCommandBus.buildOpsSnapshot(),
    queue,
    eventBus,
    rollout,
    consumer,
    canary,
    consistency,
    fallback,
    policy,
  });
});

router.get('/chat-delivery/consistency', verifyOpsToken, async (req: Request, res: Response) => {
  const consistency = await chatDeliveryConsistencyService.buildSummary({
    limit: Number.parseInt(String(req.query.limit || ''), 10) || undefined,
    staleAfterMinutes: Number.parseInt(String(req.query.staleAfterMinutes || ''), 10) || undefined,
  });

  return sendSuccess(res, {
    consistency,
  });
});

router.post('/chat-delivery/consistency/repair', verifyOpsToken, async (req: Request, res: Response) => {
  const consistency = await chatDeliveryConsistencyService.repair({
    limit: Number.parseInt(String(req.body?.limit || ''), 10) || undefined,
    staleAfterMinutes: Number.parseInt(String(req.body?.staleAfterMinutes || ''), 10) || undefined,
  });

  return sendSuccess(res, {
    consistency,
  });
});

router.post('/chat-delivery/replay', verifyOpsToken, async (req: Request, res: Response) => {
  const replayService = await createChatDeliveryReplayService();
  const result = await replayService.replayFailedDeliveries({
    limit: Number.parseInt(String(req.body?.limit || ''), 10) || undefined,
    staleAfterMinutes: Number.parseInt(String(req.body?.staleAfterMinutes || ''), 10) || undefined,
  });

  return sendSuccess(res, {
    replay: result,
  });
});

router.get('/chat-delivery/fallback', verifyOpsToken, async (req: Request, res: Response) => {
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  const fallback = await fallbackService.buildSummary({
    limit: Number.parseInt(String(req.query.limit || ''), 10) || undefined,
    staleAfterMinutes: Number.parseInt(String(req.query.staleAfterMinutes || ''), 10) || undefined,
    chatType: readChatType(req.query.chatType),
  });

  return sendSuccess(res, {
    fallback,
  });
});

router.post('/chat-delivery/fallback/replay', verifyOpsToken, async (req: Request, res: Response) => {
  const fallbackService = await createChatDeliveryPrimaryFallbackService();
  const fallback = await fallbackService.replayPrimaryFallbacks({
    limit: Number.parseInt(String(req.body?.limit || ''), 10) || undefined,
    staleAfterMinutes: Number.parseInt(String(req.body?.staleAfterMinutes || ''), 10) || undefined,
    chatType: readChatType(req.body?.chatType),
  });

  return sendSuccess(res, {
    fallback,
  });
});

router.get('/realtime', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    transport: buildRealtimeTransportCatalog(),
    registry: realtimeSessionRegistry.snapshot(),
    ops: realtimeOps.snapshot(),
    eventBus: await realtimeEventPublisher.buildSummary(),
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
