import { readFileSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { describe, expect, it } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import { canonicalDecisionJson, recommendationDecisionLogSchema } from '../../src/services/recommendation/decisionLog/contracts';
import { DECISION_CONTEXT_LIMITS } from '../../src/services/recommendation/decisionContext/contracts';
import { decisionContextEvidenceSha256V1, verifyDecisionContextEvidenceV1 } from '../../src/services/recommendation/decisionContext/verify';
import {
    OUTCOME_CONTRACT_VERSION,
    attributeOutcomeV1,
    outcomeContractV1Schema,
} from '../../src/services/recommendation/outcomes/outcomeContractV1';
import {
    isVerifiedOutcomeEvidenceV1,
    outcomeEvidenceSha256V1,
    outcomeEventSha256V1,
    VERIFIED_OUTCOME_EVIDENCE_LIMITS,
    verifyOutcomeEvidenceV1,
} from '../../src/services/recommendation/outcomes/verifiedOutcomeEvidenceV1';

const fixture = JSON.parse(readFileSync(path.resolve(
    __dirname,
    '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
), 'utf8'));

const decision = recommendationDecisionLogSchema.parse(fixture.decisionLog);
const servedAction = decision.actions[0];
const userId = 'trace-user';

function event(
    action: ActionType,
    timestamp: string,
    overrides: Record<string, unknown> = {},
) {
    return {
        userId,
        requestId: decision.requestId,
        action,
        rank: servedAction.actionKey.servedPosition,
        timestamp,
        dwellTimeMs: action === ActionType.DWELL ? 750 : undefined,
        metadata: {
            decisionId: decision.decisionId,
            candidateNamespace: servedAction.actionKey.candidateNamespace,
            candidateId: servedAction.actionKey.candidateId,
            positionContractVersion: decision.positionContractVersion,
        },
        ...overrides,
    };
}

const rewardDefinition = {
    objective: 'engagement',
    definitionVersion: 'engagement-v1',
    horizonMs: 60_000,
    weights: {
        click: 2,
        like: 0,
        reply: 0,
        repost: 0,
        quote: 0,
        share: 0,
        dismiss: -3,
        blockAuthor: 0,
        report: 0,
    },
    dwell: { weight: -2, capMs: 1_000, scaleMs: 1_000 },
};

function envelope(eventId: string, value: unknown) {
    const source = value as Record<string, any>;
    const keyedEvent = {
        ...source,
        metadata: { ...(source.metadata ?? {}), recommendationEventKey: eventId },
    };
    return { eventId, eventSha256: outcomeEventSha256V1(keyedEvent), event: keyedEvent };
}

function rawEnvelope(eventId: string, value: unknown) {
    return { eventId, eventSha256: outcomeEventSha256V1(value), event: value };
}

function evidenceInput(events: Array<ReturnType<typeof envelope>>, observedThrough = '2026-07-16T08:01:05.000Z') {
    return {
        datasetVersion: 'outcome-dataset-v1',
        rewardDefinition,
        decisions: [{ decisionLog: decision, traceUserId: userId, observedThrough, events }],
    };
}

describe('outcome_contract_v1', () => {
    it('attributes labels only through the exact decision action key', () => {
        const outcome = attributeOutcomeV1({
            decisionLog: decision,
            servedAction,
            traceUserId: userId,
            events: [
                {
                    userId,
                    action: ActionType.LIKE,
                    targetPostId: servedAction.actionKey.candidateId,
                    timestamp: '2026-07-16T08:00:03.000Z',
                },
                event(ActionType.LIKE, '2026-07-16T08:00:04.000Z', {
                    metadata: {
                        decisionId: 'de51b7de-dd3d-4e34-8e37-55028fb13083',
                        candidateNamespace: servedAction.actionKey.candidateNamespace,
                        candidateId: servedAction.actionKey.candidateId,
                        positionContractVersion: decision.positionContractVersion,
                    },
                }),
                event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z'),
                event(ActionType.CLICK, '2026-07-16T08:00:06.000Z'),
            ],
            observedThrough: '2026-07-16T08:01:05.000Z',
            horizonMs: 60_000,
        });

        expect(outcomeContractV1Schema.parse(outcome)).toEqual(outcome);
        expect(outcome).toMatchObject({
            contractVersion: OUTCOME_CONTRACT_VERSION,
            decisionId: decision.decisionId,
            actionKey: servedAction.actionKey,
            decisionAt: decision.decisionAt,
            impressionAt: '2026-07-16T08:00:05.000Z',
            horizonMs: 60_000,
            observedThrough: '2026-07-16T08:01:05.000Z',
            status: 'observed',
            labelAvailability: {
                follow: 'unavailable_in_v1',
                mute: 'unavailable_in_v1',
            },
            labels: {
                click: true,
                like: false,
            },
        });
    });

    it('uses the earliest duplicate impression and an open-left closed-right reward window', () => {
        const outcome = attributeOutcomeV1({
            decisionLog: decision,
            servedAction,
            traceUserId: userId,
            events: [
                event(ActionType.IMPRESSION, '2026-07-16T08:00:10.000Z'),
                event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z'),
                event(ActionType.CLICK, '2026-07-16T08:00:05.000Z'),
                event(ActionType.LIKE, '2026-07-16T08:01:05.000Z'),
                event(ActionType.REPLY, '2026-07-16T08:01:05.001Z'),
            ],
            observedThrough: '2026-07-16T08:01:05.000Z',
            horizonMs: 60_000,
        });

        expect(outcome).toMatchObject({
            status: 'observed',
            impressionAt: '2026-07-16T08:00:05.000Z',
            labels: {
                click: false,
                like: true,
                reply: false,
            },
        });
    });

    it('omits labels when exposure is missing or the reward window is censored', () => {
        const base = {
            decisionLog: decision,
            servedAction,
            traceUserId: userId,
            horizonMs: 60_000,
        };
        const exposureMissing = attributeOutcomeV1({
            ...base,
            events: [event(ActionType.CLICK, '2026-07-16T08:00:06.000Z')],
            observedThrough: '2026-07-16T08:01:05.000Z',
        });
        const censored = attributeOutcomeV1({
            ...base,
            events: [
                event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z'),
                event(ActionType.LIKE, '2026-07-16T08:00:06.000Z'),
            ],
            observedThrough: '2026-07-16T08:01:04.999Z',
        });

        expect(exposureMissing).toMatchObject({
            status: 'exposure_missing',
            reason: 'exact_impression_missing',
        });
        expect(censored).toMatchObject({
            status: 'censored',
            reason: 'observation_window_incomplete',
            impressionAt: '2026-07-16T08:00:05.000Z',
        });
        expect(exposureMissing).not.toHaveProperty('labels');
        expect(censored).not.toHaveProperty('labels');
    });

    it('fails closed when observation ends before the decision', () => {
        const outcome = attributeOutcomeV1({
            decisionLog: decision,
            servedAction,
            traceUserId: userId,
            events: [],
            observedThrough: '2026-07-16T07:59:59.999Z',
            horizonMs: 60_000,
        });

        expect(outcome).toMatchObject({
            status: 'invalid_attribution',
            reason: 'observed_through_before_decision',
        });
        expect(outcome).not.toHaveProperty('labels');
    });

    it.each([
        ['namespace', {
            metadata: {
                decisionId: decision.decisionId,
                candidateNamespace: 'model_post_id',
                candidateId: servedAction.actionKey.candidateId,
                positionContractVersion: decision.positionContractVersion,
            },
        }, 'event_candidate_namespace_mismatch'],
        ['position', { rank: 2 }, 'event_served_position_mismatch'],
        ['position contract version', {
            metadata: {
                decisionId: decision.decisionId,
                candidateNamespace: servedAction.actionKey.candidateNamespace,
                candidateId: servedAction.actionKey.candidateId,
                positionContractVersion: 'forged_version',
            },
        }, 'event_position_contract_version_mismatch'],
        ['candidate and position', {
            rank: servedAction.actionKey.servedPosition + 1,
            metadata: {
                decisionId: decision.decisionId,
                candidateNamespace: servedAction.actionKey.candidateNamespace,
                candidateId: 'non-canonical-candidate',
                positionContractVersion: decision.positionContractVersion,
            },
        }, 'event_candidate_id_mismatch'],
        ['request', { requestId: 'e3a45531-5f24-4682-873b-370def744858' }, 'event_request_id_mismatch'],
        ['user', { userId: 'other-user' }, 'event_user_id_mismatch'],
        ['timestamp', { timestamp: 'not-a-timestamp' }, 'event_timestamp_invalid'],
    ])('fails closed on a contradictory %s claim', (_name, override, reason) => {
        const outcome = attributeOutcomeV1({
            decisionLog: decision,
            servedAction,
            traceUserId: userId,
            events: [
                event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z'),
                event(ActionType.CLICK, '2026-07-16T08:00:06.000Z', override),
            ],
            observedThrough: '2026-07-16T08:01:05.000Z',
            horizonMs: 60_000,
        });

        expect(outcome).toMatchObject({
            status: 'invalid_attribution',
            reason,
            impressionAt: '2026-07-16T08:00:05.000Z',
        });
        expect(outcome).not.toHaveProperty('labels');
    });

    it('returns invalid attribution for malformed canonical decision or action input', () => {
        const base = {
            traceUserId: userId,
            events: [],
            observedThrough: '2026-07-16T08:01:05.000Z',
            horizonMs: 60_000,
        };
        const invalidDecision = attributeOutcomeV1({
            ...base,
            decisionLog: { ...decision, decisionAt: 'not-a-timestamp' },
            servedAction,
        });
        const invalidAction = attributeOutcomeV1({
            ...base,
            decisionLog: decision,
            servedAction: { ...servedAction, selectionRank: 2 },
        });

        expect(invalidDecision).toMatchObject({
            status: 'invalid_attribution',
            reason: 'decision_log_invalid',
        });
        expect(invalidAction).toMatchObject({
            status: 'invalid_attribution',
            reason: 'served_action_invalid',
        });
        expect(invalidDecision).not.toHaveProperty('labels');
        expect(invalidAction).not.toHaveProperty('labels');
    });
});

describe('verified_outcome_evidence_v1', () => {
    const observedEvents = () => [
        envelope('impression', event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z')),
        envelope('click', event(ActionType.CLICK, '2026-07-16T08:00:06.000Z')),
        envelope('dwell', event(ActionType.DWELL, '2026-07-16T08:00:07.000Z')),
    ];

    it('replays every action, derives the bound reward, and recursively freezes evidence', () => {
        const result = verifyOutcomeEvidenceV1(evidenceInput(observedEvents()));

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') return;
        expect(result.evidence.resourceLimitsVersion).toBe('verified_outcome_evidence_limits_v1');
        expect(result.evidence.outcomeEvidenceSha256).toBe(outcomeEvidenceSha256V1(result.evidence));
        expect(result.evidence.rewardBounds).toEqual({ minimum: -5, maximum: 2 });
        expect(result.evidence.decisions[0]?.outcomes[0]).toMatchObject({
            decisionId: decision.decisionId,
            requestId: decision.requestId,
            candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
            actionKey: servedAction.actionKey,
            reward: 0.5,
            outcome: { status: 'observed' },
        });
        expect(Object.isFrozen(result.evidence)).toBe(true);
        expect(Object.isFrozen(result.evidence.decisions[0]?.outcomes[0]?.outcome.labels)).toBe(true);
        expect(isVerifiedOutcomeEvidenceV1(result.evidence)).toBe(true);
        expect(isVerifiedOutcomeEvidenceV1(structuredClone(result.evidence))).toBe(false);
    });

    it('deduplicates an identical event envelope idempotently', () => {
        const events = observedEvents();
        const baseline = verifyOutcomeEvidenceV1(evidenceInput(events));
        const duplicate = verifyOutcomeEvidenceV1(evidenceInput([...events, { ...events[1]! }]));

        expect(baseline.status).toBe('verified');
        expect(duplicate.status).toBe('verified');
        if (baseline.status !== 'verified' || duplicate.status !== 'verified') return;
        expect(duplicate.evidence.decisions[0]?.eventSetSha256)
            .toBe(baseline.evidence.decisions[0]?.eventSetSha256);
        expect(duplicate.evidence.decisions[0]?.outcomes[0]?.reward).toBe(0.5);
    });

    it('fails closed on one event id with different valid digests', () => {
        const events = observedEvents();
        const conflicting = event(ActionType.LIKE, '2026-07-16T08:00:08.000Z');
        const result = verifyOutcomeEvidenceV1(evidenceInput([
            ...events,
            envelope(events[1]!.eventId, conflicting),
        ]));

        expect(result).toEqual({ status: 'not_evaluable', blocker: 'outcome_event_conflict' });
    });

    it('fails closed when one event id has different digests across decisions', () => {
        const secondDecision = recommendationDecisionLogSchema.parse({
            ...decision,
            requestId: '00000000-0000-4000-8000-000000000021',
            decisionId: '00000000-0000-4000-8000-000000000022',
        });
        const secondAction = secondDecision.actions[0]!;
        const secondEvent = (action: ActionType, timestamp: string) => event(action, timestamp, {
            requestId: secondDecision.requestId,
            metadata: {
                decisionId: secondDecision.decisionId,
                candidateNamespace: secondAction.actionKey.candidateNamespace,
                candidateId: secondAction.actionKey.candidateId,
                positionContractVersion: secondDecision.positionContractVersion,
            },
        });
        const result = verifyOutcomeEvidenceV1({
            ...evidenceInput(observedEvents()),
            decisions: [
                evidenceInput(observedEvents()).decisions[0],
                {
                    decisionLog: secondDecision,
                    traceUserId: userId,
                    observedThrough: '2026-07-16T08:01:05.000Z',
                    events: [
                        envelope('second-impression', secondEvent(
                            ActionType.IMPRESSION,
                            '2026-07-16T08:00:05.000Z',
                        )),
                        envelope('click', secondEvent(ActionType.CLICK, '2026-07-16T08:00:06.000Z')),
                        envelope('second-dwell', secondEvent(
                            ActionType.DWELL,
                            '2026-07-16T08:00:07.000Z',
                        )),
                    ],
                },
            ],
        });

        expect(result).toEqual({ status: 'not_evaluable', blocker: 'outcome_event_conflict' });
    });

    it('requires the embedded recommendation event key to exist and exactly match the envelope', () => {
        const missing = event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z');
        const keyed = envelope('embedded-key', missing);

        expect(verifyOutcomeEvidenceV1(evidenceInput([
            rawEnvelope('missing-key', missing),
        ]))).toEqual({ status: 'not_evaluable', blocker: 'outcome_event_identity_missing' });
        expect(verifyOutcomeEvidenceV1(evidenceInput([
            { ...keyed, eventId: 'different-envelope-key' },
        ]))).toEqual({ status: 'not_evaluable', blocker: 'outcome_event_identity_mismatch' });
    });

    it('canonicalizes the event set by normalized timestamp then UTF-8 event id', () => {
        const events = [
            envelope('z-like', event(ActionType.LIKE, '2026-07-16T08:00:06.000Z')),
            envelope('impression', event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z')),
            envelope('a-click', event(ActionType.CLICK, '2026-07-16T08:00:06.000Z')),
            envelope('dwell', event(ActionType.DWELL, '2026-07-16T08:00:07.000Z')),
        ];
        const forward = verifyOutcomeEvidenceV1(evidenceInput(events));
        const reversed = verifyOutcomeEvidenceV1(evidenceInput([...events].reverse()));
        expect(forward.status).toBe('verified');
        expect(reversed.status).toBe('verified');
        if (forward.status !== 'verified' || reversed.status !== 'verified') return;

        const expectedOrder = [...events].sort((left, right) => (
            Date.parse((left.event as { timestamp: string }).timestamp)
            - Date.parse((right.event as { timestamp: string }).timestamp)
            || Buffer.compare(Buffer.from(left.eventId), Buffer.from(right.eventId))
        ));
        const expectedDigest = createHash('sha256').update(canonicalDecisionJson(expectedOrder
            .map((entry) => ({
                timestamp: new Date((entry.event as { timestamp: string }).timestamp).toISOString(),
                eventId: entry.eventId,
                eventSha256: entry.eventSha256,
            })))).digest('hex');
        expect(forward.evidence.decisions[0]?.eventSetSha256).toBe(expectedDigest);
        expect(reversed.evidence.decisions[0]?.eventSetSha256).toBe(expectedDigest);
    });

    it('rejects structural replay work above the versioned evidence cap', () => {
        const oneEvent = observedEvents()[0]!;
        const events = Array.from(
            { length: VERIFIED_OUTCOME_EVIDENCE_LIMITS.maxEventsPerDecision + 1 },
            () => oneEvent,
        );

        expect(verifyOutcomeEvidenceV1(evidenceInput(events))).toEqual({
            status: 'not_evaluable',
            blocker: 'resource_limit_exceeded',
        });
    });

    it('blocks the whole set when any action is censored', () => {
        const result = verifyOutcomeEvidenceV1(evidenceInput(
            observedEvents(),
            '2026-07-16T08:01:04.999Z',
        ));

        expect(result).toEqual({ status: 'not_evaluable', blocker: 'outcome_action_censored' });
    });

    it('cannot consume a substituted candidate outcome at the same served position', () => {
        const substituted = event(ActionType.CLICK, '2026-07-16T08:00:06.000Z', {
            metadata: {
                decisionId: decision.decisionId,
                candidateNamespace: decision.candidatePool.candidates[1]!.candidateNamespace,
                candidateId: decision.candidatePool.candidates[1]!.candidateId,
                positionContractVersion: decision.positionContractVersion,
            },
        });
        const result = verifyOutcomeEvidenceV1(evidenceInput([
            envelope('impression', event(ActionType.IMPRESSION, '2026-07-16T08:00:05.000Z')),
            envelope('substituted-click', substituted),
        ]));

        expect(result).toEqual({
            status: 'not_evaluable',
            blocker: 'outcome_action_invalid_attribution',
        });
    });
});

describe('verified_decision_context_evidence_v1', () => {
    const contextEntry = {
        decisionLog: decision,
        contextAt: '2026-07-16T07:59:58.000Z',
        availableAt: '2026-07-16T07:59:59.000Z',
        sourceSha256: '7'.repeat(64),
        sourceVersion: 'context-source-v1',
        segments: { tier: 'gold', country: 'US' },
    };

    it.each([
        {
            subject: { kind: 'viewer' as const, viewerAccountPseudonym: userId },
            inferenceClusterId: 'opaque-viewer-cluster',
            clusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
            realDatasetEligible: true,
        },
        {
            subject: { kind: 'synthetic_cluster' as const, syntheticViewerId: 'synthetic-viewer' },
            inferenceClusterId: 'independent-synthetic-decision',
            clusterUnitVersion: 'independent_decision_synthetic_v1' as const,
            realDatasetEligible: false,
        },
    ])('binds and canonicalizes the $subject.kind subject contract', (binding) => {
        const result = verifyDecisionContextEvidenceV1({
            datasetVersion: 'outcome-dataset-v1',
            crossUserDependence: { status: 'none_observed_in_verified_source_v1' },
            decisions: [{ ...contextEntry, ...binding }],
        });

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') return;
        expect(result.evidence.decisions[0]).toMatchObject({
            datasetVersion: 'outcome-dataset-v1',
            decisionId: decision.decisionId,
            requestId: decision.requestId,
            candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
            ...binding,
        });
        expect(Object.keys(result.evidence.decisions[0]!.segments)).toEqual(['country', 'tier']);
        expect(result.evidence.decisionContextEvidenceSha256)
            .toBe(decisionContextEvidenceSha256V1(result.evidence));
    });

    it('fails closed when availability is after the decision', () => {
        const result = verifyDecisionContextEvidenceV1({
            datasetVersion: 'outcome-dataset-v1',
            crossUserDependence: { status: 'none_observed_in_verified_source_v1' },
            decisions: [{
                ...contextEntry,
                subject: { kind: 'viewer', viewerAccountPseudonym: userId },
                inferenceClusterId: 'opaque-viewer-cluster',
                clusterUnitVersion: 'viewer_account_pseudonym_v1',
                realDatasetEligible: true,
                availableAt: '2026-07-16T08:00:00.001Z',
            }],
        });

        expect(result).toEqual({
            status: 'not_evaluable',
            blocker: 'decision_context_point_in_time_violation',
        });
    });

    it('fails closed on unhandled cross-user time shocks', () => {
        const result = verifyDecisionContextEvidenceV1({
            datasetVersion: 'outcome-dataset-v1',
            crossUserDependence: { status: 'unhandled_time_shock_v1' },
            decisions: [{
                ...contextEntry,
                subject: { kind: 'viewer', viewerAccountPseudonym: userId },
                inferenceClusterId: 'opaque-viewer-cluster',
                clusterUnitVersion: 'viewer_account_pseudonym_v1',
                realDatasetEligible: true,
            }],
        });

        expect(result).toEqual({
            status: 'not_evaluable',
            blocker: 'multiway_cluster_inference_unavailable',
        });
    });

    it('does not brand plain randomized propensity as verified context evidence', () => {
        const randomizedDecision = structuredClone(decision);
        randomizedDecision.behaviorPolicyKind = 'logged_randomized';
        randomizedDecision.actions = randomizedDecision.actions.map((action) => ({
            ...action,
            behaviorPropensity: {
                status: 'logged_randomized' as const,
                selectionProbability: 0.5,
            },
        }));

        expect(verifyDecisionContextEvidenceV1({
            datasetVersion: 'outcome-dataset-v1',
            crossUserDependence: { status: 'none_observed_in_verified_source_v1' },
            decisions: [{
                ...contextEntry,
                decisionLog: randomizedDecision,
                subject: { kind: 'viewer', viewerAccountPseudonym: userId },
                inferenceClusterId: 'opaque-viewer-cluster',
                clusterUnitVersion: 'viewer_account_pseudonym_v1',
                realDatasetEligible: true,
            }],
        })).toEqual({
            status: 'not_evaluable',
            blocker: 'randomized_decision_log_unverified',
        });
    });

    it('enforces a one-to-one viewer pseudonym to opaque inference cluster mapping', () => {
        const secondDecision = recommendationDecisionLogSchema.parse({
            ...decision,
            requestId: '00000000-0000-4000-8000-000000000011',
            decisionId: '00000000-0000-4000-8000-000000000012',
        });
        const viewerBinding = {
            subject: { kind: 'viewer' as const, viewerAccountPseudonym: userId },
            inferenceClusterId: 'opaque-viewer-cluster',
            clusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
            realDatasetEligible: true,
        };
        const base = {
            datasetVersion: 'outcome-dataset-v1',
            crossUserDependence: { status: 'none_observed_in_verified_source_v1' as const },
            decisions: [
                { ...contextEntry, ...viewerBinding },
                { ...contextEntry, ...viewerBinding, decisionLog: secondDecision },
            ],
        };

        expect(verifyDecisionContextEvidenceV1(base).status).toBe('verified');
        expect(verifyDecisionContextEvidenceV1({
            ...base,
            decisions: [base.decisions[0], {
                ...base.decisions[1],
                inferenceClusterId: 'different-opaque-cluster',
            }],
        })).toEqual({
            status: 'not_evaluable',
            blocker: 'decision_context_cluster_mapping_mismatch',
        });
    });

    it('rejects context cohorts above the versioned decision cap before parsing members', () => {
        const decisions = Array.from(
            { length: DECISION_CONTEXT_LIMITS.maxDecisions + 1 },
            () => contextEntry,
        );

        expect(verifyDecisionContextEvidenceV1({ decisions })).toEqual({
            status: 'not_evaluable',
            blocker: 'resource_limit_exceeded',
        });
    });
});
