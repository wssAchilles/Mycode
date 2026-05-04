import type { FeedCandidate, RecommendationExplain } from '../types/FeedCandidate';
import {
    pickFeedSignalGroup,
    readFeedSignalValue,
} from '../signals/feedSignalSemantics';

type NormalizeMediaUrl = (value?: string | null) => string | null | undefined;

export interface SpaceFeedResponseAdapterOptions {
    newsBotAvatarUrl: string;
    normalizeMediaUrl: NormalizeMediaUrl;
    exposeScoreBreakdown: boolean;
    exposeRecommendationDebug: boolean;
    exposeExplainSignals: boolean;
}

/**
 * 将 FeedCandidate 转换为前端期望的 PostResponse 格式。
 *
 * 默认响应只保留推荐解释的稳定字段；信号快照和 score breakdown 只在调试开关开启时输出。
 */
export function transformFeedCandidateToResponse(
    candidate: FeedCandidate,
    options: SpaceFeedResponseAdapterOptions,
) {
    const isNews = Boolean(candidate.isNews);
    const media = (candidate.media || []).map((m: any) => ({
        ...m,
        url: options.normalizeMediaUrl(m?.url),
        thumbnailUrl: options.normalizeMediaUrl(m?.thumbnailUrl),
    }));
    const recommendationDetail = buildRecommendationDetail(candidate);

    return {
        _id: candidate.postId.toString(),
        id: candidate.postId.toString(),
        originalPostId: candidate.originalPostId?.toString(),
        replyToPostId: candidate.replyToPostId?.toString(),
        conversationId: candidate.conversationId?.toString(),
        authorId: candidate.authorId,
        authorUsername: isNews ? 'NewsBot' : (candidate.authorUsername || 'Unknown'),
        authorAvatarUrl: isNews
            ? options.newsBotAvatarUrl
            : options.normalizeMediaUrl(candidate.authorAvatarUrl || null),
        content: candidate.content,
        media,
        createdAt: candidate.createdAt.toISOString(),
        likeCount: candidate.likeCount ?? 0,
        commentCount: candidate.commentCount ?? 0,
        repostCount: candidate.repostCount ?? 0,
        viewCount: candidate.viewCount ?? 0,
        isLiked: candidate.isLikedByUser || false,
        isReposted: candidate.isRepostedByUser || false,
        isPinned: candidate.isPinned || false,
        isNews,
        newsMetadata: candidate.newsMetadata ?? undefined,
        _recommendationScore: candidate.score,
        _inNetwork: candidate.inNetwork,
        _recallSource: candidate.recallSource,
        _recommendationDetail: recommendationDetail,
        _recommendationExplain: buildPublicRecommendationExplain(
            candidate.recommendationExplain,
            options.exposeExplainSignals,
        ),
        ...(options.exposeRecommendationDebug
            ? {
                _recommendationTrace: buildRecommendationTrace(candidate, recommendationDetail),
            }
            : {}),
        ...(options.exposeScoreBreakdown
            ? {
                _scoreBreakdown: candidate._scoreBreakdown,
                _pipelineScore: candidate._pipelineScore,
            }
            : {}),
    };
}

function buildPublicRecommendationExplain(
    explain: RecommendationExplain | undefined,
    exposeSignals: boolean,
): RecommendationExplain | undefined {
    if (!explain || exposeSignals) {
        return explain;
    }

    const { signals: _signals, ...publicExplain } = explain;
    return publicExplain;
}

