import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  isVerifiedSyntheticTrajectoryEvidenceV1,
  isVerifiedSyntheticTrajectoryStepBoundToEvidenceV1,
  isVerifiedSyntheticTrajectoryStepV1,
  replayVerifiedSyntheticTrajectoryEvidenceV1,
  type VerifiedSyntheticTrajectoryEvidenceV1,
  type VerifiedSyntheticTrajectoryStepV1,
} from '../../offlinePrediction/streamingV2';
import {
  isVerifiedPredictionStepV2,
  type VerifiedPredictionStepV2,
} from '../../offlinePrediction/predictionV2';
import { evaluateSequentialDrSlotV1 } from '../core/sequentialDr';
import {
  OPE_V3_ESTIMAND,
  OPE_V3_RESOURCE_LIMITS_VERSION,
  type OpeAggregateStateV3,
  type OpeSlotContributionV3,
  type OpeV3ResourceLimits,
  type VerifiedOpeAggregateReceiptV3,
} from './contracts';

const positiveSafeInt = z.number().int().safe().positive();
const limitsSchema = z.object({
  maxDecisions: positiveSafeInt,
  maxSlots: positiveSafeInt,
  maxClusters: positiveSafeInt,
  maxSegmentKeys: positiveSafeInt,
  maxObjectives: positiveSafeInt,
  maxAggregateStateEntries: positiveSafeInt,
  maxEstimatedAggregateStateBytes: positiveSafeInt,
  maxBufferedActions: positiveSafeInt,
  maxBufferedRecords: positiveSafeInt,
  maxBufferedBytes: positiveSafeInt,
}).strict();
const createInputSchema = z.object({
  limits: limitsSchema,
  trajectories: z.array(z.custom<VerifiedSyntheticTrajectoryEvidenceV1>()).min(1),
}).strict();
const predictionContextSchema = z.object({
  predictionStep: z.custom<VerifiedPredictionStepV2>().optional(),
}).strict();

type PrefixState = { actionKeys: VerifiedSyntheticTrajectoryStepV1['prefixActionKeys']; logWeight: number };
type Aggregate = { contributionSum: number; slotCount: number };
type ExpectedDecision = {
  trajectory: VerifiedSyntheticTrajectoryEvidenceV1;
  nextIndex: number;
};
type PredictionEvidenceRoot = {
  predictionSetVersion: string;
  verificationReceiptSha256: string;
};
type StateMetadata = {
  limits: OpeV3ResourceLimits;
  resourceConfigSha256: string;
  stateBindingSha256: string;
  trajectoryCohortSha256: string;
  outcomeEvidenceRootsSha256: string;
  contextEvidenceRootsSha256: string;
  targetEvidenceRootsSha256: string;
  expectedDecisions: Map<string, ExpectedDecision>;
  expectedSlotCount: number;
  decisions: Set<string>;
  clusters: Set<string>;
  segmentKeys: Set<string>;
  objectives: Set<string>;
  prefixes: Map<string, PrefixState>;
  aggregates: Map<string, Aggregate>;
  predictionEvidence?: PredictionEvidenceRoot;
  drMode?: 'ips' | 'dr';
  slots: number;
  drSlots: number;
  estimatedBytes: number;
  peakBufferedActions: number;
  peakBufferedRecords: number;
  peakBufferedBytes: number;
  contributionHeadSha256: string;
  terminalBlocker?: string;
  finalized: boolean;
};

const states = new WeakMap<object, StateMetadata>();
const receipts = new WeakSet<object>();
const receiptDigests = new WeakMap<object, string>();
const contributionOwners = new WeakMap<object, OpeAggregateStateV3>();
const receiptOwners = new WeakMap<object, OpeAggregateStateV3>();

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const identity = (value: { candidateNamespace: string; candidateId: string }): string => (
  `${value.candidateNamespace}\u0000${value.candidateId}`
);
const actionKeyIdentity = (value: VerifiedSyntheticTrajectoryStepV1['loggedActionKey']): string => (
  canonicalDecisionJson(value)
);
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);
const notEvaluable = (blocker: string) => ({ status: 'not_evaluable' as const, blocker });

