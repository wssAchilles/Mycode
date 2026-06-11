/**
 * Negative feedback routes — self-service recommendation signal review and undo.
 */

import mongoose, { FilterQuery, Types } from 'mongoose';
import { Op } from 'sequelize';
import { Router, Request, Response } from 'express';

import Contact from '../../models/Contact';
import Post from '../../models/Post';
import RealGraphEdge, {
    InteractionCounts,
    REALGRAPH_FEATURE_VERSION,
    REALGRAPH_MODEL_VERSION,
    REALGRAPH_PREDICTION_MODE,
} from '../../models/RealGraphEdge';
import User from '../../models/User';
import UserAction, { ActionType, IUserAction } from '../../models/UserAction';
import UserSettings from '../../models/UserSettings';
import UserSignal, {
    IUserSignal,
    ProductSurface,
    SignalType,
    TargetType,
} from '../../models/UserSignal';
import { log, normalizeSpaceUploadUrl } from './shared';

const router = Router();

const NEGATIVE_SIGNAL_TYPES = [
    SignalType.UNFAVORITE,
    SignalType.UNRETWEET,
    SignalType.UNFOLLOW,
    SignalType.BLOCK,
    SignalType.MUTE,
    SignalType.REPORT,
    SignalType.DISMISS_POST,
    SignalType.HIDE_POST,
    SignalType.UNBOOKMARK,
    SignalType.NOTIFICATION_DISMISS,
] as const;

const NEGATIVE_SIGNAL_SET = new Set<SignalType>(NEGATIVE_SIGNAL_TYPES);

const NEGATIVE_WEIGHTS: Partial<Record<SignalType, number>> = {
    [SignalType.UNFAVORITE]: -0.5,
    [SignalType.UNRETWEET]: -1.0,
    [SignalType.UNFOLLOW]: -3.0,
    [SignalType.BLOCK]: -10.0,
    [SignalType.MUTE]: -5.0,
    [SignalType.REPORT]: -8.0,
    [SignalType.DISMISS_POST]: -2.0,
    [SignalType.HIDE_POST]: -4.0,
    [SignalType.UNBOOKMARK]: -0.5,
    [SignalType.NOTIFICATION_DISMISS]: -0.1,
};

const LABELS: Record<(typeof NEGATIVE_SIGNAL_TYPES)[number], string> = {
    [SignalType.UNFAVORITE]: '取消点赞',
    [SignalType.UNRETWEET]: '取消转发',
    [SignalType.UNFOLLOW]: '取消关注',
    [SignalType.BLOCK]: '屏蔽作者',
    [SignalType.MUTE]: '静音作者',
    [SignalType.REPORT]: '举报帖子',
    [SignalType.DISMISS_POST]: '不感兴趣',
    [SignalType.HIDE_POST]: '隐藏帖子',
    [SignalType.UNBOOKMARK]: '取消书签',
    [SignalType.NOTIFICATION_DISMISS]: '关闭通知',
};

const REASON_LABELS: Record<string, string> = {
    spam: '垃圾内容或广告',
    harassment: '骚扰或霸凌',
    misinformation: '虚假信息',
    violence: '暴力或仇恨',
    other: '其他原因',
    not_interested: '不感兴趣',
    hide_post: '隐藏帖子',
};

type LeanSignal = Pick<
    IUserSignal,
    'userId' | 'signalType' | 'targetId' | 'targetType' | 'targetAuthorId' | 'productSurface' | 'requestId' | 'metadata' | 'timestamp'
> & {
    _id: Types.ObjectId;
};

type LeanAction = Pick<
    IUserAction,
    'action' | 'targetPostId' | 'targetAuthorId' | 'requestId' | 'actionText' | 'targetKeywords' | 'productSurface' | 'timestamp'
> & {
    _id: Types.ObjectId;
};

