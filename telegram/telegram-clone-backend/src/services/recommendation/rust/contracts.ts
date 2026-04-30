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
  RankingPolicy,
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
type SerializedRankingPolicy = RankingPolicy;

const INTEREST_POOL_KINDS = [
  'dense_pool',
  'cluster_pool',
  'legacy_pool',
  'ann_pool',
  'keyword_fallback',
  'embedding_author',
  'popular_embedding',
  'popular_keyword',
] as const satisfies readonly NonNullable<FeedCandidate['interestPoolKind']>[];

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
  rankingPolicy?: SerializedRankingPolicy;
}

export interface RecommendationQueryPatchPayload {
  userFeatures?: SerializedUserFeatures;
  embeddingContext?: SerializedEmbeddingContext;
  userStateContext?: SerializedUserStateContext;
  userActionSequence?: Array<Record<string, unknown>>;
  newsHistoryExternalIds?: string[];
  modelUserActionSequence?: Array<Record<string, unknown>>;
  experimentContext?: RecommendationExperimentContextPayload;
  rankingPolicy?: SerializedRankingPolicy;
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
  retrievalLane?: string;
  interestPoolKind?: string;
  secondaryRecallSources?: string[];
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
  actionScores?: {
    click: number;
    like: number;
    reply: number;
    repost: number;
    dwell: number;
    negative: number;
  };
  rankingSignals?: Record<string, number>;
  recallEvidence?: Record<string, unknown>;
  selectionPool?: string;
  selectionReason?: string;
  scoreContractVersion?: string;
  scoreBreakdownVersion?: string;
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
  laneCounts: Record<string, number>;
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

export interface RecommendationTraceSourceCountPayload {
  source: string;
  count: number;
}

export interface RecommendationTraceFreshnessPayload {
  newestAgeSeconds?: number;
  oldestAgeSeconds?: number;
  timeRangeSeconds?: number;
}

export interface RecommendationTraceCandidatePayload {
  postId: string;
  modelPostId?: string;
  authorId: string;
  rank: number;
  recallSource: string;
  inNetwork: boolean;
  isNews: boolean;
  score?: number;
  weightedScore?: number;
  pipelineScore?: number;
  scoreBreakdown?: Record<string, number>;
  createdAt: string;
}

export interface RecommendationTraceReplayPoolPayload {
  poolKind: string;
  totalCount: number;
  truncated: boolean;
  fingerprint?: string;
  candidates: RecommendationTraceCandidatePayload[];
}

export interface RecommendationTracePayload {
  traceVersion: string;
  traceMode?: 'live_trace' | 'cache_replay_trace';
  requestId: string;
  pipelineVersion: string;
  strategyVersion?: string;
  selectedFingerprint?: string;
  replayPoolFingerprint?: string;
  owner: string;
  fallbackMode: string;
  selectedCount: number;
  inNetworkCount: number;
  outOfNetworkCount: number;
  sourceCounts: RecommendationTraceSourceCountPayload[];
  authorDiversity: number;
  replyRatio: number;
  averageScore: number;
  topScore?: number;
  bottomScore?: number;
  freshness: RecommendationTraceFreshnessPayload;
  candidates: RecommendationTraceCandidatePayload[];
  experimentKeys: string[];
  userState?: string;
  embeddingQualityScore?: number;
  replayPool?: RecommendationTraceReplayPoolPayload;
  serveCacheHit: boolean;
}

export interface RecommendationOnlineEvaluationPayload {
  selectedCount: number;
  averageScore: number;
  scoreStddev: number;
  uniqueAuthorRatio: number;
  sourceEntropy: number;
  laneEntropy: number;
  poolEntropy: number;
  trendCount: number;
  newsCount: number;
  explorationCount: number;
  negativePressureAverage: number;
  sourceCounts: Record<string, number>;
  laneCounts: Record<string, number>;
  poolCounts: Record<string, number>;
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
  onlineEval: RecommendationOnlineEvaluationPayload;
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
  trace?: RecommendationTracePayload;
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
  modelVersion: z.string().optional(),
  artifactVersion: z.string().optional(),
  modelProfile: z.string().optional(),
  embeddingDim: z.number().int().positive().optional(),
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

const rankingPolicySchema = z.object({
  strategyVersion: z.string().optional(),
  contractVersion: z.string().optional(),
  scoreBreakdownVersion: z.string().optional(),
  explorationRate: z.number().optional(),
  banditExplorationRate: z.number().optional(),
  banditUncertaintyWeight: z.number().optional(),
  explorationRiskCeiling: z.number().optional(),
  freshnessHalfLifeHours: z.number().optional(),
  negativeFeedbackHalfLifeDays: z.number().optional(),
  interestDecayHalfLifeHours: z.number().optional(),
  negativeFeedbackPenaltyWeight: z.number().optional(),
  sourceBatchTimeoutMs: z.number().optional(),
  maxOonRatio: z.number().optional(),
  fallbackCeilingRatio: z.number().optional(),
  explorationFloorRatio: z.number().optional(),
  sessionTopicSuppressionWeight: z.number().optional(),
  semanticDedupOverlapThreshold: z.number().optional(),
  nearDuplicateOverlapThreshold: z.number().optional(),
  nearDuplicateMinTokenCount: z.number().int().min(3).optional(),
  negativeFeedbackPropagationWeight: z.number().optional(),
  trendSourceBoost: z.number().optional(),
  trendBudgetBoostRatio: z.number().optional(),
  newsTrendLinkBoost: z.number().optional(),
  trendFloorRatio: z.number().optional(),
  trendCeilingRatio: z.number().optional(),
  newsFloorRatio: z.number().optional(),
  newsCeilingRatio: z.number().optional(),
  inNetworkFloorRatio: z.number().optional(),
  socialGraphFloorRatio: z.number().optional(),
  interestFloorRatio: z.number().optional(),
  fallbackFloorRatio: z.number().optional(),
  inNetworkCeilingRatio: z.number().optional(),
  socialGraphCeilingRatio: z.number().optional(),
  interestCeilingRatio: z.number().optional(),
  authorSoftCap: z.number().int().min(1).optional(),
  crossRequestAuthorSoftCap: z.number().int().min(1).optional(),
  crossRequestTopicSoftCap: z.number().int().min(1).optional(),
  crossRequestSourceSoftCap: z.number().int().min(1).optional(),
  topicSoftCapRatio: z.number().optional(),
  sourceSoftCapRatio: z.number().optional(),
  coldStartKeywords: z.array(z.string()).optional(),
  trendKeywords: z.array(z.string()).optional(),
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
  rankingPolicy: rankingPolicySchema.optional(),
});

export const recommendationQueryPatchPayloadSchema = z.object({
  userFeatures: userFeaturesSchema.optional(),
  embeddingContext: embeddingContextSchema.optional(),
  userStateContext: userStateContextSchema.optional(),
  userActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  newsHistoryExternalIds: z.array(z.string()).optional(),
  modelUserActionSequence: z.array(z.record(z.string(), z.unknown())).optional(),
  experimentContext: experimentContextSchema.optional(),
  rankingPolicy: rankingPolicySchema.optional(),
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
  retrievalLane: z.string().optional(),
  interestPoolKind: z.string().optional(),
  secondaryRecallSources: z.array(z.string()).optional(),
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
  actionScores: z.object({
    click: z.number(),
    like: z.number(),
    reply: z.number(),
    repost: z.number(),
    dwell: z.number(),
    negative: z.number(),
  }).optional(),
  rankingSignals: z.record(z.string(), z.number()).optional(),
  recallEvidence: z.record(z.string(), z.unknown()).optional(),
  selectionPool: z.string().optional(),
  selectionReason: z.string().optional(),
  scoreContractVersion: z.string().optional(),
  scoreBreakdownVersion: z.string().optional(),
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
  laneCounts: z.record(z.string(), z.number().int().min(0)),
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

const recommendationTracePayloadSchema = z.object({
  traceVersion: z.string().min(1),
  traceMode: z.enum(['live_trace', 'cache_replay_trace']).optional(),
  requestId: z.string().min(1),
  pipelineVersion: z.string().min(1),
  strategyVersion: z.string().min(1).optional(),
  selectedFingerprint: z.string().min(1).optional(),
  replayPoolFingerprint: z.string().min(1).optional(),
  owner: z.string().min(1),
  fallbackMode: z.string().min(1),
  selectedCount: z.number().int().min(0),
  inNetworkCount: z.number().int().min(0),
  outOfNetworkCount: z.number().int().min(0),
  sourceCounts: z.array(z.object({
    source: z.string().min(1),
    count: z.number().int().min(0),
  })),
  authorDiversity: z.number().min(0),
  replyRatio: z.number().min(0),
  averageScore: z.number(),
  topScore: z.number().optional(),
  bottomScore: z.number().optional(),
  freshness: z.object({
    newestAgeSeconds: z.number().int().min(0).optional(),
    oldestAgeSeconds: z.number().int().min(0).optional(),
    timeRangeSeconds: z.number().int().min(0).optional(),
  }),
  candidates: z.array(z.object({
    postId: z.string().min(1),
    modelPostId: z.string().optional(),
    authorId: z.string().min(1),
    rank: z.number().int().min(1),
    recallSource: z.string().min(1),
    inNetwork: z.boolean(),
    isNews: z.boolean(),
    score: z.number().optional(),
    weightedScore: z.number().optional(),
    pipelineScore: z.number().optional(),
    scoreBreakdown: z.record(z.string(), z.number()).optional(),
    createdAt: z.string().min(1),
  })),
  experimentKeys: z.array(z.string()),
  userState: z.string().optional(),
  embeddingQualityScore: z.number().optional(),
  replayPool: z.object({
    poolKind: z.string().min(1),
    totalCount: z.number().int().min(0),
    truncated: z.boolean(),
    fingerprint: z.string().min(1).optional(),
    candidates: z.array(z.object({
      postId: z.string().min(1),
      modelPostId: z.string().optional(),
      authorId: z.string().min(1),
      rank: z.number().int().min(1),
      recallSource: z.string().min(1),
      inNetwork: z.boolean(),
      isNews: z.boolean(),
      score: z.number().optional(),
      weightedScore: z.number().optional(),
      pipelineScore: z.number().optional(),
      scoreBreakdown: z.record(z.string(), z.number()).optional(),
      createdAt: z.string().min(1),
    })),
  }).optional(),
  serveCacheHit: z.boolean(),
});

const recommendationOnlineEvaluationPayloadSchema = z.object({
  selectedCount: z.number().int().min(0),
  averageScore: z.number(),
  scoreStddev: z.number().min(0),
  uniqueAuthorRatio: z.number().min(0),
  sourceEntropy: z.number().min(0),
  laneEntropy: z.number().min(0),
  poolEntropy: z.number().min(0),
  trendCount: z.number().int().min(0),
  newsCount: z.number().int().min(0),
  explorationCount: z.number().int().min(0),
  negativePressureAverage: z.number().min(0),
  sourceCounts: z.record(z.string(), z.number().int().min(0)),
  laneCounts: z.record(z.string(), z.number().int().min(0)),
  poolCounts: z.record(z.string(), z.number().int().min(0)),
});

const emptyOnlineEvaluationPayload: RecommendationOnlineEvaluationPayload = {
  selectedCount: 0,
  averageScore: 0,
  scoreStddev: 0,
  uniqueAuthorRatio: 0,
  sourceEntropy: 0,
  laneEntropy: 0,
  poolEntropy: 0,
  trendCount: 0,
  newsCount: 0,
  explorationCount: 0,
  negativePressureAverage: 0,
  sourceCounts: {},
  laneCounts: {},
  poolCounts: {},
};

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
  onlineEval: recommendationOnlineEvaluationPayloadSchema
    .optional()
    .default(emptyOnlineEvaluationPayload),
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
  trace: recommendationTracePayloadSchema.optional(),
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

  const rankingPolicy = resolveRankingPolicy(query);

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
    rankingPolicy,
  };
}

export function resolveRankingPolicy(query: FeedQuery): RankingPolicy {
  const defaults = buildDefaultRankingPolicy(query);
  const overrides = query.rankingPolicy ?? {};
  return {
    ...defaults,
    ...overrides,
    coldStartKeywords: mergeKeywordLists(defaults.coldStartKeywords, overrides.coldStartKeywords),
    trendKeywords: mergeKeywordLists(defaults.trendKeywords, overrides.trendKeywords),
  };
}

function buildDefaultRankingPolicy(query: FeedQuery): RankingPolicy {
  const experimentId = String(process.env.SPACE_FEED_EXPERIMENT_ID || 'space_feed_recsys');
  const configValue = <T>(key: string, fallback: T): T => (
    query.experimentContext?.getConfig<T>(experimentId, key, fallback) ?? fallback
  );
  return {
    strategyVersion: String(
      process.env.RECOMMENDATION_STRATEGY_VERSION || configValue('strategy_version', 'strategy_policy_v2'),
    ),
    contractVersion: String(
      process.env.RECOMMENDATION_SCORE_CONTRACT_VERSION || 'recommendation_score_contract_v2',
    ),
    scoreBreakdownVersion: String(
      process.env.RECOMMENDATION_SCORE_BREAKDOWN_VERSION || 'score_breakdown_v2',
    ),
    explorationRate: envNumber(
      'RECOMMENDATION_EXPLORATION_RATE',
      configValue('exploration_rate', undefined),
    ),
    banditExplorationRate: envNumber(
      'RECOMMENDATION_BANDIT_EXPLORATION_RATE',
      configValue('bandit_exploration_rate', 0.08),
    ),
    banditUncertaintyWeight: envNumber(
      'RECOMMENDATION_BANDIT_UNCERTAINTY_WEIGHT',
      configValue('bandit_uncertainty_weight', 0.3),
    ),
    explorationRiskCeiling: envNumber(
      'RECOMMENDATION_EXPLORATION_RISK_CEILING',
      configValue('exploration_risk_ceiling', 0.58),
    ),
    freshnessHalfLifeHours: envNumber(
      'RECOMMENDATION_FRESHNESS_HALF_LIFE_HOURS',
      configValue('freshness_half_life_hours', 6),
    ),
    negativeFeedbackHalfLifeDays: envNumber(
      'RECOMMENDATION_NEGATIVE_FEEDBACK_HALF_LIFE_DAYS',
      configValue('negative_feedback_half_life_days', 22.8),
    ),
    interestDecayHalfLifeHours: envNumber(
      'RECOMMENDATION_INTEREST_DECAY_HALF_LIFE_HOURS',
      configValue('interest_decay_half_life_hours', 18),
    ),
    negativeFeedbackPenaltyWeight: envNumber(
      'RECOMMENDATION_NEGATIVE_FEEDBACK_PENALTY_WEIGHT',
      configValue('negative_feedback_penalty_weight', 0.22),
    ),
    sourceBatchTimeoutMs: envInteger(
      'RECOMMENDATION_SOURCE_BATCH_TIMEOUT_MS',
      configValue(
        'source_batch_timeout_ms',
        process.env.RECOMMENDATION_SOURCE_BATCH_COMPONENT_TIMEOUT_MS || 1600,
      ),
    ),
    maxOonRatio: envNumber('RECOMMENDATION_MAX_OON_RATIO', configValue('max_oon_ratio', undefined)),
    fallbackCeilingRatio: envNumber(
      'RECOMMENDATION_FALLBACK_CEILING_RATIO',
      configValue('fallback_ceiling_ratio', undefined),
    ),
    explorationFloorRatio: envNumber(
      'RECOMMENDATION_EXPLORATION_FLOOR_RATIO',
      configValue('exploration_floor_ratio', undefined),
    ),
    sessionTopicSuppressionWeight: envNumber(
      'RECOMMENDATION_SESSION_TOPIC_SUPPRESSION_WEIGHT',
      configValue('session_topic_suppression_weight', 0.2),
    ),
    semanticDedupOverlapThreshold: envNumber(
      'RECOMMENDATION_SEMANTIC_DEDUP_OVERLAP_THRESHOLD',
      configValue('semantic_dedup_overlap_threshold', 0.62),
    ),
    nearDuplicateOverlapThreshold: envNumber(
      'RECOMMENDATION_NEAR_DUPLICATE_OVERLAP_THRESHOLD',
      configValue('near_duplicate_overlap_threshold', 0.82),
    ),
    nearDuplicateMinTokenCount: envInteger(
      'RECOMMENDATION_NEAR_DUPLICATE_MIN_TOKEN_COUNT',
      configValue('near_duplicate_min_token_count', 5),
    ),
    negativeFeedbackPropagationWeight: envNumber(
      'RECOMMENDATION_NEGATIVE_FEEDBACK_PROPAGATION_WEIGHT',
      configValue('negative_feedback_propagation_weight', 0.34),
    ),
    trendSourceBoost: envNumber(
      'RECOMMENDATION_TREND_SOURCE_BOOST',
      configValue('trend_source_boost', 0.16),
    ),
    trendBudgetBoostRatio: envNumber(
      'RECOMMENDATION_TREND_BUDGET_BOOST_RATIO',
      configValue('trend_budget_boost_ratio', configValue('trend_source_boost', 0.16)),
    ),
    newsTrendLinkBoost: envNumber(
      'RECOMMENDATION_NEWS_TREND_LINK_BOOST',
      configValue('news_trend_link_boost', 0.11),
    ),
    trendFloorRatio: envNumber(
      'RECOMMENDATION_TREND_FLOOR_RATIO',
      configValue('trend_floor_ratio', 0.1),
    ),
    trendCeilingRatio: envNumber(
      'RECOMMENDATION_TREND_CEILING_RATIO',
      configValue('trend_ceiling_ratio', 0.32),
    ),
    newsFloorRatio: envNumber(
      'RECOMMENDATION_NEWS_FLOOR_RATIO',
      configValue('news_floor_ratio', 0.08),
    ),
    newsCeilingRatio: envNumber(
      'RECOMMENDATION_NEWS_CEILING_RATIO',
      configValue('news_ceiling_ratio', 0.38),
    ),
    inNetworkFloorRatio: envNumber(
      'RECOMMENDATION_IN_NETWORK_FLOOR_RATIO',
      configValue('in_network_floor_ratio', undefined),
    ),
    socialGraphFloorRatio: envNumber(
      'RECOMMENDATION_SOCIAL_GRAPH_FLOOR_RATIO',
      configValue('social_graph_floor_ratio', undefined),
    ),
    interestFloorRatio: envNumber(
      'RECOMMENDATION_INTEREST_FLOOR_RATIO',
      configValue('interest_floor_ratio', undefined),
    ),
    fallbackFloorRatio: envNumber(
      'RECOMMENDATION_FALLBACK_FLOOR_RATIO',
      configValue('fallback_floor_ratio', undefined),
    ),
    inNetworkCeilingRatio: envNumber(
      'RECOMMENDATION_IN_NETWORK_CEILING_RATIO',
      configValue('in_network_ceiling_ratio', undefined),
    ),
    socialGraphCeilingRatio: envNumber(
      'RECOMMENDATION_SOCIAL_GRAPH_CEILING_RATIO',
      configValue('social_graph_ceiling_ratio', undefined),
    ),
    interestCeilingRatio: envNumber(
      'RECOMMENDATION_INTEREST_CEILING_RATIO',
      configValue('interest_ceiling_ratio', undefined),
    ),
    authorSoftCap: envInteger(
      'RECOMMENDATION_AUTHOR_SOFT_CAP',
      configValue('author_soft_cap', undefined),
    ),
    crossRequestAuthorSoftCap: envInteger(
      'RECOMMENDATION_CROSS_REQUEST_AUTHOR_SOFT_CAP',
      configValue('cross_request_author_soft_cap', 3),
    ),
    crossRequestTopicSoftCap: envInteger(
      'RECOMMENDATION_CROSS_REQUEST_TOPIC_SOFT_CAP',
      configValue('cross_request_topic_soft_cap', 4),
    ),
    crossRequestSourceSoftCap: envInteger(
      'RECOMMENDATION_CROSS_REQUEST_SOURCE_SOFT_CAP',
      configValue('cross_request_source_soft_cap', 6),
    ),
    topicSoftCapRatio: envNumber(
      'RECOMMENDATION_TOPIC_SOFT_CAP_RATIO',
      configValue('topic_soft_cap_ratio', undefined),
    ),
    sourceSoftCapRatio: envNumber(
      'RECOMMENDATION_SOURCE_SOFT_CAP_RATIO',
      configValue('source_soft_cap_ratio', undefined),
    ),
    coldStartKeywords: envCsv('RECOMMENDATION_COLD_START_KEYWORDS'),
    trendKeywords: envCsv('RECOMMENDATION_TREND_KEYWORDS'),
  };
}

function mergeKeywordLists(
  defaults?: string[],
  overrides?: string[],
): string[] | undefined {
  const values = [...(defaults || []), ...(overrides || [])]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  return Array.from(new Set(values)).slice(0, 32);
}

function envNumber(key: string, fallback: unknown): number | undefined {
  const value = process.env[key] ?? fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envInteger(key: string, fallback: unknown): number | undefined {
  const value = envNumber(key, fallback);
  return value !== undefined ? Math.max(1, Math.round(value)) : undefined;
}

function envCsv(key: string): string[] | undefined {
  const values = String(process.env[key] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
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
    rankingPolicy: payload.rankingPolicy,
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
    rankingPolicy: patch.rankingPolicy,
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
    rankingPolicy: patch.rankingPolicy,
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
    retrievalLane: candidate.retrievalLane,
    interestPoolKind: candidate.interestPoolKind,
    secondaryRecallSources: candidate.secondaryRecallSources,
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
    actionScores: candidate.actionScores,
    rankingSignals: candidate.rankingSignals as Record<string, number> | undefined,
    recallEvidence: candidate.recallEvidence as Record<string, unknown> | undefined,
    selectionPool: candidate.selectionPool,
    selectionReason: candidate.selectionReason,
    scoreContractVersion: candidate.scoreContractVersion,
    scoreBreakdownVersion: candidate.scoreBreakdownVersion,
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
    retrievalLane: payload.retrievalLane,
    interestPoolKind: parseInterestPoolKind(payload.interestPoolKind),
    secondaryRecallSources: payload.secondaryRecallSources,
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
    actionScores: payload.actionScores,
    rankingSignals: payload.rankingSignals as FeedCandidate['rankingSignals'],
    recallEvidence: payload.recallEvidence as FeedCandidate['recallEvidence'],
    selectionPool: payload.selectionPool,
    selectionReason: payload.selectionReason,
    scoreContractVersion: payload.scoreContractVersion,
    scoreBreakdownVersion: payload.scoreBreakdownVersion,
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

function parseInterestPoolKind(value?: string): FeedCandidate['interestPoolKind'] | undefined {
  if (!value) return undefined;
  return (INTEREST_POOL_KINDS as readonly string[]).includes(value)
    ? (value as FeedCandidate['interestPoolKind'])
    : undefined;
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