export function createOpeAggregateStateV3(raw: unknown):
  | { status: 'created'; state: OpeAggregateStateV3 }
  | { status: 'not_evaluable'; blocker: string } {
  let parsed: ReturnType<typeof createInputSchema.safeParse>;
  try {
    parsed = createInputSchema.safeParse(raw);
  } catch {
    return notEvaluable('ope_v3_resource_config_invalid');
  }
  if (!parsed.success) {
    try {
      const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
      if (Array.isArray(record?.trajectories) && record.trajectories.length === 0) {
        return notEvaluable('ope_v3_empty_cohort');
      }
    } catch {
      return notEvaluable('ope_v3_resource_config_invalid');
    }
    return notEvaluable('ope_v3_resource_config_invalid');
  }
  if (parsed.data.trajectories.some((entry) => !isVerifiedSyntheticTrajectoryEvidenceV1(entry))) {
    return notEvaluable('ope_v3_trajectory_brand_missing');
  }
  const expectedDecisions = new Map<string, ExpectedDecision>();
  let expectedSlotCount = 0;
  let peakBufferedActions = 0;
  let peakBufferedRecords = 0;
  let peakBufferedBytes = 0;
  for (const trajectory of parsed.data.trajectories) {
    const decisionId = trajectory.decisionId;
    if (
      !decisionId
      || trajectory.steps.length !== trajectory.expectedStepCount
      || expectedDecisions.has(decisionId)
      || trajectory.steps.some((step, index) => (
        step.decisionId !== decisionId || step.servedPosition !== index + 1
      ))
    ) return notEvaluable('ope_v3_trajectory_cohort_invalid');
    expectedDecisions.set(decisionId, { trajectory, nextIndex: 0 });
    expectedSlotCount += trajectory.expectedStepCount;
    if (!Number.isSafeInteger(expectedSlotCount)) {
      return notEvaluable('ope_v3_resource_limit_exceeded');
    }
    peakBufferedActions = Math.max(
      peakBufferedActions, trajectory.highWaterDiagnostics.peakBufferedActions,
    );
    peakBufferedRecords = Math.max(
      peakBufferedRecords, trajectory.highWaterDiagnostics.peakBufferedRecords,
    );
    peakBufferedBytes = Math.max(
      peakBufferedBytes, trajectory.highWaterDiagnostics.peakBufferedBytes,
    );
  }
  if (
    expectedDecisions.size > parsed.data.limits.maxDecisions
    || expectedSlotCount > parsed.data.limits.maxSlots
    || peakBufferedActions > parsed.data.limits.maxBufferedActions
    || peakBufferedRecords > parsed.data.limits.maxBufferedRecords
    || peakBufferedBytes > parsed.data.limits.maxBufferedBytes
  ) return notEvaluable('ope_v3_resource_limit_exceeded');

  const trajectoryRoots = parsed.data.trajectories
    .map((entry) => entry.trajectoryEvidenceSha256).sort(compareText);
  const outcomeRoots = parsed.data.trajectories
    .map((entry) => entry.syntheticOutcomeEvidenceSha256).sort(compareText);
  const contextRoots = parsed.data.trajectories
    .map((entry) => entry.syntheticContextSha256).sort(compareText);
  const targetRoots = parsed.data.trajectories.map((entry) => ({
    targetManifestSha256: entry.targetManifestSha256,
    targetVerificationReceiptSha256: entry.targetVerificationReceiptSha256,
    targetDistributionNdjsonSha256: entry.targetDistributionNdjsonSha256,
  })).sort((left, right) => compareText(canonicalDecisionJson(left), canonicalDecisionJson(right)));
  const resourceConfig = {
    resourceLimitsVersion: OPE_V3_RESOURCE_LIMITS_VERSION,
    limits: parsed.data.limits,
  };
  const roots = {
    trajectoryCohortSha256: digest(trajectoryRoots),
    outcomeEvidenceRootsSha256: digest(outcomeRoots),
    contextEvidenceRootsSha256: digest(contextRoots),
    targetEvidenceRootsSha256: digest(targetRoots),
  };
  const resourceConfigSha256 = digest(resourceConfig);
  const stateBindingSha256 = digest({ resourceConfigSha256, ...roots });
  const initialEstimatedBytes = estimatedBytes({
    expectedDecisions,
    decisions: new Set(),
    clusters: new Set(),
    segmentKeys: new Set(),
    objectives: new Set(),
    prefixes: new Map(),
    aggregates: new Map(),
    predictionEvidence: undefined,
  });
  if (initialEstimatedBytes > parsed.data.limits.maxEstimatedAggregateStateBytes) {
    return notEvaluable('ope_v3_resource_limit_exceeded');
  }
  const state = Object.freeze({ contractVersion: 'ope_v3_aggregate_state_v1' as const });
  states.set(state, {
    limits: parsed.data.limits,
    resourceConfigSha256,
    stateBindingSha256,
    ...roots,
    expectedDecisions,
    expectedSlotCount,
    decisions: new Set(),
    clusters: new Set(),
    segmentKeys: new Set(),
    objectives: new Set(),
    prefixes: new Map(),
    aggregates: new Map(),
    slots: 0,
    drSlots: 0,
    estimatedBytes: initialEstimatedBytes,
    peakBufferedActions,
    peakBufferedRecords,
    peakBufferedBytes,
    contributionHeadSha256: digest({ stateBindingSha256, chain: 'empty_v1' }),
    finalized: false,
  });
  return { status: 'created', state };
}

