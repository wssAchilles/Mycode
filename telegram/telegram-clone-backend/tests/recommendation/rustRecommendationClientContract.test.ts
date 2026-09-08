import { describe, expect, it, vi } from 'vitest';

import {
  normalizeRustRecommendationPayload,
  RustRecommendationClient,
} from '../../src/services/recommendation/clients/RustRecommendationClient';
import {
  deserializeRecommendationQuery,
  recommendationQueryPayloadSchema,
  recommendationResultPayloadSchema,
  serializeRecommendationQuery,
} from '../../src/services/recommendation/rust/contracts';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RustRecommendationClient contract normalization', () => {
  it('rejects a structurally valid response for a different request', async () => {
    const client = new RustRecommendationClient('http://recommendation.test', 100);
    const post = vi.spyOn((client as any).client, 'post').mockResolvedValue({
      data: makeRustResultPayload('response-request'),
    });

    await expect(client.getCandidates({ requestId: 'query-request' } as any)).rejects.toThrow(
      'rust_recommendation_contract_violation: request_id_mismatch',
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects a response with a stale summary request ID', async () => {
    const client = new RustRecommendationClient('http://recommendation.test', 100);
    vi.spyOn((client as any).client, 'post').mockResolvedValue({
      data: makeRustResultPayload('same-request', { summaryRequestId: 'stale-request' }),
    });

    await expect(client.getCandidates({ requestId: 'same-request' } as any)).rejects.toThrow(
      'rust_recommendation_contract_violation: request_id_mismatch',
    );
  });

  it('rejects a response with a stale trace request ID', async () => {
    const client = new RustRecommendationClient('http://recommendation.test', 100);
    vi.spyOn((client as any).client, 'post').mockResolvedValue({
      data: makeRustResultPayload('same-request', { traceRequestId: 'stale-request' }),
    });

    await expect(client.getCandidates({ requestId: 'same-request' } as any)).rejects.toThrow(
      'rust_recommendation_contract_violation: request_id_mismatch',
    );
  });

  it('accepts a structurally valid response for the same request', async () => {
    const client = new RustRecommendationClient('http://recommendation.test', 100);
    vi.spyOn((client as any).client, 'post').mockResolvedValue({
      data: makeRustResultPayload('same-request', { traceRequestId: 'same-request' }),
    });

    const result = await client.getCandidates({ requestId: 'same-request' } as any);

    expect(result.requestId).toBe('same-request');
  });

  it.each([
    {
      name: 'candidate createdAt',
      mutate: (payload: any) => {
        payload.candidates = [{
          postId: '507f191e810c19729de8c001',
          authorId: 'author-1',
          content: 'candidate',
          createdAt: 'not-a-date',
          isReply: false,
          isRepost: false,
        }];
      },
    },
    {
      name: 'top-level nextCursor',
      mutate: (payload: any) => {
        payload.nextCursor = 'not-a-date';
      },
    },
    {
      name: 'serving summary nextCursor',
      mutate: (payload: any) => {
        payload.summary.serving.nextCursor = 'not-a-date';
      },
    },
  ])('rejects an invalid RFC3339 date in $name', async ({ mutate }) => {
    const client = new RustRecommendationClient('http://recommendation.test', 100);
    const payload = makeRustResultPayload('same-request');
    mutate(payload);
    vi.spyOn((client as any).client, 'post').mockResolvedValue({ data: payload });

    await expect(client.getCandidates({ requestId: 'same-request' } as any)).rejects.toThrow(
      /rust_recommendation_contract_violation: .*Invalid ISO datetime/,
    );
  });

  it('preserves the server decision ID across the Node/Rust query boundary', () => {
    const query = createFeedQuery('viewer-identity', 20, false, {
      requestId: '0563d721-b38c-44a2-afc6-f0a52ebde0fa',
      decisionId: 'd7778f92-ab47-47f5-a262-f470c3a98156',
      clientRequestId: 'client-correlation-only',
    });

    const payload = recommendationQueryPayloadSchema.parse(serializeRecommendationQuery(query));
    const roundTrip = deserializeRecommendationQuery(payload);

    expect(payload.decisionId).toBe(query.decisionId);
    expect(payload).not.toHaveProperty('clientRequestId');
    expect(roundTrip.decisionId).toBe(query.decisionId);
    expect(roundTrip.clientRequestId).toBeUndefined();
  });

  it('treats Rust Option null fields as absent optional fields', () => {
    const normalized = normalizeRustRecommendationPayload({
      requestId: 'req-1',
      servingVersion: 'rust_serving_v1',
      cursor: null,
      nextCursor: null,
      hasMore: false,
      servedStateVersion: 'related_ids_v1',
      stableOrderKey: 'stable-order-key',
      candidates: [
        {
          postId: '507f191e810c19729de8c001',
          modelPostId: '507f191e810c19729de8c001',
          authorId: 'author-1',
          content: 'candidate',
          createdAt: '2026-04-20T00:00:00.000Z',
          conversationId: null,
          isReply: false,
          replyToPostId: null,
          isRepost: false,
          originalPostId: null,
          videoDurationSec: null,
          authorAffinityScore: null,
          phoenixScores: null,
          weightedScore: null,
          score: null,
          vfResult: null,
          newsMetadata: null,
        },
      ],
      summary: {
        requestId: 'req-1',
        stage: 'retrieval_ranking_v2',
        pipelineVersion: 'xalgo_candidate_pipeline_v6',
        owner: 'rust',
        fallbackMode: 'node_provider_surface_with_cpp_graph_primary',
        providerCalls: {},
        retrievedCount: 0,
        selectedCount: 1,
        sourceCounts: {},
        filterDropCounts: {},
        stageTimings: {},
        stageLatencyMs: {},
        degradedReasons: [],
        recentHotApplied: false,
        selector: {
          oversampleFactor: 5,
          maxSize: 200,
          finalLimit: 10,
          truncated: false,
        },
        serving: {
          servingVersion: 'rust_serving_v1',
          cursorMode: 'created_at_desc_v1',
          cursor: null,
          nextCursor: null,
          hasMore: false,
          servedStateVersion: 'related_ids_v1',
          stableOrderKey: 'stable-order-key',
          duplicateSuppressedCount: 0,
          crossPageDuplicateCount: 0,
          suppressionReasons: {},
          serveCacheHit: false,
          stableOrderDrifted: false,
          cacheKeyMode: 'normalized_query_v2',
          cachePolicy: 'bounded_short_ttl_v1',
          cachePolicyReason: 'first_page_stable',
          pageRemainingCount: 0,
          pageUnderfilled: false,
        },
        retrieval: {
          stage: 'source_parallel_lane_merge_v6',
          totalCandidates: 0,
          inNetworkCandidates: 0,
          outOfNetworkCandidates: 0,
          mlRetrievedCandidates: 0,
          recentHotCandidates: 0,
          sourceCounts: {},
          laneCounts: {},
          mlSourceCounts: {},
          stageTimings: {},
          degradedReasons: [],
          graph: {
            totalCandidates: 0,
            kernelCandidates: 0,
            legacyCandidates: 0,
            fallbackUsed: false,
            emptyResult: true,
            kernelSourceCounts: {},
          },
        },
        ranking: {
          stage: 'xalgo_stageful_ranking_v2',
          inputCandidates: 0,
          hydratedCandidates: 0,
          filteredCandidates: 0,
          scoredCandidates: 0,
          mlEligibleCandidates: 0,
          mlRankedCandidates: 0,
          weightedCandidates: 0,
          stageTimings: {},
          filterDropCounts: {},
          degradedReasons: [],
        },
        stages: [],
      },
    });

    expect(recommendationResultPayloadSchema.safeParse(normalized).success).toBe(true);
  });

  it('serializes ranking policy for Rust runtime config', () => {
    const query = createFeedQuery('viewer-1', 20);
    query.rankingPolicy = {
      contractVersion: 'recommendation_score_contract_v2',
      scoreBreakdownVersion: 'score_breakdown_v2',
      banditExplorationRate: 0.12,
      banditUncertaintyWeight: 0.42,
      explorationRiskCeiling: 0.5,
      sourceBatchTimeoutMs: 900,
      semanticDedupOverlapThreshold: 0.55,
      sessionTopicSuppressionWeight: 0.28,
      trendSourceBoost: 0.2,
      sourceSoftCapRatio: 0.4,
      trendKeywords: ['rust', 'recsys'],
    };

    const payload = serializeRecommendationQuery(query);

    expect(payload.rankingPolicy).toMatchObject({
      contractVersion: 'recommendation_score_contract_v2',
      scoreBreakdownVersion: 'score_breakdown_v2',
      banditExplorationRate: 0.12,
      banditUncertaintyWeight: 0.42,
      explorationRiskCeiling: 0.5,
      sourceBatchTimeoutMs: 900,
      semanticDedupOverlapThreshold: 0.55,
      sessionTopicSuppressionWeight: 0.28,
      trendSourceBoost: 0.2,
      sourceSoftCapRatio: 0.4,
      trendKeywords: ['rust', 'recsys'],
    });
  });

  it('merges partial ranking policy with runtime defaults', () => {
    process.env.RECOMMENDATION_TREND_KEYWORDS = 'ai,rust';
    try {
      const query = createFeedQuery('viewer-1', 20);
      query.rankingPolicy = {
        trendKeywords: ['rust', 'graph'],
      };

      const payload = serializeRecommendationQuery(query);

      expect(payload.rankingPolicy).toMatchObject({
        banditUncertaintyWeight: 0.3,
        explorationRiskCeiling: 0.58,
        sessionTopicSuppressionWeight: 0.2,
        semanticDedupOverlapThreshold: 0.62,
        trendSourceBoost: 0.16,
      });
      expect(payload.rankingPolicy?.trendKeywords).toEqual(['ai', 'rust', 'graph']);
    } finally {
      delete process.env.RECOMMENDATION_TREND_KEYWORDS;
    }
  });
});

