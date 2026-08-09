import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';

import { evaluateRankingPromotionPolicyV2 } from '../../src/services/recommendation/promotion/v2/evaluate';
import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';
import { opeEvaluationReportSha256V2 } from '../../src/services/recommendation/ope/v2/evaluate';
import { evaluatePromotionStatisticalReadinessV1 } from '../../src/services/recommendation/promotion/readiness/evaluate';

const sha = 'a'.repeat(64);
const versions = { pipeline: '1', strategy: '1', policy: '1', graph: '1', model: '1', artifact: '1', index: '1' };
const rewardDefinition = { objective: 'r', definitionVersion: '1', horizonMs: 1, weights: { click: 1, like: 0, reply: 0, repost: 0, quote: 0, share: 0, dismiss: 0, blockAuthor: 0, report: 0 }, dwell: { weight: 0, capMs: 1, scaleMs: 1 } };
const bindings = { estimand: 'mean_reward_per_logged_slot_v1' as const, datasetVersion: 'd', outcomeContractVersion: 'outcome_contract_v1' as const, behaviorPolicy: { policyId: 'b', policyVersion: '1' }, targetPolicy: { policyId: 't', policyVersion: '1' }, targetPolicyConfigSha256: '9'.repeat(64), decisionVersions: versions, rewardDefinition, predictionEvidence: { predictionSetVersion: 'p', modelBundleSha256: sha, receiptSha256: sha }, ci: { method: 'decision_cluster_robust_wald' as const, version: 'decision_cluster_robust_wald_v1' as const, level: 0.95 as const, minDecisionClusters: 2 } };
const policy = { contractVersion: 'ranking_promotion_policy_v2' as const, policyId: 'p', policyVersion: '1', estimand: 'mean_reward_per_logged_slot_v1' as const, bindings, targetPolicyFingerprint: sha, minimumSupportCoverage: 1, minimumEffectiveSampleSize: 1, candidateConfidenceInterval: { level: 0.95 as const, maxHalfWidth: 1 }, constraints: [], segmentGuardrails: [] };
const evaluated = { status: 'evaluated' as const, estimate: 0.6, clusteredVariance: { status: 'evaluated' as const, variance: 0.01 } };
const interval = { status: 'evaluated' as const, estimate: 0.6, standardError: 0.1, criticalValue: 1.959963984540054, halfWidth: 0.1959963984540054, level: 0.95 as const, method: 'decision_cluster_robust_wald' as const, version: 'decision_cluster_robust_wald_v1' as const, lower: 0.4040036015459946, upper: 0.7959963984540054, decisionClusterCount: 2 };
const report = { contractVersion: 'ope_evaluation_v2' as const, estimand: 'mean_reward_per_logged_slot_v1' as const, status: 'evaluated' as const, observations: { total: 2, accepted: 2, rejected: 0, coverage: 1, uniqueDecisionClusters: 2 }, bindings, fingerprints: { inputSha256: sha, evaluationSha256: sha, estimand: 'mean_reward_per_logged_slot_v1' as const, ciConfigSha256: sha, targetPolicyConfigSha256: '9'.repeat(64) }, diagnostics: { supportCoverage: 1, effectiveSampleSize: 2, maxWeight: 1, clippingRate: 0, slotCount: 2, decisionCount: 2 }, estimators: { ips: evaluated, clippedIps: evaluated, snips: evaluated, dr: evaluated }, confidenceIntervals: { ips: interval, clippedIps: interval, snips: interval, dr: interval }, segments: [] };
report.fingerprints.ciConfigSha256 = createHash('sha256').update(canonicalDecisionJson(bindings.ci)).digest('hex');
report.fingerprints.evaluationSha256 = opeEvaluationReportSha256V2(report);

