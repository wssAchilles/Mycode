import { createHash } from 'crypto';

import { z } from 'zod';

import {
  canonicalDecisionJson,
  decisionLogSha256,
  recommendationDecisionLogSchema,
  type RecommendationDecisionLogV1,
} from '../decisionLog/contracts';
import { opeRewardDefinitionSchema } from '../ope/contracts';
import {
  attributeOutcomeV1,
  type OutcomeContractV1,
} from './outcomeContractV1';

export const VERIFIED_OUTCOME_EVIDENCE_VERSION = 'verified_outcome_evidence_v1' as const;
export const VERIFIED_OUTCOME_EVIDENCE_LIMITS_VERSION = 'verified_outcome_evidence_limits_v1' as const;
export const VERIFIED_OUTCOME_EVIDENCE_LIMITS = Object.freeze({
  version: VERIFIED_OUTCOME_EVIDENCE_LIMITS_VERSION,
  maxDecisions: 100_000,
  maxActionsPerDecision: 64,
  maxTotalActions: 500_000,
  maxEventsPerDecision: 10_000,
  maxTotalEvents: 2_000_000,
  maxAttributionChecks: 10_000_000,
} as const);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmptyString = z.string().trim().min(1);
const eventIdSchema = z.string().min(1).max(512)
  .refine((value) => value === value.trim(), { message: 'event id must be canonical' });
const eventEnvelopeSchema = z.object({
  eventId: eventIdSchema,
  eventSha256: sha256Schema,
  event: z.unknown(),
}).strict();

export const verifiedOutcomeEvidenceInputV1Schema = z.object({
  datasetVersion: nonEmptyString,
  rewardDefinition: opeRewardDefinitionSchema,
  decisions: z.array(z.object({
    decisionLog: z.unknown(),
    traceUserId: nonEmptyString,
    observedThrough: z.string().datetime({ offset: true }),
    events: z.array(eventEnvelopeSchema),
  }).strict()).min(1),
}).strict();

type RewardDefinitionV1 = z.infer<typeof opeRewardDefinitionSchema>;
type VerifiedObservedOutcomeV1 = Extract<OutcomeContractV1, { status: 'observed' }>;
type DecisionActionKeyV1 = RecommendationDecisionLogV1['actions'][number]['actionKey'];

const verifiedOutcomeEvidence = Symbol('verifiedOutcomeEvidenceV1');
const verifiedOutcomeEvidenceObjects = new WeakSet<object>();
const verifiedOutcomeEvidenceDigests = new WeakMap<object, string>();

export type VerifiedOutcomeEvidenceActionV1 = {
  decisionId: string;
  requestId: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  actionKey: DecisionActionKeyV1;
  eventSetSha256: string;
  reward: number;
  outcome: VerifiedObservedOutcomeV1;
};

export type VerifiedOutcomeEvidenceDecisionV1 = {
  decisionId: string;
  requestId: string;
  decisionAt: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  traceUserId: string;
  observedThrough: string;
  eventSetSha256: string;
  outcomes: VerifiedOutcomeEvidenceActionV1[];
};

export type VerifiedOutcomeEvidenceV1 = {
  readonly [verifiedOutcomeEvidence]: true;
  contractVersion: typeof VERIFIED_OUTCOME_EVIDENCE_VERSION;
  resourceLimitsVersion: typeof VERIFIED_OUTCOME_EVIDENCE_LIMITS_VERSION;
  outcomeEvidenceSha256: string;
  datasetVersion: string;
  rewardDefinition: RewardDefinitionV1;
  rewardDefinitionSha256: string;
  rewardBounds: { minimum: number; maximum: number };
  decisions: VerifiedOutcomeEvidenceDecisionV1[];
};

export type VerifyOutcomeEvidenceResultV1 =
  | { status: 'verified'; evidence: VerifiedOutcomeEvidenceV1 }
  | { status: 'not_evaluable'; blocker: string };

const BOOLEAN_REWARD_HEADS = [
  'click',
  'like',
  'reply',
  'repost',
  'quote',
  'share',
  'dismiss',
  'blockAuthor',
  'report',
] as const;

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');

export function outcomeEventSha256V1(event: unknown): string {
  return digest(normalizeEventDigestValue(event));
}

export function outcomeRewardDefinitionSha256V1(rewardDefinition: RewardDefinitionV1): string {
  return digest(opeRewardDefinitionSchema.parse(rewardDefinition));
}

export function outcomeEvidenceSha256V1(value: unknown): string {
  const evidence = record(value);
  if (!evidence) throw new Error('outcome evidence must be an object');
  const { outcomeEvidenceSha256: _ignored, ...preimage } = evidence;
  return digest(preimage);
}

