import { createHash } from 'crypto';

import { VIEWER_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isOpeSlotContributionBoundToReceiptV4,
  isVerifiedOpeAggregateReceiptV4,
  type OpeSlotContributionV4,
  type VerifiedOpeAggregateReceiptV4,
} from '../../../../v4';
import { summarizeClusterScoresV1 } from '../../../clusterScores';
import type { ClusterScoreV1 } from '../../../contracts';
import {
  PHASE17_CLUSTER_MAPPING_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE17_SYNTHETIC_VIEWER_CLUSTER_MAPPING_AUDIT_V1,
  type Phase17ClusterMappingBlockerV1,
  type Phase17ClusterMappingBuildResultV1,
  type VerifiedPhase17SyntheticViewerClusterMappingAuditV1,
} from './contracts';

export * from './contracts';

const verifiedMapping = Symbol('verifiedPhase17SyntheticViewerClusterMappingAuditV1');
const verifiedMappings = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedMapping = VerifiedPhase17SyntheticViewerClusterMappingAuditV1 & {
  readonly [verifiedMapping]: true;
};

export function buildPhase17SyntheticViewerClusterMappingAuditV1(
  input: unknown,
): Phase17ClusterMappingBuildResultV1 {
  const parsed = mappingInput(input);
  if (!parsed) return reject('phase17_mapping_source_unverified');
  if ('blocker' in parsed) return reject(parsed.blocker);
  const { receipt, contributions } = parsed.fields;
  if (!isVerifiedOpeAggregateReceiptV4(receipt)) {
    return reject('phase17_mapping_source_unverified');
  }
  const limits = PHASE17_CLUSTER_MAPPING_RESOURCE_LIMITS_V1;
  if (contributions.length > limits.maximumSlotContributions
    || receipt.observedViewerClusterCount > limits.maximumClusters) {
    return reject('phase17_mapping_resource_limit_exceeded');
  }
  if (contributions.length === 0
    || receipt.expectedDecisionCount !== receipt.observedDecisionCount
    || receipt.expectedViewerClusterCount !== receipt.observedViewerClusterCount
    || receipt.expectedSlotCount !== receipt.observedSlotCount
    || receipt.observedSlotCount !== contributions.length) {
    return reject('phase17_mapping_incomplete_cohort');
  }
  if (receipt.drSlotCount !== receipt.observedSlotCount) {
    return reject('phase17_mapping_dr_incomplete');
  }

  const inspected = inspectContributions(receipt, contributions);
  if ('blocker' in inspected) return reject(inspected.blocker);

  const grouped = new Map<string, ClusterScoreV1>();
  for (const contribution of contributions) {
    const clusterId = contribution.binding.inferenceClusterId;
    const current = grouped.get(clusterId) ?? {
      inferenceClusterId: clusterId,
      y: 0,
      a: 0,
      importanceMass: 0,
    };
    const y = current.y + contribution.drContribution;
    const a = current.a + 1;
    const importanceMass = current.importanceMass + contribution.weight;
    if (!Number.isFinite(y) || !Number.isSafeInteger(a) || !Number.isFinite(importanceMass)) {
      return reject('phase17_mapping_contribution_invalid');
    }
    grouped.set(clusterId, { inferenceClusterId: clusterId, y, a, importanceMass });
  }
  if (grouped.size !== receipt.observedViewerClusterCount) {
    return reject('phase17_mapping_incomplete_cohort');
  }
  const mappingWorkUnits = 2 * contributions.length + grouped.size;
  if (grouped.size > limits.maximumClusters
    || mappingWorkUnits > limits.maximumMappingWorkUnits) {
    return reject('phase17_mapping_resource_limit_exceeded');
  }

  const clusterRows = [...grouped.values()].sort((left, right) => (
    compareText(left.inferenceClusterId, right.inferenceClusterId)
  ));
  const clusterScoreSummaryResult = summarizeClusterScoresV1('dr', clusterRows);
  const preimage = {
    contractVersion: VERIFIED_PHASE17_SYNTHETIC_VIEWER_CLUSTER_MAPPING_AUDIT_V1,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    sourceClusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
    mappingStatus: 'verified_synthetic_viewer_cluster_mapping_only' as const,
    viewerClusterCrossFitProvenancePresent: true as const,
    independentViewerClustersVerified: false as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    scope: inspected.scope,
    predictionBinding: inspected.predictionBinding,
    sourceBindings: {
      receiptSha256: receipt.receiptSha256,
      stateBindingSha256: receipt.stateBindingSha256,
      trajectoryEvidenceSha256: receipt.trajectoryEvidenceSha256,
      modelBundleSha256: receipt.modelBundleSha256,
      predictionStreamSha256: receipt.predictionStreamSha256,
      snapshotManifestSha256: receipt.snapshotManifestSha256,
      targetManifestSha256: receipt.targetManifestSha256,
      targetVerificationReceiptSha256: receipt.targetVerificationReceiptSha256,
      targetDistributionNdjsonSha256: receipt.targetDistributionNdjsonSha256,
      decisionContextEvidenceSha256: receipt.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: receipt.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: receipt.syntheticOutcomeEvidenceRootSha256,
      contributionHashChainSha256: receipt.contributionHashChainSha256,
      aggregateStateSha256: receipt.aggregateStateSha256,
    },
    clusterRows,
    clusterScoreSummaryResult,
    resourceDiagnostics: {
      slotContributions: contributions.length,
      clusters: grouped.size,
      canonicalInputBytes: inspected.canonicalInputBytes,
      mappingWorkUnits,
      peakBufferedClusters: grouped.size,
    },
  };
  const candidate = {
    ...preimage,
    mappingSha256: digest(preimage),
  } as unknown as BrandedMapping;
  Object.defineProperty(candidate, verifiedMapping, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedMappings.add(candidate);
  recursivelyFreeze(candidate);
  verifiedDigests.set(candidate, candidate.mappingSha256);
  return { status: 'verified', audit: candidate };
}

export function isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(
  value: unknown,
): value is BrandedMapping {
  try {
    if (!value || typeof value !== 'object' || !verifiedMappings.has(value)) return false;
    const candidate = value as BrandedMapping;
    const { mappingSha256, ...preimage } = candidate;
    return candidate[verifiedMapping] === true
      && recursivelyFrozen(candidate)
      && mappingSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === mappingSha256;
  } catch {
    return false;
  }
}

function inspectContributions(
  receipt: VerifiedOpeAggregateReceiptV4,
  contributions: readonly OpeSlotContributionV4[],
): Readonly<{
  canonicalInputBytes: number;
  predictionBinding: {
    predictionSetVersion: string;
    predictionVerificationReceiptSha256: string;
    holdoutPlanSha256: string;
  };
  scope: {
    objective: string;
    segmentAssignments: OpeSlotContributionV4['binding']['segmentAssignments'];
    scopeSha256: string;
  };
}> | Readonly<{ blocker: Phase17ClusterMappingBlockerV1 }> {
  const limits = PHASE17_CLUSTER_MAPPING_RESOURCE_LIMITS_V1;
  let priorContributionSha256 = digest({
    stateBindingSha256: receipt.stateBindingSha256,
    chain: 'empty_v1',
  });
  let canonicalInputBytes = 0;
  let predictionBinding: {
    predictionSetVersion: string;
    predictionVerificationReceiptSha256: string;
    holdoutPlanSha256: string;
  } | undefined;
  let scopeJson: string | undefined;
  let scope: {
    objective: string;
    segmentAssignments: OpeSlotContributionV4['binding']['segmentAssignments'];
    scopeSha256: string;
  } | undefined;
  const decisions = new Set<string>();

  for (const contribution of contributions) {
    if (!isOpeSlotContributionBoundToReceiptV4(contribution, receipt)) {
      return { blocker: 'phase17_mapping_source_unverified' };
    }
    let contributionBytes: number;
    try {
      contributionBytes = Buffer.byteLength(canonicalDecisionJson(contribution)) + 1;
    } catch {
      return { blocker: 'phase17_mapping_contribution_invalid' };
    }
    canonicalInputBytes += contributionBytes;
    if (contributionBytes > limits.maximumCanonicalContributionBytes
      || canonicalInputBytes > limits.maximumCanonicalInputBytes) {
      return { blocker: 'phase17_mapping_resource_limit_exceeded' };
    }
    if (contribution.priorContributionSha256 !== priorContributionSha256) {
      return { blocker: 'phase17_mapping_contribution_chain_mismatch' };
    }
    priorContributionSha256 = contribution.contributionSha256;
    if (!contribution.binding.inferenceClusterId
      || contribution.binding.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
      || !Number.isFinite(contribution.drContribution)
      || !Number.isFinite(contribution.weight)
      || contribution.weight <= 0) {
      return { blocker: 'phase17_mapping_contribution_invalid' };
    }
    const nextPredictionBinding = {
      predictionSetVersion: contribution.binding.predictionSetVersion,
      predictionVerificationReceiptSha256:
        contribution.binding.predictionVerificationReceiptSha256,
      holdoutPlanSha256: contribution.binding.holdoutPlanSha256,
    };
    if (predictionBinding
      && canonicalDecisionJson(predictionBinding) !== canonicalDecisionJson(nextPredictionBinding)) {
      return { blocker: 'phase17_mapping_prediction_binding_mismatch' };
    }
    predictionBinding ??= nextPredictionBinding;

    const nextScope = {
      objective: contribution.binding.objective,
      segmentAssignments: contribution.binding.segmentAssignments,
    };
    const nextScopeJson = canonicalDecisionJson(nextScope);
    if (scopeJson !== undefined && scopeJson !== nextScopeJson) {
      return { blocker: 'phase17_mapping_scope_mismatch' };
    }
    scopeJson ??= nextScopeJson;
    scope ??= { ...nextScope, scopeSha256: digest(nextScope) };
    decisions.add(contribution.decisionId);
  }
  if (priorContributionSha256 !== receipt.contributionHashChainSha256) {
    return { blocker: 'phase17_mapping_contribution_chain_mismatch' };
  }
  if (decisions.size !== receipt.observedDecisionCount) {
    return { blocker: 'phase17_mapping_incomplete_cohort' };
  }
  if (!predictionBinding
    || predictionBinding.predictionSetVersion !== receipt.predictionSetVersion
    || predictionBinding.predictionVerificationReceiptSha256
      !== receipt.predictionVerificationReceiptSha256
    || predictionBinding.holdoutPlanSha256 !== receipt.holdoutPlanSha256) {
    return { blocker: 'phase17_mapping_prediction_binding_mismatch' };
  }
  if (!scope) return { blocker: 'phase17_mapping_scope_mismatch' };
  return { canonicalInputBytes, predictionBinding, scope };
}

function mappingInput(value: unknown): Readonly<{
  fields: {
    receipt: unknown;
    contributions: readonly OpeSlotContributionV4[];
  };
}> | Readonly<{ blocker: 'phase17_mapping_resource_limit_exceeded' }> | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const source = Reflect.get(value, 'contributions');
    if (!Array.isArray(source)) return null;
    const length = Reflect.get(source, 'length');
    if (!Number.isSafeInteger(length) || length < 0) return null;
    if (length > PHASE17_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions) {
      return { blocker: 'phase17_mapping_resource_limit_exceeded' };
    }
    const contributions: OpeSlotContributionV4[] = [];
    for (let index = 0; index < length; index += 1) {
      contributions.push(Reflect.get(source, index) as OpeSlotContributionV4);
    }
    return {
      fields: {
        receipt: Reflect.get(value, 'receipt'),
        contributions: Object.freeze(contributions),
      },
    };
  } catch {
    return null;
  }
}

function reject(blocker: Phase17ClusterMappingBlockerV1): Phase17ClusterMappingBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);
