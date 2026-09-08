import { z } from 'zod';

import { OUTCOME_CONTRACT_VERSION } from '../outcomes/contracts';
import { OPE_EVALUATION_VERSION, opeRewardDefinitionSchema } from '../ope/contracts';

export const RANKING_PROMOTION_POLICY_VERSION = 'ranking_promotion_policy_v1' as const;
export const RANKING_PROMOTION_FIXED_BLOCKERS = ['missing_ci', 'task9_unauthorized'] as const;
export const RANKING_PROMOTION_RESOURCE_LIMITS = {
  maxStringLength: 256,
  maxReports: 16,
  maxSegmentsPerReport: 256,
  maxConstraints: 64,
  maxSegmentGuardrails: 128,
  maxReasonEntries: 64,
  maxEstimatorBlockers: 32,
} as const;

const nonEmpty = z.string().trim().min(1).max(RANKING_PROMOTION_RESOURCE_LIMITS.maxStringLength);
const reasonKey = z.string()
  .min(1)
  .max(RANKING_PROMOTION_RESOURCE_LIMITS.maxStringLength)
  .refine((value) => value.trim().length > 0);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const count = z.number().int().nonnegative();
const policyRefSchema = z.object({ policyId: nonEmpty, policyVersion: nonEmpty }).strict();
const decisionVersionsSchema = z.object({
  pipeline: nonEmpty, strategy: nonEmpty, policy: nonEmpty, graph: nonEmpty,
  model: nonEmpty, artifact: nonEmpty, index: nonEmpty,
}).strict();
const clusteredVarianceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('evaluated'), variance: finite.nonnegative() }).strict(),
  z.object({ status: z.literal('unavailable'), reason: nonEmpty }).strict(),
]);
const estimatorSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('evaluated'), estimate: finite, clusteredVariance: clusteredVarianceSchema }).strict(),
  z.object({
    status: z.literal('not_evaluable'),
    blockers: z.array(nonEmpty).max(RANKING_PROMOTION_RESOURCE_LIMITS.maxEstimatorBlockers),
  }).strict(),
]);
const effectiveSampleSizeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('evaluated'), value: finite.nonnegative() }).strict(),
  z.object({ status: z.literal('unavailable'), reason: nonEmpty }).strict(),
]);
const reportBindingsSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('bound'), datasetVersion: nonEmpty,
    outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
    behaviorPolicy: policyRefSchema, targetPolicy: policyRefSchema,
    decisionVersions: decisionVersionsSchema,
    rewardDefinition: opeRewardDefinitionSchema.extend({
      objective: nonEmpty,
      definitionVersion: nonEmpty,
    }).strict(),
    predictionArtifactVersion: nonEmpty,
  }).strict(),
  z.object({ status: z.literal('unavailable'), reason: nonEmpty }).strict(),
]);
const reportFingerprintSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('bound'), inputSha256: sha256, evaluationSha256: sha256 }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.literal('input_not_canonicalizable') }).strict(),
]);
const reasonCountsSchema = z.record(reasonKey, count).refine(
  (value) => Object.keys(value).length <= RANKING_PROMOTION_RESOURCE_LIMITS.maxReasonEntries,
  { message: 'reason_entries_limit_exceeded' },
);
const reportSummarySchema = z.object({
  total: count, accepted: count, rejected: count, coverage: finite.min(0).max(1),
  uniqueDecisionClusters: count, rejectedReasonCounts: reasonCountsSchema,
}).strict();
const reportDiagnosticsSchema = z.object({
  effectiveSampleSize: effectiveSampleSizeSchema, maxWeight: finite.nullable(), clippingRate: finite.nullable(),
}).strict();
const reportEstimatorsSchema = z.object({ ips: estimatorSchema, clippedIps: estimatorSchema, snips: estimatorSchema, dr: estimatorSchema }).strict();
const reportSegmentSchema = z.object({
  segmentKey: nonEmpty, segmentValue: nonEmpty, status: z.enum(['evaluated', 'partial']),
  observations: reportSummarySchema, estimators: reportEstimatorsSchema, diagnostics: reportDiagnosticsSchema,
}).strict();

