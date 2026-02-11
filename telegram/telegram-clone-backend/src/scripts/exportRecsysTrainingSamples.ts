/**
 * 导出推荐训练样本（基于 impression + action window）
 *
 * 用法：
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --days 30 --windowHours 24 --output ./tmp/recsys_samples.ndjson
 *   npx ts-node src/scripts/exportRecsysTrainingSamples.ts --experimentKey space_feed_recsys_alignment:treatment --limit 5000
 */

import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import UserAction, { ActionType } from '../models/UserAction';
import {
    LABEL_ACTION_TYPES,
    summarizeActionsInWindow,
} from '../services/recommendation/utils/actionLabels';

dotenv.config();

type Args = {
    days: number;
    windowHours: number;
    surface?: string;
    experimentKey?: string;
    recallSource?: string;
    output: string;
    limit: number;
};

type ImpressionRecord = {
    userId: string;
    targetPostId?: any;
    targetAuthorId?: string;
    requestId?: string;
    rank?: number;
    timestamp: Date;
    inNetwork?: boolean;
    isNews?: boolean;
    score?: number;
    weightedScore?: number;
    modelPostId?: string;
    recallSource?: string;
    experimentKeys?: string[];
};

type FollowUpRecord = {
    userId: string;
    targetPostId?: any;
    action: ActionType | string;
    timestamp: Date;
    dwellTimeMs?: number;
};

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = val;
    }

    const days = Math.max(1, parseInt(kv.days || '30', 10) || 30);
    const windowHours = Math.max(1, parseInt(kv.windowHours || '24', 10) || 24);
    const limit = Math.max(0, parseInt(kv.limit || '0', 10) || 0);

    return {
        days,
        windowHours,
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        recallSource: kv.recallSource || undefined,
        output: kv.output || './tmp/recsys_samples.ndjson',
        limit,
    };
}

function idToString(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id instanceof mongoose.Types.ObjectId) return id.toString();
    if (typeof id.toString === 'function') return id.toString();
    return '';
}

function mapKey(userId: string, postId: string): string {
    return `${userId}:${postId}`;
}

async function main() {
    const args = parseArgs();
    const now = new Date();
    const since = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
    const windowMs = args.windowHours * 60 * 60 * 1000;

    await connectMongoDB();

    const impressionQuery: Record<string, any> = {
        action: ActionType.IMPRESSION,
        timestamp: { $gte: since, $lte: now },
    };
    if (args.surface) impressionQuery.productSurface = args.surface;
    if (args.experimentKey) impressionQuery.experimentKeys = args.experimentKey;
    if (args.recallSource) impressionQuery.recallSource = args.recallSource;

    const impressionCursor = UserAction.find(impressionQuery)
        .select(
            'userId targetPostId targetAuthorId requestId rank timestamp inNetwork isNews score weightedScore modelPostId recallSource experimentKeys'
        )
        .sort({ timestamp: -1 });

    if (args.limit > 0) {
        impressionCursor.limit(args.limit);
    }

    const impressionDocs = (await impressionCursor.lean()) as ImpressionRecord[];
    const impressions = impressionDocs.slice().reverse();

    if (impressions.length === 0) {
        console.log('[ExportRecsysSamples] no impressions found for filters');
        return;
    }

    const postIds = Array.from(
        new Set(
            impressions.map((i) => idToString(i.targetPostId)).filter(Boolean)
        )
    )
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const userIds = Array.from(new Set(impressions.map((i) => i.userId)));

    const minImpressionAt = impressions[0].timestamp;
    const maxImpressionAt = impressions[impressions.length - 1].timestamp;
    const followupUntil = new Date(maxImpressionAt.getTime() + windowMs);

    const followups = (await UserAction.find({
        action: { $in: LABEL_ACTION_TYPES },
        userId: { $in: userIds },
        targetPostId: { $in: postIds },
        timestamp: { $gte: minImpressionAt, $lte: followupUntil },
    })
        .select('userId targetPostId action timestamp dwellTimeMs')
        .lean()) as FollowUpRecord[];

    const followupsByKey = new Map<string, FollowUpRecord[]>();
    for (const action of followups) {
        const postId = idToString(action.targetPostId);
        if (!postId) continue;
        const key = mapKey(action.userId, postId);
        const arr = followupsByKey.get(key) || [];
        arr.push(action);
        followupsByKey.set(key, arr);
    }

    for (const arr of followupsByKey.values()) {
        arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    let exported = 0;
    let positiveCount = 0;
    let negativeCount = 0;

    for (const imp of impressions) {
        const postId = idToString(imp.targetPostId);
        if (!postId) continue;

        const labels = summarizeActionsInWindow(
            imp.timestamp,
            (followupsByKey.get(mapKey(imp.userId, postId)) || []).map((a) => ({
                action: a.action,
                timestamp: a.timestamp,
                dwellTimeMs: a.dwellTimeMs,
            })),
            windowMs
        );

        const row = {
            userId: imp.userId,
            requestId: imp.requestId || '',
            postId,
            targetAuthorId: imp.targetAuthorId || '',
            impressionAt: new Date(imp.timestamp).toISOString(),
            rank: imp.rank ?? null,
            inNetwork: imp.inNetwork === true,
            isNews: imp.isNews === true,
            score: imp.score ?? null,
            weightedScore: imp.weightedScore ?? null,
            modelPostId: imp.modelPostId || '',
            recallSource: imp.recallSource || 'unknown',
            experimentKeys: imp.experimentKeys || [],
            windowHours: args.windowHours,
            labelClick: labels.click ? 1 : 0,
            labelLike: labels.like ? 1 : 0,
            labelReply: labels.reply ? 1 : 0,
            labelRepost: labels.repost ? 1 : 0,
            labelQuote: labels.quote ? 1 : 0,
            labelShare: labels.share ? 1 : 0,
            labelDismiss: labels.dismiss ? 1 : 0,
            labelBlockAuthor: labels.blockAuthor ? 1 : 0,
            labelReport: labels.report ? 1 : 0,
            labelEngagement: labels.engagement ? 1 : 0,
            labelNegative: labels.negative ? 1 : 0,
            labelDwellTimeMs: labels.dwellTimeMs,
        };

        out.write(`${JSON.stringify(row)}\n`);
        exported += 1;
        if (labels.engagement) positiveCount += 1;
        if (labels.negative) negativeCount += 1;
    }

    out.end();

    console.log(`[ExportRecsysSamples] exported=${exported}`);
    console.log(`[ExportRecsysSamples] engagementRate=${((positiveCount / Math.max(1, exported)) * 100).toFixed(2)}%`);
    console.log(`[ExportRecsysSamples] negativeRate=${((negativeCount / Math.max(1, exported)) * 100).toFixed(2)}%`);
    console.log(`[ExportRecsysSamples] wrote ${outputPath}`);
}

main()
    .catch((error) => {
        console.error('[ExportRecsysSamples] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    });
