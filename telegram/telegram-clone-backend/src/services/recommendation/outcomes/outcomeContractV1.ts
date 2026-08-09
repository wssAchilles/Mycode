import { z } from 'zod';

import { ActionType } from '../../../models/UserAction';
import {
    RecommendationDecisionLogV1,
    canonicalDecisionJson,
    decisionActionKeySchema,
    recommendationDecisionLogSchema,
} from '../decisionLog/contracts';
import { SERVED_POSITION_CONTRACT_VERSION } from '../events/positionContract';
import {
    LABEL_ACTION_TYPES,
    summarizeActionsInWindow,
} from '../utils/actionLabels';
import { OUTCOME_CONTRACT_VERSION } from './contracts';

export { OUTCOME_CONTRACT_VERSION };

const labelAvailabilitySchema = z.object({
    follow: z.literal('unavailable_in_v1'),
    mute: z.literal('unavailable_in_v1'),
}).strict();

const actionLabelsSchema = z.object({
    click: z.boolean(),
    like: z.boolean(),
    reply: z.boolean(),
    repost: z.boolean(),
    quote: z.boolean(),
    share: z.boolean(),
    dismiss: z.boolean(),
    blockAuthor: z.boolean(),
    report: z.boolean(),
    engagement: z.boolean(),
    negative: z.boolean(),
    dwellTimeMs: z.number().finite().nonnegative(),
}).strict();

const canonicalIdentityShape = {
    contractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
    decisionId: z.string().uuid(),
    actionKey: decisionActionKeySchema,
    decisionAt: z.string().datetime({ offset: true }),
    horizonMs: z.number().int().nonnegative(),
    observedThrough: z.string().datetime({ offset: true }),
    labelAvailability: labelAvailabilitySchema,
};

const invalidReasonSchema = z.enum([
    'decision_log_invalid',
    'served_action_invalid',
    'served_action_not_in_decision',
    'event_candidate_namespace_mismatch',
    'event_candidate_id_mismatch',
    'event_served_position_mismatch',
    'event_position_contract_version_mismatch',
    'event_user_id_mismatch',
    'event_request_id_mismatch',
    'event_timestamp_invalid',
    'event_timestamp_before_decision',
    'observed_through_before_decision',
]);

export const outcomeContractV1Schema = z.discriminatedUnion('status', [
    z.object({
        ...canonicalIdentityShape,
        impressionAt: z.string().datetime({ offset: true }),
        status: z.literal('observed'),
        labels: actionLabelsSchema,
    }).strict(),
    z.object({
        ...canonicalIdentityShape,
        status: z.literal('exposure_missing'),
        reason: z.literal('exact_impression_missing'),
    }).strict(),
    z.object({
        ...canonicalIdentityShape,
        impressionAt: z.string().datetime({ offset: true }),
        status: z.literal('censored'),
        reason: z.literal('observation_window_incomplete'),
    }).strict(),
    z.object({
        contractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
        decisionId: z.string().uuid().nullable(),
        actionKey: decisionActionKeySchema.nullable(),
        decisionAt: z.string().datetime({ offset: true }).nullable(),
        impressionAt: z.string().datetime({ offset: true }).optional(),
        horizonMs: z.number().int().nonnegative(),
        observedThrough: z.string().datetime({ offset: true }),
        labelAvailability: labelAvailabilitySchema,
        status: z.literal('invalid_attribution'),
        reason: invalidReasonSchema,
    }).strict(),
]);

const timestampInputSchema = z.union([z.date(), z.string(), z.number()]).transform((value, context) => {
    const timestamp = timestampMs(value);
    if (timestamp === null) {
        context.addIssue({ code: 'custom', message: 'invalid timestamp' });
        return z.NEVER;
    }
    return timestamp;
});

export const outcomeAttributionInputSchema = z.object({
    decisionLog: z.unknown(),
    servedAction: z.unknown(),
    traceUserId: z.string().trim().min(1),
    events: z.array(z.unknown()),
    observedThrough: timestampInputSchema,
    horizonMs: z.number().int().nonnegative(),
}).strict();

export type OutcomeContractV1 = z.infer<typeof outcomeContractV1Schema>;
export type OutcomeAttributionInput = z.input<typeof outcomeAttributionInputSchema>;
type DecisionAction = RecommendationDecisionLogV1['actions'][number];
type DecisionActionKey = DecisionAction['actionKey'];
type InvalidReason = z.infer<typeof invalidReasonSchema>;

export type ValidatedOutcomeAttributionInputV1 = {
    decision: {
        decisionId: string;
        requestId: string;
        decisionAt: string;
        actionKeys: DecisionActionKey[];
    };
    actionKey: DecisionActionKey;
    traceUserId: string;
    events: unknown[];
    observedThroughMs: number;
    horizonMs: number;
};

