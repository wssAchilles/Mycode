import { REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT } from '../../services/recommendation/contracts/embeddingContract';
import { buildRegisteredUserColdStartEmbedding } from '../../services/recommendation/users/coldStartEmbedding';
import { ActionType } from '../../models/UserAction';
import { ProductSurface, SignalType, TargetType } from '../../models/UserSignal';
import {
  type CommunityKey,
  type DirectedFollowEdge,
  type GeneratedActionRecord,
  type PostReconciledStats,
  SYNTH_SCRIPT_VERSION,
  type SyntheticPostRecord,
  type SyntheticUserRecord,
} from './contracts';
import { SeededRng } from './prng';
import { COMMUNITY_CONFIGS, COMMUNITY_ORDER } from './taxonomy';

const DAY_MS = 24 * 60 * 60 * 1000;
const REALGRAPH_MODEL_VERSION = 'heuristic_realgraph_v1';
const REALGRAPH_FEATURE_VERSION = 'realgraph_features_v1';

type EdgeCounts = {
  followCount: number;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoteCount: number;
  mentionCount: number;
  profileViewCount: number;
  tweetClickCount: number;
  dwellTimeMs: number;
  addressBookCount: number;
  directMessageCount: number;
  coEngagementCount: number;
  contentAffinityCount: number;
  muteCount: number;
  blockCount: number;
  reportCount: number;
};

const emptyCounts = (): EdgeCounts => ({
  followCount: 0,
  likeCount: 0,
  replyCount: 0,
  retweetCount: 0,
  quoteCount: 0,
  mentionCount: 0,
  profileViewCount: 0,
  tweetClickCount: 0,
  dwellTimeMs: 0,
  addressBookCount: 0,
  directMessageCount: 0,
  coEngagementCount: 0,
  contentAffinityCount: 0,
  muteCount: 0,
  blockCount: 0,
  reportCount: 0,
});

/** 严格复用 RealGraphEdge 模型权重计算衰减得分 */
export function computeRealGraphDecayedSum(counts: EdgeCounts): number {
  return (
    counts.followCount * 10.0 +
    counts.likeCount * 1.0 +
    counts.replyCount * 3.0 +
    counts.retweetCount * 2.0 +
    counts.quoteCount * 2.5 +
    counts.mentionCount * 1.5 +
    counts.profileViewCount * 0.5 +
    counts.tweetClickCount * 0.3 +
    counts.dwellTimeMs * 0.001 +
    counts.addressBookCount * 6.0 +
    counts.directMessageCount * 5.0 +
    counts.coEngagementCount * 2.2 +
    counts.contentAffinityCount * 1.8 -
    counts.muteCount * 5.0 -
    counts.blockCount * 10.0 -
    counts.reportCount * 8.0
  );
}

/**
 * 将 Contact 关注图与 UserAction 互动序列聚合成 RealGraphEdge 文档，
 * 并补充用户对之间的共现（co_engagement）与内容亲和（content_affinity）边，
 * 确保 C++ 图内核 5 个端口全部具备真实且可解释的路径
 */
