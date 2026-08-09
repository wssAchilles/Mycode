import { z } from 'zod';

import { decisionActionKeySchema } from '../../decisionLog/contracts';
import {
  SYNTHETIC_CLUSTER_UNIT_VERSION,
  VIEWER_CLUSTER_UNIT_VERSION,
} from '../../decisionContext/contracts';
import { OUTCOME_CONTRACT_VERSION } from '../../outcomes/contracts';
import { opeRewardDefinitionSchema } from '../contracts';

export const OPE_EVALUATION_V2_VERSION = 'ope_evaluation_v2' as const;
export const OPE_V2_ESTIMAND = 'mean_reward_per_logged_slot_v1' as const;
export const OPE_V2_CI_METHOD = 'decision_cluster_robust_wald' as const;
export const OPE_V2_CI_VERSION = 'decision_cluster_robust_wald_v1' as const;
export const OPE_V2_PROJECTION_VERSION = 'ope_verified_projection_v2' as const;
export const OPE_V2_RESOURCE_LIMITS = { maxDecisions: 100_000, maxSlots: 500_000, maxActions: 2_048, maxPrefixActions: 63, maxSegments: 256 } as const;

const text = z.string().trim().min(1).max(256);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const canonicalUuid = z.string().uuid().refine((value) => value === value.toLowerCase(), { message: 'uuid_not_canonical' });
const policy = z.object({ policyId: text, policyVersion: text }).strict();
const versions = z.object({ pipeline: text, strategy: text, policy: text, graph: text, model: text, artifact: text, index: text }).strict();
const action = decisionActionKeySchema;
const distributionEntry = z.object({ actionKey: action, probability: finite }).strict();
const binding = z.object({
  decisionId: canonicalUuid,
  datasetVersion: text,
  decisionLogSha256: sha,
  candidatePoolSha256: sha,
  requestId: canonicalUuid,
  contextAt: timestamp,
  availableAt: timestamp,
  sourceSha256: sha,
  sourceVersion: text,
  inferenceClusterId: text,
  clusterUnitVersion: z.union([
    z.literal(VIEWER_CLUSTER_UNIT_VERSION),
    z.literal(SYNTHETIC_CLUSTER_UNIT_VERSION),
  ]),
  realDatasetEligible: z.boolean(),
  crossUserDependenceStatus: z.literal('none_observed_in_verified_source_v1'),
  decisionVersion: text.optional(),
  decisionVersions: versions.optional(),
}).strict();
const predictionEvidence = z.object({
  predictionSetVersion: text,
  modelBundleSha256: sha,
  receiptSha256: sha,
  membersSha256: sha.optional(),
  trainingReplaySha256: sha.optional(),
}).strict();

export const opeEvaluationV2ConfigSchema = z.object({
  estimand: z.literal(OPE_V2_ESTIMAND),
  datasetVersion: text,
  outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION),
  behaviorPolicy: policy,
  targetPolicy: policy,
  targetPolicyConfigSha256: sha,
  decisionVersions: versions,
  rewardDefinition: opeRewardDefinitionSchema,
  clip: finite.positive(),
  ci: z.object({ method: z.literal(OPE_V2_CI_METHOD), version: z.literal(OPE_V2_CI_VERSION), level: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]), minDecisionClusters: z.number().int().min(2).max(OPE_V2_RESOURCE_LIMITS.maxDecisions) }).strict(),
  segments: z.array(z.object({ segmentKey: text, segmentValue: text }).strict()).max(OPE_V2_RESOURCE_LIMITS.maxSegments),
  predictionEvidence: predictionEvidence.optional(),
}).strict();

export const opeV2ReportBindingSchema = z.object({
  estimand: z.literal(OPE_V2_ESTIMAND), datasetVersion: text,
  outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION), behaviorPolicy: policy,
  targetPolicy: policy, targetPolicyConfigSha256: sha, decisionVersions: versions,
  rewardDefinition: opeRewardDefinitionSchema, ci: opeEvaluationV2ConfigSchema.shape.ci,
  predictionEvidence: predictionEvidence.optional(),
}).strict();

