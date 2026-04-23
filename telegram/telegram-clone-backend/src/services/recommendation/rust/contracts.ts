import mongoose from 'mongoose';
import { z } from 'zod';
import type { FeedCandidate, CandidateNewsMetadata, PhoenixScores } from '../types/FeedCandidate';
import type {
  ExperimentAssignment,
  ExperimentContext,
} from '../../experiment/types';
import type {
  EmbeddingContext,
  FeedQuery,
  SparseEmbeddingEntry,
  UserFeatures,
  UserStateContext,
} from '../types/FeedQuery';

type SerializedUserFeatures = Omit<UserFeatures, 'accountCreatedAt'> & {
  accountCreatedAt?: string;
};

type SerializedSparseEmbeddingEntry = SparseEmbeddingEntry;

type SerializedEmbeddingContext = Omit<EmbeddingContext, 'computedAt'> & {
  computedAt?: string;
  interestedInClusters: SerializedSparseEmbeddingEntry[];
  producerEmbedding: SerializedSparseEmbeddingEntry[];
};

type SerializedUserStateContext = UserStateContext;

export interface RecommendationExperimentContextPayload {
  userId: string;
  assignments: ExperimentAssignment[];
}

export interface RecommendationQueryPayload {
  requestId: string;
  userId: string;
  limit: number;
  cursor?: string;
  inNetworkOnly: boolean;
  seenIds: string[];
  servedIds: string[];
  isBottomRequest: boolean;
  clientAppId?: number;
  countryCode?: string;
  languageCode?: string;
  userFeatures?: SerializedUserFeatures;
  embeddingContext?: SerializedEmbeddingContext;
  userStateContext?: SerializedUserStateContext;
  userActionSequence?: Array<Record<string, unknown>>;
  newsHistoryExternalIds?: string[];
  modelUserActionSequence?: Array<Record<string, unknown>>;
  experimentContext?: RecommendationExperimentContextPayload;
}

export interface RecommendationQueryPatchPayload {
  userFeatures?: SerializedUserFeatures;
  embeddingContext?: SerializedEmbeddingContext;
  userStateContext?: SerializedUserStateContext;
  userActionSequence?: Array<Record<string, unknown>>;
  newsHistoryExternalIds?: string[];
  modelUserActionSequence?: Array<Record<string, unknown>>;
  experimentContext?: RecommendationExperimentContextPayload;
}

export interface RecommendationCandidatePayload {
  postId: string;
  modelPostId?: string;
  authorId: string;
  content: string;
  createdAt: string;
  conversationId?: string;
  isReply: boolean;
  replyToPostId?: string;
  isRepost: boolean;
  originalPostId?: string;
  inNetwork?: boolean;
  recallSource?: string;
  hasVideo?: boolean;
  hasImage?: boolean;
  videoDurationSec?: number;
  media?: { type: string; url: string; thumbnailUrl?: string }[];
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  viewCount?: number;
  authorUsername?: string;
  authorAvatarUrl?: string;
  authorAffinityScore?: number;
  phoenixScores?: PhoenixScores;
  weightedScore?: number;
  score?: number;
  isLikedByUser?: boolean;
  isRepostedByUser?: boolean;
  isNsfw?: boolean;
  vfResult?: {
    safe: boolean;
    reason?: string;
    level?: string;
    score?: number;
    violations?: string[];
    requiresReview?: boolean;
  };
  isNews?: boolean;
  newsMetadata?: CandidateNewsMetadata;
  isPinned?: boolean;
  _scoreBreakdown?: Record<string, number>;
  _pipelineScore?: number;
  graphScore?: number;
  graphPath?: string;
  graphRecallType?: string;
}

export interface RecommendationStagePayload {
  name: string;
  enabled: boolean;
  durationMs: number;
  inputCount: number;
  outputCount: number;
  removedCount?: number;
  detail?: Record<string, unknown>;
}

