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
    type GraphKernelClient,
} from '../../graphKernel/kernelClient';
import { materializeGraphAuthorPosts } from '../providers/graphKernel/authorPostMaterializer';
import { isSourceEnabledForQuery } from '../utils/sourceMixing';

type GraphKernelSourceKind =
    | 'social_neighbor'
    | 'recent_engager'
    | 'bridge_user'
    | 'co_engager'
    | 'content_affinity';

type GraphKernelAuthorAggregate = {
    userId: string;
    totalScore: number;
    dominantScore: number;
    dominantKind: GraphKernelSourceKind;
    sourceKinds: Set<GraphKernelSourceKind>;
    relationKinds: Set<string>;
    viaUserIds: Set<string>;
};

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
}

const DEFAULT_CONFIG: Required<Omit<GraphSourceConfig, 'client' | 'graphKernelClient'>> = {
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
    private config: Required<Omit<GraphSourceConfig, 'client' | 'graphKernelClient'>>;
    private client: GraphClient;
    private graphKernelClient: GraphKernelClient | null;

    constructor(config?: GraphSourceConfig) {
        this.config = {
            enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
            limitPerType: config?.limitPerType ?? DEFAULT_CONFIG.limitPerType,
            maxTotal: config?.maxTotal ?? DEFAULT_CONFIG.maxTotal,
            enabledTypes: config?.enabledTypes ?? DEFAULT_CONFIG.enabledTypes,
        };
        this.client = config?.client ?? getGraphClient();
        this.graphKernelClient = config?.graphKernelClient ?? getGraphKernelClient();
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

            // 从数据库获取帖子详情
            const postIds = graphCandidates.map(
                c => new mongoose.Types.ObjectId(c.postId)
            );

            const posts = await Post.find({
                _id: { $in: postIds },
                isNews: { $ne: true },
                deletedAt: null,
            }).lean();

            // 构建 postId -> graphCandidate 映射
            const graphScoreMap = new Map(
                graphCandidates.map(c => [c.postId, c])
            );

            // 转换为 FeedCandidate
            return posts.map((post: any) => {
                const graphInfo = graphScoreMap.get(post._id.toString());
                const candidate = createFeedCandidate(post);

                return {
                    ...candidate,
                    inNetwork: false, // Graph 召回的不算 inNetwork
                    graphScore: graphInfo?.score ?? 0,
                    graphPath: graphInfo?.path,
                    graphRecallType: graphInfo?.type,
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
        const directLimit = Math.max(12, Math.min(this.config.maxTotal, 48));
        const bridgeLimit = Math.max(this.config.maxTotal, 24);

        const [socialNeighbors, recentEngagers, bridgeUsers, coEngagers, contentAffinityNeighbors] = await Promise.all([
            this.runGraphKernelQuery('social-neighbors', () =>
                this.graphKernelClient!.socialNeighbors({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                })),
            this.runGraphKernelQuery('recent-engagers', () =>
                this.graphKernelClient!.recentEngagers({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                })),
            this.runGraphKernelQuery('bridge-users', () =>
                this.graphKernelClient!.bridgeUsers({
                    userId: query.userId,
                    limit: bridgeLimit,
                    maxDepth: 3,
                    excludeUserIds: excludedUserIds,
                })),
            this.runGraphKernelQuery('co-engagers', () =>
                this.graphKernelClient!.coEngagers({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                })),
            this.runGraphKernelQuery('content-affinity-neighbors', () =>
                this.graphKernelClient!.contentAffinityNeighbors({
                    userId: query.userId,
                    limit: directLimit,
                    excludeUserIds: excludedUserIds,
                })),
        ]);

        const authorAggregates = new Map<string, GraphKernelAuthorAggregate>();

        for (const candidate of socialNeighbors) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: Number(candidate.score ?? 0)
                    + Number(candidate.engagementScore ?? 0) * 0.25
                    + Number(candidate.recentnessScore ?? 0) * 0.05,
                sourceKind: 'social_neighbor',
                relationKinds: candidate.relationKinds ?? [],
            });
        }

        for (const candidate of recentEngagers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: Number(candidate.score ?? 0) * 0.2
                    + Number(candidate.engagementScore ?? 0) * 0.45
                    + Number(candidate.recentnessScore ?? 0) * 0.45,
                sourceKind: 'recent_engager',
                relationKinds: candidate.relationKinds ?? [],
            });
        }

        for (const candidate of bridgeUsers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: Number(candidate.bridgeStrength ?? candidate.score ?? 0),
                sourceKind: 'bridge_user',
                viaUserIds: candidate.viaUserIds ?? [],
            });
        }

        for (const candidate of coEngagers) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: Number(candidate.score ?? 0) * 0.65
                    + Number(candidate.engagementScore ?? 0) * 0.25
                    + Number(candidate.recentnessScore ?? 0) * 0.1,
                sourceKind: 'co_engager',
                relationKinds: candidate.relationKinds ?? [],
            });
        }

        for (const candidate of contentAffinityNeighbors) {
            this.upsertGraphKernelAuthor(authorAggregates, {
                userId: candidate.userId,
                score: Number(candidate.score ?? 0) * 0.55
                    + Number(candidate.engagementScore ?? 0) * 0.15
                    + Number(candidate.recentnessScore ?? 0) * 0.3,
                sourceKind: 'content_affinity',
                relationKinds: candidate.relationKinds ?? [],
            });
        }

        const rankedAuthors = Array.from(authorAggregates.values())
            .sort((left, right) => {
                if (Math.abs(right.totalScore - left.totalScore) > 1e-9) {
                    return right.totalScore - left.totalScore;
                }
                if (Math.abs(right.dominantScore - left.dominantScore) > 1e-9) {
                    return right.dominantScore - left.dominantScore;
                }
                return left.userId.localeCompare(right.userId);
            })
            .slice(0, Math.max(this.config.maxTotal, 32));

        if (rankedAuthors.length === 0) {
            return [];
        }

        const authorIds = rankedAuthors.map((candidate) => candidate.userId);
        const authorScoreMap = new Map(rankedAuthors.map((candidate, index) => [
            candidate.userId,
            { ...candidate, rank: index },
        ]));

        const posts = await materializeGraphAuthorPosts({
            authorIds,
            limitPerAuthor: 2,
            lookbackDays: 7,
        });

        const candidates: GraphKernelFeedCandidate[] = [];

        for (const post of posts as FeedCandidate[]) {
            const authorInfo = authorScoreMap.get(String(post.authorId));
            if (!authorInfo) {
                continue;
            }

            const sourceKinds = Array.from(authorInfo.sourceKinds);
            const relationKinds = Array.from(authorInfo.relationKinds).sort();
            const viaUserIds = Array.from(authorInfo.viaUserIds).sort();
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

            candidates.push({
                ...post,
                inNetwork: false,
                recallSource: 'GraphKernelSource',
                graphScore: authorInfo.totalScore,
                graphPath: graphPathParts.join(';'),
                graphRecallType,
                score: authorInfo.totalScore,
                _pipelineScore: authorInfo.totalScore,
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

        return candidates.slice(0, this.config.maxTotal);
    }

    private async runGraphKernelQuery<T>(
        label: string,
        callback: () => Promise<T[]>,
    ): Promise<T[]> {
        try {
            return await callback();
        } catch (error) {
            console.warn(`[GraphSource] ${label} query failed:`, error);
            return [];
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
        },
    ): void {
        const current = target.get(input.userId) ?? {
            userId: input.userId,
            totalScore: 0,
            dominantScore: Number.NEGATIVE_INFINITY,
            dominantKind: input.sourceKind,
            sourceKinds: new Set<GraphKernelSourceKind>(),
            relationKinds: new Set<string>(),
            viaUserIds: new Set<string>(),
        };

        current.totalScore += input.score;
        current.sourceKinds.add(input.sourceKind);
        for (const relationKind of input.relationKinds ?? []) {
            if (relationKind && relationKind.trim().length > 0) {
                current.relationKinds.add(relationKind.trim());
            }
        }
        for (const viaUserId of input.viaUserIds ?? []) {
            if (viaUserId && viaUserId.trim().length > 0) {
                current.viaUserIds.add(viaUserId.trim());
            }
        }

        if (input.score > current.dominantScore) {
            current.dominantScore = input.score;
            current.dominantKind = input.sourceKind;
        }

        target.set(input.userId, current);
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
