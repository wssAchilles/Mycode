import type { FeedCandidate, FeedQuery } from '../types';
import {
    RustRecommendationClient,
    getDefaultRustRecommendationBaseUrl,
    getRustRecommendationMode,
    getRustRecommendationTimeoutMs,
} from '../clients/RustRecommendationClient';
import {
    RANKED_CURSOR_ABSTENTION_MODE,
    SAFETY_CONTEXT_ABSTENTION_MODE,
    SAFETY_CONTEXT_UNAVAILABLE_REASON,
    deserializeRecommendationCandidates,
    serializeRecommendationQuery,
} from '../rust/contracts';
import type { RecommendationTracePayload } from '../rust/contracts';
import { recommendationRuntimeMetrics } from '../rust/runtimeMetrics';
import {
    getRecommendationRuntimeSemantics,
    type RecommendationRuntimeSemantics,
} from '../contracts/runtimeOwnership';
import {
    buildRecommendationShadowComparison,
    buildSpaceFeedDebugInfo,
    type SpaceFeedDebugInfo,
} from './debugInfo';
import { recordRecommendationTrace } from '../observability/recommendationTrace';
import { FailClosedQueryHydratorError } from '../framework/Pipeline';

export interface RustFeedServingMeta {
    servingVersion?: string;
    cursorMode?: string;
    stableOrderKey?: string;
    cursor?: string;
    nextCursor?: string;
    servedStateVersion?: string;
    hasMore?: boolean;
}

export interface FeedRuntimePageMeta {
    hasMore?: boolean;
    nextCursor?: string;
    continuationAbstained?: boolean;
    rustServing?: RustFeedServingMeta;
}

export interface FeedRuntimeResult {
    feed: FeedCandidate[];
    finalFeedQuery: FeedQuery;
    pageMeta?: FeedRuntimePageMeta;
    debugInfo: SpaceFeedDebugInfo;
    rustTraceForServedFeed?: RecommendationTracePayload;
    safetyContextUnavailable?: boolean;
}

interface ResolveFeedRuntimeInput {
    userId: string;
    limit: number;
    requestId: string;
    createBaseQuery: () => FeedQuery;
    withFeedTrendKeywords: (query: FeedQuery) => Promise<FeedQuery>;
    runBaselineFeed: () => Promise<FeedCandidate[]>;
}

export async function resolveFeedRuntime(
    input: ResolveFeedRuntimeInput,
): Promise<FeedRuntimeResult> {
    const rustRecommendationMode = getRustRecommendationMode();
    const runtime = getRecommendationRuntimeSemantics(rustRecommendationMode);

    try {
        if (rustRecommendationMode === 'primary') {
            return await resolvePrimaryRustFeed(input, runtime);
        }

        return await resolveNodeBaselineFeed(input, runtime);
    } catch (error) {
        if (error instanceof FailClosedQueryHydratorError) {
            return buildSafetyContextUnavailableResult(input, runtime);
        }
        throw error;
    }
}