export function buildSyntheticRealGraphEdges(input: {
  followEdges: DirectedFollowEdge[];
  actions: GeneratedActionRecord[];
  allUsers: SyntheticUserRecord[];
}): any[] {
  const now = new Date();
  const oneDayAgoMs = now.getTime() - DAY_MS;

  type MutableEdge = {
    sourceUserId: string;
    targetUserId: string;
    dailyCounts: EdgeCounts;
    rollupCounts: EdgeCounts;
    firstInteractionAt: Date;
    lastInteractionAt: Date;
  };

  const edgeMap = new Map<string, MutableEdge>();
  const ensureEdge = (sourceUserId: string, targetUserId: string, timestamp: Date): MutableEdge | null => {
    if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) return null;
    const key = `${sourceUserId}:${targetUserId}`;
    let existing = edgeMap.get(key);
    if (!existing) {
      existing = {
        sourceUserId,
        targetUserId,
        dailyCounts: emptyCounts(),
        rollupCounts: emptyCounts(),
        firstInteractionAt: timestamp,
        lastInteractionAt: timestamp,
      };
      edgeMap.set(key, existing);
    } else {
      if (timestamp < existing.firstInteractionAt) existing.firstInteractionAt = timestamp;
      if (timestamp > existing.lastInteractionAt) existing.lastInteractionAt = timestamp;
    }
    return existing;
  };

  for (const follow of input.followEdges) {
    const edge = ensureEdge(follow.userId, follow.contactId, follow.addedAt);
    if (!edge) continue;
    edge.rollupCounts.followCount = 1;
    edge.dailyCounts.followCount = 1;
    if (follow.isMutual) {
      edge.rollupCounts.addressBookCount = 1;
    }
    if (follow.reason === 'triadic_closure') {
      edge.rollupCounts.coEngagementCount += 1;
    }
  }

  for (const action of input.actions) {
    if (!action.targetAuthorId) continue;
    const edge = ensureEdge(action.userId, action.targetAuthorId, action.timestamp);
    if (!edge) continue;
    const isRecent = action.timestamp.getTime() >= oneDayAgoMs;

    const bumpField = (field: keyof EdgeCounts, delta: number): void => {
      edge.rollupCounts[field] += delta;
      if (isRecent) edge.dailyCounts[field] += delta;
    };

    switch (action.action) {
      case ActionType.LIKE:
        bumpField('likeCount', 1);
        bumpField('contentAffinityCount', 1);
        break;
      case ActionType.REPLY:
        bumpField('replyCount', 1);
        bumpField('coEngagementCount', 1);
        break;
      case ActionType.REPOST:
        bumpField('retweetCount', 1);
        bumpField('coEngagementCount', 1);
        break;
      case ActionType.QUOTE:
        bumpField('quoteCount', 1);
        bumpField('coEngagementCount', 1);
        break;
      case ActionType.PROFILE_CLICK:
        bumpField('profileViewCount', 1);
        break;
      case ActionType.CLICK:
        bumpField('tweetClickCount', 1);
        break;
      case ActionType.DWELL:
        bumpField('dwellTimeMs', action.dwellTimeMs || 15000);
        bumpField('contentAffinityCount', 1);
        break;
      case ActionType.IMPRESSION:
        edge.rollupCounts.contentAffinityCount += 0.2;
        break;
      case ActionType.DISMISS:
      case ActionType.HIDE:
        bumpField('muteCount', 1);
        break;
      default:
        break;
    }
  }

  // 对社区强亲和的用户补充细粒度 contentAffinityCount，确保 C++ content-affinity-neighbors 信号丰富
  const userById = new Map(input.allUsers.map((u) => [u.id, u]));
  const result: any[] = [];
  for (const edge of edgeMap.values()) {
    const src = userById.get(edge.sourceUserId);
    const dst = userById.get(edge.targetUserId);
    if (src && dst && src.primaryCluster === dst.primaryCluster && edge.rollupCounts.contentAffinityCount < 1) {
      edge.rollupCounts.contentAffinityCount += 1;
    }

    edge.rollupCounts.contentAffinityCount = Math.round(edge.rollupCounts.contentAffinityCount);
    const rawScore = computeRealGraphDecayedSum(edge.rollupCounts);
    if (rawScore < 0.05) continue;

    const ageDays = Math.max(0, (now.getTime() - edge.lastInteractionAt.getTime()) / DAY_MS);
    const decayedSum = Number(Math.max(0.05, rawScore * Math.pow(0.95, Math.min(30, ageDays))).toFixed(3));
    const interactionProbability = Number(
      Math.min(0.97, Math.max(0.06, 0.14 + decayedSum / 45)).toFixed(3),
    );

    result.push({
      sourceUserId: edge.sourceUserId,
      targetUserId: edge.targetUserId,
      dailyCounts: edge.dailyCounts,
      rollupCounts: edge.rollupCounts,
      decayedSum,
      interactionProbability,
      predictionMode: 'heuristic',
      modelVersion: REALGRAPH_MODEL_VERSION,
      featureVersion: REALGRAPH_FEATURE_VERSION,
      firstInteractionAt: edge.firstInteractionAt,
      lastInteractionAt: edge.lastInteractionAt,
      lastDecayAppliedAt: now,
      lastPredictionAt: now,
    });
  }

  return result;
}

