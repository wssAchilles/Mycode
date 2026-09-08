import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  aggregate: vi.fn(),
}));

vi.mock('../../src/models/RecommendationTrace', () => ({
  default: {
    find: mocks.find,
    aggregate: mocks.aggregate,
  },
}));

import { buildRecommendationOpsSummary } from '../../src/services/ops/recommendation/buildRecommendationOps';
import { buildRecommendationTraceSummary } from '../../src/services/recommendation/ops';
import { loadRecommendationRolloutPolicy } from '../../src/services/recommendation/contracts/rolloutPolicy';
import {
  buildRecommendationRolloutEvidence,
  readRecommendationRolloutEvidence,
} from '../../src/services/recommendation/ops/rolloutEvidence';

const now = new Date('2026-07-15T12:00:00.000Z');
const rolloutPolicy = {
  version: 'phase6a-v1',
  servingVersion: 'rust_serving_v1',
  windowHours: 2,
  minimumPrimarySamples: 4,
  maximumFallbackRatio: 0.5,
} as const;

const approvedPolicyConfig = {
  activeVersion: 'phase6a-v1',
  approvedVersions: ['phase6a-v1'],
  policies: {
    'phase6a-v1': {
      servingVersion: 'rust_serving_v1',
      windowHours: 2,
      minimumPrimarySamples: 4,
      maximumFallbackRatio: 0.5,
    },
  },
};

