/**
 * TwoTowerSource - 社交 OON embedding 召回
 * 第一阶段接入 embeddingContext 后，这里继续推进到“内容池召回”：
 * - 优先从 post_feature_snapshots 的 cluster pool 中取候选
 * - 再做 embedding/author/keyword 多信号排序
 * - ANN 仅并行观察，serving 最后回退到热门关键词近似
 */

import mongoose from 'mongoose';

import Post from '../../../models/Post';
import { postFeatureSnapshotService, type PostFeaturePoolEntry } from '../contentFeatures';
import { Source } from '../framework';
import {
    AnnAttempt,
    AnnClient,
    AnnComparison,
    HttpAnnClient,
    buildAnnEvaluationKs,
    compareAnnAgainstExact,
    retrieveAnnWithinBudget,
} from '../clients/ANNClient';
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
import {
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
    isEmbeddingContractCompatible,
} from '../contracts/embeddingContract';

const MAX_RESULTS = 80;
const CANDIDATE_POOL = 240;
const MAX_HISTORY_POSTS = 200;
const TWO_TOWER_ANN_TIMEOUT_MS = 3000;

type TwoTowerPoolEntry = {
    post: any;
    snapshot?: PostFeaturePoolEntry['snapshot'];
};

type TwoTowerPool = {
    entries: TwoTowerPoolEntry[];
    poolKind: EmbeddingRecallPoolKind;
    priorityScore: number;
};

type AnnObservation = {
    mode: 'observe_only';
    reason?: 'client_not_configured' | 'request_contract_mismatch' | 'id_namespace_mismatch' | 'observation_failed';
    attempt?: AnnAttempt;
    validatedCount: number;
    hydratedCount: number;
    comparison: AnnComparison;
};