function buildRecommendationTrace(candidate: FeedCandidate, recommendationDetail?: string) {
    const signalInput = {
        candidate,
        scoreBreakdown: candidate._scoreBreakdown,
        explainSignals: candidate.recommendationExplain?.signals,
    };
    const positivePhoenixActions = Object.entries(candidate.phoenixScores || {})
        .filter((entry) => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0)
        .sort((left, right) => (right[1] as number) - (left[1] as number))
        .slice(0, 4)
        .map(([action, score]) => ({ action, score }));

    return {
        recallSource: candidate.recallSource,
        inNetwork: Boolean(candidate.inNetwork),
        recommendationDetail,
        explain: candidate.recommendationExplain
            ? {
                primarySource: candidate.recommendationExplain.primarySource,
                sourceReason: candidate.recommendationExplain.sourceReason,
                evidence: candidate.recommendationExplain.evidence,
                signals: candidate.recommendationExplain.signals,
                userState: candidate.recommendationExplain.userState,
                selectionPool: candidate.recommendationExplain.selectionPool,
                selectionReason: candidate.recommendationExplain.selectionReason,
            }
            : undefined,
        retrieval: {
            embeddingScore: readFeedSignalValue(signalInput, 'retrievalEmbeddingScore'),
            authorClusterScore: readFeedSignalValue(signalInput, 'retrievalAuthorClusterScore'),
            candidateClusterScore: readFeedSignalValue(signalInput, 'retrievalCandidateClusterScore'),
            keywordScore: readFeedSignalValue(signalInput, 'retrievalKeywordScore'),
            engagementPrior: readFeedSignalValue(signalInput, 'retrievalEngagementPrior'),
            ...pickFeedSignalGroup(signalInput, 'distribution'),
        },
        ranking: {
            weightedScore: readFeedSignalValue(signalInput, 'weightedScore'),
            finalScore: readFeedSignalValue(signalInput, 'finalScore'),
            pipelineScore: readFeedSignalValue(signalInput, 'pipelineScore'),
            calibrationSourceMultiplier: readFeedSignalValue(signalInput, 'calibrationSourceMultiplier'),
            calibrationEmbeddingQualityMultiplier: readFeedSignalValue(signalInput, 'calibrationEmbeddingQualityMultiplier'),
            authorAffinityScore: readFeedSignalValue(signalInput, 'authorAffinityScore'),
            trendPersonalizationStrength: readFeedSignalValue(signalInput, 'trendPersonalizationStrength'),
            explorationRisk: readFeedSignalValue(signalInput, 'explorationRisk'),
            fatigueStrength: readFeedSignalValue(signalInput, 'fatigueStrength'),
            sessionSuppressionStrength: readFeedSignalValue(signalInput, 'sessionSuppressionStrength'),
            intraRequestRedundancyPenalty: readFeedSignalValue(signalInput, 'intraRequestRedundancyPenalty'),
        },
        phoenix: positivePhoenixActions.length > 0
            ? {
                topPositiveActions: positivePhoenixActions,
            }
            : undefined,
    };
}

function buildRecommendationDetail(candidate: FeedCandidate): string | undefined {
    if (candidate.recommendationExplain?.detail) {
        return candidate.recommendationExplain.detail;
    }
    const signalInput = {
        candidate,
        scoreBreakdown: candidate._scoreBreakdown,
    };
    switch (candidate.recallSource) {
        case 'FollowingSource':
            return candidate.authorAffinityScore && candidate.authorAffinityScore > 0.2
                ? '来自已关注作者，且你近期互动较多'
                : '来自已关注作者';
        case 'GraphSource':
            return '来自你的社交图邻近作者';
        case 'TwoTowerSource':
            if (
                (readFeedSignalValue(signalInput, 'retrievalAuthorClusterScore') || 0) > 0.2
                && (readFeedSignalValue(signalInput, 'retrievalCandidateClusterScore') || 0) > 0.15
            ) {
                return '匹配你的兴趣社区与作者画像';
            }
            if ((readFeedSignalValue(signalInput, 'retrievalKeywordScore') || 0) > 0.1) {
                return '匹配你的兴趣关键词与社区';
            }
            return '匹配你的兴趣向量';
        case 'PopularSource':
            return (readFeedSignalValue(signalInput, 'retrievalEmbeddingScore') || 0) > 0.15
                ? '热门内容，且与你的兴趣相近'
                : '当前热门内容';
        case 'NewsAnnSource':
            return '基于主题向量召回';
        case 'ColdStartSource':
            return '帮助你发现新的作者';
        default:
            if (candidate.authorAffinityScore && candidate.authorAffinityScore > 0.2) {
                return '基于你的互动偏好';
            }
            return undefined;
    }
}
