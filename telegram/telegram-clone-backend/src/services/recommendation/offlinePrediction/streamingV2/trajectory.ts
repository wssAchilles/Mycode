import { createHash } from 'crypto';

import { z } from 'zod';

import {
  isVerifiedSyntheticContextV1,
  type SyntheticSegmentAssignmentV1,
  type VerifiedSyntheticContextV1,
} from '../../decisionContext/syntheticContextV1';
import {
  canonicalDecisionJson,
  decisionLogSha256,
} from '../../decisionLog/contracts';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
  type VerifiedSyntheticOutcomeEvidenceV1,
} from '../../outcomes/syntheticOutcomeEvidenceV1';
import { verifyRandomizedSlateSimulationV1 } from '../../randomizedSlate/verify';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
  type VerifiedTargetDistributionEvidenceV2,
  type VerifiedTargetDistributionStepV2,
} from '../targetEvidence';
import {
  phase11SyntheticBehaviorFixtureV1Schema,
  syntheticDecisionLogV1Schema,
  type Phase11SyntheticBehaviorFixtureV1,
  type SyntheticDecisionLogV1,
} from './contracts';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const verificationInputSchema = z.object({
  contractVersion: z.literal('synthetic_trajectory_verification_input_v1'),
  behaviorFixture: phase11SyntheticBehaviorFixtureV1Schema,
  syntheticDecisionLog: syntheticDecisionLogV1Schema,
  syntheticDecisionLogSha256: sha256Schema,
  outcomeEvidence: z.custom<VerifiedSyntheticOutcomeEvidenceV1>(),
  contextEvidence: z.custom<VerifiedSyntheticContextV1>(),
  targetEvidence: z.custom<VerifiedTargetDistributionEvidenceV2>(),
  evidenceKind: z.literal('simulated_propensity'),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
}).strict();

const BEHAVIOR_ROOT = Object.freeze({
  fixtureSha256: '2bc99506bf8d7d58a8f6f996f740b80e0a002d08a00870ace3e9e9d400bf9771',
  inputSha256: 'a850bccf125e60bdcf068bfe4a8273ed6c5ff57b49f8f5cc7b020d2cc4773feb',
  simulationObjectSha256: 'f13d424fc8129c249075dade96091aead0e0e5426adfa7f916c56d42650ea4f5',
  simulationSelfSha256: '435e3e879c998adf791f7f1122f0a075c09efe1fab2afbddaa031d9a5f2f168b',
  sourceDecisionLogSha256: 'be8aabdce24756d9e3c085d7e1eb373603f9819bb31b372de07720c96a56304e',
  sourceCandidatePoolSha256: '22ab5c3bbb9e91a36aae9858120964fbc9fb994f5a50786935258d8b6c064d82',
  behaviorPolicyConfigSha256: '55905b22e6b2775a1defb0f0ada17a9cecb9ed9b01436b2e4322b19b292e7299',
  targetPolicyConfigSha256: 'b5733bd95b7db416eb2371f29e56285f7b48453fc454c98e0150982a3604a800',
});

type ActionKey = SyntheticDecisionLogV1['actions'][number]['actionKey'];

export type VerifiedSyntheticTrajectoryStepV1 = {
  decisionId: string;
  servedPosition: number;
  prefixActionKeys: ActionKey[];
  loggedActionKey: ActionKey;
  behaviorProbability: number;
  behaviorSupportActions: ActionKey[];
  targetDistribution: Array<{ actionKey: ActionKey; probability: number }>;
  reward: number;
  binding: {
    inferenceClusterId: string;
    segmentAssignments: SyntheticSegmentAssignmentV1[];
    objective: string;
    syntheticOutcomeEvidenceSha256: string;
    syntheticContextSha256: string;
  };
};

export type VerifiedSyntheticTrajectoryStepSummaryV1 = {
  decisionId: string;
  servedPosition: number;
  behaviorProbability: number;
};

export const SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1 = Object.freeze({
  version: 'synthetic_trajectory_buffer_limits_v1' as const,
  maxBufferedActions: 4_096,
  maxBufferedRecords: 2_049,
  maxBufferedBytes: 1_048_576,
});

