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

import RecommendationTrace from '../models/RecommendationTrace';
import UserAction, { ActionType } from '../models/UserAction';
import {
    type RecommendationDecisionLogV1,
    recommendationDecisionLogSchema,
} from '../services/recommendation/decisionLog/contracts';
import { attributeOutcomeV1 } from '../services/recommendation/outcomes/outcomeContractV1';
import type { ReplayCandidateLabelSummary, ReplayRequestSnapshot } from '../services/recommendation/replay/contracts';
import {
    connectReadOnlyMongo,
    disconnectReadOnlyMongo,
} from '../services/recommendation/training/readOnlyMongo';
import { LABEL_ACTION_TYPES } from '../services/recommendation/utils/actionLabels';

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

function normalizeStringArray(value?: string[]): string[] {
    return Array.isArray(value)
        ? value.map((entry) => entry.trim()).filter(Boolean)
        : [];
}

function feedbackLabel(labels: ReplayCandidateLabelSummary): 'positive' | 'negative' | null {
    if (labels.negative) return 'negative';
    if (labels.engagement || labels.click || labels.dwellTimeMs > 0) return 'positive';
    return null;
}

type DecisionAction = RecommendationDecisionLogV1['actions'][number];

function candidateMatchesAction(candidate: any, action: DecisionAction): boolean {
    return action.actionKey.candidateNamespace === 'serving_post_id'
        ? idToString(candidate.postId) === action.actionKey.candidateId
        : candidate.modelPostId === action.actionKey.candidateId;
}

function actionKey(action: DecisionAction): string {
    return [
        action.actionKey.candidateNamespace,
        action.actionKey.candidateId,
        action.actionKey.servedPosition,
    ].join(':');
}

async function main() {
    const args = parseArgs();
    const now = new Date();
    const since = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
    const windowMs = args.windowHours * 60 * 60 * 1000;

    await connectReadOnlyMongo();

    const traceQuery: Record<string, unknown> = {
        'decisionLogV1.decisionAt': {
            $gte: since.toISOString(),
            $lte: now.toISOString(),
        },
    };
    if (args.surface) traceQuery.productSurface = args.surface;
    if (args.experimentKey) traceQuery.experimentKeys = args.experimentKey;
    if (args.pipeline) traceQuery.pipeline = args.pipeline;

    const traceCursor = RecommendationTrace.find(traceQuery)
        .select(
            'requestId userId productSurface decisionLogV1 pipeline pipelineVersion traceVersion owner fallbackMode degradedReasons selectedCount inNetworkCount outOfNetworkCount sourceCounts authorDiversity replyRatio averageScore topScore bottomScore experimentKeys userState embeddingQualityScore shadowComparison candidates replayPool',
        )
        .sort({ 'decisionLogV1.decisionAt': -1 });
    if (args.limit > 0) {
        traceCursor.limit(args.limit);
    }

    const traceDocs = (await traceCursor.lean()).slice().reverse();
    const traces = traceDocs.flatMap((trace: any) => {
        const parsed = recommendationDecisionLogSchema.safeParse(trace.decisionLogV1);
        if (!parsed.success) return [];
        const decisionAtMs = Date.parse(parsed.data.decisionAt);
        if (decisionAtMs < since.getTime() || decisionAtMs > now.getTime()) return [];
        return [{ trace, decision: parsed.data }];
    });

    if (traces.length === 0) {
        console.log('[ExportRecsysReplay] no traces found for filters');
        return;
    }

    const decisionIds = traces.map(({ decision }) => decision.decisionId).sort();
    const minDecisionAt = new Date(Math.min(
        ...traces.map(({ decision }) => Date.parse(decision.decisionAt)),
    ));
    const outcomeActions = await UserAction.find({
        'metadata.decisionId': { $in: decisionIds },
        action: { $in: [ActionType.IMPRESSION, ...LABEL_ACTION_TYPES] },
        timestamp: { $gte: minDecisionAt, $lte: now },
    })
        .select('metadata rank requestId userId action timestamp dwellTimeMs')
        .lean();

    const actionsByDecisionId = new Map<string, Array<Record<string, any>>>();
    for (const action of outcomeActions) {
        const decisionId = action.metadata?.decisionId;
        if (!decisionId) continue;
        const bucket = actionsByDecisionId.get(decisionId) || [];
        bucket.push(action);
        actionsByDecisionId.set(decisionId, bucket);
    }

    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    let exportedRequests = 0;
    let exportedCandidates = 0;

    for (const { trace, decision } of traces) {
        const traceCandidates = (trace.replayPool?.candidates || trace.candidates || []) as any[];
        const outcomesByActionKey = new Map(decision.actions.map((servedAction) => [
            actionKey(servedAction),
            attributeOutcomeV1({
                decisionLog: decision,
                servedAction,
                traceUserId: trace.userId,
                events: actionsByDecisionId.get(decision.decisionId) || [],
                observedThrough: now,
                horizonMs: windowMs,
            }),
        ]));
        const replayCandidates = traceCandidates.reduce<ReplayRequestSnapshot['candidates']>(
            (acc, candidate: any) => {
                const postId = idToString(candidate.postId);
                if (!postId) return acc;
                const servedAction = decision.actions.find((action) => (
                    candidateMatchesAction(candidate, action)
                ));
                const outcomeContractV1 = servedAction
                    ? outcomesByActionKey.get(actionKey(servedAction))
                    : undefined;
                const labels = outcomeContractV1?.status === 'observed'
                    ? outcomeContractV1.labels
                    : undefined;
                const replayCandidate = {
                    requestId: decision.requestId,
                    postId,
                    modelPostId: candidate.modelPostId || '',
                    authorId: candidate.authorId,
                    rank: finiteNumberOrMissing(candidate.rank),
                    baselineRank: finiteNumberOrMissing(candidate.rank),
                    recallSource: candidate.recallSource || '',
                    secondaryRecallSources: normalizeStringArray(candidate.secondaryRecallSources),
                    selectionPool: candidate.selectionPool || '',
                    selectionReason: candidate.selectionReason || '',
                    inNetwork: candidate.inNetwork === true,
                    isNews: candidate.isNews === true,
                    score: candidate.score ?? null,
                    weightedScore: candidate.weightedScore ?? null,
                    experimentKeys: normalizeStringArray(candidate.experimentKeys || trace.experimentKeys),
                    productSurface: trace.productSurface || 'space_feed',
                    pipelineScore: candidate.pipelineScore ?? null,
                    scoreBreakdown: candidate.scoreBreakdown || undefined,
                    recommendationDetail: candidate.recommendationDetail || undefined,
                    sourceReason: candidate.sourceReason || undefined,
                    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : undefined,
                    explainSignals: candidate.explainSignals || undefined,
                    createdAt: candidate.createdAt
                        ? new Date(candidate.createdAt).toISOString()
                        : undefined,
                    ...(outcomeContractV1 ? { outcomeContractV1 } : {}),
                    ...(labels ? {
                        feedbackLabel: feedbackLabel(labels),
                        labels,
                    } : {}),
                };
                acc.push(replayCandidate);
                return acc;
            },
            [],
        );
        const replayRequest: ReplayRequestSnapshot = {
            requestId: decision.requestId,
            decisionId: decision.decisionId,
            userId: trace.userId,
            requestAt: decision.decisionAt,
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

function finiteNumberOrMissing(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

main()
    .catch((error) => {
        console.error('[ExportRecsysReplay] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await disconnectReadOnlyMongo();
        } catch {
            // ignore
        }
    });