describe('recommendation ops readiness', () => {
  beforeEach(() => {
    mocks.find.mockReset();
    mocks.aggregate.mockReset();
  });

  it('loads an explicitly approved versioned rollout policy', () => {
    expect(loadRecommendationRolloutPolicy(approvedPolicyConfig)).toEqual({
      ok: true,
      policy: rolloutPolicy,
    });
  });

  it.each([
    ['missing', undefined, 'recommendation_rollout_policy_missing'],
    ['unknown', {
      ...approvedPolicyConfig,
      activeVersion: 'phase6a-v2',
      approvedVersions: ['phase6a-v2'],
    }, 'recommendation_rollout_policy_unknown'],
    ['invalid', {
      ...approvedPolicyConfig,
      policies: {
        'phase6a-v1': {
          servingVersion: 'rust_serving_v1',
          windowHours: 2,
          minimumPrimarySamples: 0,
          maximumFallbackRatio: 0.5,
        },
      },
    }, 'recommendation_rollout_policy_invalid'],
    ['unapproved', {
      ...approvedPolicyConfig,
      approvedVersions: [],
    }, 'recommendation_rollout_policy_unapproved'],
  ] as const)('fails closed for a %s rollout policy', (_case, config, blocker) => {
    expect(loadRecommendationRolloutPolicy(config)).toMatchObject({
      ok: false,
      blocker,
    });
  });

  it('aggregates only new primary traces inside the policy window and passes at the ratio boundary', () => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('rust', undefined, '2026-07-15T11:40:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:30:00.000Z'),
        primaryTrace('node', 'rust_primary_error_fallback_node', '2026-07-15T10:00:00.000Z'),
        { owner: 'node', fallbackMode: 'rust_primary_failed', createdAt: '2026-07-15T11:00:00.000Z' },
        { runtimeMode: 'shadow', servingOwner: 'node', fallbackReason: 'rust_primary_error_fallback_node', createdAt: '2026-07-15T11:00:00.000Z' },
        { runtimeMode: 'off', servingOwner: 'node', fallbackReason: 'rust_primary_empty_fallback_node', createdAt: '2026-07-15T11:00:00.000Z' },
        primaryTrace('node', 'rust_primary_error_fallback_node', '2026-07-15T09:59:59.999Z'),
        primaryTrace('node', 'rust_primary_error_fallback_node', '2026-07-15T12:00:00.001Z'),
      ],
      rolloutPolicy,
      now,
    );

    expect(evidence).toMatchObject({
      policyVersion: 'phase6a-v1',
      servingVersion: 'rust_serving_v1',
      windowHours: 2,
      minimumPrimarySamples: 4,
      maximumFallbackRatio: 0.5,
      primarySamples: 4,
      fallbackSamples: 2,
      fallbackRatio: 0.5,
      status: 'ready',
      blockers: [],
    });
  });

  it('blocks when primary samples are below the injected policy minimum', () => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:40:00.000Z'),
        primaryTrace('rust', undefined, '2026-07-15T11:30:00.000Z'),
      ],
      rolloutPolicy,
      now,
    );

    expect(evidence.blockers).toContain('recommendation_rollout_primary_samples_insufficient');
    expect(evidence.status).toBe('blocked');
  });

  it('blocks only when the primary fallback ratio exceeds the injected maximum', () => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:40:00.000Z'),
        primaryTrace('node', 'rust_primary_error_fallback_node', '2026-07-15T11:30:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:20:00.000Z'),
      ],
      rolloutPolicy,
      now,
    );

    expect(evidence.fallbackRatio).toBe(0.75);
    expect(evidence.blockers).toContain('recommendation_rollout_fallback_ratio_high');
    expect(evidence.status).toBe('blocked');
  });

  it('blocks new primary Node traces with missing or unknown fallback reasons', () => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:45:00.000Z'),
        primaryTrace('node', undefined, '2026-07-15T11:40:00.000Z'),
        primaryTrace('node', 'unexpected_node_reason', '2026-07-15T11:30:00.000Z'),
        { owner: 'node', fallbackMode: 'rust_primary_failed', createdAt: '2026-07-15T11:20:00.000Z' },
      ],
      { ...rolloutPolicy, minimumPrimarySamples: 2, maximumFallbackRatio: 0.5 },
      now,
    );

    expect(evidence).toMatchObject({
      primarySamples: 4,
      validPrimarySamples: 2,
      fallbackSamples: 1,
      fallbackRatio: 0.5,
      invalidTraceCount: 2,
      blockers: ['recommendation_rollout_trace_contract_invalid'],
      status: 'blocked',
    });
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'python'],
  ] as const)('blocks a new primary trace with a %s serving owner', (_case, servingOwner) => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:40:00.000Z'),
        {
          runtimeMode: 'primary',
          servingOwner,
          serving: { servingVersion: 'rust_serving_v1' },
          createdAt: '2026-07-15T11:30:00.000Z',
        },
      ],
      { ...rolloutPolicy, minimumPrimarySamples: 2 },
      now,
    );

    expect(evidence).toMatchObject({
      primarySamples: 3,
      validPrimarySamples: 2,
      fallbackSamples: 1,
      invalidTraceCount: 1,
      fallbackRatio: 0.5,
      status: 'blocked',
      blockers: ['recommendation_rollout_trace_contract_invalid'],
    });
  });

  it('blocks a policy window containing missing or stale serving versions', () => {
    const evidence = buildRecommendationRolloutEvidence(
      [
        primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
        primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:40:00.000Z'),
        primaryTrace('rust', undefined, '2026-07-15T11:30:00.000Z', 'rust_serving_v0'),
        {
          runtimeMode: 'primary',
          servingOwner: 'node',
          fallbackReason: 'rust_primary_error_fallback_node',
          createdAt: '2026-07-15T11:20:00.000Z',
        },
      ],
      { ...rolloutPolicy, minimumPrimarySamples: 2 },
      now,
    );

    expect(evidence).toMatchObject({
      primarySamples: 4,
      validPrimarySamples: 2,
      fallbackSamples: 1,
      servingVersionMismatchCount: 2,
      invalidTraceCount: 2,
      status: 'blocked',
      blockers: [
        'recommendation_rollout_trace_contract_invalid',
        'recommendation_rollout_serving_version_mismatch',
      ],
    });
  });

  it('aggregates policy-window counts in Mongo without limit or legacy env influence', async () => {
    const originalThreshold = process.env.RECOMMENDATION_RUST_PRIMARY_FALLBACK_RATE_THRESHOLD;
    process.env.RECOMMENDATION_RUST_PRIMARY_FALLBACK_RATE_THRESHOLD = '0';
    mocks.aggregate.mockResolvedValue([{
      primarySamples: 4,
      validPrimarySamples: 4,
      fallbackSamples: 2,
      servingVersionMismatchCount: 0,
      invalidTraceCount: 0,
    }]);

    try {
      const evidence = await readRecommendationRolloutEvidence(approvedPolicyConfig, now);

      const pipeline = mocks.aggregate.mock.calls[0]?.[0];
      expect(pipeline?.[0]).toEqual({
        $match: {
          createdAt: {
            $gte: new Date('2026-07-15T10:00:00.000Z'),
            $lte: now,
          },
          runtimeMode: 'primary',
        },
      });
      expect(JSON.stringify(pipeline?.[1])).toContain(
        JSON.stringify(['$serving.servingVersion', 'rust_serving_v1']),
      );
      expect(JSON.stringify(pipeline)).not.toContain('"$limit"');
      expect(evidence.primarySamples).toBe(4);
      expect(evidence.validPrimarySamples).toBe(4);
      expect(evidence.fallbackRatio).toBe(0.5);
      expect(evidence.invalidTraceCount).toBe(0);
      expect(evidence.blockers).toEqual([]);
    } finally {
      process.env.RECOMMENDATION_RUST_PRIMARY_FALLBACK_RATE_THRESHOLD = originalThreshold;
    }
  });

  it('surfaces versioned rollout, graph diagnostics, replay readiness, and embedding blockers', () => {
    const summary = buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0.12,
      recommendationRollout: buildRecommendationRolloutEvidence(
        [
          primaryTrace('rust', undefined, '2026-07-15T11:50:00.000Z'),
          primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:40:00.000Z'),
          primaryTrace('node', 'rust_primary_error_fallback_node', '2026-07-15T11:30:00.000Z'),
          primaryTrace('node', 'rust_primary_empty_fallback_node', '2026-07-15T11:20:00.000Z'),
        ],
        rolloutPolicy,
        now,
      ),
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

    expect(summary.blockers).toContain('recommendation_rollout_fallback_ratio_high');
    expect(summary.blockers).not.toContain('rust_primary_fallback_rate_high');
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

function primaryTrace(
  servingOwner: 'node' | 'rust',
  fallbackReason: string | undefined,
  createdAt: string,
  servingVersion = 'rust_serving_v1',
) {
  return {
    runtimeMode: 'primary',
    servingOwner,
    fallbackReason,
    serving: { servingVersion },
    createdAt,
  };
}