async function resolvePrimaryRustFeed(
    input: ResolveFeedRuntimeInput,
    runtime: RecommendationRuntimeSemantics,
): Promise<FeedRuntimeResult> {
    const finalFeedQuery = input.createBaseQuery();
    const rankedCursorAbstained = !finalFeedQuery.inNetworkOnly;

    if (rankedCursorAbstained && finalFeedQuery.cursor) {
        return {
            feed: [],
            finalFeedQuery,
            pageMeta: rankedCursorAbstentionPageMeta,
            debugInfo: buildSpaceFeedDebugInfo([], {
                requestId: input.requestId,
                pipeline: 'rust_primary_ranked_cursor_abstention',
                runtimeMode: runtime.runtimeMode,
                configuredServingOwner: runtime.configuredServingOwner,
                servingOwner: 'rust',
                fallbackOwner: runtime.fallbackOwner,
                fallbackMode: 'ranked_cursor_abstention',
                degradedReasons: ['ranked_cursor_abstention'],
            }),
        };
    }

    try {
        const rustResult = await getRustFeedCandidates(input, true, finalFeedQuery);
        if (rustResult.summary.degradedReasons.includes(SAFETY_CONTEXT_UNAVAILABLE_REASON)) {
            const serving = rustResult.summary.serving;
            return buildSafetyContextUnavailableResult(input, runtime, rustResult.query, {
                servingVersion: rustResult.servingVersion,
                cursorMode: serving.cursorMode,
                stableOrderKey: rustResult.stableOrderKey,
                cursor: rustResult.cursor,
                nextCursor: undefined,
                servedStateVersion: rustResult.servedStateVersion,
                hasMore: false,
            });
        }
        const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);

        if (rustCandidates.length === 0) {
            console.warn(
                '[SpaceService] Rust recommendation primary returned empty selection, falling back to baseline pipeline',
            );
            const feed = await input.runBaselineFeed();
            const degradedReasons = withRankedCursorAbstention([
                ...rustResult.summary.degradedReasons,
                'rust_primary_empty_selection',
            ], rankedCursorAbstained);
            return {
                feed,
                finalFeedQuery,
                pageMeta: rankedCursorAbstained ? rankedCursorAbstentionPageMeta : undefined,
                debugInfo: buildSpaceFeedDebugInfo(feed, {
                    requestId: input.requestId,
                    pipeline: 'rust_primary_empty_fallback_node',
                    runtimeMode: runtime.runtimeMode,
                    configuredServingOwner: runtime.configuredServingOwner,
                    servingOwner: 'node',
                    fallbackOwner: runtime.fallbackOwner,
                    fallbackReason: 'rust_primary_empty_fallback_node',
                    fallbackMode: rustResult.summary.fallbackMode,
                    degradedReasons,
                }),
            };
        }

        const serving = rustResult.summary.serving;
        const continuationAbstained = rankedCursorAbstained
            || serving.cursorMode === RANKED_CURSOR_ABSTENTION_MODE;
        const degradedReasons = withRankedCursorAbstention(
            rustResult.summary.degradedReasons,
            continuationAbstained,
        );
        const pageMeta: FeedRuntimePageMeta = {
            hasMore: continuationAbstained ? false : rustResult.hasMore,
            nextCursor: continuationAbstained ? undefined : rustResult.nextCursor,
            continuationAbstained: continuationAbstained || undefined,
            rustServing: {
                servingVersion: rustResult.servingVersion,
                cursorMode: serving.cursorMode,
                stableOrderKey: rustResult.stableOrderKey,
                cursor: rustResult.cursor,
                nextCursor: continuationAbstained ? undefined : rustResult.nextCursor,
                servedStateVersion: rustResult.servedStateVersion,
                hasMore: continuationAbstained ? false : serving.hasMore,
            },
        };

        return {
            feed: rustCandidates,
            finalFeedQuery: rustResult.query,
            pageMeta,
            rustTraceForServedFeed: rustResult.summary.trace,
            debugInfo: buildSpaceFeedDebugInfo(rustCandidates, {
                requestId: input.requestId,
                pipeline: 'rust_primary',
                runtimeMode: runtime.runtimeMode,
                configuredServingOwner: runtime.configuredServingOwner,
                servingOwner: 'rust',
                fallbackOwner: runtime.fallbackOwner,
                fallbackMode: rustResult.summary.fallbackMode,
                degradedReasons,
            }),
        };
    } catch (error) {
        console.warn(
            '[SpaceService] Rust recommendation primary failed, falling back to baseline pipeline:',
            (error as any)?.message || error,
        );
        const feed = await input.runBaselineFeed();
        const degradedReasons = withRankedCursorAbstention(
            [String((error as any)?.message || error || 'rust_primary_failed')],
            rankedCursorAbstained,
        );
        return {
            feed,
            finalFeedQuery,
            pageMeta: rankedCursorAbstained ? rankedCursorAbstentionPageMeta : undefined,
            debugInfo: buildSpaceFeedDebugInfo(feed, {
                requestId: input.requestId,
                pipeline: 'rust_primary_error_fallback_node',
                runtimeMode: runtime.runtimeMode,
                configuredServingOwner: runtime.configuredServingOwner,
                servingOwner: 'node',
                fallbackOwner: runtime.fallbackOwner,
                fallbackReason: 'rust_primary_error_fallback_node',
                fallbackMode: 'rust_primary_failed',
                degradedReasons,
            }),
        };
    }
}