export function consumeOpeStepContributionV3(
  state: OpeAggregateStateV3,
  step: VerifiedSyntheticTrajectoryStepV1,
  rawContext: { predictionStep?: VerifiedPredictionStepV2 },
): { status: 'emitted'; contribution: OpeSlotContributionV3 }
  | { status: 'not_evaluable'; blocker: string } {
  const metadata = states.get(state);
  if (!metadata || metadata.finalized) return notEvaluable('ope_v3_state_brand_missing');
  if (metadata.terminalBlocker) return notEvaluable(metadata.terminalBlocker);
  if (!isVerifiedSyntheticTrajectoryStepV1(step)) return poison(metadata, 'ope_v3_step_brand_missing');
  const expected = metadata.expectedDecisions.get(step.decisionId);
  if (!expected || !isVerifiedSyntheticTrajectoryStepBoundToEvidenceV1(
    step,
    expected.trajectory,
  )) return poison(metadata, 'ope_v3_step_not_in_cohort');
  const expectedSummary = expected.trajectory.steps[expected.nextIndex];
  if (
    !expectedSummary
    || expectedSummary.decisionId !== step.decisionId
    || expectedSummary.servedPosition !== step.servedPosition
    || expectedSummary.behaviorProbability !== step.behaviorProbability
  ) {
    return poison(metadata, 'ope_v3_prefix_mismatch');
  }
  let context: ReturnType<typeof predictionContextSchema.safeParse>;
  try {
    context = predictionContextSchema.safeParse(rawContext);
  } catch {
    return poison(metadata, 'ope_v3_step_contract_invalid');
  }
  if (!context.success) return poison(metadata, 'ope_v3_step_contract_invalid');

  const prior = metadata.prefixes.get(step.decisionId);
  const expectedPrefix = prior?.actionKeys ?? [];
  if (step.servedPosition !== expectedPrefix.length + 1 || !same(step.prefixActionKeys, expectedPrefix)) {
    return poison(metadata, 'ope_v3_prefix_mismatch');
  }
  const support = new Set(step.behaviorSupportActions.map(identity));
  if (
    support.size !== step.behaviorSupportActions.length
    || !support.has(identity(step.loggedActionKey))
    || step.targetDistribution.some((entry) => !support.has(identity(entry.actionKey)))
  ) return poison(metadata, 'ope_v3_support_mismatch');
  const targetMass = step.targetDistribution.reduce((sum, entry) => sum + entry.probability, 0);
  const targetProbability = step.targetDistribution.find((entry) => (
    actionKeyIdentity(entry.actionKey) === actionKeyIdentity(step.loggedActionKey)
  ))?.probability;
  if (
    !Number.isFinite(step.behaviorProbability)
    || step.behaviorProbability <= 0
    || step.behaviorProbability > 1
    || targetProbability === undefined
    || !Number.isFinite(targetProbability)
    || targetProbability <= 0
    || targetProbability > 1
    || Math.abs(targetMass - 1) > 1e-8
  ) return poison(metadata, 'ope_v3_probability_invalid');

  let qHat: Map<string, number> | undefined;
  const predictionStep = context.data.predictionStep;
  if (predictionStep) {
    if (
      !isVerifiedPredictionStepV2(predictionStep)
      || predictionStep.decisionId !== step.decisionId
      || predictionStep.servedPosition !== step.servedPosition
    ) return poison(metadata, 'ope_v3_prediction_step_invalid');
    qHat = new Map(predictionStep.qHat.map((entry) => [
      actionKeyIdentity(entry.actionKey), entry.value,
    ]));
    if (
      qHat.size !== predictionStep.qHat.length
      || qHat.size !== step.targetDistribution.length
      || step.targetDistribution.some((entry) => !qHat!.has(actionKeyIdentity(entry.actionKey)))
    ) return poison(metadata, 'ope_v3_prediction_step_invalid');
  }
  const proposedDrMode = predictionStep ? 'dr' as const : 'ips' as const;
  if (metadata.drMode && metadata.drMode !== proposedDrMode) {
    return poison(metadata, 'ope_v3_mixed_dr_mode');
  }
  const predictionEvidence = predictionStep ? {
    predictionSetVersion: predictionStep.predictionSetVersion,
    verificationReceiptSha256: predictionStep.verificationReceiptSha256,
  } : undefined;
  if (
    metadata.predictionEvidence
    && (!predictionEvidence
      || metadata.predictionEvidence.predictionSetVersion
        !== predictionEvidence.predictionSetVersion
      || metadata.predictionEvidence.verificationReceiptSha256
        !== predictionEvidence.verificationReceiptSha256)
  ) return poison(metadata, 'ope_v3_prediction_receipt_mismatch');

  const prefixLogWeight = prior?.logWeight ?? 0;
  const targetQValues = qHat ? step.targetDistribution.map((entry) => {
    const qValue = qHat!.get(actionKeyIdentity(entry.actionKey));
    return qValue === undefined ? undefined : { probability: entry.probability, qValue };
  }) : undefined;
  if (targetQValues?.some((entry) => entry === undefined)) {
    return poison(metadata, 'ope_v3_qhat_invalid');
  }
  const evaluated = evaluateSequentialDrSlotV1({
    prefixLogWeight,
    behaviorProbability: step.behaviorProbability,
    targetProbability,
    reward: step.reward,
    ...(targetQValues ? {
      targetQValues: targetQValues as Array<{ probability: number; qValue: number }>,
      loggedQ: qHat!.get(actionKeyIdentity(step.loggedActionKey)),
    } : {}),
  });
  if (evaluated.status === 'not_evaluable') return poison(metadata, evaluated.blocker);
  const { logWeight, prefixWeight, weight, ipsContribution, drContribution } = evaluated;

  const decisions = new Set(metadata.decisions).add(step.decisionId);
  const clusters = new Set(metadata.clusters).add(step.binding.inferenceClusterId);
  const segmentKeys = new Set(metadata.segmentKeys);
  step.binding.segmentAssignments.forEach((entry) => segmentKeys.add(entry.key));
  const objectives = new Set(metadata.objectives).add(step.binding.objective);
  const prefixes = new Map(metadata.prefixes).set(step.decisionId, {
    actionKeys: [...step.prefixActionKeys, step.loggedActionKey],
    logWeight,
  });
  const aggregateKey = canonicalDecisionJson({
    inferenceClusterId: step.binding.inferenceClusterId,
    objective: step.binding.objective,
    segmentAssignments: step.binding.segmentAssignments,
  });
  const aggregates = new Map(metadata.aggregates);
  const aggregate = aggregates.get(aggregateKey) ?? { contributionSum: 0, slotCount: 0 };
  const effectiveContribution = drContribution ?? ipsContribution;
  const proposedSum = aggregate.contributionSum + effectiveContribution;
  if (!Number.isFinite(proposedSum)) return poison(metadata, 'ope_v3_aggregate_non_finite');
  if (proposedSum === 0 && aggregate.contributionSum !== -effectiveContribution
    && (aggregate.contributionSum !== 0 || effectiveContribution !== 0)) {
    return poison(metadata, 'importance_contribution_underflow');
  }
  aggregates.set(aggregateKey, { contributionSum: proposedSum, slotCount: aggregate.slotCount + 1 });
  const proposedSlots = metadata.slots + 1;
  const proposedBytes = estimatedBytes({
    expectedDecisions: metadata.expectedDecisions,
    decisions,
    clusters,
    segmentKeys,
    objectives,
    prefixes,
    aggregates,
    predictionEvidence: metadata.predictionEvidence ?? predictionEvidence,
  });
  if (
    decisions.size > metadata.limits.maxDecisions
    || proposedSlots > metadata.limits.maxSlots
    || clusters.size > metadata.limits.maxClusters
    || segmentKeys.size > metadata.limits.maxSegmentKeys
    || objectives.size > metadata.limits.maxObjectives
    || aggregates.size > metadata.limits.maxAggregateStateEntries
    || proposedBytes > metadata.limits.maxEstimatedAggregateStateBytes
  ) return poison(metadata, 'ope_v3_resource_limit_exceeded');

  const contributionPreimage = {
    contractVersion: 'ope_v3_slot_contribution_v1' as const,
    estimand: OPE_V3_ESTIMAND,
    stateBindingSha256: metadata.stateBindingSha256,
    priorContributionSha256: metadata.contributionHeadSha256,
    decisionId: step.decisionId,
    servedPosition: step.servedPosition,
    prefixLogWeight,
    logWeight,
    prefixWeight,
    weight,
    behaviorProbability: step.behaviorProbability,
    targetProbability,
    reward: step.reward,
    ipsContribution,
    ...(drContribution === undefined ? {} : { drContribution }),
    binding: {
      ...step.binding,
      ...(predictionStep ? {
        prediction: {
          predictionSetVersion: predictionStep.predictionSetVersion,
          verificationReceiptSha256: predictionStep.verificationReceiptSha256,
        },
      } : {}),
    },
  };
  const contribution = recursivelyFreeze({
    ...contributionPreimage,
    contributionSha256: digest(contributionPreimage),
  });
  metadata.decisions = decisions;
  metadata.clusters = clusters;
  metadata.segmentKeys = segmentKeys;
  metadata.objectives = objectives;
  metadata.prefixes = prefixes;
  metadata.aggregates = aggregates;
  metadata.predictionEvidence ??= predictionEvidence;
  metadata.drMode ??= proposedDrMode;
  metadata.slots = proposedSlots;
  if (predictionStep) metadata.drSlots += 1;
  metadata.estimatedBytes = Math.max(metadata.estimatedBytes, proposedBytes);
  metadata.contributionHeadSha256 = contribution.contributionSha256;
  expected.nextIndex += 1;
  contributionOwners.set(contribution, state);
  return { status: 'emitted', contribution };
}

