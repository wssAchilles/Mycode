/**
 * AuthorInfoHydrator - 作者信息丰富器
 * 复刻 x-algorithm 的 candidate hydration
 * 批量加载候选帖子的作者信息
 */

import { Hydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import User from '../../../models/User';

export class AuthorInfoHydrator implements Hydrator<FeedQuery, FeedCandidate> {
    readonly name = 'AuthorInfoHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FeedCandidate[]> {
        if (candidates.length === 0) return candidates;

        // 收集所有唯一的作者 ID
        const authorIds = [...new Set(candidates.map((c) => c.authorId))];

        // 批量查询作者信息
        const authors = await this.batchGetAuthors(authorIds);
        const authorMap = new Map(authors.map((a) => [a.id, a]));

        // 丰富候选者
        return candidates.map((candidate) => {
            const author = authorMap.get(candidate.authorId);
            if (author) {
                return {
                    ...candidate,
                    authorUsername: author.username,
                    authorAvatarUrl: author.avatarUrl || undefined,
                };
            }
            return candidate;
        });
    }

    update(candidate: FeedCandidate, hydratedCandidate: Partial<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            authorUsername: hydratedCandidate.authorUsername || candidate.authorUsername,
            authorAvatarUrl: hydratedCandidate.authorAvatarUrl || candidate.authorAvatarUrl,
        };
    }

    /**
     * 批量获取作者信息
     */
    private async batchGetAuthors(
        authorIds: string[]
    ): Promise<{ id: string; username: string; avatarUrl: string | undefined }[]> {
        try {
            const users = await User.findAll({
                where: {
                    id: authorIds,
                },
                attributes: ['id', 'username', 'avatarUrl'],
            });
            return users.map((u: { id: string; username: string; avatarUrl?: string }) => ({
                id: u.id,
                username: u.username,
                avatarUrl: u.avatarUrl || undefined,
            }));
        } catch (error) {
            console.error('[AuthorInfoHydrator] Failed to load authors:', error);
            return [];
        }
    }
}