type LeanPost = {
    _id: Types.ObjectId;
    authorId: string;
    content?: string;
    createdAt?: Date;
    isNews?: boolean;
    newsMetadata?: {
        title?: string;
        source?: string;
        url?: string;
        summary?: string;
    };
};

type UserPreview = {
    id: string;
    username: string;
    avatarUrl?: string | null;
};

type NegativeFeedbackItem = {
    id: string;
    signalType: SignalType;
    label: string;
    targetType: TargetType;
    targetId: string;
    targetAuthorId?: string;
    productSurface?: ProductSurface;
    requestId?: string;
    reason?: string | null;
    reasonLabel?: string | null;
    negativeWeight?: number | null;
    generatedBy?: string | null;
    createdAt: string;
    targetPost?: {
        id: string;
        authorId?: string;
        authorUsername?: string;
        content: string;
        createdAt?: string | null;
    } | null;
    targetUser?: UserPreview | null;
};

const isUuid = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const clampLimit = (value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 50;
    return Math.min(100, Math.max(1, Math.floor(parsed)));
};

const normalizeCursor = (value: unknown): Date | undefined => {
    if (typeof value !== 'string' || !value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

const safeMetadata = (signal: Pick<LeanSignal, 'metadata'>): Record<string, unknown> => {
    if (!signal.metadata || typeof signal.metadata !== 'object') return {};
    return signal.metadata as Record<string, unknown>;
};

const metadataString = (metadata: Record<string, unknown>, key: string): string | undefined => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const metadataNumber = (metadata: Record<string, unknown>, key: string): number | undefined => {
    const value = metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const actionForSignal = (signalType: SignalType): ActionType | null => {
    switch (signalType) {
        case SignalType.DISMISS_POST:
            return ActionType.DISMISS;
        case SignalType.HIDE_POST:
            return ActionType.HIDE;
        case SignalType.REPORT:
            return ActionType.REPORT;
        case SignalType.BLOCK:
            return ActionType.BLOCK_AUTHOR;
        default:
            return null;
    }
};

const graphCountFieldForSignal = (signalType: SignalType): keyof InteractionCounts | null => {
    switch (signalType) {
        case SignalType.BLOCK:
            return 'blockCount';
        case SignalType.MUTE:
            return 'muteCount';
        case SignalType.REPORT:
            return 'reportCount';
        case SignalType.UNFOLLOW:
            return 'followCount';
        default:
            return null;
    }
};

const sigmoid = (value: number, scale = 0.1): number => 1 / (1 + Math.exp(-value * scale));

const postIdToObjectId = (targetId: string): Types.ObjectId | null =>
    mongoose.Types.ObjectId.isValid(targetId) ? new mongoose.Types.ObjectId(targetId) : null;

function actionKey(action: LeanAction): string {
    const targetPostId = action.targetPostId ? String(action.targetPostId) : '';
    return `${action.action}:${targetPostId}:${action.targetAuthorId || ''}`;
}

function signalActionFallbackKey(signal: LeanSignal): string | null {
    const action = actionForSignal(signal.signalType);
    if (!action) return null;
    const targetPostId = signal.targetType === TargetType.POST ? signal.targetId : '';
    const targetAuthorId = signal.targetAuthorId || (signal.targetType === TargetType.USER ? signal.targetId : '');
    return `${action}:${targetPostId}:${targetAuthorId}`;
}

function findActionForSignal(signal: LeanSignal, actionsByRequestId: Map<string, LeanAction>, actionsByKey: Map<string, LeanAction>): LeanAction | null {
    if (signal.requestId) {
        const action = actionsByRequestId.get(signal.requestId);
        if (action) return action;
    }
    const key = signalActionFallbackKey(signal);
    return key ? actionsByKey.get(key) || null : null;
}

async function loadUsers(userIds: string[]): Promise<Map<string, UserPreview>> {
    const ids = Array.from(new Set(userIds.filter(isUuid)));
    if (ids.length === 0) return new Map();

    const rows = await User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'username', 'avatarUrl'],
    });

    const map = new Map<string, UserPreview>();
    for (const row of rows) {
        const user = row.get({ plain: true }) as UserPreview;
        map.set(user.id, {
            id: user.id,
            username: user.username,
            avatarUrl: normalizeSpaceUploadUrl(user.avatarUrl) ?? user.avatarUrl ?? null,
        });
    }
    return map;
}

