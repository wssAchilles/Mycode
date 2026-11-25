import type mongoose from 'mongoose';

/**
 * 合成社交图谱人群角色分层（参考 LDBC SNB + Twitter/X 真实幂律结构）
 */
export type SyntheticUserTier = 'kol' | 'bridge' | 'creator' | 'reader';

/**
 * 规模预设档位
 */
export type SyntheticScalePreset = 'compact' | 'standard' | 'large';

/**
 * 12 个主题社区键名
 */
export type CommunityKey =
  | 'ai'
  | 'recsys'
  | 'rust'
  | 'go'
  | 'frontend'
  | 'growth'
  | 'finance'
  | 'science'
  | 'gaming'
  | 'cinema'
  | 'design'
  | 'lifestyle';

export interface ScaleProfile {
  preset: SyntheticScalePreset;
  totalUsers: number;
  kolCount: number;
  bridgeCount: number;
  creatorCount: number;
  readerCount: number;
  targetPosts: number;
  targetLikes: number;
  targetComments: number;
  targetReposts: number;
  targetImpressions: number;
  flashmobPostRatio: number;
  lookbackDays: number;
}

export interface CliOptions {
  scale: SyntheticScalePreset;
  seed: number;
  dryRun: boolean;
  cleanOnly: boolean;
  reset: boolean;
  purgeDemo: boolean;
  reconcileExisting: boolean;
  attachRealUsers: boolean;
  targetRealUsernames: string[];
  password: string;
}

export interface CommunityConfig {
  key: CommunityKey;
  clusterId: number;
  label: string;
  zhLabel: string;
  keywords: string[];
  adjacentClusters: CommunityKey[];
  locations: string[];
  postHooks: string[];
  postBodies: string[];
  postOutcomes: string[];
  commentTemplates: string[];
  replyTemplates: string[];
}

export interface SyntheticUserRecord {
  id: string;
  username: string;
  displayName: string;
  tier: SyntheticUserTier;
  isRealUser?: boolean;
  primaryCluster: CommunityKey;
  secondaryClusters: CommunityKey[];
  affinityWeights: Record<CommunityKey, number>;
  activityScore: number;
  influenceScore: number;
  language: string;
  region: string;
  location: string;
  bio: string;
  website: string;
  avatarUrl: string;
  birthDate: Date;
  isOnline: boolean;
  lastSeen: Date;
  createdAt: Date;
}

export interface DirectedFollowEdge {
  userId: string;
  contactId: string;
  addedAt: Date;
  strength: number;
  isMutual: boolean;
  reason: 'homophily' | 'triadic_closure' | 'bridge' | 'kol_follow' | 'real_user_attach';
}

export interface SyntheticPostRecord {
  _id: mongoose.Types.ObjectId;
  authorId: string;
  authorTier: SyntheticUserTier | 'real';
  cluster: CommunityKey;
  secondaryCluster?: CommunityKey;
  content: string;
  keywords: string[];
  language: string;
  createdAt: Date;
  isFlashmob: boolean;
  viralityFactor: number;
  isQuote: boolean;
  originalPostId?: mongoose.Types.ObjectId;
  quoteContent?: string;
}

export interface GeneratedCommentRecord {
  _id: mongoose.Types.ObjectId;
  userId: string;
  postId: mongoose.Types.ObjectId;
  content: string;
  parentId: mongoose.Types.ObjectId | null;
  replyToUserId?: string;
  likeCount: number;
  createdAt: Date;
}

export interface GeneratedLikeRecord {
  userId: string;
  postId: mongoose.Types.ObjectId;
  authorId: string;
  createdAt: Date;
}

export interface GeneratedRepostRecord {
  userId: string;
  postId: mongoose.Types.ObjectId;
  type: 'repost' | 'quote';
  quotePostId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface GeneratedActionRecord {
  userId: string;
  action: string;
  targetPostId?: mongoose.Types.ObjectId;
  targetCommentId?: mongoose.Types.ObjectId;
  targetAuthorId?: string;
  requestId: string;
  productSurface: string;
  rank?: number;
  score?: number;
  weightedScore?: number;
  inNetwork: boolean;
  isNews: boolean;
  modelPostId?: string;
  recallSource: string;
  experimentKeys: string[];
  targetKeywords: string[];
  dwellTimeMs?: number;
  actionText?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface PostReconciledStats {
  likeCount: number;
  repostCount: number;
  quoteCount: number;
  commentCount: number;
  viewCount: number;
  engagementScore: number;
}

export interface GenerationSummaryReport {
  scriptVersion: string;
  preset: SyntheticScalePreset;
  seed: number;
  dryRun: boolean;
  users: {
    syntheticTotal: number;
    realAttached: number;
    byTier: Record<SyntheticUserTier, number>;
  };
  graph: {
    followEdges: number;
    realGraphEdges: number;
    avgOutDegree: number;
    maxInDegree: number;
    topKolUsernames: Array<{ username: string; inDegree: number }>;
  };
  content: {
    posts: number;
    quotePosts: number;
    flashmobPosts: number;
    recent7dPosts: number;
    postFeatureSnapshots: number;
    timelineZsetEntries: number;
  };
  interactions: {
    likes: number;
    topLevelComments: number;
    nestedReplies: number;
    reposts: number;
    userActions: number;
    userSignals: number;
    negativeActions: number;
  };
  integrityChecks: {
    postStatsExactMatch: boolean;
    mismatchedPostCount: number;
    orphanSnapshotsCleaned: number;
    historicalPostsReconciled: number;
  };
}

export const SCALE_PROFILES: Record<SyntheticScalePreset, ScaleProfile> = {
  compact: {
    preset: 'compact',
    totalUsers: 320,
    kolCount: 24,
    bridgeCount: 36,
    creatorCount: 80,
    readerCount: 180,
    targetPosts: 900,
    targetLikes: 4500,
    targetComments: 1600,
    targetReposts: 900,
    targetImpressions: 18000,
    flashmobPostRatio: 0.08,
    lookbackDays: 30,
  },
  standard: {
    preset: 'standard',
    totalUsers: 720,
    kolCount: 48,
    bridgeCount: 72,
    creatorCount: 180,
    readerCount: 420,
    targetPosts: 2000,
    targetLikes: 11000,
    targetComments: 3800,
    targetReposts: 2100,
    targetImpressions: 38000,
    flashmobPostRatio: 0.08,
    lookbackDays: 30,
  },
  large: {
    preset: 'large',
    totalUsers: 1200,
    kolCount: 60,
    bridgeCount: 96,
    creatorCount: 244,
    readerCount: 800,
    targetPosts: 3200,
    targetLikes: 18000,
    targetComments: 6000,
    targetReposts: 3500,
    targetImpressions: 58000,
    flashmobPostRatio: 0.08,
    lookbackDays: 30,
  },
};

export const SYNTH_SCRIPT_VERSION = 'synth_ldbc_sbm_v2';
export const SYNTH_USERNAME_PREFIX = 'synth_';
export const SYNTH_MANIFEST_ID = 'synthetic_social_graph_v2';
