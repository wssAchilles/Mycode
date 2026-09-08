import { createHash } from 'crypto';

import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  isVerifiedSyntheticCohortTrajectoryEvidenceV1,
  isVerifiedSyntheticCohortTrajectoryStepBoundToEvidenceV1,
  replayVerifiedSyntheticCohortTrajectoryEvidenceV1,
  type VerifiedSyntheticCohortTrajectoryEvidenceV1,
  type VerifiedSyntheticCohortTrajectoryStepV1,
} from '../../offlinePrediction/streamingV3';
import { evaluateSequentialDrSlotV1 } from '../core/sequentialDr';
import {
  OPE_V4_ESTIMAND,
  OPE_V4_RESOURCE_LIMITS,
  OPE_V4_RESOURCE_LIMITS_VERSION,
  type EvaluateSyntheticCohortOpeResultV4,
  type OpeSlotContributionV4,
  type VerifiedOpeAggregateReceiptV4,
} from './contracts';

type PrefixState = Readonly<{
  actionKeys: readonly VerifiedSyntheticCohortTrajectoryStepV1['loggedActionKey'][];
  logWeight: number;
}>;
type Aggregate = Readonly<{
  contributionSum: number;
  importanceMass: number;
  slotCount: number;
}>;
type EvaluationOwner = Readonly<{
  evidence: VerifiedSyntheticCohortTrajectoryEvidenceV1;
}>;

const receipts = new WeakSet<object>();
const receiptDigests = new WeakMap<object, string>();
const receiptOwners = new WeakMap<object, EvaluationOwner>();
const contributionOwners = new WeakMap<object, EvaluationOwner>();

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);
const actionIdentity = (value: VerifiedSyntheticCohortTrajectoryStepV1['loggedActionKey']): string => (
  canonicalDecisionJson(value)
);

