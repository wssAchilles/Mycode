/**
 * Recall Source 报表脚本（工业化可观测）
 *
 * 目标：
 * - 输出 recallSource 维度的曝光占比、互动率、负反馈率
 * - 输出 experimentKey + recallSource 维度明细，便于实验桶对比
 *
 * 用法：
 *   npx ts-node src/scripts/reportRecallSourceMetrics.ts --days 14 --windowHours 24
 *   npx ts-node src/scripts/reportRecallSourceMetrics.ts --experimentKey space_feed_recsys_alignment:treatment --output ./tmp/recall_report.json
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
    output?: string;
};

type ImpressionRecord = {
    userId: string;
    targetPostId?: any;
    timestamp: Date;
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

type Aggregate = {
    impressions: number;
    engagements: number;
    negatives: number;
    clicks: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    shares: number;
    dismisses: number;
    blocks: number;
    reports: number;
    dwellTimeMsTotal: number;
    users: Set<string>;
};

type Row = {
    key: string;
    recallSource: string;
    experimentKey?: string;
    impressions: number;
    impressionShare: number;
    uniqueUsers: number;
    engagementRate: number;
    negativeRate: number;
    clickRate: number;
    likeRate: number;
    replyRate: number;
    repostRate: number;
    quoteRate: number;
    shareRate: number;
    dismissRate: number;
    blockRate: number;
    reportRate: number;
    avgDwellMs: number;
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

    const days = Math.max(1, parseInt(kv.days || '14', 10) || 14);
    const windowHours = Math.max(1, parseInt(kv.windowHours || '24', 10) || 24);

    return {
        days,
        windowHours,
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        recallSource: kv.recallSource || undefined,
        output: kv.output || undefined,
    };
}

function idToString(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id instanceof mongoose.Types.ObjectId) return id.toString();
    if (typeof id.toString === 'function') return id.toString();
    return '';
}

function actionMapKey(userId: string, postId: string): string {
    return `${userId}:${postId}`;
}

function safeRate(n: number, d: number): number {
    return d > 0 ? n / d : 0;
}

function createAggregate(): Aggregate {
    return {
        impressions: 0,
        engagements: 0,
        negatives: 0,
        clicks: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: 0,
        dismisses: 0,
        blocks: 0,
        reports: 0,
        dwellTimeMsTotal: 0,
        users: new Set<string>(),
    };
}

function updateAggregate(agg: Aggregate, impressionUserId: string, labels: ReturnType<typeof summarizeActionsInWindow>) {
    agg.impressions += 1;
    agg.users.add(impressionUserId);

    if (labels.engagement) agg.engagements += 1;
    if (labels.negative) agg.negatives += 1;
    if (labels.click) agg.clicks += 1;
    if (labels.like) agg.likes += 1;
    if (labels.reply) agg.replies += 1;
    if (labels.repost) agg.reposts += 1;
    if (labels.quote) agg.quotes += 1;
    if (labels.share) agg.shares += 1;
    if (labels.dismiss) agg.dismisses += 1;
    if (labels.blockAuthor) agg.blocks += 1;
    if (labels.report) agg.reports += 1;
    agg.dwellTimeMsTotal += labels.dwellTimeMs;
}

function toRows(map: Map<string, Aggregate>, totalImpressions: number, isExperimentDim: boolean): Row[] {
    const rows: Row[] = [];

    for (const [key, agg] of map.entries()) {
        const [experimentKey, recallSource] = isExperimentDim
            ? key.split('||', 2)
            : [undefined, key];

        rows.push({
            key,
            recallSource: recallSource || 'unknown',
            experimentKey,
            impressions: agg.impressions,
            impressionShare: safeRate(agg.impressions, totalImpressions),
            uniqueUsers: agg.users.size,
            engagementRate: safeRate(agg.engagements, agg.impressions),
            negativeRate: safeRate(agg.negatives, agg.impressions),
            clickRate: safeRate(agg.clicks, agg.impressions),
            likeRate: safeRate(agg.likes, agg.impressions),
            replyRate: safeRate(agg.replies, agg.impressions),
            repostRate: safeRate(agg.reposts, agg.impressions),
            quoteRate: safeRate(agg.quotes, agg.impressions),
            shareRate: safeRate(agg.shares, agg.impressions),
            dismissRate: safeRate(agg.dismisses, agg.impressions),
            blockRate: safeRate(agg.blocks, agg.impressions),
            reportRate: safeRate(agg.reports, agg.impressions),
            avgDwellMs: safeRate(agg.dwellTimeMsTotal, agg.impressions),
        });
    }

    return rows.sort((a, b) => b.impressions - a.impressions);
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

    const impressions = (await UserAction.find(impressionQuery)
        .select('userId targetPostId timestamp recallSource experimentKeys')
        .sort({ timestamp: 1 })
        .lean()) as ImpressionRecord[];

    if (impressions.length === 0) {
        console.log('[RecallSourceReport] no impressions found for filters');
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

    const followupByKey = new Map<string, FollowUpRecord[]>();
    for (const action of followups) {
        const postId = idToString(action.targetPostId);
        if (!postId) continue;
        const key = actionMapKey(action.userId, postId);
        const arr = followupByKey.get(key) || [];
        arr.push(action);
        followupByKey.set(key, arr);
    }
    for (const arr of followupByKey.values()) {
        arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    const globalAgg = new Map<string, Aggregate>();
    const experimentAgg = new Map<string, Aggregate>();

    for (const imp of impressions) {
        const postId = idToString(imp.targetPostId);
        if (!postId) continue;

        const key = actionMapKey(imp.userId, postId);
        const labels = summarizeActionsInWindow(
            imp.timestamp,
            (followupByKey.get(key) || []).map((a) => ({
                action: a.action,
                timestamp: a.timestamp,
                dwellTimeMs: a.dwellTimeMs,
            })),
            windowMs
        );

        const recallSource = imp.recallSource || 'unknown';
        const agg = globalAgg.get(recallSource) || createAggregate();
        updateAggregate(agg, imp.userId, labels);
        globalAgg.set(recallSource, agg);

        const experimentKeys = imp.experimentKeys && imp.experimentKeys.length > 0
            ? imp.experimentKeys
            : ['__none__'];
        for (const expKey of experimentKeys) {
            const dimKey = `${expKey}||${recallSource}`;
            const expAgg = experimentAgg.get(dimKey) || createAggregate();
            updateAggregate(expAgg, imp.userId, labels);
            experimentAgg.set(dimKey, expAgg);
        }
    }

    const globalRows = toRows(globalAgg, impressions.length, false);
    const experimentRows = toRows(experimentAgg, impressions.length, true);

    console.log('\n[RecallSourceReport] Global by recallSource');
    console.table(
        globalRows.map((r) => ({
            recallSource: r.recallSource,
            impressions: r.impressions,
            impressionShare: Number((r.impressionShare * 100).toFixed(2)),
            engagementRate: Number((r.engagementRate * 100).toFixed(2)),
            negativeRate: Number((r.negativeRate * 100).toFixed(2)),
            clickRate: Number((r.clickRate * 100).toFixed(2)),
        }))
    );

    const experimentRowsNoNone = experimentRows.filter((r) => r.experimentKey !== '__none__');
    if (experimentRowsNoNone.length > 0) {
        console.log('\n[RecallSourceReport] By experimentKey + recallSource');
        console.table(
            experimentRowsNoNone.map((r) => ({
                experimentKey: r.experimentKey,
                recallSource: r.recallSource,
                impressions: r.impressions,
                engagementRate: Number((r.engagementRate * 100).toFixed(2)),
                negativeRate: Number((r.negativeRate * 100).toFixed(2)),
            }))
        );
    }

    if (args.output) {
        const outputPath = path.resolve(process.cwd(), args.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
            outputPath,
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    config: args,
                    windowHours: args.windowHours,
                    impressions: impressions.length,
                    followups: followups.length,
                    global: globalRows,
                    byExperiment: experimentRowsNoNone,
                },
                null,
                2
            ),
            'utf8'
        );
        console.log(`[RecallSourceReport] wrote ${outputPath}`);
    }
}

main()
    .catch((error) => {
        console.error('[RecallSourceReport] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    });
