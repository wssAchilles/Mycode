/**
 * 导出 request 级 replay 样本（基于 recommendation_traces + 行为窗口）。
 *
 * 用法：
 *   npx ts-node src/scripts/exportRecsysReplayRequests.ts --days 14 --windowHours 24 --output ./tmp/replay_requests.ndjson
 *   npx ts-node src/scripts/exportRecsysReplayRequests.ts --experimentKey space_feed_recsys_alignment:treatment --limit 2000
 */

import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import RecommendationTrace from '../models/RecommendationTrace';
import UserAction from '../models/UserAction';
import { LABEL_ACTION_TYPES, summarizeActionsInWindow } from '../services/recommendation/utils/actionLabels';
import type { ReplayCandidateLabelSummary, ReplayRequestSnapshot } from '../services/recommendation/replay/contracts';

dotenv.config();

type Args = {
    days: number;
    windowHours: number;
    surface?: string;
    experimentKey?: string;
    pipeline?: string;
    output: string;
    limit: number;
};

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }

    return {
        days: Math.max(1, parseInt(kv.days || '14', 10) || 14),
        windowHours: Math.max(1, parseInt(kv.windowHours || '24', 10) || 24),
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        pipeline: kv.pipeline || undefined,
        output: kv.output || './tmp/replay_requests.ndjson',
        limit: Math.max(0, parseInt(kv.limit || '0', 10) || 0),
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

    const traceQuery: Record<string, unknown> = {
        createdAt: { $gte: since, $lte: now },
    };
    if (args.surface) traceQuery.productSurface = args.surface;
    if (args.experimentKey) traceQuery.experimentKeys = args.experimentKey;
    if (args.pipeline) traceQuery.pipeline = args.pipeline;

    const traceCursor = RecommendationTrace.find(traceQuery)
        .select(
            'requestId userId productSurface pipeline pipelineVersion traceVersion owner fallbackMode degradedReasons selectedCount inNetworkCount outOfNetworkCount sourceCounts authorDiversity replyRatio averageScore topScore bottomScore experimentKeys userState embeddingQualityScore shadowComparison candidates replayPool createdAt',
        )
        .sort({ createdAt: -1 });
    if (args.limit > 0) {
        traceCursor.limit(args.limit);
    }

    const traceDocs = await traceCursor.lean();
    const traces = traceDocs.slice().reverse();

    if (traces.length === 0) {
        console.log('[ExportRecsysReplay] no traces found for filters');
        return;
    }

    const postIds = Array.from(new Set(
        traces
            .flatMap((trace: any) => (trace.replayPool?.candidates || trace.candidates || []))
            .map((candidate: any) => idToString(candidate.postId))
            .filter(Boolean),
    ))
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const userIds = Array.from(new Set(traces.map((trace: any) => trace.userId).filter(Boolean)));
    const minTraceAt = new Date(traces[0].createdAt);
    const maxTraceAt = new Date(traces[traces.length - 1].createdAt);
    const followupUntil = new Date(maxTraceAt.getTime() + windowMs);

    const followups = await UserAction.find({
        action: { $in: LABEL_ACTION_TYPES },
        userId: { $in: userIds },
        targetPostId: { $in: postIds },
        timestamp: { $gte: minTraceAt, $lte: followupUntil },
    })
        .select('userId targetPostId action timestamp dwellTimeMs')
        .lean();

    const followupsByKey = new Map<string, Array<Record<string, any>>>();
    for (const action of followups) {
        const postId = idToString(action.targetPostId);
        if (!postId) continue;
        const key = mapKey(action.userId, postId);
        const bucket = followupsByKey.get(key) || [];
        bucket.push(action);
        followupsByKey.set(key, bucket);
    }

    for (const bucket of followupsByKey.values()) {
        bucket.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    }

    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    let exportedRequests = 0;
    let exportedCandidates = 0;

    for (const trace of traces as any[]) {
        const requestAt = new Date(trace.createdAt);
        const traceCandidates = (trace.replayPool?.candidates || trace.candidates || []) as any[];
        const replayCandidates = traceCandidates.reduce<ReplayRequestSnapshot['candidates']>(
            (acc, candidate: any) => {
                const postId = idToString(candidate.postId);
                if (!postId) return acc;
                const candidateFollowups =
                    (followupsByKey.get(mapKey(trace.userId, postId)) || []) as Array<{
                        action: string;
                        timestamp: Date;
                        dwellTimeMs?: number;
                    }>;
                const labels = summarizeActionsInWindow(requestAt, candidateFollowups, windowMs);
                acc.push({
                    postId,
                    modelPostId: candidate.modelPostId || undefined,
                    authorId: candidate.authorId,
                    baselineRank: candidate.rank,
                    recallSource: candidate.recallSource || 'unknown',
                    inNetwork: candidate.inNetwork === true,
                    isNews: candidate.isNews === true,
                    score: candidate.score ?? null,
                    weightedScore: candidate.weightedScore ?? null,
                    pipelineScore: candidate.pipelineScore ?? null,
                    scoreBreakdown: candidate.scoreBreakdown || undefined,
                    recommendationDetail: candidate.recommendationDetail || undefined,
                    sourceReason: candidate.sourceReason || undefined,
                    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : undefined,
                    explainSignals: candidate.explainSignals || undefined,
                    createdAt: candidate.createdAt
                        ? new Date(candidate.createdAt).toISOString()
                        : undefined,
                    labels: toReplayLabels(labels),
                });
                return acc;
            },
            [],
        );
        const replayRequest: ReplayRequestSnapshot = {
            requestId: trace.requestId,
            userId: trace.userId,
            requestAt: requestAt.toISOString(),
            productSurface: trace.productSurface || 'space_feed',
            pipeline: trace.pipeline || undefined,
            pipelineVersion: trace.pipelineVersion || undefined,
            traceVersion: trace.traceVersion || undefined,
            owner: trace.owner || undefined,
            fallbackMode: trace.fallbackMode || undefined,
            degradedReasons: trace.degradedReasons || [],
            selectedCount: trace.selectedCount || 0,
            inNetworkCount: trace.inNetworkCount || 0,
            outOfNetworkCount: trace.outOfNetworkCount || 0,
            sourceCounts: trace.sourceCounts || [],
            authorDiversity: trace.authorDiversity || 0,
            replyRatio: trace.replyRatio || 0,
            averageScore: trace.averageScore || 0,
            topScore: trace.topScore ?? null,
            bottomScore: trace.bottomScore ?? null,
            experimentKeys: trace.experimentKeys || [],
            userState: trace.userState || undefined,
            embeddingQualityScore: trace.embeddingQualityScore ?? null,
            candidateSetKind: trace.replayPool?.poolKind || 'served_candidates_v1',
            candidateSetTotalCount: trace.replayPool?.totalCount ?? trace.candidates?.length ?? 0,
            candidateSetTruncated: trace.replayPool?.truncated === true,
            shadowComparison: trace.shadowComparison || undefined,
            candidates: replayCandidates,
        };

        out.write(`${JSON.stringify(replayRequest)}\n`);
        exportedRequests += 1;
        exportedCandidates += replayRequest.candidates.length;
    }

    out.end();

    console.log(`[ExportRecsysReplay] requests=${exportedRequests}`);
    console.log(`[ExportRecsysReplay] candidates=${exportedCandidates}`);
    console.log(`[ExportRecsysReplay] wrote ${outputPath}`);
}

function toReplayLabels(labels: ReturnType<typeof summarizeActionsInWindow>): ReplayCandidateLabelSummary {
    return {
        click: labels.click,
        like: labels.like,
        reply: labels.reply,
        repost: labels.repost,
        quote: labels.quote,
        share: labels.share,
        dismiss: labels.dismiss,
        blockAuthor: labels.blockAuthor,
        report: labels.report,
        engagement: labels.engagement,
        negative: labels.negative,
        dwellTimeMs: labels.dwellTimeMs,
    };
}

main()
    .catch((error) => {
        console.error('[ExportRecsysReplay] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    });
