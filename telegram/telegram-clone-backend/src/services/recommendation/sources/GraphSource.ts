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

        const authorCandidates = await this.graphKernelClient.authorCandidates({
            userId: query.userId,
            limit: this.config.maxTotal,
            maxDepth: 2,
            excludeUserIds: [
                query.userId,
                ...(query.userFeatures?.blockedUserIds ?? []),
            ],
        });

        if (authorCandidates.length === 0) {
            return [];
        }

        const authorIds = authorCandidates.map((candidate) => candidate.userId);
        const authorScoreMap = new Map(authorCandidates.map((candidate, index) => [
            candidate.userId,
            { ...candidate, rank: index },
        ]));

        const posts = await Post.aggregate([
            {
                $match: {
                    authorId: { $in: authorIds },
                    isNews: { $ne: true },
                    deletedAt: null,
                    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
            },
            { $sort: { createdAt: -1, engagementScore: -1, _id: -1 } },
            {
                $group: {
                    _id: '$authorId',
                    posts: { $push: '$$ROOT' },
                },
            },
            {
                $project: {
                    posts: { $slice: ['$posts', 2] },
                },
            },
            { $unwind: '$posts' },
            { $replaceRoot: { newRoot: '$posts' } },
        ]);

        const candidates: GraphKernelFeedCandidate[] = [];

        for (const post of posts as any[]) {
            const authorInfo = authorScoreMap.get(String(post.authorId));
            if (!authorInfo) {
                continue;
            }

            candidates.push({
                ...createFeedCandidate(post),
                inNetwork: false,
                recallSource: 'GraphKernelSource',
                graphScore: authorInfo.score,
                graphPath: `via_users:${authorInfo.viaUserIds.join('|')}`,
                graphRecallType: `cpp_graph_depth_${authorInfo.depth}`,
                score: authorInfo.score,
                _pipelineScore: authorInfo.score,
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
}
