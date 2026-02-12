/**
 * NewsAnnSource - 新闻 OON 召回源（ANN Two-Tower）
 *
 * 对齐 x-algorithm 的 Phoenix Retrieval 思想，但这里的全局语料暂定为新闻语料：
 * - ANN 输入/输出使用 externalId（例如 MIND `N12345`）
 * - 通过 Mongo `newsMetadata.externalId` 映射回 Post._id 以便后续 hydration 与 serving
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import { AnnClient, HttpAnnClient } from '../clients/ANNClient';

const ANN_MIN_TOPK = 200;
const ANN_MAX_TOPK = 1000;
const FALLBACK_MAX_RESULTS = 80;

export class NewsAnnSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'NewsAnnSource';
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
        return !query.inNetworkOnly;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        // 1) Prefer ANN retrieval
        if (this.annClient) {
            try {
                const historyExternalIds = (query.newsHistoryExternalIds || []).map(String).filter(Boolean);
                const topK = Math.min(
                    ANN_MAX_TOPK,
                    Math.max(ANN_MIN_TOPK, Math.max(0, (query.limit || 0)) * 10)
                );

                const ann = await this.annClient.retrieve({
                    userId: query.userId,
                    keywords: [],
                    historyPostIds: historyExternalIds,
                    topK,
                });

                const externalIds = ann.map((c) => String(c.postId)).filter(Boolean);
                if (externalIds.length > 0) {
                    const posts = await Post.find(
                        {
                            isNews: true,
                            deletedAt: null,
                            'newsMetadata.externalId': { $in: externalIds },
                        },
                        {
                            // minimal fields for candidate creation
                            authorId: 1,
                            content: 1,
                            createdAt: 1,
                            isReply: 1,
                            replyToPostId: 1,
                            isRepost: 1,
                            originalPostId: 1,
                            conversationId: 1,
                            media: 1,
                            stats: 1,
                            isNsfw: 1,
                            isPinned: 1,
                            isNews: 1,
                            newsMetadata: 1,
                        }
                    ).lean();

                    const map = new Map<string, any>();
                    for (const p of posts as any[]) {
                        const ext = p?.newsMetadata?.externalId ? String(p.newsMetadata.externalId) : '';
                        if (ext) map.set(ext, p);
                    }

                    const ordered = externalIds
                        .map((ext) => map.get(ext))
                        .filter(Boolean) as any[];

                    return ordered.map((p) => ({
                        ...createFeedCandidate(p as unknown as Parameters<typeof createFeedCandidate>[0]),
                        inNetwork: false,
                    }));
                }
            } catch (err) {
                console.error('[NewsAnnSource] ANN retrieve failed, fallback recency:', err);
            }
        }

        // 2) Minimal degrade: most recent news (externalId preferred but not required)
        const mongoQuery: Record<string, unknown> = {
            isNews: true,
            deletedAt: null,
        };
        if (query.cursor) {
            mongoQuery.createdAt = { $lt: query.cursor };
        }

        const posts = await Post.find(mongoQuery)
            .sort({ createdAt: -1 })
            .limit(FALLBACK_MAX_RESULTS)
            .lean();

        return (posts as any[]).map((p) => ({
            ...createFeedCandidate(p as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,
        }));
    }
}
