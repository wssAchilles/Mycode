/**
 * PopularSource - 热门内容源
 * 作为 OON fallback lane，保持热门供给，但用内容快照和 embedding 做 cluster-aware 重排。
 */

import mongoose from 'mongoose';

import Post from '../../../models/Post';
import { postFeatureSnapshotService } from '../contentFeatures';
import { Source } from '../framework';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';
import {
    computeEmbeddingRecallSignals,
    computeEmbeddingRecallSignalsFromSnapshot,
    hasUsableEmbeddingContext,
    loadAuthorEmbeddingSnapshots,
    prepareEmbeddingRetrievalContext,
} from '../utils/embeddingRetrieval';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import { isSourceEnabledForQuery } from '../utils/sourceMixing';

const MAX_RESULTS = 100;
const MIN_ENGAGEMENT = 5;
const FETCH_POOL_SIZE = 200;
const MAX_INTEREST_POSTS = 50;
const RECALL_WINDOWS = [
    { days: 7, minEngagement: MIN_ENGAGEMENT },
    { days: 30, minEngagement: 3 },
    { days: 90, minEngagement: 1 },
    { days: 180, minEngagement: 0 },
] as const;

export class PopularSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'PopularSource';

    enable(query: FeedQuery): boolean {
        return !query.inNetworkOnly
            && isSourceEnabledForQuery(query, this.name)
            && getSpaceFeedExperimentFlag(query, 'enable_popular_source', true);
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        let posts: any[] = [];
        for (const window of RECALL_WINDOWS) {
            posts = await this.findPopularPosts(query, window.days, window.minEngagement);
            if (posts.length > 0) {
                break;
            }
        }

        if (posts.length === 0) {
            return [];
        }

        if (
            getSpaceFeedExperimentFlag(query, 'enable_popular_embedding_rerank', true) &&
            hasUsableEmbeddingContext(query)
        ) {
            const embeddingRanked = await this.rankWithEmbeddingContext(query, posts);
            if (embeddingRanked.length > 0) {
                return embeddingRanked;
            }
        }

        const interestWeights = await this.buildUserInterestKeywords(query);
        return posts
            .map((post) => {
                const similarity = this.computeSimilarity(
                    interestWeights,
                    (post.keywords as string[]) || [],
                );
                const engagement = normalizeEngagement(post);
                const combined = similarity * 0.65 + engagement * 0.35;
                return { post, similarity, engagement, combined };
            })
            .sort((left, right) => right.combined - left.combined)
            .slice(0, MAX_RESULTS)
            .map((item) => ({
                ...createFeedCandidate(item.post as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: false,
                recallSource: this.name,
                retrievalLane: 'fallback',
                interestPoolKind: 'popular_keyword',
                _scoreBreakdown: {
                    retrievalEmbeddingScore: item.combined,
                    retrievalKeywordScore: item.similarity,
                    retrievalEngagementPrior: item.engagement,
                    retrievalPoolPopularKeyword: 1,
                },
            }));
    }

    private async rankWithEmbeddingContext(
        query: FeedQuery,
        posts: any[],
    ): Promise<FeedCandidate[]> {
        const context = await prepareEmbeddingRetrievalContext(query);
        if (!context) {
            return [];
        }

        const snapshots = await postFeatureSnapshotService.ensureSnapshotsForPosts(posts);
        const authorEmbeddings = await loadAuthorEmbeddingSnapshots(posts.map((post) => post.authorId));
        const weights = getPopularWeights(query);

        return posts
            .map((post) => {
                const candidate = createFeedCandidate(post as Parameters<typeof createFeedCandidate>[0]);
                const snapshot = snapshots.get(post._id.toString());
                const signals = snapshot
                    ? computeEmbeddingRecallSignalsFromSnapshot(
                        snapshot,
                        context,
                        authorEmbeddings.get(post.authorId),
                    )
                    : computeEmbeddingRecallSignals(
                        candidate,
                        post.keywords as string[] | undefined,
                        context,
                        authorEmbeddings.get(post.authorId),
                    );
                const engagement = normalizeEngagement(post);
                const recency = recencyPrior(post.createdAt);
                const combined =
                    signals.authorScore * weights.author +
                    signals.clusterScore * weights.cluster +
                    signals.keywordScore * weights.keyword +
                    signals.denseVectorScore * weights.dense +
                    signals.topicCoverageScore * 0.035 +
                    signals.authorTopicProxyScore * 0.025 +
                    signals.candidateTopicCompleteness * 0.02 +
                    engagement * weights.engagement +
                    recency * weights.recency +
                    (snapshot?.qualityScore || 0) * weights.snapshotQuality;

                return {
                    candidate: {
                        ...candidate,
                        inNetwork: false,
                        recallSource: this.name,
                        retrievalLane: 'fallback',
                        interestPoolKind: 'popular_embedding',
                        _scoreBreakdown: {
                            retrievalEmbeddingScore: combined,
                            retrievalAuthorClusterScore: signals.authorScore,
                            retrievalCandidateClusterScore: signals.clusterScore,
                            retrievalKeywordScore: signals.keywordScore,
                            retrievalDenseVectorScore: signals.denseVectorScore,
                            retrievalTopicCoverageScore: signals.topicCoverageScore,
                            retrievalAuthorTopicProxyScore: signals.authorTopicProxyScore,
                            retrievalCandidateTopicCompleteness: signals.candidateTopicCompleteness,
                            retrievalEngagementPrior: engagement,
                            retrievalSnapshotQuality: snapshot?.qualityScore || 0,
                            retrievalPoolPopularEmbedding: 1,
                        },
                    } as FeedCandidate,
                    combined,
                };
            })
            .sort((left, right) => right.combined - left.combined)
            .slice(0, MAX_RESULTS)
            .map((item) => item.candidate);
    }

    private async findPopularPosts(
        query: FeedQuery,
        maxAgeDays: number,
        minEngagement: number,
    ): Promise<any[]> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAgeDays);
        const excludeAuthors = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: query.cursor
                ? { $gte: cutoff, $lt: query.cursor }
                : { $gte: cutoff },
            deletedAt: null,
            isNews: { $ne: true },
            _id: {
                $nin: normalizeObjectIds([...query.seenIds, ...query.servedIds]),
            },
        };

        if (minEngagement > 0) {
            mongoQuery.$expr = {
                $gte: [
                    this.engagementExpression(),
                    minEngagement,
                ],
            };
        }

        return Post.find(mongoQuery)
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(FETCH_POOL_SIZE)
            .lean();
    }

    private engagementExpression(): Record<string, unknown> {
        return {
            $add: [
                { $ifNull: ['$stats.likeCount', 0] },
                { $multiply: [{ $ifNull: ['$stats.commentCount', 0] }, 2] },
                { $multiply: [{ $ifNull: ['$stats.repostCount', 0] }, 3] },
            ],
        };
    }

    private async buildUserInterestKeywords(query: FeedQuery): Promise<Map<string, number>> {
        const weights = new Map<string, number>();
        const actions = query.userActionSequence || [];
        const postIds = actions
            .map((action) => action.targetPostId)
            .filter((id): id is NonNullable<typeof id> => Boolean(id))
            .slice(0, MAX_INTEREST_POSTS)
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
            .map((id) => new mongoose.Types.ObjectId(id as unknown as string));

        if (postIds.length === 0) return weights;

        const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
            .select('keywords')
            .lean();

        for (const post of posts) {
            for (const keyword of (post.keywords as string[]) || []) {
                weights.set(keyword, (weights.get(keyword) || 0) + 1);
            }
        }

        return weights;
    }

    private computeSimilarity(
        interest: Map<string, number>,
        candidateKeywords: string[],
    ): number {
        if (interest.size === 0 || candidateKeywords.length === 0) return 0;

        let score = 0;
        let norm = 0;
        for (const value of interest.values()) {
            norm += value;
        }
        for (const keyword of candidateKeywords) {
            if (interest.has(keyword)) {
                score += interest.get(keyword) || 0;
            }
        }
        return score / Math.max(norm, 1);
    }
}