export interface RecommendationGraphRetrievalPayload {
  totalCandidates: number;
  kernelCandidates: number;
  legacyCandidates: number;
  fallbackUsed: boolean;
  emptyResult: boolean;
  kernelSourceCounts: Record<string, number>;
  materializerQueryDurationMs?: number;
  materializerProviderLatencyMs?: number;
  materializerCacheHit?: boolean;
  materializerRequestedAuthorCount?: number;
  materializerUniqueAuthorCount?: number;
  materializerReturnedPostCount?: number;
  materializerCacheKeyMode?: string;
  materializerCacheTtlMs?: number;
  materializerCacheEntryCount?: number;
  materializerCacheEvictionCount?: number;
  dominantKernelSource?: string;
  emptyReason?: string;
}

export interface RecommendationRetrievalSummaryPayload {
  stage: string;
  totalCandidates: number;
  inNetworkCandidates: number;
  outOfNetworkCandidates: number;
  mlRetrievedCandidates: number;
  recentHotCandidates: number;
  sourceCounts: Record<string, number>;
  mlSourceCounts: Record<string, number>;
  stageTimings: Record<string, number>;
  degradedReasons: string[];
  graph: RecommendationGraphRetrievalPayload;
}

export interface RecommendationRankingSummaryPayload {
  stage: string;
  inputCandidates: number;
  hydratedCandidates: number;
  filteredCandidates: number;
  scoredCandidates: number;
  mlEligibleCandidates: number;
  mlRankedCandidates: number;
  weightedCandidates: number;
  stageTimings: Record<string, number>;
  filterDropCounts: Record<string, number>;
  degradedReasons: string[];
}

export interface RecommendationSummaryPayload {
  requestId: string;
  stage: string;
  pipelineVersion: string;
  owner: string;
  fallbackMode: string;
  providerCalls: Record<string, number>;
  providerLatencyMs?: Record<string, number>;
  retrievedCount: number;
  selectedCount: number;
  sourceCounts: Record<string, number>;
  filterDropCounts: Record<string, number>;
  stageTimings: Record<string, number>;
  stageLatencyMs: Record<string, number>;
  degradedReasons: string[];
  recentHotApplied: boolean;
  selector: {
    oversampleFactor: number;
    maxSize: number;
    finalLimit: number;
    truncated: boolean;
  };
  serving: {
    servingVersion: string;
    cursorMode: string;
    cursor?: string;
    nextCursor?: string;
    hasMore: boolean;
    servedStateVersion: string;
    stableOrderKey: string;
    duplicateSuppressedCount: number;
    crossPageDuplicateCount: number;
    suppressionReasons: Record<string, number>;
    serveCacheHit: boolean;
    stableOrderDrifted: boolean;
    cacheKeyMode: string;
    cachePolicy: string;
    cachePolicyReason: string;
    pageRemainingCount: number;
    pageUnderfilled: boolean;
    pageUnderfillReason?: string;
  };
  retrieval: RecommendationRetrievalSummaryPayload;
  ranking: RecommendationRankingSummaryPayload;
  stages: RecommendationStagePayload[];
}

export interface RecommendationResultPayload {
  requestId: string;
  servingVersion: string;
  cursor?: string;
  nextCursor?: string;
  hasMore: boolean;
  servedStateVersion: string;
  stableOrderKey: string;
  candidates: RecommendationCandidatePayload[];
  summary: RecommendationSummaryPayload;
}

export interface RecommendationQueryHydratorPatchResponsePayload {
  queryPatch: RecommendationQueryPatchPayload;
  stage: RecommendationStagePayload;
}

export interface RecommendationRetrievalResponsePayload {
  candidates: RecommendationCandidatePayload[];
  stages: RecommendationStagePayload[];
  summary: RecommendationRetrievalSummaryPayload;
}

export interface RecommendationRankingResponsePayload {
  candidates: RecommendationCandidatePayload[];
  stages: RecommendationStagePayload[];
  dropCounts: Record<string, number>;
  summary: RecommendationRankingSummaryPayload;
}

const assignmentSchema = z.object({
  experimentId: z.string().min(1),
  experimentName: z.string().min(1),
  bucket: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  inExperiment: z.boolean(),
});

const experimentContextSchema = z.object({
  userId: z.string().min(1),
  assignments: z.array(assignmentSchema),
});

