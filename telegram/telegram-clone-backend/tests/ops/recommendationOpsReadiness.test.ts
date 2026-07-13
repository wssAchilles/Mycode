import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
}));

vi.mock('../../src/models/RecommendationTrace', () => ({
  default: {
    find: mocks.find,
  },
}));

import { buildRecommendationOpsSummary } from '../../src/services/ops/recommendation/buildRecommendationOps';
import { buildRecommendationTraceSummary } from '../../src/services/recommendation/ops';

describe('recommendation ops readiness', () => {
  beforeEach(() => {
    mocks.find.mockReset();
  });

  it('surfaces rollout blockers for Rust primary, graph diagnostics, replay readiness, and embedding contracts', () => {
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0.12,
      graphKernelMissingDiagnosticsRate: 0.05,
      replayLoggingReadiness: {
        totalRequests: 10,
        requestsMissingRank: 0,
        requestsMissingRecallSource: 2,
        requestsMissingScore: 0,
        requestsMissingExperimentKeys: 0,
        requestsMissingFeedbackJoinKey: 0,
      },
      embeddingContractIncompatibleCount: 1,
    });

    expect(summary.blockers).toContain('rust_primary_fallback_rate_high');
    expect(summary.blockers).toContain('graph_kernel_diagnostics_missing');
    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
    expect(summary.blockers).toContain('embedding_contract_incompatible');
    expect(summary.status).toBe('degraded');
  });

  it('keeps rollout ready when evidence is below gates', () => {
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0.001,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: {
        totalRequests: 10,
        requestsMissingRank: 0,
        requestsMissingRecallSource: 0,
        requestsMissingScore: 0,
        requestsMissingExperimentKeys: 0,
        requestsMissingFeedbackJoinKey: 0,
      },
      embeddingContractIncompatibleCount: 0,
    });

    expect(summary.blockers).toEqual([]);
    expect(summary.status).toBe('ready');
  });

  it('blocks rollout when release evidence fields are absent', () => {
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
    });

    expect(summary.blockers).toContain('replay_logging_readiness_missing');
    expect(summary.blockers).toContain('embedding_contract_evidence_missing');
    expect(summary.status).toBe('degraded');
  });

  it.each([
    'totalRequests',
    'requestsMissingRank',
    'requestsMissingRecallSource',
    'requestsMissingScore',
    'requestsMissingExperimentKeys',
    'requestsMissingFeedbackJoinKey',
  ] as const)('blocks rollout when replay readiness omits %s', (field) => {
    const readiness: Record<string, number> = {
      totalRequests: 10,
      requestsMissingRank: 0,
      requestsMissingRecallSource: 0,
      requestsMissingScore: 0,
      requestsMissingExperimentKeys: 0,
      requestsMissingFeedbackJoinKey: 0,
    };
    delete readiness[field];

    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: readiness,
      embeddingContractIncompatibleCount: 0,
    });

    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
    expect(summary.status).toBe('degraded');
  });

  it.each([
    ['totalRequests', 0],
    ['totalRequests', Number.NaN],
    ['totalRequests', 1.5],
    ['requestsMissingRank', -1],
    ['requestsMissingScore', Number.POSITIVE_INFINITY],
  ] as const)('blocks rollout when replay readiness has invalid %s evidence', (field, value) => {
    const readiness = {
      totalRequests: 10,
      requestsMissingRank: 0,
      requestsMissingRecallSource: 0,
      requestsMissingScore: 0,
      requestsMissingExperimentKeys: 0,
      requestsMissingFeedbackJoinKey: 0,
      [field]: value,
    };

    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: readiness,
      embeddingContractIncompatibleCount: 0,
    });

    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
    expect(summary.status).toBe('degraded');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats invalid embedding incompatibility count %s as missing evidence',
    (embeddingContractIncompatibleCount) => {
      const summary = buildRecommendationOpsSummary({
        rustPrimaryFallbackRate: 0,
        graphKernelMissingDiagnosticsRate: 0,
        replayLoggingReadiness: {
          totalRequests: 10,
          requestsMissingRank: 0,
          requestsMissingRecallSource: 0,
          requestsMissingScore: 0,
          requestsMissingExperimentKeys: 0,
          requestsMissingFeedbackJoinKey: 0,
        },
        embeddingContractIncompatibleCount,
      });

      expect(summary.evidence.embeddingContractIncompatibleCount).toBeNull();
      expect(summary.blockers).toContain('embedding_contract_evidence_missing');
    },
  );

  it('uses real trace summary evidence for replay and embedding gates', async () => {
    mockTraceFind([
      {
        requestId: '',
        degradedReasons: ['embedding_contract_incompatible:NewsAnnSource'],
        experimentKeys: [],
        candidates: [
          {
            postId: '',
            rank: Number.NaN,
            recallSource: '',
          },
        ],
        createdAt: '2026-04-23T00:00:00.000Z',
      },
    ]);

    const traceSummary = await buildRecommendationTraceSummary({
      windowHours: 12,
      limit: 50,
    });
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: traceSummary.replayLoggingReadiness,
      embeddingContractIncompatibleCount: traceSummary.embeddingContractIncompatibleCount,
    });

    expect(traceSummary.replayLoggingReadiness).toEqual({
      totalRequests: 1,
      requestsMissingRank: 1,
      requestsMissingRecallSource: 1,
      requestsMissingScore: 1,
      requestsMissingExperimentKeys: 1,
      requestsMissingFeedbackJoinKey: 1,
    });
    expect(traceSummary.embeddingContractIncompatibleCount).toBe(1);
    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
    expect(summary.blockers).toContain('embedding_contract_incompatible');
    expect(summary.status).toBe('degraded');
  });

  it('treats an explicit empty replay pool as missing raw replay evidence', async () => {
    mockTraceFind([
      {
        requestId: 'req-empty-replay-pool',
        degradedReasons: [],
        experimentKeys: ['space_feed_recsys:treatment'],
        candidates: [
          {
            postId: 'served-post',
            rank: 1,
            recallSource: 'GraphSource',
            score: 0.8,
          },
        ],
        replayPool: {
          poolKind: 'pre_selector_scored_topk_v1',
          candidates: [],
        },
        createdAt: '2026-04-23T00:00:00.000Z',
      },
    ]);

    const traceSummary = await buildRecommendationTraceSummary({
      windowHours: 12,
      limit: 50,
    });

    expect(traceSummary.replayLoggingReadiness).toEqual({
      totalRequests: 1,
      requestsMissingRank: 1,
      requestsMissingRecallSource: 1,
      requestsMissingScore: 1,
      requestsMissingExperimentKeys: 0,
      requestsMissingFeedbackJoinKey: 1,
    });
  });

  it('blocks rollout when the trace summary has no requests', async () => {
    mockTraceFind([]);

    const traceSummary = await buildRecommendationTraceSummary({
      windowHours: 12,
      limit: 50,
    });
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: traceSummary.replayLoggingReadiness,
      embeddingContractIncompatibleCount: traceSummary.embeddingContractIncompatibleCount,
    });

    expect(traceSummary.replayLoggingReadiness.totalRequests).toBe(0);
    expect(traceSummary.embeddingContractIncompatibleCount).toBeNull();
    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
    expect(summary.blockers).toContain('embedding_contract_evidence_missing');
    expect(summary.status).toBe('degraded');
  });

  it('blocks a clean-looking trace when embedding contract evidence is absent', async () => {
    mockTraceFind([
      {
        requestId: 'req-ready',
        degradedReasons: [],
        experimentKeys: ['space_feed_recsys:treatment'],
        candidates: [
          {
            postId: 'post-ready',
            rank: 1,
            recallSource: 'GraphSource',
            score: 0.8,
          },
        ],
        createdAt: '2026-04-23T00:00:00.000Z',
      },
    ]);

    const traceSummary = await buildRecommendationTraceSummary({
      windowHours: 12,
      limit: 50,
    });
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0,
      graphKernelMissingDiagnosticsRate: 0,
      replayLoggingReadiness: traceSummary.replayLoggingReadiness,
      embeddingContractIncompatibleCount: traceSummary.embeddingContractIncompatibleCount,
    });

    expect(traceSummary.replayLoggingReadiness).toEqual({
      totalRequests: 1,
      requestsMissingRank: 0,
      requestsMissingRecallSource: 0,
      requestsMissingScore: 0,
      requestsMissingExperimentKeys: 0,
      requestsMissingFeedbackJoinKey: 0,
    });
    expect(traceSummary.embeddingContractIncompatibleCount).toBeNull();
    expect(summary.evidence.embeddingContractIncompatibleCount).toBeNull();
    expect(summary.blockers).toContain('embedding_contract_evidence_missing');
    expect(summary.status).toBe('degraded');
  });
});

function mockTraceFind(traces: any[]) {
  const chain: any = {
    select: vi.fn(() => chain),
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    lean: vi.fn().mockResolvedValue(traces),
  };
  mocks.find.mockReturnValue(chain);
  return chain;
}
