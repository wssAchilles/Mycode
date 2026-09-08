import { VIEWER_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import {
  isVerifiedSyntheticCohortTrajectoryEvidenceV1,
  type SyntheticCohortTrajectoryStepSummaryV1,
  type VerifiedSyntheticCohortTrajectoryEvidenceV1,
} from '../../../../../offlinePrediction/streamingV3';
import {
  isVerifiedPhase17SyntheticViewerClusterMappingAuditV1,
  type VerifiedPhase17SyntheticViewerClusterMappingAuditV1,
} from '../../v7/clusterMapping';
import {
  isVerifiedPhase17SameProcessNoCandidateHandoffV1,
  type Phase17SameProcessOfflineDiagnosticHandoffV1,
} from '../../v7/handoff';
import {
  comparePhase18Text,
  freezePhase18,
  isPhase18Frozen,
  phase18CanonicalBytes,
  phase18Digest,
} from '../privateCore';
import {
  PHASE18_SYNTHETIC_TIME_CLUSTER_UNIT_VERSION_V1,
  PHASE18_SYNTHETIC_TIME_SOURCE_VERSION_V1,
  PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE18_SYNTHETIC_VIEWER_TIME_PROVENANCE_V1,
  type Phase18SyntheticViewerTimeMembershipV1,
  type Phase18TimeProvenanceBlockerV1,
  type Phase18TimeProvenanceBuildResultV1,
  type VerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from './contracts';

export * from './contracts';

const PINNED_TRAJECTORY_SHA256 =
  '3851a49e2aa9a3fd9f30c3bf9e5bf5ad82a08f5361338d2860eea9d21febea4d';
const PINNED_OPE_RECEIPT_SHA256 =
  'a2919ba0d3547cbc79813c3ca6af956c6a3500d09c4e256719e1d81525b19b03';
const PINNED_PHASE17_MAPPING_SHA256 =
  '1aa8e6cc0f7c2d8366f210de4666d127f78b863d6a1bedd2293d6d0454f8bcca';
const PINNED_PHASE17_HANDOFF_SHA256 =
  '0efa97e7e37a8d7e8b199fb4e88885d43722d1818ec12d51aef80ba252dc16c2';

const FROZEN_MEMBERSHIP = Object.freeze([
  Object.freeze({
    decisionId: '00000000-0000-4000-8000-000000000001',
    viewerClusterId: 'phase16-viewer-cluster-0',
    timeClusterId: 'phase18-synthetic-time-0',
  }),
  Object.freeze({
    decisionId: '00000000-0000-4000-8000-000000000002',
    viewerClusterId: 'phase16-viewer-cluster-0',
    timeClusterId: 'phase18-synthetic-time-1',
  }),
  Object.freeze({
    decisionId: '00000000-0000-4000-8000-000000000003',
    viewerClusterId: 'phase16-viewer-cluster-1',
    timeClusterId: 'phase18-synthetic-time-0',
  }),
  Object.freeze({
    decisionId: '00000000-0000-4000-8000-000000000004',
    viewerClusterId: 'phase16-viewer-cluster-1',
    timeClusterId: 'phase18-synthetic-time-1',
  }),
] as const);

const membershipByDecisionId = new Map<string, (typeof FROZEN_MEMBERSHIP)[number]>(FROZEN_MEMBERSHIP.map((entry) => [
  entry.decisionId,
  entry,
]));
const verifiedProvenance = Symbol('verifiedPhase18SyntheticViewerTimeProvenanceV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase17Handoff: Phase17SameProcessOfflineDiagnosticHandoffV1;
  mappingAudit: VerifiedPhase17SyntheticViewerClusterMappingAuditV1;
  trajectoryEvidence: VerifiedSyntheticCohortTrajectoryEvidenceV1;
}>>();

type BrandedProvenance = VerifiedPhase18SyntheticViewerTimeProvenanceV1 & {
  readonly [verifiedProvenance]: true;
};
type NotEvaluableBlocker = Exclude<
  Phase18TimeProvenanceBlockerV1,
  'phase18_time_provenance_source_not_frozen'
>;

export function buildPhase18SyntheticViewerTimeProvenanceV1(
  input: unknown,
): Phase18TimeProvenanceBuildResultV1 {
  try {
    if (!input || typeof input !== 'object') {
      return reject('phase18_time_provenance_source_unverified');
    }
    const phase17Handoff = Reflect.get(input, 'phase17Handoff');
    if (!isVerifiedPhase17SameProcessNoCandidateHandoffV1(phase17Handoff)) {
      return reject('phase18_time_provenance_source_unverified');
    }
    const mappingAudit = Reflect.get(input, 'mappingAudit');
    if (!isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(mappingAudit)) {
      return reject('phase18_time_provenance_source_unverified');
    }
    const trajectoryEvidence = Reflect.get(input, 'trajectoryEvidence');
    if (!isVerifiedSyntheticCohortTrajectoryEvidenceV1(trajectoryEvidence)) {
      return reject('phase18_time_provenance_source_unverified');
    }
    const limits = PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1;

    if (trajectoryEvidence.expectedDecisionCount > limits.maximumDecisions
      || trajectoryEvidence.expectedViewerClusterCount > limits.maximumViewerClusters
      || trajectoryEvidence.expectedStepCount > limits.maximumSlots) {
      return reject('phase18_time_provenance_resource_limit_exceeded');
    }
    const copiedSteps = copyStepsWithinLimit(trajectoryEvidence);
    if ('blocker' in copiedSteps) return reject(copiedSteps.blocker);
    const membershipWorkUnits = copiedSteps.steps.length
      + trajectoryEvidence.expectedDecisionCount;
    if (membershipWorkUnits > limits.maximumMembershipWorkUnits) {
      return reject('phase18_time_provenance_resource_limit_exceeded');
    }

    const canonicalInputBytes = phase18CanonicalBytes({
      phase17HandoffSha256: phase17Handoff.handoffSha256,
      mappingSha256: mappingAudit.mappingSha256,
      trajectoryEvidenceSha256: trajectoryEvidence.trajectoryEvidenceSha256,
      steps: copiedSteps.steps,
    });
    if (canonicalInputBytes > limits.maximumCanonicalInputBytes) {
      return reject('phase18_time_provenance_resource_limit_exceeded');
    }
    if (!bindingsMatch(phase17Handoff, mappingAudit, trajectoryEvidence)) {
      return reject('phase18_time_provenance_binding_mismatch');
    }
    if (trajectoryEvidence.trajectoryEvidenceSha256 !== PINNED_TRAJECTORY_SHA256
      || mappingAudit.sourceBindings.receiptSha256 !== PINNED_OPE_RECEIPT_SHA256
      || mappingAudit.mappingSha256 !== PINNED_PHASE17_MAPPING_SHA256
      || phase17Handoff.handoffSha256 !== PINNED_PHASE17_HANDOFF_SHA256) {
      return {
        status: 'not_ready',
        blocker: 'phase18_time_provenance_source_not_frozen',
      };
    }

    const memberships = buildMemberships(copiedSteps.steps);
    if ('blocker' in memberships) return reject(memberships.blocker);
    const viewerClusterIds = [...new Set(memberships.memberships.map(
      (entry) => entry.viewerClusterId,
    ))].sort(comparePhase18Text);
    const timeClusterIds = [...new Set(memberships.memberships.map(
      (entry) => entry.timeClusterId,
    ))].sort(comparePhase18Text);
    if (viewerClusterIds.length !== 2 || timeClusterIds.length !== 2
      || memberships.memberships.length !== viewerClusterIds.length * timeClusterIds.length) {
      return reject('phase18_time_provenance_incomplete');
    }

    const preimage = {
      contractVersion: VERIFIED_PHASE18_SYNTHETIC_VIEWER_TIME_PROVENANCE_V1,
      estimand: 'mean_reward_per_logged_slot_v1' as const,
      sourceClusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
      timeClusterUnitVersion: PHASE18_SYNTHETIC_TIME_CLUSTER_UNIT_VERSION_V1,
      syntheticSourceVersion: PHASE18_SYNTHETIC_TIME_SOURCE_VERSION_V1,
      provenanceStatus: 'verified_synthetic_fixture_only' as const,
      syntheticTimeMembershipStatus: 'verified_synthetic_partition_only' as const,
      syntheticViewerTimeMembershipPresent: true as const,
      completeCrossedGrid: true as const,
      commonTimeShockHandlingVerified: false as const,
      realMultiwayClusterProvenancePresent: false as const,
      multiwayTrainingEvidencePresent: false as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      viewerClusterIds,
      timeClusterIds,
      memberships: memberships.memberships,
      sourceBindings: {
        phase17HandoffSha256: phase17Handoff.handoffSha256,
        phase17MappingSha256: mappingAudit.mappingSha256,
        trajectoryEvidenceSha256: trajectoryEvidence.trajectoryEvidenceSha256,
        opeReceiptSha256: mappingAudit.sourceBindings.receiptSha256,
        predictionSetVersion: trajectoryEvidence.predictionSetVersion,
        predictionVerificationReceiptSha256:
          trajectoryEvidence.predictionVerificationReceiptSha256,
        holdoutPlanSha256: trajectoryEvidence.holdoutPlanSha256,
        modelBundleSha256: trajectoryEvidence.modelBundleSha256,
        predictionStreamSha256: trajectoryEvidence.predictionStreamSha256,
        decisionContextEvidenceSha256: trajectoryEvidence.decisionContextEvidenceSha256,
        syntheticDecisionLogRootSha256: trajectoryEvidence.syntheticDecisionLogRootSha256,
        syntheticOutcomeEvidenceRootSha256:
          trajectoryEvidence.syntheticOutcomeEvidenceRootSha256,
      },
      resourceDiagnostics: {
        preflightCompletedBeforeMembershipScan: true as const,
        decisions: memberships.memberships.length,
        slots: copiedSteps.steps.length,
        viewerClusters: viewerClusterIds.length,
        timeClusters: timeClusterIds.length,
        canonicalInputBytes,
        membershipWorkUnits,
      },
    };
    const candidate = {
      ...preimage,
      provenanceSha256: phase18Digest(preimage),
    } as unknown as BrandedProvenance;
    Object.defineProperty(candidate, verifiedProvenance, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    const owners = Object.freeze({ phase17Handoff, mappingAudit, trajectoryEvidence });
    verifiedObjects.add(candidate);
    freezePhase18(candidate);
    verifiedDigests.set(candidate, candidate.provenanceSha256);
    verifiedOwners.set(candidate, owners);
    return { status: 'verified', provenance: candidate };
  } catch {
    return reject('phase18_time_provenance_source_unverified');
  }
}

export function isVerifiedPhase18SyntheticViewerTimeProvenanceV1(
  value: unknown,
): value is BrandedProvenance {
  try {
    if (!value || typeof value !== 'object' || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedProvenance;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase17SameProcessNoCandidateHandoffV1(owners.phase17Handoff)
      || !isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(owners.mappingAudit)
      || !isVerifiedSyntheticCohortTrajectoryEvidenceV1(owners.trajectoryEvidence)
      || !bindingsMatch(owners.phase17Handoff, owners.mappingAudit, owners.trajectoryEvidence)
      || owners.phase17Handoff.handoffSha256 !== PINNED_PHASE17_HANDOFF_SHA256
      || owners.mappingAudit.mappingSha256 !== PINNED_PHASE17_MAPPING_SHA256
      || owners.mappingAudit.sourceBindings.receiptSha256 !== PINNED_OPE_RECEIPT_SHA256
      || owners.trajectoryEvidence.trajectoryEvidenceSha256 !== PINNED_TRAJECTORY_SHA256) {
      return false;
    }
    const { provenanceSha256, ...preimage } = candidate;
    return candidate[verifiedProvenance] === true
      && isPhase18Frozen(candidate)
      && provenanceSha256 === phase18Digest(preimage)
      && verifiedDigests.get(candidate) === provenanceSha256
      && candidate.sourceBindings.phase17HandoffSha256 === owners.phase17Handoff.handoffSha256
      && candidate.sourceBindings.phase17MappingSha256 === owners.mappingAudit.mappingSha256
      && candidate.sourceBindings.trajectoryEvidenceSha256
        === owners.trajectoryEvidence.trajectoryEvidenceSha256
      && candidate.sourceBindings.opeReceiptSha256 === PINNED_OPE_RECEIPT_SHA256;
  } catch {
    return false;
  }
}

function bindingsMatch(
  phase17Handoff: Phase17SameProcessOfflineDiagnosticHandoffV1,
  mappingAudit: VerifiedPhase17SyntheticViewerClusterMappingAuditV1,
  trajectoryEvidence: VerifiedSyntheticCohortTrajectoryEvidenceV1,
): boolean {
  return phase17Handoff.phase17MappingSha256 === mappingAudit.mappingSha256
    && mappingAudit.estimand === 'mean_reward_per_logged_slot_v1'
    && mappingAudit.mappingStatus === 'verified_synthetic_viewer_cluster_mapping_only'
    && mappingAudit.viewerClusterCrossFitProvenancePresent
    && !mappingAudit.independentViewerClustersVerified
    && !mappingAudit.commonTimeShockHandlingVerified
    && !mappingAudit.multiwayClusterProvenancePresent
    && !mappingAudit.candidateEvidenceEligible
    && !mappingAudit.qualificationEvidenceEligible
    && !mappingAudit.realDatasetEligible
    && !mappingAudit.servable
    && phase17Handoff.predictionSetVersion === trajectoryEvidence.predictionSetVersion
    && phase17Handoff.predictionVerificationReceiptSha256
      === trajectoryEvidence.predictionVerificationReceiptSha256
    && mappingAudit.predictionBinding.predictionSetVersion
      === trajectoryEvidence.predictionSetVersion
    && mappingAudit.predictionBinding.predictionVerificationReceiptSha256
      === trajectoryEvidence.predictionVerificationReceiptSha256
    && mappingAudit.predictionBinding.holdoutPlanSha256
      === trajectoryEvidence.holdoutPlanSha256
    && mappingAudit.sourceBindings.trajectoryEvidenceSha256
      === trajectoryEvidence.trajectoryEvidenceSha256
    && mappingAudit.sourceBindings.modelBundleSha256 === trajectoryEvidence.modelBundleSha256
    && mappingAudit.sourceBindings.predictionStreamSha256
      === trajectoryEvidence.predictionStreamSha256
    && mappingAudit.sourceBindings.snapshotManifestSha256
      === trajectoryEvidence.snapshotManifestSha256
    && mappingAudit.sourceBindings.targetManifestSha256
      === trajectoryEvidence.targetManifestSha256
    && mappingAudit.sourceBindings.targetVerificationReceiptSha256
      === trajectoryEvidence.targetVerificationReceiptSha256
    && mappingAudit.sourceBindings.targetDistributionNdjsonSha256
      === trajectoryEvidence.targetDistributionNdjsonSha256
    && mappingAudit.sourceBindings.decisionContextEvidenceSha256
      === trajectoryEvidence.decisionContextEvidenceSha256
    && mappingAudit.sourceBindings.syntheticDecisionLogRootSha256
      === trajectoryEvidence.syntheticDecisionLogRootSha256
    && mappingAudit.sourceBindings.syntheticOutcomeEvidenceRootSha256
      === trajectoryEvidence.syntheticOutcomeEvidenceRootSha256
    && mappingAudit.sourceClusterUnitVersion === trajectoryEvidence.sourceClusterUnitVersion
    && mappingAudit.sourceClusterUnitVersion === VIEWER_CLUSTER_UNIT_VERSION
    && trajectoryEvidence.sourceClusterUnitVersion === VIEWER_CLUSTER_UNIT_VERSION
    && mappingAudit.scope.objective === 'synthetic_dwell'
    && trajectoryEvidence.viewerClusterCrossFitProvenancePresent
    && !trajectoryEvidence.commonTimeShockHandlingVerified
    && !trajectoryEvidence.multiwayClusterProvenancePresent
    && !trajectoryEvidence.candidateEvidenceEligible
    && !trajectoryEvidence.qualificationEvidenceEligible
    && !trajectoryEvidence.realDatasetEligible
    && !trajectoryEvidence.servable
    && trajectoryEvidence.expectedDecisionCount === FROZEN_MEMBERSHIP.length
    && trajectoryEvidence.expectedViewerClusterCount === 2
    && trajectoryEvidence.expectedStepCount === 2 * FROZEN_MEMBERSHIP.length
    && trajectoryEvidence.expectedPredictionCount === 20
    && trajectoryEvidence.resourceDiagnostics.decisionCount === 4
    && trajectoryEvidence.resourceDiagnostics.viewerClusterCount === 2
    && trajectoryEvidence.resourceDiagnostics.slotCount === 8
    && mappingAudit.resourceDiagnostics.slotContributions === trajectoryEvidence.expectedStepCount
    && mappingAudit.resourceDiagnostics.clusters === trajectoryEvidence.expectedViewerClusterCount
    && mappingAudit.clusterRows.length === trajectoryEvidence.expectedViewerClusterCount;
}

function copyStepsWithinLimit(
  trajectoryEvidence: VerifiedSyntheticCohortTrajectoryEvidenceV1,
): Readonly<{ steps: readonly SyntheticCohortTrajectoryStepSummaryV1[] }>
  | Readonly<{ blocker: NotEvaluableBlocker }> {
  try {
    const source = Reflect.get(trajectoryEvidence, 'steps');
    if (!Array.isArray(source)) return { blocker: 'phase18_time_provenance_source_unverified' };
    const length = Reflect.get(source, 'length');
    if (!Number.isSafeInteger(length) || length < 0) {
      return { blocker: 'phase18_time_provenance_source_unverified' };
    }
    if (length > PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1.maximumSlots) {
      return { blocker: 'phase18_time_provenance_resource_limit_exceeded' };
    }
    const steps: SyntheticCohortTrajectoryStepSummaryV1[] = [];
    for (let index = 0; index < length; index += 1) {
      steps.push(Reflect.get(source, index) as SyntheticCohortTrajectoryStepSummaryV1);
    }
    return { steps: Object.freeze(steps) };
  } catch {
    return { blocker: 'phase18_time_provenance_source_unverified' };
  }
}

function buildMemberships(
  steps: readonly SyntheticCohortTrajectoryStepSummaryV1[],
): Readonly<{ memberships: readonly Phase18SyntheticViewerTimeMembershipV1[] }>
  | Readonly<{ blocker: NotEvaluableBlocker }> {
  const grouped = new Map<string, {
    requestId: string;
    viewerClusterId: string;
    viewerFoldId: 0 | 1;
    positions: Map<number, string>;
  }>();
  for (const step of steps) {
    const fixed = membershipByDecisionId.get(step.decisionId);
    if (!fixed || fixed.viewerClusterId !== step.inferenceClusterId
      || !step.requestId || (step.foldId !== 0 && step.foldId !== 1)
      || !Number.isSafeInteger(step.servedPosition) || step.servedPosition < 0
      || !/^[0-9a-f]{64}$/.test(step.joinedStepSha256)) {
      return { blocker: 'phase18_time_provenance_fixture_mismatch' };
    }
    const current = grouped.get(step.decisionId) ?? {
      requestId: step.requestId,
      viewerClusterId: step.inferenceClusterId,
      viewerFoldId: step.foldId,
      positions: new Map<number, string>(),
    };
    if (current.requestId !== step.requestId
      || current.viewerClusterId !== step.inferenceClusterId
      || current.viewerFoldId !== step.foldId
      || current.positions.has(step.servedPosition)) {
      return { blocker: 'phase18_time_provenance_incomplete' };
    }
    current.positions.set(step.servedPosition, step.joinedStepSha256);
    grouped.set(step.decisionId, current);
  }
  if (grouped.size !== FROZEN_MEMBERSHIP.length
    || steps.length !== 2 * FROZEN_MEMBERSHIP.length) {
    return { blocker: 'phase18_time_provenance_incomplete' };
  }
  const memberships: Phase18SyntheticViewerTimeMembershipV1[] = [];
  for (const fixed of FROZEN_MEMBERSHIP) {
    const current = grouped.get(fixed.decisionId);
    if (!current || current.positions.size !== 2) {
      return { blocker: 'phase18_time_provenance_incomplete' };
    }
    const positions = [...current.positions.entries()].sort(([left], [right]) => left - right);
    memberships.push({
      decisionId: fixed.decisionId,
      requestId: current.requestId,
      viewerClusterId: fixed.viewerClusterId,
      viewerFoldId: current.viewerFoldId,
      timeClusterId: fixed.timeClusterId,
      servedPositions: positions.map(([position]) => position),
      joinedStepSha256s: positions.map(([, sha256]) => sha256),
    });
  }
  memberships.sort((left, right) => comparePhase18Text(left.decisionId, right.decisionId));
  return { memberships: freezePhase18(memberships) };
}

function reject(
  blocker: NotEvaluableBlocker,
): Phase18TimeProvenanceBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
