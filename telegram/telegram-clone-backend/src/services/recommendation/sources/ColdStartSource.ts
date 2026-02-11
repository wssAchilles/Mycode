/**
 * ColdStartSource - 冷启动内容源
 * 复刻 x-algorithm 的冷启动策略
 * 为没有关注任何人的新用户提供内容
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import { URL } from 'url';

/**
 * 配置参数
 */
const CONFIG = {
    MAX_RESULTS: 50,           // 最大返回数量
    // 新闻语料默认不要求互动阈值（初始导入时 engagement 可能为 0）
    MAX_AGE_DAYS: 14,          // 时间窗口 (比普通源更宽)
    DIVERSITY_LIMIT: 3,        // 每个供给单元最多返回几条（新闻用 domain/cluster/source）
};

export class ColdStartSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'ColdStartSource';

    enable(query: FeedQuery): boolean {
        // 只在用户没有关注任何人时启用
        // 这是冷启动场景
        const followedCount = query.userFeatures?.followedUserIds?.length || 0;
        return followedCount === 0;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        // 计算时间窗口 (给新用户展示更长时间范围的优质内容)
        const maxAgeCutoff = new Date();
        maxAgeCutoff.setDate(maxAgeCutoff.getDate() - CONFIG.MAX_AGE_DAYS);

        // 排除用户自己的帖子（对新闻 authorId=NewsBot 不影响）
        const excludeAuthors = [query.userId];

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: maxAgeCutoff },
            deletedAt: null,
            // 冷启动默认走全局新闻语料（更接近“global corpus”思想）
            isNews: true,
            'newsMetadata.externalId': { $exists: true, $ne: null },
        };

        // 分页支持
        if (query.cursor) {
            mongoQuery.createdAt = {
                $gte: maxAgeCutoff,
                $lt: query.cursor,
            };
        }

        // 获取新闻内容，按时间排序（互动信号可用时再引入）
        const posts = await Post.find(mongoQuery)
            .sort({ createdAt: -1 })
            .limit(CONFIG.MAX_RESULTS * 2) // 多取一些用于多样性过滤
            .lean();

        // 应用供给单元多样性限制（新闻按 domain/cluster/source）
        const diversifiedPosts = this.applySupplierDiversity(posts);

        // 转换为候选者
        return diversifiedPosts.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,  // 冷启动内容都是网络外
        }));
    }

    /**
     * 应用作者多样性限制
     * 避免冷启动 Feed 被少数活跃用户主导
     */
    private supplierKey(post: any): string {
        if (post?.isNews) {
            const meta = post?.newsMetadata || {};
            const url = meta.sourceUrl || meta.url || '';
            if (typeof url === 'string' && url) {
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                        return `news:domain:${parsed.hostname}`;
                    }
                } catch {
                    // ignore
                }
            }
            if (meta.clusterId !== undefined && meta.clusterId !== null) {
                return `news:cluster:${String(meta.clusterId)}`;
            }
            if (meta.source) {
                return `news:source:${String(meta.source)}`;
            }
            if (meta.externalId) {
                return `news:external:${String(meta.externalId)}`;
            }
            return `news:author:${String(post.authorId || '')}`;
        }
        return `author:${String(post.authorId || '')}`;
    }

    private applySupplierDiversity(posts: any[]): any[] {
        const supplierCounts = new Map<string, number>();
        const result: any[] = [];

        for (const post of posts) {
            const key = this.supplierKey(post);
            const currentCount = supplierCounts.get(key) || 0;

            if (currentCount < CONFIG.DIVERSITY_LIMIT) {
                result.push(post);
                supplierCounts.set(key, currentCount + 1);
            }

            // 达到目标数量后停止
            if (result.length >= CONFIG.MAX_RESULTS) {
                break;
            }
        }

        return result;
    }
}
