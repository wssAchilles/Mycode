/**
 * TwoTowerSource - 社交 OON embedding 召回
 * 第一阶段接入 embeddingContext 后，这里继续推进到“内容池召回”：
 * - 优先从 post_feature_snapshots 的 cluster pool 中取候选
 * - 再做 embedding/author/keyword 多信号排序
 * - 最后才回退到 ANN / 热门关键词近似
 */

import mongoose from 'mongoose';

import Post from '../../../models/Post';
import { postFeatureSnapshotService, type PostFeaturePoolEntry } from '../contentFeatures';
import { Source } from '../framework';
import { AnnClient, HttpAnnClient } from '../clients/ANNClient';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import { FeedQuery, SparseEmbeddingEntry } from '../types/FeedQuery';
import {
    computeEmbeddingRecallSignals,
    computeEmbeddingRecallSignalsFromSnapshot,
    getEmbeddingInterestPoolPlan,
    getEmbeddingInterestWeights,
    getEmbeddingRetrievalHealth,
    hasUsableEmbeddingContext,
    loadAuthorEmbeddingSnapshots,
    prepareEmbeddingRetrievalContext,
    type EmbeddingRecallPoolKind,
} from '../utils/embeddingRetrieval';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';
import { isSourceEnabledForQuery } from '../utils/sourceMixing';

const MAX_RESULTS = 80;
const CANDIDATE_POOL = 240;
const MAX_HISTORY_POSTS = 200;

type TwoTowerPoolEntry = {
    post: any;
    snapshot?: PostFeaturePoolEntry['snapshot'];
};

type TwoTowerPool = {
    entries: TwoTowerPoolEntry[];
    poolKind: EmbeddingRecallPoolKind;
    priorityScore: number;
};

