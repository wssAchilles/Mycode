import { Source } from '../../framework';
import { FeedCandidate } from '../../types/FeedCandidate';
import { FeedQuery, SparseEmbeddingEntry } from '../../types/FeedQuery';
import ClusterDefinition from '../../../../models/ClusterDefinition';
import { materializeGraphAuthorPosts } from '../../providers/graphKernel/authorPostMaterializer';
import {
    computeEmbeddingRecallSignals,
    computeEmbeddingRecallSignalsFromSnapshot,
    hasUsableEmbeddingContext,
    loadAuthorEmbeddingSnapshots,
    prepareEmbeddingRetrievalContext,
} from '../../utils/embeddingRetrieval';
import { getSpaceFeedExperimentFlag } from '../../utils/experimentFlags';
import { postFeatureSnapshotService } from '../../contentFeatures';
import { isSourceEnabledForQuery } from '../../utils/sourceMixing';

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

export class EmbeddingAuthorSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'EmbeddingAuthorSource';

    enable(query: FeedQuery): boolean {
        if (query.inNetworkOnly) {
            return false;
        }
        if (!getSpaceFeedExperimentFlag(query, 'enable_embedding_author_source', true)) {
            return false;
        }
        return isSourceEnabledForQuery(query, this.name) && hasUsableEmbeddingContext(query);
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const authorScores = await this.collectAuthorScores(query);
        if (authorScores.size === 0) {
            return [];
        }

        const authorIds = Array.from(authorScores.entries())
            .sort((left, right) => right[1] - left[1])
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
                const authorPrior = authorScores.get(candidate.authorId) || 0;
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
                    authorPrior * 0.45 +
                    signals.authorScore * 0.14 +
                    signals.clusterScore * 0.12 +
                    signals.keywordScore * 0.05 +
                    signals.denseVectorScore * 0.14 +
                    engagement * 0.07 +
                    recency * 0.03;

                return {
                    ...candidate,
                    inNetwork: false,
                    recallSource: this.name,
                    _scoreBreakdown: {
                        ...(candidate._scoreBreakdown || {}),
                        retrievalEmbeddingScore: score,
                        retrievalAuthorPrior: authorPrior,
                        retrievalAuthorClusterScore: signals.authorScore,
                        retrievalCandidateClusterScore: signals.clusterScore,
                        retrievalKeywordScore: signals.keywordScore,
                        retrievalDenseVectorScore: signals.denseVectorScore,
                        retrievalEngagementPrior: engagement,
                    },
                    weightedScore: candidate.weightedScore,
                } as FeedCandidate;
            })
            .filter((candidate) => (candidate._scoreBreakdown?.retrievalEmbeddingScore || 0) > 0)
            .sort(
                (left, right) =>
                    (right._scoreBreakdown?.retrievalEmbeddingScore || 0) -
                    (left._scoreBreakdown?.retrievalEmbeddingScore || 0),
            )
            .slice(0, CONFIG.maxResults);
    }

    private async collectAuthorScores(query: FeedQuery): Promise<Map<string, number>> {
        const clusterEntries = (query.embeddingContext?.interestedInClusters || [])
            .filter((entry) => Number.isFinite(entry.clusterId) && Number.isFinite(entry.score))
            .sort((left, right) => right.score - left.score)
            .slice(0, CONFIG.maxClusters);
        if (clusterEntries.length === 0) {
            return new Map();
        }

        const clusterDefs = await ClusterDefinition.getClustersBatch(
            clusterEntries.map((entry) => entry.clusterId),
        );
        const excludedAuthors = new Set<string>([
            query.userId,
            ...(query.userFeatures?.followedUserIds || []),
            ...(query.userFeatures?.blockedUserIds || []),
        ]);

        const authorScores = new Map<string, number>();
        for (const clusterEntry of clusterEntries) {
            const cluster = clusterDefs.get(clusterEntry.clusterId);
            if (!cluster) continue;

            for (const producer of (cluster.topProducers || []).slice(0, 12)) {
                if (!producer?.userId || excludedAuthors.has(producer.userId)) {
                    continue;
                }
                const rankDecay = Math.max(0.2, 1 - producer.rank * 0.06);
                const score = clusterEntry.score * producer.score * rankDecay;
                authorScores.set(producer.userId, (authorScores.get(producer.userId) || 0) + score);
            }
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

function recencyBoost(createdAt: Date): number {
    const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (60 * 60 * 1000));
    if (ageHours <= 24) return 1;
    if (ageHours <= 72) return 0.75;
    if (ageHours <= 24 * 7) return 0.45;
    return 0.2;
}