async function loadActions(userId: string, signals: LeanSignal[]): Promise<LeanAction[]> {
    const requestIds = signals
        .map((signal) => signal.requestId)
        .filter((value): value is string => Boolean(value));
    const postObjectIds = signals
        .filter((signal) => signal.targetType === TargetType.POST)
        .map((signal) => postIdToObjectId(signal.targetId))
        .filter((value): value is Types.ObjectId => Boolean(value));
    const authorIds = signals
        .map((signal) => signal.targetAuthorId || (signal.targetType === TargetType.USER ? signal.targetId : ''))
        .filter(Boolean);

    const clauses: FilterQuery<IUserAction>[] = [];
    if (requestIds.length > 0) clauses.push({ requestId: { $in: requestIds } });
    if (postObjectIds.length > 0) {
        clauses.push({
            action: { $in: [ActionType.DISMISS, ActionType.HIDE, ActionType.REPORT] },
            targetPostId: { $in: postObjectIds },
        });
    }
    if (authorIds.length > 0) {
        clauses.push({
            action: ActionType.BLOCK_AUTHOR,
            targetAuthorId: { $in: Array.from(new Set(authorIds)) },
        });
    }
    if (clauses.length === 0) return [];

    return UserAction.find({ userId, $or: clauses })
        .sort({ timestamp: -1 })
        .lean<LeanAction[]>();
}

function buildItem(
    signal: LeanSignal,
    postMap: Map<string, LeanPost>,
    userMap: Map<string, UserPreview>,
    actionsByRequestId: Map<string, LeanAction>,
    actionsByKey: Map<string, LeanAction>,
): NegativeFeedbackItem {
    const metadata = safeMetadata(signal);
    const action = findActionForSignal(signal, actionsByRequestId, actionsByKey);
    const reason = metadataString(metadata, 'reason') || action?.actionText || null;
    const negativeWeight = metadataNumber(metadata, 'negativeWeight') ?? NEGATIVE_WEIGHTS[signal.signalType] ?? null;
    const generatedBy = metadataString(metadata, 'generatedBy') || null;
    const targetUsername = metadataString(metadata, 'targetUsername');
    const post = signal.targetType === TargetType.POST ? postMap.get(signal.targetId) : undefined;
    const postAuthor = post?.authorId ? userMap.get(post.authorId) : undefined;
    const targetUserId = signal.targetType === TargetType.USER
        ? signal.targetId
        : signal.targetAuthorId || post?.authorId;
    const targetUser = targetUserId
        ? userMap.get(targetUserId) || {
            id: targetUserId,
            username: targetUsername || 'Unknown',
            avatarUrl: null,
        }
        : null;
    const transformedPost = post ? {
        id: String(post._id),
        authorId: post.authorId,
        authorUsername: postAuthor?.username || targetUsername || undefined,
        content: post.newsMetadata?.title || post.content || '',
        createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : null,
    } : null;

    return {
        id: String(signal._id),
        signalType: signal.signalType,
        label: LABELS[signal.signalType as (typeof NEGATIVE_SIGNAL_TYPES)[number]] || signal.signalType,
        targetType: signal.targetType,
        targetId: signal.targetId,
        targetAuthorId: signal.targetAuthorId,
        productSurface: signal.productSurface,
        requestId: signal.requestId,
        reason,
        reasonLabel: reason ? REASON_LABELS[reason] || reason : null,
        negativeWeight,
        generatedBy,
        createdAt: signal.timestamp instanceof Date ? signal.timestamp.toISOString() : new Date(signal.timestamp).toISOString(),
        targetPost: transformedPost,
        targetUser,
    };
}

