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
        },
        learned: learnedModel
            ? {
                clickHitRateAtK: 0,
                engagementHitRateAtK: 0,
                negativeHitRateAtK: 0,
                averageAuthorDiversityAtK: 0,
                averageOonRatioAtK: 0,
                averageOverlapAtK: 0,
            }
            : undefined,
        bySource: {} as Record<string, { rows: number; engagementRate: number; clickRate: number }>,
        byUserState: {} as Record<string, { requests: number; engagementHitRateAtK: number; averageOonRatioAtK: number }>,
    };

    let baselineClickHits = 0;
    let baselineEngagementHits = 0;
    let baselineNegativeHits = 0;
    let baselineAuthorDiversitySum = 0;
    let baselineOonRatioSum = 0;
    let learnedClickHits = 0;
    let learnedEngagementHits = 0;
    let learnedNegativeHits = 0;
    let learnedAuthorDiversitySum = 0;
    let learnedOonRatioSum = 0;
    let learnedOverlapSum = 0;

    for (const request of requests.values()) {
        const rows = request.rows
            .slice()
            .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
            .slice(0, args.topK);
        if (rows.length === 0) continue;

        summary.rows += rows.length;
        const baselineMetrics = summarizeTopRows(rows);
        const userState = baselineMetrics.userState;

        if (baselineMetrics.hasClick) baselineClickHits += 1;
        if (baselineMetrics.hasEngagement) baselineEngagementHits += 1;
        if (baselineMetrics.hasNegative) baselineNegativeHits += 1;
        baselineAuthorDiversitySum += baselineMetrics.authorDiversity;
        baselineOonRatioSum += baselineMetrics.oonRatio;

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
            const learnedMetrics = summarizeTopRows(learnedRows);
            if (learnedMetrics.hasClick) learnedClickHits += 1;
            if (learnedMetrics.hasEngagement) learnedEngagementHits += 1;
            if (learnedMetrics.hasNegative) learnedNegativeHits += 1;
            learnedAuthorDiversitySum += learnedMetrics.authorDiversity;
            learnedOonRatioSum += learnedMetrics.oonRatio;
            learnedOverlapSum += overlapRatio(rows, learnedRows);
        }
    }

    summary.baseline.clickHitRateAtK = baselineClickHits / Math.max(1, requests.size);
    summary.baseline.engagementHitRateAtK = baselineEngagementHits / Math.max(1, requests.size);
    summary.baseline.negativeHitRateAtK = baselineNegativeHits / Math.max(1, requests.size);
    summary.baseline.averageAuthorDiversityAtK = baselineAuthorDiversitySum / Math.max(1, requests.size);
    summary.baseline.averageOonRatioAtK = baselineOonRatioSum / Math.max(1, requests.size);

    if (summary.learned) {
        summary.learned.clickHitRateAtK = learnedClickHits / Math.max(1, requests.size);
        summary.learned.engagementHitRateAtK = learnedEngagementHits / Math.max(1, requests.size);
        summary.learned.negativeHitRateAtK = learnedNegativeHits / Math.max(1, requests.size);
        summary.learned.averageAuthorDiversityAtK = learnedAuthorDiversitySum / Math.max(1, requests.size);
        summary.learned.averageOonRatioAtK = learnedOonRatioSum / Math.max(1, requests.size);
        summary.learned.averageOverlapAtK = learnedOverlapSum / Math.max(1, requests.size);
    }

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

function summarizeTopRows(rows: SampleRow[]) {
    const hasClick = rows.some((row) => Number(row.labelClick || 0) > 0);
    const hasEngagement = rows.some((row) => Number(row.labelEngagement || 0) > 0);
    const hasNegative = rows.some((row) => Number(row.labelNegative || 0) > 0);
    const uniqueAuthors = new Set(rows.map((row) => row.targetAuthorId).filter(Boolean));
    const oonRatio = rows.filter((row) => row.inNetwork === false).length / Math.max(1, rows.length);
    return {
        hasClick,
        hasEngagement,
        hasNegative,
        authorDiversity: uniqueAuthors.size / Math.max(1, rows.length),
        oonRatio,
        userState: rows[0]?.userState || 'unknown',
    };
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
