import { z } from 'zod';

import {
  decisionActionKeySchema,
  recommendationDecisionLogSchema,
} from '../../decisionLog/contracts';
export const TARGET_DISTRIBUTION_MASS_TOLERANCE = 1e-12;

const nonEmpty = z.string().trim().min(1);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();
const probability = z.number().finite().gt(0).lte(1);

export const targetDistributionPolicyConfigSchema = z.object({
  policyId: z.literal('eligible_pool_epsilon_plackett_luce_v1'),
  policyVersion: nonEmpty,
  configVersion: nonEmpty,
  epsilon: z.number().finite().gt(0).lte(1),
  temperature: z.number().finite().gt(0),
  slateSize: z.number().int().min(1).max(64),
}).strict();

export const targetDistributionSourceManifestSchema = z.object({
  contractVersion: z.literal('target_policy_distribution_source_dataset_manifest_v1'),
  schemaVersion: z.literal('recommendation_decision_log_v1'),
  datasetVersion: nonEmpty,
  sourceDecisionNdjsonSha256: sha256,
  decisionCount: z.number().int().positive().max(1_000_000),
  immutableSourceVersion: nonEmpty,
  immutable: z.literal(true),
}).strict();

const decisionStartSchema = z.object({
  recordType: z.literal('decision_start'),
  contractVersion: z.literal('target_policy_distribution_v1'),
  decisionId: z.string().uuid(),
  decisionFingerprint: z.object({
    decisionId: z.string().uuid(),
    sha256,
  }).strict(),
  candidatePoolFingerprint: z.object({ sha256 }).strict(),
  policy: targetDistributionPolicyConfigSchema,
  baselineOrderVersion: z.literal('decision_pool_rank_then_identity_v1'),
  probabilitySemantics: z.literal('conditional_on_prior_slate_prefix_v1'),
  evidenceKind: z.literal('simulated_target_distribution'),
  servable: z.literal(false),
}).strict();

const stepStartSchema = z.object({
  recordType: z.literal('step_start'),
  decisionId: z.string().uuid(),
  servedPosition: z.number().int().min(1).max(64),
  prefixActionKeys: z.array(decisionActionKeySchema).max(63),
  expectedActionCount: z.number().int().min(1).max(2048),
  plackettLuceProbabilityMass: z.number().finite(),
  plackettLuceMassError: z.number().finite().nonnegative(),
  mixedProbabilityMass: z.number().finite(),
  mixedMassError: z.number().finite().nonnegative(),
}).strict();

const actionProbabilitySchema = z.object({
  recordType: z.literal('action_probability'),
  decisionId: z.string().uuid(),
  actionKey: decisionActionKeySchema,
  deterministicTop: z.boolean(),
  plackettLuceProbability: probability,
  conditionalSelectionProbability: probability,
}).strict();

const decisionEndSchema = z.object({
  recordType: z.literal('decision_end'),
  decisionId: z.string().uuid(),
  stepCount: z.number().int().min(1).max(64),
  actionProbabilityCount: count,
  decisionRecordsSha256: sha256,
}).strict();

export const targetDistributionRecordSchema = z.discriminatedUnion('recordType', [
  decisionStartSchema,
  stepStartSchema,
  actionProbabilitySchema,
  decisionEndSchema,
]);

export const targetDistributionManifestSchema = z.object({
  contractVersion: z.literal('target_policy_distribution_manifest_v1'),
  producerVersion: z.literal('telegram_recommendation_policy_offline_v1'),
  datasetVersion: nonEmpty,
  sourceDecisionNdjsonSha256: sha256,
  sourceDatasetManifestSha256: sha256,
  policyConfigSha256: sha256,
  decisionCount: count,
  stepCount: count,
  actionProbabilityCount: count,
  physicalRecordCount: count,
  distributionNdjsonSha256: sha256,
  createdFromImmutableInputs: z.literal(true),
  servable: z.literal(false),
}).strict();

export const targetDistributionReceiptSchema = z.object({
  contractVersion: z.literal('target_policy_distribution_verification_receipt_v1'),
  verifierVersion: z.literal('telegram_recommendation_policy_offline_verifier_v1'),
  status: z.literal('verified'),
  sourceDecisionNdjsonSha256: sha256,
  sourceDatasetManifestSha256: sha256,
  policyConfigSha256: sha256,
  distributionNdjsonSha256: sha256,
  targetManifestSha256: sha256,
  verifiedDecisionCount: count,
  verifiedStepCount: count,
  verifiedActionProbabilityCount: count,
  verifiedPhysicalRecordCount: count,
  verificationReceiptSha256: sha256,
  servable: z.literal(false),
}).strict();

export const targetDistributionStreamReceiptV2Schema = z.object({
  contractVersion: z.literal('target_distribution_stream_verification_receipt_v2'),
  verifierVersion: z.literal('telegram_recommendation_policy_offline_stream_verifier_v2'),
  verifierBuildFingerprintSha256: sha256,
  ioMode: z.literal('bounded_stream_v1'),
  status: z.literal('verified'),
  sourceDecisionNdjsonSha256: sha256,
  sourceDatasetManifestSha256: sha256,
  policyConfigSha256: sha256,
  policyConfigRawSha256: sha256,
  distributionNdjsonSha256: sha256,
  targetManifestSha256: sha256,
  verifiedDecisionCount: count,
  verifiedStepCount: count,
  verifiedActionProbabilityCount: count,
  verifiedPhysicalRecordCount: count,
  highWaterDiagnostics: z.object({
    maxSourceLineBytes: count,
    maxDistributionLineBytes: count,
    maxCandidateCount: z.number().int().min(0).max(2048),
    maxStepActionCount: z.number().int().min(0).max(2048),
    maxPrefixActionCount: z.number().int().min(0).max(63),
  }).strict(),
  verificationReceiptSha256: sha256,
  servable: z.literal(false),
}).strict();

export type TargetDistributionRecordV1 = z.infer<typeof targetDistributionRecordSchema>;
export type TargetDistributionManifestV1 = z.infer<typeof targetDistributionManifestSchema>;
export type TargetDistributionVerificationReceiptV1 = z.infer<typeof targetDistributionReceiptSchema>;
export type TargetDistributionStreamVerificationReceiptV2 = z.infer<
  typeof targetDistributionStreamReceiptV2Schema
>;
export type TargetDistributionSourceManifestV1 = z.infer<typeof targetDistributionSourceManifestSchema>;
export { recommendationDecisionLogSchema };