const LABEL_ACTION_TYPE_SET = new Set<string>(LABEL_ACTION_TYPES);
const LABEL_AVAILABILITY = {
    follow: 'unavailable_in_v1',
    mute: 'unavailable_in_v1',
} as const;

const EVENT_REASON_PRIORITY: readonly InvalidReason[] = [
    'event_candidate_namespace_mismatch',
    'event_candidate_id_mismatch',
    'event_served_position_mismatch',
    'event_position_contract_version_mismatch',
    'event_user_id_mismatch',
    'event_request_id_mismatch',
    'event_timestamp_invalid',
    'event_timestamp_before_decision',
];

export function attributeOutcomeV1(input: OutcomeAttributionInput): OutcomeContractV1 {
    const parsedInput = outcomeAttributionInputSchema.parse(input);
    const observedThrough = new Date(parsedInput.observedThrough).toISOString();
    const decisionResult = recommendationDecisionLogSchema.safeParse(parsedInput.decisionLog);
    const actionKeyResult = extractActionKey(parsedInput.servedAction);

    if (!decisionResult.success) {
        return invalidOutcome({
            decisionLog: parsedInput.decisionLog,
            actionKey: actionKeyResult.success ? actionKeyResult.data : null,
            observedThrough,
            horizonMs: parsedInput.horizonMs,
            reason: 'decision_log_invalid',
        });
    }

    const decision = decisionResult.data;
    if (!actionKeyResult.success) {
        return invalidOutcome({
            decisionLog: decision,
            actionKey: null,
            observedThrough,
            horizonMs: parsedInput.horizonMs,
            reason: 'served_action_invalid',
        });
    }

    const actionKey = actionKeyResult.data;
    const canonicalAction = decision.actions.find((action) => keysEqual(action.actionKey, actionKey));
    if (!canonicalAction) {
        return invalidOutcome({
            decisionLog: decision,
            actionKey,
            observedThrough,
            horizonMs: parsedInput.horizonMs,
            reason: 'served_action_not_in_decision',
        });
    }
    if (!servedActionIsCanonical(parsedInput.servedAction, canonicalAction)) {
        return invalidOutcome({
            decisionLog: decision,
            actionKey,
            observedThrough,
            horizonMs: parsedInput.horizonMs,
            reason: 'served_action_invalid',
        });
    }

    return attributeValidatedOutcomeCoreV1({
        decision: {
            decisionId: decision.decisionId,
            requestId: decision.requestId,
            decisionAt: decision.decisionAt,
            actionKeys: decision.actions.map((action) => action.actionKey),
        },
        actionKey,
        traceUserId: parsedInput.traceUserId,
        events: parsedInput.events,
        observedThroughMs: parsedInput.observedThrough,
        horizonMs: parsedInput.horizonMs,
    });
}