function makeRustResultPayload(
  requestId: string,
  options: { summaryRequestId?: string; traceRequestId?: string } = {},
) {
  return {
    requestId,
    servingVersion: 'rust_serving_v1',
    hasMore: false,
    servedStateVersion: 'related_ids_v1',
    stableOrderKey: 'stable-order-key',
    candidates: [],
    summary: {
      requestId: options.summaryRequestId ?? requestId,
      stage: 'retrieval_ranking_v2',
      pipelineVersion: 'xalgo_candidate_pipeline_v6',
      owner: 'rust',
      fallbackMode: 'none',
      providerCalls: {},
      retrievedCount: 0,
      selectedCount: 0,
      sourceCounts: {},
      filterDropCounts: {},
      stageTimings: {},
      stageLatencyMs: {},
      degradedReasons: [],
      recentHotApplied: false,
      selector: {
        oversampleFactor: 1,
        maxSize: 1,
        finalLimit: 1,
        truncated: false,
      },
      serving: {
        servingVersion: 'rust_serving_v1',
        cursorMode: 'created_at_desc_v1',
        hasMore: false,
        servedStateVersion: 'related_ids_v1',
        stableOrderKey: 'stable-order-key',
        duplicateSuppressedCount: 0,
        crossPageDuplicateCount: 0,
        suppressionReasons: {},
        serveCacheHit: false,
        stableOrderDrifted: false,
        cacheKeyMode: 'normalized_query_v2',
        cachePolicy: 'bounded_short_ttl_v1',
        cachePolicyReason: 'first_page_stable',
        pageRemainingCount: 0,
        pageUnderfilled: false,
      },
      retrieval: {
        stage: 'source_parallel_lane_merge_v6',
        totalCandidates: 0,
        inNetworkCandidates: 0,
        outOfNetworkCandidates: 0,
        mlRetrievedCandidates: 0,
        recentHotCandidates: 0,
        sourceCounts: {},
        laneCounts: {},
        mlSourceCounts: {},
        stageTimings: {},
        degradedReasons: [],
        graph: {
          totalCandidates: 0,
          kernelCandidates: 0,
          legacyCandidates: 0,
          fallbackUsed: false,
          emptyResult: true,
          kernelSourceCounts: {},
        },
      },
      ranking: {
        stage: 'xalgo_stageful_ranking_v2',
        inputCandidates: 0,
        hydratedCandidates: 0,
        filteredCandidates: 0,
        scoredCandidates: 0,
        mlEligibleCandidates: 0,
        mlRankedCandidates: 0,
        weightedCandidates: 0,
        stageTimings: {},
        filterDropCounts: {},
        degradedReasons: [],
      },
      stages: [],
      trace: options.traceRequestId ? makeRustTrace(options.traceRequestId) : undefined,
    },
  };
}

function makeRustTrace(requestId: string) {
  return {
    traceVersion: 'recommendation_trace_v1',
    requestId,
    pipelineVersion: 'xalgo_candidate_pipeline_v6',
    owner: 'rust',
    fallbackMode: 'none',
    selectedCount: 0,
    inNetworkCount: 0,
    outOfNetworkCount: 0,
    sourceCounts: [],
    authorDiversity: 0,
    replyRatio: 0,
    averageScore: 0,
    freshness: {},
    candidates: [],
    experimentKeys: [],
    serveCacheHit: false,
  };
}
