import { createHash } from 'crypto';

import {
  VIEWER_CLUSTER_UNIT_VERSION,
} from '../../decisionContext/contracts';
import {
  isVerifiedDecisionContextEvidenceV1,
  type VerifiedDecisionContextEvidenceV1,
} from '../../decisionContext/verify';
import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  PREDICTION_V3_FOLD_COUNT,
  PREDICTION_V3_RESOURCE_LIMITS,
  VIEWER_CLUSTER_FOLD_ASSIGNMENT_V1,
  VIEWER_CLUSTER_HOLDOUT_DOMAIN_V1,
  VIEWER_CLUSTER_HOLDOUT_PLAN_V1,
  viewerClusterHoldoutPlanV1Schema,
  type VerifiedViewerClusterHoldoutPlanV1,
  type ViewerClusterHoldoutAssignmentV1,
  type ViewerClusterHoldoutFoldV1,
  type ViewerClusterHoldoutPlanV1,
} from './contracts';

export type ViewerClusterHoldoutPlanBlockerV1 =
  | 'prediction_v3_decision_context_unverified'
  | 'prediction_v3_viewer_cluster_contract_invalid'
  | 'prediction_v3_fold_contract_invalid'
  | 'resource_limit_exceeded';

export type ViewerClusterHoldoutPlanBuildResultV1 =
  | Readonly<{ status: 'verified'; plan: VerifiedViewerClusterHoldoutPlanV1 }>
  | Readonly<{ status: 'not_evaluable'; blocker: ViewerClusterHoldoutPlanBlockerV1 }>;

export type ViewerClusterHoldoutPlanBindingV1 = Readonly<{
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
  foldIdByDecisionId: ReadonlyMap<string, 0 | 1>;
  foldIdByInferenceClusterId: ReadonlyMap<string, 0 | 1>;
}>;

type InternalBinding = Readonly<{
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
  decisionFoldEntries: readonly (readonly [string, 0 | 1])[];
  clusterFoldEntries: readonly (readonly [string, 0 | 1])[];
}>;

const verifiedPlan = Symbol('verifiedViewerClusterHoldoutPlanV1');
const verifiedPlans = new WeakSet<object>();
const verifiedPlanDigests = new WeakMap<object, string>();
const verifiedPlanBindings = new WeakMap<object, InternalBinding>();

type BrandedPlan = ViewerClusterHoldoutPlanV1 & {
  readonly [verifiedPlan]: true;
};

