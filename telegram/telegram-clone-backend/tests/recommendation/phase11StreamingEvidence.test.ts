import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import { canonicalDecisionJson } from '../../src/services/recommendation/decisionLog/contracts';
import {
  isVerifiedSyntheticContextV1,
  verifySyntheticContextV1,
} from '../../src/services/recommendation/decisionContext/syntheticContextV1';
import { canonicalWireJsonV1 } from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import {
  evaluatePhase11ModelStateBudgetV1,
  phase11ModelStateResourceConfigV1,
} from '../../src/services/recommendation/offlinePrediction/contracts/artifacts';
import {
  describePhase11AtomicPublishResultV1,
  isVerifiedSyntheticTrajectoryEvidenceV1,
  replayVerifiedSyntheticTrajectoryEvidenceV1,
  verifySyntheticTrajectoryEvidenceV1,
} from '../../src/services/recommendation/offlinePrediction/streamingV2';
import {
  verifyTargetDistributionStreamV2,
  type VerifiedTargetDistributionEvidenceV2,
} from '../../src/services/recommendation/offlinePrediction/targetEvidence';
import {
  consumeOpeStepContributionV3,
  createOpeAggregateStateV3,
  finalizeOpeAggregateReceiptV3,
  isOpeSlotContributionBoundToReceiptV3,
  isVerifiedOpeAggregateReceiptV3,
  replayOpeTrajectoryV3,
  scaleLogValueV3,
} from '../../src/services/recommendation/ope/v3';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
  syntheticOutcomeEventSha256V1,
  verifySyntheticOutcomeEvidenceV1,
} from '../../src/services/recommendation/outcomes/syntheticOutcomeEvidenceV1';

const fixtureDirectory = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures',
);
const behaviorFixturePath = path.join(
  fixtureDirectory,
  'phase11_synthetic_behavior_trajectory_v1.json',
);
const targetFixturePath = path.join(fixtureDirectory, 'target_policy_distribution_stream_v1.json');
const targetReceiptPath = path.join(fixtureDirectory, 'target_distribution_stream_receipt_v2.json');

const sha256 = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const stream = (read: () => string) => async function* () { yield Buffer.from(read()); };

type FixtureOptions = { contextSegments?: Record<string, string> };

