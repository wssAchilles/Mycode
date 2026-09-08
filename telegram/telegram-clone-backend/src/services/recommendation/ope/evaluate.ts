import { createHash } from 'crypto';

import {
    canonicalDecisionJson,
    decisionActionKeySchema,
    decisionLogSha256,
    recommendationDecisionLogSchema,
    type RecommendationDecisionLogV1,
} from '../decisionLog/contracts';
import { outcomeContractV1Schema } from '../outcomes/outcomeContractV1';
import {
    OPE_EVALUATION_VERSION,
    OPE_MISSING_SEGMENT_VALUE,
    opeEvaluationInputSchema,
    opeObservationSchema,
    type ClusteredVariance,
    type EffectiveSampleSize,
    type EstimatorResult,
    type OpeEvaluationConfigV1,
    type OpeEvaluationInputV1,
    type OpeEvaluationResultV1,
    type OpeObservationV1,
    type OpeSegmentSliceV1,
} from './contracts';

type ActionKey = RecommendationDecisionLogV1['actions'][number]['actionKey'];
type ValidRow = {
    decisionId: string;
    weight: number;
    clippedWeight: number;
    reward: number;
    baseContribution: number;
    clippedContribution: number;
    drContribution?: number;
    drBlocker?: string;
    segments: Record<string, string>;
};
type RowValidation = { row: ValidRow } | { blocker: string };
type OpeResultCore = Omit<
    OpeEvaluationResultV1,
    'bindings' | 'behaviorSupport' | 'fingerprints'
>;
type EvaluationSummary = Pick<
    OpeSegmentSliceV1,
    'status' | 'estimators' | 'diagnostics'
>;

export function evaluateOpeV1(input: OpeEvaluationInputV1): OpeEvaluationResultV1 {
    const inputResult = opeEvaluationInputSchema.safeParse(input);
    if (!inputResult.success) return invalidInputResult(input, 'invalid_config');
    const parsed = inputResult.data;
    if (parsed.observations.length === 0) {
        return hardBlockedResult(parsed, ['empty_observations']);
    }
    const cohortBlocker = validateCohortIdentity(parsed.observations);
    if (cohortBlocker) {
        return hardBlockedResult(parsed, [cohortBlocker]);
    }
    const validated = parsed.observations.map((observation) => validRow(observation, parsed.config));
    const blockers = validated.flatMap((result) => ('blocker' in result ? [result.blocker] : []));
    if (blockers.length > 0) return hardBlockedResult(parsed, blockers);
    const rows = validated.flatMap((result) => ('row' in result ? [result.row] : []));
    const summary = summarizeRows(rows, parsed.config.clip);
    const count = rows.length;
    const clusters = new Set(rows.map((row) => row.decisionId)).size;

    return finalizeReport({
        contractVersion: OPE_EVALUATION_VERSION,
        status: summary.status,
        observations: {
            total: count,
            accepted: count,
            rejected: 0,
            coverage: 1,
            uniqueDecisionClusters: clusters,
            rejectedReasonCounts: {},
        },
        estimators: summary.estimators,
        diagnostics: summary.diagnostics,
        confidenceIntervals: { status: 'unavailable_v1' },
        segments: segmentSlices(rows, parsed.config),
    }, parsed);
}

function summarizeRows(rows: ValidRow[], clip: number): EvaluationSummary {
    const count = rows.length;
    const weights = rows.map((row) => row.weight);
    const drContributions = rows.flatMap((row) => (
        row.drContribution === undefined ? [] : [row.drContribution]
    ));
    const contributions = {
        ips: rows.map((row) => row.baseContribution),
        clippedIps: rows.map((row) => row.clippedContribution),
    };
    const ips = additiveEstimator(rows, contributions.ips);
    const clippedIps = additiveEstimator(rows, contributions.clippedIps);
    const snips = snipsEstimator(rows, contributions.ips, weights);
    const dr = drContributions.length === count
        ? additiveEstimator(rows, drContributions)
        : {
            status: 'not_evaluable' as const,
            blockers: Array.from(new Set(rows.flatMap((row) => (
                row.drBlocker ? [row.drBlocker] : []
            )))),
        };
    const estimators = { ips, clippedIps, snips, dr };
    let maxWeight: number | null = null;
    for (const weight of weights) {
        if (maxWeight === null || weight > maxWeight) maxWeight = weight;
    }
    return {
        status: Object.values(estimators).every((estimator) => estimator.status === 'evaluated')
            ? 'evaluated'
            : 'partial',
        estimators,
        diagnostics: {
            effectiveSampleSize: effectiveSampleSize(weights),
            maxWeight,
            clippingRate: rows.filter((row) => row.weight > clip).length / count,
        },
    };
}

