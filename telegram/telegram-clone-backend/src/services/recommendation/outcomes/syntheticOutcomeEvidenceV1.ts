import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalDecisionJson } from '../decisionLog/contracts';
import { syntheticDecisionLogV1Schema } from '../offlinePrediction/streamingV2/contracts';
import { opeRewardDefinitionSchema } from '../ope/contracts';
import {
  attributeValidatedOutcomeCoreV1,
  type OutcomeContractV1,
} from './outcomeContractV1';
import {
  calculateOutcomeRewardBoundsV1,
  outcomeEventSha256V1,
} from './verifiedOutcomeEvidenceV1';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1);
const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1).max(512).refine((value) => value === value.trim()),
  eventSha256: sha256Schema,
  event: z.unknown(),
}).strict();

export const syntheticOutcomeVerificationInputV1Schema = z.object({
  contractVersion: z.literal('synthetic_outcome_verification_input_v1'),
  datasetVersion: nonEmpty,
  syntheticDecisionLog: syntheticDecisionLogV1Schema,
  syntheticDecisionLogSha256: sha256Schema,
  traceUserId: nonEmpty,
  observedThrough: z.string().datetime({ offset: true }),
  rewardDefinition: opeRewardDefinitionSchema,
  events: z.array(eventEnvelopeSchema).min(1).max(20_000),
}).strict();

type ObservedOutcome = Extract<OutcomeContractV1, { status: 'observed' }>;
type RewardDefinition = z.infer<typeof opeRewardDefinitionSchema>;

export type VerifiedSyntheticOutcomeActionV1 = {
  actionKey: z.infer<typeof syntheticDecisionLogV1Schema>['actions'][number]['actionKey'];
  eventSetSha256: string;
  reward: number;
  outcome: ObservedOutcome;
};

export type VerifiedSyntheticOutcomeEvidenceV1 = {
  contractVersion: 'verified_synthetic_outcome_evidence_v1';
  datasetVersion: string;
  decisionId: string;
  requestId: string;
  syntheticDecisionLogSha256: string;
  rewardDefinition: RewardDefinition;
  rewardDefinitionSha256: string;
  rewardBounds: { minimum: number; maximum: number };
  objective: string;
  traceUserId: string;
  observedThrough: string;
  eventSetSha256: string;
  outcomes: VerifiedSyntheticOutcomeActionV1[];
  syntheticOutcomeEvidenceSha256: string;
  evidenceKind: 'simulated_propensity';
  realDatasetEligible: false;
  servable: false;
};

export type VerifySyntheticOutcomeEvidenceResultV1 =
  | { status: 'verified'; evidence: VerifiedSyntheticOutcomeEvidenceV1 }
  | { status: 'not_evaluable'; blocker: string };

const BOOLEAN_REWARD_HEADS = [
  'click', 'like', 'reply', 'repost', 'quote', 'share', 'dismiss',
  'blockAuthor', 'report',
] as const;
const verified = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const record = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

export const syntheticOutcomeEventSha256V1 = outcomeEventSha256V1;

export function isVerifiedSyntheticOutcomeEvidenceV1(
  value: unknown,
): value is VerifiedSyntheticOutcomeEvidenceV1 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    const candidate = value as VerifiedSyntheticOutcomeEvidenceV1;
    const expected = verifiedDigests.get(value);
    return verified.has(value)
      && expected !== undefined
      && candidate.syntheticOutcomeEvidenceSha256 === expected
      && digestWithout(candidate, 'syntheticOutcomeEvidenceSha256') === expected;
  } catch {
    return false;
  }
}