export function isVerifiedOutcomeEvidenceV1(value: unknown): value is VerifiedOutcomeEvidenceV1 {
  try {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<VerifiedOutcomeEvidenceV1>;
    const evidenceSha256 = outcomeEvidenceSha256V1(value);
    return verifiedOutcomeEvidenceObjects.has(value)
      && candidate[verifiedOutcomeEvidence] === true
      && recursivelyFrozen(value)
      && candidate.outcomeEvidenceSha256 === evidenceSha256
      && verifiedOutcomeEvidenceDigests.get(value) === evidenceSha256;
  } catch {
    return false;
  }
}

export function verifyOutcomeEvidenceV1(input: unknown): VerifyOutcomeEvidenceResultV1 {
  if (outcomeEvidenceResourceLimitExceeded(input)) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  const parsed = verifiedOutcomeEvidenceInputV1Schema.safeParse(input);
  if (!parsed.success) {
    return { status: 'not_evaluable', blocker: 'outcome_evidence_contract_invalid' };
  }

  const decisionIds = new Set<string>();
  const cohortEventDigests = new Map<string, string>();
  const decisions: VerifiedOutcomeEvidenceDecisionV1[] = [];
  const rewardBounds = calculateOutcomeRewardBoundsV1(parsed.data.rewardDefinition);
  if (!rewardBounds) {
    return { status: 'not_evaluable', blocker: 'reward_bounds_not_finite' };
  }

  for (const entry of parsed.data.decisions) {
    const decisionResult = recommendationDecisionLogSchema.safeParse(entry.decisionLog);
    if (!decisionResult.success) {
      return { status: 'not_evaluable', blocker: 'outcome_decision_log_invalid' };
    }
    const decision = decisionResult.data;
    if (decisionIds.has(decision.decisionId)) {
      return { status: 'not_evaluable', blocker: 'outcome_decision_duplicate' };
    }
    decisionIds.add(decision.decisionId);

    const uniqueEvents = new Map<string, NormalizedEventEnvelope>();
    try {
      for (const envelope of entry.events) {
        if (outcomeEventSha256V1(envelope.event) !== envelope.eventSha256) {
          return { status: 'not_evaluable', blocker: 'outcome_event_digest_mismatch' };
        }
        const event = record(envelope.event);
        const metadata = record(event?.metadata);
        const recommendationEventKey = metadata?.recommendationEventKey;
        if (typeof recommendationEventKey !== 'string' || recommendationEventKey.length === 0) {
          return { status: 'not_evaluable', blocker: 'outcome_event_identity_missing' };
        }
        if (recommendationEventKey !== envelope.eventId) {
          return { status: 'not_evaluable', blocker: 'outcome_event_identity_mismatch' };
        }
        const timestamp = timestampMs(event?.timestamp);
        if (timestamp === null) {
          return { status: 'not_evaluable', blocker: 'outcome_event_timestamp_invalid' };
        }
        const cohortDigest = cohortEventDigests.get(envelope.eventId);
        if (cohortDigest !== undefined && cohortDigest !== envelope.eventSha256) {
          return { status: 'not_evaluable', blocker: 'outcome_event_conflict' };
        }
        if (cohortDigest === undefined) {
          cohortEventDigests.set(envelope.eventId, envelope.eventSha256);
        }
        const existing = uniqueEvents.get(envelope.eventId);
        if (existing && existing.eventSha256 !== envelope.eventSha256) {
          return { status: 'not_evaluable', blocker: 'outcome_event_conflict' };
        }
        if (!existing) {
          uniqueEvents.set(envelope.eventId, {
            eventId: envelope.eventId,
            eventSha256: envelope.eventSha256,
            timestamp,
            normalizedTimestamp: new Date(timestamp).toISOString(),
            event: {
              ...event,
              timestamp: new Date(timestamp).toISOString(),
              metadata: { ...metadata, recommendationEventKey },
            },
          });
        }
      }
    } catch {
      return { status: 'not_evaluable', blocker: 'outcome_event_contract_invalid' };
    }

    const canonicalEvents = [...uniqueEvents.values()].sort((left, right) => (
      left.timestamp - right.timestamp || compareText(left.eventId, right.eventId)
    ));
    const eventSetSha256 = digest(canonicalEvents.map(({ eventId, eventSha256, normalizedTimestamp }) => ({
      timestamp: normalizedTimestamp,
      eventId,
      eventSha256,
    })));
    const decisionSha256 = decisionLogSha256(decision);
    const observedThrough = new Date(entry.observedThrough).toISOString();
    const outcomes: VerifiedOutcomeEvidenceActionV1[] = [];

    for (const action of decision.actions) {
      const outcome = attributeOutcomeV1({
        decisionLog: decision,
        servedAction: action,
        traceUserId: entry.traceUserId,
        events: canonicalEvents.map(({ event }) => event),
        observedThrough,
        horizonMs: parsed.data.rewardDefinition.horizonMs,
      });
      if (outcome.status !== 'observed') {
        return { status: 'not_evaluable', blocker: `outcome_action_${outcome.status}` };
      }
      const reward = calculateReward(outcome, parsed.data.rewardDefinition);
      if (!Number.isFinite(reward)) {
        return { status: 'not_evaluable', blocker: 'outcome_reward_not_finite' };
      }
      if (reward < rewardBounds.minimum || reward > rewardBounds.maximum) {
        return { status: 'not_evaluable', blocker: 'outcome_reward_out_of_bounds' };
      }
      outcomes.push({
        decisionId: decision.decisionId,
        requestId: decision.requestId,
        decisionLogSha256: decisionSha256,
        candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
        actionKey: { ...action.actionKey },
        eventSetSha256,
        reward,
        outcome,
      });
    }

    decisions.push({
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      decisionAt: decision.decisionAt,
      decisionLogSha256: decisionSha256,
      candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
      traceUserId: entry.traceUserId,
      observedThrough,
      eventSetSha256,
      outcomes,
    });
  }

  decisions.sort((left, right) => compareText(left.decisionId, right.decisionId));
  const evidencePreimage = {
    contractVersion: VERIFIED_OUTCOME_EVIDENCE_VERSION,
    resourceLimitsVersion: VERIFIED_OUTCOME_EVIDENCE_LIMITS_VERSION,
    datasetVersion: parsed.data.datasetVersion,
    rewardDefinition: parsed.data.rewardDefinition,
    rewardDefinitionSha256: outcomeRewardDefinitionSha256V1(parsed.data.rewardDefinition),
    rewardBounds,
    decisions,
  };
  const evidence = {
    ...evidencePreimage,
    outcomeEvidenceSha256: digest(evidencePreimage),
  } as VerifiedOutcomeEvidenceV1;
  Object.defineProperty(evidence, verifiedOutcomeEvidence, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  verifiedOutcomeEvidenceObjects.add(evidence);
  recursivelyFreeze(evidence);
  verifiedOutcomeEvidenceDigests.set(evidence, evidence.outcomeEvidenceSha256);
  return { status: 'verified', evidence };
}

function calculateReward(
  outcome: VerifiedObservedOutcomeV1,
  rewardDefinition: RewardDefinitionV1,
): number {
  let reward = 0;
  for (const head of BOOLEAN_REWARD_HEADS) {
    reward += rewardDefinition.weights[head] * (outcome.labels[head] ? 1 : 0);
  }
  reward += rewardDefinition.dwell.weight
    * Math.min(outcome.labels.dwellTimeMs, rewardDefinition.dwell.capMs)
    / rewardDefinition.dwell.scaleMs;
  return reward;
}

export function calculateOutcomeRewardBoundsV1(
  rewardDefinition: RewardDefinitionV1,
): { minimum: number; maximum: number } | null {
  let minimum = 0;
  let maximum = 0;
  for (const head of BOOLEAN_REWARD_HEADS) {
    const weight = rewardDefinition.weights[head];
    minimum += Math.min(0, weight);
    maximum += Math.max(0, weight);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  }
  const maximumDwellContribution = rewardDefinition.dwell.weight
    * rewardDefinition.dwell.capMs
    / rewardDefinition.dwell.scaleMs;
  minimum += Math.min(0, maximumDwellContribution);
  maximum += Math.max(0, maximumDwellContribution);
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? { minimum, maximum }
    : null;
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

type NormalizedEventEnvelope = {
  eventId: string;
  eventSha256: string;
  timestamp: number;
  normalizedTimestamp: string;
  event: Record<string, unknown>;
};

function outcomeEvidenceResourceLimitExceeded(value: unknown): boolean {
  const input = record(value);
  const decisions = input?.decisions;
  if (!Array.isArray(decisions)) return false;
  if (decisions.length > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxDecisions) return true;

  let totalActions = 0;
  let totalEvents = 0;
  let attributionChecks = 0;
  for (const rawEntry of decisions) {
    const entry = record(rawEntry);
    const decisionLog = record(entry?.decisionLog);
    const actions = decisionLog?.actions;
    const events = entry?.events;
    const actionCount = Array.isArray(actions) ? actions.length : 0;
    const eventCount = Array.isArray(events) ? events.length : 0;
    if (
      actionCount > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxActionsPerDecision
      || eventCount > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxEventsPerDecision
    ) return true;
    totalActions += actionCount;
    totalEvents += eventCount;
    attributionChecks += actionCount * eventCount;
    if (
      totalActions > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxTotalActions
      || totalEvents > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxTotalEvents
      || attributionChecks > VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxAttributionChecks
    ) return true;
  }
  return false;
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function timestampMs(value: unknown): number | null {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Date.parse(value)
        : Number.NaN;
  return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : null;
}

function normalizeEventDigestValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('event timestamp invalid');
    return value.toISOString();
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('event digest requires an acyclic value');
  seen.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => normalizeEventDigestValue(entry, seen))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      normalizeEventDigestValue(entry, seen),
    ]));
  seen.delete(value);
  return normalized;
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) {
    recursivelyFreeze(Reflect.get(value, property), seen);
  }
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
