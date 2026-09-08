import { z } from 'zod';

import {
  HOLM_STEP_DOWN_V1,
  INTERSECTION_UNION_ALL_MUST_PASS_V1,
} from '../../../ope/inference/directionalV2';

export const FROZEN_POLICY_EVALUATION_FAMILY_V2 = 'frozen_policy_evaluation_family_v2' as const;
export const SLOT_MEAN_ESTIMAND_V1 = 'mean_reward_per_logged_slot_v1' as const;

const text = z.string().min(1).max(256).refine((value) => value.trim() === value);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const frozenPolicyEvaluationFamilyV2Schema = z.object({
  contractVersion: z.literal(FROZEN_POLICY_EVALUATION_FAMILY_V2),
  familyId: text,
  candidatePolicy: z.object({
    policyId: text,
    policyVersion: text,
    policyConfigSha256: sha256,
  }).strict(),
  estimand: z.literal(SLOT_MEAN_ESTIMAND_V1),
  hypotheses: z.array(z.object({
    hypothesisId: text,
    objective: text,
    segment: text,
    direction: z.enum(['greater', 'less']),
    nullThreshold: z.number().finite(),
    alternative: z.enum(['theta_greater_than_null_v1', 'theta_less_than_null_v1']),
  }).strict()).min(1).max(64),
  familyAlpha: z.number().finite().gt(0).lt(1),
  procedure: z.enum([HOLM_STEP_DOWN_V1, INTERSECTION_UNION_ALL_MUST_PASS_V1]),
  bootstrapReplicates: z.number().int().positive().max(100_000),
  bootstrapSeedMaterial: z.string().min(16).max(512),
  qualificationProtocolSha256: sha256,
  dataset: z.object({ datasetId: text, datasetSha256: sha256 }).strict(),
  holdout: z.object({ holdoutId: text, holdoutSha256: sha256 }).strict(),
  configBindings: z.array(z.object({ bindingId: text, sha256 }).strict()).min(1).max(64),
  frozenAt: timestamp,
  holdoutRevealNotBefore: timestamp,
  realDatasetEligible: z.literal(false),
  familySha256: sha256,
}).strict();

export type FrozenPolicyEvaluationFamilyV2 = z.infer<typeof frozenPolicyEvaluationFamilyV2Schema>;