const userFeaturesSchema = z.object({
  followedUserIds: z.array(z.string()),
  blockedUserIds: z.array(z.string()),
  mutedKeywords: z.array(z.string()),
  seenPostIds: z.array(z.string()),
  followerCount: z.number().optional(),
  accountCreatedAt: z.string().optional(),
});

const sparseEmbeddingEntrySchema = z.object({
  clusterId: z.number().int(),
  score: z.number(),
});

const embeddingContextSchema = z.object({
  interestedInClusters: z.array(sparseEmbeddingEntrySchema),
  producerEmbedding: z.array(sparseEmbeddingEntrySchema),
  knownForCluster: z.number().int().optional(),
  knownForScore: z.number().optional(),
  qualityScore: z.number().optional(),
  computedAt: z.string().optional(),
  version: z.number().int().optional(),
  usable: z.boolean(),
  stale: z.boolean().optional(),
});

const userStateContextSchema = z.object({
  state: z.enum(['cold_start', 'sparse', 'warm', 'heavy']),
  reason: z.string().min(1),
  followedCount: z.number().int().min(0),
  recentActionCount: z.number().int().min(0),
  recentPositiveActionCount: z.number().int().min(0),
  usableEmbedding: z.boolean(),
  accountAgeDays: z.number().int().min(0).optional(),
});

export const recommendationQueryPayloadSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(100),
  cursor: z.string().optional(),
  inNetworkOnly: z.boolean(),
  seenIds: z.array(z.string()).max(200),
  servedIds: z.array(z.string()).max(200),
  isBottomRequest: z.boolean(),
  clientAppId: z.number().int().optional(),
  countryCode: z.string().optional(),
  languageCode: z.string().optional(),
  userFeatures: userFeaturesSchema.optional(),
  embeddingContext: embeddingContextSchema.optional(),
  userStateContext: userStateContextSchema.optional(),
  userActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  newsHistoryExternalIds: z.array(z.string()).optional(),
  modelUserActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  experimentContext: experimentContextSchema.optional(),
});

export const recommendationQueryPatchPayloadSchema = z.object({
  userFeatures: userFeaturesSchema.optional(),
  embeddingContext: embeddingContextSchema.optional(),
  userStateContext: userStateContextSchema.optional(),
  userActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  newsHistoryExternalIds: z.array(z.string()).optional(),
  modelUserActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  experimentContext: experimentContextSchema.optional(),
});

export const recommendationCandidatePayloadSchema = z.object({
  postId: z.string().min(1),
  modelPostId: z.string().optional(),
  authorId: z.string().min(1),
  content: z.string(),
  createdAt: z.string().min(1),
  conversationId: z.string().optional(),
  isReply: z.boolean(),
  replyToPostId: z.string().optional(),
  isRepost: z.boolean(),
  originalPostId: z.string().optional(),
  inNetwork: z.boolean().optional(),
  recallSource: z.string().optional(),
  hasVideo: z.boolean().optional(),
  hasImage: z.boolean().optional(),
  videoDurationSec: z.number().optional(),
  media: z
    .array(
      z.object({
        type: z.string().min(1),
        url: z.string().min(1),
        thumbnailUrl: z.string().optional(),
      }),
    )
    .optional(),
  likeCount: z.number().optional(),
  commentCount: z.number().optional(),
  repostCount: z.number().optional(),
  viewCount: z.number().optional(),
  authorUsername: z.string().optional(),
  authorAvatarUrl: z.string().optional(),
  authorAffinityScore: z.number().optional(),
  phoenixScores: z.record(z.string(), z.number()).optional(),
  weightedScore: z.number().optional(),
  score: z.number().optional(),
  isLikedByUser: z.boolean().optional(),
  isRepostedByUser: z.boolean().optional(),
  isNsfw: z.boolean().optional(),
  vfResult: z
    .object({
      safe: z.boolean(),
      reason: z.string().optional(),
      level: z.string().optional(),
      score: z.number().optional(),
      violations: z.array(z.string()).optional(),
      requiresReview: z.boolean().optional(),
    })
    .optional(),
  isNews: z.boolean().optional(),
  newsMetadata: z
    .object({
      title: z.string().optional(),
      source: z.string().optional(),
      url: z.string().optional(),
      sourceUrl: z.string().optional(),
      externalId: z.string().optional(),
      clusterId: z.number().optional(),
      summary: z.string().optional(),
    })
    .optional(),
  isPinned: z.boolean().optional(),
  _scoreBreakdown: z.record(z.string(), z.number()).optional(),
  _pipelineScore: z.number().optional(),
  graphScore: z.number().optional(),
  graphPath: z.string().optional(),
  graphRecallType: z.string().optional(),
});

const recommendationStagePayloadSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  durationMs: z.number().min(0),
  inputCount: z.number().int().min(0),
  outputCount: z.number().int().min(0),
  removedCount: z.number().int().min(0).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

const recommendationRetrievalSummaryPayloadSchema = z.object({
  stage: z.string().min(1),
  totalCandidates: z.number().int().min(0),
  inNetworkCandidates: z.number().int().min(0),
  outOfNetworkCandidates: z.number().int().min(0),
  mlRetrievedCandidates: z.number().int().min(0),
  recentHotCandidates: z.number().int().min(0),
  sourceCounts: z.record(z.string(), z.number().int().min(0)),
  mlSourceCounts: z.record(z.string(), z.number().int().min(0)),
  stageTimings: z.record(z.string(), z.number().min(0)),
  degradedReasons: z.array(z.string()),
  graph: z.object({
    totalCandidates: z.number().int().min(0),
    kernelCandidates: z.number().int().min(0),
    legacyCandidates: z.number().int().min(0),
    fallbackUsed: z.boolean(),
    emptyResult: z.boolean(),
    kernelSourceCounts: z.record(z.string(), z.number().int().min(0)),
    materializerQueryDurationMs: z.number().int().min(0).optional(),
    materializerProviderLatencyMs: z.number().int().min(0).optional(),
    materializerCacheHit: z.boolean().optional(),
    materializerRequestedAuthorCount: z.number().int().min(0).optional(),
    materializerUniqueAuthorCount: z.number().int().min(0).optional(),
    materializerReturnedPostCount: z.number().int().min(0).optional(),
    materializerCacheKeyMode: z.string().optional(),
    materializerCacheTtlMs: z.number().int().min(0).optional(),
    materializerCacheEntryCount: z.number().int().min(0).optional(),
    materializerCacheEvictionCount: z.number().int().min(0).optional(),
    dominantKernelSource: z.string().optional(),
    emptyReason: z.string().optional(),
  }),
});

const recommendationRankingSummaryPayloadSchema = z.object({
  stage: z.string().min(1),
  inputCandidates: z.number().int().min(0),
  hydratedCandidates: z.number().int().min(0),
  filteredCandidates: z.number().int().min(0),
  scoredCandidates: z.number().int().min(0),
  mlEligibleCandidates: z.number().int().min(0),
  mlRankedCandidates: z.number().int().min(0),
  weightedCandidates: z.number().int().min(0),
  stageTimings: z.record(z.string(), z.number().min(0)),
  filterDropCounts: z.record(z.string(), z.number().int().min(0)),
  degradedReasons: z.array(z.string()),
});

export const recommendationSummaryPayloadSchema = z.object({
  requestId: z.string().min(1),
  stage: z.string().min(1),
  pipelineVersion: z.string().min(1),
  owner: z.string().min(1),
  fallbackMode: z.string().min(1),
  providerCalls: z.record(z.string(), z.number().int().min(0)),
  providerLatencyMs: z.record(z.string(), z.number().min(0)).optional(),
  retrievedCount: z.number().int().min(0),
  selectedCount: z.number().int().min(0),
  sourceCounts: z.record(z.string(), z.number().int().min(0)),
  filterDropCounts: z.record(z.string(), z.number().int().min(0)),
  stageTimings: z.record(z.string(), z.number().min(0)),
  stageLatencyMs: z.record(z.string(), z.number().min(0)),
  degradedReasons: z.array(z.string()),
  recentHotApplied: z.boolean(),
  selector: z.object({
    oversampleFactor: z.number().int().min(1),
    maxSize: z.number().int().min(1),
    finalLimit: z.number().int().min(1),
    truncated: z.boolean(),
  }),
  serving: z.object({
    servingVersion: z.string().min(1),
    cursorMode: z.string().min(1),
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
    servedStateVersion: z.string().min(1),
    stableOrderKey: z.string().min(1),
    duplicateSuppressedCount: z.number().int().min(0),
    crossPageDuplicateCount: z.number().int().min(0),
    suppressionReasons: z.record(z.string(), z.number().int().min(0)),
    serveCacheHit: z.boolean(),
    stableOrderDrifted: z.boolean(),
    cacheKeyMode: z.string().min(1),
    cachePolicy: z.string().min(1),
    cachePolicyReason: z.string().min(1),
    pageRemainingCount: z.number().int().min(0),
    pageUnderfilled: z.boolean(),
    pageUnderfillReason: z.string().optional(),
  }),
  retrieval: recommendationRetrievalSummaryPayloadSchema,
  ranking: recommendationRankingSummaryPayloadSchema,
  stages: z.array(recommendationStagePayloadSchema),
});

