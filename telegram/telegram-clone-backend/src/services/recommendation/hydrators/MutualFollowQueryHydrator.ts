/**
 * MutualFollowQueryHydrator - 互关关系计算
 * 计算 following ∩ followers 得到 mutual_follow_ids
 * 供 Rust 管道的 mutual_follow_jaccard scorer 使用
 */

import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';

export class MutualFollowQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'MutualFollowQueryHydrator';

    enable(query: FeedQuery): boolean {
        // 仅当 UserFeatures 已加载且包含两个列表时才执行
        return (
            (query.userFeatures?.followedUserIds?.length ?? 0) > 0 &&
            (query.userFeatures?.followerIds?.length ?? 0) > 0
        );
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const followedSet = new Set(query.userFeatures!.followedUserIds);
        const mutualFollowIds = query.userFeatures!.followerIds!.filter((id) =>
            followedSet.has(id)
        );

        return {
            ...query,
            mutualFollowIds,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            mutualFollowIds: hydrated.mutualFollowIds ?? query.mutualFollowIds,
        };
    }
}
