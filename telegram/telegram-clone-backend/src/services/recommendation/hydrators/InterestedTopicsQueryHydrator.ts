/**
 * InterestedTopicsQueryHydrator - 用户兴趣话题聚合
 * 从 UserAction 中聚合用户点击过的话题，按频率排序
 * 供 Rust 管道的话题相关 scorer 使用
 */

import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';

const MAX_TOPICS = 20;
const LOOKBACK_DAYS = 30;

export class InterestedTopicsQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'InterestedTopicsQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const interestedTopics = await this.aggregateTopicInterests(query.userId);
        return {
            ...query,
            interestedTopics,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            interestedTopics: hydrated.interestedTopics ?? query.interestedTopics,
        };
    }

    /**
     * 从 UserAction 聚合用户感兴趣的话题
     * 基于 HASHTAG_CLICK 和 topic-related click 行为
     */
    private async aggregateTopicInterests(userId: string): Promise<string[]> {
        try {
            const UserAction = (await import('../../../models/UserAction')).default;

            const since = new Date();
            since.setDate(since.getDate() - LOOKBACK_DAYS);

            // 聚合用户最近的话题点击行为
            const results = await UserAction.aggregate([
                {
                    $match: {
                        userId,
                        timestamp: { $gte: since },
                        targetKeywords: { $exists: true, $ne: [] },
                    },
                },
                { $unwind: '$targetKeywords' },
                {
                    $group: {
                        _id: '$targetKeywords',
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: MAX_TOPICS },
            ]);

            return results.map((r: { _id: string }) => r._id);
        } catch (error) {
            console.error('[InterestedTopicsQueryHydrator] Failed to aggregate topics:', error);
            return [];
        }
    }
}
