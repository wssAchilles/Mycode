import { createHash } from 'crypto';

import {
  VIEWER_CLUSTER_UNIT_VERSION,
  type VerifiedDecisionContextDecisionV1,
} from '../../decisionContext/contracts';
import {
  isVerifiedDecisionContextEvidenceV1,
} from '../../decisionContext/verify';
import {
  canonicalDecisionJson,
  decisionLogSha256,
} from '../../decisionLog/contracts';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
} from '../../outcomes/syntheticOutcomeEvidenceV1';
import {
  cohortPredictionSetOpeSourceBindingV3,
  isVerifiedCrossFittedCohortPredictionSetV3,
} from '../predictionV3/artifacts';
import {
  closeVerifiedCohortPredictionCursorV3,
  isVerifiedCohortPredictionStepV3,
  openVerifiedCohortPredictionCursorV3,
  readVerifiedCohortPredictionStepV3,
} from '../predictionV3/cursor';
import type {
  VerifiedCohortPredictionCursorV3,
  VerifiedCrossFittedCohortPredictionSetV3,
} from '../predictionV3/contracts';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
  type VerifiedTargetDistributionDecisionV2,
  type VerifiedTargetDistributionStepV2,
} from '../targetEvidence';
import type { SyntheticDecisionLogV1 } from '../streamingV2/contracts';
import {
  SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1,
  type SyntheticCohortTrajectoryReplayBindingV1,
  type SyntheticCohortTrajectoryReplayVisitorV1,
  type SyntheticCohortTrajectoryResourceDiagnosticsV1,
  type SyntheticCohortTrajectoryStepSummaryV1,
  type VerifiedSyntheticCohortTrajectoryEvidenceV1,
  type VerifiedSyntheticCohortTrajectoryStepV1,
  type VerifySyntheticCohortTrajectoryEvidenceResultV1,
} from './contracts';

type SourceBinding = NonNullable<ReturnType<typeof cohortPredictionSetOpeSourceBindingV3>>;
type NormalizedDecision = SourceBinding['decisions'][number];
type ReplayPlan = Readonly<{
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3;
  source: SourceBinding;
  decisions: ReadonlyMap<string, NormalizedDecision>;
  contexts: ReadonlyMap<string, VerifiedDecisionContextDecisionV1>;
  folds: ReadonlyMap<string, Readonly<{ inferenceClusterId: string; foldId: 0 | 1 }>>;
}>;
type ReplayResult = Readonly<{
  status: 'verified';
  steps: readonly SyntheticCohortTrajectoryStepSummaryV1[];
  diagnostics: SyntheticCohortTrajectoryResourceDiagnosticsV1;
}> | Readonly<{ status: 'not_evaluable'; blocker: string }>;

const verifiedEvidence = new WeakSet<object>();
const evidenceDigests = new WeakMap<object, string>();
const replayBindings = new WeakMap<object, SyntheticCohortTrajectoryReplayBindingV1>();
const activeSteps = new WeakSet<object>();
const activeStepOwners = new WeakMap<object, VerifiedSyntheticCohortTrajectoryEvidenceV1>();

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);
const actionIdentity = (value: { candidateNamespace: string; candidateId: string }): string => (
  `${value.candidateNamespace}\u0000${value.candidateId}`
);
const actionKeyIdentity = (
  value: SyntheticDecisionLogV1['actions'][number]['actionKey'],
): string => canonicalDecisionJson(value);

