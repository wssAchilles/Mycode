import { Router, type NextFunction, type Request, type Response } from 'express';
import { ErrorCode, sendError, sendSuccess } from '../utils/apiResponse';
import {
  GraphKernelSnapshotVersionMismatchError,
  graphKernelSnapshotService,
} from '../services/graphKernel/snapshotService';
import {
  generationPageRequestSchema,
  generationReleaseRequestSchema,
} from '../services/graphKernel/generation/contracts';
import {
  GenerationLeaseError,
  GenerationUnavailableError,
  graphKernelGenerationService,
} from '../services/graphKernel/generation/service';

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
  try {
    const page = await graphKernelSnapshotService.getSnapshotPage({
      offset: Number.parseInt(String(req.body?.offset ?? 0), 10) || 0,
      limit: Number.parseInt(String(req.body?.limit ?? 1000), 10) || 1000,
      minScore: Number(req.body?.minScore ?? 0.05),
      afterSourceUserId: req.body?.afterSourceUserId,
      afterTargetUserId: req.body?.afterTargetUserId,
      afterId: req.body?.afterId,
      snapshotVersion: req.body?.snapshotVersion,
    });

    return sendSuccess(res, page);
  } catch (error) {
    if (error instanceof GraphKernelSnapshotVersionMismatchError) {
      return sendError(
        res,
        ErrorCode.CONFLICT,
        'graph snapshot version changed during pagination',
        {
          expectedSnapshotVersion: error.expectedSnapshotVersion,
          actualSnapshotVersion: error.actualSnapshotVersion,
        },
      );
    }
    if (error instanceof Error && error.message === 'invalid_graph_snapshot_cursor') {
      return sendError(res, ErrorCode.BAD_REQUEST, 'invalid graph snapshot cursor');
    }
    throw error;
  }
});

router.post('/snapshot/generation/page', async (req, res) => {
  const parsed = generationPageRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendError(
      res,
      ErrorCode.VALIDATION_ERROR,
      'invalid graph generation page request',
      parsed.error.issues,
    );
  }

  try {
    return sendSuccess(res, await graphKernelGenerationService.pageGeneration(parsed.data));
  } catch (error) {
    if (error instanceof GenerationLeaseError) {
      return sendError(res, ErrorCode.CONFLICT, error.message);
    }
    if (error instanceof GenerationUnavailableError) {
      return sendError(res, ErrorCode.SERVICE_UNAVAILABLE, error.message);
    }
    throw error;
  }
});

router.post('/snapshot/generation/release', async (req, res) => {
  const parsed = generationReleaseRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendError(
      res,
      ErrorCode.VALIDATION_ERROR,
      'invalid graph generation release request',
      parsed.error.issues,
    );
  }

  try {
    await graphKernelGenerationService.releaseGenerationLease(
      parsed.data.generationId,
      parsed.data.leaseId,
    );
    return sendSuccess(res, { ...parsed.data, released: true });
  } catch (error) {
    if (error instanceof GenerationLeaseError) {
      return sendError(res, ErrorCode.CONFLICT, error.message);
    }
    throw error;
  }
});

export default router;
