/**
 * GraphSource - 图召回源
 * 基于用户关系图的召回策略
 * 支持: 二度关注、相似用户、话题兴趣、互动链
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import mongoose from 'mongoose';
import {
    GraphClient,
    GraphRecallRequest,
    GraphRecallType,
    getGraphClient,
} from '../clients/GraphClient';
import {
    getGraphKernelClient,
    parseGraphKernelBatchMode,
    type GraphKernelBatchMode,
    type GraphKernelClient,
} from '../../graphKernel/kernelClient';
import type {
    GraphKernelBatchQueryDiagnostics,
    GraphKernelBatchQueryResult,
    GraphKernelBatchResponse,
    GraphKernelCandidateResponse,
    GraphKernelDiagnostics,
} from '../../graphKernel/contracts';
import {
    materializeGraphAuthorPostsWithDiagnostics,
    type GraphAuthorPostMaterializerDiagnostics,
} from '../providers/graphKernel/authorPostMaterializer';
import { isSourceEnabledForQuery } from '../utils/sourceMixing';
import {
    buildNormalizedAuthorSignalMap,
    clamp01,
    computeAuthorSuggestionPrior,
} from '../signals/authorSemantics';

type GraphKernelSourceKind =
    | 'social_neighbor'
    | 'recent_engager'
    | 'bridge_user'
    | 'co_engager'
    | 'content_affinity';

type GraphKernelAuthorAggregate = {
    userId: string;
    totalScore: number;
    rankingScore: number;
    dominantScore: number;
    dominantKind: GraphKernelSourceKind;
    sourceKinds: Set<GraphKernelSourceKind>;
    relationKinds: Set<string>;
    viaUserIds: Set<string>;
    viewerSignal: number;
    multiSignalBonus: number;
    pathConfidence: number;
    pathFreshness: number;
    componentScores: Partial<Record<GraphKernelSourceKind, number>>;
};

type GraphKernelQueryTrace = {
    label: string;
    returnedCount: number;
    diagnostics?: GraphKernelDiagnostics;
    error?: string;
};

type GraphKernelBatchShadowObservation = Record<string, unknown> & {
    mode: 'shadow_compare';
    status: 'scheduled' | 'completed' | 'failed' | 'dropped';
};

const DEFAULT_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT = 2;
let graphKernelBatchShadowInFlight = 0;

function parseGraphKernelBatchShadowMaxInFlight(value: unknown): number {
    const normalized = typeof value === 'string' ? value.trim() : value;
    const parsed = normalized === undefined || normalized === null || normalized === ''
        ? Number.NaN
        : Number(normalized);
    return Number.isSafeInteger(parsed) && parsed >= 0
        ? parsed
        : DEFAULT_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT;
}

function tryAcquireGraphKernelBatchShadow(maxInFlight: number): (() => void) | undefined {
    if (graphKernelBatchShadowInFlight >= maxInFlight) {
        return undefined;
    }
    graphKernelBatchShadowInFlight += 1;
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        graphKernelBatchShadowInFlight = Math.max(0, graphKernelBatchShadowInFlight - 1);
    };
}

/**
 * GraphSource 配置
 */
export interface GraphSourceConfig {
    /** 是否启用 */
    enabled?: boolean;
    /** 每种召回类型的最大数量 */
    limitPerType?: number;
    /** 总最大召回数量 */
    maxTotal?: number;
    /** 启用的召回类型 */
    enabledTypes?: GraphRecallType[];
    /** 自定义 GraphClient */
    client?: GraphClient;
    /** C++ graph kernel 客户端 */
    graphKernelClient?: GraphKernelClient | null;
    /** C++ batch 仅用于 shadow compare，不能服务候选 */
    graphKernelBatchMode?: GraphKernelBatchMode;
    /** batch shadow compare 的进程内并发上限 */
    graphKernelBatchShadowMaxInFlight?: number;
}

const DEFAULT_CONFIG: Required<Omit<
    GraphSourceConfig,
    'client' | 'graphKernelClient' | 'graphKernelBatchMode' | 'graphKernelBatchShadowMaxInFlight'
>> = {
    enabled: true,
    limitPerType: 30,
    maxTotal: 100,
    enabledTypes: [
        'friend_of_friend',
        'similar_user',
        'topic_interest',
    ],
};

