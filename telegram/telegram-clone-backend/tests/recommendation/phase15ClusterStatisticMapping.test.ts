import { createHash } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';

const brands = vi.hoisted(() => ({
  receipts: new WeakSet<object>(),
  contributionOwners: new WeakMap<object, object>(),
  phase14Handoffs: new WeakSet<object>(),
}));

vi.mock('../../src/services/recommendation/ope/v3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/recommendation/ope/v3')>()),
  isVerifiedOpeAggregateReceiptV3: (value: unknown) => (
    !!value && typeof value === 'object' && brands.receipts.has(value)
  ),
  isOpeSlotContributionBoundToReceiptV3: (value: unknown, receipt: unknown) => (
    !!value && typeof value === 'object'
    && !!receipt && typeof receipt === 'object'
    && brands.receipts.has(receipt)
    && brands.contributionOwners.get(value) === receipt
  ),
}));

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v4/handoff',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v4/handoff'
    )>()),
    isVerifiedPhase14SameProcessHandoffV1: (value: unknown) => (
      !!value && typeof value === 'object' && brands.phase14Handoffs.has(value)
    ),
  }),
);

import * as clusterScores from '../../src/services/recommendation/ope/inference/clusterScores';
import {
  buildPhase15SyntheticClusterStatisticMappingAuditV1,
  isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1,
  PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v5/clusterMapping';
import {
  buildPhase15SameProcessNoCandidateHandoffV1,
  isVerifiedPhase15SameProcessNoCandidateHandoffV1,
  PHASE15_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v5/handoff';

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

const stateBindingSha256 = 'a'.repeat(64);
const predictionBinding = freeze({
  predictionSetVersion: 'phase15-prediction-set-v2',
  verificationReceiptSha256: 'b'.repeat(64),
});
const segmentAssignments = freeze([{ key: 'surface', value: 'home' }]);

function contribution(
  priorContributionSha256: string,
  values: {
    decisionId: string;
    clusterId: string;
    drContribution: number;
    weight: number;
    prediction?: typeof predictionBinding;
    segments?: typeof segmentAssignments;
  },
) {
  const preimage = {
    contractVersion: 'ope_v3_slot_contribution_v1' as const,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    stateBindingSha256,
    priorContributionSha256,
    decisionId: values.decisionId,
    servedPosition: 1,
    prefixLogWeight: 0,
    logWeight: Math.log(values.weight),
    prefixWeight: 1,
    weight: values.weight,
    behaviorProbability: 0.5,
    targetProbability: 0.5,
    reward: values.drContribution,
    ipsContribution: values.drContribution,
    drContribution: values.drContribution,
    binding: {
      inferenceClusterId: values.clusterId,
      segmentAssignments: values.segments ?? segmentAssignments,
      objective: 'synthetic_dwell',
      syntheticOutcomeEvidenceSha256: 'c'.repeat(64),
      syntheticContextSha256: 'd'.repeat(64),
      prediction: values.prediction ?? predictionBinding,
    },
  };
  const value = freeze({ ...preimage, contributionSha256: digest(preimage) });
  return value;
}

function source() {
  const initial = digest({ stateBindingSha256, chain: 'empty_v1' });
  const first = contribution(initial, {
    decisionId: 'decision-a', clusterId: 'cluster-a', drContribution: 0.25, weight: 1,
  });
  const second = contribution(first.contributionSha256, {
    decisionId: 'decision-b', clusterId: 'cluster-b', drContribution: 1.25, weight: 2,
  });
  const receipt = freeze({
    contractVersion: 'verified_ope_v3_aggregate_receipt_v1' as const,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    resourceLimitsVersion: 'ope_v3_resource_limits_v1' as const,
    resourceConfigSha256: 'e'.repeat(64),
    stateBindingSha256,
    trajectoryCohortSha256: 'f'.repeat(64),
    outcomeEvidenceRootsSha256: '1'.repeat(64),
    contextEvidenceRootsSha256: '2'.repeat(64),
    targetEvidenceRootsSha256: '3'.repeat(64),
    predictionEvidenceRootsSha256: digest([predictionBinding]),
    contributionHashChainSha256: second.contributionSha256,
    aggregateStateSha256: '4'.repeat(64),
    expectedDecisionCount: 2,
    observedDecisionCount: 2,
    expectedSlotCount: 2,
    observedSlotCount: 2,
    drSlotCount: 2,
    fullyStreaming: false as const,
    boundedInMemoryEvidence: [
      'synthetic_outcome_v1',
      'synthetic_context_v1',
      'synthetic_trajectory_step_summaries_v1',
    ] as const,
    highWaterDiagnostics: {
      decisions: 2, slots: 2, clusters: 2, segmentKeys: 1, objectives: 1,
      aggregateStateEntries: 2, estimatedAggregateStateBytes: 1_024,
      peakBufferedActions: 4, peakBufferedRecords: 4, peakBufferedBytes: 4_096,
    },
    receiptSha256: '5'.repeat(64),
  });
  brands.receipts.add(receipt);
  brands.contributionOwners.set(first, receipt);
  brands.contributionOwners.set(second, receipt);
  return { receipt, contributions: [first, second] as const };
}

describe('Phase 15 synthetic cluster-statistic mapping', () => {
  it('binds the complete V3 chain and audits the private multi-cluster adapter math', () => {
    const value = source();
    const summary = vi.spyOn(clusterScores, 'summarizeClusterScoresV1');
    try {
      const built = buildPhase15SyntheticClusterStatisticMappingAuditV1(value);
      expect(built.status).toBe('verified');
      if (built.status !== 'verified') return;
      expect(summary).toHaveBeenCalledTimes(1);
      expect(built.audit).toMatchObject({
        contractVersion: 'verified_phase15_synthetic_cluster_statistic_mapping_audit_v1',
        estimand: 'mean_reward_per_logged_slot_v1',
        sourceClusterUnitVersion: 'independent_decision_synthetic_v1',
        mappingStatus: 'verified_synthetic_mapping_only',
        viewerClusterProvenancePresent: false,
        candidateEvidenceEligible: false,
        qualificationEvidenceEligible: false,
        realDatasetEligible: false,
        servable: false,
        clusterRows: [
          { inferenceClusterId: 'cluster-a', y: 0.25, a: 1, importanceMass: 1 },
          { inferenceClusterId: 'cluster-b', y: 1.25, a: 1, importanceMass: 2 },
        ],
        clusterScoreSummaryResult: { status: 'evaluated' },
        resourceDiagnostics: {
          slotContributions: 2,
          clusters: 2,
          mappingWorkUnits: 6,
          peakBufferedClusters: 2,
        },
      });
      expect(built.audit.clusterScoreSummaryResult).toEqual(
        clusterScores.summarizeClusterScoresV1('dr', built.audit.clusterRows),
      );
      expect(isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1(built.audit)).toBe(true);
      expect(isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1(
        structuredClone(built.audit),
      )).toBe(false);
      const driftedSummary = structuredClone(built.audit);
      driftedSummary.clusterRows[0].y += 1;
      expect(isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1(driftedSummary)).toBe(false);
    } finally {
      summary.mockRestore();
    }
  });

  it('fails closed for incomplete, reordered, drifted, hostile, and unbranded sources', () => {
    const value = source();
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value, contributions: [value.contributions[0]],
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_incomplete_cohort' });
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value, contributions: [...value.contributions].reverse(),
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase15_mapping_contribution_chain_mismatch',
    });
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value, contributions: [value.contributions[0], value.contributions[0]],
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase15_mapping_contribution_chain_mismatch',
    });
    const otherOwner = source();
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: value.receipt,
      contributions: otherOwner.contributions,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value, receipt: structuredClone(value.receipt),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value,
      receipt: freeze({ ...value.receipt, resourceConfigSha256: '8'.repeat(64) }),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      ...value,
      receipt: freeze({ ...value.receipt, estimand: 'drifted_estimand_v1' }),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });

    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase15SyntheticClusterStatisticMappingAuditV1(hostile)).not.toThrow();
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified',
    });
    const hostileArray = new Proxy([], {
      get: (_target, property) => {
        if (property === 'length') throw new Error('hostile length');
        return undefined;
      },
    });
    expect(() => buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: value.receipt,
      contributions: hostileArray,
    })).not.toThrow();
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: value.receipt,
      contributions: hostileArray,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });
    const hostileIndexArray = new Proxy([...value.contributions], {
      get: (target, property, receiver) => {
        if (property === '1') throw new Error('hostile index');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: value.receipt,
      contributions: hostileIndexArray,
    })).not.toThrow();
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: value.receipt,
      contributions: hostileIndexArray,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_source_unverified' });

    const initial = digest({ stateBindingSha256, chain: 'empty_v1' });
    const first = contribution(initial, {
      decisionId: 'decision-a', clusterId: 'cluster-a', drContribution: 0.25, weight: 1,
    });
    const driftedPrediction = freeze({
      predictionSetVersion: predictionBinding.predictionSetVersion,
      verificationReceiptSha256: '9'.repeat(64),
    });
    const second = contribution(first.contributionSha256, {
      decisionId: 'decision-b', clusterId: 'cluster-b', drContribution: 1.25, weight: 2,
      prediction: driftedPrediction,
    });
    const driftedReceipt = freeze({
      ...value.receipt,
      contributionHashChainSha256: second.contributionSha256,
    });
    brands.receipts.add(driftedReceipt);
    brands.contributionOwners.set(first, driftedReceipt);
    brands.contributionOwners.set(second, driftedReceipt);
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: driftedReceipt, contributions: [first, second],
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase15_mapping_prediction_binding_mismatch',
    });

    const scopeDrift = contribution(first.contributionSha256, {
      decisionId: 'decision-b', clusterId: 'cluster-b', drContribution: 1.25, weight: 2,
      segments: freeze([{ key: 'surface', value: 'search' }]),
    });
    const scopeReceipt = freeze({
      ...value.receipt,
      contributionHashChainSha256: scopeDrift.contributionSha256,
    });
    brands.receipts.add(scopeReceipt);
    brands.contributionOwners.set(first, scopeReceipt);
    brands.contributionOwners.set(scopeDrift, scopeReceipt);
    expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
      receipt: scopeReceipt, contributions: [first, scopeDrift],
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_mapping_scope_mismatch' });
  });

  it('preflights hard caps before mapping math', () => {
    const value = source();
    const receipt = freeze({
      ...value.receipt,
      expectedSlotCount: PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions + 1,
      observedSlotCount: PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions + 1,
      drSlotCount: PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions + 1,
    });
    brands.receipts.add(receipt);
    const summary = vi.spyOn(clusterScores, 'summarizeClusterScoresV1');
    try {
      expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
        receipt,
        contributions: Array(
          PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions + 1,
        ).fill(value.contributions[0]),
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase15_mapping_resource_limit_exceeded',
      });
      const initial = digest({ stateBindingSha256, chain: 'empty_v1' });
      const oversized = contribution(initial, {
        decisionId: 'x'.repeat(
          PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumCanonicalContributionBytes,
        ),
        clusterId: 'cluster-a',
        drContribution: 0.25,
        weight: 1,
      });
      brands.contributionOwners.set(oversized, value.receipt);
      expect(buildPhase15SyntheticClusterStatisticMappingAuditV1({
        receipt: value.receipt,
        contributions: [oversized, value.contributions[1]],
      })).toEqual({
        status: 'not_evaluable', blocker: 'phase15_mapping_resource_limit_exceeded',
      });
      expect(summary).not.toHaveBeenCalled();
    } finally {
      summary.mockRestore();
    }
  });

  it('emits only a same-process diagnostics-only no-candidate handoff', () => {
    const mapped = buildPhase15SyntheticClusterStatisticMappingAuditV1(source());
    if (mapped.status !== 'verified') throw new Error(mapped.blocker);
    const phase14Handoff = freeze({
      handoffSha256: '6'.repeat(64),
      candidateSelectionStatus: 'no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
    });
    brands.phase14Handoffs.add(phase14Handoff);
    const built = buildPhase15SameProcessNoCandidateHandoffV1({
      phase14Handoff,
      mappingAudit: mapped.audit,
    });
    expect(built.status).toBe('verified');
    if (built.status !== 'verified') return;
    expect(built.handoff).toMatchObject({
      contractVersion: 'phase15_same_process_offline_diagnostic_handoff_v1',
      handoffScope: 'same_process_offline_diagnostic_v1',
      crossPhaseBindingStatus: 'not_assessed_no_common_binding',
      developmentStatus: 'completed_mapping_audit_no_candidate_selected',
      clusterStatisticMappingStatus: 'synthetic_mapping_verified',
      viewerClusterStatisticReadiness: 'not_ready',
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'no_candidate_selected',
      blockers: PHASE15_HANDOFF_BLOCKERS_V1,
    });
    expect(isVerifiedPhase15SameProcessNoCandidateHandoffV1(built.handoff)).toBe(true);
    expect(isVerifiedPhase15SameProcessNoCandidateHandoffV1(
      structuredClone(built.handoff),
    )).toBe(false);
    expect(buildPhase15SameProcessNoCandidateHandoffV1({
      phase14Handoff: structuredClone(phase14Handoff),
      mappingAudit: mapped.audit,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_handoff_source_unverified' });
    expect(buildPhase15SameProcessNoCandidateHandoffV1({
      phase14Handoff,
      mappingAudit: structuredClone(mapped.audit),
    })).toEqual({ status: 'not_evaluable', blocker: 'phase15_handoff_source_unverified' });
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase15SameProcessNoCandidateHandoffV1(hostile)).not.toThrow();
    expect(buildPhase15SameProcessNoCandidateHandoffV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase15_handoff_source_unverified',
    });
    for (const forbidden of ['seed', 'root', 'ledger', 'qualificationMethod', 'methodConfig']) {
      expect(forbidden in built.handoff).toBe(false);
    }
    expect(existsSync(path.resolve(
      process.cwd(),
      'src/services/recommendation/ope/inference/qualification/v5/index.ts',
    ))).toBe(false);
  });
});