export type SyntheticTrajectoryBufferDiagnosticsV1 = {
  peakBufferedActions: number;
  peakBufferedRecords: number;
  peakBufferedBytes: number;
};

export type VerifiedSyntheticTrajectoryEvidenceV1 = {
  contractVersion: 'verified_synthetic_trajectory_evidence_v1';
  trajectoryEvidenceSha256: string;
  syntheticDecisionLogSha256: string;
  sourceDecisionLogSha256: string;
  sourceCandidatePoolSha256: string;
  behaviorFixtureSha256: string;
  behaviorSimulationSha256: string;
  targetManifestSha256: string;
  targetVerificationReceiptSha256: string;
  targetDistributionNdjsonSha256: string;
  syntheticOutcomeEvidenceSha256: string;
  syntheticContextSha256: string;
  behaviorPolicyConfigSha256: string;
  targetPolicyConfigSha256: string;
  evidenceKind: 'simulated_propensity';
  decisionId: string;
  expectedStepCount: number;
  steps: VerifiedSyntheticTrajectoryStepSummaryV1[];
  bufferLimitsVersion: typeof SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1.version;
  highWaterDiagnostics: SyntheticTrajectoryBufferDiagnosticsV1;
  realDatasetEligible: false;
  servable: false;
};

export type VerifySyntheticTrajectoryEvidenceResultV1 =
  | { status: 'verified'; evidence: VerifiedSyntheticTrajectoryEvidenceV1 }
  | { status: 'not_evaluable'; blocker: string };

const verifiedEvidence = new WeakSet<object>();
const evidenceDigests = new WeakMap<object, string>();
const verifiedSteps = new WeakSet<object>();
const activeStepOwners = new WeakMap<object, VerifiedSyntheticTrajectoryEvidenceV1>();
const replayBindings = new WeakMap<object, z.infer<typeof verificationInputSchema>>();

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const identity = (key: Pick<ActionKey, 'candidateNamespace' | 'candidateId'>): string => (
  `${key.candidateNamespace}\u0000${key.candidateId}`
);
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

export function isVerifiedSyntheticTrajectoryStepV1(
  value: unknown,
): value is VerifiedSyntheticTrajectoryStepV1 {
  try {
    return Boolean(value && typeof value === 'object' && recursivelyFrozen(value)
      && verifiedSteps.has(value));
  } catch {
    return false;
  }
}

export function isVerifiedSyntheticTrajectoryStepBoundToEvidenceV1(
  step: unknown,
  evidence: unknown,
): step is VerifiedSyntheticTrajectoryStepV1 {
  return isVerifiedSyntheticTrajectoryStepV1(step)
    && isVerifiedSyntheticTrajectoryEvidenceV1(evidence)
    && activeStepOwners.get(step) === evidence;
}

export function isVerifiedSyntheticTrajectoryEvidenceV1(
  value: unknown,
): value is VerifiedSyntheticTrajectoryEvidenceV1 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    const candidate = value as VerifiedSyntheticTrajectoryEvidenceV1;
    const expected = evidenceDigests.get(value);
    const { trajectoryEvidenceSha256: _ignored, ...preimage } = candidate;
    return verifiedEvidence.has(value)
      && expected !== undefined
      && candidate.trajectoryEvidenceSha256 === expected
      && digest(preimage) === expected;
  } catch {
    return false;
  }
}