function additiveEstimator(rows: ValidRow[], contributions: number[]): EstimatorResult {
    const total = sum(contributions);
    const estimate = total / contributions.length;
    if (!Number.isFinite(total) || !Number.isFinite(estimate)) {
        return { status: 'not_evaluable', blockers: ['non_finite_aggregate'] };
    }
    return evaluated(estimate, additiveVariance(rows, contributions, estimate));
}

function snipsEstimator(
    rows: ValidRow[],
    contributions: number[],
    weights: number[],
): EstimatorResult {
    const numerator = sum(contributions);
    const denominator = sum(weights);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
        return { status: 'not_evaluable', blockers: ['non_finite_snips_aggregate'] };
    }
    if (denominator === 0) {
        return { status: 'not_evaluable', blockers: ['zero_weight_sum'] };
    }
    const estimate = numerator / denominator;
    if (!Number.isFinite(estimate)) {
        return { status: 'not_evaluable', blockers: ['non_finite_snips_aggregate'] };
    }
    return evaluated(estimate, snipsVariance(rows, estimate, denominator));
}

function effectiveSampleSize(weights: number[]): EffectiveSampleSize {
    const sumWeight = sum(weights);
    const squares = weights.map((weight) => weight * weight);
    const sumWeightSquares = sum(squares);
    if (
        !Number.isFinite(sumWeight)
        || squares.some((square) => !Number.isFinite(square))
        || !Number.isFinite(sumWeightSquares)
    ) return { status: 'unavailable', reason: 'non_finite_ess' };
    if (sumWeightSquares === 0) {
        return { status: 'unavailable', reason: 'zero_weight_denominator' };
    }
    const numerator = sumWeight * sumWeight;
    const value = numerator / sumWeightSquares;
    if (!Number.isFinite(numerator) || !Number.isFinite(value)) {
        return { status: 'unavailable', reason: 'non_finite_ess' };
    }
    return { status: 'evaluated', value };
}

function segmentSlices(
    rows: ValidRow[],
    config: OpeEvaluationConfigV1,
): OpeSegmentSliceV1[] {
    return config.segmentKeys.flatMap((segmentKey) => {
        const grouped = new Map<string, ValidRow[]>();
        for (const row of rows) {
            const value = row.segments[segmentKey] ?? OPE_MISSING_SEGMENT_VALUE;
            const segmentRows = grouped.get(value);
            if (segmentRows) segmentRows.push(row);
            else grouped.set(value, [row]);
        }
        return Array.from(grouped.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([segmentValue, segmentRows]) => {
                const summary = summarizeRows(segmentRows, config.clip);
                return {
                    segmentKey,
                    segmentValue,
                    status: summary.status,
                    observations: {
                        total: segmentRows.length,
                        accepted: segmentRows.length,
                        rejected: 0 as const,
                        coverage: 1 as const,
                        uniqueDecisionClusters: new Set(
                            segmentRows.map((row) => row.decisionId),
                        ).size,
                        rejectedReasonCounts: {},
                    },
                    estimators: summary.estimators,
                    diagnostics: summary.diagnostics,
                };
            });
    });
}

function validateCohortIdentity(observations: OpeObservationV1[]): string | undefined {
    const decisionDigests = new Map<string, string>();
    const observationKeys = new Set<string>();
    for (const observation of observations) {
        const decision = recommendationDecisionLogSchema.safeParse(observation.decisionLog);
        if (!decision.success) continue;
        const previousDigest = decisionDigests.get(decision.data.decisionId);
        if (previousDigest && previousDigest !== observation.decisionLogSha256) {
            return 'decision_digest_conflict';
        }
        decisionDigests.set(decision.data.decisionId, observation.decisionLogSha256);

        const actionKey = readLoggedActionKey(observation.loggedAction);
        if (!actionKey) continue;
        const observationKey = `${decision.data.decisionId}:${actionKeyString(actionKey)}`;
        if (observationKeys.has(observationKey)) return 'duplicate_observation';
        observationKeys.add(observationKey);
    }
    return undefined;
}