export async function replayOpeTrajectoryV3(
  state: OpeAggregateStateV3,
  trajectory: VerifiedSyntheticTrajectoryEvidenceV1,
  visitor: {
    contextForStep?: (step: VerifiedSyntheticTrajectoryStepV1) =>
      Promise<{ predictionStep?: VerifiedPredictionStepV2 }>
      | { predictionStep?: VerifiedPredictionStepV2 };
    onContribution?: (contribution: OpeSlotContributionV3) => Promise<void> | void;
  } = {},
): Promise<{ status: 'verified' } | { status: 'not_evaluable'; blocker: string }> {
  const metadata = states.get(state);
  if (!metadata || metadata.finalized) return notEvaluable('ope_v3_state_brand_missing');
  if (metadata.terminalBlocker) return notEvaluable(metadata.terminalBlocker);
  let callbackBlocker: string | undefined;
  const replay = await replayVerifiedSyntheticTrajectoryEvidenceV1(trajectory, {
    onStep: async (step) => {
      let context: { predictionStep?: VerifiedPredictionStepV2 } = {};
      try {
        context = await visitor.contextForStep?.(step) ?? {};
      } catch {
        callbackBlocker = 'ope_v3_context_callback_failed';
        poison(metadata, callbackBlocker);
        throw new Error(callbackBlocker);
      }
      const result = consumeOpeStepContributionV3(state, step, context);
      if (result.status !== 'emitted') {
        callbackBlocker = result.blocker;
        throw new Error(result.blocker);
      }
      try {
        await visitor.onContribution?.(result.contribution);
      } catch {
        callbackBlocker = 'ope_v3_contribution_callback_failed';
        poison(metadata, callbackBlocker);
        throw new Error(callbackBlocker);
      }
    },
    commit: () => undefined,
    abort: (blocker) => { poison(metadata, callbackBlocker ?? blocker); },
  });
  if (callbackBlocker) return notEvaluable(callbackBlocker);
  if (replay.status !== 'verified') return poison(metadata, replay.blocker);
  return { status: 'verified' };
}