export async function evaluateSyntheticCohortOpeV4(
  raw: unknown,
): Promise<EvaluateSyntheticCohortOpeResultV4> {
  if (!isVerifiedSyntheticCohortTrajectoryEvidenceV1(raw)) {
    return reject('ope_v4_source_unverified');
  }
  const evidence = raw;
  const preflight = preflightEvidence(evidence);
  if ('blocker' in preflight) return reject(preflight.blocker);

  const owner: EvaluationOwner = Object.freeze({ evidence });
  const contributions: OpeSlotContributionV4[] = [];
  const decisions = new Map<string, string>();
  const clusters = new Set<string>();
  const prefixes = new Map<string, PrefixState>();
  const aggregates = new Map<string, Aggregate>();
  let contributionHeadSha256 = digest({
    stateBindingSha256: preflight.stateBindingSha256,
    chain: 'empty_v1',
  });
  let contributionCanonicalBytes = 0;
  let maximumCanonicalStepBytes = 0;
  let supportActionRows = 0;
  let localBlocker: string | undefined;

  const replay = await replayVerifiedSyntheticCohortTrajectoryEvidenceV1(evidence, {
    onStep: (step) => {
      const inspected = inspectStep(evidence, step, prefixes);
      if ('blocker' in inspected) {
        localBlocker = inspected.blocker;
        throw new Error(inspected.blocker);
      }
      const { targetProbability, targetQValues, loggedQ, prefixLogWeight } = inspected;
      const evaluated = evaluateSequentialDrSlotV1({
        prefixLogWeight,
        behaviorProbability: step.behaviorProbability,
        targetProbability,
        reward: step.reward,
        targetQValues,
        loggedQ,
      });
      if (evaluated.status !== 'evaluated' || evaluated.drContribution === undefined) {
        localBlocker = evaluated.status === 'not_evaluable'
          ? evaluated.blocker
          : 'ope_v4_qhat_invalid';
        throw new Error(localBlocker);
      }

      const priorRequestId = decisions.get(step.decisionId);
      if (priorRequestId !== undefined && priorRequestId !== step.requestId) {
        localBlocker = 'ope_v4_decision_binding_mismatch';
        throw new Error(localBlocker);
      }
      decisions.set(step.decisionId, step.requestId);
      clusters.add(step.binding.inferenceClusterId);
      prefixes.set(step.decisionId, {
        actionKeys: [...step.prefixActionKeys, step.loggedActionKey],
        logWeight: evaluated.logWeight,
      });

      const aggregateKey = canonicalDecisionJson({
        inferenceClusterId: step.binding.inferenceClusterId,
        objective: step.binding.objective,
        segmentAssignments: step.binding.segmentAssignments,
      });
      const aggregate = aggregates.get(aggregateKey) ?? {
        contributionSum: 0,
        importanceMass: 0,
        slotCount: 0,
      };
      const proposedSum = aggregate.contributionSum + evaluated.drContribution;
      const proposedMass = aggregate.importanceMass + evaluated.weight;
      if (!Number.isFinite(proposedSum) || !Number.isFinite(proposedMass)) {
        localBlocker = 'ope_v4_aggregate_non_finite';
        throw new Error(localBlocker);
      }
      if (proposedSum === 0 && aggregate.contributionSum !== -evaluated.drContribution
        && (aggregate.contributionSum !== 0 || evaluated.drContribution !== 0)) {
        localBlocker = 'importance_contribution_underflow';
        throw new Error(localBlocker);
      }
      if (proposedMass === 0 && aggregate.importanceMass !== -evaluated.weight) {
        localBlocker = 'importance_weight_underflow';
        throw new Error(localBlocker);
      }
      aggregates.set(aggregateKey, {
        contributionSum: proposedSum,
        importanceMass: proposedMass,
        slotCount: aggregate.slotCount + 1,
      });

      const contributionPreimage = {
        contractVersion: 'ope_v4_slot_contribution_v1' as const,
        estimand: OPE_V4_ESTIMAND,
        stateBindingSha256: preflight.stateBindingSha256,
        priorContributionSha256: contributionHeadSha256,
        decisionId: step.decisionId,
        requestId: step.requestId,
        servedPosition: step.servedPosition,
        prefixLogWeight,
        logWeight: evaluated.logWeight,
        prefixWeight: evaluated.prefixWeight,
        weight: evaluated.weight,
        behaviorProbability: step.behaviorProbability,
        targetProbability,
        reward: step.reward,
        ipsContribution: evaluated.ipsContribution,
        drContribution: evaluated.drContribution,
        binding: {
          ...step.binding,
          predictionSetVersion: step.predictionSetVersion,
          predictionVerificationReceiptSha256:
            step.predictionVerificationReceiptSha256,
        },
      };
      const contribution = recursivelyFreeze({
        ...contributionPreimage,
        contributionSha256: digest(contributionPreimage),
      });
      const canonicalBytes = Buffer.byteLength(canonicalDecisionJson(contribution));
      contributionCanonicalBytes += canonicalBytes;
      maximumCanonicalStepBytes = Math.max(maximumCanonicalStepBytes, canonicalBytes);
      supportActionRows += step.qHat.length;
      const workUnits = supportActionRows + 2 * (contributions.length + 1)
        + decisions.size + clusters.size;
      if (
        canonicalBytes > OPE_V4_RESOURCE_LIMITS.maximumCanonicalStepBytes
        || contributionCanonicalBytes > OPE_V4_RESOURCE_LIMITS.maximumCanonicalInputBytes
        || workUnits > OPE_V4_RESOURCE_LIMITS.maximumOpeWorkUnits
        || decisions.size > OPE_V4_RESOURCE_LIMITS.maximumDecisions
        || clusters.size > OPE_V4_RESOURCE_LIMITS.maximumViewerClusters
      ) {
        localBlocker = 'resource_limit_exceeded';
        throw new Error(localBlocker);
      }
      contributionOwners.set(contribution, owner);
      contributions.push(contribution);
      contributionHeadSha256 = contribution.contributionSha256;
    },
    commit: () => undefined,
    abort: () => undefined,
  });
  if (localBlocker) return reject(localBlocker);
  if (replay.status !== 'verified') return reject(replay.blocker);
  if (
    contributions.length !== evidence.expectedStepCount
    || supportActionRows !== evidence.expectedPredictionCount
    || decisions.size !== evidence.expectedDecisionCount
    || clusters.size !== evidence.expectedViewerClusterCount
  ) return reject('ope_v4_incomplete_cohort');

  const aggregateState = [...aggregates.entries()]
    .sort(([left], [right]) => compareText(left, right));
  const resourceDiagnostics = {
    preflightCompletedBeforeReplay: true as const,
    decisions: decisions.size,
    viewerClusters: clusters.size,
    slots: contributions.length,
    supportActionRows,
    sourceCombinedSpoolBytes: evidence.resourceDiagnostics.upstreamCombinedSpoolByteCount,
    evidenceCanonicalBytes: preflight.evidenceCanonicalBytes,
    contributionCanonicalBytes,
    maximumCanonicalStepBytes,
    aggregateStateEntries: aggregates.size,
    opeWorkUnits: supportActionRows + 2 * contributions.length + decisions.size + clusters.size,
  };
  const receiptPreimage = {
    contractVersion: 'verified_ope_v4_aggregate_receipt_v1' as const,
    estimand: OPE_V4_ESTIMAND,
    resourceLimitsVersion: OPE_V4_RESOURCE_LIMITS_VERSION,
    resourceConfigSha256: preflight.resourceConfigSha256,
    stateBindingSha256: preflight.stateBindingSha256,
    trajectoryEvidenceSha256: evidence.trajectoryEvidenceSha256,
    predictionSetVersion: evidence.predictionSetVersion,
    predictionVerificationReceiptSha256: evidence.predictionVerificationReceiptSha256,
    modelBundleSha256: evidence.modelBundleSha256,
    predictionStreamSha256: evidence.predictionStreamSha256,
    snapshotManifestSha256: evidence.snapshotManifestSha256,
    targetManifestSha256: evidence.targetManifestSha256,
    targetVerificationReceiptSha256: evidence.targetVerificationReceiptSha256,
    targetDistributionNdjsonSha256: evidence.targetDistributionNdjsonSha256,
    decisionContextEvidenceSha256: evidence.decisionContextEvidenceSha256,
    syntheticDecisionLogRootSha256: evidence.syntheticDecisionLogRootSha256,
    syntheticOutcomeEvidenceRootSha256: evidence.syntheticOutcomeEvidenceRootSha256,
    holdoutPlanSha256: evidence.holdoutPlanSha256,
    rewardDefinitionSha256: evidence.rewardDefinitionSha256,
    sourceClusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
    contributionHashChainSha256: contributionHeadSha256,
    aggregateStateSha256: digest(aggregateState),
    expectedDecisionCount: evidence.expectedDecisionCount,
    observedDecisionCount: decisions.size,
    expectedViewerClusterCount: evidence.expectedViewerClusterCount,
    observedViewerClusterCount: clusters.size,
    expectedSlotCount: evidence.expectedStepCount,
    observedSlotCount: contributions.length,
    drSlotCount: contributions.length,
    viewerClusterCrossFitProvenancePresent: true as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    resourceDiagnostics,
  };
  const receipt = recursivelyFreeze({
    ...receiptPreimage,
    receiptSha256: digest(receiptPreimage),
  });
  receipts.add(receipt);
  receiptDigests.set(receipt, receipt.receiptSha256);
  receiptOwners.set(receipt, owner);
  return recursivelyFreeze({
    status: 'verified' as const,
    contributions,
    receipt,
  });
}

