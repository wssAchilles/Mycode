/**
 * UserInteractionHydrator - 用户交互状态丰富器
 * 批量加载当前用户与候选帖子的交互状态 (是否点赞、是否转发)
 */

import mongoose from 'mongoose';
import { Hydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import Like from '../../../models/Like';
import Repost from '../../../models/Repost';

export class UserInteractionHydrator implements Hydrator<FeedQuery, FeedCandidate> {
    readonly name = 'UserInteractionHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FeedCandidate[]> {
        if (candidates.length === 0) return candidates;

        const postIds = candidates.map((c) => c.postId);

        // 并行查询点赞和转发状态
        const [likedSet, repostedSet] = await Promise.all([
            Like.getLikedPostIds(query.userId, postIds),
            Repost.getRepostedPostIds(query.userId, postIds),
        ]);

        // 丰富候选者
        return candidates.map((candidate) => ({
            ...candidate,
            isLikedByUser: likedSet.has(candidate.postId.toString()),
            isRepostedByUser: repostedSet.has(candidate.postId.toString()),
        }));
    }

    update(candidate: FeedCandidate, hydratedCandidate: Partial<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            isLikedByUser: hydratedCandidate.isLikedByUser ?? candidate.isLikedByUser,
            isRepostedByUser: hydratedCandidate.isRepostedByUser ?? candidate.isRepostedByUser,
        };
    }
}
