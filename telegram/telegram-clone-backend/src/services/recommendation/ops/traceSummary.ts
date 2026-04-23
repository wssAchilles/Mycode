import RecommendationTrace from '../../../models/RecommendationTrace';

const DEFAULT_TRACE_SUMMARY_WINDOW_HOURS = Math.max(
    1,
    parseInt(String(process.env.RECOMMENDATION_TRACE_SUMMARY_WINDOW_HOURS || '24'), 10) || 24,
);
const DEFAULT_TRACE_SUMMARY_LIMIT = Math.max(
    1,
    parseInt(String(process.env.RECOMMENDATION_TRACE_SUMMARY_LIMIT || '300'), 10) || 300,
);
const DEFAULT_SHADOW_LOW_OVERLAP_THRESHOLD = clamp01(
    parseFloat(String(process.env.RECOMMENDATION_TRACE_SHADOW_LOW_OVERLAP_THRESHOLD || '0.5')),
);

type TraceSummaryRecord = {
    requestId: string;
    pipeline?: string;
    pipelineVersion?: string;
    traceVersion?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons?: string[];
    selectedCount?: number;
    userState?: string;
    experimentKeys?: string[];
    candidates?: unknown[];
    replayPool?: {
        poolKind?: string;
        totalCount?: number;
        truncated?: boolean;
        candidates?: unknown[];
    };
    shadowComparison?: {
        overlapCount?: number;
        overlapRatio?: number;
        selectedCount?: number;
        baselineCount?: number;
    };
    createdAt: Date | string;
};

type DimensionAccumulator = {
    requests: number;
    selectedCountSum: number;
    observedCandidatesSum: number;
    totalCandidatesSum: number;
    replayPoolCount: number;
    truncatedCount: number;
    shadowComparedCount: number;
    shadowOverlapSum: number;
    lowShadowOverlapCount: number;
};

type CounterRow = {
    value: string;
    count: number;
};

type ReasonRow = {
    reason: string;
    count: number;
};

export interface RecommendationTraceSummaryOptions {
    windowHours?: number;
    limit?: number;
    surface?: string;
    shadowLowOverlapThreshold?: number;
}

export interface RecommendationTraceDimensionSummary {
    requests: number;
    averageSelectedCount: number;
    averageObservedCandidates: number;
    averageTotalCandidates: number;
    replayPoolCoverage: number;
    truncationRate: number;
    shadowComparedRequests: number;
    averageShadowOverlapRatio: number;
    lowShadowOverlapRate: number;
}

export interface RecommendationTraceCandidateSetSummary {
    averageObservedCandidates: number;
    averageTotalCandidates: number;
    replayPoolCoverage: number;
    truncationRate: number;
}

export interface RecommendationTraceShadowSummary {
    comparedRequests: number;
    averageOverlapRatio: number;
    lowOverlapRate: number;
    lowOverlapThreshold: number;
    averageSelectedCount: number;
    averageBaselineCount: number;
}

export interface RecommendationTraceOpsSummary {
    windowHours: number;
    limit: number;
    surface?: string;
    requests: number;
    replayPoolCoverage: number;
    candidateSet: RecommendationTraceCandidateSetSummary;
    shadow: RecommendationTraceShadowSummary;
    byPipelineVersion: Record<string, RecommendationTraceDimensionSummary>;
    byTraceVersion: Record<string, RecommendationTraceDimensionSummary>;
    byExperimentKey: Record<string, RecommendationTraceDimensionSummary>;
    byCandidateSetKind: Record<string, RecommendationTraceDimensionSummary>;
    owners: CounterRow[];
    fallbackModes: CounterRow[];
    userStates: CounterRow[];
    degradedReasons: ReasonRow[];
    updatedAt: string;
}