export async function verifySyntheticCohortTrajectoryEvidenceV1(
  raw: unknown,
): Promise<VerifySyntheticCohortTrajectoryEvidenceResultV1> {
  if (!isVerifiedCrossFittedCohortPredictionSetV3(raw)) {
    return reject('synthetic_cohort_trajectory_source_unverified');
  }
  const plan = preflight(raw);
  if ('blocker' in plan) return reject(plan.blocker);
  const replay = await replayJoinedCohort(plan.plan);
  if (replay.status !== 'verified') return reject(replay.blocker);

  const predictionSet = plan.plan.predictionSet;
  const source = plan.plan.source;
  const preimage = {
    contractVersion: 'verified_synthetic_cohort_trajectory_evidence_v1' as const,
    predictionSetVersion: predictionSet.manifest.predictionSetVersion,
    predictionVerificationReceiptSha256: predictionSet.receipt.receiptSha256,
    modelBundleSha256: predictionSet.receipt.modelBundleSha256,
    predictionStreamSha256: predictionSet.receipt.predictionStreamSha256,
    snapshotManifestSha256: predictionSet.receipt.snapshotManifestSha256,
    targetManifestSha256: predictionSet.receipt.targetManifestSha256,
    targetVerificationReceiptSha256:
      predictionSet.receipt.targetVerificationReceiptSha256,
    targetDistributionNdjsonSha256:
      source.targetEvidence.receipt.distributionNdjsonSha256,
    decisionContextEvidenceSha256:
      source.decisionContextEvidence.decisionContextEvidenceSha256,
    syntheticDecisionLogRootSha256: source.syntheticDecisionLogRootSha256,
    syntheticOutcomeEvidenceRootSha256: source.syntheticOutcomeEvidenceRootSha256,
    holdoutPlanSha256: source.holdoutPlan.holdoutPlanSha256,
    rewardDefinitionSha256: predictionSet.receipt.rewardDefinitionSha256,
    expectedDecisionCount: predictionSet.manifest.decisionCount,
    expectedViewerClusterCount: predictionSet.manifest.viewerClusterCount,
    expectedStepCount: predictionSet.manifest.stepCount,
    expectedPredictionCount: predictionSet.manifest.predictionCount,
    steps: replay.steps,
    resourceLimitsVersion: SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.version,
    resourceDiagnostics: replay.diagnostics,
    sourceClusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
    viewerClusterCrossFitProvenancePresent: true as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    candidateEvidenceEligible: false as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const evidence = recursivelyFreeze({
    ...preimage,
    trajectoryEvidenceSha256: digest(preimage),
  });
  verifiedEvidence.add(evidence);
  evidenceDigests.set(evidence, evidence.trajectoryEvidenceSha256);
  replayBindings.set(evidence, Object.freeze({ predictionSet }));
  return recursivelyFreeze({ status: 'verified' as const, evidence });
}

export function isVerifiedSyntheticCohortTrajectoryEvidenceV1(
  value: unknown,
): value is VerifiedSyntheticCohortTrajectoryEvidenceV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedEvidence.has(value)) return false;
    const candidate = value as VerifiedSyntheticCohortTrajectoryEvidenceV1;
    const binding = replayBindings.get(value);
    const { trajectoryEvidenceSha256: _ignored, ...preimage } = candidate;
    return binding !== undefined
      && isVerifiedCrossFittedCohortPredictionSetV3(binding.predictionSet)
      && recursivelyFrozen(candidate)
      && candidate.trajectoryEvidenceSha256 === digest(preimage)
      && evidenceDigests.get(value) === candidate.trajectoryEvidenceSha256;
  } catch {
    return false;
  }
}

export function isVerifiedSyntheticCohortTrajectoryStepV1(
  value: unknown,
): value is VerifiedSyntheticCohortTrajectoryStepV1 {
  try {
    return Boolean(value && typeof value === 'object'
      && activeSteps.has(value)
      && recursivelyFrozen(value));
  } catch {
    return false;
  }
}

export function isVerifiedSyntheticCohortTrajectoryStepBoundToEvidenceV1(
  step: unknown,
  evidence: unknown,
): step is VerifiedSyntheticCohortTrajectoryStepV1 {
  return isVerifiedSyntheticCohortTrajectoryStepV1(step)
    && isVerifiedSyntheticCohortTrajectoryEvidenceV1(evidence)
    && activeStepOwners.get(step) === evidence;
}

export async function replayVerifiedSyntheticCohortTrajectoryEvidenceV1(
  evidence: VerifiedSyntheticCohortTrajectoryEvidenceV1,
  visitor: SyntheticCohortTrajectoryReplayVisitorV1,
): Promise<Readonly<{ status: 'verified' }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>> {
  if (!isVerifiedSyntheticCohortTrajectoryEvidenceV1(evidence)) {
    return reject('synthetic_cohort_trajectory_verified_brand_missing');
  }
  const binding = replayBindings.get(evidence);
  if (!binding) return reject('synthetic_cohort_trajectory_verified_brand_missing');
  const plan = preflight(binding.predictionSet, evidence);
  if ('blocker' in plan) return reject(plan.blocker);
  const replay = await replayJoinedCohort(plan.plan, evidence, visitor);
  return replay.status === 'verified'
    ? Object.freeze({ status: 'verified' as const })
    : reject(replay.blocker);
}

