import { describe, expect, it } from 'vitest';

import {
    candidatePoolSha256,
    decisionLogSha256,
    recommendationDecisionLogSchema,
    type RecommendationDecisionLogV1,
} from '../../src/services/recommendation/decisionLog/contracts';
import type { OutcomeContractV1 } from '../../src/services/recommendation/outcomes/outcomeContractV1';
import type { OpeEvaluationInputV1 } from '../../src/services/recommendation/ope/contracts';
import { evaluateOpeV1 } from '../../src/services/recommendation/ope/evaluate';

const HORIZON_MS = 60_000;
const VERSION = {
    pipeline: 'pipeline-v1',
    strategy: 'strategy-v1',
    policy: 'behavior-policy-v1',
    graph: 'graph-v1',
    model: 'model-v1',
    artifact: 'artifact-v1',
    index: 'index-v1',
} as const;
const DECISION_IDS = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
] as const;
const REQUEST_IDS = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
] as const;

function actionKey(candidateId: string, servedPosition = 1) {
    return {
        candidateNamespace: 'serving_post_id' as const,
        candidateId,
        servedPosition,
    };
}

function expectAllNumbersFinite(value: unknown): void {
    if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(expectAllNumbersFinite);
        return;
    }
    if (value && typeof value === 'object') {
        Object.values(value).forEach(expectAllNumbersFinite);
    }
}

function buildDecision(input: {
    index: number;
    loggedCandidateId: string;
    behaviorProbability: number;
    servedPosition?: number;
}): RecommendationDecisionLogV1 {
    const servedPosition = input.servedPosition ?? 1;
    const candidateIds = [`candidate-${input.index}-a`, `candidate-${input.index}-b`];
    const candidates = candidateIds.map((candidateId, index) => {
        const served = candidateId === input.loggedCandidateId;
        return {
            candidateNamespace: 'serving_post_id' as const,
            candidateId,
            poolRank: index + 1,
            eligible: true,
            score: 1 - index / 10,
            selected: served,
            selectionRank: served ? 1 : null,
            served,
            servedPosition: served ? servedPosition : null,
            objectiveEvidence: [],
        };
    });
    const decision = {
        contractVersion: 'recommendation_decision_log_v1' as const,
        positionContractVersion: 'served_position_1_based_v1' as const,
        requestId: REQUEST_IDS[input.index],
        decisionId: DECISION_IDS[input.index],
        decisionAt: `2026-07-16T08:0${input.index}:00.000Z`,
        servingOwner: 'rust' as const,
        fallbackReason: null,
        behaviorPolicyKind: 'logged_randomized' as const,
        behaviorPolicy: {
            policyId: 'behavior-v1',
            policyVersion: { status: 'bound' as const, version: VERSION.policy },
        },
        versions: Object.fromEntries(Object.entries(VERSION).map(([key, version]) => [
            key,
            { status: 'bound' as const, version },
        ])) as RecommendationDecisionLogV1['versions'],
        candidatePool: {
            supportEvidence: { status: 'complete' as const },
            totalCount: candidates.length,
            truncated: false,
            candidates,
            candidatePoolSha256: candidatePoolSha256(candidates),
        },
        actions: [{
            actionKey: actionKey(input.loggedCandidateId, servedPosition),
            selectionRank: 1,
            behaviorPropensity: {
                status: 'logged_randomized' as const,
                selectionProbability: input.behaviorProbability,
            },
        }],
    };
    return recommendationDecisionLogSchema.parse(decision);
}

function observedOutcome(
    decision: RecommendationDecisionLogV1,
    click: boolean,
    action = decision.actions[0],
): OutcomeContractV1 {
    const decisionAt = Date.parse(decision.decisionAt);
    const impressionAt = decisionAt + 1_000;
    return {
        contractVersion: 'outcome_contract_v1',
        decisionId: decision.decisionId,
        actionKey: action.actionKey,
        decisionAt: decision.decisionAt,
        impressionAt: new Date(impressionAt).toISOString(),
        horizonMs: HORIZON_MS,
        observedThrough: new Date(impressionAt + HORIZON_MS).toISOString(),
        labelAvailability: {
            follow: 'unavailable_in_v1',
            mute: 'unavailable_in_v1',
        },
        status: 'observed',
        labels: {
            click,
            like: false,
            reply: false,
            repost: false,
            quote: false,
            share: false,
            dismiss: false,
            blockAuthor: false,
            report: false,
            engagement: click,
            negative: false,
            dwellTimeMs: 0,
        },
    };
}