function validRow(observation: OpeObservationV1, config: OpeEvaluationConfigV1): RowValidation {
    const decisionResult = recommendationDecisionLogSchema.safeParse(observation.decisionLog);
    if (!decisionResult.success) return { blocker: 'decision_log_invalid' };
    const decision = decisionResult.data;
    if (decisionLogSha256(decision) !== observation.decisionLogSha256) {
        return { blocker: 'decision_log_digest_mismatch' };
    }
    const loggedActionKey = readLoggedActionKey(observation.loggedAction);
    if (!loggedActionKey) return { blocker: 'logged_action_identity_mismatch' };
    const loggedAction = decision.actions.find((action) => (
        keysEqual(action.actionKey, loggedActionKey)
    ));
    if (!loggedAction) return { blocker: 'logged_action_identity_mismatch' };
    if (
        decision.behaviorPolicyKind === 'deterministic_top_k'
        || loggedAction.behaviorPropensity.status === 'not_evaluable_deterministic'
    ) return { blocker: 'not_evaluable_deterministic' };
    if (loggedAction.behaviorPropensity.status !== 'logged_randomized') {
        return { blocker: 'behavior_propensity_unavailable' };
    }
    if (
        decision.candidatePool.supportEvidence.status !== 'complete'
        || decision.candidatePool.truncated
    ) return { blocker: 'candidate_pool_support_incomplete' };
    if (observation.behaviorSupport.status !== 'complete') {
        return { blocker: 'behavior_support_incomplete' };
    }
    if (observation.datasetVersion !== config.datasetVersion) {
        return { blocker: 'dataset_version_mismatch' };
    }
    if (!decisionVersionsMatch(decision, config)) {
        return { blocker: 'decision_version_mismatch' };
    }
    if (
        decision.behaviorPolicy.policyId !== config.behaviorPolicy.policyId
        || decision.behaviorPolicy.policyVersion.status !== 'bound'
        || decision.behaviorPolicy.policyVersion.version !== config.behaviorPolicy.policyVersion
    ) return { blocker: 'behavior_policy_binding_mismatch' };
    if (!bindingMatches(observation.behaviorSupport, observation, decision)) {
        return { blocker: 'behavior_support_binding_mismatch' };
    }
    if (!bindingMatches(observation.targetPolicy, observation, decision)) {
        return { blocker: 'target_policy_binding_mismatch' };
    }
    if (
        observation.targetPolicy.policyId !== config.targetPolicy.policyId
        || observation.targetPolicy.policyVersion !== config.targetPolicy.policyVersion
    ) return { blocker: 'target_policy_binding_mismatch' };

    const behaviorActionKeys = observation.behaviorSupport.actions.map(actionKeyString);
    if (new Set(behaviorActionKeys).size !== behaviorActionKeys.length) {
        return { blocker: 'behavior_support_invalid' };
    }
    if (observation.behaviorSupport.actions.some((actionKey) => (
        actionKey.servedPosition !== loggedAction.actionKey.servedPosition
    ))) return { blocker: 'behavior_support_cross_slot' };
    if (!behaviorActionKeys.includes(actionKeyString(loggedAction.actionKey))) {
        return { blocker: 'behavior_support_missing_logged_action' };
    }
    const targetActionKeys = observation.targetPolicy.probabilities.map((entry) => (
        actionKeyString(entry.actionKey)
    ));
    if (new Set(targetActionKeys).size !== targetActionKeys.length) {
        return { blocker: 'target_action_duplicate' };
    }
    if (observation.targetPolicy.probabilities.some((entry) => (
        entry.actionKey.servedPosition !== loggedAction.actionKey.servedPosition
    ))) return { blocker: 'target_action_cross_slot' };
    if (observation.targetPolicy.probabilities.some((entry) => (
        entry.probability < 0 || entry.probability > 1
    ))) return { blocker: 'target_probability_invalid' };
    const positiveTarget = observation.targetPolicy.probabilities.filter((entry) => (
        entry.probability > 0
    ));
    if (Math.abs(sum(positiveTarget.map((entry) => entry.probability)) - 1) > 1e-8) {
        return { blocker: 'target_probability_sum_invalid' };
    }
    if (positiveTarget.some((entry) => (
        !behaviorActionKeys.includes(actionKeyString(entry.actionKey))
    ))) return { blocker: 'target_support_violation' };
    if (positiveTarget.some((entry) => !decision.candidatePool.candidates.some((candidate) => (
        candidate.eligible
        && candidate.candidateNamespace === entry.actionKey.candidateNamespace
        && candidate.candidateId === entry.actionKey.candidateId
    )))) return { blocker: 'target_candidate_ineligible_or_missing' };

    const outcomeResult = outcomeContractV1Schema.safeParse(observation.outcome);
    if (!outcomeResult.success) return { blocker: 'outcome_contract_invalid' };
    const outcome = outcomeResult.data;
    if (outcome.status !== 'observed') return { blocker: 'outcome_not_observed' };
    if (
        outcome.decisionId !== decision.decisionId
        || !keysEqual(outcome.actionKey, loggedAction.actionKey)
        || outcome.decisionAt !== decision.decisionAt
        || outcome.horizonMs !== config.rewardDefinition.horizonMs
        || config.outcomeContractVersion !== outcome.contractVersion
    ) return { blocker: 'outcome_binding_mismatch' };
    const targetProbability = observation.targetPolicy.probabilities.find((entry) => (
        keysEqual(entry.actionKey, loggedAction.actionKey)
    ))?.probability ?? 0;
    const reward = deriveReward(outcome.labels, config);
    if (!Number.isFinite(reward)) return { blocker: 'non_finite_reward' };
    const behaviorProbability = loggedAction.behaviorPropensity.selectionProbability;
    const weight = targetProbability / behaviorProbability;
    if (!Number.isFinite(weight)) return { blocker: 'non_finite_importance_weight' };
    const clippedWeight = Math.min(weight, config.clip);
    const baseContribution = weight * reward;
    const clippedContribution = clippedWeight * reward;
    if (!Number.isFinite(baseContribution) || !Number.isFinite(clippedContribution)) {
        return { blocker: 'non_finite_base_contribution' };
    }
    const row: ValidRow = {
        decisionId: decision.decisionId,
        weight,
        clippedWeight,
        reward,
        baseContribution,
        clippedContribution,
        segments: observation.segments ?? {},
    };
    const prediction = observation.predictionArtifact;
    if (!prediction) return { row: { ...row, drBlocker: 'prediction_artifact_missing' } };
    if (
        !bindingMatches(prediction, observation, decision)
        || prediction.objective !== config.rewardDefinition.objective
        || prediction.rewardDefinitionVersion !== config.rewardDefinition.definitionVersion
        || prediction.horizonMs !== config.rewardDefinition.horizonMs
        || prediction.artifactVersion !== config.expectedPredictionArtifactVersion
    ) return { row: { ...row, drBlocker: 'prediction_binding_mismatch' } };
    const predictionKeys = prediction.predictions.map((entry) => actionKeyString(entry.actionKey));
    if (new Set(predictionKeys).size !== predictionKeys.length) {
        return { row: { ...row, drBlocker: 'prediction_support_invalid' } };
    }
    const requiredPredictionKeys = new Set([
        actionKeyString(loggedAction.actionKey),
        ...positiveTarget.map((entry) => actionKeyString(entry.actionKey)),
    ]);
    if (Array.from(requiredPredictionKeys).some((key) => !predictionKeys.includes(key))) {
        return { row: { ...row, drBlocker: 'prediction_support_incomplete' } };
    }
    const qHatByAction = new Map(prediction.predictions.map((entry) => [
        actionKeyString(entry.actionKey),
        entry.qHat,
    ]));
    const loggedQHat = qHatByAction.get(actionKeyString(loggedAction.actionKey));
    if (loggedQHat === undefined) {
        return { row: { ...row, drBlocker: 'prediction_support_incomplete' } };
    }
    const targetTerms = observation.targetPolicy.probabilities.map((entry) => (
        entry.probability * (qHatByAction.get(actionKeyString(entry.actionKey)) ?? 0)
    ));
    const targetExpectation = sum(targetTerms);
    const drCorrection = weight * (reward - loggedQHat);
    const drContribution = targetExpectation + drCorrection;
    if (
        targetTerms.some((term) => !Number.isFinite(term))
        || !Number.isFinite(targetExpectation)
        || !Number.isFinite(drCorrection)
        || !Number.isFinite(drContribution)
    ) return { row: { ...row, drBlocker: 'non_finite_dr_contribution' } };
    return { row: {
        ...row,
        drContribution,
    } };
}

