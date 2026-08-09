import { describe, expect, it } from 'vitest';

import {
  RANKING_PROMOTION_RESOURCE_LIMITS,
  rankingPromotionPolicyInputSchema,
  type RankingPromotionPolicyInputV1,
} from '../../src/services/recommendation/promotion/contracts';
import { evaluateRankingPromotionPolicyV1 } from '../../src/services/recommendation/promotion/evaluate';

const DIGEST = 'a'.repeat(64);
const VERSION = {
  pipeline: 'pipeline-v1', strategy: 'strategy-v1', policy: 'policy-v1', graph: 'graph-v1',
  model: 'model-v1', artifact: 'artifact-v1', index: 'index-v1',
};

function report() {
  const estimator = { status: 'evaluated' as const, estimate: 0.8, clusteredVariance: { status: 'unavailable' as const, reason: 'v1' } };
  return {
    contractVersion: 'ope_evaluation_v1', status: 'evaluated',
    observations: { total: 10, accepted: 10, rejected: 0, coverage: 1, uniqueDecisionClusters: 10, rejectedReasonCounts: {} },
    estimators: { ips: estimator, clippedIps: estimator, snips: estimator, dr: estimator },
    diagnostics: { effectiveSampleSize: { status: 'evaluated', value: 10 }, maxWeight: 1, clippingRate: 0 },
    confidenceIntervals: { status: 'unavailable_v1' },
    segments: [{
      segmentKey: 'country', segmentValue: 'US', status: 'evaluated',
      observations: { total: 10, accepted: 10, rejected: 0, coverage: 1, uniqueDecisionClusters: 10, rejectedReasonCounts: {} },
      estimators: { ips: estimator, clippedIps: estimator, snips: estimator, dr: estimator },
      diagnostics: { effectiveSampleSize: { status: 'evaluated', value: 10 }, maxWeight: 1, clippingRate: 0 },
    }],
    bindings: {
      status: 'bound', datasetVersion: 'dataset-v1', outcomeContractVersion: 'outcome_contract_v1',
      behaviorPolicy: { policyId: 'behavior', policyVersion: 'v1' },
      targetPolicy: { policyId: 'target', policyVersion: 'v1' }, decisionVersions: VERSION,
      rewardDefinition: {
        objective: 'engagement', definitionVersion: 'engagement-v1', horizonMs: 60_000,
        weights: { click: 1, like: 0, reply: 0, repost: 0, quote: 0, share: 0, dismiss: 0, blockAuthor: 0, report: 0 },
        dwell: { weight: 0, capMs: 60_000, scaleMs: 1_000 },
      }, predictionArtifactVersion: 'artifact-v1',
    },
    behaviorSupport: { status: 'complete', completeObservations: 10, totalObservations: 10, coverage: 1, reasonCounts: {} },
    fingerprints: { status: 'bound', inputSha256: DIGEST, evaluationSha256: 'b'.repeat(64) },
  };
}

function input(): RankingPromotionPolicyInputV1 {
  return rankingPromotionPolicyInputSchema.parse({
    policy: {
      contractVersion: 'ranking_promotion_policy_v1', policyId: 'promotion', policyVersion: 'v1',
      bindings: {
        datasetVersion: 'dataset-v1', outcomeContractVersion: 'outcome_contract_v1',
        behaviorPolicy: { policyId: 'behavior', policyVersion: 'v1' },
        targetPolicy: { policyId: 'target', policyVersion: 'v1' }, decisionVersions: VERSION,
        predictionArtifactVersion: 'artifact-v1',
      },
      targetPolicyFingerprint: DIGEST, minimumSupportCoverage: 0.9, minimumEffectiveSampleSize: 5,
      candidateConfidenceInterval: { level: 0.95, maxHalfWidth: 0.1 },
      constraints: [{ kind: 'quality', objective: 'engagement', estimator: 'ips', operator: 'gte', threshold: 0.5 }],
      segmentGuardrails: [{ objective: 'engagement', segmentKey: 'country', value: 'US', estimator: 'ips', operator: 'gte', threshold: 0.5, minimumESS: 5 }],
    },
    evidence: {
      opeReports: [{ objective: 'engagement', targetPolicyFingerprint: DIGEST, report: report() }],
      targetPolicyFingerprint: DIGEST,
      rollback: { status: 'missing' }, independentApproval: { status: 'missing' },
    },
  });
}