export const opeSlotV2Schema = z.object({
  decisionId: canonicalUuid,
  servedPosition: z.number().int().min(1).max(64),
  binding,
  loggedActionKey: action,
  prefixActionKeys: z.array(action).max(OPE_V2_RESOURCE_LIMITS.maxPrefixActions),
  outcome: z.object({ reward: finite, outcomeContractVersion: z.literal(OUTCOME_CONTRACT_VERSION).optional() }).strict(),
  behaviorSupport: z.object({
    status: z.literal('logged_randomized'),
    loggedActionProbability: finite.gt(0).lte(1),
    supportActions: z.array(action).min(1).max(OPE_V2_RESOURCE_LIMITS.maxActions),
  }).strict(),
  targetDistribution: z.object({ actions: z.array(distributionEntry).min(1).max(OPE_V2_RESOURCE_LIMITS.maxActions) }).strict(),
  segments: z.record(text, text).optional(),
  prediction: z.object({
    predictionSetVersion: text,
    modelBundleSha256: sha,
    receiptSha256: sha,
    trainingReplaySha256: sha.optional(),
    qHat: z.array(z.object({ actionKey: action, value: finite }).strict()).max(OPE_V2_RESOURCE_LIMITS.maxActions),
  }).strict().optional(),
}).strict();

const opeEvaluationV2InputObjectSchema = z.object({
  contractVersion: z.literal(OPE_EVALUATION_V2_VERSION),
  config: opeEvaluationV2ConfigSchema,
  slots: z.array(opeSlotV2Schema).max(OPE_V2_RESOURCE_LIMITS.maxSlots),
  projectionReceipt: z.object({
    version: z.literal(OPE_V2_PROJECTION_VERSION), projectionSha256: sha,
    targetManifestSha256: sha, targetReceiptSha256: sha,
    outcomeEvidenceSha256: sha, decisionContextEvidenceSha256: sha,
    predictionReceiptSha256: sha.optional(), trainingReplaySha256: sha.optional(),
  }).strict(),
}).strict();

export const opeEvaluationV2InputSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (value.slots !== undefined) return value;
  if (Array.isArray(value.observations)) {
    const { observations: _observations, ...rest } = value;
    return { ...rest, slots: _observations };
  }
  return value;
}, opeEvaluationV2InputObjectSchema);

export const opeEvaluationInputV2Schema = opeEvaluationV2InputSchema;
export const opeEvaluationConfigV2Schema = opeEvaluationV2ConfigSchema;
export const opeObservationV2Schema = opeSlotV2Schema;
export const OPE_ESTIMAND_V2 = OPE_V2_ESTIMAND;

export type OpeEvaluationInputV2 = z.infer<typeof opeEvaluationV2InputSchema>;
export type OpeEvaluationConfigV2 = z.infer<typeof opeEvaluationV2ConfigSchema>;
export type OpeSlotV2 = z.infer<typeof opeSlotV2Schema>;

export type V2Variance = { status: 'evaluated'; variance: number } | { status: 'unavailable'; reason: string };
export type V2Estimator = { status: 'evaluated'; estimate: number; clusteredVariance: V2Variance } | { status: 'not_evaluable'; blockers: string[] };
export type V2Confidence = { status: 'evaluated'; estimate: number; standardError: number; criticalValue: number; halfWidth: number; level: number; method: typeof OPE_V2_CI_METHOD; version: typeof OPE_V2_CI_VERSION; lower: number; upper: number; decisionClusterCount: number } | { status: 'unavailable'; reason: string; decisionClusterCount: number };
export type OpeEvaluationResultV2 = {
  contractVersion: typeof OPE_EVALUATION_V2_VERSION;
  estimand: typeof OPE_V2_ESTIMAND;
  status: 'evaluated' | 'partial' | 'not_evaluable';
  blockers?: string[];
  observations: { total: number; accepted: number; rejected: number; coverage: number; uniqueDecisionClusters: number };
  estimators: { ips: V2Estimator; clippedIps: V2Estimator; snips: V2Estimator; dr: V2Estimator };
  confidenceIntervals: { ips: V2Confidence; clippedIps: V2Confidence; snips: V2Confidence; dr: V2Confidence };
  diagnostics: { effectiveSampleSize: number | null; maxWeight: number | null; clippingRate: number | null; supportCoverage: number; slotCount: number; decisionCount: number };
  segments: Array<{ segmentKey: string; segmentValue: string; status: 'evaluated' | 'partial' | 'not_evaluable'; observations: OpeEvaluationResultV2['observations']; estimators: OpeEvaluationResultV2['estimators']; confidenceIntervals: OpeEvaluationResultV2['confidenceIntervals']; diagnostics: OpeEvaluationResultV2['diagnostics'] }>;
  bindings: z.infer<typeof opeV2ReportBindingSchema> | null;
  fingerprints: { inputSha256: string; evaluationSha256: string; estimand: typeof OPE_V2_ESTIMAND; ciConfigSha256: string; targetPolicyConfigSha256: string } | null;
};

const varianceResultSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('evaluated'), variance: finite.nonnegative() }).strict(), z.object({ status: z.literal('unavailable'), reason: text }).strict()]);
const estimatorResultSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('evaluated'), estimate: finite, clusteredVariance: varianceResultSchema }).strict(), z.object({ status: z.literal('not_evaluable'), blockers: z.array(text).min(1).max(16) }).strict()]);
const confidenceResultSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('evaluated'), estimate: finite, standardError: finite.nonnegative(), criticalValue: finite.positive(), halfWidth: finite.nonnegative(), level: opeEvaluationV2ConfigSchema.shape.ci.shape.level, method: z.literal(OPE_V2_CI_METHOD), version: z.literal(OPE_V2_CI_VERSION), lower: finite, upper: finite, decisionClusterCount: z.number().int().nonnegative() }).strict(), z.object({ status: z.literal('unavailable'), reason: text, decisionClusterCount: z.number().int().nonnegative() }).strict()]);
const estimatorsSchema = z.object({ ips: estimatorResultSchema, clippedIps: estimatorResultSchema, snips: estimatorResultSchema, dr: estimatorResultSchema }).strict();
const intervalsSchema = z.object({ ips: confidenceResultSchema, clippedIps: confidenceResultSchema, snips: confidenceResultSchema, dr: confidenceResultSchema }).strict();
const observationsSchema = z.object({ total: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), coverage: finite.min(0).max(1), uniqueDecisionClusters: z.number().int().nonnegative() }).strict();
const diagnosticsSchema = z.object({ effectiveSampleSize: finite.nonnegative().nullable(), maxWeight: finite.nonnegative().nullable(), clippingRate: finite.min(0).max(1).nullable(), supportCoverage: finite.min(0).max(1), slotCount: z.number().int().nonnegative(), decisionCount: z.number().int().nonnegative() }).strict();
const segmentSchema = z.object({ segmentKey: text, segmentValue: text, status: z.enum(['evaluated', 'partial', 'not_evaluable']), observations: observationsSchema, estimators: estimatorsSchema, confidenceIntervals: intervalsSchema, diagnostics: diagnosticsSchema }).strict();
export const opeEvaluationResultV2Schema = z.object({
  contractVersion: z.literal(OPE_EVALUATION_V2_VERSION), estimand: z.literal(OPE_V2_ESTIMAND),
  status: z.enum(['evaluated', 'partial', 'not_evaluable']), blockers: z.array(text).max(32).optional(),
  observations: observationsSchema, estimators: estimatorsSchema, confidenceIntervals: intervalsSchema,
  diagnostics: diagnosticsSchema, segments: z.array(segmentSchema).max(OPE_V2_RESOURCE_LIMITS.maxSegments),
  bindings: opeV2ReportBindingSchema.nullable(),
  fingerprints: z.object({ inputSha256: sha, evaluationSha256: sha, estimand: z.literal(OPE_V2_ESTIMAND), ciConfigSha256: sha, targetPolicyConfigSha256: sha }).strict().nullable(),
}).strict();
