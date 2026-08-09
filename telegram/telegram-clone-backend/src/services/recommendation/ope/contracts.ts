import { z } from 'zod';

import { decisionActionKeySchema } from '../decisionLog/contracts';
import { OUTCOME_CONTRACT_VERSION } from '../outcomes/contracts';

export const OPE_EVALUATION_VERSION = 'ope_evaluation_v1' as const;
export const OPE_MISSING_SEGMENT_VALUE = '__missing__' as const;

const nonEmptyString = z.string().trim().min(1);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const segmentValue = z.string().refine(
    (value) => value !== OPE_MISSING_SEGMENT_VALUE,
    { message: 'reserved_missing_segment_value' },
);
const bindingSchema = z.object({
    decisionId: z.string().uuid(),
    decisionLogSha256: sha256,
    candidatePoolSha256: sha256,
    datasetVersion: nonEmptyString,
}).strict();

export const behaviorSupportEvidenceSchema = z.discriminatedUnion('status', [
    bindingSchema.extend({
        status: z.literal('complete'),
        actions: z.array(decisionActionKeySchema),
    }).strict(),
    bindingSchema.extend({
        status: z.literal('incomplete'),
        reason: nonEmptyString,
        actions: z.array(decisionActionKeySchema),
    }).strict(),
]);

export const targetPolicyDistributionSchema = bindingSchema.extend({
    policyId: nonEmptyString,
    policyVersion: nonEmptyString,
    probabilities: z.array(z.object({
        actionKey: decisionActionKeySchema,
        probability: z.number().finite(),
    }).strict()),
}).strict();

export const predictionArtifactSchema = bindingSchema.extend({
    artifactVersion: nonEmptyString,
    objective: nonEmptyString,
    rewardDefinitionVersion: nonEmptyString,
    horizonMs: z.number().int().nonnegative(),
    predictions: z.array(z.object({
        actionKey: decisionActionKeySchema,
        qHat: z.number().finite(),
    }).strict()),
}).strict();

export const opeObservationSchema = z.object({
    datasetVersion: nonEmptyString,
    decisionLog: z.unknown(),
    decisionLogSha256: sha256,
    loggedAction: z.unknown(),
    outcome: z.unknown(),
    behaviorSupport: behaviorSupportEvidenceSchema,
    targetPolicy: targetPolicyDistributionSchema,
    predictionArtifact: predictionArtifactSchema.optional(),
    segments: z.record(z.string(), segmentValue).optional(),
}).strict();

const primitiveWeightsSchema = z.object({
    click: z.number().finite(),
    like: z.number().finite(),
    reply: z.number().finite(),
    repost: z.number().finite(),
    quote: z.number().finite(),
    share: z.number().finite(),
    dismiss: z.number().finite(),
    blockAuthor: z.number().finite(),
    report: z.number().finite(),
}).strict();

export const opeRewardDefinitionSchema = z.object({
    objective: nonEmptyString,
    definitionVersion: nonEmptyString,
    horizonMs: z.number().int().nonnegative(),
    weights: primitiveWeightsSchema,
    dwell: z.object({
        weight: z.number().finite(),
        capMs: z.number().finite().nonnegative(),
        scaleMs: z.number().finite().positive(),
    }).strict(),
}).strict();

export const opeEvaluationConfigSchema = z.object({
    datasetVersion: nonEmptyString,
    outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
    behaviorPolicy: z.object({
        policyId: nonEmptyString,
        policyVersion: nonEmptyString,
    }).strict(),
    targetPolicy: z.object({
        policyId: nonEmptyString,
        policyVersion: nonEmptyString,
    }).strict(),
    decisionVersions: z.object({
        pipeline: nonEmptyString,
        strategy: nonEmptyString,
        policy: nonEmptyString,
        graph: nonEmptyString,
        model: nonEmptyString,
        artifact: nonEmptyString,
        index: nonEmptyString,
    }).strict(),
    rewardDefinition: opeRewardDefinitionSchema,
    expectedPredictionArtifactVersion: nonEmptyString,
    clip: z.number().finite().positive(),
    segmentKeys: z.array(nonEmptyString),
}).strict();

export const opeEvaluationInputSchema = z.object({
    contractVersion: z.literal(OPE_EVALUATION_VERSION),
    config: opeEvaluationConfigSchema,
    observations: z.array(opeObservationSchema),
}).strict();

export type OpeEvaluationInputV1 = z.input<typeof opeEvaluationInputSchema>;
export type OpeEvaluationConfigV1 = z.infer<typeof opeEvaluationConfigSchema>;
export type OpeObservationV1 = z.infer<typeof opeObservationSchema>;
export type BehaviorSupportEvidenceV1 = z.infer<typeof behaviorSupportEvidenceSchema>;
export type PredictionArtifactV1 = z.infer<typeof predictionArtifactSchema>;

export type ClusteredVariance =
    | { status: 'evaluated'; variance: number }
    | { status: 'unavailable'; reason: string };

export type EstimatorResult =
    | { status: 'evaluated'; estimate: number; clusteredVariance: ClusteredVariance }
    | { status: 'not_evaluable'; blockers: string[] };

export type EffectiveSampleSize =
    | { status: 'evaluated'; value: number }
    | { status: 'unavailable'; reason: string };

export type OpeSegmentSliceV1 = {
    segmentKey: string;
    segmentValue: string;
    status: 'evaluated' | 'partial';
    observations: {
        total: number;
        accepted: number;
        rejected: 0;
        coverage: 1;
        uniqueDecisionClusters: number;
        rejectedReasonCounts: Record<string, never>;
    };
    estimators: {
        ips: EstimatorResult;
        clippedIps: EstimatorResult;
        snips: EstimatorResult;
        dr: EstimatorResult;
    };
    diagnostics: {
        effectiveSampleSize: EffectiveSampleSize;
        maxWeight: number | null;
        clippingRate: number | null;
    };
};

export type OpeEvaluationResultV1 = {
    contractVersion: typeof OPE_EVALUATION_VERSION;
    status: 'evaluated' | 'partial' | 'not_evaluable';
    primaryBlocker?: string;
    observations: {
        total: number;
        accepted: number;
        rejected: number;
        coverage: number;
        uniqueDecisionClusters: number;
        rejectedReasonCounts: Record<string, number>;
    };
    estimators: {
        ips: EstimatorResult;
        clippedIps: EstimatorResult;
        snips: EstimatorResult;
        dr: EstimatorResult;
    };
    diagnostics: {
        effectiveSampleSize: EffectiveSampleSize;
        maxWeight: number | null;
        clippingRate: number | null;
    };
    confidenceIntervals: { status: 'unavailable_v1' };
    segments: OpeSegmentSliceV1[];
    bindings: {
        status: 'bound';
        datasetVersion: string;
        outcomeContractVersion: typeof OUTCOME_CONTRACT_VERSION;
        behaviorPolicy: { policyId: string; policyVersion: string };
        targetPolicy: { policyId: string; policyVersion: string };
        decisionVersions: OpeEvaluationConfigV1['decisionVersions'];
        rewardDefinition: OpeEvaluationConfigV1['rewardDefinition'];
        predictionArtifactVersion: string;
    } | { status: 'unavailable'; reason: string };
    behaviorSupport: {
        status: 'complete' | 'incomplete';
        completeObservations: number;
        totalObservations: number;
        coverage: number;
        reasonCounts: Record<string, number>;
    };
    fingerprints: {
        status: 'bound';
        inputSha256: string;
        evaluationSha256: string;
    } | {
        status: 'unavailable';
        reason: 'input_not_canonicalizable';
    };
};
