import { Op } from 'sequelize';

import Contact, { ContactStatus } from '../../../models/Contact';
import Post from '../../../models/Post';
import User from '../../../models/User';
import UserAction, { ActionType } from '../../../models/UserAction';
import UserSettings from '../../../models/UserSettings';
import ClusterDefinition from '../../../models/ClusterDefinition';
import { FeatureStore } from '../featureStore';
import { getGraphKernelClient } from '../../graphKernel/kernelClient';
import type { GraphKernelBridgeCandidate } from '../../graphKernel/contracts';
import {
    computeAuthorEmbeddingOverlap,
    type AuthorEmbeddingSnapshot,
    type PreparedEmbeddingRetrievalContext,
} from '../utils/embeddingRetrieval';
import {
    buildExcludedAuthorIds,
    deriveViewerSuggestionProfile,
    upsertAuthorSuggestionCandidate,
} from './candidatePools';
import { rankAuthorSuggestionCandidates } from './scoring';
import type {
    AuthorSuggestionCandidate,
    RecommendedAuthorSuggestion,
    ViewerAuthorSignal,
} from './types';

const CONFIG = {
    recentActivityWindowMs: 7 * 24 * 60 * 60 * 1000,
    recentActionWindowMs: 30 * 24 * 60 * 60 * 1000,
    poolMultiplier: 6,
    minimumPoolSize: 16,
    maxClusterCount: 8,
    maxProducerClusterCount: 8,
    maxProducersPerCluster: 12,
};

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function normalizeSparseEntries(
    entries: Array<{ clusterId: number; score: number }> | undefined,
    limit: number,
): Array<{ clusterId: number; score: number }> {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    return entries
        .filter(
            (entry) =>
                typeof entry?.clusterId === 'number' &&
                Number.isFinite(entry.clusterId) &&
                typeof entry?.score === 'number' &&
                Number.isFinite(entry.score) &&
                entry.score > 0,
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((entry) => ({ clusterId: entry.clusterId, score: entry.score }));
}

function authorActionWeight(action: ActionType, dwellTimeMs?: number): number {
    if (action === ActionType.LIKE) return 3;
    if (action === ActionType.REPLY) return 3.2;
    if (action === ActionType.REPOST || action === ActionType.QUOTE) return 2.8;
    if (action === ActionType.PROFILE_CLICK) return 2.1;
    if (action === ActionType.CLICK) return 1.4;
    if (action === ActionType.DWELL) return 1 + Math.min((dwellTimeMs || 0) / 10_000, 1);
    return 0;
}

interface ViewerSuggestionContext {
    followedUserIds: Set<string>;
    blockedUserIds: Set<string>;
    mutedUserIds: Set<string>;
    recentPositiveActionCount: number;
    recentAuthorSignals: Map<string, number>;
    embeddingContext: PreparedEmbeddingRetrievalContext | null;
}

export class AuthorSuggestionService {
    private readonly graphKernelClient = getGraphKernelClient();

    async getRecommendedUsers(
        userId: string,
        limit: number = 4,
    ): Promise<RecommendedAuthorSuggestion[]> {
        const safeLimit = Math.max(1, Math.min(12, limit));
        const poolSize = Math.max(CONFIG.minimumPoolSize, safeLimit * CONFIG.poolMultiplier);
        const viewerContext = await this.loadViewerContext(userId);
        const excludedIds = buildExcludedAuthorIds(
            userId,
            viewerContext.followedUserIds,
            viewerContext.blockedUserIds,
            viewerContext.mutedUserIds,
        );
        const viewerProfile = deriveViewerSuggestionProfile(
            viewerContext.followedUserIds.size,
            viewerContext.recentPositiveActionCount,
            viewerContext.embeddingContext !== null,
        );
        const candidates = new Map<string, AuthorSuggestionCandidate>();

        const [activePool, embeddingPool, graphPool] = await Promise.all([
            this.loadActiveAuthors(excludedIds, poolSize),
            this.loadEmbeddingAffineAuthors(userId, excludedIds, poolSize),
            this.loadGraphBridgeAuthors(userId, excludedIds, poolSize, viewerContext.recentAuthorSignals),
        ]);

        for (const candidate of activePool) {
            upsertAuthorSuggestionCandidate(candidates, candidate.userId, 'active', {
                sourceScore: candidate.sourceScore,
                recentPosts: candidate.recentPosts,
                engagementScore: candidate.engagementScore,
            });
        }

        for (const candidate of embeddingPool) {
            upsertAuthorSuggestionCandidate(candidates, candidate.userId, 'embedding', {
                sourceScore: candidate.sourceScore,
                embeddingAffinity: candidate.sourceScore,
            });
        }

        for (const candidate of graphPool) {
            upsertAuthorSuggestionCandidate(candidates, candidate.authorId, 'graph', {
                sourceScore: candidate.score,
                graphProximity: candidate.score,
            });
        }

        if (candidates.size < safeLimit) {
            const fallbackUsers = await this.loadFallbackUsers(excludedIds, poolSize);
            for (const fallbackUser of fallbackUsers) {
                upsertAuthorSuggestionCandidate(candidates, fallbackUser.userId, 'fallback', {
                    sourceScore: fallbackUser.sourceScore,
                });
            }
        }

        const candidateIds = Array.from(candidates.keys());
        if (candidateIds.length === 0) {
            return [];
        }

        const [userMap, activityStats, authorEmbeddingData, clusterProducerPriorMap] = await Promise.all([
            this.loadUserMap(candidateIds),
            this.loadAuthorActivityStats(candidateIds),
            this.loadAuthorEmbeddingData(candidateIds),
            this.loadClusterProducerPriorMap(viewerContext.embeddingContext, candidateIds),
        ]);

        const scoredCandidates = rankAuthorSuggestionCandidates(
            candidateIds
                .map((candidateId) => {
                    const candidate = candidates.get(candidateId);
                    if (!candidate) return null;
                    const user = userMap.get(candidateId);
                    if (!user) return null;

                    const activity = activityStats.get(candidateId);
                    if (activity) {
                        candidate.recentPosts = Math.max(candidate.recentPosts, activity.recentPosts);
                        candidate.engagementScore = Math.max(
                            candidate.engagementScore,
                            activity.engagementScore,
                        );
                    }

                    const authorEmbedding = authorEmbeddingData.snapshots.get(candidateId);
                    if (viewerContext.embeddingContext && authorEmbedding) {
                        candidate.embeddingAffinity = Math.max(
                            candidate.embeddingAffinity,
                            computeAuthorEmbeddingOverlap(
                                viewerContext.embeddingContext,
                                authorEmbedding,
                            ),
                        );
                    }

                    candidate.clusterProducerPrior = Math.max(
                        candidate.clusterProducerPrior,
                        clusterProducerPriorMap.get(candidateId) || 0,
                    );
                    candidate.qualityScore = Math.max(
                        candidate.qualityScore,
                        authorEmbeddingData.qualityScores.get(candidateId) || 0,
                    );

                    const hasAuthorRepresentation =
                        candidate.recentPosts > 0 ||
                        Boolean(authorEmbedding?.producerEmbedding.length) ||
                        typeof authorEmbedding?.knownForCluster === 'number';
                    if (!hasAuthorRepresentation && !candidate.sources.includes('fallback')) {
                        return null;
                    }

                    return candidate;
                })
                .filter((candidate): candidate is AuthorSuggestionCandidate => candidate !== null),
            viewerProfile,
            safeLimit,
        );

        const recommendedUsers = scoredCandidates
            .map((candidate): RecommendedAuthorSuggestion | null => {
                const user = userMap.get(candidate.userId);
                if (!user) return null;
                return {
                    id: candidate.userId,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    isOnline: user.isOnline,
                    reason: candidate.reason,
                    isFollowed: false,
                    recentPosts: candidate.recentPosts,
                    engagementScore: candidate.engagementScore,
                };
            })
            .filter((candidate): candidate is RecommendedAuthorSuggestion => candidate !== null);

        return recommendedUsers;
    }

    private async loadViewerContext(userId: string): Promise<ViewerSuggestionContext> {
        const since = new Date(Date.now() - CONFIG.recentActionWindowMs);
        const [followedContacts, blockedContacts, mutedUserIds, viewerEmbedding, recentActions] =
            await Promise.all([
                Contact.findAll({
                    where: { userId, status: ContactStatus.ACCEPTED },
                    attributes: ['contactId'],
                }),
                Contact.findAll({
                    where: { userId, status: ContactStatus.BLOCKED },
                    attributes: ['contactId'],
                }),
                UserSettings.getMutedUserIds(userId),
                FeatureStore.getUserEmbedding(userId),
                UserAction.find({
                    userId,
                    timestamp: { $gte: since },
                    targetAuthorId: { $exists: true, $ne: userId },
                    action: {
                        $in: [
                            ActionType.LIKE,
                            ActionType.REPLY,
                            ActionType.REPOST,
                            ActionType.QUOTE,
                            ActionType.CLICK,
                            ActionType.PROFILE_CLICK,
                            ActionType.DWELL,
                        ],
                    },
                })
                    .sort({ timestamp: -1 })
                    .limit(160)
                    .select('action targetAuthorId dwellTimeMs timestamp')
                    .lean(),
            ]);

        return {
            followedUserIds: new Set(
                followedContacts.map((contact: { contactId: string }) => contact.contactId),
            ),
            blockedUserIds: new Set(
                blockedContacts.map((contact: { contactId: string }) => contact.contactId),
            ),
            mutedUserIds: new Set(mutedUserIds || []),
            recentPositiveActionCount: recentActions.length,
            recentAuthorSignals: this.buildRecentAuthorSignalMap(recentActions),
            embeddingContext: this.buildEmbeddingContext(viewerEmbedding),
        };
    }

    private buildEmbeddingContext(
        viewerEmbedding: Awaited<ReturnType<typeof FeatureStore.getUserEmbedding>>,
    ): PreparedEmbeddingRetrievalContext | null {
        if (!viewerEmbedding) {
            return null;
        }

        const userClusters = normalizeSparseEntries(
            viewerEmbedding.interestedInClusters,
            CONFIG.maxClusterCount,
        );
        if (userClusters.length === 0) {
            return null;
        }

        const userClusterMap = new Map<number, number>();
        for (const cluster of userClusters) {
            userClusterMap.set(cluster.clusterId, cluster.score);
        }

        return {
            qualityScore: Number(viewerEmbedding.qualityScore || 0),
            userClusters,
            userClusterMap,
            keywordWeights: new Map(),
            denseUserEmbedding: [],
        };
    }

    private buildRecentAuthorSignalMap(
        actions: Array<{ action: ActionType; targetAuthorId?: string; dwellTimeMs?: number; timestamp: Date }>,
    ): Map<string, number> {
        const scores = new Map<string, number>();
        let maxScore = 0;

        for (const action of actions) {
            const authorId = String(action.targetAuthorId || '').trim();
            if (!authorId) continue;
            const ageDays = Math.max(
                0,
                (Date.now() - new Date(action.timestamp).getTime()) / (24 * 60 * 60 * 1000),
            );
            const recencyMultiplier = ageDays <= 7 ? 1 : ageDays <= 14 ? 0.82 : 0.65;
            const weight = authorActionWeight(action.action, action.dwellTimeMs) * recencyMultiplier;
            const nextScore = (scores.get(authorId) || 0) + weight;
            scores.set(authorId, nextScore);
            maxScore = Math.max(maxScore, nextScore);
        }

        if (maxScore <= 0) {
            return new Map();
        }

        for (const [authorId, score] of scores.entries()) {
            scores.set(authorId, clamp01(score / maxScore));
        }

        return scores;
    }

    private async loadActiveAuthors(
        excludedIds: Set<string>,
        limit: number,
    ): Promise<Array<{ userId: string; sourceScore: number; recentPosts: number; engagementScore: number }>> {
        const since = new Date(Date.now() - CONFIG.recentActivityWindowMs);
        const excluded = Array.from(excludedIds);
        const results = await Post.aggregate([
            {
                $match: {
                    deletedAt: null,
                    isNews: { $ne: true },
                    createdAt: { $gte: since },
                    ...(excluded.length > 0 ? { authorId: { $nin: excluded } } : {}),
                },
            },
            {
                $group: {
                    _id: '$authorId',
                    recentPosts: { $sum: 1 },
                    engagementScore: {
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
            { $sort: { engagementScore: -1, recentPosts: -1, _id: 1 } },
            { $limit: limit },
        ]);

        return (results as Array<{ _id: string; recentPosts: number; engagementScore: number }>).map(
            (entry) => ({
                userId: entry._id,
                recentPosts: entry.recentPosts,
                engagementScore: entry.engagementScore,
                sourceScore: clamp01(
                    Math.log1p(entry.recentPosts) / Math.log1p(8) * 0.45 +
                    Math.log1p(entry.engagementScore) / Math.log1p(180) * 0.55,
                ),
            }),
        );
    }

    private async loadEmbeddingAffineAuthors(
        userId: string,
        excludedIds: Set<string>,
        limit: number,
    ): Promise<Array<{ userId: string; sourceScore: number }>> {
        const similarUsers = await FeatureStore.findSimilarUsers(userId, limit);
        return similarUsers
            .filter((candidate) => !excludedIds.has(candidate.userId))
            .map((candidate) => ({
                userId: candidate.userId,
                sourceScore: clamp01(candidate.similarity),
            }));
    }

    private async loadGraphBridgeAuthors(
        userId: string,
        excludedIds: Set<string>,
        limit: number,
        recentAuthorSignals: Map<string, number>,
    ): Promise<ViewerAuthorSignal[]> {
        const graphSignals = new Map<string, number>();
        for (const [authorId, score] of recentAuthorSignals.entries()) {
            if (!excludedIds.has(authorId)) {
                graphSignals.set(authorId, score);
            }
        }

        const applySignal = (authorId: string, score: number, weight: number) => {
            if (!authorId || excludedIds.has(authorId)) {
                return;
            }
            const nextScore = Math.max(graphSignals.get(authorId) || 0, clamp01(score * weight));
            graphSignals.set(authorId, nextScore);
        };

        if (this.graphKernelClient) {
            const [bridgeResult, socialResult, affinityResult] = await Promise.allSettled([
                this.graphKernelClient.bridgeUsers({
                    userId,
                    limit,
                    excludeUserIds: Array.from(excludedIds),
                }),
                this.graphKernelClient.socialNeighbors({
                    userId,
                    limit,
                    excludeUserIds: Array.from(excludedIds),
                }),
                this.graphKernelClient.contentAffinityNeighbors({
                    userId,
                    limit,
                    excludeUserIds: Array.from(excludedIds),
                }),
            ]);

            if (bridgeResult.status === 'fulfilled') {
                for (const candidate of bridgeResult.value) {
                    this.applyBridgeSignal(candidate, applySignal);
                }
            }
            if (socialResult.status === 'fulfilled') {
                for (const candidate of socialResult.value) {
                    applySignal(candidate.userId, candidate.score, 0.9);
                }
            }
            if (affinityResult.status === 'fulfilled') {
                for (const candidate of affinityResult.value) {
                    applySignal(
                        candidate.userId,
                        Math.max(candidate.score, candidate.engagementScore || 0),
                        0.88,
                    );
                }
            }
        }

        return Array.from(graphSignals.entries())
            .map(([authorId, score]) => ({ authorId, score }))
            .sort((left, right) => right.score - left.score)
            .slice(0, limit);
    }

    private applyBridgeSignal(
        candidate: GraphKernelBridgeCandidate,
        applySignal: (authorId: string, score: number, weight: number) => void,
    ): void {
        const viaMultiplier = candidate.viaUserCount && candidate.viaUserCount > 0
            ? Math.min(1.1, 0.9 + candidate.viaUserCount * 0.04)
            : 1;
        applySignal(
            candidate.userId,
            Math.max(candidate.score, candidate.bridgeStrength || 0),
            viaMultiplier,
        );
    }

    private async loadFallbackUsers(
        excludedIds: Set<string>,
        limit: number,
    ): Promise<Array<{ userId: string; sourceScore: number }>> {
        const users = await User.findAll({
            where: {
                id: {
                    [Op.notIn]: Array.from(excludedIds),
                },
            },
            attributes: ['id', 'createdAt'],
            order: [['createdAt', 'DESC']],
            limit,
        });

        return users.map((user, index) => ({
            userId: user.id,
            sourceScore: clamp01(1 - index / Math.max(users.length, 1)),
        }));
    }

    private async loadUserMap(
        userIds: string[],
    ): Promise<Map<string, { id: string; username: string; avatarUrl?: string | null; isOnline?: boolean | null }>> {
        if (userIds.length === 0) {
            return new Map();
        }

        const users = await User.findAll({
            where: { id: userIds },
            attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
        });

        return new Map(
            users.map((user) => [
                user.id,
                {
                    id: user.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    isOnline: user.isOnline,
                },
            ]),
        );
    }

    private async loadAuthorActivityStats(
        authorIds: string[],
    ): Promise<Map<string, { recentPosts: number; engagementScore: number }>> {
        if (authorIds.length === 0) {
            return new Map();
        }

        const since = new Date(Date.now() - CONFIG.recentActivityWindowMs);
        const results = await Post.aggregate([
            {
                $match: {
                    deletedAt: null,
                    isNews: { $ne: true },
                    authorId: { $in: authorIds },
                    createdAt: { $gte: since },
                },
            },
            {
                $group: {
                    _id: '$authorId',
                    recentPosts: { $sum: 1 },
                    engagementScore: {
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

        return new Map(
            (results as Array<{ _id: string; recentPosts: number; engagementScore: number }>).map(
                (entry) => [
                    entry._id,
                    {
                        recentPosts: entry.recentPosts,
                        engagementScore: entry.engagementScore,
                    },
                ],
            ),
        );
    }

    private async loadAuthorEmbeddingData(authorIds: string[]): Promise<{
        snapshots: Map<string, AuthorEmbeddingSnapshot>;
        qualityScores: Map<string, number>;
    }> {
        if (authorIds.length === 0) {
            return {
                snapshots: new Map(),
                qualityScores: new Map(),
            };
        }

        const embeddings = await FeatureStore.getUserEmbeddingsBatch(authorIds);
        const snapshots = new Map<string, AuthorEmbeddingSnapshot>();
        const qualityScores = new Map<string, number>();

        for (const [authorId, embedding] of embeddings.entries()) {
            snapshots.set(authorId, {
                interestedInClusters: normalizeSparseEntries(
                    embedding.interestedInClusters,
                    CONFIG.maxProducerClusterCount,
                ),
                producerEmbedding: normalizeSparseEntries(
                    embedding.producerEmbedding,
                    CONFIG.maxProducerClusterCount,
                ),
                knownForCluster: embedding.knownForCluster,
            });
            qualityScores.set(authorId, Number(embedding.qualityScore || 0));
        }

        return { snapshots, qualityScores };
    }

    private async loadClusterProducerPriorMap(
        embeddingContext: PreparedEmbeddingRetrievalContext | null,
        candidateIds: string[],
    ): Promise<Map<string, number>> {
        if (!embeddingContext || candidateIds.length === 0) {
            return new Map();
        }

        const candidateIdSet = new Set(candidateIds);
        const topClusters = embeddingContext.userClusters.slice(0, CONFIG.maxClusterCount);
        if (topClusters.length === 0) {
            return new Map();
        }

        const clusters = await ClusterDefinition.find({
            clusterId: { $in: topClusters.map((cluster) => cluster.clusterId) },
            isActive: true,
        })
            .select('clusterId topProducers')
            .lean();

        const viewerWeightMap = new Map<number, number>(
            topClusters.map((cluster) => [cluster.clusterId, cluster.score]),
        );
        const priorMap = new Map<string, number>();

        for (const cluster of clusters as Array<{ clusterId: number; topProducers?: Array<{ userId: string; score: number }> }>) {
            const viewerWeight = viewerWeightMap.get(cluster.clusterId) || 0;
            for (const producer of (cluster.topProducers || []).slice(0, CONFIG.maxProducersPerCluster)) {
                if (!candidateIdSet.has(producer.userId)) {
                    continue;
                }
                const producerPrior = clamp01(viewerWeight * producer.score);
                priorMap.set(
                    producer.userId,
                    Math.max(priorMap.get(producer.userId) || 0, producerPrior),
                );
            }
        }

        return priorMap;
    }
}
