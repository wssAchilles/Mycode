/**
 * UserSignalQueryHydrator - 用户信号特征查询丰富器
 * 从 UserSignalService 加载预聚合的用户信号特征，
 * 将 engagement/explicit/implicit 分数注入 FeedQuery，
 * 供 Rust 推荐管道使用。
 */

import { QueryHydrator } from '../framework';
import type { FeedQuery, UserSignalFeatures } from '../types/FeedQuery';
import { userSignalService } from '../UserSignalService';
import { readQueryHydratorCache, writeQueryHydratorCache } from './queryHydratorCache';

/**
 * 信号加载天数窗口
 * 对齐 UserSignalService 默认的 7 天聚合窗口
 */
const SIGNAL_LOOKBACK_DAYS = 7;
const SIGNAL_CACHE_TTL_SEC = 45;

export class UserSignalQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserSignalQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const cacheKey = `rec:qh:signal:v1:${query.userId}:${SIGNAL_LOOKBACK_DAYS}`;
        try {
            const cached = await readQueryHydratorCache<UserSignalFeatures>(cacheKey);
            if (cached) {
                return {
                    ...query,
                    userSignalFeatures: cached,
                };
            }

            const features = await userSignalService.getUserSignalFeatures(
                query.userId,
                SIGNAL_LOOKBACK_DAYS,
            );

            const userSignalFeatures: UserSignalFeatures = {
                favoriteCount: features.favoriteCount,
                retweetCount: features.retweetCount,
                replyCount: features.replyCount,
                quoteCount: features.quoteCount,
                followCount: features.followCount,
                clickCount: features.clickCount,
                videoViewCount: features.videoViewCount,
                dwellTimeMs: features.dwellTimeMs,
                engagementScore: features.engagementScore,
                explicitScore: features.explicitScore,
                implicitScore: features.implicitScore,
            };

            writeQueryHydratorCache(cacheKey, userSignalFeatures, SIGNAL_CACHE_TTL_SEC);

            return {
                ...query,
                userSignalFeatures,
            };
        } catch {
            // 信号加载失败不应阻塞主推荐管线
            return query;
        }
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            userSignalFeatures: hydrated.userSignalFeatures ?? query.userSignalFeatures,
        };
    }
}