function preflight(
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3,
  expected?: VerifiedSyntheticCohortTrajectoryEvidenceV1,
): Readonly<{ plan: ReplayPlan }> | Readonly<{ blocker: string }> {
  try {
    const source = cohortPredictionSetOpeSourceBindingV3(predictionSet);
    if (!source
      || !isVerifiedTargetDistributionEvidenceV2(source.targetEvidence)
      || !isVerifiedDecisionContextEvidenceV1(source.decisionContextEvidence)
      || !source.decisions.every((entry) => (
        isVerifiedSyntheticOutcomeEvidenceV1(entry.outcomeEvidence)
      ))) return { blocker: 'synthetic_cohort_trajectory_source_unverified' };

    const manifest = predictionSet.manifest;
    const receipt = predictionSet.receipt;
    const limits = SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1;
    if (
      manifest.decisionCount > limits.maximumDecisions
      || manifest.viewerClusterCount > limits.maximumViewerClusters
      || manifest.stepCount > limits.maximumSlots
      || manifest.predictionCount > limits.maximumSupportActionRows
      || manifest.physicalRecordCount > limits.maximumPredictionRecords
      || receipt.combinedSpoolByteCount > limits.maximumUpstreamCombinedSpoolBytes
    ) return { blocker: 'resource_limit_exceeded' };

    const decisions = new Map<string, NormalizedDecision>();
    let previousDecisionId: string | undefined;
    for (const entry of source.decisions) {
      const decisionId = entry.syntheticDecisionLog.decisionId;
      if (
        decisions.has(decisionId)
        || (previousDecisionId !== undefined && compareText(previousDecisionId, decisionId) >= 0)
        || digest(entry.syntheticDecisionLog) !== entry.syntheticDecisionLogSha256
      ) return { blocker: 'synthetic_cohort_trajectory_source_membership_mismatch' };
      previousDecisionId = decisionId;
      decisions.set(decisionId, entry);
    }
    const contexts = new Map(source.decisionContextEvidence.decisions.map((entry) => [
      entry.decisionId,
      entry,
    ]));
    const folds = new Map<string, Readonly<{ inferenceClusterId: string; foldId: 0 | 1 }>>();
    for (const assignment of source.holdoutPlan.assignments) {
      for (const decisionId of assignment.decisionIds) {
        if (folds.has(decisionId)) {
          return { blocker: 'synthetic_cohort_trajectory_fold_mismatch' };
        }
        folds.set(decisionId, {
          inferenceClusterId: assignment.inferenceClusterId,
          foldId: assignment.foldId,
        });
      }
    }

    const decisionRoot = digest({
      contractVersion: 'synthetic_decision_log_cohort_root_v1',
      members: source.decisions.map((entry) => ({
        decisionId: entry.syntheticDecisionLog.decisionId,
        syntheticDecisionLogSha256: entry.syntheticDecisionLogSha256,
      })),
    });
    const outcomeRoot = digest({
      contractVersion: 'synthetic_outcome_evidence_cohort_root_v1',
      members: source.decisions.map((entry) => ({
        decisionId: entry.syntheticDecisionLog.decisionId,
        syntheticOutcomeEvidenceSha256:
          entry.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      })),
    });
    if (
      decisions.size !== manifest.decisionCount
      || contexts.size !== manifest.decisionCount
      || folds.size !== manifest.decisionCount
      || source.holdoutPlan.viewerClusterCount !== manifest.viewerClusterCount
      || source.targetEvidence.manifest.decisionCount !== manifest.decisionCount
      || source.targetEvidence.manifest.stepCount !== manifest.stepCount
      || source.targetEvidence.manifest.actionProbabilityCount !== manifest.predictionCount
      || source.targetEvidence.targetManifestSha256 !== manifest.targetManifestSha256
      || source.targetEvidence.receipt.verificationReceiptSha256
        !== manifest.targetVerificationReceiptSha256
      || source.decisionContextEvidence.decisionContextEvidenceSha256
        !== manifest.decisionContextEvidenceSha256
      || source.holdoutPlan.holdoutPlanSha256 !== manifest.holdoutPlanSha256
      || decisionRoot !== source.syntheticDecisionLogRootSha256
      || outcomeRoot !== source.syntheticOutcomeEvidenceRootSha256
      || decisionRoot !== manifest.syntheticDecisionLogRootSha256
      || outcomeRoot !== manifest.syntheticOutcomeEvidenceRootSha256
      || receipt.predictionSetVersion !== manifest.predictionSetVersion
      || receipt.targetManifestSha256 !== manifest.targetManifestSha256
      || receipt.targetVerificationReceiptSha256
        !== manifest.targetVerificationReceiptSha256
      || receipt.decisionContextEvidenceSha256 !== manifest.decisionContextEvidenceSha256
      || receipt.syntheticDecisionLogRootSha256 !== decisionRoot
      || receipt.syntheticOutcomeEvidenceRootSha256 !== outcomeRoot
      || receipt.holdoutPlanSha256 !== manifest.holdoutPlanSha256
    ) return { blocker: 'synthetic_cohort_trajectory_root_mismatch' };

    if (expected && (
      expected.predictionSetVersion !== manifest.predictionSetVersion
      || expected.predictionVerificationReceiptSha256 !== receipt.receiptSha256
      || expected.targetManifestSha256 !== manifest.targetManifestSha256
      || expected.targetVerificationReceiptSha256
        !== manifest.targetVerificationReceiptSha256
      || expected.decisionContextEvidenceSha256 !== manifest.decisionContextEvidenceSha256
      || expected.syntheticDecisionLogRootSha256 !== decisionRoot
      || expected.syntheticOutcomeEvidenceRootSha256 !== outcomeRoot
      || expected.holdoutPlanSha256 !== manifest.holdoutPlanSha256
    )) return { blocker: 'synthetic_cohort_trajectory_evidence_binding_mismatch' };

    return {
      plan: { predictionSet, source, decisions, contexts, folds },
    };
  } catch {
    return { blocker: 'synthetic_cohort_trajectory_source_unverified' };
  }
}