/**
 * 将一部分高价值交互投影为 UserSignal（TTL 14天），用于实效信号层
 */
export function buildSyntheticUserSignals(actions: GeneratedActionRecord[]): any[] {
  const nowMs = Date.now();
  const sevenDaysAgoMs = nowMs - 14 * DAY_MS;
  const expiresAt = new Date(nowMs + 30 * DAY_MS);
  const signals: any[] = [];

  for (const action of actions) {
    if (action.timestamp.getTime() < sevenDaysAgoMs) continue;

    let signalType: SignalType | null = null;
    switch (action.action) {
      case ActionType.LIKE:
        signalType = SignalType.FAVORITE;
        break;
      case ActionType.REPLY:
        signalType = SignalType.REPLY;
        break;
      case ActionType.REPOST:
        signalType = SignalType.RETWEET;
        break;
      case ActionType.QUOTE:
        signalType = SignalType.QUOTE;
        break;
      case ActionType.CLICK:
        signalType = SignalType.TWEET_CLICK;
        break;
      case ActionType.DWELL:
        signalType = SignalType.DWELL;
        break;
      case ActionType.PROFILE_CLICK:
        signalType = SignalType.PROFILE_CLICK;
        break;
      case ActionType.DISMISS:
        signalType = SignalType.DISMISS_POST;
        break;
      case ActionType.HIDE:
        signalType = SignalType.HIDE_POST;
        break;
      default:
        break;
    }

    if (!signalType || !action.targetPostId) continue;

    signals.push({
      userId: action.userId,
      signalType,
      targetId: String(action.targetPostId),
      targetType: TargetType.POST,
      targetAuthorId: action.targetAuthorId,
      productSurface: ProductSurface.SPACE_FEED,
      requestId: action.requestId,
      metadata: {
        syntheticGenerator: SYNTH_SCRIPT_VERSION,
        recommendationPosition: action.rank,
        recommendationSource: action.recallSource,
        dwellTimeMs: action.dwellTimeMs,
      },
      timestamp: action.timestamp,
      expiresAt,
    });
  }

  return signals;
}

/**
 * 构造完全通过 auditEmbeddingContracts 校验（verified_local_fallback）的 UserFeatureVector 文档，
 * 同时对齐 SimClusters 稀疏兴趣与生产者聚类
 */
export function buildSyntheticUserFeatureVectors(
  users: SyntheticUserRecord[],
): any[] {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * DAY_MS);

  return users.map((user) => {
    const clusterPairs = COMMUNITY_ORDER.map((key) => ({
      clusterId: COMMUNITY_CONFIGS[key].clusterId,
      score: user.affinityWeights[key] || 0,
    }))
      .filter((entry) => entry.score >= 0.04)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    const isProducer = user.tier === 'kol' || user.tier === 'bridge' || user.tier === 'creator';
    const primaryClusterId = COMMUNITY_CONFIGS[user.primaryCluster].clusterId;
    const producerEmbedding = isProducer
      ? clusterPairs.slice(0, 3).map((entry, idx) => ({
          clusterId: entry.clusterId,
          score: Number(Math.max(0.15, (idx === 0 ? 0.86 : 0.35) * (0.7 + user.influenceScore * 0.3)).toFixed(3)),
        }))
      : undefined;

    // 严格调用官方 coldStartEmbedding 构造与契约对齐的 256 维稠密向量
    const denseVector = buildRegisteredUserColdStartEmbedding({
      id: user.id,
      username: user.username,
      region: user.region,
      language: user.language,
    });

    const qualityScore = Number(
      Math.min(0.98, Math.max(0.58, 0.56 + user.activityScore * 0.25 + user.influenceScore * 0.17)).toFixed(3),
    );

    return {
      userId: user.id,
      interestedInClusters: clusterPairs,
      knownForCluster: isProducer ? primaryClusterId : undefined,
      knownForScore: isProducer ? Number((0.68 + user.influenceScore * 0.3).toFixed(3)) : undefined,
      producerEmbedding,
      twoTowerEmbedding: denseVector,
      twoTowerEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
      phoenixEmbedding: denseVector,
      phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
      version: 2,
      modelVersion: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.modelVersion,
      artifactVersion: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.artifactVersion,
      computedAt: now,
      expiresAt,
      qualityScore,
    };
  });
}

