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
        const userFeatures = await this.loadUserFeatures(query.userId);
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
    private async loadUserFeatures(userId: string): Promise<UserFeatures> {
        // 并行加载所有用户特征
        const [followedUserIds, blockedUserIds, mutedKeywords, seenPostIds] =
            await Promise.all([
                this.getFollowedUserIds(userId),
                this.getBlockedUserIds(userId),
                this.getMutedKeywords(userId),
                this.getSeenPostIds(userId),
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
     * TODO: 需要创建 UserSettings 模型来存储
     */
    private async getMutedKeywords(_userId: string): Promise<string[]> {
        // 暂时返回空数组，后续实现用户设置
        return [];
    }

    /**
     * 获取最近已读帖子 ID 列表
     * 从 UserAction 中获取最近的曝光记录
     */
    private async getSeenPostIds(userId: string): Promise<string[]> {
        try {
            // 动态导入避免循环依赖
            const UserAction = (await import('../../../models/UserAction')).default;
            const { ActionType } = await import('../../../models/UserAction');

            const recentImpressions = await UserAction.find({
                userId,
                action: ActionType.IMPRESSION,
            })
                .sort({ timestamp: -1 })
                .limit(CONFIG.MAX_SEEN_POSTS)
                .select('targetPostId');

            return recentImpressions
                .filter((a) => a.targetPostId)
                .map((a) => a.targetPostId!.toString());
        } catch (error) {
            console.error('[UserFeaturesQueryHydrator] Failed to load seen posts:', error);
            return [];
        }
    }
}
