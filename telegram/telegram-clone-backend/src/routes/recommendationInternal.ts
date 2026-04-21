import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../utils/apiResponse';
import {
  deserializeRecommendationCandidates,
  deserializeRecommendationQuery,
  recommendationCandidatePayloadSchema,
  recommendationQueryPayloadSchema,
  serializeRecommendationCandidates,
  serializeRecommendationQuery,
  serializeRecommendationQueryPatch,
} from '../services/recommendation/rust/contracts';
import { graphAuthorMaterializationRequestSchema } from '../services/recommendation/rust/graphProviderContracts';
import { materializeGraphAuthorPostsWithDiagnostics } from '../services/recommendation/providers/graphKernel/authorPostMaterializer';
import { selfPostRescueRequestSchema } from '../services/recommendation/providers/selfPostRescue/contracts';
import { materializeSelfPosts } from '../services/recommendation/providers/selfPostRescue/materializeSelfPosts';
import { recommendationAdapterService } from '../services/recommendation/internal/adapterService';

const router = Router();

function readBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const value = String(auth).trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function verifyRecommendationInternalToken(req: Request, res: Response, next: NextFunction): void {
  const expected = String(process.env.RECOMMENDATION_INTERNAL_TOKEN || '').trim();
  if (!expected) {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.status(503).json({
        success: false,
        error: {
          code: 'INTERNAL_RECOMMENDATION_TOKEN_MISSING',
          message: 'RECOMMENDATION_INTERNAL_TOKEN 未配置',
        },
      });
      return;
    }

    next();
    return;
  }

  const incoming =
    String(req.header('x-recommendation-internal-token') || '').trim() ||
    readBearerToken(req) ||
    '';

  if (incoming !== expected) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'internal recommendation token 无效',
      },
    });
    return;
  }

  next();
}

const candidateStageRequestSchema = z.object({
  query: recommendationQueryPayloadSchema,
  candidates: z.array(recommendationCandidatePayloadSchema),
});

const queryHydratorBatchRequestSchema = z.object({
  hydratorNames: z.array(z.string().min(1)).min(1).max(16),
  query: recommendationQueryPayloadSchema,
});

const sourceBatchRequestSchema = z.object({
  sourceNames: z.array(z.string().min(1)).min(1).max(16),
  query: recommendationQueryPayloadSchema,
});

router.use(verifyRecommendationInternalToken);

router.get('/health', (_req, res) => {
  return sendSuccess(res, {
    ok: true,
    service: 'backend_recommendation_adapter',
  });
});

router.post('/query', async (req, res) => {
  const parsed = recommendationQueryPayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation query payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const { query, stages } = await recommendationAdapterService.hydrateQuery(
    deserializeRecommendationQuery(parsed.data),
  );

  return sendSuccess(res, {
    query: serializeRecommendationQuery(query),
    stages,
  });
});

router.post('/query-hydrators/batch', async (req, res) => {
  const parsed = queryHydratorBatchRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation query hydrator batch payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  try {
    const result = await recommendationAdapterService.hydrateQueryPatches(
      parsed.data.hydratorNames,
      deserializeRecommendationQuery(parsed.data.query),
    );
    return sendSuccess(res, {
      items: result.items.map((item) => ({
        hydratorName: item.hydratorName,
        queryPatch: serializeRecommendationQueryPatch(item.queryPatch),
        stage: item.stage,
        providerCalls: item.providerCalls,
        errorClass: item.errorClass,
      })),
      providerCalls: result.providerCalls,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'UNKNOWN_QUERY_HYDRATOR',
        message: error?.message || 'unknown_query_hydrator',
      },
    });
  }
});