export function verifySyntheticOutcomeEvidenceV1(
  raw: unknown,
): VerifySyntheticOutcomeEvidenceResultV1 {
  let parsed: ReturnType<typeof syntheticOutcomeVerificationInputV1Schema.safeParse>;
  try {
    parsed = syntheticOutcomeVerificationInputV1Schema.safeParse(raw);
  } catch {
    return reject('synthetic_outcome_contract_invalid');
  }
  if (!parsed.success) return reject('synthetic_outcome_contract_invalid');
  const input = parsed.data;
  const log = input.syntheticDecisionLog;
  if (input.syntheticDecisionLogSha256 !== digest(log)) {
    return reject('synthetic_outcome_decision_digest_mismatch');
  }
  const rewardBounds = calculateOutcomeRewardBoundsV1(input.rewardDefinition);
  if (!rewardBounds) return reject('synthetic_outcome_reward_bounds_not_finite');

  const uniqueEvents = new Map<string, {
    eventId: string;
    eventSha256: string;
    timestamp: number;
    event: unknown;
  }>();
  try {
    for (const envelope of input.events) {
      if (syntheticOutcomeEventSha256V1(envelope.event) !== envelope.eventSha256) {
        return reject('synthetic_outcome_event_digest_mismatch');
      }
      const event = record(envelope.event);
      const metadata = record(event?.metadata);
      if (metadata?.recommendationEventKey !== envelope.eventId) {
        return reject('synthetic_outcome_event_identity_mismatch');
      }
      if (metadata.decisionId !== log.decisionId) {
        return reject('synthetic_outcome_event_membership_mismatch');
      }
      const timestamp = typeof event?.timestamp === 'number'
        ? event.timestamp
        : typeof event?.timestamp === 'string'
          ? Date.parse(event.timestamp)
          : Number.NaN;
      if (!Number.isFinite(timestamp)) return reject('synthetic_outcome_event_timestamp_invalid');
      const existing = uniqueEvents.get(envelope.eventId);
      if (existing && existing.eventSha256 !== envelope.eventSha256) {
        return reject('synthetic_outcome_event_conflict');
      }
      if (!existing) uniqueEvents.set(envelope.eventId, { ...envelope, timestamp });
    }
  } catch {
    return reject('synthetic_outcome_event_contract_invalid');
  }
  const events = [...uniqueEvents.values()].sort((left, right) => (
    left.timestamp - right.timestamp || compareText(left.eventId, right.eventId)
  ));
  const eventSetSha256 = digest(events.map(({ eventId, eventSha256, timestamp }) => ({
    eventId,
    eventSha256,
    timestamp: new Date(timestamp).toISOString(),
  })));
  const observedThroughMs = Date.parse(input.observedThrough);
  const outcomes: VerifiedSyntheticOutcomeActionV1[] = [];
  for (const action of log.actions) {
    const outcome = attributeValidatedOutcomeCoreV1({
      decision: {
        decisionId: log.decisionId,
        requestId: log.requestId,
        decisionAt: log.decisionAt,
        actionKeys: log.actions.map((entry) => entry.actionKey),
      },
      actionKey: action.actionKey,
      traceUserId: input.traceUserId,
      events: events.map((entry) => entry.event),
      observedThroughMs,
      horizonMs: input.rewardDefinition.horizonMs,
    });
    if (outcome.status !== 'observed') {
      const blocker = outcome.status === 'censored'
        ? 'synthetic_outcome_censored'
        : outcome.status === 'exposure_missing'
          ? 'synthetic_outcome_exposure_missing'
          : 'synthetic_outcome_invalid_attribution';
      return reject(blocker);
    }
    const reward = calculateReward(outcome, input.rewardDefinition);
    if (!Number.isFinite(reward)) return reject('synthetic_outcome_reward_not_finite');
    if (reward < rewardBounds.minimum || reward > rewardBounds.maximum) {
      return reject('synthetic_outcome_reward_out_of_bounds');
    }
    outcomes.push({ actionKey: action.actionKey, eventSetSha256, reward, outcome });
  }

  const preimage = {
    contractVersion: 'verified_synthetic_outcome_evidence_v1' as const,
    datasetVersion: input.datasetVersion,
    decisionId: log.decisionId,
    requestId: log.requestId,
    syntheticDecisionLogSha256: input.syntheticDecisionLogSha256,
    rewardDefinition: input.rewardDefinition,
    rewardDefinitionSha256: digest(input.rewardDefinition),
    rewardBounds,
    objective: input.rewardDefinition.objective,
    traceUserId: input.traceUserId,
    observedThrough: new Date(observedThroughMs).toISOString(),
    eventSetSha256,
    outcomes,
    evidenceKind: 'simulated_propensity' as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const evidence = recursivelyFreeze({
    ...preimage,
    syntheticOutcomeEvidenceSha256: digest(preimage),
  });
  verified.add(evidence);
  verifiedDigests.set(evidence, evidence.syntheticOutcomeEvidenceSha256);
  return recursivelyFreeze({ status: 'verified' as const, evidence });
}

function calculateReward(outcome: ObservedOutcome, definition: RewardDefinition): number {
  let reward = 0;
  for (const head of BOOLEAN_REWARD_HEADS) {
    reward += definition.weights[head] * (outcome.labels[head] ? 1 : 0);
  }
  return reward + definition.dwell.weight
    * Math.min(outcome.labels.dwellTimeMs, definition.dwell.capMs)
    / definition.dwell.scaleMs;
}

function digestWithout(value: Record<string, unknown>, key: string): string {
  const { [key]: _ignored, ...preimage } = value;
  return digest(preimage);
}

function reject(blocker: string): VerifySyntheticOutcomeEvidenceResultV1 {
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