describe('ranking promotion policy v2', () => {
  it('keeps fixed blockers first for valid and invalid input', () => {
    const input = { policy, evidence: { opeReports: [{ objective: 'r', targetPolicyFingerprint: sha, report }], targetPolicyFingerprint: sha, rollback: { status: 'missing' as const }, independentApproval: { status: 'missing' as const } } };
    expect(evaluateRankingPromotionPolicyV2(input).blockers.slice(0, 2)).toEqual(['multiplicity_control_unavailable', 'task9_unauthorized']);
    expect(evaluateRankingPromotionPolicyV2({}).blockers.slice(0, 2)).toEqual(['multiplicity_control_unavailable', 'task9_unauthorized']);
  });

  it('uses inclusive CI bounds and enforces maximum half width', () => {
    const constrained = structuredClone(policy);
    constrained.candidateConfidenceInterval.maxHalfWidth = 0.2;
    constrained.constraints = [{ kind: 'quality', objective: 'r', estimator: 'ips', operator: 'gte', threshold: interval.lower }];
    const boundedReport = structuredClone(report) as any;
    const input = { policy: constrained, evidence: { opeReports: [{ objective: 'r', targetPolicyFingerprint: sha, report: boundedReport }], targetPolicyFingerprint: sha, rollback: { status: 'missing' as const }, independentApproval: { status: 'missing' as const } } };
    expect(evaluateRankingPromotionPolicyV2(input).blockers).not.toContain('constraint_gte_not_satisfied');
    constrained.candidateConfidenceInterval.maxHalfWidth = 0.1;
    expect(evaluateRankingPromotionPolicyV2(input).blockers).toContain('ci_half_width_exceeded');
    boundedReport.confidenceIntervals.ips = { ...boundedReport.confidenceIntervals.ips, lower: 0.8, upper: 0.7 };
    expect(evaluateRankingPromotionPolicyV2(input).blockers).toContain('ci_invalid');
  });

  it('requires segment support coverage', () => {
    const guarded: any = structuredClone(policy);
    guarded.segmentGuardrails = [{ kind: 'safety', objective: 'r', estimator: 'ips', operator: 'gte', threshold: 0, segmentKey: 'country', value: 'US', minimumESS: 1 }];
    const segmented: any = structuredClone(report);
    segmented.segments = [{ segmentKey: 'country', segmentValue: 'US', status: 'evaluated', observations: { total: 2, accepted: 2, rejected: 0, coverage: 1, uniqueDecisionClusters: 2 }, diagnostics: { supportCoverage: 0.5, effectiveSampleSize: 2, maxWeight: 1, clippingRate: 0, slotCount: 2, decisionCount: 2 }, estimators: { ips: evaluated, clippedIps: evaluated, snips: evaluated, dr: evaluated }, confidenceIntervals: { ips: interval, clippedIps: interval, snips: interval, dr: interval } }];
    const value = { policy: guarded, evidence: { opeReports: [{ objective: 'r', targetPolicyFingerprint: sha, report: segmented }], targetPolicyFingerprint: sha, rollback: { status: 'missing' as const }, independentApproval: { status: 'missing' as const } } };
    expect(evaluateRankingPromotionPolicyV2(value).blockers).toContain('segment_support_coverage_not_met');
  });

  it('rejects report objective drift', () => {
    const value = { policy, evidence: { opeReports: [{ objective: 'other', targetPolicyFingerprint: sha, report }], targetPolicyFingerprint: sha, rollback: { status: 'missing' as const }, independentApproval: { status: 'missing' as const } } };
    expect(evaluateRankingPromotionPolicyV2(value).blockers).toContain('report_objective_mismatch');
  });

  it.each(['cycle', 'bigint'] as const)('fails closed for %s input', (kind) => {
    const value: any = { policy: kind === 'bigint' ? 1n : policy };
    if (kind === 'cycle') value.self = value;
    expect(evaluateRankingPromotionPolicyV2(value).blockers).toEqual(['multiplicity_control_unavailable', 'task9_unauthorized', 'invalid_input']);
  });

  it('rejects self-hashed cluster-count and binding fingerprint drift', () => {
    const clusterDrift = structuredClone(report);
    clusterDrift.confidenceIntervals.ips.decisionClusterCount = 3;
    clusterDrift.fingerprints!.evaluationSha256 = opeEvaluationReportSha256V2(clusterDrift);
    const inputFor = (candidate: typeof report) => ({ policy, evidence: { opeReports: [{ objective: 'r', targetPolicyFingerprint: sha, report: candidate }], targetPolicyFingerprint: sha, rollback: { status: 'missing' as const }, independentApproval: { status: 'missing' as const } } });
    expect(evaluateRankingPromotionPolicyV2(inputFor(clusterDrift)).blockers).toContain('decision_cluster_count_mismatch');

    const digestDrift = structuredClone(report);
    digestDrift.fingerprints!.ciConfigSha256 = 'b'.repeat(64);
    digestDrift.fingerprints!.targetPolicyConfigSha256 = 'c'.repeat(64);
    digestDrift.fingerprints!.evaluationSha256 = opeEvaluationReportSha256V2(digestDrift);
    const blockers = evaluateRankingPromotionPolicyV2(inputFor(digestDrift)).blockers;
    expect(blockers).toContain('ci_config_fingerprint_mismatch');
    expect(blockers).toContain('target_policy_config_fingerprint_mismatch');
  });

  it('keeps statistical readiness fail closed without an independent holdout-use registry', () => {
    const base = {
      contractVersion: 'promotion_statistical_readiness_v1' as const,
      method: 'intersection_union_all_must_pass_v1' as const,
      sealedHypothesisManifestSha256: sha,
      frozenAt: '2026-07-16T07:00:00.000Z', holdoutRevealedAt: '2026-07-16T08:00:00.000Z',
      candidatePolicies: [{ policyId: 'candidate', policyVersion: '1' }],
      objectives: ['r'], segments: [],
      trainingDecisionIds: ['00000000-0000-4000-8000-000000000001'],
      holdoutDecisionIds: ['00000000-0000-4000-8000-000000000002'],
      holdoutUseEvidence: { status: 'self_asserted' as const, receiptSha256: sha },
    };
    expect(evaluatePromotionStatisticalReadinessV1(base)).toMatchObject({
      verdict: 'blocked', realDatasetEligible: false,
      blockers: ['multiplicity_control_unavailable', 'holdout_use_registry_unavailable'],
    });
    expect(evaluatePromotionStatisticalReadinessV1({ ...base, holdoutDecisionIds: base.trainingDecisionIds }).blockers).toContain('decision_set_overlap');
    expect(evaluateRankingPromotionPolicyV2({} as never).blockers.slice(0, 2)).toEqual(['multiplicity_control_unavailable', 'task9_unauthorized']);
  });
});
