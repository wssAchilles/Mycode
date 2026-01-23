/**
 * Feed 查询对象
 * 复刻 x-algorithm 的 ScoredPostsQuery
 */

import { IUserAction } from '../../../models/UserAction';
import { ExperimentContext } from '../../experiment/types';

/**
 * 用户特征 (用于推荐)
 * 复刻 x-algorithm 的 user_features
 */
export interface UserFeatures {
    /** 关注的用户 ID 列表 */
    followedUserIds: string[];
    /** 屏蔽的用户 ID 列表 */
    blockedUserIds: string[];
    /** 静音的关键词列表 */
    mutedKeywords: string[];
    /** 最近已看过的帖子 ID 列表 */
    seenPostIds: string[];
    /** 关注者数量 (用于实验分流) */
    followerCount?: number;
    /** 账号创建时间 */
    accountCreatedAt?: Date;
}

/**
 * Feed 查询对象
 */
export interface FeedQuery {
    /** 请求用户 ID */
    userId: string;

    /** 请求数量 */
    limit: number;

    /** 分页游标 (时间戳) */
    cursor?: Date;

    /** 是否仅显示关注网络内的内容 (复刻 in_network_only) */
    inNetworkOnly: boolean;

    // ============================================
    // 以下字段由 QueryHydrator 填充
    // ============================================

    /** 用户特征 */
    userFeatures?: UserFeatures;

    /** 用户行为序列 (复刻 user_action_sequence) */
    userActionSequence?: IUserAction[];

    // ============================================
    // A/B 实验上下文
    // ============================================

    /** 实验上下文 (由 ExperimentQueryHydrator 填充) */
    experimentContext?: ExperimentContext;
}

/**
 * 创建默认 FeedQuery
 */
export function createFeedQuery(
    userId: string,
    limit: number = 20,
    inNetworkOnly: boolean = false
): FeedQuery {
    return {
        userId,
        limit,
        inNetworkOnly,
        userFeatures: {
            followedUserIds: [],
            blockedUserIds: [],
            mutedKeywords: [],
            seenPostIds: [],
        },
    };
}