export function buildViewerClusterHoldoutPlanV1(
  input: unknown,
): ViewerClusterHoldoutPlanBuildResultV1 {
  const source = holdoutInput(input);
  if (!source || !isVerifiedDecisionContextEvidenceV1(source.decisionContextEvidence)) {
    return reject('prediction_v3_decision_context_unverified');
  }
  const evidence = source.decisionContextEvidence;
  if (evidence.decisions.length > PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions) {
    return reject('resource_limit_exceeded');
  }

  const decisionIdsByCluster = new Map<string, string[]>();
  for (const decision of evidence.decisions) {
    if (decision.subject.kind !== 'viewer'
      || decision.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
      || decision.realDatasetEligible !== false) {
      return reject('prediction_v3_viewer_cluster_contract_invalid');
    }
    const decisionIds = decisionIdsByCluster.get(decision.inferenceClusterId) ?? [];
    decisionIds.push(decision.decisionId);
    decisionIdsByCluster.set(decision.inferenceClusterId, decisionIds);
  }
  if (decisionIdsByCluster.size < PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters) {
    return reject('prediction_v3_fold_contract_invalid');
  }
  if (decisionIdsByCluster.size > PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters) {
    return reject('resource_limit_exceeded');
  }

  const assignments = buildAssignments(decisionIdsByCluster);
  const folds = buildFolds(assignments);
  if (!folds) return reject('prediction_v3_fold_contract_invalid');

  const preimage = {
    contractVersion: VIEWER_CLUSTER_HOLDOUT_PLAN_V1,
    datasetVersion: evidence.datasetVersion,
    decisionContextEvidenceSha256: evidence.decisionContextEvidenceSha256,
    assignmentVersion: VIEWER_CLUSTER_FOLD_ASSIGNMENT_V1,
    assignmentDomain: VIEWER_CLUSTER_HOLDOUT_DOMAIN_V1,
    foldCount: PREDICTION_V3_FOLD_COUNT,
    decisionCount: evidence.decisions.length,
    viewerClusterCount: assignments.length,
    assignments,
    folds,
    sameViewerLeakageExcluded: true as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const parsed = viewerClusterHoldoutPlanV1Schema.safeParse({
    ...preimage,
    holdoutPlanSha256: digest(preimage),
  });
  if (!parsed.success) return reject('prediction_v3_viewer_cluster_contract_invalid');

  const candidate = parsed.data as BrandedPlan;
  Object.defineProperty(candidate, verifiedPlan, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const binding = buildBinding(evidence, assignments);
  verifiedPlans.add(candidate);
  recursivelyFreeze(candidate);
  verifiedPlanDigests.set(candidate, candidate.holdoutPlanSha256);
  verifiedPlanBindings.set(candidate, binding);
  return recursivelyFreeze({ status: 'verified' as const, plan: candidate });
}

export function isVerifiedViewerClusterHoldoutPlanV1(
  value: unknown,
): value is BrandedPlan {
  try {
    if (!value || typeof value !== 'object' || !verifiedPlans.has(value)) return false;
    const candidate = value as BrandedPlan;
    const binding = verifiedPlanBindings.get(candidate);
    if (!binding || !isVerifiedDecisionContextEvidenceV1(binding.decisionContextEvidence)) {
      return false;
    }
    const { holdoutPlanSha256, ...preimage } = candidate;
    return candidate[verifiedPlan] === true
      && recursivelyFrozen(candidate)
      && viewerClusterHoldoutPlanV1Schema.safeParse(candidate).success
      && holdoutPlanSha256 === digest(preimage)
      && verifiedPlanDigests.get(candidate) === holdoutPlanSha256
      && candidate.decisionContextEvidenceSha256
        === binding.decisionContextEvidence.decisionContextEvidenceSha256;
  } catch {
    return false;
  }
}

export function viewerClusterHoldoutPlanBindingV1(
  value: unknown,
): ViewerClusterHoldoutPlanBindingV1 | undefined {
  if (!isVerifiedViewerClusterHoldoutPlanV1(value)) return undefined;
  const binding = verifiedPlanBindings.get(value);
  if (!binding) return undefined;
  return Object.freeze({
    decisionContextEvidence: binding.decisionContextEvidence,
    foldIdByDecisionId: new Map(binding.decisionFoldEntries),
    foldIdByInferenceClusterId: new Map(binding.clusterFoldEntries),
  });
}

function buildAssignments(
  decisionIdsByCluster: ReadonlyMap<string, readonly string[]>,
): ViewerClusterHoldoutAssignmentV1[] {
  return [...decisionIdsByCluster.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([inferenceClusterId, decisionIds]) => ({
      inferenceClusterId,
      foldId: assignViewerClusterFoldV1(inferenceClusterId),
      decisionIds: [...decisionIds].sort(compareText),
    }));
}

function buildFolds(
  assignments: readonly ViewerClusterHoldoutAssignmentV1[],
): ViewerClusterHoldoutFoldV1[] | null {
  const folds: ViewerClusterHoldoutFoldV1[] = [];
  for (let rawFoldId = 0; rawFoldId < PREDICTION_V3_FOLD_COUNT; rawFoldId += 1) {
    const foldId = rawFoldId as 0 | 1;
    const holdoutAssignments = assignments.filter((entry) => entry.foldId === foldId);
    const trainingAssignments = assignments.filter((entry) => entry.foldId !== foldId);
    if (holdoutAssignments.length === 0 || trainingAssignments.length === 0) return null;
    const trainingInferenceClusterIds = trainingAssignments
      .map((entry) => entry.inferenceClusterId).sort(compareText);
    const holdoutInferenceClusterIds = holdoutAssignments
      .map((entry) => entry.inferenceClusterId).sort(compareText);
    const trainingDecisionIds = trainingAssignments
      .flatMap((entry) => entry.decisionIds).sort(compareText);
    const holdoutDecisionIds = holdoutAssignments
      .flatMap((entry) => entry.decisionIds).sort(compareText);
    folds.push({
      foldId,
      trainingInferenceClusterIds,
      holdoutInferenceClusterIds,
      trainingDecisionIds,
      holdoutDecisionIds,
      trainingClusterSetSha256: digest(trainingInferenceClusterIds),
      holdoutClusterSetSha256: digest(holdoutInferenceClusterIds),
      trainingDecisionSetSha256: digest(trainingDecisionIds),
      holdoutDecisionSetSha256: digest(holdoutDecisionIds),
    });
  }
  return folds;
}

function buildBinding(
  evidence: VerifiedDecisionContextEvidenceV1,
  assignments: readonly ViewerClusterHoldoutAssignmentV1[],
): InternalBinding {
  const clusterFoldEntries = assignments.map((assignment) => Object.freeze([
    assignment.inferenceClusterId,
    assignment.foldId as 0 | 1,
  ] as const));
  const foldIdByCluster = new Map(clusterFoldEntries);
  const decisionFoldEntries = evidence.decisions.map((decision) => Object.freeze([
    decision.decisionId,
    foldIdByCluster.get(decision.inferenceClusterId) as 0 | 1,
  ] as const));
  return Object.freeze({
    decisionContextEvidence: evidence,
    decisionFoldEntries: Object.freeze(decisionFoldEntries),
    clusterFoldEntries: Object.freeze(clusterFoldEntries),
  });
}

function assignViewerClusterFoldV1(inferenceClusterId: string): 0 | 1 {
  const hash = createHash('sha256')
    .update(VIEWER_CLUSTER_HOLDOUT_DOMAIN_V1)
    .update('\u0000')
    .update(VIEWER_CLUSTER_FOLD_ASSIGNMENT_V1)
    .update('\u0000')
    .update(inferenceClusterId, 'utf8')
    .digest('hex');
  return Number(BigInt(`0x${hash}`) % BigInt(PREDICTION_V3_FOLD_COUNT)) as 0 | 1;
}

function holdoutInput(value: unknown): { decisionContextEvidence: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return { decisionContextEvidence: Reflect.get(value, 'decisionContextEvidence') };
  } catch {
    return null;
  }
}

function reject(
  blocker: ViewerClusterHoldoutPlanBlockerV1,
): ViewerClusterHoldoutPlanBuildResultV1 {
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

const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
