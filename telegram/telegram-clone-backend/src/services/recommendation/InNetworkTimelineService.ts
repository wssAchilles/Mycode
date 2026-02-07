import { redis } from '../../config/redis';

/**
 * In-network (following) timeline storage backed by Redis ZSET.
 *
 * Key: tl:author:{authorId}
 * Member: postId (string)
 * Score: createdAt unix ms (number)
 *
 * Design goals:
 * - Write once on post creation (write-light)
 * - Read-heavy merge across followed authors (acceptable for small scale)
 * - Enforce a time window + per-author cap to control memory usage
 */
export class InNetworkTimelineService {
    private static KEY_PREFIX = 'tl:author:';
    private static WINDOW_DAYS = 7;
    private static KEY_TTL_SECONDS = 8 * 24 * 60 * 60; // 8 days
    private static PER_AUTHOR_CAP = 200;

    // Read path tuning
    private static MAX_FOLLOWED_AUTHORS = 2000;
    private static MIN_PER_AUTHOR_FETCH = 3;
    private static MAX_PER_AUTHOR_FETCH = 30;
    private static OVERSAMPLE_FACTOR = 5;

    static timelineKey(authorId: string): string {
        return `${this.KEY_PREFIX}${authorId}`;
    }

    static windowCutoffMs(nowMs: number = Date.now()): number {
        return nowMs - this.WINDOW_DAYS * 24 * 60 * 60 * 1000;
    }

    /**
     * Add a post to the author's timeline and enforce retention/cap.
     */
    static async addPost(
        authorId: string,
        postId: string,
        createdAt: Date
    ): Promise<void> {
        const key = this.timelineKey(authorId);
        const createdAtMs = createdAt.getTime();
        const cutoffMs = this.windowCutoffMs(createdAtMs);

        try {
            // 1) Insert and trim by window
            const pipeline = redis.pipeline();
            pipeline.zadd(key, createdAtMs, postId);
            pipeline.zremrangebyscore(key, 0, cutoffMs);
            pipeline.expire(key, this.KEY_TTL_SECONDS);
            pipeline.zcard(key);

            const results = await pipeline.exec();
            const zcardRes = results?.[results.length - 1];
            const card = typeof zcardRes?.[1] === 'number' ? (zcardRes[1] as number) : null;

            // 2) Enforce per-author cap (remove oldest)
            if (card && card > this.PER_AUTHOR_CAP) {
                const removeCount = card - this.PER_AUTHOR_CAP;
                await redis.zremrangebyrank(key, 0, removeCount - 1);
            }
        } catch (err) {
            // Best-effort: timeline is a cache. Do not break post creation.
            console.warn('[InNetworkTimelineService] addPost failed', err);
        }
    }

    static async removePost(authorId: string, postId: string): Promise<void> {
        const key = this.timelineKey(authorId);
        try {
            await redis.zrem(key, postId);
        } catch (err) {
            // Best-effort: timeline is a cache. Do not break post deletion.
            console.warn('[InNetworkTimelineService] removePost failed', err);
        }
    }

    /**
     * Read recent in-network postIds for a user from followed authors, merged by createdAt.
     */
    static async getMergedPostIdsForAuthors(options: {
        authorIds: string[];
        cursor?: Date;
        maxResults?: number;
    }): Promise<string[]> {
        const maxResults = options.maxResults ?? 200;
        const nowMs = Date.now();
        const cutoffMs = this.windowCutoffMs(nowMs);
        const maxScore = options.cursor ? options.cursor.getTime() - 1 : nowMs;

        const authorIds = options.authorIds.slice(0, this.MAX_FOLLOWED_AUTHORS);
        if (authorIds.length === 0) return [];

        // Dynamic per-author fetch: keep total retrieved candidates bounded while ensuring
        // we have enough to fill maxResults after dedup/filtering.
        const totalBudget = Math.max(maxResults * this.OVERSAMPLE_FACTOR, 200);
        const perAuthorFetch = Math.min(
            this.MAX_PER_AUTHOR_FETCH,
            Math.max(
                this.MIN_PER_AUTHOR_FETCH,
                Math.ceil(totalBudget / Math.max(1, authorIds.length))
            )
        );

        let res: any[] | null = null;
        try {
            const pipeline = redis.pipeline();
            for (const authorId of authorIds) {
                const key = this.timelineKey(authorId);
                // zrevrangebyscore key max min WITHSCORES LIMIT 0 N
                pipeline.zrevrangebyscore(
                    key,
                    maxScore,
                    cutoffMs,
                    'WITHSCORES',
                    'LIMIT',
                    0,
                    perAuthorFetch
                );
            }

            res = await pipeline.exec();
        } catch (err) {
            // Best-effort: timeline is a cache. Do not break feed generation.
            console.warn('[InNetworkTimelineService] getMergedPostIdsForAuthors failed', err);
            res = null;
        }
        if (!res) return [];

        const scored: Array<{ postId: string; score: number }> = [];
        for (const [err, data] of res) {
            if (err || !Array.isArray(data)) continue;
            // WITHSCORES returns [member1, score1, member2, score2...]
            for (let i = 0; i + 1 < data.length; i += 2) {
                const postId = String(data[i]);
                const score = Number(data[i + 1]);
                if (!postId || Number.isNaN(score)) continue;
                scored.push({ postId, score });
            }
        }

        if (scored.length === 0) return [];

        scored.sort((a, b) => b.score - a.score);

        const seen = new Set<string>();
        const result: string[] = [];
        for (const item of scored) {
            if (seen.has(item.postId)) continue;
            seen.add(item.postId);
            result.push(item.postId);
            if (result.length >= maxResults) break;
        }
        return result;
    }
}

export default InNetworkTimelineService;