export function attributeValidatedOutcomeCoreV1(
    input: ValidatedOutcomeAttributionInputV1,
): OutcomeContractV1 {
    const observedThrough = new Date(input.observedThroughMs).toISOString();
    const { decision, actionKey } = input;

    const decisionAtMs = timestampMs(decision.decisionAt)!;
    if (input.observedThroughMs < decisionAtMs) {
        return invalidOutcome({
            decisionLog: decision,
            actionKey,
            observedThrough,
            horizonMs: input.horizonMs,
            reason: 'observed_through_before_decision',
        });
    }
    const exactEvents: Array<{
        action: string;
        timestamp: number;
        dwellTimeMs?: number;
    }> = [];
    const invalidReasons = new Set<InvalidReason>();

    for (const rawEvent of input.events) {
        const event = record(rawEvent);
        if (!event || !isOutcomeAction(event.action)) continue;
        const metadata = record(event.metadata);
        if (metadata?.decisionId !== decision.decisionId) continue;

        const eventKey = {
            candidateNamespace: metadata.candidateNamespace,
            candidateId: metadata.candidateId,
            servedPosition: event.rank,
        };
        if (!keysEqual(eventKey, actionKey)) {
            const isSiblingAction = decision.actionKeys.some((sibling) => keysEqual(eventKey, sibling));
            if (isSiblingAction) continue;
            addKeyMismatchReason(invalidReasons, eventKey, actionKey);
            continue;
        }
        if (metadata.positionContractVersion !== SERVED_POSITION_CONTRACT_VERSION) {
            invalidReasons.add('event_position_contract_version_mismatch');
            continue;
        }
        if (event.userId !== input.traceUserId) {
            invalidReasons.add('event_user_id_mismatch');
            continue;
        }
        if (event.requestId !== decision.requestId) {
            invalidReasons.add('event_request_id_mismatch');
            continue;
        }

        const eventAtMs = timestampMs(event.timestamp);
        if (eventAtMs === null) {
            invalidReasons.add('event_timestamp_invalid');
            continue;
        }
        if (eventAtMs < decisionAtMs) {
            invalidReasons.add('event_timestamp_before_decision');
            continue;
        }
        if (eventAtMs > input.observedThroughMs) continue;

        exactEvents.push({
            action: String(event.action),
            timestamp: eventAtMs,
            dwellTimeMs: finiteNonnegative(event.dwellTimeMs),
        });
    }

    const impressionAtMs = exactEvents
        .filter((event) => event.action === ActionType.IMPRESSION)
        .reduce<number | null>(
            (earliest, event) => earliest === null || event.timestamp < earliest
                ? event.timestamp
                : earliest,
            null,
        );
    const invalidReason = EVENT_REASON_PRIORITY.find((reason) => invalidReasons.has(reason));
    if (invalidReason) {
        return invalidOutcome({
            decisionLog: decision,
            actionKey,
            impressionAt: impressionAtMs === null ? undefined : new Date(impressionAtMs).toISOString(),
            observedThrough,
            horizonMs: input.horizonMs,
            reason: invalidReason,
        });
    }

    const base = {
        contractVersion: OUTCOME_CONTRACT_VERSION,
        decisionId: decision.decisionId,
        actionKey,
        decisionAt: decision.decisionAt,
        horizonMs: input.horizonMs,
        observedThrough,
        labelAvailability: LABEL_AVAILABILITY,
    } as const;
    if (impressionAtMs === null) {
        return {
            ...base,
            status: 'exposure_missing',
            reason: 'exact_impression_missing',
        };
    }

    const impressionAt = new Date(impressionAtMs).toISOString();
    const horizonEndMs = impressionAtMs + input.horizonMs;
    if (input.observedThroughMs < horizonEndMs) {
        return {
            ...base,
            impressionAt,
            status: 'censored',
            reason: 'observation_window_incomplete',
        };
    }

    const actionsInWindow = exactEvents.filter((event) => (
        LABEL_ACTION_TYPE_SET.has(event.action)
        && event.timestamp > impressionAtMs
        && event.timestamp <= horizonEndMs
    ));
    return {
        ...base,
        impressionAt,
        status: 'observed',
        labels: summarizeActionsInWindow(impressionAtMs, actionsInWindow, input.horizonMs),
    };
}

function extractActionKey(value: unknown) {
    const direct = decisionActionKeySchema.safeParse(value);
    if (direct.success) return direct;
    return decisionActionKeySchema.safeParse(record(value)?.actionKey);
}

function servedActionIsCanonical(value: unknown, canonicalAction: DecisionAction): boolean {
    if (decisionActionKeySchema.safeParse(value).success) return true;
    try {
        return canonicalDecisionJson(value) === canonicalDecisionJson(canonicalAction);
    } catch {
        return false;
    }
}

function keysEqual(
    left: Record<string, unknown> | DecisionActionKey,
    right: DecisionActionKey,
): boolean {
    return left.candidateNamespace === right.candidateNamespace
        && left.candidateId === right.candidateId
        && left.servedPosition === right.servedPosition;
}

function addKeyMismatchReason(
    reasons: Set<InvalidReason>,
    eventKey: Record<string, unknown>,
    actionKey: DecisionActionKey,
): void {
    if (eventKey.candidateNamespace !== actionKey.candidateNamespace) {
        reasons.add('event_candidate_namespace_mismatch');
    }
    if (eventKey.candidateId !== actionKey.candidateId) {
        reasons.add('event_candidate_id_mismatch');
    }
    if (eventKey.servedPosition !== actionKey.servedPosition) {
        reasons.add('event_served_position_mismatch');
    }
}

function invalidOutcome(input: {
    decisionLog: unknown;
    actionKey: DecisionActionKey | null;
    impressionAt?: string;
    observedThrough: string;
    horizonMs: number;
    reason: InvalidReason;
}): OutcomeContractV1 {
    const decision = record(input.decisionLog);
    const decisionId = z.string().uuid().safeParse(decision?.decisionId);
    const decisionAt = z.string().datetime({ offset: true }).safeParse(decision?.decisionAt);
    return {
        contractVersion: OUTCOME_CONTRACT_VERSION,
        decisionId: decisionId.success ? decisionId.data : null,
        actionKey: input.actionKey,
        decisionAt: decisionAt.success ? decisionAt.data : null,
        ...(input.impressionAt ? { impressionAt: input.impressionAt } : {}),
        horizonMs: input.horizonMs,
        observedThrough: input.observedThrough,
        labelAvailability: LABEL_AVAILABILITY,
        status: 'invalid_attribution',
        reason: input.reason,
    };
}

function isOutcomeAction(value: unknown): boolean {
    return value === ActionType.IMPRESSION || LABEL_ACTION_TYPE_SET.has(String(value));
}

function finiteNonnegative(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
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
