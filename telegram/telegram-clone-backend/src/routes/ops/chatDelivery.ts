import { Router, Request, Response } from 'express';
import { buildChatDeliveryOps } from '../../services/ops/chatDelivery/buildChatDeliveryOps';
import {
  buildChatDeliveryConsistencyOps,
  buildChatDeliveryFallbackOps,
  repairChatDeliveryConsistency,
  replayChatDeliveryFailures,
  replayChatDeliveryFallbacks,
} from '../../services/ops/chatDelivery/chatDeliveryCommands';
import { buildChatRuntimeOps, resetChatRuntimeOps } from '../../services/ops/chatDelivery/buildChatRuntimeOps';
import { sendSuccess } from '../../utils/apiResponse';
import { verifyOpsToken } from './auth';

const router = Router();

router.get('/chat-runtime', verifyOpsToken, (_req: Request, res: Response) => {
  return sendSuccess(res, buildChatRuntimeOps());
});

router.post('/chat-runtime/reset', verifyOpsToken, (_req: Request, res: Response) => {
  return sendSuccess(res, resetChatRuntimeOps());
});

router.get('/chat-delivery', verifyOpsToken, async (_req: Request, res: Response) => {
  return sendSuccess(res, await buildChatDeliveryOps());
});

router.get('/chat-delivery/consistency', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, {
    consistency: await buildChatDeliveryConsistencyOps(req.query as Record<string, unknown>),
  });
});

router.post('/chat-delivery/consistency/repair', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, {
    consistency: await repairChatDeliveryConsistency(req.body || {}),
  });
});

router.post('/chat-delivery/replay', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, {
    replay: await replayChatDeliveryFailures(req.body || {}),
  });
});

router.get('/chat-delivery/fallback', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, {
    fallback: await buildChatDeliveryFallbackOps(req.query as Record<string, unknown>),
  });
});

router.post('/chat-delivery/fallback/replay', verifyOpsToken, async (req: Request, res: Response) => {
  return sendSuccess(res, {
    fallback: await replayChatDeliveryFallbacks(req.body || {}),
  });
});

export default router;
