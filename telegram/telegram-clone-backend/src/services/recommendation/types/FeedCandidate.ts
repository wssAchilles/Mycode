/**
 * Feed 候选者对象
 * 复刻 x-algorithm 的 PostCandidate
 */

import mongoose from 'mongoose';

/**
 * Phoenix 评分结构
 * 复刻 x-algorithm phoenix_scorer.rs 的 PhoenixScores
 */
export interface PhoenixScores {
    // Positive actions
    likeScore?: number;
    replyScore?: number;
    repostScore?: number;
    quoteScore?: number;
    clickScore?: number;
    quotedClickScore?: number;
    profileClickScore?: number;
    dwellScore?: number;
    /** Continuous dwell time signal (model output). */
    dwellTime?: number;
    shareScore?: number;
    shareViaDmScore?: number;
    shareViaCopyLinkScore?: number;
    photoExpandScore?: number;
    followAuthorScore?: number;
    videoQualityViewScore?: number;
    // 负向行为预测
    notInterestedScore?: number;
    dismissScore?: number;
    blockAuthorScore?: number;
    blockScore?: number;
    muteAuthorScore?: number;
    reportScore?: number;
}

export interface ActionScores {
    click: number;
    like: number;
    reply: number;
    repost: number;
    dwell: number;
    negative: number;
}

export interface RankingSignals {
    relevance: number;
    freshness: number;
    popularity: number;
    quality: number;
    authorAffinity: number;
    topicAffinity: number;
    sourceAffinity: number;
    conversationAffinity: number;
    sourceEvidence: number;
    network: number;
    negativeFeedback: number;
    deliveryFatigue: number;
}

export interface RecallEvidence {
    primarySource?: string;
    primaryLane?: string;
    sourceRank?: number;
    sourceRankScore?: number;
    sourceScore?: number;
    sourceCount: number;
    sameLaneSourceCount: number;
    crossLaneSourceCount: number;
    confidence: number;
}

export interface CandidateNewsMetadata {
    title?: string;
    source?: string;
    url?: string;
    sourceUrl?: string;
    externalId?: string;
    clusterId?: number;
    summary?: string;
}

export interface RecommendationExplain {
    detail?: string;
    primarySource: string;
    sourceReason: string;
    inNetwork: boolean;
    embeddingMatched: boolean;
    graphMatched: boolean;
    popularFallback: boolean;
    diversityAdjusted: boolean;
    userState?: string;
    selectionPool?: string;
    selectionReason?: string;
    evidence: string[];
    signals?: Record<string, number>;
}

export type InterestPoolKind =
    | 'dense_pool'
    | 'cluster_pool'
    | 'legacy_pool'
    | 'ann_pool'
    | 'keyword_fallback'
    | 'embedding_author'
    | 'popular_embedding'
    | 'popular_keyword';

/**
 * Feed 候选者
 */
export interface FeedCandidate {
    /** 帖子 ID */
    postId: mongoose.Types.ObjectId;

    /**
     * Model identifier used for ML retrieval/ranking and ML-side dedup.
     * - News: `newsMetadata.externalId` (e.g. MIND `N12345`)
     * - Social: Mongo ObjectId string
     */
    modelPostId?: string;

    /** 作者 ID */
    authorId: string;

    /** 帖子内容 (用于关键词过滤) */
    content: string;

    /** 创建时间 */
    createdAt: Date;
    /** 对话根 ID（用于对话去重） */
    conversationId?: mongoose.Types.ObjectId;

    // ============================================
    // 帖子属性 (用于过滤和评分)
    // ============================================

    /** 是否是回复 */
    isReply: boolean;

    /** 回复的帖子 ID */
    replyToPostId?: mongoose.Types.ObjectId;

    /** 是否是转发 */
    isRepost: boolean;

    /** 原帖 ID (如果是转发) */
    originalPostId?: mongoose.Types.ObjectId;

    /** 是否来自关注网络 (复刻 in_network) */
    inNetwork?: boolean;
    /** 召回来源（FollowingSource / NewsAnnSource / ColdStartSource ...） */
    recallSource?: string;
    /** 召回 lane（in_network / social_expansion / interest / fallback） */
    retrievalLane?: string;
    /** interest/fallback lane 内部更细的候选池来源 */
    interestPoolKind?: InterestPoolKind;
    /** 同一帖子命中多个 source 时保留的次级召回证据 */
    secondaryRecallSources?: string[];

    /** 媒体类型 */
    hasVideo?: boolean;
    hasImage?: boolean;
    /** 视频时长（秒） */
    videoDurationSec?: number;

    /** 媒体列表 (用于前端展示) */
    media?: { type: string; url: string; thumbnailUrl?: string }[];

    // ============================================
    // 统计数据 (由 Hydrator 填充)
    // ============================================

