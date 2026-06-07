import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import { redis } from '../config/redis';
import UserAction, { ActionType, IUserAction } from '../models/UserAction';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../models/UserSignal';
import { InteractionType } from '../models/RealGraphEdge';
import { realGraphService } from '../services/recommendation/RealGraphService';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }
    const since = kv.since ? new Date(kv.since) : undefined;
    return {
        dryRun: kv['dry-run'] === 'true',
        limit: Math.max(1, parseInt(kv.limit || '1000', 10) || 1000),
        batchSize: Math.max(1, parseInt(kv.batch || '200', 10) || 200),
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    };
}

async function main() {
    const args = parseArgs();
    await connectMongoDB();

    const result = await replayUserActionsToSignals(args);
    console.log(JSON.stringify(result, null, 2));
}

async function replayUserActionsToSignals(options: {
    dryRun: boolean;
    limit: number;
    batchSize: number;
    since?: Date;
}) {
    let scanned = 0;
    let signalCandidates = 0;
    let insertedSignals = 0;
    let realGraphInteractions = 0;
    let cursor: Date | undefined;

    while (scanned < options.limit) {
        const query: Record<string, unknown> = {
            action: { $in: Object.values(ActionType) },
            targetPostId: { $exists: true, $ne: null },
        };
        if (options.since || cursor) {
            query.timestamp = {
                ...(options.since ? { $gte: options.since } : {}),
                ...(cursor ? { $lt: cursor } : {}),
            };
        }

        const actions = await UserAction.find(query)
            .sort({ timestamp: -1, _id: -1 })
            .limit(Math.min(options.batchSize, options.limit - scanned));
        if (actions.length === 0) break;

        scanned += actions.length;
        cursor = actions[actions.length - 1].timestamp;

        const interactions: Array<{
            sourceUserId: string;
            targetUserId: string;
            interactionType: InteractionType;
            value?: number;
        }> = [];

        for (const action of actions) {
            const signalType = mapActionToSignal(action.action);
            if (!signalType) continue;
            signalCandidates += 1;
            if (options.dryRun) continue;

            const sourceActionId = String(action._id);
            const targetId = String(action.targetPostId);
            const timestamp = action.timestamp || new Date();
            const expiresAt = new Date(timestamp.getTime() + ttlDays(signalType) * 24 * 60 * 60 * 1000);
            const write = await UserSignal.updateOne(
                {
                    userId: action.userId,
                    signalType,
                    targetId,
                    'metadata.sourceActionId': sourceActionId,
                },
                {
                    $setOnInsert: {
                        userId: action.userId,
                        signalType,
                        targetId,
                        targetType: TargetType.POST,
                        targetAuthorId: action.targetAuthorId,
                        productSurface: normalizeSurface(action.productSurface),
                        requestId: action.requestId,
                        metadata: {
                            sourceActionId,
                            replayedFrom: 'user_actions',
                            dwellTimeMs: action.dwellTimeMs,
                            recommendationPosition: action.rank,
                            recommendationSource: action.recallSource,
                            recommendationScore: action.score,
                            weightedScore: action.weightedScore,
                            inNetwork: action.inNetwork,
                            isNews: action.isNews,
                            modelPostId: action.modelPostId,
                        },
                        timestamp,
                        expiresAt,
                    },
                },
                { upsert: true },
            );

            if (write.upsertedCount > 0) {
                insertedSignals += 1;
                const interactionType = mapActionToInteraction(action);
                if (interactionType && action.targetAuthorId) {
                    interactions.push({
                        sourceUserId: action.userId,
                        targetUserId: action.targetAuthorId,
                        interactionType,
                        value: action.action === ActionType.DWELL ? action.dwellTimeMs || 1 : 1,
                    });
                }
            }
        }

        if (interactions.length > 0) {
            await realGraphService.recordInteractionsBatch(interactions);
            realGraphInteractions += interactions.length;
        }
    }

    return {
        dryRun: options.dryRun,
        scanned,
        signalCandidates,
        insertedSignals,
        realGraphInteractions,
    };
}

function mapActionToSignal(action: ActionType): SignalType | null {
    switch (action) {
        case ActionType.IMPRESSION:
            return SignalType.IMPRESSION;
        case ActionType.CLICK:
            return SignalType.TWEET_CLICK;
        case ActionType.PROFILE_CLICK:
            return SignalType.PROFILE_CLICK;
        case ActionType.LIKE:
            return SignalType.FAVORITE;
        case ActionType.REPLY:
            return SignalType.REPLY;
        case ActionType.REPOST:
            return SignalType.RETWEET;
        case ActionType.QUOTE:
            return SignalType.QUOTE;
        case ActionType.SHARE:
            return SignalType.SHARE;
        case ActionType.OPEN_LINK:
            return SignalType.OPEN_LINK;
        case ActionType.HASHTAG_CLICK:
            return SignalType.HASHTAG_CLICK;
        case ActionType.SEARCH_QUERY:
            return SignalType.SEARCH_QUERY;
        case ActionType.DWELL:
            return SignalType.DWELL;
        case ActionType.DISMISS:
            return SignalType.DISMISS_POST;
        case ActionType.HIDE:
            return SignalType.HIDE_POST;
        case ActionType.REPORT:
            return SignalType.REPORT;
        case ActionType.BLOCK_AUTHOR:
            return SignalType.BLOCK;
        default:
            return null;
    }
}

function mapActionToInteraction(action: IUserAction): InteractionType | null {
    switch (action.action) {
        case ActionType.CLICK:
            return InteractionType.TWEET_CLICK;
        case ActionType.PROFILE_CLICK:
            return InteractionType.PROFILE_VIEW;
        case ActionType.LIKE:
            return InteractionType.LIKE;
        case ActionType.REPLY:
            return InteractionType.REPLY;
        case ActionType.REPOST:
            return InteractionType.RETWEET;
        case ActionType.QUOTE:
            return InteractionType.QUOTE;
        case ActionType.DWELL:
            return InteractionType.DWELL;
        case ActionType.BLOCK_AUTHOR:
            return InteractionType.BLOCK;
        case ActionType.REPORT:
            return InteractionType.REPORT;
        default:
            return null;
    }
}

function normalizeSurface(value?: string): ProductSurface {
    return Object.values(ProductSurface).includes(value as ProductSurface)
        ? value as ProductSurface
        : ProductSurface.SPACE_FEED;
}

function ttlDays(signalType: SignalType): number {
    if (signalType === SignalType.IMPRESSION || signalType === SignalType.DWELL) return 1;
    if (signalType === SignalType.BLOCK || signalType === SignalType.REPORT) return 365;
    return 7;
}

main()
    .catch((error) => {
        console.error('[ReplayUserActionsToSignals] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            mongoose.connection.removeAllListeners('disconnected');
            mongoose.connection.removeAllListeners('error');
            await mongoose.disconnect();
        } catch {
            // ignore
        }
        try {
            redis.disconnect();
        } catch {
            // ignore
        }
    });
