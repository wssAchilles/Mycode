import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

const ML_BASE_URL =
  process.env.ML_SERVICE_URL ||
  process.env.ML_SERVICE_BASE_URL ||
  'https://telegram-ml-services-22619257282.us-central1.run.app';

const DEFAULT_TIMEOUT_MS = 4500;

const buildFallback = (path: string, body: any) => {
  if (path === '/ann/retrieve') {
    return { candidates: [] };
  }

  if (path === '/phoenix/predict') {
    return { predictions: [] };
  }

  if (path === '/vf/check') {
    const items = Array.isArray(body?.items) ? body.items : [];
    return {
      results: items.map((item: { postId?: string }) => ({
        postId: item?.postId,
        safe: true,
        reason: 'fallback',
      })),
    };
  }

  return { ok: false };
};

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const forward = async (req: Request, res: Response, path: string) => {
  try {
    const response = await axios.post(`${ML_BASE_URL}${path}`, req.body, {
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    const payload = buildFallback(path, req.body);
    res.setHeader('X-ML-Fallback', 'true');
    return res.status(200).json(payload);
  }
};

router.post('/ann/retrieve', (req, res) => forward(req, res, '/ann/retrieve'));
router.post('/phoenix/predict', (req, res) => forward(req, res, '/phoenix/predict'));
router.post('/vf/check', (req, res) => forward(req, res, '/vf/check'));

export default router;