function buildObservation(input: {
    index: number;
    behaviorProbability: number;
    loggedTargetProbability: number;
    reward: number;
    loggedQHat: number;
    otherQHat: number;
}) {
    const candidateIds = [`candidate-${input.index}-a`, `candidate-${input.index}-b`];
    const loggedCandidateId = candidateIds[input.index];
    const otherCandidateId = candidateIds[1 - input.index];
    const decisionLog = buildDecision({
        index: input.index,
        loggedCandidateId,
        behaviorProbability: input.behaviorProbability,
    });
    const digest = decisionLogSha256(decisionLog);
    const loggedAction = decisionLog.actions[0];
    const otherActionKey = actionKey(otherCandidateId);
    const binding = {
        decisionId: decisionLog.decisionId,
        decisionLogSha256: digest,
        candidatePoolSha256: decisionLog.candidatePool.candidatePoolSha256,
        datasetVersion: 'dataset-v1',
    };
    return {
        datasetVersion: 'dataset-v1',
        decisionLog,
        decisionLogSha256: digest,
        loggedAction,
        outcome: observedOutcome(decisionLog, input.reward === 1),
        behaviorSupport: {
            ...binding,
            status: 'complete' as const,
            actions: [loggedAction.actionKey, otherActionKey],
        },
        targetPolicy: {
            ...binding,
            policyId: 'target-v1',
            policyVersion: 'target-policy-v1',
            probabilities: [
                { actionKey: loggedAction.actionKey, probability: input.loggedTargetProbability },
                { actionKey: otherActionKey, probability: 1 - input.loggedTargetProbability },
            ],
        },
        predictionArtifact: {
            ...binding,
            artifactVersion: 'prediction-v1',
            objective: 'click_reward',
            rewardDefinitionVersion: 'click_reward_v1',
            horizonMs: HORIZON_MS,
            predictions: [
                { actionKey: loggedAction.actionKey, qHat: input.loggedQHat },
                { actionKey: otherActionKey, qHat: input.otherQHat },
            ],
        },
        segments: {},
    };
}

function validInput(): OpeEvaluationInputV1 {
    return {
        contractVersion: 'ope_evaluation_v1',
        config: {
            datasetVersion: 'dataset-v1',
            outcomeContractVersion: 'outcome_contract_v1',
            behaviorPolicy: { policyId: 'behavior-v1', policyVersion: VERSION.policy },
            targetPolicy: { policyId: 'target-v1', policyVersion: 'target-policy-v1' },
            decisionVersions: { ...VERSION },
            rewardDefinition: {
                objective: 'click_reward',
                definitionVersion: 'click_reward_v1',
                horizonMs: HORIZON_MS,
                weights: {
                    click: 1,
                    like: 0,
                    reply: 0,
                    repost: 0,
                    quote: 0,
                    share: 0,
                    dismiss: 0,
                    blockAuthor: 0,
                    report: 0,
                },
                dwell: { weight: 0, capMs: HORIZON_MS, scaleMs: 1_000 },
            },
            expectedPredictionArtifactVersion: 'prediction-v1',
            clip: 1,
            segmentKeys: [],
        },
        observations: [
            buildObservation({
                index: 0,
                behaviorProbability: 0.5,
                loggedTargetProbability: 0.25,
                reward: 1,
                loggedQHat: 0.4,
                otherQHat: 0.2,
            }),
            buildObservation({
                index: 1,
                behaviorProbability: 0.25,
                loggedTargetProbability: 0.5,
                reward: 0,
                loggedQHat: 0.1,
                otherQHat: 0.3,
            }),
        ],
    };
}

function rebindObservation(
    observation: OpeEvaluationInputV1['observations'][number],
    decisionLog: RecommendationDecisionLogV1,
): OpeEvaluationInputV1['observations'][number] {
    const digest = decisionLogSha256(decisionLog);
    const binding = {
        decisionId: decisionLog.decisionId,
        decisionLogSha256: digest,
        candidatePoolSha256: decisionLog.candidatePool.candidatePoolSha256,
        datasetVersion: observation.datasetVersion,
    };
    return {
        ...observation,
        decisionLog,
        decisionLogSha256: digest,
        loggedAction: decisionLog.actions[0],
        behaviorSupport: { ...observation.behaviorSupport, ...binding },
        targetPolicy: { ...observation.targetPolicy, ...binding },
        ...(observation.predictionArtifact
            ? { predictionArtifact: { ...observation.predictionArtifact, ...binding } }
            : {}),
    };
}