export class TwoTowerSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'TwoTowerSource';
    private annClient?: AnnClient;

    constructor(annClient?: AnnClient) {
        if (annClient) {
            this.annClient = annClient;
        } else if (process.env.ANN_ENDPOINT) {
            this.annClient = new HttpAnnClient({
                endpoint: process.env.ANN_ENDPOINT,
                timeoutMs: 3000,
            });
        }
    }

    enable(query: FeedQuery): boolean {
        return !query.inNetworkOnly
            && isSourceEnabledForQuery(query, this.name)
            && getSpaceFeedExperimentFlag(query, 'enable_two_tower_source', false);
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const pools = await this.loadCandidatePools(query);
        if (pools.length === 0) {
            return [];
        }

        if (
            getSpaceFeedExperimentFlag(query, 'enable_embedding_retrieval', true) &&
            hasUsableEmbeddingContext(query)
        ) {
            const embeddingCandidates = await this.getEmbeddingCandidates(query, pools);
            if (embeddingCandidates.length > 0) {
                return embeddingCandidates;
            }
        }

        const annCandidates = await this.getAnnCandidates(query);
        if (annCandidates.length > 0) {
            return annCandidates;
        }

        return this.getKeywordFallbackCandidates(flattenCandidatePools(pools));
    }

    private async loadCandidatePools(query: FeedQuery): Promise<TwoTowerPool[]> {
        const embeddingHealth = getEmbeddingRetrievalHealth(query);
        const poolPlan = getEmbeddingInterestPoolPlan(
            embeddingHealth,
            query.userStateContext?.state,
        );
        const pools: TwoTowerPool[] = [];

        for (const poolKind of poolPlan) {
            if (poolKind === 'dense_pool') {
                const densePool = await this.loadDenseCandidatePool(query);
                if (densePool.length > 0) {
                    pools.push({
                        entries: densePool,
                        poolKind,
                        priorityScore: poolPriorityScore(poolKind, embeddingHealth),
                    });
                }
                continue;
            }
            if (poolKind === 'cluster_pool') {
                const clusterPool = await this.loadClusterCandidatePool(query);
                if (clusterPool.length > 0) {
                    pools.push({
                        entries: clusterPool,
                        poolKind,
                        priorityScore: poolPriorityScore(poolKind, embeddingHealth),
                    });
                }
                continue;
            }

            const posts = await this.loadLegacyCandidatePool(query);
            if (posts.length === 0) {
                continue;
            }
            const snapshots = hasUsableEmbeddingContext(query)
                ? await postFeatureSnapshotService.ensureSnapshotsForPosts(posts)
                : new Map();
            pools.push({
                entries: posts.map((post) => ({
                    post,
                    snapshot: snapshots.get(post._id.toString()),
                })),
                poolKind,
                priorityScore: poolPriorityScore(poolKind, embeddingHealth),
            });
        }

        return pools;
    }

    private async loadClusterCandidatePool(query: FeedQuery): Promise<TwoTowerPoolEntry[]> {
        const clusterEntries = selectClusterEntries(query);
        if (clusterEntries.length === 0) {
            return [];
        }

        const excludeAuthorIds = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];
        const excludePostIds = normalizeObjectIds([...query.seenIds, ...query.servedIds]);
        const createdAfter = getCreatedAfter(query);

        const pool = await postFeatureSnapshotService.getClusterCandidatePool({
            clusterEntries,
            limit: CANDIDATE_POOL,
            createdAfter,
            excludePostIds,
            excludeAuthorIds,
            newsOnly: false,
            seedRecentLimit: CANDIDATE_POOL,
        });

        return pool.map((entry) => ({
            post: entry.post,
            snapshot: entry.snapshot,
        }));
    }

    private async loadDenseCandidatePool(query: FeedQuery): Promise<TwoTowerPoolEntry[]> {
        const excludeAuthorIds = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];
        const excludePostIds = normalizeObjectIds([...query.seenIds, ...query.servedIds]);
        const createdAfter = getCreatedAfter(query);

        const pool = await postFeatureSnapshotService.getDenseVectorCandidatePool({
            limit: CANDIDATE_POOL,
            createdAfter,
            excludePostIds,
            excludeAuthorIds,
            newsOnly: false,
            seedRecentLimit: CANDIDATE_POOL,
        });

        return pool.map((entry) => ({
            post: entry.post,
            snapshot: entry.snapshot,
        }));
    }

    private async loadLegacyCandidatePool(query: FeedQuery): Promise<any[]> {
        const createdAfter = getCreatedAfter(query);
        const excludeAuthors = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];

        return Post.find({
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: createdAfter },
            deletedAt: null,
            isNews: { $ne: true },
            $expr: {
                $gte: [
                    {
                        $add: [
                            '$stats.likeCount',
                            { $multiply: ['$stats.commentCount', 2] },
                            { $multiply: ['$stats.repostCount', 3] },
                        ],
                    },
                    3,
                ],
            },
        })
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(CANDIDATE_POOL)
            .lean();
    }

    private async getEmbeddingCandidates(
        query: FeedQuery,
        pools: TwoTowerPool[],
    ): Promise<FeedCandidate[]> {
        const context = await prepareEmbeddingRetrievalContext(query);
        if (!context) {
            return [];
        }

        const health = getEmbeddingRetrievalHealth(query);
        const poolEntries = flattenCandidatePools(pools);
        if (poolEntries.length === 0) {
            return [];
        }
        const authorEmbeddings = await loadAuthorEmbeddingSnapshots(
            poolEntries.map((entry) => entry.entry.post.authorId),
        );
        const weights = getEmbeddingInterestWeights(health, query.userStateContext?.state);

        const ranked = poolEntries
            .map(({ entry: { post, snapshot }, poolKind, priorityScore }) => {
                const candidate = createFeedCandidate(post as Parameters<typeof createFeedCandidate>[0]);
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
                const score =
                    signals.authorScore * weights.author +
                    signals.clusterScore * weights.cluster +
                    signals.keywordScore * weights.keyword +
                    signals.denseVectorScore * weights.dense +
                    signals.topicCoverageScore * 0.05 +
                    signals.authorTopicProxyScore * 0.035 +
                    signals.candidateTopicCompleteness * 0.025 +
                    engagement * weights.engagement +
                    recency * weights.recency +
                    (snapshot?.qualityScore || 0) * weights.snapshotQuality +
                    priorityScore * weights.poolPriority;

                return {
                    candidate: {
                        ...candidate,
                        inNetwork: false,
                        recallSource: this.name,
                        retrievalLane: 'interest',
                        _scoreBreakdown: {
                            retrievalEmbeddingScore: score,
                            retrievalAuthorClusterScore: signals.authorScore,
                            retrievalCandidateClusterScore: signals.clusterScore,
                            retrievalKeywordScore: signals.keywordScore,
                            retrievalDenseVectorScore: signals.denseVectorScore,
                            retrievalTopicCoverageScore: signals.topicCoverageScore,
                            retrievalAuthorTopicProxyScore: signals.authorTopicProxyScore,
                            retrievalCandidateTopicCompleteness: signals.candidateTopicCompleteness,
                            retrievalEngagementPrior: engagement,
                            retrievalSnapshotQuality: snapshot?.qualityScore || 0,
                            retrievalPoolPriority: priorityScore,
                            retrievalPoolDense: poolKind === 'dense_pool' ? 1 : 0,
                            retrievalPoolCluster: poolKind === 'cluster_pool' ? 1 : 0,
                            retrievalPoolLegacy: poolKind === 'legacy_pool' ? 1 : 0,
                        },
                    } as FeedCandidate,
                    score,
                };
            })
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, MAX_RESULTS);

        return ranked.map((item) => item.candidate);
    }

    private async getAnnCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        if (!this.annClient) {
            return [];
        }

        const postIds = (query.userActionSequence || [])
            .map((action) => action.targetPostId)
            .filter(Boolean)
            .slice(0, MAX_HISTORY_POSTS)
            .map((id) => new mongoose.Types.ObjectId(id as unknown as string));

        const historyKeywords: string[] = [];
        if (postIds.length > 0) {
            const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
                .select('keywords')
                .lean();
            historyKeywords.push(...posts.flatMap((post: any) => post.keywords || []));
        }

        try {
            const annCandidates = await this.annClient.retrieve({
                userId: query.userId,
                keywords: historyKeywords,
                historyPostIds: postIds.map((id) => id.toString()),
                topK: MAX_RESULTS,
            });

            const valid = annCandidates.filter((candidate) => /^[0-9a-fA-F]{24}$/.test(String(candidate.postId)));
            if (valid.length === 0) {
                throw new Error('ANN returned non-ObjectId ids; likely wrong corpus configured');
            }

            const ids = valid.map((candidate) => new mongoose.Types.ObjectId(candidate.postId));
            const annPosts = await Post.find({
                _id: { $in: ids },
                isNews: { $ne: true },
                deletedAt: null,
            }).lean();
            const postMap = new Map(annPosts.map((post: any) => [post._id.toString(), post]));

            return valid
                .map((candidate, index) => ({
                    annCandidate: candidate,
                    annRank: index + 1,
                    post: postMap.get(candidate.postId),
                }))
                .filter((item) => Boolean(item.post))
                .map(({ annCandidate, annRank, post }) => ({
                    ...createFeedCandidate(post as Parameters<typeof createFeedCandidate>[0]),
                    inNetwork: false,
                    recallSource: this.name,
                    retrievalLane: 'interest',
                    _scoreBreakdown: {
                        annRetrievalScore: annCandidate.score || 0,
                        annRetrievalRank: annRank,
                        annRetrievalTopK: MAX_RESULTS,
                    },
                }));
        } catch (error) {
            console.error('[TwoTowerSource] ANN retrieve failed, fallback local:', error);
            return [];
        }
    }

    private getKeywordFallbackCandidates(
        pools: Array<{ entry: TwoTowerPoolEntry; poolKind: EmbeddingRecallPoolKind; priorityScore: number }>,
    ): FeedCandidate[] {
        const keywordUniverse = pools.flatMap(({ entry }) => entry.post.keywords || []);
        const userVec = buildEmbedding(keywordUniverse.slice(0, 40));

        return pools
            .map(({ entry: { post }, poolKind, priorityScore }) => {
                const vec = buildEmbedding((post.keywords as string[]) || []);
                const similarity = userVec.size > 0 ? cosine(userVec, vec) : 0;
                const engagement = normalizeEngagement(post);
                const score = similarity * 0.68 + engagement * 0.24 + priorityScore * 0.08;
                return { post, score, similarity, engagement, poolKind, priorityScore };
            })
            .sort((left, right) => right.score - left.score)
            .slice(0, MAX_RESULTS)
            .map((item) => ({
                ...createFeedCandidate(item.post as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: false,
                recallSource: this.name,
                retrievalLane: 'interest',
                _scoreBreakdown: {
                    retrievalEmbeddingScore: item.score,
                    retrievalKeywordScore: item.similarity,
                    retrievalEngagementPrior: item.engagement,
                    retrievalPoolPriority: item.priorityScore,
                    retrievalPoolDense: item.poolKind === 'dense_pool' ? 1 : 0,
                    retrievalPoolCluster: item.poolKind === 'cluster_pool' ? 1 : 0,
                    retrievalPoolLegacy: item.poolKind === 'legacy_pool' ? 1 : 0,
                },
            }));
    }
}