async function fixture(options: FixtureOptions = {}) {
  const behaviorFixture = JSON.parse(readFileSync(behaviorFixturePath, 'utf8'));
  const targetFixture = JSON.parse(readFileSync(targetFixturePath, 'utf8'));
  const targetReceiptFixture = JSON.parse(readFileSync(targetReceiptPath, 'utf8'));
  let distributionRaw = targetFixture.expectedDistributionNdjson as string;
  const targetResult = await verifyTargetDistributionStreamV2({
    trustScope: 'synthetic_fixture',
    sourceDecisionStream: stream(() => targetFixture.sourceDecisionNdjson),
    distributionStream: stream(() => distributionRaw),
    sourceDatasetManifestRaw: targetFixture.sourceDatasetManifestRaw,
    policyConfigRaw: targetFixture.policyConfigRaw,
    targetManifestRaw: targetFixture.expectedTargetManifestRaw,
    verificationReceiptRaw: `${canonicalWireJsonV1(targetReceiptFixture.expectedReceipt)}\n`,
  });
  if (targetResult.status !== 'verified') throw new Error(targetResult.blocker);

  const syntheticDecisionLog = {
    contractVersion: 'synthetic_decision_log_v1',
    decisionId: behaviorFixture.input.sourceDecisionLog.decisionId,
    requestId: behaviorFixture.input.sourceDecisionLog.requestId,
    decisionAt: behaviorFixture.input.sourceDecisionLog.decisionAt,
    sourceDecisionLogSha256: behaviorFixture.input.sourceDecisionLogSha256,
    sourceCandidatePoolSha256:
      behaviorFixture.input.sourceDecisionLog.candidatePool.candidatePoolSha256,
    behaviorPolicy: behaviorFixture.input.config,
    behaviorPolicyConfigSha256: behaviorFixture.behaviorPolicyConfigSha256,
    uniformDraws: behaviorFixture.input.uniformDraws,
    actions: behaviorFixture.expected.orderedActions.map((action: any, index: number) => ({
      actionKey: action.actionKey,
      selectionRank: index + 1,
      behaviorPropensity: {
        status: 'simulated_propensity',
        plackettLuceProbability: action.plackettLuceProbability,
        conditionalSelectionProbability: action.conditionalSelectionProbability,
      },
    })),
    evidenceKind: 'simulated_propensity',
    realDatasetEligible: false,
    servable: false,
  };
  const syntheticDecisionLogSha256 = sha256(syntheticDecisionLog);
  const rewardDefinition = {
    objective: 'synthetic_dwell',
    definitionVersion: 'phase11-synthetic-v1',
    horizonMs: 100,
    weights: {
      click: 0, like: 0, reply: 0, repost: 0, quote: 0,
      share: 0, dismiss: 0, blockAuthor: 0, report: 0,
    },
    dwell: { weight: 1, capMs: 10, scaleMs: 1 },
  };
  const traceUserId = 'phase11-synthetic-user';
  const impressionAt = Date.parse(syntheticDecisionLog.decisionAt) + 1;
  const events = syntheticDecisionLog.actions.flatMap((action: any, index: number) => {
    const common = {
      userId: traceUserId,
      requestId: syntheticDecisionLog.requestId,
      rank: action.actionKey.servedPosition,
      metadata: {
        decisionId: syntheticDecisionLog.decisionId,
        candidateNamespace: action.actionKey.candidateNamespace,
        candidateId: action.actionKey.candidateId,
        positionContractVersion: 'served_position_1_based_v1',
      },
    };
    const impression = {
      ...common,
      action: ActionType.IMPRESSION,
      timestamp: new Date(impressionAt).toISOString(),
      metadata: { ...common.metadata, recommendationEventKey: `impression-${index}` },
    };
    const dwell = {
      ...common,
      action: ActionType.DWELL,
      timestamp: new Date(impressionAt + 1).toISOString(),
      dwellTimeMs: index + 1,
      metadata: { ...common.metadata, recommendationEventKey: `dwell-${index}` },
    };
    return [impression, dwell].map((event) => ({
      eventId: event.metadata.recommendationEventKey,
      eventSha256: syntheticOutcomeEventSha256V1(event),
      event,
    }));
  });
  const outcome = verifySyntheticOutcomeEvidenceV1({
    contractVersion: 'synthetic_outcome_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    traceUserId,
    observedThrough: new Date(impressionAt + rewardDefinition.horizonMs).toISOString(),
    rewardDefinition,
    events,
  });
  if (outcome.status !== 'verified') throw new Error(outcome.blocker);
  const context = verifySyntheticContextV1({
    contractVersion: 'synthetic_context_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    contextAt: new Date(Date.parse(syntheticDecisionLog.decisionAt) - 2).toISOString(),
    availableAt: new Date(Date.parse(syntheticDecisionLog.decisionAt) - 1).toISOString(),
    sourceSha256: 'c'.repeat(64),
    sourceVersion: 'phase11-context-v1',
    inferenceClusterId: 'cluster-a',
    segments: options.contextSegments ?? { country: 'US', surface: 'home' },
  });
  if (context.status !== 'verified') throw new Error(context.blocker);

  return {
    behaviorFixture,
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    outcome: outcome.evidence,
    context: context.evidence,
    targetEvidence: targetResult.evidence,
    events,
    setTargetDistributionRaw(raw: string) { distributionRaw = raw; },
    input: {
      contractVersion: 'synthetic_trajectory_verification_input_v1',
      behaviorFixture,
      syntheticDecisionLog,
      syntheticDecisionLogSha256,
      outcomeEvidence: outcome.evidence,
      contextEvidence: context.evidence,
      targetEvidence: targetResult.evidence,
      evidenceKind: 'simulated_propensity',
      realDatasetEligible: false,
      servable: false,
    },
  };
}