export function finalizeOpeAggregateReceiptV3(state: OpeAggregateStateV3):
  | { status: 'verified'; receipt: VerifiedOpeAggregateReceiptV3 }
  | { status: 'not_evaluable'; blocker: string } {
  const metadata = states.get(state);
  if (!metadata || metadata.finalized) return notEvaluable('ope_v3_state_brand_missing');
  if (metadata.terminalBlocker) return notEvaluable(metadata.terminalBlocker);
  const complete = metadata.slots > 0
    && [...metadata.expectedDecisions.values()].every((entry) => (
      entry.nextIndex === entry.trajectory.expectedStepCount
    ))
    && metadata.decisions.size === metadata.expectedDecisions.size;
  if (!complete) return poison(metadata, 'ope_v3_incomplete_cohort');
  if (metadata.drSlots !== 0 && metadata.drSlots !== metadata.slots) {
    return poison(metadata, 'ope_v3_mixed_dr_mode');
  }
  const aggregates = [...metadata.aggregates.entries()]
    .sort(([left], [right]) => compareText(left, right));
  const aggregateStateSha256 = digest(aggregates);
  const preimage = {
    contractVersion: 'verified_ope_v3_aggregate_receipt_v1' as const,
    estimand: OPE_V3_ESTIMAND,
    resourceLimitsVersion: OPE_V3_RESOURCE_LIMITS_VERSION,
    resourceConfigSha256: metadata.resourceConfigSha256,
    stateBindingSha256: metadata.stateBindingSha256,
    trajectoryCohortSha256: metadata.trajectoryCohortSha256,
    outcomeEvidenceRootsSha256: metadata.outcomeEvidenceRootsSha256,
    contextEvidenceRootsSha256: metadata.contextEvidenceRootsSha256,
    targetEvidenceRootsSha256: metadata.targetEvidenceRootsSha256,
    predictionEvidenceRootsSha256: digest(
      metadata.predictionEvidence ? [metadata.predictionEvidence] : [],
    ),
    contributionHashChainSha256: metadata.contributionHeadSha256,
    aggregateStateSha256,
    expectedDecisionCount: metadata.expectedDecisions.size,
    observedDecisionCount: metadata.decisions.size,
    expectedSlotCount: metadata.expectedSlotCount,
    observedSlotCount: metadata.slots,
    drSlotCount: metadata.drSlots,
    fullyStreaming: false as const,
    boundedInMemoryEvidence: [
      'synthetic_outcome_v1',
      'synthetic_context_v1',
      'synthetic_trajectory_step_summaries_v1',
    ] as const,
    highWaterDiagnostics: {
      decisions: metadata.decisions.size,
      slots: metadata.slots,
      clusters: metadata.clusters.size,
      segmentKeys: metadata.segmentKeys.size,
      objectives: metadata.objectives.size,
      aggregateStateEntries: metadata.aggregates.size,
      estimatedAggregateStateBytes: metadata.estimatedBytes,
      peakBufferedActions: metadata.peakBufferedActions,
      peakBufferedRecords: metadata.peakBufferedRecords,
      peakBufferedBytes: metadata.peakBufferedBytes,
    },
  };
  const receipt = recursivelyFreeze({ ...preimage, receiptSha256: digest(preimage) });
  receipts.add(receipt);
  receiptDigests.set(receipt, receipt.receiptSha256);
  receiptOwners.set(receipt, state);
  metadata.finalized = true;
  return { status: 'verified', receipt };
}

