/**
 * UserActionSeqQueryHydrator - 用户行为序列查询丰富器
 * 复刻 x-algorithm home-mixer/query_hydrators/user_action_seq_query_hydrator.rs
 * 在管道开始前加载用户最近的行为序列
 */

import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import UserAction, { ActionType } from '../../../models/UserAction';

/**
 * 配置参数
 * 复刻 UAS_MAX_SEQUENCE_LENGTH
 */
const MAX_SEQUENCE_LENGTH = 50;

export class UserActionSeqQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserActionSeqQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        // 获取用户最近的行为序列
        const userActionSequence = await UserAction.getUserActionSequence(
            query.userId,
            MAX_SEQUENCE_LENGTH,
            [
                ActionType.LIKE,
                ActionType.REPLY,
                ActionType.REPOST,
                ActionType.CLICK,
                ActionType.IMPRESSION,
            ]
        );

        return {
            ...query,
            userActionSequence,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            userActionSequence: hydrated.userActionSequence || query.userActionSequence,
        };
    }
}
