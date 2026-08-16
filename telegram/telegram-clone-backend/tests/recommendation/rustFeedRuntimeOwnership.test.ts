import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getMode: vi.fn(),
    getCandidates: vi.fn(),
    recordPrimary: vi.fn(),
    recordShadow: vi.fn(),
}));

vi.mock('../../src/services/recommendation/clients/RustRecommendationClient', () => ({
    RustRecommendationClient: class {
        getCandidates = mocks.getCandidates;
    },
    getDefaultRustRecommendationBaseUrl: () => 'http://recommendation.test',
    getRustRecommendationMode: mocks.getMode,
    getRustRecommendationTimeoutMs: () => 100,
}));

vi.mock('../../src/services/recommendation/rust/runtimeMetrics', () => ({
    recommendationRuntimeMetrics: {
        recordPrimary: mocks.recordPrimary,
        recordShadow: mocks.recordShadow,
    },
}));

import { resolveFeedRuntime } from '../../src/services/recommendation/feed/rustFeedRuntime';
import { buildSpaceFeedDebugInfo } from '../../src/services/recommendation/feed/debugInfo';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const nodeCandidate = makeCandidate('507f191e810c19729de88001', 'node-author', 'FollowingSource');
const rustCandidatePayload = {
    ...makeCandidate('507f191e810c19729de88002', 'rust-author', 'GraphSource'),
    postId: '507f191e810c19729de88002',
    createdAt: '2026-07-15T00:00:00.000Z',
};

describe('Rust feed runtime ownership', () => {
    beforeEach(() => {
        mocks.getMode.mockReset();
        mocks.getCandidates.mockReset();
        mocks.recordPrimary.mockReset();
        mocks.recordShadow.mockReset();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('keeps off mode entirely on Node without Rust evaluation or fallback', async () => {
        mocks.getMode.mockReturnValue('off');

        const result = await resolveFeedRuntime(makeInput());

        expect(result.feed).toEqual([nodeCandidate]);
        expect(result.debugInfo).toMatchObject({
            runtimeMode: 'off',
            configuredServingOwner: 'node',
            servingOwner: 'node',
            owner: 'node',
        });
        expect(result.debugInfo.evaluatedOwner).toBeUndefined();
        expect(result.debugInfo.fallbackReason).toBeUndefined();
        expect(result.pageMeta).toBeUndefined();
        expect(mocks.getCandidates).not.toHaveBeenCalled();
    });

    it('records Rust as the actual serving owner on primary success', async () => {
        mocks.getMode.mockReturnValue('primary');
        mocks.getCandidates.mockResolvedValue(rustResult([rustCandidatePayload]));

        const result = await resolveFeedRuntime(makeInput());

        expect(result.feed[0].authorId).toBe('rust-author');
        expect(result.debugInfo).toMatchObject({
            runtimeMode: 'primary',
            configuredServingOwner: 'rust',
            servingOwner: 'rust',
            fallbackOwner: 'node',
            owner: 'rust',
        });
        expect(result.debugInfo.fallbackReason).toBeUndefined();
        expect(result.pageMeta).toMatchObject({
            hasMore: true,
            nextCursor: 'rust-next',
            rustServing: {
                cursor: 'rust-cursor',
                nextCursor: 'rust-next',
            },
        });
    });

    it('returns only Node page truth when Rust primary selects nothing', async () => {
        mocks.getMode.mockReturnValue('primary');
        mocks.getCandidates.mockResolvedValue(rustResult([]));

        const result = await resolveFeedRuntime(makeInput());

        expect(result.feed).toEqual([nodeCandidate]);
        expect(result.debugInfo).toMatchObject({
            runtimeMode: 'primary',
            configuredServingOwner: 'rust',
            servingOwner: 'node',
            fallbackOwner: 'node',
            fallbackReason: 'rust_primary_empty_fallback_node',
            owner: 'node',
        });
        expect(result.pageMeta).toBeUndefined();
        expect(result.rustTraceForServedFeed).toBeUndefined();
    });

    it('returns only Node page truth when Rust primary errors', async () => {
        mocks.getMode.mockReturnValue('primary');
        mocks.getCandidates.mockRejectedValue(new Error('rust unavailable'));

        const result = await resolveFeedRuntime(makeInput());

        expect(result.feed).toEqual([nodeCandidate]);
        expect(result.debugInfo).toMatchObject({
            runtimeMode: 'primary',
            configuredServingOwner: 'rust',
            servingOwner: 'node',
            fallbackOwner: 'node',
            fallbackReason: 'rust_primary_error_fallback_node',
            owner: 'node',
        });
        expect(result.pageMeta).toBeUndefined();
        expect(result.rustTraceForServedFeed).toBeUndefined();
    });

    it('keeps shadow evaluation failure as Node serving rather than fallback', async () => {
        mocks.getMode.mockReturnValue('shadow');
        mocks.getCandidates.mockRejectedValue(new Error('shadow unavailable'));

        const result = await resolveFeedRuntime(makeInput());

        expect(result.feed).toEqual([nodeCandidate]);
        expect(result.debugInfo).toMatchObject({
            runtimeMode: 'shadow',
            configuredServingOwner: 'node',
            servingOwner: 'node',
            evaluatedOwner: 'rust',
            owner: 'node',
            fallbackMode: 'shadow_failed',
        });
        expect(result.debugInfo.fallbackOwner).toBeUndefined();
        expect(result.debugInfo.fallbackReason).toBeUndefined();
        expect(result.pageMeta).toBeUndefined();
    });

    it('counts prototype-like source names as ordinary feed sources', () => {
        const result = buildSpaceFeedDebugInfo([
            makeCandidate('507f191e810c19729de88003', 'author-a', '__proto__'),
            makeCandidate('507f191e810c19729de88004', 'author-b', 'constructor'),
            makeCandidate('507f191e810c19729de88005', 'author-c', 'toString'),
        ], {
            pipeline: 'node_baseline',
            runtimeMode: 'off',
            configuredServingOwner: 'node',
            servingOwner: 'node',
        });

        for (const source of ['__proto__', 'constructor', 'toString']) {
            expect(Object.prototype.hasOwnProperty.call(result.selectedSourceCounts, source)).toBe(true);
            expect(result.selectedSourceCounts[source]).toBe(1);
        }
    });
});

function makeInput() {
    return {
        userId: 'runtime-user',
        limit: 10,
        requestId: 'runtime-request',
        createBaseQuery: () => createFeedQuery('runtime-user', 10, false, {
            requestId: 'runtime-request',
        }),
        withFeedTrendKeywords: async (query: ReturnType<typeof createFeedQuery>) => query,
        runBaselineFeed: vi.fn().mockResolvedValue([nodeCandidate]),
    };
}

function rustResult(candidates: any[]) {
    return {
        candidates,
        hasMore: true,
        nextCursor: 'rust-next',
        servingVersion: 'rust-v1',
        stableOrderKey: 'stable-key',
        cursor: 'rust-cursor',
        servedStateVersion: 'served-v1',
        summary: {
            owner: 'rust',
            fallbackMode: 'none',
            degradedReasons: [],
        },
    };
}

function makeCandidate(postId: string, authorId: string, recallSource: string) {
    return {
        postId: new mongoose.Types.ObjectId(postId),
        modelPostId: postId,
        authorId,
        content: 'runtime candidate',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
        inNetwork: true,
        isNews: false,
        recallSource,
        score: 1,
    } as any;
}
