import type { FeedCandidate, FeedQuery } from '../types';
import {
    RustRecommendationClient,
    getDefaultRustRecommendationBaseUrl,
    getRustRecommendationMode,
    getRustRecommendationTimeoutMs,
} from '../clients/RustRecommendationClient';
import {
    deserializeRecommendationCandidates,
    serializeRecommendationQuery,
} from '../rust/contracts';
import type { RecommendationTracePayload } from '../rust/contracts';
import { recommendationRuntimeMetrics } from '../rust/runtimeMetrics';
import {
    buildRecommendationShadowComparison,
    buildSpaceFeedDebugInfo,
    type SpaceFeedDebugInfo,
} from './debugInfo';

export interface RustFeedServingMeta {
    servingVersion?: string;
    stableOrderKey?: string;
    cursor?: string;
    nextCursor?: string;
    servedStateVersion?: string;
    hasMore?: boolean;
}

export interface FeedRuntimePageMeta {
    hasMore?: boolean;
    nextCursor?: string;
    rustServing?: RustFeedServingMeta;
}

export interface FeedRuntimeResult {
    feed: FeedCandidate[];
    finalFeedQuery: FeedQuery;
    pageMeta?: FeedRuntimePageMeta;
    debugInfo: SpaceFeedDebugInfo;
    rustTraceForServedFeed?: RecommendationTracePayload;
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

    if (rustRecommendationMode === 'primary') {
        return resolvePrimaryRustFeed(input);
    }

    return resolveNodeBaselineFeed(input, rustRecommendationMode);
}

async function resolvePrimaryRustFeed(
    input: ResolveFeedRuntimeInput,
): Promise<FeedRuntimeResult> {
    try {
        const rustResult = await getRustFeedCandidates(input, true);
        const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);
        const pageMeta: FeedRuntimePageMeta = {
            hasMore: rustResult.hasMore,
            nextCursor: rustResult.nextCursor,
            rustServing: {
                servingVersion: rustResult.servingVersion,
                stableOrderKey: rustResult.stableOrderKey,
                cursor: rustResult.cursor,
                nextCursor: rustResult.nextCursor,
                servedStateVersion: rustResult.servedStateVersion,
                hasMore: rustResult.hasMore,
            },
        };

        if (rustCandidates.length === 0) {
            console.warn(
                '[SpaceService] Rust recommendation primary returned empty selection, falling back to baseline pipeline',
            );
            const feed = await input.runBaselineFeed();
            return {
                feed,
                finalFeedQuery: input.createBaseQuery(),
                pageMeta,
                debugInfo: buildSpaceFeedDebugInfo(feed, {
                    requestId: input.requestId,
                    pipeline: 'rust_primary_empty_fallback_node',
                    owner: rustResult.summary.owner,
                    fallbackMode: rustResult.summary.fallbackMode,
                    degradedReasons: [
                        ...rustResult.summary.degradedReasons,
                        'rust_primary_empty_selection',
                    ],
                }),
            };
        }

        return {
            feed: rustCandidates,
            finalFeedQuery: rustResult.query,
            pageMeta,
            rustTraceForServedFeed: rustResult.summary.trace,
            debugInfo: buildSpaceFeedDebugInfo(rustCandidates, {
                requestId: input.requestId,
                pipeline: 'rust_primary',
                owner: rustResult.summary.owner,
                fallbackMode: rustResult.summary.fallbackMode,
                degradedReasons: rustResult.summary.degradedReasons,
            }),
        };
    } catch (error) {
        console.warn(
            '[SpaceService] Rust recommendation primary failed, falling back to baseline pipeline:',
            (error as any)?.message || error,
        );
        const feed = await input.runBaselineFeed();
        return {
            feed,
            finalFeedQuery: input.createBaseQuery(),
            debugInfo: buildSpaceFeedDebugInfo(feed, {
                requestId: input.requestId,
                pipeline: 'rust_primary_error_fallback_node',
                owner: 'node',
                fallbackMode: 'rust_primary_failed',
                degradedReasons: [String((error as any)?.message || error || 'rust_primary_failed')],
            }),
        };
    }
}

async function resolveNodeBaselineFeed(
    input: ResolveFeedRuntimeInput,
    rustRecommendationMode: string,
): Promise<FeedRuntimeResult> {
    const feed = await input.runBaselineFeed();
    let debugInfo = buildSpaceFeedDebugInfo(feed, {
        requestId: input.requestId,
        pipeline: rustRecommendationMode === 'shadow' ? 'node_baseline_with_rust_shadow' : 'node_baseline',
        owner: 'node',
        fallbackMode: rustRecommendationMode === 'shadow' ? 'shadow_compare_only' : 'node_local_mixer',
    });

    if (rustRecommendationMode !== 'shadow') {
        return {
            feed,
            finalFeedQuery: input.createBaseQuery(),
            debugInfo,
        };
    }

    try {
        const rustResult = await getRustFeedCandidates(input, false);
        const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);
        const shadowComparison = buildRecommendationShadowComparison(feed, rustCandidates);
        recommendationRuntimeMetrics.recordShadow(
            rustResult.summary,
            shadowComparison,
        );
        debugInfo = buildSpaceFeedDebugInfo(feed, {
            requestId: input.requestId,
            pipeline: 'node_baseline_with_rust_shadow',
            owner: 'node',
            fallbackMode: rustResult.summary.fallbackMode,
            degradedReasons: rustResult.summary.degradedReasons,
            shadowComparison,
        });
    } catch (error) {
        console.warn(
            '[SpaceService] Rust recommendation shadow failed:',
            (error as any)?.message || error,
        );
        debugInfo = buildSpaceFeedDebugInfo(feed, {
            requestId: input.requestId,
            pipeline: 'node_baseline_shadow_failed',
            owner: 'node',
            fallbackMode: 'shadow_failed',
            degradedReasons: [String((error as any)?.message || error || 'rust_shadow_failed')],
        });
    }

    return {
        feed,
        finalFeedQuery: input.createBaseQuery(),
        debugInfo,
    };
}

async function getRustFeedCandidates(input: ResolveFeedRuntimeInput, recordPrimary: boolean) {
    const rustClient = new RustRecommendationClient(
        getDefaultRustRecommendationBaseUrl(),
        getRustRecommendationTimeoutMs(),
    );
    const query = await input.withFeedTrendKeywords(input.createBaseQuery());
    const result = await rustClient.getCandidates(
        serializeRecommendationQuery(query),
    );
    if (recordPrimary) {
        recommendationRuntimeMetrics.recordPrimary(result.summary);
    }
    return { ...result, query };
}