function decisionVersionsMatch(
    decision: RecommendationDecisionLogV1,
    config: OpeEvaluationConfigV1,
): boolean {
    return (Object.keys(config.decisionVersions) as Array<keyof typeof config.decisionVersions>)
        .every((key) => (
            decision.versions[key].status === 'bound'
            && decision.versions[key].version === config.decisionVersions[key]
        ));
}

function bindingMatches(
    binding: {
        decisionId: string;
        decisionLogSha256: string;
        candidatePoolSha256: string;
        datasetVersion: string;
    },
    observation: OpeObservationV1,
    decision: RecommendationDecisionLogV1,
): boolean {
    return binding.decisionId === decision.decisionId
        && binding.decisionLogSha256 === observation.decisionLogSha256
        && binding.candidatePoolSha256 === decision.candidatePool.candidatePoolSha256
        && binding.datasetVersion === observation.datasetVersion;
}

function actionKeyString(actionKey: ActionKey): string {
    return canonicalDecisionJson(actionKey);
}

function readLoggedActionKey(value: unknown): ActionKey | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    try {
        const parsed = decisionActionKeySchema.safeParse(Reflect.get(value, 'actionKey'));
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
}

function hardBlockedResult(
    input: ReturnType<typeof opeEvaluationInputSchema.parse>,
    blockers: string[],
): OpeEvaluationResultV1 {
    const total = input.observations.length;
    return finalizeReport(hardBlockedCore(total, blockers), input);
}