export class TwoTowerSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'TwoTowerSource';
    private annClient?: AnnClient;
    private readonly stageDetails = new Map<string, Record<string, unknown>>();

    constructor(annClient?: AnnClient) {
        if (annClient) {
            this.annClient = annClient;
        } else if (process.env.ANN_ENDPOINT) {
            this.annClient = new HttpAnnClient({
                endpoint: process.env.ANN_ENDPOINT,
                timeoutMs: TWO_TOWER_ANN_TIMEOUT_MS,
            });
        }
    }

    enable(query: FeedQuery): boolean {
        return !query.inNetworkOnly
            && isSourceEnabledForQuery(query, this.name)
            && getSpaceFeedExperimentFlag(query, 'enable_two_tower_source', false);
    }

    stageDetail(query: FeedQuery, _candidates?: FeedCandidate[]): Record<string, unknown> | undefined {
        const detail = this.stageDetails.get(query.requestId);
        this.stageDetails.delete(query.requestId);
        return detail;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const annObservationPromise = this.observeAnnWithinDeadline(query);
        const pools = await this.loadCandidatePools(query);
        let candidates: FeedCandidate[] = [];
        let servedPath: 'local_embedding' | 'keyword_fallback' | 'empty' = 'empty';

        if (
            pools.length > 0 &&
            getSpaceFeedExperimentFlag(query, 'enable_embedding_retrieval', true) &&
            hasUsableEmbeddingContext(query)
        ) {
            candidates = await this.getEmbeddingCandidates(query, pools);
            if (candidates.length > 0) {
                servedPath = 'local_embedding';
            }
        }

        if (candidates.length === 0 && pools.length > 0) {
            candidates = this.getKeywordFallbackCandidates(flattenCandidatePools(pools));
            if (candidates.length > 0) {
                servedPath = 'keyword_fallback';
            }
        }

        const annObservation = await annObservationPromise;
        this.stageDetails.set(query.requestId, { servedPath, annObservation });
        return candidates;
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
                        interestPoolKind: poolKind,
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
                            retrievalPoolAnn: 0,
                            retrievalPoolKeywordFallback: 0,
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

    private async observeAnnWithinDeadline(query: FeedQuery): Promise<AnnObservation> {
        const startedAt = Date.now();
        const budgetMs = Math.max(1, resolveAnnBudgetMs(query, TWO_TOWER_ANN_TIMEOUT_MS));
        const deadline = startedAt + budgetMs;
        let timer: NodeJS.Timeout | undefined;
        const observation = this.observeAnn(query, deadline, startedAt)
            .catch(() => (
                Date.now() >= deadline
                    ? timedOutAnnObservation(query, startedAt)
                    : failedAnnObservation(query)
            ));
        const timeout = new Promise<AnnObservation>((resolve) => {
            timer = setTimeout(
                () => resolve(timedOutAnnObservation(query, startedAt)),
                Math.max(0, deadline - Date.now()),
            );
        });

        try {
            return await Promise.race([observation, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async observeAnn(
        query: FeedQuery,
        deadline: number,
        startedAt: number,
    ): Promise<AnnObservation> {
        const evaluationKs = buildAnnEvaluationKs(query.limit);
        const comparison = compareAnnAgainstExact({ evaluationKs, annIds: [] });
        if (!this.annClient) {
            return {
                mode: 'observe_only',
                reason: 'client_not_configured',
                validatedCount: 0,
                hydratedCount: 0,
                comparison,
            };
        }
        if (!isEmbeddingContractCompatible(query.embeddingContext?.embeddingContract, DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)) {
            return {
                mode: 'observe_only',
                reason: 'request_contract_mismatch',
                validatedCount: 0,
                hydratedCount: 0,
                comparison,
            };
        }

        const postIds = (query.userActionSequence || [])
            .map((action) => action.targetPostId)
            .filter(Boolean)
            .slice(0, MAX_HISTORY_POSTS)
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
            .map((id) => new mongoose.Types.ObjectId(id as unknown as string));

        const historyKeywords: string[] = [];
        if (postIds.length > 0) {
            const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
                .select('keywords')
                .lean();
            historyKeywords.push(...posts.flatMap((post: any) => post.keywords || []));
        }

        const embeddingContract = query.embeddingContext?.embeddingContract;
        const requestedK = evaluationKs[evaluationKs.length - 1] || 200;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            return timedOutAnnObservation(query, startedAt);
        }
        const attempt = await retrieveAnnWithinBudget(
            this.annClient,
            {
                userId: query.userId,
                keywords: historyKeywords,
                historyPostIds: postIds.map((id) => id.toString()),
                topK: requestedK,
                embeddingContract,
                expectedEvidence: {
                    embeddingSpace: embeddingContract?.embeddingSpace,
                    retrievalEmbeddingDim: embeddingContract?.retrievalEmbeddingDim,
                    modelVersion: embeddingContract?.modelVersion,
                    artifactVersion: embeddingContract?.artifactVersion,
                    idNamespace: 'mongo_object_id',
                },
            },
            remainingMs,
        );
        if (Date.now() >= deadline) {
            return timedOutAnnObservation(query, startedAt);
        }
        const observedComparison = compareAnnAgainstExact({
            evaluationKs,
            annIds: attempt.candidates.map((candidate) => candidate.postId),
            annEvidence: attempt.responseEvidence,
        });
        if (attempt.outcome !== 'success') {
            return {
                mode: 'observe_only',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }
        if (attempt.responseEvidence?.idNamespace !== 'mongo_object_id') {
            return {
                mode: 'observe_only',
                reason: 'id_namespace_mismatch',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }

        const validIds = Array.from(new Set(
            attempt.candidates
                .map((candidate) => candidate.postId)
                .filter((postId) => /^[0-9a-fA-F]{24}$/.test(postId)),
        ));
        if (validIds.length === 0) {
            return {
                mode: 'observe_only',
                attempt,
                validatedCount: 0,
                hydratedCount: 0,
                comparison: observedComparison,
            };
        }
        const annPosts = await Post.find({
            _id: { $in: validIds.map((postId) => new mongoose.Types.ObjectId(postId)) },
            isNews: { $ne: true },
            deletedAt: null,
        }).lean();
        if (Date.now() >= deadline) {
            return timedOutAnnObservation(query, startedAt);
        }
        const hydratedIds = new Set(
            annPosts
                .map((post: any) => post?._id?.toString?.())
                .filter((postId: string | undefined) => postId && validIds.includes(postId)),
        );
        return {
            mode: 'observe_only',
            attempt,
            validatedCount: validIds.length,
            hydratedCount: hydratedIds.size,
            comparison: observedComparison,
        };
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
                interestPoolKind: 'keyword_fallback',
                _scoreBreakdown: {
                    retrievalEmbeddingScore: item.score,
                    retrievalKeywordScore: item.similarity,
                    retrievalEngagementPrior: item.engagement,
                    retrievalPoolPriority: item.priorityScore,
                    retrievalPoolDense: item.poolKind === 'dense_pool' ? 1 : 0,
                    retrievalPoolCluster: item.poolKind === 'cluster_pool' ? 1 : 0,
                    retrievalPoolLegacy: item.poolKind === 'legacy_pool' ? 1 : 0,
                    retrievalPoolAnn: 0,
                    retrievalPoolKeywordFallback: 1,
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

function resolveAnnBudgetMs(query: FeedQuery, fallbackMs: number): number {
    const policyBudget = Number(query.rankingPolicy?.sourceBatchTimeoutMs);
    return Number.isFinite(policyBudget) && policyBudget > 0
        ? Math.round(policyBudget)
        : fallbackMs;
}

function failedAnnObservation(query: FeedQuery): AnnObservation {
    const evaluationKs = buildAnnEvaluationKs(query.limit);
    return {
        mode: 'observe_only',
        reason: 'observation_failed',
        validatedCount: 0,
        hydratedCount: 0,
        comparison: compareAnnAgainstExact({ evaluationKs, annIds: [] }),
    };
}

function timedOutAnnObservation(query: FeedQuery, startedAt: number): AnnObservation {
    const evaluationKs = buildAnnEvaluationKs(query.limit);
    const requestedK = evaluationKs[evaluationKs.length - 1] || 200;
    return {
        mode: 'observe_only',
        attempt: {
            outcome: 'timeout',
            requestedK,
            returnedK: 0,
            latencyMs: Math.max(0, Date.now() - startedAt),
            candidates: [],
        },
        validatedCount: 0,
        hydratedCount: 0,
        comparison: compareAnnAgainstExact({ evaluationKs, annIds: [] }),
    };
}