type InvalidCase = {
    name: string;
    blocker: string;
    mutate: (input: OpeEvaluationInputV1) => void;
};

const HARD_GATE_CASES: InvalidCase[] = [
    {
        name: 'incomplete candidate-pool support',
        blocker: 'candidate_pool_support_incomplete',
        mutate: (input) => {
            const observation = input.observations[0];
            const decision = recommendationDecisionLogSchema.parse(observation.decisionLog);
            const incomplete = recommendationDecisionLogSchema.parse({
                ...decision,
                candidatePool: {
                    ...decision.candidatePool,
                    supportEvidence: { status: 'incomplete', reason: 'pool_truncated' },
                    totalCount: decision.candidatePool.totalCount + 1,
                    truncated: true,
                },
            });
            input.observations = [rebindObservation(observation, incomplete)];
        },
    },
    {
        name: 'incomplete separate behavior support',
        blocker: 'behavior_support_incomplete',
        mutate: (input) => {
            const observation = input.observations[0];
            observation.behaviorSupport = {
                ...observation.behaviorSupport,
                status: 'incomplete',
                reason: 'support_not_logged',
            };
        },
    },
    {
        name: 'non-observed outcome',
        blocker: 'outcome_not_observed',
        mutate: (input) => {
            const outcome = input.observations[0].outcome as Extract<
                OutcomeContractV1,
                { status: 'observed' }
            >;
            const { impressionAt: _impressionAt, labels: _labels, ...base } = outcome;
            input.observations[0].outcome = {
                ...base,
                status: 'exposure_missing',
                reason: 'exact_impression_missing',
            };
        },
    },
    {
        name: 'decision version mismatch',
        blocker: 'decision_version_mismatch',
        mutate: (input) => {
            input.config.decisionVersions.pipeline = 'different-pipeline';
        },
    },
    {
        name: 'target probability sum mismatch',
        blocker: 'target_probability_sum_invalid',
        mutate: (input) => {
            input.observations[0].targetPolicy.probabilities.forEach((entry) => {
                entry.probability = 0.2;
            });
        },
    },
    {
        name: 'duplicate target action',
        blocker: 'target_action_duplicate',
        mutate: (input) => {
            const probabilities = input.observations[0].targetPolicy.probabilities;
            probabilities[1] = { ...probabilities[0], probability: 0.75 };
        },
    },
    {
        name: 'cross-slot target action',
        blocker: 'target_action_cross_slot',
        mutate: (input) => {
            const probabilities = input.observations[0].targetPolicy.probabilities;
            probabilities[1] = {
                ...probabilities[1],
                actionKey: { ...probabilities[1].actionKey, servedPosition: 2 },
            };
        },
    },
    {
        name: 'target action outside behavior support',
        blocker: 'target_support_violation',
        mutate: (input) => {
            const probabilities = input.observations[0].targetPolicy.probabilities;
            probabilities[1] = {
                ...probabilities[1],
                actionKey: { ...probabilities[1].actionKey, candidateId: 'not-in-support' },
            };
        },
    },
];

