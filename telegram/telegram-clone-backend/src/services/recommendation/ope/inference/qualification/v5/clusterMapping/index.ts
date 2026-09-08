import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import { SYNTHETIC_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import {
  isOpeSlotContributionBoundToReceiptV3,
  isVerifiedOpeAggregateReceiptV3,
  type OpeSlotContributionV3,
  type VerifiedOpeAggregateReceiptV3,
} from '../../../../v3';
import { summarizeClusterScoresV1 } from '../../../clusterScores';
import type { ClusterScoreV1 } from '../../../contracts';
import {
  PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE15_SYNTHETIC_CLUSTER_STATISTIC_MAPPING_AUDIT_V1,
  type Phase15ClusterMappingBlockerV1,
  type Phase15ClusterMappingBuildResultV1,
  type VerifiedPhase15SyntheticClusterStatisticMappingAuditV1,
} from './contracts';

export * from './contracts';

const verifiedMapping = Symbol('verifiedPhase15SyntheticClusterStatisticMappingAuditV1');
const verifiedMappings = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedMapping = VerifiedPhase15SyntheticClusterStatisticMappingAuditV1 & {
  readonly [verifiedMapping]: true;
};

export function buildPhase15SyntheticClusterStatisticMappingAuditV1(
  input: unknown,
): Phase15ClusterMappingBuildResultV1 {
  const parsedInput = mappingInput(input);
  if (!parsedInput) {
    return reject('phase15_mapping_source_unverified');
  }
  if ('blocker' in parsedInput) return reject(parsedInput.blocker);
  const fields = parsedInput.fields;
  if (!isVerifiedOpeAggregateReceiptV3(fields.receipt)) {
    return reject('phase15_mapping_source_unverified');
  }
  const receipt = fields.receipt;
  const contributions = fields.contributions;
  const limits = PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1;
  if (contributions.length > limits.maximumSlotContributions
    || receipt.highWaterDiagnostics.clusters > limits.maximumClusters) {
    return reject('phase15_mapping_resource_limit_exceeded');
  }
  if (contributions.length === 0
    || receipt.expectedDecisionCount !== receipt.observedDecisionCount
    || receipt.expectedSlotCount !== receipt.observedSlotCount
    || receipt.observedSlotCount !== contributions.length) {
    return reject('phase15_mapping_incomplete_cohort');
  }
  if (receipt.drSlotCount !== receipt.observedSlotCount) {
    return reject('phase15_mapping_dr_incomplete');
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
    const y = current.y + contribution.drContribution!;
    const a = current.a + 1;
    const importanceMass = current.importanceMass + contribution.weight;
    if (!Number.isFinite(y) || !Number.isSafeInteger(a) || !Number.isFinite(importanceMass)) {
      return reject('phase15_mapping_contribution_invalid');
    }
    grouped.set(clusterId, { inferenceClusterId: clusterId, y, a, importanceMass });
    if (grouped.size > limits.maximumClusters) {
      return reject('phase15_mapping_resource_limit_exceeded');
    }
  }
  if (grouped.size !== receipt.highWaterDiagnostics.clusters) {
    return reject('phase15_mapping_incomplete_cohort');
  }
  const mappingWorkUnits = 2 * contributions.length + grouped.size;
  if (mappingWorkUnits > limits.maximumMappingWorkUnits) {
    return reject('phase15_mapping_resource_limit_exceeded');
  }

  const clusterRows = [...grouped.values()].sort((left, right) => (
    compareText(left.inferenceClusterId, right.inferenceClusterId)
  ));
  const clusterScoreSummaryResult = summarizeClusterScoresV1('dr', clusterRows);
  const preimage = {
    contractVersion: VERIFIED_PHASE15_SYNTHETIC_CLUSTER_STATISTIC_MAPPING_AUDIT_V1,
    estimand: 'mean_reward_per_logged_slot_v1' as const,
    sourceClusterUnitVersion: SYNTHETIC_CLUSTER_UNIT_VERSION,
    mappingStatus: 'verified_synthetic_mapping_only' as const,
    viewerClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    scope: inspected.scope,
    predictionBinding: inspected.predictionBinding,
    sourceBindings: {
      receiptSha256: receipt.receiptSha256,
      stateBindingSha256: receipt.stateBindingSha256,
      trajectoryCohortSha256: receipt.trajectoryCohortSha256,
      outcomeEvidenceRootsSha256: receipt.outcomeEvidenceRootsSha256,
      contextEvidenceRootsSha256: receipt.contextEvidenceRootsSha256,
      targetEvidenceRootsSha256: receipt.targetEvidenceRootsSha256,
      predictionEvidenceRootsSha256: receipt.predictionEvidenceRootsSha256,
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

export function isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1(
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
  receipt: VerifiedOpeAggregateReceiptV3,
  contributions: readonly OpeSlotContributionV3[],
): {
  canonicalInputBytes: number;
  predictionBinding: NonNullable<OpeSlotContributionV3['binding']['prediction']>;
  scope: {
    objective: string;
    segmentAssignments: OpeSlotContributionV3['binding']['segmentAssignments'];
    scopeSha256: string;
  };
} | { blocker: Phase15ClusterMappingBlockerV1 } {
  const limits = PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1;
  let priorContributionSha256 = digest({
    stateBindingSha256: receipt.stateBindingSha256,
    chain: 'empty_v1',
  });
  let canonicalInputBytes = 0;
  let predictionBinding: NonNullable<OpeSlotContributionV3['binding']['prediction']> | undefined;
  let scopeJson: string | undefined;
  let scope: {
    objective: string;
    segmentAssignments: OpeSlotContributionV3['binding']['segmentAssignments'];
    scopeSha256: string;
  } | undefined;
  const decisions = new Set<string>();

  for (const contribution of contributions) {
    if (!isOpeSlotContributionBoundToReceiptV3(contribution, receipt)) {
      return { blocker: 'phase15_mapping_source_unverified' };
    }
    let contributionBytes: number;
    try {
      contributionBytes = Buffer.byteLength(canonicalDecisionJson(contribution)) + 1;
    } catch {
      return { blocker: 'phase15_mapping_contribution_invalid' };
    }
    canonicalInputBytes += contributionBytes;
    if (contributionBytes > limits.maximumCanonicalContributionBytes
      || canonicalInputBytes > limits.maximumCanonicalInputBytes) {
      return { blocker: 'phase15_mapping_resource_limit_exceeded' };
    }
    if (contribution.priorContributionSha256 !== priorContributionSha256) {
      return { blocker: 'phase15_mapping_contribution_chain_mismatch' };
    }
    priorContributionSha256 = contribution.contributionSha256;
    if (!contribution.binding.inferenceClusterId
      || !Number.isFinite(contribution.drContribution)
      || !Number.isFinite(contribution.weight)
      || contribution.weight <= 0) {
      return { blocker: 'phase15_mapping_contribution_invalid' };
    }
    const nextPredictionBinding = contribution.binding.prediction;
    if (!nextPredictionBinding) {
      return { blocker: 'phase15_mapping_prediction_binding_mismatch' };
    }
    if (predictionBinding
      && canonicalDecisionJson(predictionBinding) !== canonicalDecisionJson(nextPredictionBinding)) {
      return { blocker: 'phase15_mapping_prediction_binding_mismatch' };
    }
    predictionBinding ??= nextPredictionBinding;

    const nextScope = {
      objective: contribution.binding.objective,
      segmentAssignments: contribution.binding.segmentAssignments,
    };
    const nextScopeJson = canonicalDecisionJson(nextScope);
    if (scopeJson !== undefined && scopeJson !== nextScopeJson) {
      return { blocker: 'phase15_mapping_scope_mismatch' };
    }
    scopeJson ??= nextScopeJson;
    scope ??= { ...nextScope, scopeSha256: digest(nextScope) };
    decisions.add(contribution.decisionId);
  }
  if (priorContributionSha256 !== receipt.contributionHashChainSha256) {
    return { blocker: 'phase15_mapping_contribution_chain_mismatch' };
  }
  if (decisions.size !== receipt.observedDecisionCount) {
    return { blocker: 'phase15_mapping_incomplete_cohort' };
  }
  if (!predictionBinding
    || digest([predictionBinding]) !== receipt.predictionEvidenceRootsSha256) {
    return { blocker: 'phase15_mapping_prediction_binding_mismatch' };
  }
  if (!scope) return { blocker: 'phase15_mapping_scope_mismatch' };
  return { canonicalInputBytes, predictionBinding, scope };
}

function mappingInput(value: unknown): {
  fields: {
    receipt: unknown;
    contributions: readonly OpeSlotContributionV3[];
  };
} | { blocker: 'phase15_mapping_resource_limit_exceeded' } | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const source = Reflect.get(value, 'contributions');
    if (!Array.isArray(source)) return null;
    const length = Reflect.get(source, 'length');
    if (!Number.isSafeInteger(length) || length < 0) return null;
    if (length > PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1.maximumSlotContributions) {
      return { blocker: 'phase15_mapping_resource_limit_exceeded' };
    }
    const contributions: OpeSlotContributionV3[] = [];
    for (let index = 0; index < length; index += 1) {
      contributions.push(Reflect.get(source, index) as OpeSlotContributionV3);
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

function reject(blocker: Phase15ClusterMappingBlockerV1): Phase15ClusterMappingBuildResultV1 {
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