export async function buildRecommendationTraceSummary(
    options: RecommendationTraceSummaryOptions = {},
): Promise<RecommendationTraceOpsSummary> {
    const windowHours = Math.max(1, Math.round(options.windowHours || DEFAULT_TRACE_SUMMARY_WINDOW_HOURS));
    const limit = Math.max(1, Math.round(options.limit || DEFAULT_TRACE_SUMMARY_LIMIT));
    const shadowLowOverlapThreshold = clamp01(
        options.shadowLowOverlapThreshold ?? DEFAULT_SHADOW_LOW_OVERLAP_THRESHOLD,
    );
    const since = new Date(Date.now() - (windowHours * 60 * 60 * 1000));

    const query: Record<string, unknown> = {
        createdAt: { $gte: since },
    };
    if (options.surface) {
        query.productSurface = options.surface;
    }

    const traces = await RecommendationTrace.find(query)
        .select(
            'requestId pipeline pipelineVersion traceVersion owner fallbackMode degradedReasons selectedCount userState experimentKeys candidates replayPool shadowComparison createdAt',
        )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean() as TraceSummaryRecord[];

    const byPipelineVersion: Record<string, DimensionAccumulator> = {};
    const byTraceVersion: Record<string, DimensionAccumulator> = {};
    const byExperimentKey: Record<string, DimensionAccumulator> = {};
    const byCandidateSetKind: Record<string, DimensionAccumulator> = {};
    const ownerCounts = new Map<string, number>();
    const fallbackCounts = new Map<string, number>();
    const userStateCounts = new Map<string, number>();
    const degradedReasonCounts = new Map<string, number>();

    let replayPoolCount = 0;
    let observedCandidatesSum = 0;
    let totalCandidatesSum = 0;
    let truncatedCount = 0;
    let shadowComparedCount = 0;
    let shadowOverlapSum = 0;
    let shadowSelectedCountSum = 0;
    let shadowBaselineCountSum = 0;
    let lowShadowOverlapCount = 0;

    for (const trace of traces) {
        const candidateSetKind = readCandidateSetKind(trace);
        const observedCandidates = readObservedCandidates(trace);
        const totalCandidates = readTotalCandidates(trace);
        const truncated = trace.replayPool?.truncated === true;
        const rawShadowOverlapRatio = trace.shadowComparison?.overlapRatio;
        const shadowCompared = isFiniteNumber(rawShadowOverlapRatio);
        const shadowOverlapRatio = shadowCompared
            ? clamp01(rawShadowOverlapRatio)
            : undefined;

        if (trace.replayPool) replayPoolCount += 1;
        observedCandidatesSum += observedCandidates;
        totalCandidatesSum += totalCandidates;
        if (truncated) truncatedCount += 1;
        if (shadowCompared && typeof shadowOverlapRatio === 'number') {
            shadowComparedCount += 1;
            shadowOverlapSum += shadowOverlapRatio;
            shadowSelectedCountSum += Math.max(0, Math.round(trace.shadowComparison?.selectedCount || 0));
            shadowBaselineCountSum += Math.max(0, Math.round(trace.shadowComparison?.baselineCount || 0));
            if (shadowOverlapRatio < shadowLowOverlapThreshold) {
                lowShadowOverlapCount += 1;
            }
        }

        addDimension(
            byPipelineVersion,
            trace.pipelineVersion || trace.pipeline || '__unknown__',
            trace,
            observedCandidates,
            totalCandidates,
            truncated,
            shadowOverlapRatio,
            shadowCompared,
            shadowLowOverlapThreshold,
        );
        addDimension(
            byTraceVersion,
            trace.traceVersion || '__unknown__',
            trace,
            observedCandidates,
            totalCandidates,
            truncated,
            shadowOverlapRatio,
            shadowCompared,
            shadowLowOverlapThreshold,
        );
        addDimension(
            byCandidateSetKind,
            candidateSetKind,
            trace,
            observedCandidates,
            totalCandidates,
            truncated,
            shadowOverlapRatio,
            shadowCompared,
            shadowLowOverlapThreshold,
        );

        const experimentKeys = trace.experimentKeys && trace.experimentKeys.length > 0
            ? trace.experimentKeys
            : ['__none__'];
        for (const experimentKey of experimentKeys) {
            addDimension(
                byExperimentKey,
                experimentKey,
                trace,
                observedCandidates,
                totalCandidates,
                truncated,
                shadowOverlapRatio,
                shadowCompared,
                shadowLowOverlapThreshold,
            );
        }

        incrementCount(ownerCounts, trace.owner || '__unknown__');
        incrementCount(fallbackCounts, trace.fallbackMode || '__none__');
        incrementCount(userStateCounts, trace.userState || '__unknown__');
        for (const reason of trace.degradedReasons || []) {
            incrementCount(degradedReasonCounts, reason);
        }
    }

    const requests = traces.length;

    return {
        windowHours,
        limit,
        surface: options.surface,
        requests,
        replayPoolCoverage: requests > 0 ? replayPoolCount / requests : 0,
        candidateSet: {
            averageObservedCandidates: average(observedCandidatesSum, requests),
            averageTotalCandidates: average(totalCandidatesSum, requests),
            replayPoolCoverage: requests > 0 ? replayPoolCount / requests : 0,
            truncationRate: average(truncatedCount, requests),
        },
        shadow: {
            comparedRequests: shadowComparedCount,
            averageOverlapRatio: average(shadowOverlapSum, shadowComparedCount),
            lowOverlapRate: average(lowShadowOverlapCount, shadowComparedCount),
            lowOverlapThreshold: shadowLowOverlapThreshold,
            averageSelectedCount: average(shadowSelectedCountSum, shadowComparedCount),
            averageBaselineCount: average(shadowBaselineCountSum, shadowComparedCount),
        },
        byPipelineVersion: finalizeDimensions(byPipelineVersion),
        byTraceVersion: finalizeDimensions(byTraceVersion),
        byExperimentKey: finalizeDimensions(byExperimentKey),
        byCandidateSetKind: finalizeDimensions(byCandidateSetKind),
        owners: finalizeCounterMap(ownerCounts),
        fallbackModes: finalizeCounterMap(fallbackCounts),
        userStates: finalizeCounterMap(userStateCounts),
        degradedReasons: finalizeReasonMap(degradedReasonCounts),
        updatedAt: new Date().toISOString(),
    };
}