export const recommendationResultPayloadSchema = z.object({
  requestId: z.string().min(1),
  servingVersion: z.string().min(1),
  cursor: z.string().optional(),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  servedStateVersion: z.string().min(1),
  stableOrderKey: z.string().min(1),
  candidates: z.array(recommendationCandidatePayloadSchema),
  summary: recommendationSummaryPayloadSchema,
});

export const recommendationRetrievalResponsePayloadSchema = z.object({
  candidates: z.array(recommendationCandidatePayloadSchema),
  stages: z.array(recommendationStagePayloadSchema),
  summary: recommendationRetrievalSummaryPayloadSchema,
});

export const recommendationRankingResponsePayloadSchema = z.object({
  candidates: z.array(recommendationCandidatePayloadSchema),
  stages: z.array(recommendationStagePayloadSchema),
  dropCounts: z.record(z.string(), z.number().int().min(0)),
  summary: recommendationRankingSummaryPayloadSchema,
});

function parseObjectId(value?: string): mongoose.Types.ObjectId | undefined {
  if (!value || !/^[0-9a-fA-F]{24}$/.test(value)) {
    return undefined;
  }
  return new mongoose.Types.ObjectId(value);
}

function restoreExperimentContext(
  payload?: RecommendationExperimentContextPayload,
): ExperimentContext | undefined {
  if (!payload) return undefined;
  return {
    userId: payload.userId,
    assignments: payload.assignments,
    getConfig<T>(experimentId: string, key: string, defaultValue: T): T {
      const match = payload.assignments.find(
        (assignment) => assignment.experimentId === experimentId,
      );
      if (!match || !match.inExperiment) {
        return defaultValue;
      }
      return (match.config?.[key] as T) ?? defaultValue;
    },
    isInBucket(experimentId: string, bucket: string): boolean {
      return payload.assignments.some(
        (assignment) =>
          assignment.experimentId === experimentId &&
          assignment.bucket === bucket &&
          assignment.inExperiment,
      );
    },
  };
}

export function serializeRecommendationQuery(query: FeedQuery): RecommendationQueryPayload {
  const userFeatures = query.userFeatures
    ? {
        ...query.userFeatures,
        followerCount: query.userFeatures.followerCount ?? undefined,
        accountCreatedAt: query.userFeatures.accountCreatedAt
          ? query.userFeatures.accountCreatedAt.toISOString()
          : undefined,
      }
    : undefined;

  const embeddingContext = query.embeddingContext
    ? {
        ...query.embeddingContext,
        computedAt: query.embeddingContext.computedAt
          ? query.embeddingContext.computedAt.toISOString()
          : undefined,
      }
    : undefined;

  return {
    requestId: query.requestId,
    userId: query.userId,
    limit: query.limit,
    cursor: query.cursor?.toISOString(),
    inNetworkOnly: query.inNetworkOnly,
    seenIds: query.seenIds || [],
    servedIds: query.servedIds || [],
    isBottomRequest: query.isBottomRequest,
    clientAppId: query.clientAppId ?? undefined,
    countryCode: query.countryCode ?? undefined,
    languageCode: query.languageCode ?? undefined,
    userFeatures,
    embeddingContext,
    userStateContext: query.userStateContext,
    userActionSequence:
      (query.userActionSequence as Array<Record<string, unknown>> | undefined) ?? undefined,
    newsHistoryExternalIds: query.newsHistoryExternalIds ?? undefined,
    modelUserActionSequence:
      (query.modelUserActionSequence as Array<Record<string, unknown>> | undefined) ?? undefined,
    experimentContext: query.experimentContext
      ? {
          userId: query.experimentContext.userId,
          assignments: query.experimentContext.assignments,
        }
      : undefined,
  };
}

