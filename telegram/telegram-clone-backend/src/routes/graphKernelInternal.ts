import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendSuccess } from '../utils/apiResponse';
import { graphKernelSnapshotService } from '../services/graphKernel/snapshotService';

const router = Router();

function readBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const value = String(auth).trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function verifyGraphKernelInternalToken(req: Request, res: Response, next: NextFunction): void {
  const expected = String(
    process.env.GRAPH_KERNEL_INTERNAL_TOKEN || process.env.RECOMMENDATION_INTERNAL_TOKEN || '',
  ).trim();

  if (!expected) {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.status(503).json({
        success: false,
        error: {
          code: 'GRAPH_KERNEL_INTERNAL_TOKEN_MISSING',
          message: 'GRAPH_KERNEL_INTERNAL_TOKEN 未配置',
        },
      });
      return;
    }

    next();
    return;
  }

  const incoming =
    String(req.header('x-graph-kernel-internal-token') || '').trim() ||
    String(req.header('x-recommendation-internal-token') || '').trim() ||
    readBearerToken(req) ||
    '';

  if (incoming !== expected) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'graph kernel internal token 无效',
      },
    });
    return;
  }

  next();
}

router.use(verifyGraphKernelInternalToken);

router.get('/health', (_req, res) => {
  return sendSuccess(res, {
    ok: true,
    service: 'backend_graph_kernel_snapshot',
  });
});

router.post('/snapshot', async (req, res) => {
  const page = await graphKernelSnapshotService.getSnapshotPage({
    offset: Number.parseInt(String(req.body?.offset ?? 0), 10) || 0,
    limit: Number.parseInt(String(req.body?.limit ?? 1000), 10) || 1000,
    minScore: Number(req.body?.minScore ?? 0.05),
  });

  return sendSuccess(res, page);
});

export default router;