function addDimension(
    target: Record<string, DimensionAccumulator>,
    key: string,
    trace: TraceSummaryRecord,
    observedCandidates: number,
    totalCandidates: number,
    truncated: boolean,
    shadowOverlapRatio: number | undefined,
    shadowCompared: TraceSummaryRecord['shadowComparison'] | boolean | undefined,
    shadowLowOverlapThreshold: number,
): void {
    const bucket = target[key] || {
        requests: 0,
        selectedCountSum: 0,
        observedCandidatesSum: 0,
        totalCandidatesSum: 0,
        replayPoolCount: 0,
        truncatedCount: 0,
        shadowComparedCount: 0,
        shadowOverlapSum: 0,
        lowShadowOverlapCount: 0,
    };

    bucket.requests += 1;
    bucket.selectedCountSum += Math.max(0, Math.round(trace.selectedCount || 0));
    bucket.observedCandidatesSum += observedCandidates;
    bucket.totalCandidatesSum += totalCandidates;
    if (trace.replayPool) bucket.replayPoolCount += 1;
    if (truncated) bucket.truncatedCount += 1;
    if (shadowCompared && typeof shadowOverlapRatio === 'number') {
        bucket.shadowComparedCount += 1;
        bucket.shadowOverlapSum += shadowOverlapRatio;
        if (shadowOverlapRatio < shadowLowOverlapThreshold) {
            bucket.lowShadowOverlapCount += 1;
        }
    }
    target[key] = bucket;
}

function finalizeDimensions(
    buckets: Record<string, DimensionAccumulator>,
): Record<string, RecommendationTraceDimensionSummary> {
    return Object.fromEntries(
        Object.entries(buckets)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([key, bucket]) => [
                key,
                {
                    requests: bucket.requests,
                    averageSelectedCount: average(bucket.selectedCountSum, bucket.requests),
                    averageObservedCandidates: average(bucket.observedCandidatesSum, bucket.requests),
                    averageTotalCandidates: average(bucket.totalCandidatesSum, bucket.requests),
                    replayPoolCoverage: average(bucket.replayPoolCount, bucket.requests),
                    truncationRate: average(bucket.truncatedCount, bucket.requests),
                    shadowComparedRequests: bucket.shadowComparedCount,
                    averageShadowOverlapRatio: average(bucket.shadowOverlapSum, bucket.shadowComparedCount),
                    lowShadowOverlapRate: average(bucket.lowShadowOverlapCount, bucket.shadowComparedCount),
                },
            ]),
    );
}

function finalizeCounterMap(map: Map<string, number>): CounterRow[] {
    return Array.from(map.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, count }));
}

function finalizeReasonMap(map: Map<string, number>): ReasonRow[] {
    return Array.from(map.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([reason, count]) => ({ reason, count }));
}

function incrementCount(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) || 0) + 1);
}

function readCandidateSetKind(trace: TraceSummaryRecord): string {
    return trace.replayPool?.poolKind || 'served_candidates_v1';
}

function readObservedCandidates(trace: TraceSummaryRecord): number {
    return Math.max(
        0,
        trace.replayPool?.candidates?.length
            ?? trace.candidates?.length
            ?? 0,
    );
}

function readTotalCandidates(trace: TraceSummaryRecord): number {
    return Math.max(
        0,
        Math.round(trace.replayPool?.totalCount ?? trace.candidates?.length ?? 0),
    );
}

function average(sum: number, count: number): number {
    return count > 0 ? sum / count : 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
