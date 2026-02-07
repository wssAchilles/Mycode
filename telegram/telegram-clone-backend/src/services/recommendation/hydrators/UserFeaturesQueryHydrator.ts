/**
 * UserFeaturesQueryHydrator - 用户特征查询丰富器
 * 复刻 x-algorithm 的用户上下文加载
 * 在管道开始前加载用户的关注列表、屏蔽列表、静音关键词等
 */

import { QueryHydrator } from '../framework';
import { FeedQuery, UserFeatures } from '../types/FeedQuery';
import Contact from '../../../models/Contact';

/**
 * 配置参数
 */
const CONFIG = {
    MAX_FOLLOWED_IDS: 5000, // 最大关注数
    MAX_BLOCKED_IDS: 1000, // 最大屏蔽数
    MAX_SEEN_POSTS: 100, // 最近已读帖子数
};

export class UserFeaturesQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserFeaturesQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        // If client already provides seen_ids, skip expensive server-side seen lookup.
        const userFeatures = await this.loadUserFeatures(query.userId, {
            skipSeenPostIds: (query.seenIds?.length ?? 0) > 0,
        });
        return {
            ...query,
            userFeatures,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            userFeatures: hydrated.userFeatures || query.userFeatures,
        };
    }

    /**
     * 加载用户特征
     * 复刻 x-algorithm 的 user context loading
     */
    private async loadUserFeatures(
        userId: string,
        options?: { skipSeenPostIds?: boolean }
    ): Promise<UserFeatures> {
        // 并行加载所有用户特征
        const [followedUserIds, blockedUserIds, mutedKeywords, seenPostIds] =
            await Promise.all([
                this.getFollowedUserIds(userId),
                this.getBlockedUserIds(userId),
                this.getMutedKeywords(userId),
                options?.skipSeenPostIds ? Promise.resolve([]) : this.getSeenPostIds(userId),
            ]);

        return {
            followedUserIds,
            blockedUserIds,
            mutedKeywords,
            seenPostIds,
        };
    }

    /**
     * 获取关注的用户 ID 列表
     */
    private async getFollowedUserIds(userId: string): Promise<string[]> {
        try {
            const contacts = await Contact.findAll({
                where: {
                    userId: userId,
                    status: 'accepted',
                },
                attributes: ['contactId'],
                limit: CONFIG.MAX_FOLLOWED_IDS,
            });
            return contacts.map((c: { contactId: string }) => c.contactId);
        } catch (error) {
            console.error('[UserFeaturesQueryHydrator] Failed to load followed users:', error);
            return [];
        }
    }

    /**
     * 获取屏蔽的用户 ID 列表
     */
    private async getBlockedUserIds(userId: string): Promise<string[]> {
        try {
            const contacts = await Contact.findAll({
                where: {
                    userId: userId,
                    status: 'blocked',
                },
                attributes: ['contactId'],
                limit: CONFIG.MAX_BLOCKED_IDS,
            });
            return contacts.map((c: { contactId: string }) => c.contactId);
        } catch (error) {
            console.error('[UserFeaturesQueryHydrator] Failed to load blocked users:', error);
            return [];
        }
    }

    /**
     * 获取静音关键词列表
     * 从 UserSettings 模型中加载
     */
    private async getMutedKeywords(userId: string): Promise<string[]> {
        try {
            const UserSettings = (await import('../../../models/UserSettings')).default;
            return await UserSettings.getMutedKeywords(userId);
        } catch (error) {
            console.error('[UserFeaturesQueryHydrator] Failed to load muted keywords:', error);
            return [];
        }
    }

    /**
     * 获取最近已读帖子 ID 列表
     * 从 UserAction 中获取最近的曝光记录和互动记录
     * 包含: 曝光、点赞、评论、转发过的帖子
     */
    private async getSeenPostIds(userId: string): Promise<string[]> {
        try {
            // 动态导入避免循环依赖
            const UserAction = (await import('../../../models/UserAction')).default;
            const { ActionType } = await import('../../../models/UserAction');

            // 获取用户已互动或已曝光的帖子
            // 包含: IMPRESSION, LIKE, REPLY, REPOST, CLICK
            const recentActions = await UserAction.find({
                userId,
                action: { 
                    $in: [
                        ActionType.IMPRESSION,
                        ActionType.LIKE,
                        ActionType.REPLY,
                        ActionType.REPOST,
                        ActionType.CLICK,
                    ]
                },
                targetPostId: { $exists: true, $ne: null },
            })
                .sort({ timestamp: -1 })
                .limit(CONFIG.MAX_SEEN_POSTS * 2) // 多取一些以便去重后仍有足够数量
                .select('targetPostId');

            // 使用 Set 去重
            const seenPostIds = new Set<string>();
            for (const action of recentActions) {
                if (action.targetPostId) {
                    seenPostIds.add(action.targetPostId.toString());
                }
                // 限制最终数量
                if (seenPostIds.size >= CONFIG.MAX_SEEN_POSTS) {
                    break;
                }
            }

            return Array.from(seenPostIds);
        } catch (error) {
            console.error('[UserFeaturesQueryHydrator] Failed to load seen posts:', error);
            return [];
        }
    }
}