async function undoGraphContribution(userId: string, signal: Pick<IUserSignal, 'signalType' | 'targetType' | 'targetId' | 'targetAuthorId'>): Promise<boolean> {
    const targetUserId = signal.targetAuthorId || (signal.targetType === TargetType.USER ? signal.targetId : undefined);
    const field = graphCountFieldForSignal(signal.signalType);
    if (!targetUserId || !field) return false;

    const edge = await RealGraphEdge.findOne({ sourceUserId: userId, targetUserId });
    if (!edge) return false;

    const adjust = (counts: InteractionCounts) => {
        const current = Number(counts[field] || 0);
        if (signal.signalType === SignalType.UNFOLLOW) {
            counts[field] = current < 0 ? Math.min(0, current + 1) : current;
            return;
        }
        counts[field] = Math.max(0, current - 1);
    };

    adjust(edge.dailyCounts);
    adjust(edge.rollupCounts);
    edge.decayedSum = RealGraphEdge.computeDecayedSum(edge.rollupCounts);
    edge.interactionProbability = edge.rollupCounts.blockCount > 0 ? 0 : sigmoid(edge.decayedSum);
    edge.predictionMode = REALGRAPH_PREDICTION_MODE;
    edge.modelVersion = REALGRAPH_MODEL_VERSION;
    edge.featureVersion = REALGRAPH_FEATURE_VERSION;
    edge.lastPredictionAt = new Date();
    edge.markModified('dailyCounts');
    edge.markModified('rollupCounts');
    await edge.save();
    return true;
}

async function undoPersistentState(userId: string, signal: Pick<IUserSignal, 'signalType' | 'targetId' | 'targetType'>): Promise<void> {
    if (signal.targetType !== TargetType.USER) return;
    if (signal.signalType === SignalType.BLOCK) {
        await Contact.destroy({ where: { userId, contactId: signal.targetId } });
    }
    if (signal.signalType === SignalType.MUTE) {
        await UserSettings.removeMutedUser(userId, signal.targetId);
    }
}

async function deleteMatchingActions(userId: string, signal: Pick<IUserSignal, 'signalType' | 'targetId' | 'targetType' | 'targetAuthorId' | 'requestId'>): Promise<number> {
    const action = actionForSignal(signal.signalType);
    if (!action) return 0;

    const clauses: FilterQuery<IUserAction>[] = [];
    if (signal.requestId) clauses.push({ requestId: signal.requestId });
    if (signal.targetType === TargetType.POST) {
        const postObjectId = postIdToObjectId(signal.targetId);
        if (postObjectId) clauses.push({ targetPostId: postObjectId });
    }
    const targetAuthorId = signal.targetAuthorId || (signal.targetType === TargetType.USER ? signal.targetId : undefined);
    if (targetAuthorId) clauses.push({ targetAuthorId });
    if (clauses.length === 0) return 0;

    const result = await UserAction.deleteMany({ userId, action, $or: clauses });
    return result.deletedCount || 0;
}

// ---------------------------------------------------------------------------
// GET /users/:id/negative-feedback
// ---------------------------------------------------------------------------