// Projection: required Task5 OPE fields are validated; irrelevant top-level fields are stripped.
export const opeEvaluationResultProjectionSchema = z.object({
  contractVersion: z.literal(OPE_EVALUATION_VERSION), status: z.enum(['evaluated', 'partial', 'not_evaluable']),
  observations: reportSummarySchema, estimators: reportEstimatorsSchema, diagnostics: reportDiagnosticsSchema,
  confidenceIntervals: z.object({ status: z.literal('unavailable_v1') }).strict(),
  segments: z.array(reportSegmentSchema).max(RANKING_PROMOTION_RESOURCE_LIMITS.maxSegmentsPerReport),
  bindings: reportBindingsSchema,
  behaviorSupport: z.object({
    status: z.enum(['complete', 'incomplete']), completeObservations: z.number().int().nonnegative(),
    totalObservations: z.number().int().nonnegative(), coverage: finite.min(0).max(1),
    reasonCounts: reasonCountsSchema,
  }).strict(),
  fingerprints: reportFingerprintSchema,
}).strip();

export const rankingPromotionPolicySchema = z.object({
  contractVersion: z.literal(RANKING_PROMOTION_POLICY_VERSION), policyId: nonEmpty, policyVersion: nonEmpty,
  bindings: z.object({
    datasetVersion: nonEmpty, outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
    behaviorPolicy: policyRefSchema, targetPolicy: policyRefSchema, decisionVersions: decisionVersionsSchema,
    predictionArtifactVersion: nonEmpty,
  }).strict(),
  targetPolicyFingerprint: sha256, minimumSupportCoverage: finite.min(0).max(1),
  minimumEffectiveSampleSize: finite.positive(),
  candidateConfidenceInterval: z.object({ level: finite.gt(0).lt(1), maxHalfWidth: finite.positive() }).strict(),
  constraints: z.array(z.object({
    kind: z.enum(['quality', 'safety']), objective: nonEmpty,
    estimator: z.enum(['ips', 'clippedIps', 'snips', 'dr']), operator: z.enum(['gte', 'lte']), threshold: finite,
  }).strict()).max(RANKING_PROMOTION_RESOURCE_LIMITS.maxConstraints),
  segmentGuardrails: z.array(z.object({
    objective: nonEmpty, segmentKey: nonEmpty, value: nonEmpty,
    estimator: z.enum(['ips', 'clippedIps', 'snips', 'dr']), operator: z.enum(['gte', 'lte']),
    threshold: finite, minimumESS: finite.positive(),
  }).strict()).max(RANKING_PROMOTION_RESOURCE_LIMITS.maxSegmentGuardrails),
}).strict();

const verifiedDigestSchema = z.object({ policySha256: sha256, evidenceSha256: sha256 }).strict();
export const rankingPromotionPolicyInputSchema = z.object({
  policy: rankingPromotionPolicySchema,
  evidence: z.object({
    opeReports: z.array(z.object({ objective: nonEmpty, targetPolicyFingerprint: sha256, report: opeEvaluationResultProjectionSchema }).strict())
      .min(1)
      .max(RANKING_PROMOTION_RESOURCE_LIMITS.maxReports),
    targetPolicyFingerprint: sha256,
    rollback: z.discriminatedUnion('status', [
      z.object({ status: z.literal('missing') }).strict(),
      z.object({ status: z.literal('verified'), ...verifiedDigestSchema.shape }).strict(),
    ]),
    independentApproval: z.discriminatedUnion('status', [
      z.object({ status: z.literal('missing') }).strict(),
      z.object({ status: z.literal('verified'), ...verifiedDigestSchema.shape, preparedBy: nonEmpty, approvedBy: nonEmpty }).strict(),
    ]),
  }).strict(),
}).strict();

export type RankingPromotionPolicyInputV1 = z.infer<typeof rankingPromotionPolicyInputSchema>;
export type RankingPromotionPolicyV1 = z.infer<typeof rankingPromotionPolicySchema>;
export type RankingPromotionPolicyResultV1 = {
  contractVersion: typeof RANKING_PROMOTION_POLICY_VERSION;
  verdict: 'blocked';
  blockers: string[];
  policySha256: string | null;
  evidenceSha256: string | null;
  bindings: RankingPromotionPolicyV1['bindings'] | null;
  diagnostics: { reportObjectives: string[]; variableBlockers: string[] };
};
