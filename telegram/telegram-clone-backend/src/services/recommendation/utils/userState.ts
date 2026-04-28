import { ActionType } from '../../../models/UserAction';
import type {
    EmbeddingContext,
    FeedQuery,
    UserFeatures,
    UserStateContext,
} from '../types/FeedQuery';

const POSITIVE_ACTION_TYPES = new Set<ActionType | string>([
    ActionType.CLICK,
    ActionType.LIKE,
    ActionType.REPLY,
    ActionType.REPOST,
    ActionType.QUOTE,
    ActionType.SHARE,
    ActionType.PROFILE_CLICK,
    ActionType.DWELL,
    ActionType.VIDEO_QUALITY_VIEW,
]);

const RECENT_ACTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildUserStateContext(input: {
    userFeatures?: UserFeatures;
    embeddingContext?: EmbeddingContext;
    userActionSequence?: FeedQuery['userActionSequence'];
}): UserStateContext {
    const followedCount = input.userFeatures?.followedUserIds?.length ?? 0;
    const recentActions = (input.userActionSequence || []).filter((action) => {
        const timestamp = action?.timestamp ? new Date(action.timestamp) : null;
        return Boolean(
            timestamp &&
            Number.isFinite(timestamp.getTime()) &&
            Date.now() - timestamp.getTime() <= RECENT_ACTION_LOOKBACK_MS,
        );
    });

    const recentPositiveActionCount = recentActions.filter((action) =>
        POSITIVE_ACTION_TYPES.has(action.action),
    ).length;
    const recentActionCount = recentActions.length;
    const usableEmbedding = Boolean(input.embeddingContext?.usable);

    const accountCreatedAt = input.userFeatures?.accountCreatedAt
        ? new Date(input.userFeatures.accountCreatedAt)
        : undefined;
    const accountAgeDays = accountCreatedAt && Number.isFinite(accountCreatedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - accountCreatedAt.getTime()) / (24 * 60 * 60 * 1000)))
        : undefined;

    if (followedCount === 0 && recentPositiveActionCount < 3) {
        return {
            state: 'cold_start',
            reason: 'no_follow_graph_low_recent_engagement',
            followedCount,
            recentActionCount,
            recentPositiveActionCount,
            usableEmbedding,
            accountAgeDays,
        };
    }

    if (!usableEmbedding || recentPositiveActionCount < 8 || recentActionCount < 12) {
        return {
            state: 'sparse',
            reason: !usableEmbedding
                ? 'embedding_unusable'
                : 'insufficient_recent_actions',
            followedCount,
            recentActionCount,
            recentPositiveActionCount,
            usableEmbedding,
            accountAgeDays,
        };
    }

    if (recentPositiveActionCount < 30) {
        return {
            state: 'warm',
            reason: 'stable_but_not_dense',
            followedCount,
            recentActionCount,
            recentPositiveActionCount,
            usableEmbedding,
            accountAgeDays,
        };
    }

    return {
        state: 'heavy',
        reason: 'dense_recent_activity',
        followedCount,
        recentActionCount,
        recentPositiveActionCount,
        usableEmbedding,
        accountAgeDays,
    };
}