function buildSafetyContextUnavailableResult(
    input: ResolveFeedRuntimeInput,
    runtime: RecommendationRuntimeSemantics,
    finalFeedQuery = input.createBaseQuery(),
    rustServing?: RustFeedServingMeta,
): FeedRuntimeResult {
    return {
        feed: [],
        finalFeedQuery,
        safetyContextUnavailable: true,
        pageMeta: {
            hasMore: false,
            continuationAbstained: true,
            rustServing,
        },
        debugInfo: buildSpaceFeedDebugInfo([], {
            requestId: input.requestId,
            pipeline: runtime.runtimeMode === 'primary'
                ? 'rust_primary_safety_context_abstention'
                : 'node_safety_context_abstention',
            runtimeMode: runtime.runtimeMode,
            configuredServingOwner: runtime.configuredServingOwner,
            servingOwner: runtime.configuredServingOwner,
            fallbackOwner: runtime.fallbackOwner,
            fallbackMode: SAFETY_CONTEXT_ABSTENTION_MODE,
            degradedReasons: [SAFETY_CONTEXT_UNAVAILABLE_REASON],
        }),
    };
}

async function resolveNodeBaselineFeed(
    input: ResolveFeedRuntimeInput,
    runtime: RecommendationRuntimeSemantics,
): Promise<FeedRuntimeResult> {
    const rustRecommendationMode = runtime.runtimeMode;
    const feed = await input.runBaselineFeed();
    let debugInfo = buildSpaceFeedDebugInfo(feed, {
        requestId: input.requestId,
        pipeline: rustRecommendationMode === 'shadow' ? 'node_baseline_with_rust_shadow' : 'node_baseline',
        runtimeMode: runtime.runtimeMode,
        configuredServingOwner: runtime.configuredServingOwner,
        servingOwner: 'node',
        evaluatedOwner: runtime.evaluatedOwner,
        fallbackMode: rustRecommendationMode === 'shadow' ? 'shadow_compare_only' : 'node_local_mixer',
    });

    if (rustRecommendationMode !== 'shadow') {
        return {
            feed,
            finalFeedQuery: input.createBaseQuery(),
            debugInfo,
        };
    }

    void getRustFeedCandidates(input, false)
        .then((rustResult) => {
            const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);
            const shadowComparison = buildRecommendationShadowComparison(feed, rustCandidates);
            recommendationRuntimeMetrics.recordShadow(
                rustResult.summary,
                shadowComparison,
            );
            return recordRecommendationTrace(input.createBaseQuery(), feed, {
                shadowComparison,
            }).catch((error) => {
                console.warn(
                    '[SpaceService] Rust recommendation shadow trace failed:',
                    (error as any)?.message || error,
                );
            });
        })
        .catch((error) => {
            console.warn(
                '[SpaceService] Rust recommendation shadow failed:',
                (error as any)?.message || error,
            );
        });

    return {
        feed,
        finalFeedQuery: input.createBaseQuery(),
        debugInfo,
    };
}

async function getRustFeedCandidates(
    input: ResolveFeedRuntimeInput,
    recordPrimary: boolean,
    baseQuery = input.createBaseQuery(),
) {
    const rustClient = new RustRecommendationClient(
        getDefaultRustRecommendationBaseUrl(),
        getRustRecommendationTimeoutMs(),
    );
    const query = await input.withFeedTrendKeywords(baseQuery);
    const result = await rustClient.getCandidates(
        serializeRecommendationQuery(query),
    );
    if (recordPrimary) {
        recommendationRuntimeMetrics.recordPrimary(result.summary);
    }
    return { ...result, query };
}

const rankedCursorAbstentionPageMeta: FeedRuntimePageMeta = {
    hasMore: false,
    continuationAbstained: true,
};

function withRankedCursorAbstention(
    degradedReasons: string[],
    continuationAbstained: boolean,
): string[] {
    return continuationAbstained
        ? Array.from(new Set([...degradedReasons, 'ranked_cursor_abstention']))
        : degradedReasons;
}