function normalizeObjectIds(values: string[]): mongoose.Types.ObjectId[] {
    return values
        .filter((value) => mongoose.Types.ObjectId.isValid(String(value)))
        .map((value) => new mongoose.Types.ObjectId(String(value)));
}

function normalizeEngagement(post: any): number {
    const stats = post.stats || {};
    const engagements =
        (stats.likeCount || 0) +
        (stats.commentCount || 0) * 2 +
        (stats.repostCount || 0) * 3;
    return Math.min(engagements / 100, 1);
}

function recencyPrior(createdAt: Date): number {
    const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (60 * 60 * 1000));
    if (ageHours <= 24) return 1;
    if (ageHours <= 72) return 0.75;
    if (ageHours <= 24 * 7) return 0.45;
    return 0.2;
}

function getPopularWeights(query: FeedQuery) {
    if (query.userStateContext?.state === 'sparse') {
        return {
            author: 0.18,
            cluster: 0.16,
            keyword: 0.08,
            dense: 0.2,
            engagement: 0.28,
            recency: 0.1,
            snapshotQuality: 0.1,
        };
    }

    return {
        author: 0.16,
        cluster: 0.14,
        keyword: 0.06,
        dense: 0.16,
        engagement: 0.38,
        recency: 0.1,
        snapshotQuality: 0.1,
    };
}