    /** 点赞数 */
    likeCount?: number;

    /** 评论数 */
    commentCount?: number;

    /** 转发数 */
    repostCount?: number;

    /** 浏览数 */
    viewCount?: number;

    // ============================================
    // 作者信息 (由 Hydrator 填充)
    // ============================================

    /** 作者用户名 */
    authorUsername?: string;

    /** 作者头像 */
    authorAvatarUrl?: string;

    /** 用户与作者的亲密度分数 */
    authorAffinityScore?: number;

    // ============================================
    // 评分字段 (由 Scorer 填充)
    // ============================================

    /** Phoenix ML 评分 */
    phoenixScores?: PhoenixScores;
    /** 统一多动作轻量分 */
    actionScores?: ActionScores;
    /** 统一排序信号 */
    rankingSignals?: RankingSignals;
    /** 多路召回证据 */
    recallEvidence?: RecallEvidence;
    /** selector 输出的分层池 */
    selectionPool?: string;
    /** selector 输出的选择原因 */
    selectionReason?: string;
    /** 排序 contract 版本 */
    scoreContractVersion?: string;
    /** 分数明细 contract 版本 */
    scoreBreakdownVersion?: string;

    /** 加权综合评分 (复刻 weighted_score) */
    weightedScore?: number;

    /** 最终评分 (经过多样性调整后) */
    score?: number;
    /** Debug-only: 各 scorer 的分数明细（由 pipeline debug 模式注入） */
    _scoreBreakdown?: Record<string, number>;
    /** Debug-only: selector 阶段使用的 pipeline score */
    _pipelineScore?: number;
    /** 统一的推荐解释字段（用于 API debug / trace / 面试演示） */
    recommendationExplain?: RecommendationExplain;

    /** 图召回附加信号 */
    graphScore?: number;
    graphPath?: string;
    graphRecallType?: string;

    // ============================================
    // 用户交互状态 (由 Hydrator 填充)
    // ============================================

    /** 当前用户是否已点赞 */
    isLikedByUser?: boolean;

    /** 当前用户是否已转发 */
    isRepostedByUser?: boolean;

    /** 安全标记（例如 NSFW） */
    isNsfw?: boolean;

    /**
     * VF（visibility filtering）结果（post-selection hydration 后填充）
     * - safe: 是否可见
     * - level: safe/low_risk/medium/high/blocked（字符串以避免强耦合）
     */
    vfResult?: {
        safe: boolean;
        reason?: string;
        level?: string;
        score?: number;
        violations?: string[];
        requiresReview?: boolean;
    };

    /** 是否是新闻内容（用于在 Space feed 中混入 NewsBot OON 供给） */
    isNews?: boolean;
    /** 新闻附加元数据（可选） */
    newsMetadata?: CandidateNewsMetadata;

    /** 是否置顶（Space profile pinned post） */
    isPinned?: boolean;
}

/**
 * 从 Post 文档创建候选者
 */
export function createFeedCandidate(post: {
    _id: mongoose.Types.ObjectId;
    authorId: string;
    content: string;
    createdAt: Date;
    isPinned?: boolean;
    isReply?: boolean;
    replyToPostId?: mongoose.Types.ObjectId;
    isRepost?: boolean;
    originalPostId?: mongoose.Types.ObjectId;
    conversationId?: mongoose.Types.ObjectId;
    media?: { type: string; url: string; thumbnailUrl?: string }[];
    stats?: {
        likeCount?: number;
        commentCount?: number;
        repostCount?: number;
        viewCount?: number;
    };
    keywords?: string[];
    language?: string;
    isNsfw?: boolean;
    isNews?: boolean;
    newsMetadata?: CandidateNewsMetadata;
}): FeedCandidate {
    const isNews = post.isNews ?? false;
    const externalId = post.newsMetadata?.externalId;
    const modelPostId =
        isNews && typeof externalId === 'string' && externalId.length > 0
            ? externalId
            : post._id.toString();

    return {
        postId: post._id,
        modelPostId,
        authorId: post.authorId,
        content: post.content,
        createdAt: post.createdAt,
        isPinned: post.isPinned ?? false,
        isReply: post.isReply || false,
        replyToPostId: post.replyToPostId,
        isRepost: post.isRepost || false,
        originalPostId: post.originalPostId,
        conversationId: post.conversationId,
        hasVideo: post.media?.some((m) => m.type === 'video'),
        hasImage: post.media?.some((m) => m.type === 'image'),
        media: post.media || [],
        likeCount: post.stats?.likeCount,
        commentCount: post.stats?.commentCount,
        repostCount: post.stats?.repostCount,
        viewCount: post.stats?.viewCount,
        isNsfw: post.isNsfw ?? false,
        isNews,
        newsMetadata: post.newsMetadata,
    };
}
