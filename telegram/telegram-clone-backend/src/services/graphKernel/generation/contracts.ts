import { z } from 'zod';

export const GENERATION_SIGNAL_COUNT_FIELDS = [
  'followCount',
  'likeCount',
  'replyCount',
  'retweetCount',
  'quoteCount',
  'mentionCount',
  'profileViewCount',
  'tweetClickCount',
  'dwellTimeMs',
  'addressBookCount',
  'directMessageCount',
  'coEngagementCount',
  'contentAffinityCount',
  'muteCount',
  'blockCount',
  'reportCount',
] as const;

export type GenerationSignalCountField = typeof GENERATION_SIGNAL_COUNT_FIELDS[number];
export type GenerationSignalCounts = Record<GenerationSignalCountField, number>;

export interface GenerationEdge {
  sourceUserId: string;
  targetUserId: string;
  edgeId: string;
  decayedSum: number;
  interactionProbability: number;
  dailySignalCounts: Partial<GenerationSignalCounts>;
  rollupSignalCounts: Partial<GenerationSignalCounts>;
  edgeKinds: string[];
  lastInteractionAtMs?: number | null;
  updatedAtMs?: number | null;
}

export type GenerationStatus = 'building' | 'ready' | 'quarantined';

export interface GenerationManifest {
  generationId: string;
  contentVersion: string;
  status: GenerationStatus;
  controlRevision?: number;
  edgeCount: number;
  canonicalSha256: string;
  createdAt: Date;
  diagnostic?: string;
}

export interface GenerationPointer {
  activeGenerationId: string | null;
  previousGenerationId: string | null;
}

export interface GenerationCursor {
  generationId: string;
  afterSourceUserId: string;
  afterTargetUserId: string;
  afterEdgeId: string;
}

export interface GenerationLease {
  generationId: string;
  leaseId: string;
  expiresAt: Date;
}

export interface GenerationWireManifest extends Omit<
  GenerationManifest,
  'createdAt' | 'status' | 'controlRevision'
> {
  status: 'ready';
  createdAt: number;
}

export type GenerationPageRequest =
  | { limit: number; leaseId?: never; cursor?: never }
  | { limit: number; leaseId: string; cursor: GenerationCursor };

export interface GenerationPage {
  generationId: string;
  leaseId: string;
  expiresAt: number;
  manifest: GenerationWireManifest;
  edges: GenerationEdge[];
  nextCursor: GenerationCursor | null;
  done: boolean;
}

export interface GenerationGarbageCollectionPlan {
  dryRun: true;
  serverNow: Date;
  retainedGenerationIds: string[];
  candidateGenerationIds: string[];
}

export interface GenerationGarbageCollectionSnapshot {
  pointer: GenerationPointer;
  generationIds: string[];
  buildingGenerationIds: string[];
  unexpiredLeaseGenerationIds: string[];
}

const generationIdSchema = z.string().regex(/^graph_generation_v2:[a-f0-9]{64}$/);
const nonBlankOpaqueString = z.string().min(1).refine((value) => value.trim().length > 0);
const generationPageLimitSchema = z.number().int().min(1).max(5000);

export const generationCursorSchema = z.strictObject({
  generationId: generationIdSchema,
  afterSourceUserId: nonBlankOpaqueString,
  afterTargetUserId: nonBlankOpaqueString,
  afterEdgeId: nonBlankOpaqueString,
});

export const generationPageRequestSchema = z.union([
  z.strictObject({ limit: generationPageLimitSchema }),
  z.strictObject({
    limit: generationPageLimitSchema,
    leaseId: nonBlankOpaqueString,
    cursor: generationCursorSchema,
  }),
]);

export const generationReleaseRequestSchema = z.strictObject({
  generationId: generationIdSchema,
  leaseId: nonBlankOpaqueString,
});
