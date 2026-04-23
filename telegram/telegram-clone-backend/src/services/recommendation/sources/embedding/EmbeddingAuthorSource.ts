import { Source } from '../../framework';
import { FeedCandidate } from '../../types/FeedCandidate';
import { FeedQuery } from '../../types/FeedQuery';
import Post from '../../../../models/Post';
import { materializeGraphAuthorPosts } from '../../providers/graphKernel/authorPostMaterializer';
import {
    computeAuthorEmbeddingOverlap,
    computeEmbeddingRecallSignals,
    computeEmbeddingRecallSignalsFromSnapshot,
    loadAuthorEmbeddingSnapshots,
    prepareEmbeddingRetrievalContext,
    shouldUseEmbeddingAuthorRecall,
} from '../../utils/embeddingRetrieval';
import { getSpaceFeedExperimentFlag } from '../../utils/experimentFlags';
import { postFeatureSnapshotService } from '../../contentFeatures';
import { isSourceEnabledForQuery } from '../../utils/sourceMixing';
import {
    buildClusterProducerPriorMap,
    buildNormalizedAuthorSignalMap,
    clamp01,
} from '../../signals/authorSemantics';

const CONFIG = {
    maxClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_AUTHOR_MAX_CLUSTERS || '6'), 10) || 6,
    ),
    maxAuthors: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_AUTHOR_MAX_AUTHORS || '36'), 10) || 36,
    ),
    limitPerAuthor: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_AUTHOR_LIMIT_PER_AUTHOR || '2'), 10) || 2,
    ),
    lookbackDays: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_AUTHOR_LOOKBACK_DAYS || '14'), 10) || 14,
    ),
    maxResults: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_AUTHOR_MAX_RESULTS || '48'), 10) || 48,
    ),
};

type AuthorRecallSignals = {
    clusterProducerPrior: number;
    authorEmbeddingOverlap: number;
    graphCoEngagementPrior: number;
    recentProductivity: number;
    noveltyPenalty: number;
    score: number;
};

export class EmbeddingAuthorSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'EmbeddingAuthorSource';

    enable(query: FeedQuery): boolean {
        if (query.inNetworkOnly) {
            return false;
        }
        if (!getSpaceFeedExperimentFlag(query, 'enable_embedding_author_source', true)) {
            return false;
        }
        return isSourceEnabledForQuery(query, this.name) && shouldUseEmbeddingAuthorRecall(query);
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const authorScores = await this.collectAuthorScores(query);
        if (authorScores.size === 0) {
            return [];
        }

        const authorIds = Array.from(authorScores.entries())
            .sort((left, right) => right[1].score - left[1].score)
            .slice(0, CONFIG.maxAuthors)
            .map(([authorId]) => authorId);

        const materialized = await materializeGraphAuthorPosts({
            authorIds,
            limitPerAuthor: CONFIG.limitPerAuthor,
            lookbackDays: CONFIG.lookbackDays,
        });
        if (materialized.length === 0) {
            return [];
        }

        const context = await prepareEmbeddingRetrievalContext(query);
        if (!context) {
            return [];
        }

        const snapshots = await postFeatureSnapshotService.ensureSnapshotsByPostIds(
            materialized.map((candidate) => candidate.postId),
        );
        const authorEmbeddings = await loadAuthorEmbeddingSnapshots(
            materialized.map((candidate) => candidate.authorId),
        );

        return materialized
            .map((candidate) => {
                const authorPrior = authorScores.get(candidate.authorId);
                if (!authorPrior) {
                    return undefined;
                }
                const snapshot = snapshots.get(candidate.postId.toString());
                const signals = snapshot
                    ? computeEmbeddingRecallSignalsFromSnapshot(snapshot, context, authorEmbeddings.get(candidate.authorId))
                    : computeEmbeddingRecallSignals(
                        candidate,
                        [],
                        context,
                        authorEmbeddings.get(candidate.authorId),
                    );
                const engagement = normalizeEngagement(candidate);
                const recency = recencyBoost(candidate.createdAt);
                const score =
                    authorPrior.score * 0.36 +
                    signals.authorScore * 0.18 +
                    signals.clusterScore * 0.12 +
                    signals.keywordScore * 0.05 +
                    signals.denseVectorScore * 0.16 +
                    engagement * 0.07 +
                    recency * 0.06;

                return {
                    ...candidate,
                    inNetwork: false,
                    recallSource: this.name,
                    retrievalLane: 'interest',
                    _scoreBreakdown: {
                        ...(candidate._scoreBreakdown || {}),
                        retrievalEmbeddingScore: score,
                        retrievalAuthorPrior: authorPrior.score,
                        retrievalAuthorClusterProducerPrior: authorPrior.clusterProducerPrior,
                        retrievalAuthorEmbeddingOverlap: authorPrior.authorEmbeddingOverlap,
                        retrievalAuthorGraphPrior: authorPrior.graphCoEngagementPrior,
                        retrievalAuthorProductivity: authorPrior.recentProductivity,
                        retrievalAuthorNoveltyPenalty: authorPrior.noveltyPenalty,
                        retrievalAuthorClusterScore: signals.authorScore,
                        retrievalCandidateClusterScore: signals.clusterScore,
                        retrievalKeywordScore: signals.keywordScore,
                        retrievalDenseVectorScore: signals.denseVectorScore,
                        retrievalEngagementPrior: engagement,
                    },
                    weightedScore: candidate.weightedScore,
                } as FeedCandidate;
            })
            .filter((candidate): candidate is FeedCandidate => Boolean(candidate))
            .filter((candidate) => (candidate._scoreBreakdown?.retrievalEmbeddingScore || 0) > 0)
            .sort(
                (left, right) =>
                    (right._scoreBreakdown?.retrievalEmbeddingScore || 0) -
                    (left._scoreBreakdown?.retrievalEmbeddingScore || 0),
            )
            .slice(0, CONFIG.maxResults);
    }

    private async collectAuthorScores(query: FeedQuery): Promise<Map<string, AuthorRecallSignals>> {
        const clusterEntries = (query.embeddingContext?.interestedInClusters || [])
            .filter((entry) => Number.isFinite(entry.clusterId) && Number.isFinite(entry.score))
            .sort((left, right) => right.score - left.score)
            .slice(0, CONFIG.maxClusters);
        if (clusterEntries.length === 0) {
            return new Map();
        }
        const context = await prepareEmbeddingRetrievalContext(query);
        if (!context) {
            return new Map();
        }

        const excludedAuthors = new Set<string>([
            query.userId,
            ...(query.userFeatures?.followedUserIds || []),
            ...(query.userFeatures?.blockedUserIds || []),
        ]);

        const clusterProducerPriors = await buildClusterProducerPriorMap(clusterEntries, {
            excludedAuthorIds: excludedAuthors,
            maxProducersPerCluster: 12,
        });

        const authorIds = Array.from(clusterProducerPriors.keys());
        if (authorIds.length === 0) {
            return new Map();
        }

        const [authorEmbeddings, authorProductivity] = await Promise.all([
            loadAuthorEmbeddingSnapshots(authorIds),
            loadRecentAuthorProductivity(authorIds),
        ]);
        const actionPriors = buildAuthorActionPriors(query);
        const maxPositiveActionWeight = Math.max(
            1,
            ...Array.from(actionPriors.values()).map((entry) => entry.positiveWeight),
        );

        const authorScores = new Map<string, AuthorRecallSignals>();
        for (const [authorId, clusterProducerPrior] of clusterProducerPriors.entries()) {
            const authorEmbeddingOverlap = computeAuthorEmbeddingOverlap(
                context,
                authorEmbeddings.get(authorId),
            );
            const interaction = actionPriors.get(authorId);
            const graphCoEngagementPrior = clamp01(
                (interaction?.positiveWeight || 0) / maxPositiveActionWeight,
            );
            const recentProductivity = authorProductivity.get(authorId) || 0;
            const noveltyPenalty = clamp01(
                Math.max(0, (interaction?.positiveWeight || 0) - 1.5) / 4,
            );
            const score = Math.max(
                0,
                clusterProducerPrior * 0.42 +
                authorEmbeddingOverlap * 0.24 +
                graphCoEngagementPrior * 0.15 +
                recentProductivity * 0.13 -
                noveltyPenalty * 0.08,
            );
            authorScores.set(authorId, {
                clusterProducerPrior,
                authorEmbeddingOverlap,
                graphCoEngagementPrior,
                recentProductivity,
                noveltyPenalty,
                score,
            });
        }

        return authorScores;
    }
}