describe('ope_evaluation_v1', () => {
    it('matches hand-calculated estimators and decision-clustered variance', () => {
        const result = evaluateOpeV1(validInput());

        expect(result.status).toBe('evaluated');
        expect(result.observations).toMatchObject({
            total: 2,
            accepted: 2,
            rejected: 0,
            coverage: 1,
            uniqueDecisionClusters: 2,
            rejectedReasonCounts: {},
        });
        expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.clippedIps).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.snips).toMatchObject({ status: 'evaluated', estimate: 0.2 });
        expect(result.estimators.dr).toMatchObject({ status: 'evaluated', estimate: 0.275 });
        expect(result.estimators.ips.clusteredVariance).toEqual({
            status: 'evaluated',
            variance: 0.0625,
        });
        expect(result.estimators.snips.clusteredVariance.status).toBe('evaluated');
        expect(result.estimators.snips.clusteredVariance).toHaveProperty(
            'variance',
            expect.closeTo(0.1024, 12),
        );
        expect(result.estimators.dr.clusteredVariance.status).toBe('evaluated');
        expect(result.estimators.dr.clusteredVariance).toHaveProperty(
            'variance',
            expect.closeTo(0.075625, 12),
        );
        expect(result.diagnostics).toMatchObject({
            effectiveSampleSize: { status: 'evaluated', value: 6.25 / 4.25 },
            maxWeight: 2,
            clippingRate: 0.5,
        });
        expect(result.confidenceIntervals).toEqual({ status: 'unavailable_v1' });
    });

    it('blocks only DR when qHat predictions are unavailable', () => {
        const input = validInput();
        for (const observation of input.observations) delete observation.predictionArtifact;

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('partial');
        expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.clippedIps).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.snips).toMatchObject({ status: 'evaluated', estimate: 0.2 });
        expect(result.estimators.dr).toEqual({
            status: 'not_evaluable',
            blockers: ['prediction_artifact_missing'],
        });
        expect(result.observations).toMatchObject({ accepted: 2, rejected: 0, coverage: 1 });
    });

    it('blocks only DR for incomplete or mismatched prediction artifacts', () => {
        const incompleteInput = validInput();
        incompleteInput.observations[0].predictionArtifact!.predictions.pop();

        const incomplete = evaluateOpeV1(incompleteInput);

        expect(incomplete.status).toBe('partial');
        expect(incomplete.estimators.ips.status).toBe('evaluated');
        expect(incomplete.estimators.dr).toEqual({
            status: 'not_evaluable',
            blockers: ['prediction_support_incomplete'],
        });

        const mismatchInput = validInput();
        mismatchInput.observations[0].predictionArtifact!.artifactVersion = 'other-artifact';

        const mismatch = evaluateOpeV1(mismatchInput);

        expect(mismatch.status).toBe('partial');
        expect(mismatch.estimators.ips.status).toBe('evaluated');
        expect(mismatch.estimators.dr).toEqual({
            status: 'not_evaluable',
            blockers: ['prediction_binding_mismatch'],
        });
    });

    it('fails closed when the expected prediction artifact version is omitted', () => {
        const input = validInput();
        delete input.config.expectedPredictionArtifactVersion;

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe('invalid_config');
        expect(result.bindings).toEqual({ status: 'unavailable', reason: 'invalid_config' });
    });

    it('rejects behavior-support actions from a different served slot', () => {
        const input = validInput();
        const actions = input.observations[0].behaviorSupport.actions;
        actions[1] = {
            ...actions[1],
            servedPosition: actions[0].servedPosition + 1,
        };

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe('behavior_support_cross_slot');
        expect(result.observations.rejectedReasonCounts).toEqual({
            behavior_support_cross_slot: 1,
            cohort_gate_failed: 1,
        });
    });

    it('fails closed for deterministic TopK without emitting zero estimates', () => {
        const input = validInput();
        const observation = input.observations[0];
        const randomized = recommendationDecisionLogSchema.parse(observation.decisionLog);
        const deterministic = recommendationDecisionLogSchema.parse({
            ...randomized,
            behaviorPolicyKind: 'deterministic_top_k',
            actions: randomized.actions.map((action) => ({
                ...action,
                behaviorPropensity: {
                    status: 'not_evaluable_deterministic',
                    reason: 'deterministic_top_k_no_logged_probability',
                },
            })),
        });
        input.observations = [rebindObservation(observation, deterministic)];

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe('not_evaluable_deterministic');
        expect(result.observations).toMatchObject({
            total: 1,
            accepted: 0,
            rejected: 1,
            coverage: 0,
            rejectedReasonCounts: { not_evaluable_deterministic: 1 },
        });
        for (const estimator of Object.values(result.estimators)) {
            expect(estimator).toEqual({
                status: 'not_evaluable',
                blockers: ['not_evaluable_deterministic'],
            });
            expect(estimator).not.toHaveProperty('estimate');
        }
    });

    it.each(HARD_GATE_CASES)('fails the entire cohort for $name', ({ blocker, mutate }) => {
        const input = validInput();
        input.observations = [input.observations[0]];
        mutate(input);

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe(blocker);
        expect(result.observations).toMatchObject({ accepted: 0, coverage: 0 });
        expect(result.observations.rejectedReasonCounts).toEqual({ [blocker]: 1 });
        for (const estimator of Object.values(result.estimators)) {
            expect(estimator.status).toBe('not_evaluable');
            expect(estimator).not.toHaveProperty('estimate');
        }
    });

    it('accounts for valid rows rejected only because a cohort hard gate failed', () => {
        const input = validInput();
        input.observations[1].behaviorSupport = {
            ...input.observations[1].behaviorSupport,
            status: 'incomplete',
            reason: 'support_not_logged',
        };

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.observations).toMatchObject({ total: 2, accepted: 0, rejected: 2 });
        expect(result.observations.rejectedReasonCounts).toEqual({
            behavior_support_incomplete: 1,
            cohort_gate_failed: 1,
        });
        expect(Object.values(result.observations.rejectedReasonCounts)
            .reduce((total, count) => total + count, 0)).toBe(result.observations.rejected);
        expect(result.estimators.ips).toEqual({
            status: 'not_evaluable',
            blockers: ['behavior_support_incomplete'],
        });
    });

    it('rejects duplicate observations and same-decision digest conflicts', () => {
        const duplicateInput = validInput();
        duplicateInput.observations = [
            duplicateInput.observations[0],
            structuredClone(duplicateInput.observations[0]),
        ];

        const duplicate = evaluateOpeV1(duplicateInput);

        expect(duplicate.status).toBe('not_evaluable');
        expect(duplicate.primaryBlocker).toBe('duplicate_observation');
        expect(duplicate.observations.accepted).toBe(0);

        const conflictInput = validInput();
        const original = conflictInput.observations[0];
        const decision = recommendationDecisionLogSchema.parse(original.decisionLog);
        const conflictingDecision = recommendationDecisionLogSchema.parse({
            ...decision,
            fallbackReason: 'different-decision-payload',
        });
        conflictInput.observations = [
            original,
            rebindObservation(structuredClone(original), conflictingDecision),
        ];

        const conflict = evaluateOpeV1(conflictInput);

        expect(conflict.status).toBe('not_evaluable');
        expect(conflict.primaryBlocker).toBe('decision_digest_conflict');
        expect(conflict.observations.accepted).toBe(0);
    });

    it('clusters multiple slots by decision and retains missing segment values', () => {
        const input = validInput();
        const original = recommendationDecisionLogSchema.parse(input.observations[0].decisionLog);
        const candidates = original.candidatePool.candidates.map((candidate, index) => ({
            ...candidate,
            selected: true,
            selectionRank: index + 1,
            served: true,
            servedPosition: index + 1,
        }));
        const decision = recommendationDecisionLogSchema.parse({
            ...original,
            candidatePool: {
                ...original.candidatePool,
                candidates,
                candidatePoolSha256: candidatePoolSha256(candidates),
            },
            actions: candidates.map((candidate, index) => ({
                actionKey: actionKey(candidate.candidateId, index + 1),
                selectionRank: index + 1,
                behaviorPropensity: {
                    status: 'logged_randomized',
                    selectionProbability: 0.5,
                },
            })),
        });
        const digest = decisionLogSha256(decision);
        input.config.segmentKeys = ['locale'];
        input.observations = decision.actions.map((loggedAction, index) => {
            const binding = {
                decisionId: decision.decisionId,
                decisionLogSha256: digest,
                candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
                datasetVersion: input.config.datasetVersion,
            };
            return {
                datasetVersion: input.config.datasetVersion,
                decisionLog: decision,
                decisionLogSha256: digest,
                loggedAction,
                outcome: observedOutcome(decision, index === 0, loggedAction),
                behaviorSupport: {
                    ...binding,
                    status: 'complete' as const,
                    actions: [loggedAction.actionKey],
                },
                targetPolicy: {
                    ...binding,
                    policyId: input.config.targetPolicy.policyId,
                    policyVersion: input.config.targetPolicy.policyVersion,
                    probabilities: [{ actionKey: loggedAction.actionKey, probability: 1 }],
                },
                predictionArtifact: {
                    ...binding,
                    artifactVersion: input.config.expectedPredictionArtifactVersion!,
                    objective: input.config.rewardDefinition.objective,
                    rewardDefinitionVersion: input.config.rewardDefinition.definitionVersion,
                    horizonMs: input.config.rewardDefinition.horizonMs,
                    predictions: [{ actionKey: loggedAction.actionKey, qHat: index === 0 ? 0.5 : 0 }],
                },
                segments: index === 0 ? { locale: 'en' } : {},
            };
        });

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('evaluated');
        expect(result.observations.uniqueDecisionClusters).toBe(1);
        expect(result.estimators.ips.clusteredVariance).toEqual({
            status: 'unavailable',
            reason: 'insufficient_decision_clusters',
        });
        expect(result.segments.map((segment) => ({
            key: segment.segmentKey,
            value: segment.segmentValue,
            count: segment.observations.accepted,
        }))).toEqual([
            { key: 'locale', value: '__missing__', count: 1 },
            { key: 'locale', value: 'en', count: 1 },
        ]);
    });

    it('rejects the reserved missing-segment value at the input boundary', () => {
        const input = validInput();
        input.config.segmentKeys = ['locale'];
        input.observations[0].segments = { locale: '__missing__' };

        expect(() => evaluateOpeV1(input)).not.toThrow();
        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe('invalid_config');
        expect(result.observations.accepted).toBe(0);
    });

    it('keeps zero-target IPS but makes zero-denominator SNIPS and ESS unavailable', () => {
        const input = validInput();
        for (const observation of input.observations) {
            const [logged, other] = observation.targetPolicy.probabilities;
            logged.probability = 0;
            other.probability = 1;
        }

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('partial');
        expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 0 });
        expect(result.estimators.clippedIps).toMatchObject({ status: 'evaluated', estimate: 0 });
        expect(result.estimators.snips).toEqual({
            status: 'not_evaluable',
            blockers: ['zero_weight_sum'],
        });
        expect(result.diagnostics.effectiveSampleSize).toEqual({
            status: 'unavailable',
            reason: 'zero_weight_denominator',
        });
        expect(JSON.stringify(result)).not.toContain('NaN');
    });

    it('self-binds detached reports and preserves explicit behavior-support evidence', () => {
        const input = validInput();
        const first = evaluateOpeV1(input);
        const repeated = evaluateOpeV1(structuredClone(input));

        expect(first.bindings).toEqual({
            status: 'bound',
            datasetVersion: input.config.datasetVersion,
            outcomeContractVersion: input.config.outcomeContractVersion,
            behaviorPolicy: input.config.behaviorPolicy,
            targetPolicy: input.config.targetPolicy,
            decisionVersions: input.config.decisionVersions,
            rewardDefinition: input.config.rewardDefinition,
            predictionArtifactVersion: input.config.expectedPredictionArtifactVersion,
        });
        expect(first.behaviorSupport).toEqual({
            status: 'complete',
            completeObservations: 2,
            totalObservations: 2,
            coverage: 1,
            reasonCounts: {},
        });
        expect(first.fingerprints).toMatchObject({
            status: 'bound',
            inputSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            evaluationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(repeated.fingerprints).toEqual(first.fingerprints);

        const incompleteInput = validInput();
        incompleteInput.observations = [incompleteInput.observations[0]];
        incompleteInput.observations[0].behaviorSupport = {
            ...incompleteInput.observations[0].behaviorSupport,
            status: 'incomplete',
            reason: 'support_not_logged',
        };
        const incomplete = evaluateOpeV1(incompleteInput);

        expect(incomplete.status).toBe('not_evaluable');
        expect(incomplete.behaviorSupport).toEqual({
            status: 'incomplete',
            completeObservations: 0,
            totalObservations: 1,
            coverage: 0,
            reasonCounts: { support_not_logged: 1 },
        });

        const changedRewardInput = validInput();
        changedRewardInput.config.rewardDefinition.weights.click = 2;
        const changedReward = evaluateOpeV1(changedRewardInput);

        expect(changedReward.bindings).toMatchObject({
            status: 'bound',
            rewardDefinition: changedRewardInput.config.rewardDefinition,
        });
        expect(changedReward.bindings).not.toEqual(first.bindings);
        expect(changedReward.fingerprints).not.toEqual(first.fingerprints);
    });

    it('returns fail-closed reports for empty cohorts and invalid config', () => {
        const emptyInput = validInput();
        emptyInput.observations = [];

        const empty = evaluateOpeV1(emptyInput);

        expect(empty.status).toBe('not_evaluable');
        expect(empty.primaryBlocker).toBe('empty_observations');
        expect(empty.observations).toMatchObject({ total: 0, accepted: 0, coverage: 0 });

        const invalidInput = validInput();
        invalidInput.config.clip = 0;

        expect(() => evaluateOpeV1(invalidInput)).not.toThrow();
        const invalid = evaluateOpeV1(invalidInput);
        expect(invalid.status).toBe('not_evaluable');
        expect(invalid.primaryBlocker).toBe('invalid_config');
        expect(invalid.bindings).toEqual({ status: 'unavailable', reason: 'invalid_config' });
        expect(invalid.fingerprints.status).toBe('bound');
        expect(JSON.stringify(invalid)).not.toContain('NaN');
    });

    it.each(['bigint', 'cycle'])('marks non-canonicalizable %s input fingerprints unavailable', (kind) => {
        const input = validInput() as OpeEvaluationInputV1 & Record<string, unknown>;
        input.config.clip = 0;
        if (kind === 'bigint') input.nonCanonical = BigInt(1);
        else input.nonCanonical = input;

        expect(() => evaluateOpeV1(input)).not.toThrow();
        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.fingerprints).toEqual({
            status: 'unavailable',
            reason: 'input_not_canonicalizable',
        });
    });

    it.each(['bigint', 'cycle'])('fails closed for a non-canonicalizable %s logged action key', (kind) => {
        const input = validInput();
        input.observations = [input.observations[0]];
        if (kind === 'bigint') {
            input.observations[0].loggedAction = {
                actionKey: {
                    candidateNamespace: 'serving_post_id',
                    candidateId: BigInt(1),
                    servedPosition: 1,
                },
            };
        } else {
            const cyclicActionKey: Record<string, unknown> = {};
            cyclicActionKey.self = cyclicActionKey;
            input.observations[0].loggedAction = { actionKey: cyclicActionKey };
        }

        expect(() => evaluateOpeV1(input)).not.toThrow();
        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe('logged_action_identity_mismatch');
        expect(result.observations).toMatchObject({ total: 1, accepted: 0, rejected: 1 });
        expect(result.fingerprints).toEqual({
            status: 'unavailable',
            reason: 'input_not_canonicalizable',
        });
    });

    it.each([
        {
            name: 'reward overflow',
            blocker: 'non_finite_reward',
            mutate: (input: OpeEvaluationInputV1) => {
                input.observations = [input.observations[0]];
                input.config.rewardDefinition.weights.click = Number.MAX_VALUE;
                input.config.rewardDefinition.weights.like = Number.MAX_VALUE;
                const outcome = input.observations[0].outcome as Extract<
                    OutcomeContractV1,
                    { status: 'observed' }
                >;
                outcome.labels.like = true;
            },
        },
        {
            name: 'importance-weight overflow',
            blocker: 'non_finite_importance_weight',
            mutate: (input: OpeEvaluationInputV1) => {
                input.observations = [input.observations[0]];
                const observation = input.observations[0];
                const decision = recommendationDecisionLogSchema.parse(observation.decisionLog);
                const tinyBehavior = recommendationDecisionLogSchema.parse({
                    ...decision,
                    actions: decision.actions.map((action) => ({
                        ...action,
                        behaviorPropensity: {
                            status: 'logged_randomized',
                            selectionProbability: Number.MIN_VALUE,
                        },
                    })),
                });
                input.observations = [rebindObservation(observation, tinyBehavior)];
            },
        },
        {
            name: 'base-contribution overflow',
            blocker: 'non_finite_base_contribution',
            mutate: (input: OpeEvaluationInputV1) => {
                input.observations = [input.observations[1]];
                input.config.rewardDefinition.weights.click = Number.MAX_VALUE;
                const outcome = input.observations[0].outcome as Extract<
                    OutcomeContractV1,
                    { status: 'observed' }
                >;
                outcome.labels.click = true;
                outcome.labels.engagement = true;
            },
        },
    ])('fails the entire cohort for $name', ({ blocker, mutate }) => {
        const input = validInput();
        mutate(input);

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('not_evaluable');
        expect(result.primaryBlocker).toBe(blocker);
        for (const estimator of Object.values(result.estimators)) {
            expect(estimator).toEqual({ status: 'not_evaluable', blockers: [blocker] });
        }
        expect(result.diagnostics.effectiveSampleSize.status).toBe('unavailable');
        expectAllNumbersFinite(result);
    });

    it('blocks only DR when finite qHat values overflow the DR correction', () => {
        const input = validInput();
        const observation = input.observations[1];
        const loggedKey = (observation.loggedAction as RecommendationDecisionLogV1['actions'][number])
            .actionKey;
        const loggedPrediction = observation.predictionArtifact!.predictions.find((prediction) => (
            prediction.actionKey.candidateNamespace === loggedKey.candidateNamespace
            && prediction.actionKey.candidateId === loggedKey.candidateId
            && prediction.actionKey.servedPosition === loggedKey.servedPosition
        ))!;
        loggedPrediction.qHat = -Number.MAX_VALUE;

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('partial');
        expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.clippedIps).toMatchObject({ status: 'evaluated', estimate: 0.25 });
        expect(result.estimators.snips).toMatchObject({ status: 'evaluated', estimate: 0.2 });
        expect(result.estimators.dr).toEqual({
            status: 'not_evaluable',
            blockers: ['non_finite_dr_contribution'],
        });
        expect(result.diagnostics.effectiveSampleSize.status).toBe('evaluated');
        expectAllNumbersFinite(result);
    });

    it('keeps finite estimates while making overflowed clustered variance unavailable', () => {
        const input = validInput();
        input.config.rewardDefinition.weights.click = 1e200;
        input.config.rewardDefinition.weights.dismiss = -1e200;
        const secondOutcome = input.observations[1].outcome as Extract<
            OutcomeContractV1,
            { status: 'observed' }
        >;
        secondOutcome.labels.dismiss = true;
        secondOutcome.labels.negative = true;
        const firstTarget = input.observations[0].targetPolicy.probabilities;
        firstTarget[0].probability = 0.5;
        firstTarget[1].probability = 0.5;
        const secondTarget = input.observations[1].targetPolicy.probabilities;
        secondTarget[0].probability = 0.25;
        secondTarget[1].probability = 0.75;

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('evaluated');
        expect(result.estimators.ips).toMatchObject({ status: 'evaluated', estimate: 0 });
        expect(result.estimators.ips.clusteredVariance).toEqual({
            status: 'unavailable',
            reason: 'non_finite_variance',
        });
        expect(result.estimators.snips.clusteredVariance).toEqual({
            status: 'unavailable',
            reason: 'non_finite_variance',
        });
        expectAllNumbersFinite(result);
    });

    it('marks estimators unavailable when finite row contributions overflow cohort aggregates', () => {
        const input = validInput();
        input.config.rewardDefinition.weights.click = Number.MAX_VALUE;
        const secondOutcome = input.observations[1].outcome as Extract<
            OutcomeContractV1,
            { status: 'observed' }
        >;
        secondOutcome.labels.click = true;
        secondOutcome.labels.engagement = true;
        const firstTarget = input.observations[0].targetPolicy.probabilities;
        firstTarget[0].probability = 0.5;
        firstTarget[1].probability = 0.5;
        const secondTarget = input.observations[1].targetPolicy.probabilities;
        secondTarget[0].probability = 0.25;
        secondTarget[1].probability = 0.75;

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('partial');
        expect(result.estimators.ips).toEqual({
            status: 'not_evaluable',
            blockers: ['non_finite_aggregate'],
        });
        expect(result.estimators.clippedIps).toEqual({
            status: 'not_evaluable',
            blockers: ['non_finite_aggregate'],
        });
        expect(result.estimators.snips).toEqual({
            status: 'not_evaluable',
            blockers: ['non_finite_snips_aggregate'],
        });
        expect(result.estimators.dr).toEqual({
            status: 'not_evaluable',
            blockers: ['non_finite_aggregate'],
        });
        expectAllNumbersFinite(result);
    });

    it('marks ESS unavailable when finite importance-weight squares overflow', () => {
        const input = validInput();
        input.observations = [input.observations[0]];
        const observation = input.observations[0];
        const decision = recommendationDecisionLogSchema.parse(observation.decisionLog);
        const largeWeightDecision = recommendationDecisionLogSchema.parse({
            ...decision,
            actions: decision.actions.map((action) => ({
                ...action,
                behaviorPropensity: {
                    status: 'logged_randomized',
                    selectionProbability: 1e-200,
                },
            })),
        });
        observation.targetPolicy.probabilities[0].probability = 1;
        observation.targetPolicy.probabilities[1].probability = 0;
        input.observations = [rebindObservation(observation, largeWeightDecision)];

        const result = evaluateOpeV1(input);

        expect(result.status).toBe('evaluated');
        expect(result.estimators.ips.status).toBe('evaluated');
        expect(result.diagnostics.effectiveSampleSize).toEqual({
            status: 'unavailable',
            reason: 'non_finite_ess',
        });
        expectAllNumbersFinite(result);
    });
});