export function deserializeRecommendationQuery(
  payload: RecommendationQueryPayload,
): FeedQuery {
  return {
    requestId: payload.requestId,
    userId: payload.userId,
    limit: payload.limit,
    cursor: payload.cursor ? new Date(payload.cursor) : undefined,
    inNetworkOnly: payload.inNetworkOnly,
    seenIds: payload.seenIds,
    servedIds: payload.servedIds,
    isBottomRequest: payload.isBottomRequest,
    clientAppId: payload.clientAppId,
    countryCode: payload.countryCode,
    languageCode: payload.languageCode,
    userFeatures: payload.userFeatures
      ? {
          ...payload.userFeatures,
          accountCreatedAt: payload.userFeatures.accountCreatedAt
            ? new Date(payload.userFeatures.accountCreatedAt)
            : undefined,
        }
      : undefined,
    embeddingContext: payload.embeddingContext
      ? {
          ...payload.embeddingContext,
          computedAt: payload.embeddingContext.computedAt
            ? new Date(payload.embeddingContext.computedAt)
            : undefined,
        }
      : undefined,
    userStateContext: payload.userStateContext,
    userActionSequence: payload.userActionSequence as FeedQuery['userActionSequence'],
    newsHistoryExternalIds: payload.newsHistoryExternalIds,
    modelUserActionSequence: payload.modelUserActionSequence,
    experimentContext: restoreExperimentContext(payload.experimentContext),
  };
}

export function serializeRecommendationQueryPatch(
  patch: RecommendationQueryPatchPayload,
): RecommendationQueryPatchPayload {
  return {
    userFeatures: patch.userFeatures
      ? {
          ...patch.userFeatures,
          followerCount: patch.userFeatures.followerCount ?? undefined,
          accountCreatedAt: patch.userFeatures.accountCreatedAt
            ? new Date(patch.userFeatures.accountCreatedAt).toISOString()
            : undefined,
        }
      : undefined,
    embeddingContext: patch.embeddingContext
      ? {
          ...patch.embeddingContext,
          computedAt: patch.embeddingContext.computedAt
            ? new Date(patch.embeddingContext.computedAt).toISOString()
            : undefined,
        }
      : undefined,
    userStateContext: patch.userStateContext,
    userActionSequence: patch.userActionSequence,
    newsHistoryExternalIds: patch.newsHistoryExternalIds,
    modelUserActionSequence: patch.modelUserActionSequence,
    experimentContext: patch.experimentContext
      ? {
          userId: patch.experimentContext.userId,
          assignments: patch.experimentContext.assignments,
        }
      : undefined,
  };
}

export function deserializeRecommendationQueryPatch(
  patch: RecommendationQueryPatchPayload,
): RecommendationQueryPatchPayload {
  return {
    userFeatures: patch.userFeatures
      ? {
          ...patch.userFeatures,
          accountCreatedAt: patch.userFeatures.accountCreatedAt
            ? new Date(patch.userFeatures.accountCreatedAt).toISOString()
            : undefined,
        }
      : undefined,
    embeddingContext: patch.embeddingContext
      ? {
          ...patch.embeddingContext,
          computedAt: patch.embeddingContext.computedAt
            ? new Date(patch.embeddingContext.computedAt).toISOString()
            : undefined,
        }
      : undefined,
    userStateContext: patch.userStateContext,
    userActionSequence: patch.userActionSequence,
    newsHistoryExternalIds: patch.newsHistoryExternalIds,
    modelUserActionSequence: patch.modelUserActionSequence,
    experimentContext: patch.experimentContext,
  };
}

