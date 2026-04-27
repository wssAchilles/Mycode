/**
 * UserActionSeqQueryHydrator - 用户行为序列查询丰富器
 * 复刻 x-algorithm home-mixer/query_hydrators/user_action_seq_query_hydrator.rs
 * 在管道开始前加载用户最近的行为序列
 */

import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import UserAction, { ActionType } from '../../../models/UserAction';
import Post from '../../../models/Post';

/**
 * 配置参数
 * 复刻 UAS_MAX_SEQUENCE_LENGTH
 */
const MAX_SEQUENCE_LENGTH = 50;
const ACTION_TYPES = [
    ActionType.LIKE,
    ActionType.REPLY,
    ActionType.REPOST,
    ActionType.QUOTE,
    ActionType.CLICK,
    ActionType.PROFILE_CLICK,
    ActionType.SHARE,
    ActionType.DWELL,
    ActionType.VIDEO_VIEW,
    ActionType.VIDEO_QUALITY_VIEW,
    ActionType.IMPRESSION,
    ActionType.DISMISS,
    ActionType.BLOCK_AUTHOR,
    ActionType.REPORT,
];

export class UserActionSeqQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserActionSeqQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const actions = await UserAction.find({
            userId: query.userId,
            action: { $in: ACTION_TYPES },
        })
            .sort({ timestamp: -1 })
            .limit(MAX_SEQUENCE_LENGTH)
            .lean();
        const postIds = actions
            .map((action: any) => action.targetPostId)
            .filter(Boolean)
            .map((id: any) => String(id));
        const posts = postIds.length > 0
            ? await Post.find({ _id: { $in: postIds }, deletedAt: null })
                .select('content keywords authorId conversationId isNews newsMetadata')
                .lean()
            : [];
        const postMap = new Map((posts as any[]).map((post) => [String(post._id), post]));
        const userActionSequence = actions.map((action: any) => {
            const targetPostId = action.targetPostId ? String(action.targetPostId) : undefined;
            const post = targetPostId ? postMap.get(targetPostId) : undefined;
            const newsMetadata = post?.newsMetadata || {};
            const explicitKeywords = Array.isArray(action.targetKeywords)
                ? action.targetKeywords
                : [];
            const targetKeywords = Array.from(new Set([
                ...explicitKeywords.map((keyword: unknown) => String(keyword || '').trim().toLowerCase()),
                ...((post?.keywords || []) as string[]),
                ...extractTextKeywords(newsMetadata.title || ''),
                ...extractTextKeywords(newsMetadata.summary || ''),
                ...extractTextKeywords(action.actionText || ''),
            ].filter(Boolean))).slice(0, 16);

            return {
                action: action.action,
                targetPostId,
                targetAuthorId: action.targetAuthorId || post?.authorId,
                targetConversationId: post?.conversationId ? String(post.conversationId) : undefined,
                targetClusterId: typeof newsMetadata.clusterId === 'number' ? newsMetadata.clusterId : undefined,
                targetKeywords,
                targetSource: newsMetadata.source,
                targetSourceUrl: newsMetadata.sourceUrl || newsMetadata.url,
                targetTitle: newsMetadata.title,
                actionText: action.actionText,
                modelPostId: action.modelPostId || newsMetadata.externalId || targetPostId,
                recallSource: action.recallSource,
                dwellTimeMs: action.dwellTimeMs,
                videoWatchPercentage: action.videoWatchPercentage,
                rank: action.rank,
                score: action.score,
                weightedScore: action.weightedScore,
                inNetwork: action.inNetwork,
                isNews: action.isNews === true || post?.isNews === true,
                productSurface: action.productSurface,
                requestId: action.requestId,
                timestamp: action.timestamp instanceof Date
                    ? action.timestamp.toISOString()
                    : action.timestamp,
            };
        });

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

function extractTextKeywords(text: string): string[] {
    return (text || '')
        .replace(/https?:\/\/\S+/g, ' ')
        .match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g)?.map((token) => token.toLowerCase()) || [];
}