function hardBlockedCore(total: number, blockers: string[]): OpeResultCore {
    const uniqueBlockers = Array.from(new Set(blockers));
    const rowBlockers = blockers.slice(0, total);
    const rejectedReasonCounts = rowBlockers.reduce<Record<string, number>>((counts, blocker) => {
        counts[blocker] = (counts[blocker] ?? 0) + 1;
        return counts;
    }, {});
    const cohortRejected = total - rowBlockers.length;
    if (cohortRejected > 0) rejectedReasonCounts.cohort_gate_failed = cohortRejected;
    const estimator = { status: 'not_evaluable' as const, blockers: uniqueBlockers };
    return {
        contractVersion: OPE_EVALUATION_VERSION,
        status: 'not_evaluable',
        primaryBlocker: uniqueBlockers[0],
        observations: {
            total,
            accepted: 0,
            rejected: total,
            coverage: 0,
            uniqueDecisionClusters: 0,
            rejectedReasonCounts,
        },
        estimators: {
            ips: estimator,
            clippedIps: estimator,
            snips: estimator,
            dr: estimator,
        },
        diagnostics: {
            effectiveSampleSize: { status: 'unavailable', reason: 'hard_gate_failed' },
            maxWeight: null,
            clippingRate: null,
        },
        confidenceIntervals: { status: 'unavailable_v1' },
        segments: [],
    };
}

function invalidInputResult(input: unknown, blocker: string): OpeEvaluationResultV1 {
    const source = input !== null && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {};
    const rawObservations = Array.isArray(source.observations) ? source.observations : [];
    const observations = rawObservations.flatMap((observation) => {
        const parsed = opeObservationSchema.safeParse(observation);
        return parsed.success ? [parsed.data] : [];
    });
    const bound = {
        ...hardBlockedCore(rawObservations.length, [blocker]),
        bindings: { status: 'unavailable' as const, reason: blocker },
        behaviorSupport: summarizeBehaviorSupport(observations, rawObservations.length),
    };
    return bindFingerprints(bound, input);
}

function finalizeReport(
    result: OpeResultCore,
    input: ReturnType<typeof opeEvaluationInputSchema.parse>,
): OpeEvaluationResultV1 {
    const config = input.config;
    const behaviorSupport = summarizeBehaviorSupport(input.observations);
    const bound = {
        ...result,
        bindings: {
            status: 'bound' as const,
            datasetVersion: config.datasetVersion,
            outcomeContractVersion: config.outcomeContractVersion,
            behaviorPolicy: config.behaviorPolicy,
            targetPolicy: config.targetPolicy,
            decisionVersions: config.decisionVersions,
            rewardDefinition: config.rewardDefinition,
            predictionArtifactVersion: config.expectedPredictionArtifactVersion,
        },
        behaviorSupport,
    };
    return bindFingerprints(bound, input);
}