async function replayJoinedCohort(
  plan: ReplayPlan,
  owner?: VerifiedSyntheticCohortTrajectoryEvidenceV1,
  visitor?: SyntheticCohortTrajectoryReplayVisitorV1,
): Promise<ReplayResult> {
  const opened = await openVerifiedCohortPredictionCursorV3(plan.predictionSet);
  if (opened.status !== 'opened') return reject(opened.blocker);
  const { cursor } = opened;
  const summaries: SyntheticCohortTrajectoryStepSummaryV1[] = [];
  const viewerClusters = new Set<string>();
  let currentDecisionId: string | undefined;
  let currentStepCount = 0;
  let previousDecisionId: string | undefined;
  let localBlocker: string | undefined;
  let supportActionRowCount = 0;
  let peakBufferedActions = 0;
  let peakBufferedRecords = 0;
  let peakBufferedBytes = 0;
  const fail = (blocker: string): never => {
    localBlocker = blocker;
    throw new Error(blocker);
  };

  try {
    const replay = await replayVerifiedTargetDistributionV2(plan.source.targetEvidence, {
      onDecisionStart: (targetDecision) => {
        const decisionId = targetDecision.source.decisionId;
        const source = plan.decisions.get(decisionId);
        const context = plan.contexts.get(decisionId);
        const fold = plan.folds.get(decisionId);
        if (!source || !context || !fold) {
          localBlocker = 'synthetic_cohort_trajectory_decision_mismatch';
          throw new Error(localBlocker);
        }
        if (
          currentDecisionId !== undefined
          || (previousDecisionId !== undefined && compareText(previousDecisionId, decisionId) >= 0)
          || !decisionBindingsMatch(targetDecision, source, context, fold)
        ) fail('synthetic_cohort_trajectory_decision_mismatch');
        currentDecisionId = decisionId;
        currentStepCount = 0;
        viewerClusters.add(context.inferenceClusterId);
      },
      onStep: async (targetDecision, targetStep) => {
        if (currentDecisionId !== targetDecision.source.decisionId) {
          fail('synthetic_cohort_trajectory_order_mismatch');
        }
        const built = await buildJoinedStep(plan, targetDecision, targetStep, cursor);
        if (!('step' in built)) {
          localBlocker = built.blocker;
          throw new Error(localBlocker);
        }
        const step = built.step;
        const bufferedActions = step.behaviorSupportActions.length
          + step.targetDistribution.length
          + step.qHat.length;
        const bufferedRecords = 1 + step.targetDistribution.length + step.qHat.length;
        const bufferedBytes = Buffer.byteLength(canonicalDecisionJson(step));
        supportActionRowCount += step.qHat.length;
        peakBufferedActions = Math.max(peakBufferedActions, bufferedActions);
        peakBufferedRecords = Math.max(peakBufferedRecords, bufferedRecords);
        peakBufferedBytes = Math.max(peakBufferedBytes, bufferedBytes);
        const limits = SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1;
        const joinWorkUnits = 3 * supportActionRowCount + 2 * (summaries.length + 1)
          + plan.decisions.size;
        if (
          supportActionRowCount > limits.maximumSupportActionRows
          || bufferedBytes > limits.maximumBufferedStepBytes
          || joinWorkUnits > limits.maximumJoinWorkUnits
        ) fail('resource_limit_exceeded');

        const summary = Object.freeze({
          decisionId: step.decisionId,
          requestId: step.requestId,
          inferenceClusterId: step.binding.inferenceClusterId,
          foldId: step.binding.foldId,
          servedPosition: step.servedPosition,
          joinedStepSha256: digest(step),
        });
        const expected = owner?.steps[summaries.length];
        if (expected && !same(expected, summary)) {
          fail('synthetic_cohort_trajectory_evidence_binding_mismatch');
        }
        summaries.push(summary);
        currentStepCount += 1;

        if (owner && visitor) {
          recursivelyFreeze(step);
          activeSteps.add(step);
          activeStepOwners.set(step, owner);
          try {
            await visitor.onStep(step);
          } catch {
            fail('synthetic_cohort_trajectory_callback_failed');
          } finally {
            activeStepOwners.delete(step);
            activeSteps.delete(step);
          }
        }
      },
      onDecisionEnd: (targetDecision) => {
        const source = plan.decisions.get(targetDecision.source.decisionId);
        if (
          currentDecisionId !== targetDecision.source.decisionId
          || !source
          || currentStepCount !== source.syntheticDecisionLog.actions.length
        ) fail('synthetic_cohort_trajectory_order_mismatch');
        previousDecisionId = currentDecisionId;
        currentDecisionId = undefined;
        currentStepCount = 0;
      },
      commit: async () => {
        if (visitor) await visitor.commit();
      },
      abort: async (blocker) => {
        summaries.splice(0);
        if (visitor) await visitor.abort(localBlocker ?? blocker);
      },
    });
    if (replay.status !== 'verified') return reject(localBlocker ?? replay.blocker);
    const manifest = plan.predictionSet.manifest;
    if (
      currentDecisionId !== undefined
      || summaries.length !== manifest.stepCount
      || supportActionRowCount !== manifest.predictionCount
      || viewerClusters.size !== manifest.viewerClusterCount
      || (owner !== undefined && owner.steps.length !== summaries.length)
    ) return reject('synthetic_cohort_trajectory_replay_incomplete');
    const diagnostics = recursivelyFreeze({
      preflightCompletedBeforeCursor: true as const,
      decisionCount: plan.decisions.size,
      viewerClusterCount: viewerClusters.size,
      slotCount: summaries.length,
      supportActionRowCount,
      predictionPhysicalRecordCount: manifest.physicalRecordCount,
      upstreamCombinedSpoolByteCount: plan.predictionSet.receipt.combinedSpoolByteCount,
      joinWorkUnits: 3 * supportActionRowCount + 2 * summaries.length + plan.decisions.size,
      peakBufferedActions,
      peakBufferedRecords,
      peakBufferedBytes,
    });
    if (owner && !same(owner.resourceDiagnostics, diagnostics)) {
      return reject('synthetic_cohort_trajectory_evidence_binding_mismatch');
    }
    return { status: 'verified', steps: recursivelyFreeze(summaries), diagnostics };
  } catch {
    return reject(localBlocker ?? 'synthetic_cohort_trajectory_replay_failed');
  } finally {
    await closeVerifiedCohortPredictionCursorV3(cursor);
  }
}

