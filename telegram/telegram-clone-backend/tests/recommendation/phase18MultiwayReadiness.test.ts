import { describe, expect, it, vi } from 'vitest';

const brands = vi.hoisted(() => ({
  trajectories: new WeakSet<object>(),
  mappings: new WeakSet<object>(),
  handoffs: new WeakSet<object>(),
}));

vi.mock('../../src/services/recommendation/offlinePrediction/streamingV3', async (importOriginal) => ({
  ...(await importOriginal<typeof import(
    '../../src/services/recommendation/offlinePrediction/streamingV3'
  )>()),
  isVerifiedSyntheticCohortTrajectoryEvidenceV1: (value: unknown) => (
    !!value && typeof value === 'object' && brands.trajectories.has(value)
  ),
}));

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v7/clusterMapping',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v7/clusterMapping'
    )>()),
    isVerifiedPhase17SyntheticViewerClusterMappingAuditV1: (value: unknown) => (
      !!value && typeof value === 'object' && brands.mappings.has(value)
    ),
  }),
);

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v7/handoff',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v7/handoff'
    )>()),
    isVerifiedPhase17SameProcessNoCandidateHandoffV1: (value: unknown) => (
      !!value && typeof value === 'object' && brands.handoffs.has(value)
    ),
  }),
);

