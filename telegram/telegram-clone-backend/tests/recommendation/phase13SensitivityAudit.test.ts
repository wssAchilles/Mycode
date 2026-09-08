import { describe, expect, it } from 'vitest';

import {
  auditExactSignRandomizationResolutionV1,
  auditSelfNormalizedImportanceWeightingAssumptionsV1,
  auditTimeUniformConfidenceSequenceAssumptionsV1,
  describeClusterMultiplierBootstrapDiagnosticV1,
} from '../../src/services/recommendation/ope/inference/qualification/v3/sensitivity';

const missingAssumptions = {
  sequentialPrefixMappingVerified: false,
  clusterDependenceHandled: false,
  timeShockHandled: false,
  positivePropensityFloorVerified: false,
  rewardBoundVerified: false,
  importanceWeightBoundVerified: false,
  stoppingRuleVerified: false,
  fixedPreOutcomePoliciesVerified: false,
};

describe('Phase 13 sensitivity audits', () => {
  it('reports exact sign-group resolution without reinterpreting bootstrap evidence', () => {
    const twoClusters = auditExactSignRandomizationResolutionV1({ clusterCount: 2 });
    const fourClusters = auditExactSignRandomizationResolutionV1({ clusterCount: 4 });

    expect(twoClusters).toMatchObject({
      contractVersion: 'exact_sign_randomization_resolution_audit_v1',
      status: 'evaluated',
      procedure: 'exact_sign_randomization_resolution_audit_v1',
      transformationGroup: 'all_cluster_sign_vectors_v1',
      identityIncluded: true,
      tail: 'one_sided_inclusive_v1',
      randomizedBoundary: false,
      midP: false,
      clusterCount: 2,
      transformationCount: 4,
      minimumNonrandomizedPValue: 0.25,
      symmetryAssumptionVerified: false,
      candidateEvidenceEligible: false,
    });
    expect(fourClusters).toMatchObject({
      transformationCount: 16,
      minimumNonrandomizedPValue: 0.0625,
    });
    expect(auditExactSignRandomizationResolutionV1({
      clusterCount: 4,
      bootstrapReplicates: 1_000_000,
    })).toEqual(fourClusters);
    expect(twoClusters.auditSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(twoClusters.auditSha256).not.toBe(fourClusters.auditSha256);
    expect(Object.isFrozen(twoClusters)).toBe(true);

    expect(auditExactSignRandomizationResolutionV1({ clusterCount: 0 })).toMatchObject({
      status: 'not_evaluable',
      blocker: 'exact_sign_resolution_audit_contract_invalid',
      candidateEvidenceEligible: false,
    });
    expect(auditExactSignRandomizationResolutionV1({ clusterCount: 53 })).toMatchObject({
      status: 'not_evaluable',
      blocker: 'exact_sign_resolution_audit_contract_invalid',
    });
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => auditExactSignRandomizationResolutionV1(hostile)).not.toThrow();
    expect(() => auditTimeUniformConfidenceSequenceAssumptionsV1(hostile)).not.toThrow();
  });

  it('keeps self-normalized and confidence-sequence checks assumption-only', () => {
    const selfNormalized = auditSelfNormalizedImportanceWeightingAssumptionsV1(
      missingAssumptions,
    );
    const confidenceSequence = auditTimeUniformConfidenceSequenceAssumptionsV1(
      missingAssumptions,
    );
    const reasons = [
      'sequential_prefix_mapping_unverified',
      'cluster_dependence_unhandled',
      'time_shock_unhandled',
      'positive_propensity_floor_unverified',
      'reward_bound_unverified',
      'importance_weight_bound_unverified',
      'stopping_rule_unverified',
      'fixed_pre_outcome_policies_unverified',
    ];

    expect(selfNormalized).toMatchObject({
      contractVersion: 'self_normalized_importance_weighting_assumption_audit_v1',
      status: 'not_applicable',
      auditRole: 'assumption_audit_only_v1',
      reasons,
      candidateEvidenceEligible: false,
    });
    expect(confidenceSequence).toMatchObject({
      contractVersion: 'time_uniform_confidence_sequence_assumption_audit_v1',
      status: 'not_applicable',
      auditRole: 'assumption_audit_only_v1',
      reasons,
      candidateEvidenceEligible: false,
    });
    expect(selfNormalized.auditSha256).not.toBe(confidenceSequence.auditSha256);
    expect(Object.isFrozen(selfNormalized)).toBe(true);
    expect(Object.isFrozen(selfNormalized.assumptions)).toBe(true);
    expect(Object.isFrozen(selfNormalized.reasons)).toBe(true);
    expect('bound' in selfNormalized).toBe(false);
    expect('confidenceInterval' in confidenceSequence).toBe(false);
    expect('candidateStatus' in confidenceSequence).toBe(false);

    const complete = Object.fromEntries(
      Object.keys(missingAssumptions).map((key) => [key, true]),
    );
    expect(auditTimeUniformConfidenceSequenceAssumptionsV1(complete)).toMatchObject({
      status: 'applicable',
      reasons: [],
      candidateEvidenceEligible: false,
    });
  });

  it('describes the existing multiplier method without exposing an estimator', () => {
    const diagnostic = describeClusterMultiplierBootstrapDiagnosticV1();
    const signAudit = auditExactSignRandomizationResolutionV1({ clusterCount: 4 });

    expect(diagnostic).toMatchObject({
      contractVersion: 'cluster_multiplier_bootstrap_diagnostic_audit_v1',
      method: 'cluster_score_multiplier_bootstrap_t_v1',
      auditRole: 'diagnostic_only_v1',
      candidateEvidenceEligible: false,
    });
    expect(diagnostic.auditSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostic.auditSha256).not.toBe(signAudit.auditSha256);
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect('estimate' in diagnostic).toBe(false);
    expect('confidenceInterval' in diagnostic).toBe(false);
  });
});