router.get('/users/:id/negative-feedback', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const profileUserId = req.params.id;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId !== profileUserId) return res.status(403).json({ error: '只能查看自己的负反馈记录' });

        const limit = clampLimit(req.query.limit);
        const cursor = normalizeCursor(req.query.cursor);
        const query: FilterQuery<IUserSignal> = {
            userId,
            signalType: { $in: NEGATIVE_SIGNAL_TYPES },
        };
        if (cursor) {
            query.timestamp = { $lt: cursor };
        }

        const signals = await UserSignal.find(query)
            .sort({ timestamp: -1 })
            .limit(limit + 1)
            .lean<LeanSignal[]>();
        const page = signals.slice(0, limit);
        const hasMore = signals.length > limit;

        const postObjectIds = page
            .filter((signal) => signal.targetType === TargetType.POST)
            .map((signal) => postIdToObjectId(signal.targetId))
            .filter((value): value is Types.ObjectId => Boolean(value));
        const posts = postObjectIds.length > 0
            ? await Post.find({ _id: { $in: postObjectIds } })
                .select('_id authorId content createdAt isNews newsMetadata')
                .lean<LeanPost[]>()
            : [];
        const postMap = new Map(posts.map((post) => [String(post._id), post]));

        const userIds = new Set<string>();
        for (const signal of page) {
            if (signal.targetType === TargetType.USER) userIds.add(signal.targetId);
            if (signal.targetAuthorId) userIds.add(signal.targetAuthorId);
            const post = postMap.get(signal.targetId);
            if (post?.authorId) userIds.add(post.authorId);
        }
        const userMap = await loadUsers(Array.from(userIds));
        const actions = await loadActions(userId, page);
        const actionsByRequestId = new Map(actions.filter((action) => action.requestId).map((action) => [action.requestId as string, action]));
        const actionsByKey = new Map(actions.map((action) => [actionKey(action), action]));
        const items = page.map((signal) => buildItem(signal, postMap, userMap, actionsByRequestId, actionsByKey));

        const [total, byTypeRows] = await Promise.all([
            UserSignal.countDocuments({ userId, signalType: { $in: NEGATIVE_SIGNAL_TYPES } }),
            UserSignal.aggregate<{ _id: SignalType; count: number }>([
                { $match: { userId, signalType: { $in: NEGATIVE_SIGNAL_TYPES } } },
                { $group: { _id: '$signalType', count: { $sum: 1 } } },
            ]),
        ]);
        const byType = byTypeRows.reduce<Record<string, number>>((acc, row) => {
            acc[row._id] = row.count;
            return acc;
        }, {});
        const negativeWeightTotal = items.reduce((sum, item) => sum + (item.negativeWeight || 0), 0);

        return res.json({
            items,
            hasMore,
            nextCursor: hasMore && page.length > 0 ? page[page.length - 1].timestamp.toISOString() : undefined,
            summary: {
                total,
                byType,
                negativeWeightTotal,
            },
        });
    } catch (error) {
        log.error({ err: error }, '获取负反馈记录失败');
        return res.status(500).json({ error: '获取负反馈记录失败' });
    }
});

// ---------------------------------------------------------------------------
// POST /users/:id/negative-feedback/:feedbackId/undo
// ---------------------------------------------------------------------------

router.post('/users/:id/negative-feedback/:feedbackId/undo', async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { userId?: string }).userId;
        const profileUserId = req.params.id;
        const feedbackId = req.params.feedbackId;
        if (!userId) return res.status(401).json({ error: '未授权' });
        if (userId !== profileUserId) return res.status(403).json({ error: '只能撤销自己的负反馈记录' });
        if (!mongoose.Types.ObjectId.isValid(feedbackId)) {
            return res.status(400).json({ error: '无效的负反馈记录' });
        }

        const signal = await UserSignal.findOne({
            _id: new mongoose.Types.ObjectId(feedbackId),
            userId,
            signalType: { $in: NEGATIVE_SIGNAL_TYPES },
        });
        if (!signal || !NEGATIVE_SIGNAL_SET.has(signal.signalType)) {
            return res.status(404).json({ error: '负反馈记录不存在' });
        }

        const [actionsDeleted, graphUpdated] = await Promise.all([
            deleteMatchingActions(userId, signal),
            undoGraphContribution(userId, signal),
            undoPersistentState(userId, signal),
        ]);
        await UserSignal.deleteOne({ _id: signal._id, userId });

        return res.json({
            success: true,
            removed: {
                signals: 1,
                actions: actionsDeleted,
                graphUpdated,
            },
        });
    } catch (error) {
        log.error({ err: error }, '撤销负反馈失败');
        return res.status(500).json({ error: '撤销负反馈失败' });
    }
});

export default router;
