import { createHash } from 'crypto';

import { z } from 'zod';

import {
  canonicalDecisionJson,
  decisionActionKeySchema,
} from '../../decisionLog/contracts';
import {
  buildSocialPhoenixFeatureMapAt,
  type SocialPhoenixFeatureInput,
} from '../../socialPhoenix/featureEngineering';

export const OFFLINE_FEATURE_SCHEMA_VERSION =
  'social_phoenix_action_position_1_based_v1' as const;

export const canonicalUtcMillisSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
});

const finiteOptional = z.number().finite().optional();
export const offlineFeatureInputSchema = z.object({
  userState: z.enum(['cold_start', 'sparse', 'warm', 'heavy', 'unknown']).optional(),
  embeddingQualityScore: finiteOptional,
  recallSource: z.string().trim().min(1).optional(),
  inNetwork: z.boolean().optional(),
  authorAffinityScore: finiteOptional,
  retrievalEmbeddingScore: finiteOptional,
  retrievalDenseVectorScore: finiteOptional,
  retrievalAuthorClusterScore: finiteOptional,
  retrievalCandidateClusterScore: finiteOptional,
  retrievalKeywordScore: finiteOptional,
  retrievalEngagementPrior: finiteOptional,
  retrievalSnapshotQuality: finiteOptional,
  likeCount: finiteOptional,
  commentCount: finiteOptional,
  repostCount: finiteOptional,
  createdAt: canonicalUtcMillisSchema,
  hasImage: z.boolean().optional(),
  hasVideo: z.boolean().optional(),
}).strict();

const inputSchema = z.object({
  decisionId: z.string().uuid(),
  actionKey: decisionActionKeySchema.refine(
    (key) => key.servedPosition <= 64,
    { message: 'served_position_out_of_range' },
  ),
  decisionAt: canonicalUtcMillisSchema,
  featureAt: canonicalUtcMillisSchema,
  referenceAt: canonicalUtcMillisSchema,
  featureInput: offlineFeatureInputSchema,
}).strict();

export type EncodedOfflineActionFeatureV1 = {
  featureSchemaVersion: typeof OFFLINE_FEATURE_SCHEMA_VERSION;
  decisionId: string;
  actionKey: z.infer<typeof decisionActionKeySchema>;
  decisionAt: string;
  featureAt: string;
  features: Record<string, number>;
  sourceSha256: string;
};

export type EncodeOfflineActionFeaturesResultV1 =
  | { status: 'encoded'; row: EncodedOfflineActionFeatureV1 }
  | {
    status: 'not_evaluable';
    blocker:
      | 'invalid_input'
      | 'invalid_timestamp'
      | 'reference_time_mismatch'
      | 'feature_after_decision'
      | 'created_after_decision';
  };

function containsNonCanonicalTimestamp(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  const createdAt = record.featureInput && typeof record.featureInput === 'object'
    ? (record.featureInput as Record<string, unknown>).createdAt
    : undefined;
  return [record.decisionAt, record.featureAt, record.referenceAt, createdAt]
    .some((value) => typeof value === 'string' && !canonicalUtcMillisSchema.safeParse(value).success);
}

export function encodeOfflineActionFeaturesV1(
  raw: unknown,
): EncodeOfflineActionFeaturesResultV1 {
  if (containsNonCanonicalTimestamp(raw)) {
    return { status: 'not_evaluable', blocker: 'invalid_timestamp' };
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: 'not_evaluable', blocker: 'invalid_input' };
  const input = parsed.data;
  const decisionMs = Date.parse(input.decisionAt);
  if (input.referenceAt !== input.decisionAt) {
    return { status: 'not_evaluable', blocker: 'reference_time_mismatch' };
  }
  if (Date.parse(input.featureAt) > decisionMs) {
    return { status: 'not_evaluable', blocker: 'feature_after_decision' };
  }
  if (Date.parse(input.featureInput.createdAt) > decisionMs) {
    return { status: 'not_evaluable', blocker: 'created_after_decision' };
  }

  const built = buildSocialPhoenixFeatureMapAt(
    input.featureInput as SocialPhoenixFeatureInput,
    input.referenceAt,
  );
  const features = Object.fromEntries(
    Object.entries({
      ...built,
      [`served_position:${input.actionKey.servedPosition}`]: 1,
    })
      .filter(([key]) => key !== 'bias')
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  );
  const rowWithoutDigest = {
    featureSchemaVersion: OFFLINE_FEATURE_SCHEMA_VERSION,
    decisionId: input.decisionId.toLowerCase(),
    actionKey: input.actionKey,
    decisionAt: input.decisionAt,
    featureAt: input.featureAt,
    features,
  };
  return {
    status: 'encoded',
    row: {
      ...rowWithoutDigest,
      sourceSha256: createHash('sha256')
        .update(canonicalDecisionJson({
          ...rowWithoutDigest,
          referenceAt: input.referenceAt,
          featureInput: input.featureInput,
        }))
        .digest('hex'),
    },
  };
}
