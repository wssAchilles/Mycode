import { z } from 'zod';

export const PROMOTION_STATISTICAL_READINESS_V1 = 'promotion_statistical_readiness_v1' as const;
export const INTERSECTION_UNION_METHOD_V1 = 'intersection_union_all_must_pass_v1' as const;

const text = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const canonicalUuid = z.string().uuid().refine((value) => value === value.toLowerCase(), { message: 'uuid_not_canonical' });
const decisionSet = z.array(canonicalUuid).min(1).max(100_000);

export const promotionStatisticalReadinessInputV1Schema = z.object({
  contractVersion: z.literal(PROMOTION_STATISTICAL_READINESS_V1),
  method: z.literal(INTERSECTION_UNION_METHOD_V1),
  sealedHypothesisManifestSha256: sha256,
  frozenAt: timestamp,
  holdoutRevealedAt: timestamp,
  candidatePolicies: z.array(z.object({ policyId: text, policyVersion: text }).strict()).min(1).max(64),
  objectives: z.array(text).min(1).max(64),
  segments: z.array(z.object({ segmentKey: text, segmentValue: text }).strict()).max(256),
  trainingDecisionIds: decisionSet,
  holdoutDecisionIds: decisionSet,
  holdoutUseEvidence: z.discriminatedUnion('status', [
    z.object({ status: z.literal('missing') }).strict(),
    z.object({ status: z.literal('self_asserted'), receiptSha256: sha256 }).strict(),
  ]),
}).strict();

export type PromotionStatisticalReadinessInputV1 = z.infer<typeof promotionStatisticalReadinessInputV1Schema>;