export function serializeRecommendationCandidate(
  candidate: FeedCandidate,
): RecommendationCandidatePayload {
  const anyCandidate = candidate as FeedCandidate & {
    graphScore?: number;
    graphPath?: string;
    graphRecallType?: string;
  };
  return {
    postId: candidate.postId.toString(),
    modelPostId: candidate.modelPostId,
    authorId: candidate.authorId,
    content: candidate.content,
    createdAt: candidate.createdAt.toISOString(),
    conversationId: candidate.conversationId?.toString(),
    isReply: candidate.isReply,
    replyToPostId: candidate.replyToPostId?.toString(),
    isRepost: candidate.isRepost,
    originalPostId: candidate.originalPostId?.toString(),
    inNetwork: candidate.inNetwork,
    recallSource: candidate.recallSource,
    hasVideo: candidate.hasVideo,
    hasImage: candidate.hasImage,
    videoDurationSec: candidate.videoDurationSec,
    media: candidate.media,
    likeCount: candidate.likeCount,
    commentCount: candidate.commentCount,
    repostCount: candidate.repostCount,
    viewCount: candidate.viewCount,
    authorUsername: candidate.authorUsername,
    authorAvatarUrl: candidate.authorAvatarUrl,
    authorAffinityScore: candidate.authorAffinityScore,
    phoenixScores: candidate.phoenixScores,
    weightedScore: candidate.weightedScore,
    score: candidate.score,
    isLikedByUser: candidate.isLikedByUser,
    isRepostedByUser: candidate.isRepostedByUser,
    isNsfw: candidate.isNsfw,
    vfResult: candidate.vfResult,
    isNews: candidate.isNews,
    newsMetadata: candidate.newsMetadata,
    isPinned: candidate.isPinned,
    _scoreBreakdown: candidate._scoreBreakdown,
    _pipelineScore: candidate._pipelineScore,
    graphScore: anyCandidate.graphScore,
    graphPath: anyCandidate.graphPath,
    graphRecallType: anyCandidate.graphRecallType,
  };
}

export function deserializeRecommendationCandidate(
  payload: RecommendationCandidatePayload,
): FeedCandidate {
  return {
    postId: new mongoose.Types.ObjectId(payload.postId),
    modelPostId: payload.modelPostId,
    authorId: payload.authorId,
    content: payload.content,
    createdAt: new Date(payload.createdAt),
    conversationId: parseObjectId(payload.conversationId),
    isReply: payload.isReply,
    replyToPostId: parseObjectId(payload.replyToPostId),
    isRepost: payload.isRepost,
    originalPostId: parseObjectId(payload.originalPostId),
    inNetwork: payload.inNetwork,
    recallSource: payload.recallSource,
    hasVideo: payload.hasVideo,
    hasImage: payload.hasImage,
    videoDurationSec: payload.videoDurationSec,
    media: payload.media,
    likeCount: payload.likeCount,
    commentCount: payload.commentCount,
    repostCount: payload.repostCount,
    viewCount: payload.viewCount,
    authorUsername: payload.authorUsername,
    authorAvatarUrl: payload.authorAvatarUrl,
    authorAffinityScore: payload.authorAffinityScore,
    phoenixScores: payload.phoenixScores,
    weightedScore: payload.weightedScore,
    score: payload.score,
    isLikedByUser: payload.isLikedByUser,
    isRepostedByUser: payload.isRepostedByUser,
    isNsfw: payload.isNsfw,
    vfResult: payload.vfResult,
    isNews: payload.isNews,
    newsMetadata: payload.newsMetadata,
    isPinned: payload.isPinned,
    _scoreBreakdown: payload._scoreBreakdown,
    _pipelineScore: payload._pipelineScore,
    ...(payload.graphScore !== undefined ? { graphScore: payload.graphScore } : {}),
    ...(payload.graphPath ? { graphPath: payload.graphPath } : {}),
    ...(payload.graphRecallType ? { graphRecallType: payload.graphRecallType } : {}),
  } as FeedCandidate;
}

export function serializeRecommendationCandidates(
  candidates: FeedCandidate[],
): RecommendationCandidatePayload[] {
  return candidates.map(serializeRecommendationCandidate);
}

export function deserializeRecommendationCandidates(
  payloads: RecommendationCandidatePayload[],
): FeedCandidate[] {
  return payloads.map(deserializeRecommendationCandidate);
}
