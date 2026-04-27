import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
}));

vi.mock('../../src/models/RecommendationTrace', () => ({
    default: {
        find: mocks.find,
    },
}));

import { buildRecommendationTraceSummary } from '../../src/services/recommendation/ops';

describe('recommendation trace summary', () => {
    beforeEach(() => {
        mocks.find.mockReset();
    });

    it('aggregates replay pool, experiment bucket, and shadow overlap metrics', async () => {
        const traces = [
            {
                requestId: 'req-1',
                pipeline: 'rust_primary',
                pipelineVersion: 'xalgo_candidate_pipeline_v6',
                strategyVersion: 'strategy_policy_v2',
                traceVersion: 'rust_candidate_trace_v1',
                owner: 'rust',
                fallbackMode: 'none',
                degradedReasons: ['ranking:PhoenixScorer:empty_ml_ranking'],
                selectedCount: 20,
                userState: 'warm',
                experimentKeys: ['space_feed_recsys:treatment'],
                candidates: new Array(20).fill({}),
                replayPool: {
                    poolKind: 'pre_selector_scored_topk_v1',
                    totalCount: 120,
                    truncated: true,
                    candidates: new Array(60).fill({}),
                },
                createdAt: '2026-04-23T00:00:00.000Z',
            },
            {
                requestId: 'req-2',
                pipeline: 'node_baseline_with_rust_shadow',
                pipelineVersion: 'node_baseline_with_rust_shadow',
                traceVersion: 'node_request_trace_v1',
                owner: 'node',
                fallbackMode: 'shadow_compare_only',
                degradedReasons: ['shadow_observed'],
                selectedCount: 20,
                userState: 'sparse',
                experimentKeys: ['space_feed_recsys:control'],
                candidates: new Array(20).fill({}),
                shadowComparison: {
                    overlapCount: 5,
                    overlapRatio: 0.25,
                    selectedCount: 20,
                    baselineCount: 20,
                },
                createdAt: '2026-04-23T00:10:00.000Z',
            },
            {
                requestId: 'req-3',
                pipeline: 'rust_primary',
                pipelineVersion: 'xalgo_candidate_pipeline_v6',
                strategyVersion: 'strategy_policy_v2',
                traceVersion: 'rust_candidate_trace_v1',
                owner: 'rust',
                fallbackMode: 'none',
                degradedReasons: ['shadow_observed'],
                selectedCount: 20,
                userState: 'cold_start',
                experimentKeys: [],
                candidates: new Array(20).fill({}),
                replayPool: {
                    poolKind: 'pre_selector_scored_topk_v1',
                    totalCount: 30,
                    truncated: false,
                    candidates: new Array(30).fill({}),
                },
                shadowComparison: {
                    overlapCount: 15,
                    overlapRatio: 0.75,
                    selectedCount: 20,
                    baselineCount: 20,
                },
                createdAt: '2026-04-23T00:20:00.000Z',
            },
        ];

        const chain: any = {
            select: vi.fn(() => chain),
            sort: vi.fn(() => chain),
            limit: vi.fn(() => chain),
            lean: vi.fn().mockResolvedValue(traces),
        };
        mocks.find.mockReturnValue(chain);

        const summary = await buildRecommendationTraceSummary({
            windowHours: 12,
            limit: 50,
            surface: 'space_feed',
            shadowLowOverlapThreshold: 0.5,
        });

        expect(mocks.find).toHaveBeenCalledWith({
            createdAt: { $gte: expect.any(Date) },
            productSurface: 'space_feed',
        });
        expect(chain.limit).toHaveBeenCalledWith(50);
        expect(summary.requests).toBe(3);
        expect(summary.replayPoolCoverage).toBeCloseTo(2 / 3);
        expect(summary.candidateSet).toMatchObject({
            averageObservedCandidates: 110 / 3,
            averageTotalCandidates: 170 / 3,
            replayPoolCoverage: 2 / 3,
            truncationRate: 1 / 3,
        });
        expect(summary.shadow).toMatchObject({
            comparedRequests: 2,
            averageOverlapRatio: 0.5,
            lowOverlapRate: 0.5,
            lowOverlapThreshold: 0.5,
            averageSelectedCount: 20,
            averageBaselineCount: 20,
        });
        expect(summary.byPipelineVersion.xalgo_candidate_pipeline_v6).toMatchObject({
            requests: 2,
            averageObservedCandidates: 45,
            averageTotalCandidates: 75,
            replayPoolCoverage: 1,
            truncationRate: 0.5,
            shadowComparedRequests: 1,
            averageShadowOverlapRatio: 0.75,
            lowShadowOverlapRate: 0,
        });
        expect(summary.byStrategyVersion.strategy_policy_v2).toMatchObject({
            requests: 2,
            averageObservedCandidates: 45,
            averageTotalCandidates: 75,
            replayPoolCoverage: 1,
        });
        expect(summary.byExperimentKey['space_feed_recsys:control']).toMatchObject({
            requests: 1,
            replayPoolCoverage: 0,
            averageObservedCandidates: 20,
            averageTotalCandidates: 20,
        });
        expect(summary.byExperimentKey.__none__).toMatchObject({
            requests: 1,
            replayPoolCoverage: 1,
            averageObservedCandidates: 30,
            averageTotalCandidates: 30,
        });
        expect(summary.byCandidateSetKind.pre_selector_scored_topk_v1).toMatchObject({
            requests: 2,
            averageObservedCandidates: 45,
            averageTotalCandidates: 75,
        });
        expect(summary.byCandidateSetKind.served_candidates_v1).toMatchObject({
            requests: 1,
            averageObservedCandidates: 20,
            averageTotalCandidates: 20,
        });
        expect(summary.owners).toEqual([
            { value: 'rust', count: 2 },
            { value: 'node', count: 1 },
        ]);
        expect(summary.degradedReasons).toEqual([
            { reason: 'shadow_observed', count: 2 },
            { reason: 'ranking:PhoenixScorer:empty_ml_ranking', count: 1 },
        ]);
    });
});
