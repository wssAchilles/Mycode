import { z } from 'zod';

import { OUTCOME_CONTRACT_VERSION } from '../../outcomes/contracts';
import { OPE_V2_ESTIMAND, OPE_EVALUATION_V2_VERSION, opeEvaluationResultV2Schema, opeV2ReportBindingSchema } from '../../ope/v2/contracts';

export const RANKING_PROMOTION_POLICY_V2_VERSION = 'ranking_promotion_policy_v2' as const;
export const RANKING_PROMOTION_FIXED_BLOCKERS_V2 = ['multiplicity_control_unavailable', 'task9_unauthorized'] as const;
export const RANKING_PROMOTION_POLICY_VERSION_V2 = RANKING_PROMOTION_POLICY_V2_VERSION;
export const RANKING_PROMOTION_FIXED_BLOCKERS = RANKING_PROMOTION_FIXED_BLOCKERS_V2;
const text = z.string().trim().min(1).max(256);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const policyRef = z.object({ policyId: text, policyVersion: text }).strict();
const constraint = z.object({ kind: z.enum(['quality', 'safety']), objective: text, estimator: z.enum(['ips', 'clippedIps', 'snips', 'dr']), operator: z.enum(['gte', 'lte']), threshold: finite }).strict();
const guardrail = constraint.extend({ segmentKey: text, value: text, minimumESS: finite.nonnegative() });

export const rankingPromotionPolicyV2Schema = z.object({
  contractVersion: z.literal(RANKING_PROMOTION_POLICY_V2_VERSION), policyId: text, policyVersion: text,
  estimand: z.literal(OPE_V2_ESTIMAND), bindings: opeV2ReportBindingSchema, targetPolicyFingerprint: sha,
  minimumSupportCoverage: finite.min(0).max(1), minimumEffectiveSampleSize: finite.nonnegative(),
  candidateConfidenceInterval: z.object({ level: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]), maxHalfWidth: finite.positive() }).strict(),
  constraints: z.array(constraint).max(64), segmentGuardrails: z.array(guardrail).max(128),
}).strict();

export const rankingPromotionPolicyV2InputSchema = z.object({
  policy: rankingPromotionPolicyV2Schema,
  evidence: z.object({
    opeReports: z.array(z.object({ objective: text, targetPolicyFingerprint: sha, report: opeEvaluationResultV2Schema }).strict()).min(1).max(16),
    targetPolicyFingerprint: sha,
    rollback: z.discriminatedUnion('status', [z.object({ status: z.literal('missing') }).strict(), z.object({ status: z.literal('verified'), policySha256: sha, evidenceSha256: sha }).strict()]),
    independentApproval: z.discriminatedUnion('status', [z.object({ status: z.literal('missing') }).strict(), z.object({ status: z.literal('verified'), policySha256: sha, evidenceSha256: sha, preparedBy: text, approvedBy: text }).strict()]),
  }).strict(),
}).strict();

export type RankingPromotionPolicyInputV2 = z.infer<typeof rankingPromotionPolicyV2InputSchema>;
export type RankingPromotionPolicyV2 = z.infer<typeof rankingPromotionPolicyV2Schema>;
export type RankingPromotionPolicyResultV2 = {
  contractVersion: typeof RANKING_PROMOTION_POLICY_V2_VERSION; verdict: 'blocked'; blockers: string[];
  policySha256: string | null; evidenceSha256: string | null; bindings: RankingPromotionPolicyV2['bindings'] | null;
  diagnostics: { reportObjectives: string[]; variableBlockers: string[] };
};

export { OPE_EVALUATION_V2_VERSION };
