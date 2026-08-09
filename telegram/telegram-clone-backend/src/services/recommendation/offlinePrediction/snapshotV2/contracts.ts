import { z } from 'zod';

import {
  candidateNamespaceSchema,
  versionEvidenceSchema,
} from '../../decisionLog/contracts';
import type { EncodedOfflineActionFeatureV1 } from '../features/encode';
import {
  canonicalUtcMillisSchema,
  OFFLINE_FEATURE_SCHEMA_VERSION,
  offlineFeatureInputSchema,
} from '../features/encode';
import type {
  ByteStreamFactoryV2,
  VerifiedTargetDistributionEvidenceV2,
} from '../targetEvidence';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1);
const count = z.number().int().nonnegative();
const versionsSchema = z.object({
  pipeline: versionEvidenceSchema,
  strategy: versionEvidenceSchema,
  policy: versionEvidenceSchema,
  graph: versionEvidenceSchema,
  model: versionEvidenceSchema,
  artifact: versionEvidenceSchema,
  index: versionEvidenceSchema,
}).strict();

const decisionStartSchema = z.object({
  recordType: z.literal('decision_start'),
  contractVersion: z.literal('full_support_pit_action_snapshot_v2'),
  decisionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decisionAt: canonicalUtcMillisSchema,
  decisionLogSha256: sha256,
  candidatePoolSha256: sha256,
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  featureDependency: z.enum(['candidate_position_only_v1', 'prefix_dependent']),
  versions: versionsSchema,
  expectedCandidateCount: z.number().int().min(1).max(2048),
  historicalBackfill: z.literal('unavailable'),
  futureShadowCapture: z.literal('code_ready_activation_blocked'),
  servable: z.literal(false),
}).strict();

const candidateBaseSchema = z.object({
  recordType: z.literal('candidate_base'),
  decisionId: z.string().uuid(),
  candidateNamespace: candidateNamespaceSchema,
  candidateId: nonEmpty,
  poolRank: z.number().int().positive(),
  featureAt: canonicalUtcMillisSchema,
  availableAt: canonicalUtcMillisSchema,
  featureInput: offlineFeatureInputSchema,
  sourceVersion: nonEmpty,
  sourceSha256: sha256,
}).strict();

const decisionEndSchema = z.object({
  recordType: z.literal('decision_end'),
  decisionId: z.string().uuid(),
  candidateBaseCount: z.number().int().min(1).max(2048),
  decisionRecordsSha256: sha256,
}).strict();

export const fullSupportPitActionSnapshotRecordV2Schema = z.discriminatedUnion('recordType', [
  decisionStartSchema,
  candidateBaseSchema,
  decisionEndSchema,
]);

export const fullSupportPitActionSnapshotManifestV2Schema = z.object({
  contractVersion: z.literal('full_support_pit_action_snapshot_manifest_v2'),
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  snapshotNdjsonSha256: sha256,
  targetDistributionNdjsonSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  decisionCount: count,
  candidateBaseCount: count,
  physicalRecordCount: count,
  maxCandidateMembershipCount: z.number().int().min(0).max(2048),
  historicalBackfill: z.literal('unavailable'),
  futureShadowCapture: z.literal('code_ready_activation_blocked'),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  snapshotManifestSha256: sha256,
}).strict();

export type FullSupportPitActionSnapshotRecordV2 = z.infer<
  typeof fullSupportPitActionSnapshotRecordV2Schema
>;
export type FullSupportPitActionSnapshotManifestV2 = z.infer<
  typeof fullSupportPitActionSnapshotManifestV2Schema
>;

export type VerifyFullSupportPitActionSnapshotInputV2 = {
  sourceKind: 'synthetic_fixture' | 'future_shadow' | 'historical_backfill';
  snapshotStream: ByteStreamFactoryV2;
  manifestRaw: string;
  targetEvidence: VerifiedTargetDistributionEvidenceV2;
};

export type VerifiedFullSupportPitActionSnapshotV2 = {
  contractVersion: 'verified_full_support_pit_action_snapshot_v2';
  manifest: FullSupportPitActionSnapshotManifestV2;
  targetDistributionNdjsonSha256: string;
  historicalBackfill: 'unavailable';
  futureShadowCapture: 'code_ready_activation_blocked';
  realDatasetEligible: false;
  servable: false;
};

export type ExpandedSnapshotPositionFeatureV2 = {
  decisionId: string;
  servedPosition: number;
  row: EncodedOfflineActionFeatureV1;
};

export type SnapshotPositionReplayTransactionV2 = {
  onPositionFeature: (
    feature: ExpandedSnapshotPositionFeatureV2,
  ) => Promise<void> | void;
  commit: () => Promise<void> | void;
  abort: (blocker: string) => Promise<void> | void;
};

export type VerifyFullSupportPitActionSnapshotResultV2 =
  | { status: 'verified'; snapshot: VerifiedFullSupportPitActionSnapshotV2 }
  | { status: 'not_evaluable'; blocker: string };

export type AtomicCanonicalNdjsonPublishInputV1 = {
  targetPath: string;
  records: AsyncIterable<unknown> | Iterable<unknown>;
  expectedSha256: string;
  expectedRecordCount: number;
};

export type AtomicCanonicalNdjsonPublishResultV1 =
  | {
    status: 'published';
    durability: 'confirmed';
    sha256: string;
    recordCount: number;
  }
  | {
    status: 'published_durability_unconfirmed';
    durability: 'unconfirmed';
    reason:
      | 'temporary_cleanup_failed'
      | 'parent_directory_sync_failed'
      | 'temporary_cleanup_and_parent_directory_sync_failed';
    sha256: string;
    recordCount: number;
  };