export class GraphSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'GraphSource';
    private config: Required<Omit<
        GraphSourceConfig,
        'client' | 'graphKernelClient' | 'graphKernelBatchMode' | 'graphKernelBatchShadowMaxInFlight'
    >>;
    private client: GraphClient;
    private graphKernelClient: GraphKernelClient | null;
    private graphKernelBatchMode: GraphKernelBatchMode;
    private graphKernelBatchShadowMaxInFlight: number;
    private stageDetails = new Map<string, Record<string, unknown>>();

    constructor(config?: GraphSourceConfig) {
        this.config = {
            enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
            limitPerType: config?.limitPerType ?? DEFAULT_CONFIG.limitPerType,
            maxTotal: config?.maxTotal ?? DEFAULT_CONFIG.maxTotal,
            enabledTypes: config?.enabledTypes ?? DEFAULT_CONFIG.enabledTypes,
        };
        this.client = config?.client ?? getGraphClient();
        this.graphKernelClient = config?.graphKernelClient ?? getGraphKernelClient();
        this.graphKernelBatchMode = config?.graphKernelBatchMode
            ?? parseGraphKernelBatchMode(process.env.CPP_GRAPH_KERNEL_BATCH_MODE);
        this.graphKernelBatchShadowMaxInFlight = this.graphKernelBatchMode === 'shadow_compare'
            ? parseGraphKernelBatchShadowMaxInFlight(
                config?.graphKernelBatchShadowMaxInFlight
                ?? process.env.CPP_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT,
            )
            : 0;
    }

    /**
     * 是否启用此 Source
     */
    enable(query: FeedQuery): boolean {
        // 仅在非纯 inNetwork 模式下启用
        if (query.inNetworkOnly) {
            return false;
        }
        if (!isSourceEnabledForQuery(query, this.name)) {
            return false;
        }

        // 检查实验配置
        if (query.experimentContext) {
            const enabled = query.experimentContext.getConfig(
                'graph_recall_experiment',
                'enableGraphSource',
                this.config.enabled
            );
            return enabled;
        }

        return this.config.enabled;
    }

    stageDetail(query: FeedQuery): Record<string, unknown> | undefined {
        const key = this.stageDetailKey(query);
        const detail = this.stageDetails.get(key);
        this.stageDetails.delete(key);
        return detail;
    }

    /**
     * 获取候选集
     */
    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        try {
            if (this.graphKernelClient) {
                try {
                    const kernelCandidates = await this.getCandidatesFromGraphKernel(query);
                    if (kernelCandidates.length > 0) {
                        return kernelCandidates;
                    }
                } catch (kernelError) {
                    console.warn('[GraphSource] graph kernel unavailable, falling back to legacy graph client:', kernelError);
                    this.recordStageDetail(query, {
                        graphKernelSource: true,
                        graphKernelFallback: true,
                        graphKernelFallbackReason: kernelError instanceof Error ? kernelError.message : String(kernelError),
                    });
                }
            }

            // 从实验配置获取参数
            let enabledTypes = this.config.enabledTypes;
            let limitPerType = this.config.limitPerType;
            let maxTotal = this.config.maxTotal;

            if (query.experimentContext) {
                enabledTypes = query.experimentContext.getConfig(
                    'graph_recall_experiment',
                    'graphRecallTypes',
                    enabledTypes
                );
                limitPerType = query.experimentContext.getConfig(
                    'graph_recall_experiment',
                    'graphLimitPerType',
                    limitPerType
                );
            }

            // 构建请求
            const request: GraphRecallRequest = {
                userId: query.userId,
                types: enabledTypes,
                limitPerType,
                maxTotal,
                excludeAuthorIds: [
                    query.userId,
                    ...(query.userFeatures?.blockedUserIds ?? []),
                ],
            };

            // 调用 GraphClient
            const graphCandidates = await this.client.recall(request);

            if (graphCandidates.length === 0) {
                return [];
            }

            const graphCandidatesByPostId = new Map<string, (typeof graphCandidates)[number]>();
            for (const candidate of graphCandidates) {
                if (!mongoose.isValidObjectId(candidate.postId)) {
                    continue;
                }

                const postId = new mongoose.Types.ObjectId(candidate.postId).toString();
                const existing = graphCandidatesByPostId.get(postId);
                if (!existing || candidate.score > existing.score) {
                    graphCandidatesByPostId.set(postId, candidate);
                }
            }
            if (graphCandidatesByPostId.size === 0) {
                return [];
            }

            // 从数据库获取帖子详情，并保留 Graph 召回顺序；重复帖子取最高分元数据。
            const postIds = Array.from(graphCandidatesByPostId.keys()).map(
                (postId) => new mongoose.Types.ObjectId(postId)
            );

            const posts = await Post.find({
                _id: { $in: postIds },
                isNews: { $ne: true },
                deletedAt: null,
            }).lean();

            const postMap = new Map(
                posts.map((post: any) => [post._id.toString(), post])
            );
            const orderedPosts = Array.from(graphCandidatesByPostId.keys())
                .map((postId) => postMap.get(postId))
                .filter((post): post is any => Boolean(post));
            const graphScoreMap = graphCandidatesByPostId;

            // 转换为 FeedCandidate
            return orderedPosts.map((post: any) => {
                const graphInfo = graphScoreMap.get(post._id.toString());
                const candidate = createFeedCandidate(post);

                return {
                    ...candidate,
                    inNetwork: false, // Graph 召回的不算 inNetwork
                    recallSource: this.name,
                    retrievalLane: 'social_expansion',
                    graphScore: graphInfo?.score ?? 0,
                    graphPath: graphInfo?.path,
                    graphRecallType: graphInfo?.type,
                    _scoreBreakdown: {
                        ...(candidate._scoreBreakdown || {}),
                        retrievalGraphScore: graphInfo?.score ?? 0,
                        retrievalGraphPathConfidence: graphInfo?.score ? 0.45 : 0,
                        retrievalGraphPathFreshness: 0,
                        authorSuggestionPrior: computeAuthorSuggestionPrior({
                            graphProximity: graphInfo?.score ?? 0,
                            recentPosts: 1,
                            engagementScore:
                                (candidate.likeCount || 0)
                                + (candidate.commentCount || 0) * 2
                                + (candidate.repostCount || 0) * 3,
                            sourceCount: 1,
                        }),
                    },
                } as FeedCandidate & {
                    graphScore: number;
                    graphPath?: string;
                    graphRecallType?: string;
                };
            });
        } catch (error) {
            console.error('[GraphSource] getCandidates failed:', error);
            return [];
        }
    }

    private async getCandidatesFromGraphKernel(query: FeedQuery): Promise<FeedCandidate[]> {
        if (!this.graphKernelClient) {
            return [];
        }

        type GraphKernelFeedCandidate = FeedCandidate & {
            graphScore: number;
            graphPath: string;
            graphRecallType: string;
            score: number;
            _pipelineScore: number;
            _graphKernelRank: number;
        };

        const excludedUserIds = [
            query.userId,
            ...(query.userFeatures?.blockedUserIds ?? []),
        ];
        const { directLimit, bridgeLimit } = this.graphKernelRequestLimits(query);
        const sourceWeights = this.graphKernelSourceWeights(query);
        const queryTraces: GraphKernelQueryTrace[] = [];
        const viewerAuthorSignals = buildNormalizedAuthorSignalMap(
            (query.userActionSequence || []).map((action) => ({
                action: String(action.action || ''),
                targetAuthorId: action.targetAuthorId,
                dwellTimeMs: action.dwellTimeMs,
                timestamp: action.timestamp,
            })),
            { applyRecency: true },
        );
        let batchShadowObservation: GraphKernelBatchShadowObservation | undefined;

        const [socialNeighbors, recentEngagers, bridgeUsers, coEngagers, contentAffinityNeighbors] = await Promise.all([
            this.runGraphKernelQuery('social-neighbors', () =>
                this.graphKernelClient!.socialNeighborsWithDiagnostics({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                }), queryTraces),
            this.runGraphKernelQuery('recent-engagers', () =>
                this.graphKernelClient!.recentEngagersWithDiagnostics({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                }), queryTraces),
            this.runGraphKernelQuery('bridge-users', () =>
                this.graphKernelClient!.bridgeUsersWithDiagnostics({
                    userId: query.userId,
                    limit: bridgeLimit,
                    maxDepth: 3,
                    excludeUserIds: excludedUserIds,
                }), queryTraces),
            this.runGraphKernelQuery('co-engagers', () =>
                this.graphKernelClient!.coEngagersWithDiagnostics({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                }), queryTraces),
            this.runGraphKernelQuery('content-affinity-neighbors', () =>
                this.graphKernelClient!.contentAffinityNeighborsWithDiagnostics({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                }), queryTraces),
        ]);
        if (this.graphKernelBatchMode === 'shadow_compare') {
            batchShadowObservation = { mode: 'shadow_compare', status: 'scheduled' };
            const release = tryAcquireGraphKernelBatchShadow(
                this.graphKernelBatchShadowMaxInFlight,
            );
            if (!release) {
                batchShadowObservation = {
                    mode: 'shadow_compare',
                    status: 'dropped',
                    reason: 'max_in_flight',
                    inFlight: graphKernelBatchShadowInFlight,
                    maxInFlight: this.graphKernelBatchShadowMaxInFlight,
                };
                console.info('[GraphSource] graph kernel batch shadow observation', {
                    requestId: query.requestId,
                    ...batchShadowObservation,
                });
            } else {
                void (async () => {
                    let finalObservation: GraphKernelBatchShadowObservation;
                    try {
                        const response = await this.graphKernelClient!.batch({
                            userId: query.userId,
                            directLimit,
                            bridgeLimit,
                            maxDepth: 3,
                            excludeUserIds: excludedUserIds,
                        });
                        finalObservation = this.buildGraphKernelBatchShadowCompare(
                            queryTraces,
                            { response },
                        );
                    } catch (error) {
                        finalObservation = this.buildGraphKernelBatchShadowCompare(
                            queryTraces,
                            {
                                error: error instanceof Error ? error.message : String(error),
                            },
                        );
                    } finally {
                        release();
                    }
                    console.info('[GraphSource] graph kernel batch shadow observation', {
                        requestId: query.requestId,
                        ...finalObservation,
                    });
                })();
            }
        }

        const authorAggregates = new Map<string, GraphKernelAuthorAggregate>();

        for (const candidate of socialNeighbors) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: (typeof candidate.score === 'number' ? candidate.score : Number.NaN)
                    + Number(candidate.engagementScore ?? 0) * 0.25
                    + Number(candidate.recentnessScore ?? 0) * 0.05,
                sourceKind: 'social_neighbor',
                relationKinds: candidate.relationKinds,
                weight: sourceWeights.social_neighbor,
                viewerSignal: viewerAuthorSignals.get(candidate.userId) || 0,
                freshnessScore: Number(candidate.recentnessScore ?? 0),
            });
        }

        for (const candidate of recentEngagers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: (typeof candidate.score === 'number' ? candidate.score : Number.NaN) * 0.2
                    + Number(candidate.engagementScore ?? 0) * 0.45
                    + Number(candidate.recentnessScore ?? 0) * 0.45,
                sourceKind: 'recent_engager',
                relationKinds: candidate.relationKinds,
                weight: sourceWeights.recent_engager,
                viewerSignal: viewerAuthorSignals.get(candidate.userId) || 0,
                freshnessScore: Number(candidate.recentnessScore ?? 0),
            });
        }

        for (const candidate of bridgeUsers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: typeof candidate.bridgeStrength === 'number'
                    ? candidate.bridgeStrength
                    : (typeof candidate.score === 'number' ? candidate.score : Number.NaN),
                sourceKind: 'bridge_user',
                viaUserIds: candidate.viaUserIds,
                weight: sourceWeights.bridge_user,
                viewerSignal: viewerAuthorSignals.get(candidate.userId) || 0,
                freshnessScore: 0.4,
            });
        }

        for (const candidate of coEngagers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: (typeof candidate.score === 'number' ? candidate.score : Number.NaN) * 0.65
                    + Number(candidate.engagementScore ?? 0) * 0.25
                    + Number(candidate.recentnessScore ?? 0) * 0.1,
                sourceKind: 'co_engager',
                relationKinds: candidate.relationKinds,
                weight: sourceWeights.co_engager,
                viewerSignal: viewerAuthorSignals.get(candidate.userId) || 0,
                freshnessScore: Number(candidate.recentnessScore ?? 0),
            });
        }

        for (const candidate of contentAffinityNeighbors) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: (typeof candidate.score === 'number' ? candidate.score : Number.NaN) * 0.55
                    + Number(candidate.engagementScore ?? 0) * 0.15
                    + Number(candidate.recentnessScore ?? 0) * 0.3,
                sourceKind: 'content_affinity',
                relationKinds: candidate.relationKinds,
                weight: sourceWeights.content_affinity,
                viewerSignal: viewerAuthorSignals.get(candidate.userId) || 0,
                freshnessScore: Number(candidate.recentnessScore ?? 0),
            });
        }

        const rankedAuthors = Array.from(authorAggregates.values())
            .sort((left, right) => {
                if (Math.abs(right.rankingScore - left.rankingScore) > 1e-9) {
                    return right.rankingScore - left.rankingScore;
                }
                if (Math.abs(right.dominantScore - left.dominantScore) > 1e-9) {
                    return right.dominantScore - left.dominantScore;
                }
                return left.userId.localeCompare(right.userId);
            })
            .slice(0, Math.max(this.config.maxTotal, 32));

        if (rankedAuthors.length === 0) {
            this.recordStageDetail(
                query,
                this.buildGraphKernelStageDetail(
                    queryTraces,
                    0,
                    undefined,
                    0,
                    batchShadowObservation,
                ),
            );
            return [];
        }

        const authorIds = rankedAuthors.map((candidate) => candidate.userId);
        const authorScoreMap = new Map(rankedAuthors.map((candidate, index) => [
            candidate.userId,
            { ...candidate, rank: index },
        ]));

        const materializedPosts = await materializeGraphAuthorPostsWithDiagnostics({
            authorIds,
            limitPerAuthor: 2,
            lookbackDays: 7,
            createdBefore: query.cursor,
        });
        const posts = materializedPosts.candidates;

        const candidates: GraphKernelFeedCandidate[] = [];

        for (const post of posts as FeedCandidate[]) {
            const authorInfo = authorScoreMap.get(String(post.authorId));
            if (!authorInfo) {
                continue;
            }

            const sourceKinds = Array.from(authorInfo.sourceKinds);
            const relationKinds = Array.from(authorInfo.relationKinds).sort();
            const viaUserIds = Array.from(authorInfo.viaUserIds).sort();
            const engagementScore =
                (post.likeCount || 0) + (post.commentCount || 0) * 2 + (post.repostCount || 0) * 3;
            const authorSuggestionPrior = computeAuthorSuggestionPrior({
                graphProximity: Math.max(authorInfo.pathConfidence, authorInfo.viewerSignal),
                embeddingAffinity: authorInfo.componentScores.content_affinity || 0,
                clusterProducerPrior: 0,
                recentPosts: 1,
                engagementScore,
                sourceCount: sourceKinds.length,
            });
            const graphRecallType = sourceKinds.length > 1
                ? 'cpp_graph_multi_signal'
                : this.mapGraphKernelSourceKindToRecallType(authorInfo.dominantKind);

            const graphPathParts = [
                `signals:${sourceKinds.map((kind) => this.mapGraphKernelSourceKindToRecallType(kind)).join('|')}`,
                `dominant:${this.mapGraphKernelSourceKindToRecallType(authorInfo.dominantKind)}`,
            ];
            if (relationKinds.length > 0) {
                graphPathParts.push(`relations:${relationKinds.join('|')}`);
            }
            if (viaUserIds.length > 0) {
                graphPathParts.push(`via_users:${viaUserIds.join('|')}`);
            }
            if (authorInfo.viewerSignal > 0) {
                graphPathParts.push(`viewer_signal:${authorInfo.viewerSignal.toFixed(2)}`);
            }
            if (authorInfo.multiSignalBonus > 0) {
                graphPathParts.push(`multi_signal_bonus:${authorInfo.multiSignalBonus.toFixed(2)}`);
            }
            if (authorInfo.pathConfidence > 0) {
                graphPathParts.push(`path_confidence:${authorInfo.pathConfidence.toFixed(2)}`);
            }
            if (authorInfo.pathFreshness > 0) {
                graphPathParts.push(`path_freshness:${authorInfo.pathFreshness.toFixed(2)}`);
            }

            candidates.push({
                ...post,
                inNetwork: false,
                recallSource: 'GraphKernelSource',
                retrievalLane: 'social_expansion',
                graphScore: authorInfo.rankingScore,
                graphPath: graphPathParts.join(';'),
                graphRecallType,
                score: authorInfo.rankingScore,
                _pipelineScore: authorInfo.rankingScore,
                _scoreBreakdown: {
                    ...(post._scoreBreakdown || {}),
                    retrievalGraphScore: authorInfo.rankingScore,
                    retrievalGraphAggregateScore: authorInfo.totalScore,
                    retrievalGraphViewerSignal: authorInfo.viewerSignal,
                    retrievalGraphMultiSignalBonus: authorInfo.multiSignalBonus,
                    retrievalGraphPathConfidence: authorInfo.pathConfidence,
                    retrievalGraphPathFreshness: authorInfo.pathFreshness,
                    authorSuggestionPrior,
                    retrievalGraphSocialNeighborScore: authorInfo.componentScores.social_neighbor || 0,
                    retrievalGraphRecentEngagerScore: authorInfo.componentScores.recent_engager || 0,
                    retrievalGraphBridgeScore: authorInfo.componentScores.bridge_user || 0,
                    retrievalGraphCoEngagerScore: authorInfo.componentScores.co_engager || 0,
                    retrievalGraphContentAffinityScore: authorInfo.componentScores.content_affinity || 0,
                },
                _graphKernelRank: authorInfo.rank ?? Number.MAX_SAFE_INTEGER,
            });
        }

        candidates.sort((left, right) => {
            const rankDelta = left._graphKernelRank - right._graphKernelRank;
            if (rankDelta !== 0) {
                return rankDelta;
            }
            return right.createdAt.getTime() - left.createdAt.getTime();
        });

        const selectedCandidates = candidates.slice(0, this.config.maxTotal);
        this.recordStageDetail(
            query,
            this.buildGraphKernelStageDetail(
                queryTraces,
                rankedAuthors.length,
                materializedPosts.diagnostics,
                selectedCandidates.length,
                batchShadowObservation,
            ),
        );

        return selectedCandidates;
    }

    private async runGraphKernelQuery<T>(
        label: string,
        callback: () => Promise<GraphKernelCandidateResponse<T>>,
        traces: GraphKernelQueryTrace[],
    ): Promise<T[]> {
        try {
            const response = await callback();
            traces.push({
                label,
                returnedCount: response.candidates.length,
                diagnostics: response.diagnostics,
            });
            return response.candidates;
        } catch (error) {
            console.warn(`[GraphSource] ${label} query failed:`, error);
            traces.push({
                label,
                returnedCount: 0,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    private buildGraphKernelStageDetail(
        queryTraces: GraphKernelQueryTrace[],
        rankedAuthorCount: number,
        materializerDiagnostics: GraphAuthorPostMaterializerDiagnostics | undefined,
        returnedCandidateCount: number,
        batchShadowCompare?: Record<string, unknown>,
    ): Record<string, unknown> {
        const diagnostics: Record<string, GraphKernelDiagnostics> = {};
        const errors: Record<string, string> = {};
        const returnedCounts: Record<string, number> = {};
        const snapshotVersions = new Set<string>();

        for (const trace of queryTraces) {
            returnedCounts[trace.label] = trace.returnedCount;
            if (trace.diagnostics) {
                diagnostics[trace.label] = trace.diagnostics;
                if (trace.diagnostics.snapshotVersion) {
                    snapshotVersions.add(trace.diagnostics.snapshotVersion);
                }
            }
            if (trace.error) {
                errors[trace.label] = trace.error;
            }
        }

        return {
            graphKernelSource: true,
            graphKernelQueryReturnedCounts: returnedCounts,
            graphKernelDiagnostics: diagnostics,
            graphKernelSnapshotVersions: Array.from(snapshotVersions).sort(),
            graphKernelQueryErrors: errors,
            graphKernelRankedAuthorCount: rankedAuthorCount,
            graphKernelReturnedCandidateCount: returnedCandidateCount,
            graphKernelMaterializerDiagnostics: materializerDiagnostics,
            graphKernelBatchShadowCompare: batchShadowCompare,
        };
    }

    private buildGraphKernelBatchShadowCompare(
        queryTraces: GraphKernelQueryTrace[],
        outcome: { response?: GraphKernelBatchResponse; error?: string },
    ): GraphKernelBatchShadowObservation {
        if (outcome.error || !outcome.response) {
            return {
                mode: 'shadow_compare',
                status: 'failed',
                error: outcome.error || 'batch shadow response missing',
            };
        }

        const response = outcome.response;
        const batchByLabel: Record<string, GraphKernelBatchQueryResult<unknown>> = {
            'social-neighbors': response.socialNeighbors,
            'recent-engagers': response.recentEngagers,
            'bridge-users': response.bridgeUsers,
            'co-engagers': response.coEngagers,
            'content-affinity-neighbors': response.contentAffinityNeighbors,
        };
        const traceByLabel = new Map(queryTraces.map((trace) => [trace.label, trace]));
        const legacySnapshotVersions = Array.from(new Set(
            queryTraces
                .map((trace) => trace.diagnostics?.snapshotVersion)
                .filter((value): value is string => Boolean(value)),
        )).sort();
        const countDrift: Record<string, number> = {};
        const diagnosticDrift: Record<string, string[]> = {};
        const diagnosticKeys: Array<keyof GraphKernelBatchQueryDiagnostics> = [
            'snapshotVersion',
            'snapshotLoadedAtMs',
            'candidateCount',
            'requestedLimit',
            'availableCount',
            'truncatedCount',
            'scannedCount',
            'visitedCount',
            'budgetExhausted',
            'empty',
        ];

        for (const [label, batchResult] of Object.entries(batchByLabel)) {
            const legacy = traceByLabel.get(label);
            countDrift[label] = batchResult.candidates.length - (legacy?.returnedCount ?? 0);
            const drift = diagnosticKeys.filter(
                (key) => batchResult.diagnostics[key] !== legacy?.diagnostics?.[key],
            );
            if (drift.length > 0) {
                diagnosticDrift[label] = drift;
            }
        }

        return {
            mode: 'shadow_compare',
            status: 'completed',
            batchSnapshotVersion: response.snapshotVersion,
            batchSnapshotLoadedAtMs: response.snapshotLoadedAtMs,
            legacySnapshotVersions,
            versionDrift: legacySnapshotVersions.length !== 1
                || legacySnapshotVersions[0] !== response.snapshotVersion,
            countDrift,
            diagnosticDrift,
        };
    }

    private recordStageDetail(query: FeedQuery, detail: Record<string, unknown>): void {
        this.stageDetails.set(this.stageDetailKey(query), detail);
    }

    private stageDetailKey(query: FeedQuery): string {
        return query.requestId;
    }

    private graphKernelRequestLimits(
        query: FeedQuery,
    ): { directLimit: number; bridgeLimit: number } {
        const state = query.userStateContext?.state;
        switch (state) {
            case 'sparse':
                return {
                    directLimit: Math.max(14, Math.min(this.config.maxTotal, 36)),
                    bridgeLimit: Math.max(this.config.maxTotal, 28),
                };
            case 'heavy':
                return {
                    directLimit: Math.max(18, Math.min(this.config.maxTotal, 56)),
                    bridgeLimit: Math.max(this.config.maxTotal + 12, 42),
                };
            default:
                return {
                    directLimit: Math.max(12, Math.min(this.config.maxTotal, 48)),
                    bridgeLimit: Math.max(this.config.maxTotal, 24),
                };
        }
    }

    private graphKernelSourceWeights(
        query: FeedQuery,
    ): Record<GraphKernelSourceKind, number> {
        switch (query.userStateContext?.state) {
            case 'sparse':
                return {
                    social_neighbor: 0.9,
                    recent_engager: 1.0,
                    bridge_user: 1.08,
                    co_engager: 0.96,
                    content_affinity: 1.02,
                };
            case 'heavy':
                return {
                    social_neighbor: 1.02,
                    recent_engager: 0.92,
                    bridge_user: 1.04,
                    co_engager: 1.0,
                    content_affinity: 0.98,
                };
            default:
                return {
                    social_neighbor: 1.0,
                    recent_engager: 0.96,
                    bridge_user: 1.05,
                    co_engager: 0.98,
                    content_affinity: 1.0,
                };
        }
    }

    private upsertGraphKernelAuthor(
        target: Map<string, GraphKernelAuthorAggregate>,
        input: {
            userId: string;
            score: number;
            sourceKind: GraphKernelSourceKind;
            relationKinds?: string[];
            viaUserIds?: string[];
            weight?: number;
            viewerSignal?: number;
            freshnessScore?: number;
        },
    ): void {
        if (
            typeof input.userId !== 'string'
            || input.userId.trim().length === 0
            || !Number.isFinite(input.score)
            || input.score < 0
            || (input.weight !== undefined && !Number.isFinite(input.weight))
            || (input.viewerSignal !== undefined && !Number.isFinite(input.viewerSignal))
            || (input.freshnessScore !== undefined && !Number.isFinite(input.freshnessScore))
            || (input.relationKinds !== undefined && !Array.isArray(input.relationKinds))
            || (input.viaUserIds !== undefined && !Array.isArray(input.viaUserIds))
        ) {
            return;
        }
        const weightedScore = Math.max(0, input.score) * Math.max(0.5, input.weight || 1);
        const viewerSignal = clamp01(input.viewerSignal || 0);
        const freshnessScore = clamp01(input.freshnessScore || 0);
        const effectiveScore = weightedScore * (1 + viewerSignal * 0.22);
        if (!Number.isFinite(weightedScore) || !Number.isFinite(effectiveScore)) {
            return;
        }
        const current = target.get(input.userId) ?? {
            userId: input.userId,
            totalScore: 0,
            rankingScore: 0,
            dominantScore: Number.NEGATIVE_INFINITY,
            dominantKind: input.sourceKind,
            sourceKinds: new Set<GraphKernelSourceKind>(),
            relationKinds: new Set<string>(),
            viaUserIds: new Set<string>(),
            viewerSignal: 0,
            multiSignalBonus: 0,
            pathConfidence: 0,
            pathFreshness: 0,
            componentScores: {},
        };

        const nextTotalScore = current.totalScore + effectiveScore;
        const nextComponentScore =
            (current.componentScores[input.sourceKind] || 0) + effectiveScore;
        if (!Number.isFinite(nextTotalScore) || !Number.isFinite(nextComponentScore)) {
            target.delete(input.userId);
            return;
        }
        current.totalScore = nextTotalScore;
        current.sourceKinds.add(input.sourceKind);
        current.viewerSignal = Math.max(current.viewerSignal, viewerSignal);
        current.pathFreshness = Math.max(current.pathFreshness, freshnessScore);
        current.componentScores[input.sourceKind] = nextComponentScore;
        for (const relationKind of input.relationKinds ?? []) {
            if (typeof relationKind === 'string' && relationKind.trim().length > 0) {
                current.relationKinds.add(relationKind.trim());
            }
        }
        for (const viaUserId of input.viaUserIds ?? []) {
            if (typeof viaUserId === 'string' && viaUserId.trim().length > 0) {
                current.viaUserIds.add(viaUserId.trim());
            }
        }

        if (effectiveScore > current.dominantScore) {
            current.dominantScore = effectiveScore;
            current.dominantKind = input.sourceKind;
        }
        current.multiSignalBonus = Math.min(
            0.18,
            Math.max(0, current.sourceKinds.size - 1) * 0.08,
        );
        current.pathConfidence = this.computeGraphPathConfidence(current);
        current.rankingScore = current.totalScore
            + current.multiSignalBonus
            + current.pathConfidence * 0.06
            + current.pathFreshness * 0.04;

        target.set(input.userId, current);
    }

    private computeGraphPathConfidence(author: GraphKernelAuthorAggregate): number {
        const multiSignal = Math.min(1, Math.max(0, author.sourceKinds.size - 1) / 3);
        const relationEvidence = author.relationKinds.size > 0 ? 0.18 : 0;
        const bridgeEvidence = author.viaUserIds.size > 0 ? 0.18 : 0;
        const viewerEvidence = author.viewerSignal * 0.22;
        const freshnessEvidence = author.pathFreshness * 0.14;
        return clamp01(0.28 + multiSignal * 0.28 + relationEvidence + bridgeEvidence + viewerEvidence + freshnessEvidence);
    }

    private mapGraphKernelSourceKindToRecallType(sourceKind: GraphKernelSourceKind): string {
        switch (sourceKind) {
            case 'social_neighbor':
                return 'cpp_graph_social_neighbor';
            case 'recent_engager':
                return 'cpp_graph_recent_engager';
            case 'bridge_user':
                return 'cpp_graph_bridge_user';
            case 'co_engager':
                return 'cpp_graph_co_engager';
            case 'content_affinity':
                return 'cpp_graph_content_affinity';
            default:
                return 'cpp_graph_unknown';
        }
    }
}
