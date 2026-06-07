import mongoose from 'mongoose';

import { connectMongoDB } from '../config/db';
import { sequelize } from '../config/sequelize';
import User from '../models/User';
import UserAction, { ActionType } from '../models/UserAction';
import UserSignal, { SignalType } from '../models/UserSignal';

const DEFAULT_EVENTS = [
    'profile_click',
    'search_query',
    'hashtag_click',
    'open_link',
    'follow',
    'unfollow',
];

type CliOptions = {
    user: string;
    since?: Date;
    limit: number;
};

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    const getValue = (flag: string): string | undefined => {
        const direct = args.find((arg) => arg.startsWith(`${flag}=`));
        if (direct) return direct.slice(flag.length + 1);
        const index = args.indexOf(flag);
        return index >= 0 ? args[index + 1] : undefined;
    };

    const user = getValue('--user') || 'demo_interviewer';
    const sinceRaw = getValue('--since');
    const limitRaw = Number(getValue('--limit') || 5);
    const since = sinceRaw ? new Date(sinceRaw) : undefined;

    if (sinceRaw && (!since || Number.isNaN(since.getTime()))) {
        throw new Error(`Invalid --since value: ${sinceRaw}`);
    }

    return {
        user,
        since,
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.floor(limitRaw)) : 5,
    };
}

function buildTimeFilter(since?: Date) {
    return since ? { $gte: since } : undefined;
}

function redactDoc(doc: any) {
    return {
        type: doc.action || doc.signalType,
        targetId: doc.targetId ? String(doc.targetId) : undefined,
        targetPostId: doc.targetPostId ? String(doc.targetPostId) : undefined,
        targetAuthorId: doc.targetAuthorId,
        targetType: doc.targetType,
        productSurface: doc.productSurface,
        targetKeywords: doc.targetKeywords || doc.metadata?.targetKeywords,
        requestId: doc.requestId,
        timestamp: doc.timestamp,
    };
}

async function main() {
    const options = parseArgs();
    await sequelize.authenticate();
    await connectMongoDB();

    const user = await User.findOne({
        where: { username: options.user },
        attributes: ['id', 'username'],
    });
    if (!user) {
        throw new Error(`User not found: ${options.user}`);
    }

    const userId = String(user.id);
    const timestampFilter = buildTimeFilter(options.since);
    const actionFilter = {
        userId,
        action: {
            $in: [
                ActionType.PROFILE_CLICK,
                ActionType.SEARCH_QUERY,
                ActionType.HASHTAG_CLICK,
                ActionType.OPEN_LINK,
            ],
        },
        ...(timestampFilter ? { timestamp: timestampFilter } : {}),
    };
    const signalFilter = {
        userId,
        signalType: {
            $in: [
                SignalType.PROFILE_CLICK,
                SignalType.SEARCH_QUERY,
                SignalType.HASHTAG_CLICK,
                SignalType.OPEN_LINK,
                SignalType.FOLLOW,
                SignalType.UNFOLLOW,
            ],
        },
        ...(timestampFilter ? { timestamp: timestampFilter } : {}),
    };

    const [actionCounts, signalCounts, signalTargetTypes, recentActions, recentSignals] = await Promise.all([
        UserAction.aggregate([
            { $match: actionFilter },
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
        UserSignal.aggregate([
            { $match: signalFilter },
            { $group: { _id: '$signalType', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
        UserSignal.aggregate([
            { $match: signalFilter },
            { $group: { _id: '$targetType', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
        UserAction.find(actionFilter).sort({ timestamp: -1 }).limit(options.limit).lean(),
        UserSignal.find(signalFilter).sort({ timestamp: -1 }).limit(options.limit).lean(),
    ]);

    console.log(JSON.stringify({
        user: {
            id: userId,
            username: user.username,
        },
        since: options.since?.toISOString() || null,
        expectedEvents: DEFAULT_EVENTS,
        userActions: {
            counts: Object.fromEntries(actionCounts.map((entry) => [entry._id, entry.count])),
            recent: recentActions.map(redactDoc),
        },
        userSignals: {
            counts: Object.fromEntries(signalCounts.map((entry) => [entry._id, entry.count])),
            targetTypes: Object.fromEntries(signalTargetTypes.map((entry) => [entry._id, entry.count])),
            recent: recentSignals.map(redactDoc),
        },
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
        }));
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
        } catch {
            // best effort
        }
        await sequelize.close().catch(() => undefined);
    });
