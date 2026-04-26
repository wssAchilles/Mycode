import { describe, expect, it } from 'vitest';

import { normalizeRustRecommendationPayload } from '../../src/services/recommendation/clients/RustRecommendationClient';
import {
  recommendationResultPayloadSchema,
  serializeRecommendationQuery,
} from '../../src/services/recommendation/rust/contracts';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RustRecommendationClient contract normalization', () => {
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
      sourceSoftCapRatio: 0.4,
      trendKeywords: ['rust', 'recsys'],
    };

    const payload = serializeRecommendationQuery(query);

    expect(payload.rankingPolicy).toMatchObject({
      contractVersion: 'recommendation_score_contract_v2',
      scoreBreakdownVersion: 'score_breakdown_v2',
      banditExplorationRate: 0.12,
      sourceSoftCapRatio: 0.4,
      trendKeywords: ['rust', 'recsys'],
    });
  });
});
