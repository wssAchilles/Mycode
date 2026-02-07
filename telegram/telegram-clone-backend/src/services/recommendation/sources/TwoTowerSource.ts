/**
 * TwoTowerSource - 占位两塔 + ANN 召回
 * 这里使用简单 embedding 相似度（基于关键词/标签）模拟 ANN，后续可替换为真实向量检索服务。
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import mongoose from 'mongoose';
import { AnnClient, HttpAnnClient } from '../clients/ANNClient';

const MAX_RESULTS = 80;
const CANDIDATE_POOL = 400;
const MAX_HISTORY_POSTS = 200;

export class TwoTowerSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'TwoTowerSource';
    private annClient?: AnnClient;

    constructor(annClient?: AnnClient) {
        if (annClient) {
            this.annClient = annClient;
        } else if (process.env.ANN_ENDPOINT) {
            this.annClient = new HttpAnnClient({ 
                endpoint: process.env.ANN_ENDPOINT, 
                timeoutMs: 3000 
            });
        }
    }

    enable(query: FeedQuery): boolean {
        return !query.inNetworkOnly;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        // 构造用户“兴趣向量”：最近行为涉及的帖子关键词
        const postIds = (query.userActionSequence || [])
            .map((a) => a.targetPostId)
            .filter(Boolean)
            .slice(0, MAX_HISTORY_POSTS)
            .map((id) => new mongoose.Types.ObjectId(id as unknown as string));

        const historyKeywords: string[] = [];
        if (postIds.length > 0) {
            const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
                .select('keywords')
                .lean();
            historyKeywords.push(...posts.flatMap((p: any) => p.keywords || []));
        }

        // 召回候选池：从全站高互动/近期帖子中选取
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 注意：不要直接复用/修改 query.userFeatures.followedUserIds，避免污染后续组件逻辑
        const excludeAuthors = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];

        const pool = await Post.find({
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: sevenDaysAgo },
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

        // 优先调用 ANN 服务；失败则回退本地相似度
        if (this.annClient) {
            try {
                const annCandidates = await this.annClient.retrieve({
                    userId: query.userId,
                    keywords: historyKeywords,
                    historyPostIds: postIds.map((id) => id.toString()),
                    topK: MAX_RESULTS,
                });
                const ids = annCandidates.map((c) => new mongoose.Types.ObjectId(c.postId));
                const annPosts = await Post.find({ _id: { $in: ids }, isNews: { $ne: true }, deletedAt: null }).lean();
                const postMap = new Map(annPosts.map((p: any) => [p._id.toString(), p]));
                return annCandidates
                    .map((c) => postMap.get(c.postId))
                    .filter(Boolean)
                    .map((p) => ({
                        ...createFeedCandidate(p as unknown as Parameters<typeof createFeedCandidate>[0]),
                        inNetwork: false,
                    }));
            } catch (err) {
                console.error('[TwoTowerSource] ANN retrieve failed, fallback local:', err);
            }
        }

        // 回退：本地相似度
        const userVec = buildEmbedding(historyKeywords);
        return pool
            .map((p: any) => {
                const vec = buildEmbedding((p.keywords as string[]) || []);
                const sim = userVec.size > 0 ? cosine(userVec, vec) : 0;
                const engagement = this.engagementScore(p);
                const score = sim * 0.7 + engagement * 0.3;
                return { p, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map((item) => ({
                ...createFeedCandidate(item.p as unknown as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: false,
            }));
    }

    private engagementScore(post: any): number {
        const stats = post.stats || {};
        const engagements =
            (stats.likeCount || 0) +
            (stats.commentCount || 0) * 2 +
            (stats.repostCount || 0) * 3;
        return Math.min(engagements / 100, 1);
    }
}

// 简单的 embedding 构造：对关键词计数并 L2 归一化
function buildEmbedding(keywords: string[]): Map<string, number> {
    const vec = new Map<string, number>();
    for (const kw of keywords) {
        vec.set(kw, (vec.get(kw) || 0) + 1);
    }
    const norm = Math.sqrt(
        Array.from(vec.values()).reduce((s, v) => s + v * v, 0) || 1
    );
    for (const [k, v] of vec) {
        vec.set(k, v / norm);
    }
    return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
    let sum = 0;
    for (const [k, v] of a) {
        const bv = b.get(k);
        if (bv) sum += v * bv;
    }
    return sum;
}