const limits = (overrides: Record<string, number> = {}) => ({
  maxDecisions: 2,
  maxSlots: 4,
  maxClusters: 2,
  maxSegmentKeys: 4,
  maxObjectives: 2,
  maxAggregateStateEntries: 8,
  maxEstimatedAggregateStateBytes: 32_768,
  maxBufferedActions: 4_096,
  maxBufferedRecords: 2_049,
  maxBufferedBytes: 1_048_576,
  ...overrides,
});

async function verifiedTrajectory(options: FixtureOptions = {}) {
  const value = await fixture(options);
  const result = await verifySyntheticTrajectoryEvidenceV1(value.input);
  if (result.status !== 'verified') throw new Error(result.blocker);
  return { ...value, trajectory: result.evidence };
}

describe('Phase 11A bounded streaming evidence', () => {
  it('fails closed when hostile raw inputs or brand probes throw', async () => {
    const ownKeysTrap = new Proxy(Object.freeze({}), {
      ownKeys: () => { throw new Error('hostile_own_keys'); },
    });
    const getterTrap = Object.freeze(Object.defineProperty({}, 'predictionStep', {
      enumerable: true,
      get: () => { throw new Error('hostile_getter'); },
    }));

    expect(await verifySyntheticTrajectoryEvidenceV1(ownKeysTrap)).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_trajectory_contract_invalid',
    });
    expect(isVerifiedSyntheticTrajectoryEvidenceV1(ownKeysTrap)).toBe(false);
    expect(isVerifiedSyntheticOutcomeEvidenceV1(getterTrap)).toBe(false);
    expect(isVerifiedSyntheticContextV1(getterTrap)).toBe(false);
    expect(verifySyntheticContextV1(ownKeysTrap)).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_context_contract_invalid',
    });
    expect(isVerifiedOpeAggregateReceiptV3(ownKeysTrap)).toBe(false);
    expect(isOpeSlotContributionBoundToReceiptV3(getterTrap, ownKeysTrap)).toBe(false);
    expect(createOpeAggregateStateV3(ownKeysTrap)).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_resource_config_invalid',
    });

    const value = await verifiedTrajectory();
    const hostileTargetEvidence = new Proxy(value.targetEvidence, {
      ownKeys: () => { throw new Error('hostile_target_own_keys'); },
    });
    expect(await verifySyntheticTrajectoryEvidenceV1({
      ...value.input,
      targetEvidence: hostileTargetEvidence,
    })).toEqual({ status: 'not_evaluable', blocker: 'target_verified_brand_missing' });

    const hostileTrajectoryState = createOpeAggregateStateV3({
      limits: limits(), trajectories: [value.trajectory],
    });
    if (hostileTrajectoryState.status !== 'created') {
      throw new Error(hostileTrajectoryState.blocker);
    }
    const hostileTrajectory = new Proxy(value.trajectory, {
      get: () => { throw new Error('hostile_trajectory_getter'); },
    });
    expect(await replayOpeTrajectoryV3(
      hostileTrajectoryState.state,
      hostileTrajectory,
    )).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_trajectory_verified_brand_missing',
    });

    const hostileContextState = createOpeAggregateStateV3({
      limits: limits(), trajectories: [value.trajectory],
    });
    if (hostileContextState.status !== 'created') throw new Error(hostileContextState.blocker);
    expect(await replayOpeTrajectoryV3(hostileContextState.state, value.trajectory, {
      contextForStep: () => getterTrap,
    })).toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_contract_invalid' });
  });

  it('accepts only the fixed Rust behavior root and branded exact-prefix V2 target replay', async () => {
    const value = await fixture();
    expect(await verifySyntheticTrajectoryEvidenceV1({
      ...value.input,
      targetEvidence: {
        contractVersion: 'verified_target_distribution_evidence_v2',
        manifest: value.targetEvidence.manifest,
        receipt: value.targetEvidence.receipt,
      },
    })).toEqual({ status: 'not_evaluable', blocker: 'target_verified_brand_missing' });
    expect(await verifySyntheticTrajectoryEvidenceV1({
      ...value.input,
      target: { policyConfigSha256: 'a'.repeat(64), steps: [] },
    })).toEqual({ status: 'not_evaluable', blocker: 'synthetic_trajectory_contract_invalid' });
    expect(await verifySyntheticTrajectoryEvidenceV1({
      ...value.input,
      syntheticDecisionLog: value.behaviorFixture.input.sourceDecisionLog,
      syntheticDecisionLogSha256: value.behaviorFixture.input.sourceDecisionLogSha256,
    })).toEqual({ status: 'not_evaluable', blocker: 'synthetic_trajectory_contract_invalid' });

    const verified = await verifySyntheticTrajectoryEvidenceV1(value.input);
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(verified.evidence.behaviorPolicyConfigSha256)
      .not.toBe(verified.evidence.targetPolicyConfigSha256);
    const replayedActionIds: string[] = [];
    expect(await replayVerifiedSyntheticTrajectoryEvidenceV1(verified.evidence, {
      onStep: (step) => { replayedActionIds.push(step.loggedActionKey.candidateId); },
      commit: () => undefined,
      abort: () => undefined,
    })).toEqual({ status: 'verified' });
    expect(replayedActionIds).toEqual([
      '507f191e810c19729de8c001',
      '507f191e810c19729de8c002',
    ]);
    expect(isVerifiedSyntheticTrajectoryEvidenceV1(verified.evidence)).toBe(true);
    expect(isVerifiedSyntheticTrajectoryEvidenceV1(structuredClone(verified.evidence))).toBe(false);
  });

  it('rejects behavior fixture changes and target cursor prefix drift before minting a brand', async () => {
    const behavior = await fixture();
    const tamperedBehavior = structuredClone(behavior.input);
    tamperedBehavior.behaviorFixture.input.uniformDraws[0] = 0.25;
    expect(await verifySyntheticTrajectoryEvidenceV1(tamperedBehavior)).toEqual({
      status: 'not_evaluable', blocker: 'behavior_fixture_trust_root_mismatch',
    });

    const target = await fixture();
    const records = (JSON.parse(readFileSync(targetFixturePath, 'utf8'))
      .expectedDistributionNdjson as string).trim().split('\n').map(JSON.parse);
    const second = records.find((record: any) => (
      record.recordType === 'step_start' && record.servedPosition === 2
    ));
    second.prefixActionKeys[0].candidateId = '507f191e810c19729de8c003';
    target.setTargetDistributionRaw(`${records.map(canonicalWireJsonV1).join('\n')}\n`);
    expect(await verifySyntheticTrajectoryEvidenceV1(target.input)).toEqual({
      status: 'not_evaluable', blocker: 'target_prefix_binding_mismatch',
    });
  });

  it('uses synthetic-native whole-window outcomes without a deterministic-log disguise', async () => {
    const value = await fixture();
    expect(isVerifiedSyntheticOutcomeEvidenceV1(value.outcome)).toBe(true);
    expect(value.outcome).not.toHaveProperty('decisionLog');
    expect(value.outcome).not.toHaveProperty('behaviorPolicyKind');
    expect(value.outcome.syntheticDecisionLogSha256).toBe(value.syntheticDecisionLogSha256);
    expect(value.outcome.rewardBounds).toEqual({ minimum: 0, maximum: 10 });
    expect(value.syntheticDecisionLog.actions.every((action: any) => (
      action.behaviorPropensity.status === 'simulated_propensity'
    ))).toBe(true);

    const censored = verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'phase11-synthetic-dataset',
      syntheticDecisionLog: value.syntheticDecisionLog,
      syntheticDecisionLogSha256: value.syntheticDecisionLogSha256,
      traceUserId: 'phase11-synthetic-user',
      observedThrough: value.events[0].event.timestamp,
      rewardDefinition: value.outcome.rewardDefinition,
      events: value.events,
    });
    expect(censored).toEqual({ status: 'not_evaluable', blocker: 'synthetic_outcome_censored' });

    const missing = verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'phase11-synthetic-dataset',
      syntheticDecisionLog: value.syntheticDecisionLog,
      syntheticDecisionLogSha256: value.syntheticDecisionLogSha256,
      traceUserId: 'phase11-synthetic-user',
      observedThrough: value.outcome.observedThrough,
      rewardDefinition: value.outcome.rewardDefinition,
      events: value.events.filter((envelope: any) => (
        envelope.event.metadata.candidateId
          !== value.syntheticDecisionLog.actions[1].actionKey.candidateId
      )),
    });
    expect(missing).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_outcome_exposure_missing',
    });

    const conflictEvent = structuredClone(value.events[0]);
    conflictEvent.event.timestamp = new Date(
      Date.parse(conflictEvent.event.timestamp) + 1,
    ).toISOString();
    conflictEvent.eventSha256 = syntheticOutcomeEventSha256V1(conflictEvent.event);
    expect(verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'phase11-synthetic-dataset',
      syntheticDecisionLog: value.syntheticDecisionLog,
      syntheticDecisionLogSha256: value.syntheticDecisionLogSha256,
      traceUserId: 'phase11-synthetic-user',
      observedThrough: value.outcome.observedThrough,
      rewardDefinition: value.outcome.rewardDefinition,
      events: [...value.events, conflictEvent],
    })).toEqual({ status: 'not_evaluable', blocker: 'synthetic_outcome_event_conflict' });

    const cyclicEvent: any = {};
    cyclicEvent.self = cyclicEvent;
    expect(verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'phase11-synthetic-dataset',
      syntheticDecisionLog: value.syntheticDecisionLog,
      syntheticDecisionLogSha256: value.syntheticDecisionLogSha256,
      traceUserId: 'phase11-synthetic-user',
      observedThrough: value.outcome.observedThrough,
      rewardDefinition: value.outcome.rewardDefinition,
      events: [{ eventId: 'cyclic-event', eventSha256: 'a'.repeat(64), event: cyclicEvent }],
    })).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_outcome_event_contract_invalid',
    });

    expect(verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'phase11-synthetic-dataset',
      syntheticDecisionLog: value.syntheticDecisionLog,
      syntheticDecisionLogSha256: value.syntheticDecisionLogSha256,
      traceUserId: 'phase11-synthetic-user',
      observedThrough: value.outcome.observedThrough,
      rewardDefinition: {
        ...value.outcome.rewardDefinition,
        weights: {
          ...value.outcome.rewardDefinition.weights,
          click: 1e308,
          like: 1e308,
        },
      },
      events: value.events,
    })).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_outcome_reward_bounds_not_finite',
    });

    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'contractVersion', {
      enumerable: true,
      get: () => { throw new Error('getter failed'); },
    });
    expect(verifySyntheticOutcomeEvidenceV1(throwingGetter)).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_outcome_contract_invalid',
    });
    expect(verifySyntheticOutcomeEvidenceV1(new Proxy({}, {
      get: () => { throw new Error('proxy failed'); },
    }))).toEqual({
      status: 'not_evaluable', blocker: 'synthetic_outcome_contract_invalid',
    });
  });

  it('emits one contribution at a time from frozen context and preserves prefix IPS math', async () => {
    const value = await verifiedTrajectory();
    expect(value.trajectory.steps.every((step) => !('targetDistribution' in step))).toBe(true);
    const state = createOpeAggregateStateV3({
      limits: limits(), trajectories: [value.trajectory],
    });
    if (state.status !== 'created') throw new Error(state.blocker);
    const contributions: Array<any> = [];
    expect(await replayOpeTrajectoryV3(state.state, value.trajectory, {
      onContribution: (contribution) => { contributions.push(contribution); },
    })).toEqual({ status: 'verified' });
    const [first, second] = contributions;
    const expectedFirst = first.targetProbability / first.behaviorProbability;
    const expectedSecond = expectedFirst
      * second.targetProbability
      / second.behaviorProbability;
    expect(first.prefixWeight).toBe(1);
    expect(first.weight).toBeCloseTo(expectedFirst, 12);
    expect(second.prefixWeight).toBeCloseTo(expectedFirst, 12);
    expect(second.weight).toBeCloseTo(expectedSecond, 12);
    expect(first.binding).toMatchObject({
      inferenceClusterId: 'cluster-a',
      objective: 'synthetic_dwell',
      segmentAssignments: [{ key: 'country', value: 'US' }, { key: 'surface', value: 'home' }],
    });
    expect('rows' in first).toBe(false);

    const receipt = finalizeOpeAggregateReceiptV3(state.state);
    expect(receipt.status).toBe('verified');
    if (receipt.status !== 'verified') return;
    const aggregateKey = canonicalDecisionJson({
      inferenceClusterId: first.binding.inferenceClusterId,
      objective: first.binding.objective,
      segmentAssignments: first.binding.segmentAssignments,
    });
    expect(receipt.receipt).toMatchObject({
      expectedDecisionCount: 1,
      observedDecisionCount: 1,
      expectedSlotCount: 2,
      observedSlotCount: 2,
      trajectoryCohortSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      contributionHashChainSha256: second.contributionSha256,
      aggregateStateSha256: sha256([[
        aggregateKey,
        {
          contributionSum: contributions.reduce(
            (sum, contribution) => sum + contribution.ipsContribution,
            0,
          ),
          slotCount: 2,
        },
      ]]),
      fullyStreaming: false,
      highWaterDiagnostics: expect.objectContaining({
        peakBufferedActions: value.trajectory.highWaterDiagnostics.peakBufferedActions,
        peakBufferedRecords: value.trajectory.highWaterDiagnostics.peakBufferedRecords,
        peakBufferedBytes: value.trajectory.highWaterDiagnostics.peakBufferedBytes,
      }),
    });
    expect(isVerifiedOpeAggregateReceiptV3(receipt.receipt)).toBe(true);
  });

  it('poisons valid-invalid cohorts and rejects empty, incomplete, and cross-state trajectories', async () => {
    expect(createOpeAggregateStateV3({ limits: limits(), trajectories: [] })).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_empty_cohort',
    });
    const first = await verifiedTrajectory();
    const state = createOpeAggregateStateV3({ limits: limits(), trajectories: [first.trajectory] });
    if (state.status !== 'created') throw new Error(state.blocker);
    expect(finalizeOpeAggregateReceiptV3(state.state)).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_incomplete_cohort',
    });

    const poisoned = createOpeAggregateStateV3({
      limits: limits(), trajectories: [first.trajectory],
    });
    if (poisoned.status !== 'created') throw new Error(poisoned.blocker);
    const invalid = await replayOpeTrajectoryV3(poisoned.state, first.trajectory, {
      contextForStep: (step) => step.servedPosition === 2 ? { qHat: [] } : {},
    } as any);
    expect(invalid).toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_contract_invalid' });
    expect(await replayOpeTrajectoryV3(poisoned.state, first.trajectory)).toEqual(invalid);
    expect(finalizeOpeAggregateReceiptV3(poisoned.state)).toEqual(invalid);

    const drifted = await verifiedTrajectory({ contextSegments: { country: 'DE' } });
    const crossState = createOpeAggregateStateV3({
      limits: limits(), trajectories: [first.trajectory],
    });
    if (crossState.status !== 'created') throw new Error(crossState.blocker);
    expect(await replayOpeTrajectoryV3(crossState.state, drifted.trajectory))
      .toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_not_in_cohort' });
    expect(finalizeOpeAggregateReceiptV3(crossState.state)).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_step_not_in_cohort',
    });

    const callbackState = createOpeAggregateStateV3({
      limits: limits(), trajectories: [first.trajectory],
    });
    if (callbackState.status !== 'created') throw new Error(callbackState.blocker);
    const callbackFailure = await replayOpeTrajectoryV3(callbackState.state, first.trajectory, {
      onContribution: () => { throw new Error('sink failed'); },
    });
    expect(callbackFailure).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_contribution_callback_failed',
    });
    expect(finalizeOpeAggregateReceiptV3(callbackState.state)).toEqual(callbackFailure);
  });

  it('uses byte-order canonicalization and gates measured single-step buffering', async () => {
    const value = await verifiedTrajectory({ contextSegments: { locale: 'ä', surface: '首页' } });
    const constrained = createOpeAggregateStateV3({
      limits: limits({
        maxBufferedActions: value.trajectory.highWaterDiagnostics.peakBufferedActions - 1,
      }),
      trajectories: [value.trajectory],
    });
    expect(constrained).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_resource_limit_exceeded',
    });

    const originalLocaleCompare = String.prototype.localeCompare;
    const originalSort = Array.prototype.sort;
    let probedTrajectoryComparator = false;
    String.prototype.localeCompare = () => { throw new Error('locale collation forbidden'); };
    Array.prototype.sort = function sort(compareFn?: (left: unknown, right: unknown) => number) {
      if (this.some((entry) => typeof entry === 'string' && entry.includes('\u0000'))) {
        if (!compareFn) throw new Error('trajectory identity sort requires a comparator');
        expect(compareFn('\u{1F600}', '\uE000')).toBeGreaterThan(0);
        probedTrajectoryComparator = true;
      }
      return originalSort.call(this, compareFn);
    } as typeof Array.prototype.sort;
    try {
      const reverified = await verifySyntheticTrajectoryEvidenceV1(value.input);
      expect(reverified.status).toBe('verified');
      if (reverified.status === 'verified') {
        expect(reverified.evidence.trajectoryEvidenceSha256)
          .toBe(value.trajectory.trajectoryEvidenceSha256);
      }
      const state = createOpeAggregateStateV3({
        limits: limits(), trajectories: [value.trajectory],
      });
      if (state.status !== 'created') throw new Error(state.blocker);
      expect(await replayOpeTrajectoryV3(state.state, value.trajectory))
        .toEqual({ status: 'verified' });
      expect(finalizeOpeAggregateReceiptV3(state.state).status).toBe('verified');
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
      Array.prototype.sort = originalSort;
    }
    expect(probedTrajectoryComparator).toBe(true);
  });

  it('privately binds contributions to their originating state receipt', async () => {
    const value = await verifiedTrajectory();
    const stateA = createOpeAggregateStateV3({ limits: limits(), trajectories: [value.trajectory] });
    const stateB = createOpeAggregateStateV3({ limits: limits(), trajectories: [value.trajectory] });
    if (stateA.status !== 'created' || stateB.status !== 'created') throw new Error('state');
    const contributionsA: Array<any> = [];
    const contributionsB: Array<any> = [];
    expect(await replayOpeTrajectoryV3(stateA.state, value.trajectory, {
      onContribution: (contribution) => { contributionsA.push(contribution); },
    })).toEqual({ status: 'verified' });
    expect(await replayOpeTrajectoryV3(stateB.state, value.trajectory, {
      onContribution: (contribution) => { contributionsB.push(contribution); },
    })).toEqual({ status: 'verified' });
    const receiptA = finalizeOpeAggregateReceiptV3(stateA.state);
    const receiptB = finalizeOpeAggregateReceiptV3(stateB.state);
    if (
      !contributionsA[1]
      || !contributionsB[1]
      || receiptA.status !== 'verified'
      || receiptB.status !== 'verified'
    ) throw new Error('aggregation');
    expect(isOpeSlotContributionBoundToReceiptV3(
      contributionsA[1],
      receiptA.receipt,
    )).toBe(true);
    expect(isOpeSlotContributionBoundToReceiptV3(
      contributionsA[1],
      receiptB.receipt,
    )).toBe(false);
  });

  it('fails closed on scalar underflow and rejects unbranded qHat contexts', async () => {
    expect(scaleLogValueV3(Math.log(Number.MIN_VALUE) - 1, 1, 'importance')).toEqual({
      status: 'not_evaluable', blocker: 'importance_contribution_underflow',
    });
    const value = await verifiedTrajectory();
    const wrongPositionState = createOpeAggregateStateV3({
      limits: limits(), trajectories: [value.trajectory],
    });
    if (wrongPositionState.status !== 'created') throw new Error(wrongPositionState.blocker);
    expect(await replayOpeTrajectoryV3(wrongPositionState.state, value.trajectory, {
      contextForStep: (step) => ({
        qHat: step.targetDistribution.map((entry) => ({
          actionKey: {
            ...entry.actionKey,
            servedPosition: entry.actionKey.candidateId === step.loggedActionKey.candidateId
              ? entry.actionKey.servedPosition + 1
              : entry.actionKey.servedPosition,
          },
          value: 0,
        })),
      }),
    } as any)).toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_contract_invalid' });

    const state = createOpeAggregateStateV3({ limits: limits(), trajectories: [value.trajectory] });
    if (state.status !== 'created') throw new Error(state.blocker);
    expect(await replayOpeTrajectoryV3(state.state, value.trajectory, {
      contextForStep: (step) => ({
        qHat: step.targetDistribution.map((entry) => ({
          actionKey: entry.actionKey,
          value: Number.MIN_VALUE,
        })),
      }),
    } as any))
      .toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_contract_invalid' });
    expect(finalizeOpeAggregateReceiptV3(state.state)).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_step_contract_invalid',
    });
  });

  it('derives model budgets from canonical structures and exposes no validated receipt', () => {
    const config = phase11ModelStateResourceConfigV1({
      foldCount: 2,
      maxCoefficientsPerHead: 2,
      maxTotalCoefficientCount: 20,
      maxModelBytes: 320,
      maxGradientBytes: 320,
      maxTrainingDecisionsPerFold: 2,
      maxHoldoutDecisionsPerFold: 2,
      maxTrainingRowsPerFold: 2,
      maxHoldoutRowsPerFold: 2,
    });
    const heads = [
      'click', 'like', 'reply', 'repost', 'quote',
      'share', 'dismiss', 'blockAuthor', 'report', 'dwell',
    ];
    const state = {
      folds: [0, 1].map((foldId) => ({
        foldId,
        trainingDecisionIds: [`train-${foldId}`],
        holdoutDecisionIds: [`holdout-${foldId}`],
        trainingRowKeys: [`train-${foldId}\u0000row`],
        holdoutRowKeys: [`holdout-${foldId}\u0000row`],
        heads: heads.map((head) => ({
          head,
          intercept: 0,
          coefficients: [{ feature: 'feature-a', value: 0 }],
        })),
      })),
    };
    expect(evaluatePhase11ModelStateBudgetV1(config, state)).toMatchObject({
      status: 'within_budget',
      role: 'allocation_budget_only',
      canMintVerifiedPredictionReceipt: false,
      usage: { coefficientCount: 20, modelBytes: 320, gradientBytes: 320 },
    });
    expect(evaluatePhase11ModelStateBudgetV1(config, {
      ...state,
      modelBytes: 1,
      gradientBytes: 1,
    })).toEqual({ status: 'not_evaluable', blocker: 'model_state_contract_invalid' });
    expect(evaluatePhase11ModelStateBudgetV1({
      ...config,
      limits: { ...config.limits, maxTotalCoefficientCount: 19 },
    }, state)).toEqual({ status: 'not_evaluable', blocker: 'model_state_resource_limit_exceeded' });
  });

  it('preserves honest atomic publish semantics and rejects legacy V3 inputs', async () => {
    expect(describePhase11AtomicPublishResultV1({
      status: 'published_durability_unconfirmed',
      durability: 'unconfirmed',
      reason: 'parent_directory_sync_failed',
      sha256: 'a'.repeat(64),
      recordCount: 1,
    })).toMatchObject({ finalPathVisibility: 'may_be_visible', retry: 'forbidden' });
    expect(describePhase11AtomicPublishResultV1({
      status: 'pre_publish_failed', reason: 'write_failed',
    })).toMatchObject({ finalPathVisibility: 'not_visible', retry: 'allowed' });

    const value = await verifiedTrajectory();
    const state = createOpeAggregateStateV3({ limits: limits(), trajectories: [value.trajectory] });
    if (state.status !== 'created') throw new Error(state.blocker);
    expect(consumeOpeStepContributionV3(
      state.state,
      { contractVersion: 'verified_target_distribution_evidence_v2' } as never,
      {},
    )).toEqual({ status: 'not_evaluable', blocker: 'ope_v3_step_brand_missing' });
  });
});