/**
 * 构造或更新 12 个社区的 ClusterDefinition，包含真实的 Top Producers 与高赞代表帖 ID
 */
export function buildSyntheticClusterDefinitions(input: {
  allUsers: SyntheticUserRecord[];
  posts: SyntheticPostRecord[];
  statsByPostId: Map<string, PostReconciledStats>;
  rng: SeededRng;
}): any[] {
  const now = new Date();

  return COMMUNITY_ORDER.map((clusterKey: CommunityKey) => {
    const config = COMMUNITY_CONFIGS[clusterKey];
    const clusterProducers = input.allUsers
      .filter(
        (u) =>
          !u.isRealUser &&
          u.primaryCluster === clusterKey &&
          (u.tier === 'kol' || u.tier === 'bridge' || u.tier === 'creator'),
      )
      .sort((a, b) => b.influenceScore - a.influenceScore);

    const clusterPosts = input.posts
      .filter((p) => p.cluster === clusterKey)
      .sort((a, b) => {
        const sA = input.statsByPostId.get(String(a._id))?.engagementScore || 0;
        const sB = input.statsByPostId.get(String(b._id))?.engagementScore || 0;
        return sB - sA;
      });

    const interestedCount = input.allUsers.filter(
      (u) => u.primaryCluster === clusterKey || u.secondaryClusters.includes(clusterKey),
    ).length;

    const avgEngagement =
      clusterPosts.length > 0
        ? clusterPosts.reduce((sum, p) => sum + (input.statsByPostId.get(String(p._id))?.engagementScore || 0), 0) /
          clusterPosts.length
        : 0;

    return {
      clusterId: config.clusterId,
      clusterType: 'topic_cluster',
      name: config.label,
      description: `${config.zhLabel} (${config.label}) — ${config.keywords.slice(0, 4).join(', ')}`,
      tags: config.keywords,
      topProducers: clusterProducers.slice(0, 20).map((producer, index) => ({
        userId: producer.id,
        score: Number(Math.max(0.35, producer.influenceScore).toFixed(3)),
        rank: index + 1,
        joinedAt: producer.createdAt,
      })),
      representativePostIds: clusterPosts.slice(0, 10).map((p) => String(p._id)),
      relatedClusters: config.adjacentClusters.map((adj, index) => ({
        clusterId: COMMUNITY_CONFIGS[adj].clusterId,
        similarity: Number((0.72 - index * 0.1).toFixed(3)),
      })),
      stats: {
        totalMembers: clusterProducers.length,
        activeMembers: clusterProducers.filter((p) => p.activityScore >= 0.45).length,
        avgMemberScore: 0.81,
        interestedInCount: interestedCount,
        avgDailyPosts: Number((clusterPosts.length / 30).toFixed(2)),
        avgEngagementRate: Number(Math.min(1, avgEngagement / 120).toFixed(3)),
        memberGrowthRate: Number(input.rng.float(0.08, 0.28).toFixed(2)),
        engagementGrowthRate: Number(input.rng.float(0.12, 0.35).toFixed(2)),
      },
      level: 0,
      version: 2,
      isActive: true,
      lastRecomputedAt: now,
    };
  });
}