function verifiedInput(): RankingPromotionPolicyInputV1 {
  return attest(input());
}

function attest(value: RankingPromotionPolicyInputV1): RankingPromotionPolicyInputV1 {
  const { policySha256, evidenceSha256 } = evaluateRankingPromotionPolicyV1(value);
  if (!policySha256 || !evidenceSha256) throw new Error('expected digests');
  value.evidence.rollback = { status: 'verified', policySha256, evidenceSha256 };
  value.evidence.independentApproval = {
    status: 'verified', policySha256, evidenceSha256, preparedBy: 'author', approvedBy: 'reviewer',
  };
  return value;
}

describe('ranking promotion policy v1', () => {
  it('is permanently blocked and gives stable digests even when all variable gates pass', () => {
    const first = evaluateRankingPromotionPolicyV1(verifiedInput());
    const second = evaluateRankingPromotionPolicyV1(verifiedInput());

    expect(first).toMatchObject({ verdict: 'blocked', blockers: ['missing_ci', 'task9_unauthorized'] });
    expect(first.blockers).toEqual(['missing_ci', 'task9_unauthorized']);
    expect(first.policySha256).toBe(second.policySha256);
    expect(first.evidenceSha256).toBe(second.evidenceSha256);
  });

  it.each([
    ['bindings', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.bindings.datasetVersion = 'other'; }, 'report_bindings_mismatch'],
    ['support', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.behaviorSupport.coverage = 0; }, 'minimum_support_coverage_not_met'],
    ['ess', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 1 }; }, 'minimum_effective_sample_size_not_met'],
    ['constraint', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.estimators.ips.estimate = 0; }, 'constraint_quality_not_satisfied'],
    ['segment', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.segments = []; }, 'segment_missing'],
    ['rollback', (value: RankingPromotionPolicyInputV1) => { value.evidence.rollback = { status: 'missing' }; }, 'rollback_evidence_missing'],
    ['approval', (value: RankingPromotionPolicyInputV1) => { value.evidence.independentApproval = { status: 'missing' }; }, 'independent_approval_missing'],
    ['fingerprint', (value: RankingPromotionPolicyInputV1) => { value.evidence.targetPolicyFingerprint = 'c'.repeat(64); }, 'target_policy_fingerprint_mismatch'],
    ['objective', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.bindings.rewardDefinition.objective = 'other'; }, 'report_objective_mismatch'],
    ['artifact version', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.bindings.predictionArtifactVersion = 'other'; }, 'report_bindings_mismatch'],
    ['not evaluable report', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.status = 'not_evaluable'; }, 'report_not_evaluable'],
    ['inconsistent report statistics', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.observations.coverage = 0.5; }, 'report_statistics_invalid'],
  ])('%s evidence fails closed', (_name, mutate, blocker) => {
    const value = input();
    mutate(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toContain(blocker);
  });

  it('requires exactly one report for every policy objective', () => {
    const value = input();
    value.policy.constraints[0].objective = 'retention';
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'report_objective_missing',
    ]);
  });

  it.each([
    ['objective', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.bindings.rewardDefinition.objective = 'other'; }, 'report_objective_mismatch'],
    ['artifact version', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.bindings.predictionArtifactVersion = 'other'; }, 'report_bindings_mismatch'],
    ['not evaluable report', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.status = 'not_evaluable'; }, 'report_not_evaluable'],
    ['inconsistent report statistics', (value: RankingPromotionPolicyInputV1) => { value.evidence.opeReports[0].report.observations.coverage = 0.5; }, 'report_statistics_invalid'],
  ])('%s report fails with its exact blocker', (_name, mutate, blocker) => {
    const value = input();
    mutate(value);
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', blocker,
    ]);
  });

  it('rejects empty reports at the contract boundary', () => {
    const value = input() as unknown as { evidence: { opeReports: unknown[] } };
    value.evidence.opeReports = [];
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'invalid_input',
    ]);
  });

  it.each([
    ['rollback digest', (value: RankingPromotionPolicyInputV1) => { if (value.evidence.rollback.status === 'verified') value.evidence.rollback.evidenceSha256 = 'c'.repeat(64); }, 'rollback_digest_mismatch'],
    ['approval digest', (value: RankingPromotionPolicyInputV1) => { if (value.evidence.independentApproval.status === 'verified') value.evidence.independentApproval.evidenceSha256 = 'c'.repeat(64); }, 'approval_digest_mismatch'],
    ['approval identity', (value: RankingPromotionPolicyInputV1) => { if (value.evidence.independentApproval.status === 'verified') value.evidence.independentApproval.approvedBy = value.evidence.independentApproval.preparedBy; }, 'approval_not_independent'],
  ])('%s evidence is rejected', (_name, mutate, blocker) => {
    const value = verifiedInput();
    mutate(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', blocker,
    ]);
  });

  it('keeps evidence digests stable when reports are reordered', () => {
    const value = verifiedInput();
    const duplicate = structuredClone(value.evidence.opeReports[0]);
    duplicate.objective = 'safety';
    duplicate.report.bindings.rewardDefinition.objective = 'safety';
    value.evidence.opeReports.push(duplicate);
    attest(value);
    const first = evaluateRankingPromotionPolicyV1(value);
    value.evidence.opeReports.reverse();
    const second = evaluateRankingPromotionPolicyV1(value);
    expect(first.evidenceSha256).toBe(second.evidenceSha256);
  });

  it.each([new Date('2026-07-18T00:00:00.000Z'), new Map([['variance', 1]])])(
    'rejects non-JSON clustered variance evidence',
    (clusteredVariance) => {
      const value = input() as any;
      value.evidence.opeReports[0].report.estimators.ips.clusteredVariance = clusteredVariance;
      expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
        'missing_ci', 'task9_unauthorized', 'invalid_input',
      ]);
    },
  );

  it('strips irrelevant report extensions from the evidence digest', () => {
    const baseline = evaluateRankingPromotionPolicyV1(input());
    const extended = input() as any;
    extended.evidence.opeReports[0].report.debugArtifact = new Date('2026-07-18T00:00:00.000Z');
    expect(evaluateRankingPromotionPolicyV1(extended).evidenceSha256).toBe(baseline.evidenceSha256);
  });

  it.each([
    ['duplicate segment', (value: RankingPromotionPolicyInputV1) => {
      value.evidence.opeReports[0].report.segments.push(structuredClone(value.evidence.opeReports[0].report.segments[0]));
    }],
    ['segment larger than report', (value: RankingPromotionPolicyInputV1) => {
      const segment = value.evidence.opeReports[0].report.segments[0];
      segment.observations = { ...segment.observations, total: 11, accepted: 11, uniqueDecisionClusters: 11 };
      segment.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 11 };
    }],
    ['behavior reason count mismatch', (value: RankingPromotionPolicyInputV1) => {
      value.evidence.opeReports[0].report.behaviorSupport = {
        status: 'incomplete', completeObservations: 9, totalObservations: 10, coverage: 0.9, reasonCounts: {},
      };
    }],
  ])('rejects %s statistics', (_name, mutate) => {
    const value = input();
    mutate(value);
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toContain('report_statistics_invalid');
  });

  it('rejects complete behavior support with partial counts at the policy threshold', () => {
    const value = input();
    value.evidence.opeReports[0].report.behaviorSupport = {
      status: 'complete', completeObservations: 9, totalObservations: 10,
      coverage: 0.9, reasonCounts: { missing_support: 1 },
    };
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'report_statistics_invalid',
    ]);
  });

  it('requires empty behavior support to use Task5 incomplete semantics', () => {
    const value = input();
    value.policy.minimumSupportCoverage = 0;
    value.policy.constraints = [];
    value.policy.segmentGuardrails = [];
    const reportValue = value.evidence.opeReports[0].report;
    reportValue.observations = {
      total: 0, accepted: 0, rejected: 0, coverage: 0,
      uniqueDecisionClusters: 0, rejectedReasonCounts: {},
    };
    reportValue.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 0 };
    reportValue.segments = [];
    reportValue.behaviorSupport = {
      status: 'complete', completeObservations: 0, totalObservations: 0, coverage: 0, reasonCounts: {},
    };
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toContain('report_statistics_invalid');

    reportValue.behaviorSupport.status = 'incomplete';
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).not.toContain('report_statistics_invalid');
  });

  it('rejects distinct segment values whose aggregate exceeds the parent report', () => {
    const value = input();
    const first = value.evidence.opeReports[0].report.segments[0];
    first.observations = {
      total: 6, accepted: 6, rejected: 0, coverage: 1,
      uniqueDecisionClusters: 6, rejectedReasonCounts: {},
    };
    first.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 6 };
    const second = structuredClone(first);
    second.segmentValue = 'CA';
    second.observations = {
      total: 5, accepted: 5, rejected: 0, coverage: 1,
      uniqueDecisionClusters: 5, rejectedReasonCounts: {},
    };
    second.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 5 };
    value.evidence.opeReports[0].report.segments.push(second);
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'report_statistics_invalid',
    ]);
  });

  it('allows the same decision cluster across distinct values of one segment key', () => {
    const value = input();
    const reportValue = value.evidence.opeReports[0].report;
    reportValue.observations.uniqueDecisionClusters = 1;
    const first = reportValue.segments[0];
    first.observations = {
      total: 6, accepted: 6, rejected: 0, coverage: 1,
      uniqueDecisionClusters: 1, rejectedReasonCounts: {},
    };
    first.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 6 };
    const second = structuredClone(first);
    second.segmentValue = 'CA';
    second.observations = {
      total: 4, accepted: 4, rejected: 0, coverage: 1,
      uniqueDecisionClusters: 1, rejectedReasonCounts: {},
    };
    second.diagnostics.effectiveSampleSize = { status: 'evaluated', value: 4 };
    reportValue.segments.push(second);
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized',
    ]);
  });

  it('rejects policy constraints beyond the resource limit', () => {
    const value = input() as any;
    value.policy.constraints = Array.from(
      { length: RANKING_PROMOTION_RESOURCE_LIMITS.maxConstraints + 1 },
      () => ({ ...value.policy.constraints[0] }),
    );
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'invalid_input',
    ]);
  });

  it('keeps quality and safety constraint blockers distinct', () => {
    const value = input();
    value.policy.constraints.push({ ...value.policy.constraints[0], kind: 'safety' });
    value.evidence.opeReports[0].report.estimators.ips.estimate = 0;
    attest(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized',
      'constraint_quality_not_satisfied', 'constraint_safety_not_satisfied',
    ]);
  });

  it.each([
    ['coverage above one', (value: any) => { value.evidence.opeReports[0].report.observations.coverage = 2; }],
    ['negative effective sample size', (value: any) => { value.evidence.opeReports[0].report.diagnostics.effectiveSampleSize.value = -1; }],
  ])('rejects out-of-domain %s', (_name, mutate) => {
    const value = input() as any;
    mutate(value);
    expect(evaluateRankingPromotionPolicyV1(value).blockers).toEqual([
      'missing_ci', 'task9_unauthorized', 'invalid_input',
    ]);
  });

  it.each(['task9', 'authorized', 'ciOverride'])('rejects %s input without throwing', (field) => {
    const value = input() as unknown as Record<string, unknown>;
    value[field] = field === 'task9' ? { authorized: true } : true;
    expect(evaluateRankingPromotionPolicyV1(value)).toMatchObject({
      verdict: 'blocked', blockers: ['missing_ci', 'task9_unauthorized', 'invalid_input'],
    });
  });
});