export function isVerifiedOpeAggregateReceiptV4(
  value: unknown,
): value is VerifiedOpeAggregateReceiptV4 {
  try {
    if (!value || typeof value !== 'object' || !receipts.has(value)) return false;
    const candidate = value as VerifiedOpeAggregateReceiptV4;
    const owner = receiptOwners.get(value);
    const { receiptSha256: _ignored, ...preimage } = candidate;
    return owner !== undefined
      && isVerifiedSyntheticCohortTrajectoryEvidenceV1(owner.evidence)
      && recursivelyFrozen(candidate)
      && receiptDigests.get(value) === candidate.receiptSha256
      && digest(preimage) === candidate.receiptSha256;
  } catch {
    return false;
  }
}

export function isOpeSlotContributionBoundToReceiptV4(
  contribution: unknown,
  receipt: unknown,
): contribution is OpeSlotContributionV4 {
  try {
    if (!contribution || typeof contribution !== 'object'
      || !isVerifiedOpeAggregateReceiptV4(receipt)) return false;
    const candidate = contribution as OpeSlotContributionV4;
    const { contributionSha256: _ignored, ...preimage } = candidate;
    return recursivelyFrozen(candidate)
      && contributionOwners.get(contribution) === receiptOwners.get(receipt)
      && candidate.stateBindingSha256 === receipt.stateBindingSha256
      && digest(preimage) === candidate.contributionSha256;
  } catch {
    return false;
  }
}

