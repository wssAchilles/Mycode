import {
  isVerifiedPhase18SyntheticViewerTimeProvenanceV1,
  type Phase18SyntheticViewerTimeMembershipV1,
  type VerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../timeProvenance';
import {
  comparePhase18Text,
  freezePhase18,
  isPhase18Frozen,
  phase18CanonicalBytes,
  phase18Digest,
} from '../privateCore';
import {
  PHASE18_MULTIWAY_CELL_DIGEST_DOMAIN_V1,
  PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1,
  PHASE18_TIME_MEMBERSHIP_DIGEST_DOMAIN_V1,
  PHASE18_VIEWER_MEMBERSHIP_DIGEST_DOMAIN_V1,
  VERIFIED_PHASE18_MULTIWAY_HOLDOUT_PLAN_AUDIT_V1,
  type Phase18MultiwayHoldoutBlockerV1,
  type Phase18MultiwayHoldoutBuildResultV1,
  type Phase18MultiwayHoldoutCellV1,
  type VerifiedPhase18MultiwayHoldoutPlanAuditV1,
} from './contracts';

export * from './contracts';

const verifiedPlan = Symbol('verifiedPhase18MultiwayHoldoutPlanAuditV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, VerifiedPhase18SyntheticViewerTimeProvenanceV1>();

type BrandedPlan = VerifiedPhase18MultiwayHoldoutPlanAuditV1 & {
  readonly [verifiedPlan]: true;
};

export function buildPhase18MultiwayHoldoutPlanAuditV1(
  input: unknown,
): Phase18MultiwayHoldoutBuildResultV1 {
  try {
    const provenance = planInput(input);
    if (!isVerifiedPhase18SyntheticViewerTimeProvenanceV1(provenance)) {
      return reject('phase18_multiway_holdout_source_unverified');
    }
    if (!provenance.syntheticViewerTimeMembershipPresent
      || provenance.commonTimeShockHandlingVerified
      || provenance.realMultiwayClusterProvenancePresent
      || provenance.multiwayTrainingEvidencePresent) {
      return reject('phase18_multiway_holdout_binding_mismatch');
    }
    const limits = PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1;
    const decisionCount = provenance.memberships.length;
    const viewerClusterCount = provenance.viewerClusterIds.length;
    const timeClusterCount = provenance.timeClusterIds.length;
    const evaluationCellCount = viewerClusterCount * timeClusterCount;
    const planWorkUnits = evaluationCellCount * decisionCount;
    if (decisionCount > limits.maximumDecisions
      || viewerClusterCount > limits.maximumViewerClusters
      || timeClusterCount > limits.maximumTimeClusters
      || evaluationCellCount > limits.maximumEvaluationCells
      || planWorkUnits > limits.maximumPlanWorkUnits) {
      return reject('phase18_multiway_holdout_resource_limit_exceeded');
    }
    const canonicalInputBytes = phase18CanonicalBytes(provenance);
    if (canonicalInputBytes > limits.maximumCanonicalInputBytes) {
      return reject('phase18_multiway_holdout_resource_limit_exceeded');
    }
    const memberships = [...provenance.memberships].sort((left, right) => (
      comparePhase18Text(left.decisionId, right.decisionId)
    ));
    const cells: Phase18MultiwayHoldoutCellV1[] = [];
    for (const viewerClusterId of provenance.viewerClusterIds) {
      for (const timeClusterId of provenance.timeClusterIds) {
        const built = buildCell(viewerClusterId, timeClusterId, memberships);
        if (!built) return reject('phase18_multiway_holdout_union_exclusion_invalid');
        cells.push(built);
      }
    }
    if (cells.length !== evaluationCellCount) {
      return reject('phase18_multiway_holdout_union_exclusion_invalid');
    }

    const viewerMembershipSha256 = phase18Digest({
      domain: PHASE18_VIEWER_MEMBERSHIP_DIGEST_DOMAIN_V1,
      memberships: memberships.map(({ decisionId, viewerClusterId }) => ({
        decisionId,
        viewerClusterId,
      })),
    });
    const timeMembershipSha256 = phase18Digest({
      domain: PHASE18_TIME_MEMBERSHIP_DIGEST_DOMAIN_V1,
      memberships: memberships.map(({ decisionId, timeClusterId }) => ({
        decisionId,
        timeClusterId,
      })),
    });
    const preimage = {
      contractVersion: VERIFIED_PHASE18_MULTIWAY_HOLDOUT_PLAN_AUDIT_V1,
      estimand: provenance.estimand,
      sourceClusterUnitVersion: provenance.sourceClusterUnitVersion,
      timeClusterUnitVersion: provenance.timeClusterUnitVersion,
      auditStatus: 'verified_plan_only' as const,
      unionExclusionVerified: true as const,
      sameViewerLeakageExcludedInPlan: true as const,
      sameTimeLeakageExcludedInPlan: true as const,
      trainingApplied: false as const,
      multiwayQHatProvenanceStatus: 'plan_only_not_verified' as const,
      dgpV2LaunchReadiness: 'not_ready' as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      provenanceSha256: provenance.provenanceSha256,
      phase17HandoffSha256: provenance.sourceBindings.phase17HandoffSha256,
      phase17MappingSha256: provenance.sourceBindings.phase17MappingSha256,
      predictionVerificationReceiptSha256:
        provenance.sourceBindings.predictionVerificationReceiptSha256,
      viewerMembershipSha256,
      timeMembershipSha256,
      cells,
      resourceDiagnostics: {
        preflightCompletedBeforeCellEnumeration: true as const,
        decisions: decisionCount,
        viewerClusters: viewerClusterCount,
        timeClusters: timeClusterCount,
        evaluationCells: evaluationCellCount,
        canonicalInputBytes,
        planWorkUnits,
      },
    };
    const candidate = {
      ...preimage,
      planSha256: phase18Digest(preimage),
    } as unknown as BrandedPlan;
    Object.defineProperty(candidate, verifiedPlan, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    freezePhase18(candidate);
    verifiedDigests.set(candidate, candidate.planSha256);
    verifiedOwners.set(candidate, provenance);
    return { status: 'verified', audit: candidate };
  } catch {
    return reject('phase18_multiway_holdout_source_unverified');
  }
}

export function isVerifiedPhase18MultiwayHoldoutPlanAuditV1(
  value: unknown,
): value is BrandedPlan {
  try {
    if (!value || typeof value !== 'object' || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedPlan;
    const owner = verifiedOwners.get(candidate);
    if (!owner || !isVerifiedPhase18SyntheticViewerTimeProvenanceV1(owner)) return false;
    const { planSha256, ...preimage } = candidate;
    return candidate[verifiedPlan] === true
      && isPhase18Frozen(candidate)
      && planSha256 === phase18Digest(preimage)
      && verifiedDigests.get(candidate) === planSha256
      && candidate.provenanceSha256 === owner.provenanceSha256
      && candidate.phase17HandoffSha256 === owner.sourceBindings.phase17HandoffSha256
      && candidate.phase17MappingSha256 === owner.sourceBindings.phase17MappingSha256;
  } catch {
    return false;
  }
}

function buildCell(
  viewerClusterId: string,
  timeClusterId: string,
  memberships: readonly Phase18SyntheticViewerTimeMembershipV1[],
): Phase18MultiwayHoldoutCellV1 | null {
  const evaluationDecisionIds: string[] = [];
  const trainingDecisionIds: string[] = [];
  const guardBandDecisionIds: string[] = [];
  const membershipByDecisionId = new Map(
    memberships.map((membership) => [membership.decisionId, membership]),
  );
  for (const membership of memberships) {
    const sameViewer = membership.viewerClusterId === viewerClusterId;
    const sameTime = membership.timeClusterId === timeClusterId;
    if (sameViewer && sameTime) evaluationDecisionIds.push(membership.decisionId);
    else if (!sameViewer && !sameTime) trainingDecisionIds.push(membership.decisionId);
    else guardBandDecisionIds.push(membership.decisionId);
  }
  if (evaluationDecisionIds.length === 0 || trainingDecisionIds.length === 0) return null;
  const excludedDecisionIds = [...evaluationDecisionIds, ...guardBandDecisionIds]
    .sort(comparePhase18Text);
  const all = [...evaluationDecisionIds, ...trainingDecisionIds, ...guardBandDecisionIds];
  if (new Set(all).size !== memberships.length
    || all.length !== memberships.length
    || trainingDecisionIds.some((decisionId) => {
      const membership = membershipByDecisionId.get(decisionId);
      return !membership
        || membership.viewerClusterId === viewerClusterId
        || membership.timeClusterId === timeClusterId;
    })) return null;
  evaluationDecisionIds.sort(comparePhase18Text);
  trainingDecisionIds.sort(comparePhase18Text);
  guardBandDecisionIds.sort(comparePhase18Text);
  const cellPreimage = {
    domain: PHASE18_MULTIWAY_CELL_DIGEST_DOMAIN_V1,
    viewerClusterId,
    timeClusterId,
    evaluationDecisionIds,
    trainingDecisionIds,
    guardBandDecisionIds,
    excludedDecisionIds,
  };
  return freezePhase18({
    viewerClusterId,
    timeClusterId,
    evaluationDecisionIds,
    trainingDecisionIds,
    guardBandDecisionIds,
    excludedDecisionIds,
    evaluationDecisionSetSha256: phase18Digest(evaluationDecisionIds),
    trainingDecisionSetSha256: phase18Digest(trainingDecisionIds),
    guardBandDecisionSetSha256: phase18Digest(guardBandDecisionIds),
    excludedDecisionSetSha256: phase18Digest(excludedDecisionIds),
    cellSha256: phase18Digest(cellPreimage),
  });
}

function planInput(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    return Reflect.get(value, 'provenance');
  } catch {
    return undefined;
  }
}

function reject(blocker: Phase18MultiwayHoldoutBlockerV1): Phase18MultiwayHoldoutBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
