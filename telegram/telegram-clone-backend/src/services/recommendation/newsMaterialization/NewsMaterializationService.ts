import { Op } from 'sequelize';

import NewsArticle from '../../../models/NewsArticle';
import Post from '../../../models/Post';
import { postFeatureSnapshotService } from '../contentFeatures';

const NEWS_BOT_AUTHOR_ID = 'news_bot_official';

export interface MaterializeNewsOptions {
    dryRun?: boolean;
    limit?: number;
    batchSize?: number;
    since?: Date;
    refreshFeatureSnapshots?: boolean;
}

export interface MaterializeNewsResult {
    scanned: number;
    upserted: number;
    snapshotRequested: number;
    dryRun: boolean;
}

export class NewsMaterializationService {
    async materialize(options: MaterializeNewsOptions = {}): Promise<MaterializeNewsResult> {
        const limit = Math.max(1, Math.min(options.limit ?? 1000, 10000));
        const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));
        const dryRun = options.dryRun === true;
        let scanned = 0;
        let upserted = 0;
        let snapshotRequested = 0;
        let cursor: Date | undefined;

        while (scanned < limit) {
            const where: Record<string, unknown> = {
                isActive: true,
                deletedAt: null,
            };
            if (options.since || cursor) {
                where.updatedAt = {
                    ...(options.since ? { [Op.gte]: options.since } : {}),
                    ...(cursor ? { [Op.lt]: cursor } : {}),
                };
            }

            const articles = await NewsArticle.findAll({
                where,
                order: [
                    ['updatedAt', 'DESC'],
                    ['id', 'DESC'],
                ],
                limit: Math.min(batchSize, limit - scanned),
            });
            if (articles.length === 0) break;

            scanned += articles.length;
            cursor = articles[articles.length - 1].updatedAt;

            if (dryRun) continue;

            const posts = [];
            for (const article of articles) {
                const post = await Post.findOneAndUpdate(
                    {
                        $or: [
                            { 'newsMetadata.externalId': article.id },
                            { 'newsMetadata.url': this.materializedUrl(article) },
                        ],
                    },
                    {
                        $set: {
                            authorId: NEWS_BOT_AUTHOR_ID,
                            content: this.contentFor(article),
                            keywords: article.keywords || [],
                            language: article.language || undefined,
                            engagementScore: article.engagementScore || 0,
                            media: this.mediaFor(article),
                            isNews: true,
                            isNsfw: false,
                            isPinned: false,
                            newsMetadata: {
                                externalId: article.id,
                                title: article.title,
                                summary: article.summary,
                                source: article.source,
                                url: this.materializedUrl(article),
                                sourceUrl: article.sourceUrl || article.canonicalUrl || undefined,
                                clusterId: article.clusterId ?? undefined,
                                language: article.language || undefined,
                                category: article.category || undefined,
                            },
                            createdAt: article.publishedAt || article.fetchedAt || article.createdAt || new Date(),
                            updatedAt: new Date(),
                        },
                        $setOnInsert: {
                            stats: {
                                likeCount: 0,
                                repostCount: 0,
                                quoteCount: 0,
                                commentCount: article.clickCount || article.viewCount || 0,
                                viewCount: article.viewCount || 0,
                            },
                            isRepost: false,
                            isReply: false,
                        },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true },
                );
                upserted += 1;
                posts.push(post);
            }

            if (options.refreshFeatureSnapshots !== false && posts.length > 0) {
                await postFeatureSnapshotService.ensureSnapshotsForPosts(posts as any);
                snapshotRequested += posts.length;
            }
        }

        return { scanned, upserted, snapshotRequested, dryRun };
    }

    private materializedUrl(article: NewsArticle): string {
        return article.canonicalUrl || article.sourceUrl || `news-article://${article.id}`;
    }

    private contentFor(article: NewsArticle): string {
        const parts = [article.title, article.summary || article.lead].filter(Boolean);
        return parts.join('\n\n').slice(0, 2000);
    }

    private mediaFor(article: NewsArticle) {
        if (!article.coverImageUrl) return [];
        return [
            {
                type: 'image',
                url: article.coverImageUrl,
                thumbnailUrl: article.coverImageUrl,
            },
        ];
    }
}

export const newsMaterializationService = new NewsMaterializationService();