function selectClusterEntries(query: FeedQuery): SparseEmbeddingEntry[] {
    const maxClusters = query.userStateContext?.state === 'heavy' ? 10 : 8;
    return (query.embeddingContext?.interestedInClusters || [])
        .filter((entry) => Number.isFinite(entry.clusterId) && Number.isFinite(entry.score))
        .sort((left, right) => right.score - left.score)
        .slice(0, maxClusters);
}

function getCreatedAfter(query: FeedQuery): Date {
    const days = query.userStateContext?.state === 'sparse' ? 21 : 14;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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
    if (ageHours <= 72) return 0.7;
    if (ageHours <= 24 * 7) return 0.4;
    return 0.15;
}

function buildEmbedding(keywords: string[]): Map<string, number> {
    const vec = new Map<string, number>();
    for (const keyword of keywords) {
        vec.set(keyword, (vec.get(keyword) || 0) + 1);
    }
    const norm = Math.sqrt(
        Array.from(vec.values()).reduce((sum, value) => sum + value * value, 0) || 1,
    );
    for (const [keyword, value] of vec) {
        vec.set(keyword, value / norm);
    }
    return vec;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
    let sum = 0;
    for (const [keyword, value] of left) {
        const other = right.get(keyword);
        if (other) {
            sum += value * other;
        }
    }
    return sum;
}

function flattenCandidatePools(pools: TwoTowerPool[]) {
    const seen = new Set<string>();
    const flattened: Array<{
        entry: TwoTowerPoolEntry;
        poolKind: EmbeddingRecallPoolKind;
        priorityScore: number;
    }> = [];

    for (const pool of pools) {
        for (const entry of pool.entries) {
            const key = entry.post?._id?.toString?.() || `${pool.poolKind}:${entry.post.authorId}:${entry.post.createdAt}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            flattened.push({
                entry,
                poolKind: pool.poolKind,
                priorityScore: pool.priorityScore,
            });
        }
    }

    return flattened;
}

function poolPriorityScore(
    poolKind: EmbeddingRecallPoolKind,
    health: ReturnType<typeof getEmbeddingRetrievalHealth>,
): number {
    switch (poolKind) {
        case 'dense_pool':
            return health === 'strong' ? 1 : 0.76;
        case 'cluster_pool':
            return health === 'weak' ? 1 : 0.9;
        case 'legacy_pool':
        default:
            return health === 'missing' ? 1 : 0.72;
    }
}