function preflightEvidence(evidence: VerifiedSyntheticCohortTrajectoryEvidenceV1):
  | Readonly<{
    evidenceCanonicalBytes: number;
    resourceConfigSha256: string;
    stateBindingSha256: string;
  }>
  | Readonly<{ blocker: string }> {
  try {
    const limits = OPE_V4_RESOURCE_LIMITS;
    const diagnostics = evidence.resourceDiagnostics;
    const evidenceCanonicalBytes = Buffer.byteLength(canonicalDecisionJson(evidence));
    const expectedWorkUnits = evidence.expectedPredictionCount
      + 2 * evidence.expectedStepCount
      + evidence.expectedDecisionCount
      + evidence.expectedViewerClusterCount;
    if (
      evidence.sourceClusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
      || !evidence.viewerClusterCrossFitProvenancePresent
      || evidence.commonTimeShockHandlingVerified
      || evidence.multiwayClusterProvenancePresent
      || evidence.candidateEvidenceEligible
      || evidence.qualificationEvidenceEligible
      || evidence.realDatasetEligible
      || evidence.servable
    ) return { blocker: 'ope_v4_evidence_binding_mismatch' };
    if (
      evidence.expectedDecisionCount <= 0
      || evidence.expectedViewerClusterCount <= 0
      || evidence.expectedStepCount <= 0
      || evidence.expectedPredictionCount <= 0
      || evidence.steps.length !== evidence.expectedStepCount
      || diagnostics.decisionCount !== evidence.expectedDecisionCount
      || diagnostics.viewerClusterCount !== evidence.expectedViewerClusterCount
      || diagnostics.slotCount !== evidence.expectedStepCount
      || diagnostics.supportActionRowCount !== evidence.expectedPredictionCount
    ) return { blocker: 'ope_v4_incomplete_cohort' };
    if (
      evidence.expectedDecisionCount > limits.maximumDecisions
      || evidence.expectedViewerClusterCount > limits.maximumViewerClusters
      || evidence.expectedStepCount > limits.maximumSlots
      || evidence.expectedPredictionCount > limits.maximumSupportActionRows
      || diagnostics.upstreamCombinedSpoolByteCount > limits.maximumCanonicalInputBytes
      || evidenceCanonicalBytes > limits.maximumCanonicalInputBytes
      || diagnostics.peakBufferedBytes > limits.maximumCanonicalStepBytes
      || expectedWorkUnits > limits.maximumOpeWorkUnits
    ) return { blocker: 'resource_limit_exceeded' };
    const resourceConfigSha256 = digest({
      resourceLimitsVersion: OPE_V4_RESOURCE_LIMITS_VERSION,
      limits,
    });
    const stateBindingSha256 = digest({
      resourceConfigSha256,
      trajectoryEvidenceSha256: evidence.trajectoryEvidenceSha256,
      predictionSetVersion: evidence.predictionSetVersion,
      predictionVerificationReceiptSha256: evidence.predictionVerificationReceiptSha256,
      decisionContextEvidenceSha256: evidence.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: evidence.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: evidence.syntheticOutcomeEvidenceRootSha256,
      targetManifestSha256: evidence.targetManifestSha256,
      targetVerificationReceiptSha256: evidence.targetVerificationReceiptSha256,
      holdoutPlanSha256: evidence.holdoutPlanSha256,
    });
    return { evidenceCanonicalBytes, resourceConfigSha256, stateBindingSha256 };
  } catch {
    return { blocker: 'ope_v4_source_unverified' };
  }
}