router.post('/query-hydrators/:hydratorName', async (req, res) => {
  const parsed = recommendationQueryPayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation query hydrator payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const hydratorName = String(req.params.hydratorName || '').trim();
  try {
    const result = await recommendationAdapterService.hydrateQueryPatch(
      hydratorName,
      deserializeRecommendationQuery(parsed.data),
    );
    return sendSuccess(res, {
      hydratorName,
      queryPatch: serializeRecommendationQueryPatch(result.queryPatch),
      stage: result.stage,
      errorClass: result.errorClass,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'UNKNOWN_QUERY_HYDRATOR',
        message: error?.message || 'unknown_query_hydrator',
      },
    });
  }
});

router.post('/retrieval', async (req, res) => {
  const parsed = recommendationQueryPayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation retrieval payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.retrieveCandidates(
    deserializeRecommendationQuery(parsed.data),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    stages: result.stages,
    summary: result.summary,
  });
});

router.post('/sources/batch', async (req, res) => {
  const parsed = sourceBatchRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation source batch payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  try {
    const result = await recommendationAdapterService.getSourceCandidatesBatch(
      parsed.data.sourceNames,
      deserializeRecommendationQuery(parsed.data.query),
    );
    return sendSuccess(res, {
      items: result.items.map((item) => ({
        sourceName: item.sourceName,
        candidates: serializeRecommendationCandidates(item.candidates),
        stage: item.stage,
        timedOut: item.timedOut,
        timeoutMs: item.timeoutMs,
        errorClass: item.errorClass,
      })),
      providerCalls: result.providerCalls,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'UNKNOWN_SOURCE',
        message: error?.message || 'unknown_source',
      },
    });
  }
});

router.post('/sources/:sourceName', async (req, res) => {
  const parsed = recommendationQueryPayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation source payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const sourceName = String(req.params.sourceName || '').trim();
  try {
    const result = await recommendationAdapterService.getSourceCandidates(
      sourceName,
      deserializeRecommendationQuery(parsed.data),
    );
    return sendSuccess(res, {
      sourceName,
      candidates: serializeRecommendationCandidates(result.candidates),
      stage: result.stage,
      timedOut: result.timedOut,
      timeoutMs: result.timeoutMs,
      errorClass: result.errorClass,
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'UNKNOWN_SOURCE',
        message: error?.message || 'unknown_source',
      },
    });
  }
});

router.post('/providers/graph/authors', async (req, res) => {
  const parsed = graphAuthorMaterializationRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'graph author materialization payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await materializeGraphAuthorPostsWithDiagnostics(parsed.data);

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    diagnostics: result.diagnostics,
  });
});

router.post('/providers/self-posts', async (req, res) => {
  const parsed = selfPostRescueRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'self post rescue payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const candidates = await materializeSelfPosts(parsed.data);

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(candidates),
  });
});

router.post('/hydrate', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation hydrate payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.hydrateCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    stages: result.stages,
  });
});

router.post('/filter', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation filter payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.filterCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    removed: serializeRecommendationCandidates(result.removed),
    dropCounts: result.dropCounts,
    stages: result.stages,
  });
});

router.post('/score', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation score payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.scoreCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    stages: result.stages,
  });
});

router.post('/ranking', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation ranking payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.rankCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    stages: result.stages,
    dropCounts: result.dropCounts,
    summary: result.summary,
  });
});

router.post('/post-selection/hydrate', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation post-selection hydrate payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.hydratePostSelectionCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    stages: result.stages,
  });
});

router.post('/post-selection/filter', async (req, res) => {
  const parsed = candidateStageRequestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'recommendation post-selection filter payload 校验失败',
        details: parsed.error.issues,
      },
    });
  }

  const result = await recommendationAdapterService.filterPostSelectionCandidates(
    deserializeRecommendationQuery(parsed.data.query),
    deserializeRecommendationCandidates(parsed.data.candidates),
  );

  return sendSuccess(res, {
    candidates: serializeRecommendationCandidates(result.candidates),
    removed: serializeRecommendationCandidates(result.removed),
    dropCounts: result.dropCounts,
    stages: result.stages,
  });
});

export default router;
