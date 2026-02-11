/**
 * NewsModelContextQueryHydrator
 * 为新闻语料（externalId）构建模型输入上下文：
 * - newsHistoryExternalIds: 提供给 ANN two-tower 召回
 * - modelUserActionSequence: 提供给 Phoenix ranking（targetPostId 必须是 externalId）
 *
 * 重要：QueryHydrators 在 pipeline 中是并行执行的（对齐 x-algorithm candidate-pipeline）。
 * 因此该 hydrator 不依赖 UserActionSeqQueryHydrator 的结果，必要时会自行读取最近行为序列。
 */

import mongoose from 'mongoose';
import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import UserAction, { ActionType, IUserAction } from '../../../models/UserAction';
import Post from '../../../models/Post';

const MAX_SEQUENCE_LENGTH = 50;

export class NewsModelContextQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'NewsModelContextQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        try {
            const actions: IUserAction[] = (query.userActionSequence && query.userActionSequence.length > 0)
                ? query.userActionSequence
                : await UserAction.getUserActionSequence(
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

            const rawPostIds: string[] = actions
                .map((a: any) => a?.targetPostId)
                .filter(Boolean)
                .map((id: any) => String(id));

            // Fetch externalId mapping for news posts in one query
            const objIds = rawPostIds
                .filter((id) => mongoose.isValidObjectId(id))
                .map((id) => new mongoose.Types.ObjectId(id));

            const postDocs = objIds.length > 0
                ? await Post.find(
                    {
                        _id: { $in: objIds },
                        deletedAt: null,
                        isNews: true,
                        'newsMetadata.externalId': { $exists: true, $ne: null },
                    },
                    { _id: 1, 'newsMetadata.externalId': 1 }
                ).lean()
                : [];

            const postIdToExternal = new Map<string, string>();
            for (const p of postDocs as any[]) {
                const pid = String(p?._id);
                const ext = p?.newsMetadata?.externalId ? String(p.newsMetadata.externalId) : '';
                if (pid && ext) postIdToExternal.set(pid, ext);
            }

            const newsHistoryExternalIds: string[] = [];
            const modelUserActionSequence: Array<Record<string, any>> = [];

            for (const a of actions as any[]) {
                const pid = a?.targetPostId ? String(a.targetPostId) : '';
                if (!pid) continue;
                const ext = postIdToExternal.get(pid);
                if (!ext) continue;
                newsHistoryExternalIds.push(ext);
                modelUserActionSequence.push({
                    action: a?.action,
                    targetPostId: ext,
                    timestamp: a?.timestamp,
                });
            }

            return {
                ...query,
                newsHistoryExternalIds,
                modelUserActionSequence,
            };
        } catch (error) {
            console.error('[NewsModelContextQueryHydrator] Failed to build news model context:', error);
            return query;
        }
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            newsHistoryExternalIds: hydrated.newsHistoryExternalIds ?? query.newsHistoryExternalIds,
            modelUserActionSequence: hydrated.modelUserActionSequence ?? query.modelUserActionSequence,
        };
    }
}

