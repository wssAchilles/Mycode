/**
 * Space news domain queries.
 * Extracted verbatim from spaceService — no behavior changes.
 */
import mongoose from 'mongoose';
import Post, { IPost, MediaType } from '../../../models/Post';
import { createChildLogger } from '../../../utils/logger';
import { buildNewsSummary, extractNewsKeywords } from '../internal/pureHelpers';

const log = createChildLogger('services:space:news');

export async function createNewsPosts(articles: any[]): Promise<number> {
    let count = 0;
    const NEWS_BOT_ID = 'news_bot_official';

    for (const article of articles) {
        if (!article?.url) continue;

        const title = article.title || '新闻速递';
        const rawContent = article.content || `${title}\n\n${article.summary || ''}`;
        const summary = buildNewsSummary(article.summary || rawContent);
        const keywords = extractNewsKeywords(`${title}\n${summary}`);
        const createdAt = article.published ? new Date(article.published) : new Date();

        const postData: Partial<IPost> = {
            authorId: NEWS_BOT_ID,
            content: rawContent,
            keywords,
            isNews: true,
            newsMetadata: {
                title,
                source: article.source || 'news',
                url: article.url,
                clusterId: article.cluster_id,
                summary,
            },
            media: article.top_image ? [{ type: MediaType.IMAGE, url: article.top_image }] : [],
            createdAt,
        };

        const result = await Post.updateOne(
            { 'newsMetadata.url': article.url },
            { $setOnInsert: postData },
            { upsert: true }
        );

        if ((result as any).upsertedCount > 0) {
            count++;
        }
    }
    return count;
}

export async function getNewsClusters(limit: number = 5): Promise<any[]> {
    // 聚合最近 24 小时的新闻
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return Post.aggregate([
        {
            $match: {
                isNews: true,
                createdAt: { $gte: since },
                deletedAt: null
            }
        },
        {
            $group: {
                _id: "$newsMetadata.clusterId",
                count: { $sum: 1 },
                representativePost: { $first: "$$ROOT" }, // 取最新的一条作为代表
                avgScore: { $avg: "$engagementScore" } // 假设有分数
            }
        },
        { $sort: { count: -1 } }, // 按热度排序
        { $limit: limit },
        {
            $project: {
                clusterId: "$_id",
                postId: "$representativePost._id",
                count: 1,
                title: { $ifNull: ["$representativePost.newsMetadata.title", "$representativePost.content"] },
                summary: "$representativePost.newsMetadata.summary",
                source: "$representativePost.newsMetadata.source",
                coverUrl: {
                    $ifNull: [
                        { $arrayElemAt: ["$representativePost.media.url", 0] },
                        null,
                    ],
                },
                latestAt: "$representativePost.createdAt"
            }
        }
    ]);
}

export async function getNewsPosts(
    limit: number = 20,
    cursor?: Date,
    days: number = 1
): Promise<{ posts: IPost[]; hasMore: boolean; nextCursor?: string }> {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(days, 1));

    const query: Record<string, unknown> = {
        isNews: true,
        deletedAt: null,
        createdAt: { $gte: since },
    };

    if (cursor) {
        query.createdAt = { $gte: since, $lt: cursor };
    }

    const posts = await Post.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    const nextCursor = posts.length > 0
        ? new Date(posts[posts.length - 1].createdAt).toISOString()
        : undefined;

    return {
        posts: posts as unknown as IPost[],
        hasMore: posts.length >= limit,
        nextCursor,
    };
}

export async function getNewsClusterPosts(clusterId: number, limit: number = 20): Promise<IPost[]> {
    return Post.find({
        'newsMetadata.clusterId': clusterId,
        isNews: true,
        deletedAt: null
    })
        .sort({ createdAt: -1 })
        .limit(limit);
}

export async function cleanupOldNews(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await Post.deleteMany({
        isNews: true,
        createdAt: { $lt: sevenDaysAgo }
    });

    log.info(`[Cleanup] Deleted ${result.deletedCount} old news posts.`);
    return result.deletedCount;
}