function decisionBindingsMatch(
  target: VerifiedTargetDistributionDecisionV2,
  source: NormalizedDecision,
  context: VerifiedDecisionContextDecisionV1,
  fold: Readonly<{ inferenceClusterId: string; foldId: 0 | 1 }>,
): boolean {
  const log = source.syntheticDecisionLog;
  const outcome = source.outcomeEvidence;
  return context.subject.kind === 'viewer'
    && context.clusterUnitVersion === VIEWER_CLUSTER_UNIT_VERSION
    && target.source.decisionId === log.decisionId
    && target.source.requestId === log.requestId
    && target.source.decisionAt === log.decisionAt
    && target.decisionLogSha256 === log.sourceDecisionLogSha256
    && target.candidatePoolSha256 === log.sourceCandidatePoolSha256
    && decisionLogSha256(target.source) === target.decisionLogSha256
    && same(target.source, context.decisionLog)
    && context.requestId === log.requestId
    && context.inferenceClusterId === fold.inferenceClusterId
    && outcome.decisionId === log.decisionId
    && outcome.requestId === log.requestId
    && outcome.traceUserId === context.subject.viewerAccountPseudonym
    && outcome.syntheticDecisionLogSha256 === source.syntheticDecisionLogSha256;
}

async function buildJoinedStep(
  plan: ReplayPlan,
  targetDecision: VerifiedTargetDistributionDecisionV2,
  targetStep: VerifiedTargetDistributionStepV2,
  cursor: VerifiedCohortPredictionCursorV3,
): Promise<Readonly<{ step: VerifiedSyntheticCohortTrajectoryStepV1 }>
  | Readonly<{ blocker: string }>> {
  const decisionId = targetDecision.source.decisionId;
  const source = plan.decisions.get(decisionId);
  const context = plan.contexts.get(decisionId);
  const fold = plan.folds.get(decisionId);
  if (!source || !context || !fold || context.subject.kind !== 'viewer') {
    return { blocker: 'synthetic_cohort_trajectory_decision_mismatch' };
  }
  const log = source.syntheticDecisionLog;
  const index = targetStep.servedPosition - 1;
  const logged = log.actions[index];
  if (!logged || targetStep.servedPosition !== index + 1) {
    return { blocker: 'synthetic_cohort_trajectory_order_mismatch' };
  }
  const expectedPrefix = log.actions.slice(0, index).map((entry) => entry.actionKey);
  const selected = new Set(expectedPrefix.map(actionIdentity));
  const eligible = targetDecision.source.candidatePool.candidates
    .filter((candidate) => candidate.eligible);
  const remaining = eligible.filter((candidate) => !selected.has(actionIdentity(candidate)));
  const behaviorSupportActions = remaining.map((candidate) => ({
    candidateNamespace: candidate.candidateNamespace,
    candidateId: candidate.candidateId,
    servedPosition: targetStep.servedPosition,
  }));
  const behaviorIds = behaviorSupportActions.map(actionKeyIdentity);
  const targetIds = targetStep.actions.map((entry) => actionKeyIdentity(entry.actionKey));
  const targetMass = targetStep.actions.reduce((sum, entry) => (
    sum + entry.conditionalSelectionProbability
  ), 0);
  if (
    !same(targetStep.prefixActionKeys, expectedPrefix)
    || logged.actionKey.servedPosition !== targetStep.servedPosition
    || logged.selectionRank !== targetStep.servedPosition
    || new Set(behaviorIds).size !== behaviorIds.length
    || new Set(targetIds).size !== targetIds.length
    || !same([...behaviorIds].sort(compareText), [...targetIds].sort(compareText))
    || !targetIds.includes(actionKeyIdentity(logged.actionKey))
    || !Number.isFinite(targetMass)
    || Math.abs(targetMass - 1) > 1e-8
  ) return { blocker: 'synthetic_cohort_trajectory_support_mismatch' };

  const prediction = await readVerifiedCohortPredictionStepV3(cursor, {
    decisionId,
    servedPosition: targetStep.servedPosition,
  });
  if (prediction.status !== 'verified' || !isVerifiedCohortPredictionStepV3(prediction.step)) {
    return {
      blocker: prediction.status === 'not_evaluable'
        ? prediction.blocker
        : 'synthetic_cohort_trajectory_prediction_mismatch',
    };
  }
  const predictionStep = prediction.step;
  const qHatIds = predictionStep.qHat.map((entry) => actionKeyIdentity(entry.actionKey));
  if (
    predictionStep.predictionSetVersion !== plan.predictionSet.manifest.predictionSetVersion
    || predictionStep.verificationReceiptSha256 !== plan.predictionSet.receipt.receiptSha256
    || predictionStep.decisionId !== decisionId
    || predictionStep.requestId !== log.requestId
    || predictionStep.servedPosition !== targetStep.servedPosition
    || predictionStep.inferenceClusterId !== context.inferenceClusterId
    || predictionStep.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
    || predictionStep.foldId !== fold.foldId
    || new Set(qHatIds).size !== qHatIds.length
    || !same([...qHatIds].sort(compareText), [...targetIds].sort(compareText))
  ) return { blocker: 'synthetic_cohort_trajectory_prediction_mismatch' };

  const outcomes = new Map(source.outcomeEvidence.outcomes.map((entry) => [
    actionKeyIdentity(entry.actionKey),
    entry,
  ]));
  const outcome = outcomes.get(actionKeyIdentity(logged.actionKey));
  if (
    outcomes.size !== source.outcomeEvidence.outcomes.length
    || outcomes.size !== log.actions.length
    || !outcome
    || !Number.isFinite(outcome.reward)
  ) return { blocker: 'synthetic_cohort_trajectory_outcome_mismatch' };

  const segmentAssignments = Object.entries(context.segments)
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => compareText(left.key, right.key)
      || compareText(left.value, right.value));
  const step = {
    contractVersion: 'verified_synthetic_cohort_trajectory_step_v1' as const,
    predictionSetVersion: predictionStep.predictionSetVersion,
    predictionVerificationReceiptSha256: predictionStep.verificationReceiptSha256,
    decisionId,
    requestId: log.requestId,
    servedPosition: targetStep.servedPosition,
    prefixActionKeys: expectedPrefix,
    loggedActionKey: logged.actionKey,
    behaviorProbability: logged.behaviorPropensity.conditionalSelectionProbability,
    behaviorSupportActions,
    targetDistribution: targetStep.actions.map((entry) => ({
      actionKey: entry.actionKey,
      probability: entry.conditionalSelectionProbability,
    })),
    reward: outcome.reward,
    qHat: predictionStep.qHat,
    binding: {
      datasetVersion: plan.source.targetEvidence.manifest.datasetVersion,
      inferenceClusterId: context.inferenceClusterId,
      clusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
      viewerAccountPseudonym: context.subject.viewerAccountPseudonym,
      foldId: predictionStep.foldId,
      segmentAssignments,
      objective: source.outcomeEvidence.objective,
      sourceDecisionLogSha256: log.sourceDecisionLogSha256,
      sourceCandidatePoolSha256: log.sourceCandidatePoolSha256,
      syntheticDecisionLogSha256: source.syntheticDecisionLogSha256,
      syntheticOutcomeEvidenceSha256:
        source.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      decisionContextEvidenceSha256:
        plan.source.decisionContextEvidence.decisionContextEvidenceSha256,
      snapshotManifestSha256: plan.predictionSet.manifest.snapshotManifestSha256,
      targetManifestSha256: plan.predictionSet.manifest.targetManifestSha256,
      targetVerificationReceiptSha256:
        plan.predictionSet.manifest.targetVerificationReceiptSha256,
      holdoutPlanSha256: plan.source.holdoutPlan.holdoutPlanSha256,
    },
  } satisfies VerifiedSyntheticCohortTrajectoryStepV1;
  return { step };
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