import {
  buildPhase18MultiwayHoldoutPlanAuditV1,
  isVerifiedPhase18MultiwayHoldoutPlanAuditV1,
  PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/multiwayHoldout';
import {
  buildPhase18SameProcessNoCandidateHandoffV1,
  isVerifiedPhase18SameProcessNoCandidateHandoffV1,
  PHASE18_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/handoff';
import {
  buildPhase18SyntheticViewerTimeProvenanceV1,
  isVerifiedPhase18SyntheticViewerTimeProvenanceV1,
  PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/timeProvenance';

const trajectorySha256 =
  '3851a49e2aa9a3fd9f30c3bf9e5bf5ad82a08f5361338d2860eea9d21febea4d';
const receiptSha256 =
  'a2919ba0d3547cbc79813c3ca6af956c6a3500d09c4e256719e1d81525b19b03';
const mappingSha256 =
  '1aa8e6cc0f7c2d8366f210de4666d127f78b863d6a1bedd2293d6d0454f8bcca';
const handoffSha256 =
  '0efa97e7e37a8d7e8b199fb4e88885d43722d1818ec12d51aef80ba252dc16c2';
const predictionReceiptSha256 =
  'a6d5d2d86eeabdd2dbd919a78a52874ffe8443f1c13ed8d3b0b2abdbd58bf009';
const holdoutPlanSha256 = 'b'.repeat(64);
const rootSha256 = 'c'.repeat(64);

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function source() {
  const decisionIds = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const viewerClusters = [
    'phase16-viewer-cluster-0',
    'phase16-viewer-cluster-0',
    'phase16-viewer-cluster-1',
    'phase16-viewer-cluster-1',
  ];
  const steps = decisionIds.flatMap((decisionId, decisionIndex) => [1, 2].map((position) => ({
    decisionId,
    requestId: `request-${decisionIndex}`,
    inferenceClusterId: viewerClusters[decisionIndex],
    foldId: decisionIndex < 2 ? 0 as const : 1 as const,
    servedPosition: position,
    joinedStepSha256: String(decisionIndex * 2 + position).padStart(64, '0'),
  })));
  const trajectory = freeze({
    trajectoryEvidenceSha256: trajectorySha256,
    predictionSetVersion: 'phase16-prediction-v3',
    predictionVerificationReceiptSha256: predictionReceiptSha256,
    modelBundleSha256: 'd'.repeat(64),
    predictionStreamSha256: 'e'.repeat(64),
    snapshotManifestSha256: 'f'.repeat(64),
    targetManifestSha256: '1'.repeat(64),
    targetVerificationReceiptSha256: '2'.repeat(64),
    targetDistributionNdjsonSha256: '3'.repeat(64),
    decisionContextEvidenceSha256: '4'.repeat(64),
    syntheticDecisionLogRootSha256: rootSha256,
    syntheticOutcomeEvidenceRootSha256: '5'.repeat(64),
    holdoutPlanSha256,
    sourceClusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
    viewerClusterCrossFitProvenancePresent: true as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    expectedDecisionCount: 4,
    expectedViewerClusterCount: 2,
    expectedStepCount: 8,
    expectedPredictionCount: 20,
    resourceDiagnostics: {
      decisionCount: 4,
      viewerClusterCount: 2,
      slotCount: 8,
    },
    steps,
  });
  const mapping = freeze({
    mappingSha256,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    mappingStatus: 'verified_synthetic_viewer_cluster_mapping_only' as const,
    viewerClusterCrossFitProvenancePresent: true as const,
    independentViewerClustersVerified: false as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    sourceClusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
    sourceBindings: {
      receiptSha256,
      trajectoryEvidenceSha256: trajectorySha256,
      modelBundleSha256: trajectory.modelBundleSha256,
      predictionStreamSha256: trajectory.predictionStreamSha256,
      snapshotManifestSha256: trajectory.snapshotManifestSha256,
      targetManifestSha256: trajectory.targetManifestSha256,
      targetVerificationReceiptSha256: trajectory.targetVerificationReceiptSha256,
      targetDistributionNdjsonSha256: trajectory.targetDistributionNdjsonSha256,
      decisionContextEvidenceSha256: trajectory.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: trajectory.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: trajectory.syntheticOutcomeEvidenceRootSha256,
    },
    predictionBinding: {
      predictionSetVersion: trajectory.predictionSetVersion,
      predictionVerificationReceiptSha256: predictionReceiptSha256,
      holdoutPlanSha256,
    },
    scope: { objective: 'synthetic_dwell' },
    clusterRows: [{ inferenceClusterId: viewerClusters[0] }, { inferenceClusterId: viewerClusters[2] }],
    resourceDiagnostics: { slotContributions: 8, clusters: 2 },
  });
  const phase17Handoff = freeze({
    handoffSha256,
    phase17MappingSha256: mappingSha256,
    predictionSetVersion: trajectory.predictionSetVersion,
    predictionVerificationReceiptSha256: predictionReceiptSha256,
    candidateSelectionStatus: 'no_candidate_selected' as const,
    selectedMethod: 'diagnostics_only_abstention_v1' as const,
  });
  brands.trajectories.add(trajectory);
  brands.mappings.add(mapping);
  brands.handoffs.add(phase17Handoff);
  return { trajectory, mapping, phase17Handoff, steps };
}

describe('Phase 18 multiway readiness boundary', () => {
  it('builds a synthetic-only source, exact union plan, and honest handoff', () => {
    const value = source();
    const provenance = buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: value.phase17Handoff,
      mappingAudit: value.mapping,
      trajectoryEvidence: value.trajectory,
    });
    expect(provenance.status).toBe('verified');
    if (provenance.status !== 'verified') return;
    expect(provenance.provenance.memberships.map((entry) => entry.timeClusterId)).toEqual([
      'phase18-synthetic-time-0',
      'phase18-synthetic-time-1',
      'phase18-synthetic-time-0',
      'phase18-synthetic-time-1',
    ]);
    const plan = buildPhase18MultiwayHoldoutPlanAuditV1({ provenance: provenance.provenance });
    expect(plan.status).toBe('verified');
    if (plan.status !== 'verified') return;
    expect(plan.audit.cells.map((cell) => [
      cell.evaluationDecisionIds,
      cell.trainingDecisionIds,
      cell.guardBandDecisionIds,
      cell.excludedDecisionIds,
    ])).toEqual([
      [
        [value.steps[0]!.decisionId],
        [value.steps[6]!.decisionId],
        [value.steps[2]!.decisionId, value.steps[4]!.decisionId],
        [value.steps[0]!.decisionId, value.steps[2]!.decisionId, value.steps[4]!.decisionId],
      ],
      [
        [value.steps[2]!.decisionId],
        [value.steps[4]!.decisionId],
        [value.steps[0]!.decisionId, value.steps[6]!.decisionId],
        [value.steps[0]!.decisionId, value.steps[2]!.decisionId, value.steps[6]!.decisionId],
      ],
      [
        [value.steps[4]!.decisionId],
        [value.steps[2]!.decisionId],
        [value.steps[0]!.decisionId, value.steps[6]!.decisionId],
        [value.steps[0]!.decisionId, value.steps[4]!.decisionId, value.steps[6]!.decisionId],
      ],
      [
        [value.steps[6]!.decisionId],
        [value.steps[0]!.decisionId],
        [value.steps[2]!.decisionId, value.steps[4]!.decisionId],
        [value.steps[2]!.decisionId, value.steps[4]!.decisionId, value.steps[6]!.decisionId],
      ],
    ]);
    expect(plan.audit).toMatchObject({
      trainingApplied: false,
      multiwayQHatProvenanceStatus: 'plan_only_not_verified',
      dgpV2LaunchReadiness: 'not_ready',
    });
    const handoff = buildPhase18SameProcessNoCandidateHandoffV1({
      phase17Handoff: value.phase17Handoff,
      provenance: provenance.provenance,
      plan: plan.audit,
    });
    expect(handoff.status).toBe('verified');
    if (handoff.status !== 'verified') return;
    expect(handoff.handoff).toMatchObject({
      selectedMethod: 'diagnostics_only_abstention_v1',
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      multiwayQHatProvenanceStatus: 'plan_only_not_verified',
      dgpV2LaunchReadiness: 'not_ready',
      nextPhaseHandoff: 'multiway_qhat_evidence_incomplete',
      blockers: PHASE18_HANDOFF_BLOCKERS_V1,
    });
    expect(isVerifiedPhase18SyntheticViewerTimeProvenanceV1(provenance.provenance)).toBe(true);
    expect(isVerifiedPhase18MultiwayHoldoutPlanAuditV1(plan.audit)).toBe(true);
    expect(isVerifiedPhase18SameProcessNoCandidateHandoffV1(handoff.handoff)).toBe(true);
    expect(isVerifiedPhase18SyntheticViewerTimeProvenanceV1(
      structuredClone(provenance.provenance),
    )).toBe(false);
    expect(isVerifiedPhase18MultiwayHoldoutPlanAuditV1(structuredClone(plan.audit))).toBe(false);
    expect(isVerifiedPhase18SameProcessNoCandidateHandoffV1(structuredClone(handoff.handoff)))
      .toBe(false);
    const handoffReads: PropertyKey[] = [];
    const invalidHandoffInput = new Proxy({}, {
      get: (_target, property) => {
        handoffReads.push(property);
        if (property === 'phase17Handoff') return {};
        throw new Error('later handoff getter must not run');
      },
    });
    expect(buildPhase18SameProcessNoCandidateHandoffV1(invalidHandoffInput)).toEqual({
      status: 'not_evaluable', blocker: 'phase18_handoff_source_unverified',
    });
    expect(handoffReads).toEqual(['phase17Handoff']);
  });

  it('fails closed for hostile, drifted, and over-limit sources before scanning rows', () => {
    const value = source();
    const hostile = new Proxy({}, { get: () => { throw new Error('hostile getter'); } });
    expect(() => buildPhase18SyntheticViewerTimeProvenanceV1(hostile)).not.toThrow();
    expect(buildPhase18SyntheticViewerTimeProvenanceV1(hostile)).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_source_unverified',
    });
    const provenanceReads: PropertyKey[] = [];
    const invalidProvenanceInput = new Proxy({}, {
      get: (_target, property) => {
        provenanceReads.push(property);
        if (property === 'phase17Handoff') return {};
        throw new Error('later provenance getter must not run');
      },
    });
    expect(buildPhase18SyntheticViewerTimeProvenanceV1(invalidProvenanceInput)).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_source_unverified',
    });
    expect(provenanceReads).toEqual(['phase17Handoff']);
    expect(buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: structuredClone(value.phase17Handoff),
      mappingAudit: value.mapping,
      trajectoryEvidence: value.trajectory,
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_source_unverified',
    });

    let elementRead = false;
    const oversizedSteps = new Proxy(new Array(
      PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1.maximumSlots + 1,
    ), {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && /^\d+$/.test(property)) elementRead = true;
        return Reflect.get(target, property, receiver);
      },
    });
    const oversizedTrajectory = freeze({
      ...value.trajectory,
      steps: oversizedSteps,
    });
    brands.trajectories.add(oversizedTrajectory);
    expect(buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: value.phase17Handoff,
      mappingAudit: value.mapping,
      trajectoryEvidence: oversizedTrajectory,
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_resource_limit_exceeded',
    });
    expect(elementRead).toBe(false);

    const otherTrajectory = freeze({
      ...value.trajectory,
      trajectoryEvidenceSha256: '9'.repeat(64),
    });
    const otherMapping = freeze({
      ...value.mapping,
      mappingSha256: '8'.repeat(64),
      sourceBindings: {
        ...value.mapping.sourceBindings,
        trajectoryEvidenceSha256: otherTrajectory.trajectoryEvidenceSha256,
      },
    });
    const otherHandoff = freeze({
      ...value.phase17Handoff,
      handoffSha256: '7'.repeat(64),
      phase17MappingSha256: otherMapping.mappingSha256,
    });
    brands.trajectories.add(otherTrajectory);
    brands.mappings.add(otherMapping);
    brands.handoffs.add(otherHandoff);
    expect(buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: otherHandoff,
      mappingAudit: otherMapping,
      trajectoryEvidence: otherTrajectory,
    })).toEqual({
      status: 'not_ready', blocker: 'phase18_time_provenance_source_not_frozen',
    });

    const driftedMapping = freeze({ ...value.mapping, estimand: 'other_estimand_v1' });
    brands.mappings.add(driftedMapping);
    expect(buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: value.phase17Handoff,
      mappingAudit: driftedMapping,
      trajectoryEvidence: value.trajectory,
    })).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_binding_mismatch',
    });
  });

  it('rejects an unbranded trajectory clone while keeping the generated plan plan-only', () => {
    const value = source();
    const reorderedTrajectory = freeze({ ...value.trajectory, steps: [...value.steps].reverse() });
    const first = buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: value.phase17Handoff,
      mappingAudit: value.mapping,
      trajectoryEvidence: value.trajectory,
    });
    const second = buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: value.phase17Handoff,
      mappingAudit: value.mapping,
      trajectoryEvidence: reorderedTrajectory,
    });
    expect(first.status).toBe('verified');
    expect(second).toEqual({
      status: 'not_evaluable', blocker: 'phase18_time_provenance_source_unverified',
    });
    if (first.status !== 'verified') return;
    const plan = buildPhase18MultiwayHoldoutPlanAuditV1({ provenance: first.provenance });
    expect(plan.status).toBe('verified');
    if (plan.status !== 'verified') return;
    expect(plan.audit.trainingApplied).toBe(false);
  });

  it('keeps provenance and plan digests independent of time, timezone, RNG, and input keys', () => {
    const value = source();
    const originalTimezone = process.env.TZ;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Phase 18 must not use RNG');
    });
    vi.useFakeTimers();
    try {
      process.env.TZ = 'UTC';
      vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
      const first = buildPhase18SyntheticViewerTimeProvenanceV1({
        phase17Handoff: value.phase17Handoff,
        mappingAudit: value.mapping,
        trajectoryEvidence: value.trajectory,
      });

      process.env.TZ = 'Pacific/Honolulu';
      vi.setSystemTime(new Date('2040-12-31T23:59:59.000Z'));
      const second = buildPhase18SyntheticViewerTimeProvenanceV1({
        trajectoryEvidence: value.trajectory,
        mappingAudit: value.mapping,
        phase17Handoff: value.phase17Handoff,
      });

      expect(first.status).toBe('verified');
      expect(second.status).toBe('verified');
      if (first.status !== 'verified' || second.status !== 'verified') return;
      expect(second.provenance.provenanceSha256).toBe(first.provenance.provenanceSha256);
      expect(second.provenance.memberships).toEqual(first.provenance.memberships);
      const firstPlan = buildPhase18MultiwayHoldoutPlanAuditV1({
        provenance: first.provenance,
      });
      const secondPlan = buildPhase18MultiwayHoldoutPlanAuditV1({
        provenance: second.provenance,
      });
      expect(firstPlan.status).toBe('verified');
      expect(secondPlan.status).toBe('verified');
      if (firstPlan.status !== 'verified' || secondPlan.status !== 'verified') return;
      expect(secondPlan.audit.planSha256).toBe(firstPlan.audit.planSha256);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('does not expose a configurable bootstrap, candidate, or production capability', () => {
    expect('bootstrapReplicates' in PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1).toBe(false);
    expect('candidateMethod' in PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1).toBe(false);
    expect('production' in PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1).toBe(false);
  });
});