export async function verifySyntheticTrajectoryEvidenceV1(
  raw: unknown,
): Promise<VerifySyntheticTrajectoryEvidenceResultV1> {
  let parsed: ReturnType<typeof verificationInputSchema.safeParse>;
  try {
    parsed = verificationInputSchema.safeParse(raw);
  } catch {
    return reject('synthetic_trajectory_contract_invalid');
  }
  if (!parsed.success) return reject('synthetic_trajectory_contract_invalid');
  const input = parsed.data;
  const fixture = input.behaviorFixture;
  const source = fixture.input.sourceDecisionLog;
  const simulation = fixture.expected;
  const log = input.syntheticDecisionLog;

  if (!behaviorFixtureMatchesPrivateRoot(fixture)) {
    return reject('behavior_fixture_trust_root_mismatch');
  }
  if (verifyRandomizedSlateSimulationV1(fixture.input, simulation).status !== 'verified') {
    return reject('rust_simulation_evidence_invalid');
  }
  if (!isVerifiedTargetDistributionEvidenceV2(input.targetEvidence)) {
    return reject('target_verified_brand_missing');
  }
  const targetPolicyConfigSha256 = input.targetEvidence.manifest.policyConfigSha256;
  if (
    targetPolicyConfigSha256 !== BEHAVIOR_ROOT.targetPolicyConfigSha256
    || input.targetEvidence.receipt.policyConfigSha256 !== targetPolicyConfigSha256
  ) return reject('target_policy_digest_mismatch');
  if (targetPolicyConfigSha256 === fixture.behaviorPolicyConfigSha256) {
    return reject('behavior_target_policy_digest_collision');
  }
  if (
    input.syntheticDecisionLogSha256 !== digest(log)
    || log.sourceDecisionLogSha256 !== fixture.input.sourceDecisionLogSha256
    || log.sourceCandidatePoolSha256 !== source.candidatePool.candidatePoolSha256
    || log.decisionId !== source.decisionId
    || log.requestId !== source.requestId
    || log.decisionAt !== source.decisionAt
    || log.behaviorPolicyConfigSha256 !== fixture.behaviorPolicyConfigSha256
    || !same(log.behaviorPolicy, fixture.input.config)
    || !same(log.uniformDraws, fixture.input.uniformDraws)
  ) return reject('synthetic_decision_binding_mismatch');

  if (log.actions.length !== simulation.orderedActions.length) {
    return reject('synthetic_trajectory_action_mismatch');
  }
  const selected = new Set<string>();
  for (const [index, action] of log.actions.entries()) {
    const simulated = simulation.orderedActions[index]!;
    if (
      action.selectionRank !== index + 1
      || action.actionKey.servedPosition !== index + 1
      || !same(action.actionKey, simulated.actionKey)
      || action.behaviorPropensity.plackettLuceProbability !== simulated.plackettLuceProbability
      || action.behaviorPropensity.conditionalSelectionProbability
        !== simulated.conditionalSelectionProbability
      || selected.has(identity(action.actionKey))
    ) return reject('synthetic_trajectory_action_mismatch');
    selected.add(identity(action.actionKey));
  }

  if (!isVerifiedSyntheticOutcomeEvidenceV1(input.outcomeEvidence)) {
    return reject('verified_synthetic_outcome_required');
  }
  if (!isVerifiedSyntheticContextV1(input.contextEvidence)) {
    return reject('verified_synthetic_context_required');
  }
  if (!syntheticBindingsMatch(log, input.outcomeEvidence, input.contextEvidence)) {
    return reject('synthetic_evidence_binding_mismatch');
  }
  const replay = await replayTrajectoryInput(input);
  if (replay.status !== 'verified') return reject(replay.blocker);
  const preimage = {
    contractVersion: 'verified_synthetic_trajectory_evidence_v1' as const,
    syntheticDecisionLogSha256: input.syntheticDecisionLogSha256,
    sourceDecisionLogSha256: fixture.input.sourceDecisionLogSha256,
    sourceCandidatePoolSha256: source.candidatePool.candidatePoolSha256,
    behaviorFixtureSha256: BEHAVIOR_ROOT.fixtureSha256,
    behaviorSimulationSha256: simulation.simulationSha256,
    targetManifestSha256: input.targetEvidence.targetManifestSha256,
    targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
    targetDistributionNdjsonSha256: input.targetEvidence.receipt.distributionNdjsonSha256,
    syntheticOutcomeEvidenceSha256: input.outcomeEvidence.syntheticOutcomeEvidenceSha256,
    syntheticContextSha256: input.contextEvidence.syntheticContextSha256,
    behaviorPolicyConfigSha256: fixture.behaviorPolicyConfigSha256,
    targetPolicyConfigSha256,
    evidenceKind: 'simulated_propensity' as const,
    decisionId: log.decisionId,
    expectedStepCount: replay.stepSummaries.length,
    steps: replay.stepSummaries,
    bufferLimitsVersion: SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1.version,
    highWaterDiagnostics: replay.highWaterDiagnostics,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const evidence = recursivelyFreeze({
    ...preimage,
    trajectoryEvidenceSha256: digest(preimage),
  });
  verifiedEvidence.add(evidence);
  evidenceDigests.set(evidence, evidence.trajectoryEvidenceSha256);
  replayBindings.set(evidence, recursivelyFreeze(input));
  return recursivelyFreeze({ status: 'verified' as const, evidence });
}

export type SyntheticTrajectoryReplayVisitorV1 = {
  onStep: (step: VerifiedSyntheticTrajectoryStepV1) => Promise<void> | void;
  commit: () => Promise<void> | void;
  abort: (blocker: string) => Promise<void> | void;
};

export async function replayVerifiedSyntheticTrajectoryEvidenceV1(
  evidence: VerifiedSyntheticTrajectoryEvidenceV1,
  visitor: SyntheticTrajectoryReplayVisitorV1,
): Promise<{ status: 'verified' } | { status: 'not_evaluable'; blocker: string }> {
  if (!isVerifiedSyntheticTrajectoryEvidenceV1(evidence)) {
    return reject('synthetic_trajectory_verified_brand_missing');
  }
  const input = replayBindings.get(evidence);
  if (!input) return reject('synthetic_trajectory_verified_brand_missing');
  const replay = await replayTrajectoryInput(input, evidence, visitor);
  return replay.status === 'verified' ? { status: 'verified' } : reject(replay.blocker);
}

async function replayTrajectoryInput(
  input: z.infer<typeof verificationInputSchema>,
  owner?: VerifiedSyntheticTrajectoryEvidenceV1,
  visitor?: SyntheticTrajectoryReplayVisitorV1,
): Promise<{
  status: 'verified';
  stepSummaries: VerifiedSyntheticTrajectoryStepSummaryV1[];
  highWaterDiagnostics: SyntheticTrajectoryBufferDiagnosticsV1;
} | { status: 'not_evaluable'; blocker: string }> {
  const fixture = input.behaviorFixture;
  const source = fixture.input.sourceDecisionLog;
  const log = input.syntheticDecisionLog;
  const outcomes = new Map(input.outcomeEvidence.outcomes.map((outcome) => [
    canonicalDecisionJson(outcome.actionKey),
    outcome,
  ]));
  if (outcomes.size !== log.actions.length) {
    return { status: 'not_evaluable', blocker: 'synthetic_outcome_action_mismatch' };
  }
  const eligible = source.candidatePool.candidates.filter((candidate) => candidate.eligible);
  const stepSummaries: VerifiedSyntheticTrajectoryStepSummaryV1[] = [];
  const highWaterDiagnostics: SyntheticTrajectoryBufferDiagnosticsV1 = {
    peakBufferedActions: 0,
    peakBufferedRecords: 0,
    peakBufferedBytes: 0,
  };
  let decisionCount = 0;
  let committed = false;
  let comparisonBlocker: string | undefined;
  const failComparison = (blocker: string): never => {
    comparisonBlocker = blocker;
    throw new Error(blocker);
  };
  const targetReplay = await replayVerifiedTargetDistributionV2(input.targetEvidence, {
    onDecisionStart: (decision) => {
      decisionCount += 1;
      if (
        decisionCount !== 1
        || decision.decisionLogSha256 !== fixture.input.sourceDecisionLogSha256
        || decision.candidatePoolSha256 !== source.candidatePool.candidatePoolSha256
        || decisionLogSha256(decision.source) !== fixture.input.sourceDecisionLogSha256
        || !same(decision.source, source)
      ) failComparison('target_decision_binding_mismatch');
    },
    onStep: async (_decision, targetStep) => {
      const index = stepSummaries.length;
      const built = buildVerifiedStep({
        index,
        targetStep,
        log,
        eligible,
        outcomes,
        outcomeEvidence: input.outcomeEvidence,
        contextEvidence: input.contextEvidence,
      });
      if ('blocker' in built) return failComparison(built.blocker);
      const { step } = built;
      const diagnostics = measureBufferedStep(step);
      if (
        diagnostics.peakBufferedActions > SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1.maxBufferedActions
        || diagnostics.peakBufferedRecords > SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1.maxBufferedRecords
        || diagnostics.peakBufferedBytes > SYNTHETIC_TRAJECTORY_BUFFER_LIMITS_V1.maxBufferedBytes
      ) failComparison('synthetic_trajectory_resource_limit_exceeded');
      highWaterDiagnostics.peakBufferedActions = Math.max(
        highWaterDiagnostics.peakBufferedActions,
        diagnostics.peakBufferedActions,
      );
      highWaterDiagnostics.peakBufferedRecords = Math.max(
        highWaterDiagnostics.peakBufferedRecords,
        diagnostics.peakBufferedRecords,
      );
      highWaterDiagnostics.peakBufferedBytes = Math.max(
        highWaterDiagnostics.peakBufferedBytes,
        diagnostics.peakBufferedBytes,
      );
      stepSummaries.push({
        decisionId: step.decisionId,
        servedPosition: step.servedPosition,
        behaviorProbability: step.behaviorProbability,
      });
      if (owner && visitor) {
        recursivelyFreeze(step);
        verifiedSteps.add(step);
        activeStepOwners.set(step, owner);
        try {
          await visitor.onStep(step);
        } finally {
          activeStepOwners.delete(step);
          verifiedSteps.delete(step);
        }
      }
    },
    onDecisionEnd: () => {
      if (stepSummaries.length !== log.actions.length) {
        failComparison('target_step_count_mismatch');
      }
    },
    commit: async () => {
      if (visitor) await visitor.commit();
      committed = true;
    },
    abort: async (blocker) => {
      stepSummaries.splice(0);
      if (visitor) await visitor.abort(blocker);
    },
  });
  if (targetReplay.status !== 'verified') {
    if (comparisonBlocker) return { status: 'not_evaluable', blocker: comparisonBlocker };
    return {
      status: 'not_evaluable',
      blocker: targetReplay.blocker === 'target_step_binding_mismatch'
        ? 'target_prefix_binding_mismatch'
        : targetReplay.blocker,
    };
  }
  if (!committed || decisionCount !== 1 || stepSummaries.length !== log.actions.length) {
    return { status: 'not_evaluable', blocker: 'target_replay_incomplete' };
  }
  return { status: 'verified', stepSummaries, highWaterDiagnostics };
}

function measureBufferedStep(step: VerifiedSyntheticTrajectoryStepV1): SyntheticTrajectoryBufferDiagnosticsV1 {
  return {
    peakBufferedActions: step.behaviorSupportActions.length + step.targetDistribution.length,
    peakBufferedRecords: step.targetDistribution.length + 1,
    peakBufferedBytes: Buffer.byteLength(canonicalDecisionJson(step)),
  };
}

function behaviorFixtureMatchesPrivateRoot(fixture: Phase11SyntheticBehaviorFixtureV1): boolean {
  return digest(fixture) === BEHAVIOR_ROOT.fixtureSha256
    && digest(fixture.input) === BEHAVIOR_ROOT.inputSha256
    && digest(fixture.expected) === BEHAVIOR_ROOT.simulationObjectSha256
    && digest(fixture.input.sourceDecisionLog) === BEHAVIOR_ROOT.sourceDecisionLogSha256
    && digest(fixture.input.config) === BEHAVIOR_ROOT.behaviorPolicyConfigSha256
    && fixture.input.sourceDecisionLogSha256 === BEHAVIOR_ROOT.sourceDecisionLogSha256
    && fixture.input.sourceDecisionLog.candidatePool.candidatePoolSha256
      === BEHAVIOR_ROOT.sourceCandidatePoolSha256
    && fixture.expected.simulationSha256 === BEHAVIOR_ROOT.simulationSelfSha256
    && fixture.behaviorPolicyConfigSha256 === BEHAVIOR_ROOT.behaviorPolicyConfigSha256
    && fixture.targetPolicyConfigSha256 === BEHAVIOR_ROOT.targetPolicyConfigSha256;
}

function syntheticBindingsMatch(
  log: SyntheticDecisionLogV1,
  outcome: VerifiedSyntheticOutcomeEvidenceV1,
  context: VerifiedSyntheticContextV1,
): boolean {
  return outcome.decisionId === log.decisionId
    && outcome.requestId === log.requestId
    && outcome.syntheticDecisionLogSha256 === context.syntheticDecisionLogSha256
    && outcome.syntheticDecisionLogSha256 === digest(log)
    && context.decisionId === log.decisionId
    && context.requestId === log.requestId
    && context.decisionAt === log.decisionAt
    && outcome.datasetVersion === context.datasetVersion;
}

function buildVerifiedStep(input: {
  index: number;
  targetStep: VerifiedTargetDistributionStepV2;
  log: SyntheticDecisionLogV1;
  eligible: Phase11SyntheticBehaviorFixtureV1['input']['sourceDecisionLog']['candidatePool']['candidates'];
  outcomes: Map<string, VerifiedSyntheticOutcomeEvidenceV1['outcomes'][number]>;
  outcomeEvidence: VerifiedSyntheticOutcomeEvidenceV1;
  contextEvidence: VerifiedSyntheticContextV1;
}): { step: VerifiedSyntheticTrajectoryStepV1 } | { blocker: string } {
  const { index, targetStep, log } = input;
  const logged = log.actions[index];
  if (!logged) return { blocker: 'target_step_count_mismatch' };
  const expectedPrefix = log.actions.slice(0, index).map((action) => action.actionKey);
  const prefix = new Set(expectedPrefix.map(identity));
  const remaining = input.eligible.filter((candidate) => !prefix.has(identity(candidate)));
  const targetIds = targetStep.actions.map((entry) => identity(entry.actionKey));
  const expectedIds = remaining.map(identity);
  const probabilityMass = targetStep.actions.reduce((sum, entry) => (
    sum + entry.conditionalSelectionProbability
  ), 0);
  const observedTarget = targetStep.actions.find((entry) => same(entry.actionKey, logged.actionKey));
  if (
    targetStep.servedPosition !== index + 1
    || !same(targetStep.prefixActionKeys, expectedPrefix)
    || targetStep.actions.some((entry) => entry.actionKey.servedPosition !== index + 1)
    || new Set(targetIds).size !== targetIds.length
    || !same([...targetIds].sort(compareText), [...expectedIds].sort(compareText))
    || !Number.isFinite(probabilityMass)
    || Math.abs(probabilityMass - 1) > 1e-8
    || !observedTarget
    || observedTarget.conditionalSelectionProbability <= 0
  ) return { blocker: 'target_prefix_binding_mismatch' };
  const outcome = input.outcomes.get(canonicalDecisionJson(logged.actionKey));
  if (!outcome) return { blocker: 'synthetic_outcome_action_mismatch' };
  return {
    step: {
      decisionId: log.decisionId,
      servedPosition: index + 1,
      prefixActionKeys: expectedPrefix,
      loggedActionKey: logged.actionKey,
      behaviorProbability: logged.behaviorPropensity.conditionalSelectionProbability,
      behaviorSupportActions: remaining.map((candidate) => ({
        candidateNamespace: candidate.candidateNamespace,
        candidateId: candidate.candidateId,
        servedPosition: index + 1,
      })),
      targetDistribution: targetStep.actions.map((entry) => ({
        actionKey: entry.actionKey,
        probability: entry.conditionalSelectionProbability,
      })),
      reward: outcome.reward,
      binding: {
        inferenceClusterId: input.contextEvidence.inferenceClusterId,
        segmentAssignments: input.contextEvidence.segmentAssignments,
        objective: input.outcomeEvidence.objective,
        syntheticOutcomeEvidenceSha256:
          input.outcomeEvidence.syntheticOutcomeEvidenceSha256,
        syntheticContextSha256: input.contextEvidence.syntheticContextSha256,
      },
    },
  };
}

function reject(blocker: string): VerifySyntheticTrajectoryEvidenceResultV1 {
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
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}
