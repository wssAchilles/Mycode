import { describe, expect, it } from 'vitest';

import { buildRecommendationOpsSummary } from '../../src/services/ops/recommendation/buildRecommendationOps';

describe('recommendation ops readiness', () => {
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
});
