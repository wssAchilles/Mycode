/**
 * 基于导出的推荐训练样本做最小离线评估。
 *
 * 用法：
 *   npx ts-node src/scripts/evaluateRecsysTrainingSamples.ts --input ./tmp/recsys_samples.ndjson --topK 10
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

import {
    loadSocialPhoenixModel,
    scoreTaskProbability,
    type SocialPhoenixFeatureMap,
} from '../services/recommendation/socialPhoenix';

type SampleRow = {
    requestId: string;
    postId?: string;
    rank?: number | null;
    targetAuthorId?: string;
    recallSource?: string;
    inNetwork?: boolean;
    userState?: string;
    weightedScore?: number | null;
    labelClick?: number;
    labelEngagement?: number;
    labelNegative?: number;
    requestPipeline?: string;
    requestOwner?: string;
    requestFallbackMode?: string;
    requestSourceCounts?: Array<{ source: string; count: number }>;
    requestAuthorDiversity?: number | null;
    requestReplyRatio?: number | null;
    requestAverageScore?: number | null;
    requestShadowOverlapRatio?: number | null;
    trainingFeatures?: SocialPhoenixFeatureMap;
};

type RequestAggregate = {
    requestId: string;
    rows: SampleRow[];
};

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

    return {
        input: kv.input || './tmp/recsys_samples.ndjson',
        topK: Math.max(1, parseInt(kv.topK || '10', 10) || 10),
        model: kv.model || '',
    };
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`input_not_found:${inputPath}`);
    }

    const requests = new Map<string, RequestAggregate>();
    const learnedModel = loadSocialPhoenixModel(args.model || undefined);
    const stream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed) as SampleRow;
        if (!row.requestId) continue;
        const request = requests.get(row.requestId) || { requestId: row.requestId, rows: [] };
        request.rows.push(row);
        requests.set(row.requestId, request);
    }

    const summary = {
        requests: requests.size,
        rows: 0,
        baseline: {
            clickHitRateAtK: 0,
            engagementHitRateAtK: 0,
            negativeHitRateAtK: 0,
            averageAuthorDiversityAtK: 0,
            averageOonRatioAtK: 0,
            averageNdcgAtK: 0,
            averageMrrAtK: 0,
            averageRecallAtK: 0,
            averageNegativeRateAtK: 0,
        },
        learned: learnedModel
            ? {
                clickHitRateAtK: 0,
                engagementHitRateAtK: 0,
                negativeHitRateAtK: 0,
                averageAuthorDiversityAtK: 0,
                averageOonRatioAtK: 0,
                averageNdcgAtK: 0,
                averageMrrAtK: 0,
                averageRecallAtK: 0,
                averageNegativeRateAtK: 0,
                averageOverlapAtK: 0,
            }
            : undefined,
        traceCoverage: {
            requestsWithTrace: 0,
            ratio: 0,
            averageAuthorDiversity: 0,
            averageReplyRatio: 0,
            averageScore: 0,
            requestsWithShadow: 0,
            shadowRatio: 0,
            averageShadowOverlapRatio: 0,
        },
        bySource: {} as Record<string, { rows: number; engagementRate: number; clickRate: number }>,
        byUserState: {} as Record<string, { requests: number; engagementHitRateAtK: number; averageOonRatioAtK: number }>,
        byPipeline: {} as Record<string, { requests: number; engagementHitRateAtK: number; averageOonRatioAtK: number }>,
    };

    let baselineClickHits = 0;
    let baselineEngagementHits = 0;
    let baselineNegativeHits = 0;
    let baselineAuthorDiversitySum = 0;
    let baselineOonRatioSum = 0;
    let baselineNdcgSum = 0;
    let baselineMrrSum = 0;
    let baselineRecallSum = 0;
    let baselineNegativeRateSum = 0;
    let learnedClickHits = 0;
    let learnedEngagementHits = 0;
    let learnedNegativeHits = 0;
    let learnedAuthorDiversitySum = 0;
    let learnedOonRatioSum = 0;
    let learnedNdcgSum = 0;
    let learnedMrrSum = 0;
    let learnedRecallSum = 0;
    let learnedNegativeRateSum = 0;
    let learnedOverlapSum = 0;
    let traceAuthorDiversitySum = 0;
    let traceReplyRatioSum = 0;
    let traceAverageScoreSum = 0;
    let traceShadowOverlapSum = 0;

    for (const request of requests.values()) {
        const requestRows = request.rows.slice();
        const rows = requestRows
            .slice()
            .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
            .slice(0, args.topK);
        if (rows.length === 0) continue;

        summary.rows += rows.length;
        const baselineMetrics = summarizeTopRows(rows, requestRows, args.topK);
        const userState = baselineMetrics.userState;
        const traceRow = requestRows.find((row) => row.requestSourceCounts && row.requestSourceCounts.length > 0);
        if (traceRow) {
            summary.traceCoverage.requestsWithTrace += 1;
            traceAuthorDiversitySum += Number(traceRow.requestAuthorDiversity || 0);
            traceReplyRatioSum += Number(traceRow.requestReplyRatio || 0);
            traceAverageScoreSum += Number(traceRow.requestAverageScore || 0);
            if (typeof traceRow.requestShadowOverlapRatio === 'number') {
                summary.traceCoverage.requestsWithShadow += 1;
                traceShadowOverlapSum += Number(traceRow.requestShadowOverlapRatio || 0);
            }
        }
        const pipelineKey = traceRow?.requestPipeline || rows[0]?.requestPipeline || '__unknown__';
        const pipelineSummary = summary.byPipeline[pipelineKey] || {
            requests: 0,
            engagementHitRateAtK: 0,
            averageOonRatioAtK: 0,
        };
        pipelineSummary.requests += 1;
        pipelineSummary.engagementHitRateAtK += baselineMetrics.hasEngagement ? 1 : 0;
        pipelineSummary.averageOonRatioAtK += baselineMetrics.oonRatio;
        summary.byPipeline[pipelineKey] = pipelineSummary;

        if (baselineMetrics.hasClick) baselineClickHits += 1;
        if (baselineMetrics.hasEngagement) baselineEngagementHits += 1;
        if (baselineMetrics.hasNegative) baselineNegativeHits += 1;
        baselineAuthorDiversitySum += baselineMetrics.authorDiversity;
        baselineOonRatioSum += baselineMetrics.oonRatio;
        baselineNdcgSum += baselineMetrics.ndcgAtK;
        baselineMrrSum += baselineMetrics.mrrAtK;
        baselineRecallSum += baselineMetrics.recallAtK;
        baselineNegativeRateSum += baselineMetrics.negativeRateAtK;

        const userStateSummary = summary.byUserState[userState] || {
            requests: 0,
            engagementHitRateAtK: 0,
            averageOonRatioAtK: 0,
        };
        userStateSummary.requests += 1;
        userStateSummary.engagementHitRateAtK += baselineMetrics.hasEngagement ? 1 : 0;
        userStateSummary.averageOonRatioAtK += baselineMetrics.oonRatio;
        summary.byUserState[userState] = userStateSummary;

        for (const row of rows) {
            const source = row.recallSource || 'unknown';
            const sourceSummary = summary.bySource[source] || {
                rows: 0,
                engagementRate: 0,
                clickRate: 0,
            };
            sourceSummary.rows += 1;
            sourceSummary.engagementRate += Number(row.labelEngagement || 0) > 0 ? 1 : 0;
            sourceSummary.clickRate += Number(row.labelClick || 0) > 0 ? 1 : 0;
            summary.bySource[source] = sourceSummary;
        }

        if (learnedModel) {
            const learnedRows = request.rows
                .slice()
                .map((row) => ({
                    ...row,
                    __learnedScore: computeLearnedScore(learnedModel, row),
                }))
                .sort((left, right) => (right.__learnedScore || 0) - (left.__learnedScore || 0))
                .slice(0, args.topK);
            const learnedMetrics = summarizeTopRows(learnedRows, requestRows, args.topK);
            if (learnedMetrics.hasClick) learnedClickHits += 1;
            if (learnedMetrics.hasEngagement) learnedEngagementHits += 1;
            if (learnedMetrics.hasNegative) learnedNegativeHits += 1;
            learnedAuthorDiversitySum += learnedMetrics.authorDiversity;
            learnedOonRatioSum += learnedMetrics.oonRatio;
            learnedNdcgSum += learnedMetrics.ndcgAtK;
            learnedMrrSum += learnedMetrics.mrrAtK;
            learnedRecallSum += learnedMetrics.recallAtK;
            learnedNegativeRateSum += learnedMetrics.negativeRateAtK;
            learnedOverlapSum += overlapRatio(rows, learnedRows);
        }
    }

    summary.baseline.clickHitRateAtK = baselineClickHits / Math.max(1, requests.size);
    summary.baseline.engagementHitRateAtK = baselineEngagementHits / Math.max(1, requests.size);
    summary.baseline.negativeHitRateAtK = baselineNegativeHits / Math.max(1, requests.size);
    summary.baseline.averageAuthorDiversityAtK = baselineAuthorDiversitySum / Math.max(1, requests.size);
    summary.baseline.averageOonRatioAtK = baselineOonRatioSum / Math.max(1, requests.size);
    summary.baseline.averageNdcgAtK = baselineNdcgSum / Math.max(1, requests.size);
    summary.baseline.averageMrrAtK = baselineMrrSum / Math.max(1, requests.size);
    summary.baseline.averageRecallAtK = baselineRecallSum / Math.max(1, requests.size);
    summary.baseline.averageNegativeRateAtK = baselineNegativeRateSum / Math.max(1, requests.size);

    if (summary.learned) {
        summary.learned.clickHitRateAtK = learnedClickHits / Math.max(1, requests.size);
        summary.learned.engagementHitRateAtK = learnedEngagementHits / Math.max(1, requests.size);
        summary.learned.negativeHitRateAtK = learnedNegativeHits / Math.max(1, requests.size);
        summary.learned.averageAuthorDiversityAtK = learnedAuthorDiversitySum / Math.max(1, requests.size);
        summary.learned.averageOonRatioAtK = learnedOonRatioSum / Math.max(1, requests.size);
        summary.learned.averageNdcgAtK = learnedNdcgSum / Math.max(1, requests.size);
        summary.learned.averageMrrAtK = learnedMrrSum / Math.max(1, requests.size);
        summary.learned.averageRecallAtK = learnedRecallSum / Math.max(1, requests.size);
        summary.learned.averageNegativeRateAtK = learnedNegativeRateSum / Math.max(1, requests.size);
        summary.learned.averageOverlapAtK = learnedOverlapSum / Math.max(1, requests.size);
    }

    summary.traceCoverage.ratio = summary.traceCoverage.requestsWithTrace / Math.max(1, requests.size);
    summary.traceCoverage.averageAuthorDiversity =
        traceAuthorDiversitySum / Math.max(1, summary.traceCoverage.requestsWithTrace);
    summary.traceCoverage.averageReplyRatio =
        traceReplyRatioSum / Math.max(1, summary.traceCoverage.requestsWithTrace);
    summary.traceCoverage.averageScore =
        traceAverageScoreSum / Math.max(1, summary.traceCoverage.requestsWithTrace);
    summary.traceCoverage.shadowRatio =
        summary.traceCoverage.requestsWithShadow / Math.max(1, requests.size);
    summary.traceCoverage.averageShadowOverlapRatio =
        traceShadowOverlapSum / Math.max(1, summary.traceCoverage.requestsWithShadow);

    for (const source of Object.keys(summary.bySource)) {
        summary.bySource[source].engagementRate =
            summary.bySource[source].engagementRate / Math.max(1, summary.bySource[source].rows);
        summary.bySource[source].clickRate =
            summary.bySource[source].clickRate / Math.max(1, summary.bySource[source].rows);
    }

    for (const state of Object.keys(summary.byUserState)) {
        summary.byUserState[state].engagementHitRateAtK =
            summary.byUserState[state].engagementHitRateAtK /
            Math.max(1, summary.byUserState[state].requests);
        summary.byUserState[state].averageOonRatioAtK =
            summary.byUserState[state].averageOonRatioAtK /
            Math.max(1, summary.byUserState[state].requests);
    }

    for (const pipeline of Object.keys(summary.byPipeline)) {
        summary.byPipeline[pipeline].engagementHitRateAtK =
            summary.byPipeline[pipeline].engagementHitRateAtK /
            Math.max(1, summary.byPipeline[pipeline].requests);
        summary.byPipeline[pipeline].averageOonRatioAtK =
            summary.byPipeline[pipeline].averageOonRatioAtK /
            Math.max(1, summary.byPipeline[pipeline].requests);
    }

    console.log(JSON.stringify(summary, null, 2));
}

function computeLearnedScore(model: NonNullable<ReturnType<typeof loadSocialPhoenixModel>>, row: SampleRow): number {
    if (!row.trainingFeatures) {
        return Number(row.weightedScore || 0);
    }

    return (
        scoreTaskProbability(model, 'click', row.trainingFeatures) * 0.24 +
        scoreTaskProbability(model, 'engagement', row.trainingFeatures) * 0.28 +
        scoreTaskProbability(model, 'like', row.trainingFeatures) * 0.14 +
        scoreTaskProbability(model, 'reply', row.trainingFeatures) * 0.16 +
        scoreTaskProbability(model, 'repost', row.trainingFeatures) * 0.08 +
        scoreTaskProbability(model, 'quote', row.trainingFeatures) * 0.06 +
        scoreTaskProbability(model, 'share', row.trainingFeatures) * 0.04 -
        scoreTaskProbability(model, 'negative', row.trainingFeatures) * 0.18
    );
}

function summarizeTopRows(rows: SampleRow[], allRows: SampleRow[], topK: number) {
    const hasClick = rows.some((row) => Number(row.labelClick || 0) > 0);
    const hasEngagement = rows.some((row) => Number(row.labelEngagement || 0) > 0);
    const hasNegative = rows.some((row) => Number(row.labelNegative || 0) > 0);
    const uniqueAuthors = new Set(rows.map((row) => row.targetAuthorId).filter(Boolean));
    const oonRatio = rows.filter((row) => row.inNetwork === false).length / Math.max(1, rows.length);
    const totalRelevant = allRows.filter((row) => Number(row.labelEngagement || 0) > 0).length;
    return {
        hasClick,
        hasEngagement,
        hasNegative,
        authorDiversity: uniqueAuthors.size / Math.max(1, rows.length),
        oonRatio,
        ndcgAtK: ndcgAtK(rows, allRows, topK),
        mrrAtK: mrrAtK(rows),
        recallAtK: totalRelevant > 0
            ? rows.filter((row) => Number(row.labelEngagement || 0) > 0).length / totalRelevant
            : 0,
        negativeRateAtK: rows.filter((row) => Number(row.labelNegative || 0) > 0).length / Math.max(1, rows.length),
        userState: rows[0]?.userState || 'unknown',
    };
}

function ndcgAtK(rows: SampleRow[], allRows: SampleRow[], topK: number): number {
    const dcg = discountedGain(rows.slice(0, topK));
    const idealRows = allRows
        .slice()
        .sort((left, right) =>
            Number(right.labelEngagement || 0) - Number(left.labelEngagement || 0)
            || Number(right.labelClick || 0) - Number(left.labelClick || 0),
        )
        .slice(0, topK);
    const idcg = discountedGain(idealRows);
    return idcg > 0 ? dcg / idcg : 0;
}

function discountedGain(rows: SampleRow[]): number {
    return rows.reduce((sum, row, index) => {
        const relevance = Number(row.labelEngagement || 0) > 0 ? 1 : 0;
        return sum + relevance / Math.log2(index + 2);
    }, 0);
}

function mrrAtK(rows: SampleRow[]): number {
    const firstRelevantIndex = rows.findIndex((row) => Number(row.labelEngagement || 0) > 0);
    return firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;
}

function overlapRatio(left: SampleRow[], right: SampleRow[]): number {
    const leftKeys = new Set(left.map((row) => `${row.requestId}:${row.postId || ''}`));
    const rightKeys = new Set(right.map((row) => `${row.requestId}:${row.postId || ''}`));
    let overlap = 0;
    for (const key of leftKeys) {
        if (rightKeys.has(key)) overlap += 1;
    }
    return overlap / Math.max(1, Math.min(left.length, right.length));
}

main().catch((error) => {
    console.error('[EvaluateRecsysSamples] failed:', error);
    process.exitCode = 1;
});