function bindFingerprints(
    result: Omit<OpeEvaluationResultV1, 'fingerprints'>,
    input: unknown,
): OpeEvaluationResultV1 {
    const inputDigest = canonicalSha256(input);
    if (inputDigest.status === 'unavailable') {
        return { ...result, fingerprints: inputDigest };
    }
    const evaluationDigest = canonicalSha256({
        ...result,
        inputSha256: inputDigest.sha256,
    });
    if (evaluationDigest.status === 'unavailable') {
        return { ...result, fingerprints: evaluationDigest };
    }
    return {
        ...result,
        fingerprints: {
            status: 'bound',
            inputSha256: inputDigest.sha256,
            evaluationSha256: evaluationDigest.sha256,
        },
    };
}

function summarizeBehaviorSupport(
    observations: OpeObservationV1[],
    totalObservations = observations.length,
) {
    const completeObservations = observations.filter((observation) => (
        observation.behaviorSupport.status === 'complete'
    )).length;
    const reasonCounts = observations.reduce<Record<string, number>>((counts, observation) => {
        if (observation.behaviorSupport.status === 'incomplete') {
            counts[observation.behaviorSupport.reason] = (
                (counts[observation.behaviorSupport.reason] ?? 0) + 1
            );
        }
        return counts;
    }, {});
    return {
        status: totalObservations > 0 && completeObservations === totalObservations
            ? 'complete' as const
            : 'incomplete' as const,
        completeObservations,
        totalObservations,
        coverage: totalObservations === 0 ? 0 : completeObservations / totalObservations,
        reasonCounts,
    };
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function canonicalSha256(value: unknown):
    | { status: 'bound'; sha256: string }
    | { status: 'unavailable'; reason: 'input_not_canonicalizable' } {
    try {
        return { status: 'bound', sha256: sha256(canonicalDecisionJson(value)) };
    } catch {
        return { status: 'unavailable', reason: 'input_not_canonicalizable' };
    }
}

function deriveReward(
    labels: Extract<ReturnType<typeof outcomeContractV1Schema.parse>, { status: 'observed' }>['labels'],
    config: OpeEvaluationConfigV1,
): number {
    const weights = config.rewardDefinition.weights;
    const primitive = (Object.keys(weights) as Array<keyof typeof weights>)
        .reduce((total, key) => total + weights[key] * Number(labels[key]), 0);
    const dwell = config.rewardDefinition.dwell;
    return primitive + dwell.weight * Math.min(labels.dwellTimeMs, dwell.capMs) / dwell.scaleMs;
}

function evaluated(estimate: number, clusteredVariance: ClusteredVariance) {
    return { status: 'evaluated' as const, estimate, clusteredVariance };
}

function additiveVariance(
    rows: ValidRow[],
    contributions: number[],
    estimate: number,
): ClusteredVariance {
    const grouped = clusterSums(rows, contributions.map((value) => value - estimate));
    return clusteredVariance(grouped, rows.length * rows.length);
}

function snipsVariance(rows: ValidRow[], estimate: number, sumWeight: number): ClusteredVariance {
    const grouped = clusterSums(rows, rows.map((row) => row.weight * (row.reward - estimate)));
    return clusteredVariance(grouped, sumWeight * sumWeight);
}

function clusterSums(rows: ValidRow[], values: number[]): number[] {
    const grouped = new Map<string, number>();
    rows.forEach((row, index) => grouped.set(
        row.decisionId,
        (grouped.get(row.decisionId) ?? 0) + values[index],
    ));
    return Array.from(grouped.values());
}

function clusteredVariance(clusterTotals: number[], denominator: number): ClusteredVariance {
    const clusters = clusterTotals.length;
    if (clusters < 2) {
        return { status: 'unavailable', reason: 'insufficient_decision_clusters' };
    }
    if (!Number.isFinite(denominator) || denominator <= 0) {
        return { status: 'unavailable', reason: 'non_finite_variance' };
    }
    let squareSum = 0;
    for (const total of clusterTotals) {
        const square = total * total;
        if (!Number.isFinite(total) || !Number.isFinite(square)) {
            return { status: 'unavailable', reason: 'non_finite_variance' };
        }
        squareSum += square;
        if (!Number.isFinite(squareSum)) {
            return { status: 'unavailable', reason: 'non_finite_variance' };
        }
    }
    const variance = clusters / (clusters - 1) * squareSum / denominator;
    if (!Number.isFinite(variance)) {
        return { status: 'unavailable', reason: 'non_finite_variance' };
    }
    return {
        status: 'evaluated',
        variance,
    };
}

function keysEqual(left: ActionKey, right: ActionKey): boolean {
    return left.candidateNamespace === right.candidateNamespace
        && left.candidateId === right.candidateId
        && left.servedPosition === right.servedPosition;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}