export function isVerifiedOpeAggregateReceiptV3(value: unknown): value is VerifiedOpeAggregateReceiptV3 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    const candidate = value as VerifiedOpeAggregateReceiptV3;
    const { receiptSha256: _ignored, ...preimage } = candidate;
    return receipts.has(value)
      && receiptDigests.get(value) === candidate.receiptSha256
      && digest(preimage) === candidate.receiptSha256;
  } catch {
    return false;
  }
}

export function isOpeSlotContributionBoundToReceiptV3(
  contribution: unknown,
  receipt: unknown,
): contribution is OpeSlotContributionV3 {
  try {
    if (
      !contribution
      || typeof contribution !== 'object'
      || !receipt
      || typeof receipt !== 'object'
      || !isVerifiedOpeAggregateReceiptV3(receipt)
    ) return false;
    const candidate = contribution as OpeSlotContributionV3;
    const { contributionSha256: _ignored, ...preimage } = candidate;
    return recursivelyFrozen(contribution)
      && contributionOwners.get(contribution) === receiptOwners.get(receipt)
      && candidate.stateBindingSha256 === receipt.stateBindingSha256
      && digest(preimage) === candidate.contributionSha256;
  } catch {
    return false;
  }
}

function poison(metadata: StateMetadata, blocker: string) {
  metadata.terminalBlocker ??= blocker;
  return notEvaluable(metadata.terminalBlocker);
}

function estimatedBytes(metadata: Pick<StateMetadata,
  'expectedDecisions' | 'decisions' | 'clusters' | 'segmentKeys' | 'objectives'
  | 'prefixes' | 'aggregates' | 'predictionEvidence'>): number {
  return Buffer.byteLength(canonicalDecisionJson({
    expectedTrajectories: [...metadata.expectedDecisions.values()]
      .map((entry) => entry.trajectory)
      .sort((left, right) => compareText(
        left.trajectoryEvidenceSha256,
        right.trajectoryEvidenceSha256,
      )),
    decisions: [...metadata.decisions].sort(compareText),
    clusters: [...metadata.clusters].sort(compareText),
    segmentKeys: [...metadata.segmentKeys].sort(compareText),
    objectives: [...metadata.objectives].sort(compareText),
    prefixes: [...metadata.prefixes.entries()].sort(([left], [right]) => compareText(left, right)),
    aggregates: [...metadata.aggregates.entries()].sort(([left], [right]) => compareText(left, right)),
    predictionEvidence: metadata.predictionEvidence,
  }));
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