function normalizeEngagement(candidate: FeedCandidate): number {
    const engagements =
        (candidate.likeCount || 0) +
        (candidate.commentCount || 0) * 2 +
        (candidate.repostCount || 0) * 3;
    return Math.min(engagements / 100, 1);
}

async function loadRecentAuthorProductivity(authorIds: string[]): Promise<Map<string, number>> {
    if (authorIds.length === 0) {
        return new Map();
    }

    const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const rows = await Post.aggregate<{
        _id: string;
        postCount: number;
        weightedEngagement: number;
    }>([
        {
            $match: {
                authorId: { $in: authorIds },
                deletedAt: null,
                isNews: { $ne: true },
                createdAt: { $gte: since },
            },
        },
        {
            $group: {
                _id: '$authorId',
                postCount: { $sum: 1 },
                weightedEngagement: {
                    $sum: {
                        $add: [
                            { $ifNull: ['$stats.likeCount', 0] },
                            { $multiply: [{ $ifNull: ['$stats.commentCount', 0] }, 2] },
                            { $multiply: [{ $ifNull: ['$stats.repostCount', 0] }, 3] },
                        ],
                    },
                },
            },
        },
    ]);

    const productivity = new Map<string, number>();
    for (const row of rows) {
        productivity.set(
            row._id,
            clamp01((row.postCount / 6) * 0.6 + (row.weightedEngagement / 120) * 0.4),
        );
    }
    return productivity;
}

function buildAuthorActionPriors(
    query: FeedQuery,
): Map<string, { positiveWeight: number }> {
    const normalized = buildNormalizedAuthorSignalMap(
        (query.userActionSequence || []).map((action) => ({
            action: String(action.action || ''),
            targetAuthorId: action.targetAuthorId,
            dwellTimeMs: action.dwellTimeMs,
            timestamp: action.timestamp,
        })),
        { applyRecency: true },
    );
    const priors = new Map<string, { positiveWeight: number }>();
    for (const [authorId, positiveWeight] of normalized.entries()) {
        priors.set(authorId, {
            positiveWeight,
        });
    }
    return priors;
}

function recencyBoost(createdAt: Date): number {
    const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (60 * 60 * 1000));
    if (ageHours <= 24) return 1;
    if (ageHours <= 72) return 0.75;
    if (ageHours <= 24 * 7) return 0.45;
    return 0.2;
}