function inspectStep(
  evidence: VerifiedSyntheticCohortTrajectoryEvidenceV1,
  step: VerifiedSyntheticCohortTrajectoryStepV1,
  prefixes: ReadonlyMap<string, PrefixState>,
): Readonly<{
  targetProbability: number;
  targetQValues: readonly Readonly<{ probability: number; qValue: number }>[];
  loggedQ: number;
  prefixLogWeight: number;
}> | Readonly<{ blocker: string }> {
  if (!isVerifiedSyntheticCohortTrajectoryStepBoundToEvidenceV1(step, evidence)) {
    return { blocker: 'ope_v4_step_unverified' };
  }
  if (
    step.predictionSetVersion !== evidence.predictionSetVersion
    || step.predictionVerificationReceiptSha256
      !== evidence.predictionVerificationReceiptSha256
    || step.binding.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
    || step.binding.decisionContextEvidenceSha256 !== evidence.decisionContextEvidenceSha256
    || step.binding.snapshotManifestSha256 !== evidence.snapshotManifestSha256
    || step.binding.targetManifestSha256 !== evidence.targetManifestSha256
    || step.binding.targetVerificationReceiptSha256
      !== evidence.targetVerificationReceiptSha256
    || step.binding.holdoutPlanSha256 !== evidence.holdoutPlanSha256
  ) return { blocker: 'ope_v4_evidence_binding_mismatch' };

  const prior = prefixes.get(step.decisionId);
  const expectedPrefix = prior?.actionKeys ?? [];
  if (step.servedPosition !== expectedPrefix.length + 1
    || !same(step.prefixActionKeys, expectedPrefix)) {
    return { blocker: 'ope_v4_prefix_mismatch' };
  }
  const behaviorIds = step.behaviorSupportActions.map(actionIdentity);
  const targetIds = step.targetDistribution.map((entry) => actionIdentity(entry.actionKey));
  const qHatIds = step.qHat.map((entry) => actionIdentity(entry.actionKey));
  const loggedId = actionIdentity(step.loggedActionKey);
  if (
    new Set(behaviorIds).size !== behaviorIds.length
    || new Set(targetIds).size !== targetIds.length
    || new Set(qHatIds).size !== qHatIds.length
    || !same([...behaviorIds].sort(compareText), [...targetIds].sort(compareText))
    || !same([...targetIds].sort(compareText), [...qHatIds].sort(compareText))
    || !behaviorIds.includes(loggedId)
  ) return { blocker: 'ope_v4_support_mismatch' };

  const targetMass = step.targetDistribution.reduce((sum, entry) => (
    sum + entry.probability
  ), 0);
  const targetProbability = step.targetDistribution.find((entry) => (
    actionIdentity(entry.actionKey) === loggedId
  ))?.probability;
  if (
    !Number.isFinite(step.behaviorProbability)
    || step.behaviorProbability <= 0
    || step.behaviorProbability > 1
    || targetProbability === undefined
    || !Number.isFinite(targetProbability)
    || targetProbability <= 0
    || targetProbability > 1
    || !Number.isFinite(targetMass)
    || Math.abs(targetMass - 1) > 1e-8
    || !Number.isFinite(step.reward)
  ) return { blocker: 'ope_v4_probability_invalid' };

  const qHat = new Map(step.qHat.map((entry) => [actionIdentity(entry.actionKey), entry.value]));
  const targetQValues = step.targetDistribution.map((entry) => ({
    probability: entry.probability,
    qValue: qHat.get(actionIdentity(entry.actionKey)),
  }));
  const loggedQ = qHat.get(loggedId);
  if (loggedQ === undefined || !Number.isFinite(loggedQ)
    || targetQValues.some((entry) => !Number.isFinite(entry.qValue))) {
    return { blocker: 'ope_v4_qhat_invalid' };
  }
  return {
    targetProbability,
    targetQValues: targetQValues as Array<{ probability: number; qValue: number }>,
    loggedQ,
    prefixLogWeight: prior?.logWeight ?? 0,
  };
}

function reject(blocker: string): Readonly<{ status: 'not_evaluable'; blocker: string }> {
  return Object.freeze({ status: 'not_evaluable' as const, blocker });
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}
