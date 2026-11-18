import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

const ML_BASE_URL =
  process.env.ML_SERVICE_URL ||
  process.env.ML_SERVICE_BASE_URL ||
  'https://telegram-ml-services-22619257282.us-central1.run.app';

const DEFAULT_TIMEOUT_MS = 4500;
const MAX_BATCH_ITEMS = 500;

// 构建保守降级载荷：内容安全端点严格遵循 Fail-Closed，严禁故障时返回 safe: true
const buildFallback = (path: string, body: any): { status: number; payload: Record<string, unknown> } => {
  if (path === '/ann/retrieve') {
    return { status: 200, payload: { candidates: [] } };
  }

  if (path === '/phoenix/predict') {
    return { status: 200, payload: { predictions: [] } };
  }

  if (path === '/vf/check') {
    const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_BATCH_ITEMS) : [];
    return {
      status: 503,
      payload: {
        ok: false,
        safe: false,
        error: 'vf_service_unavailable',
        results: items.map((item: { postId?: string }) => ({
          postId: item?.postId,
          safe: false,
          reason: 'vf_unavailable_fail_closed',
        })),
      },
    };
  }

  if (path === '/vf/check/v2') {
    const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_BATCH_ITEMS) : [];
    return {
      status: 503,
      payload: {
        ok: false,
        safe: false,
        error: 'vf_service_unavailable',
        results: items.map((item: { postId?: string }) => ({
          postId: item?.postId,
          safe: false,
          reason: 'vf_unavailable_fail_closed',
          level: 'blocked',
          score: 1,
          violations: ['vf_service_unavailable'],
          requiresReview: true,
        })),
      },
    };
  }

  return { status: 503, payload: { ok: false } };
};

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

function buildMlInternalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const mlInternalToken = String(process.env.ML_INTERNAL_TOKEN || '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (mlInternalToken) {
    headers['x-ml-internal-token'] = mlInternalToken;
  }
  if (cronSecret) {
    headers['x-cron-secret'] = cronSecret;
  }
  return headers;
}

const forward = async (req: Request, res: Response, path: string) => {
  const candidates = req.body?.candidates;
  const items = req.body?.items;
  if (
    (Array.isArray(candidates) && candidates.length > MAX_BATCH_ITEMS)
    || (Array.isArray(items) && items.length > MAX_BATCH_ITEMS)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: `批量条目数量不能超过 ${MAX_BATCH_ITEMS}`,
      },
    });
  }

  try {
    const response = await axios.post(`${ML_BASE_URL}${path}`, req.body, {
      timeout: DEFAULT_TIMEOUT_MS,
      headers: buildMlInternalHeaders(),
    });
    return res.status(response.status).json(response.data);
  } catch {
    const fallback = buildFallback(path, req.body);
    res.setHeader('X-ML-Fallback', 'true');
    return res.status(fallback.status).json(fallback.payload);
  }
};

router.post('/ann/retrieve', (req, res) => forward(req, res, '/ann/retrieve'));
router.post('/phoenix/predict', (req, res) => forward(req, res, '/phoenix/predict'));
router.post('/vf/check', (req, res) => forward(req, res, '/vf/check'));
router.post('/vf/check/v2', (req, res) => forward(req, res, '/vf/check/v2'));

export default router;
