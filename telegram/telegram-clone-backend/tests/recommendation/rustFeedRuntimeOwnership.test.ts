import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getMode: vi.fn(),
    getCandidates: vi.fn(),
    recordPrimary: vi.fn(),
    recordShadow: vi.fn(),
    recordTrace: vi.fn(),
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

vi.mock('../../src/services/recommendation/observability/recommendationTrace', () => ({
    recordRecommendationTrace: mocks.recordTrace,
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
        mocks.recordTrace.mockReset();
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

        const result = await resolveFeedRuntime(makeInput({ inNetworkOnly: true }));

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

    it('fails closed when Rust abstains from ranked-feed continuation', async () => {
        mocks.getMode.mockReturnValue('primary');
        mocks.getCandidates.mockResolvedValue(
            rustResult([rustCandidatePayload], 'ranked_cursor_abstention_v1'),
        );

        const result = await resolveFeedRuntime(makeInput());

        expect(result.pageMeta).toMatchObject({
            hasMore: false,
            continuationAbstained: true,
            rustServing: {
                cursorMode: 'ranked_cursor_abstention_v1',
                hasMore: false,
            },
        });
        expect(result.pageMeta?.nextCursor).toBeUndefined();
        expect(result.pageMeta?.rustServing?.nextCursor).toBeUndefined();
        expect(result.debugInfo.degradedReasons).toContain('ranked_cursor_abstention');
    });

    it('fails closed when a general-feed Rust receipt uses the legacy cursor mode', async () => {
        mocks.getMode.mockReturnValue('primary');
        mocks.getCandidates.mockResolvedValue(rustResult([rustCandidatePayload]));

        const result = await resolveFeedRuntime(makeInput());

        expect(result.pageMeta).toMatchObject({
            hasMore: false,
            continuationAbstained: true,
            rustServing: {
                cursorMode: 'created_at_desc_v1',
            },
        });
        expect(result.pageMeta?.nextCursor).toBeUndefined();
        expect(result.pageMeta?.rustServing?.nextCursor).toBeUndefined();
        expect(result.debugInfo.degradedReasons).toContain('ranked_cursor_abstention');
    });

    it('rejects an incoming general-feed cursor before Rust or Node retrieval', async () => {
        mocks.getMode.mockReturnValue('primary');
        const input = makeInput({
            cursor: new Date('2026-07-14T00:00:00.000Z'),
        });

        const result = await resolveFeedRuntime(input);

        expect(result.feed).toEqual([]);
        expect(result.pageMeta).toMatchObject({
            hasMore: false,
            continuationAbstained: true,
        });
        expect(result.pageMeta?.nextCursor).toBeUndefined();
        expect(result.debugInfo.degradedReasons).toContain('ranked_cursor_abstention');
        expect(mocks.getCandidates).not.toHaveBeenCalled();
        expect(input.runBaselineFeed).not.toHaveBeenCalled();
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
        expect(result.pageMeta).toMatchObject({
            hasMore: false,
            continuationAbstained: true,
        });
        expect(result.pageMeta?.nextCursor).toBeUndefined();
        expect(result.debugInfo.degradedReasons).toContain('ranked_cursor_abstention');
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
        expect(result.pageMeta).toMatchObject({
            hasMore: false,
            continuationAbstained: true,
        });
        expect(result.pageMeta?.nextCursor).toBeUndefined();
        expect(result.debugInfo.degradedReasons).toContain('ranked_cursor_abstention');
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
            fallbackMode: 'shadow_compare_only',
        });
        expect(result.debugInfo.fallbackOwner).toBeUndefined();
        expect(result.debugInfo.fallbackReason).toBeUndefined();
        expect(result.pageMeta).toBeUndefined();
    });

    it('returns the Node baseline before a pending shadow evaluation settles', async () => {
        mocks.getMode.mockReturnValue('shadow');
        let resolveShadow!: (value: ReturnType<typeof rustResult>) => void;
        mocks.getCandidates.mockReturnValue(new Promise((resolve) => {
            resolveShadow = resolve;
        }));

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            resolveFeedRuntime(makeInput()),
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('shadow blocked baseline')), 50);
            }),
        ]);
        if (timeoutId) clearTimeout(timeoutId);

        expect(result).toMatchObject({
            feed: [nodeCandidate],
            debugInfo: {
                servingOwner: 'node',
                fallbackMode: 'shadow_compare_only',
            },
        });

        resolveShadow(rustResult([rustCandidatePayload]));
        await vi.waitFor(() => expect(mocks.recordShadow).toHaveBeenCalledTimes(1));
        expect(mocks.recordTrace).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'runtime-request' }),
            [nodeCandidate],
            expect.objectContaining({
                shadowComparison: {
                    overlapCount: 0,
                    overlapRatio: 0,
                    selectedCount: 1,
                    baselineCount: 1,
                },
            }),
        );
        expect(mocks.recordTrace.mock.calls[0][2]).not.toHaveProperty('runtimeMode');
        expect(mocks.recordTrace.mock.calls[0][2]).not.toHaveProperty('servingOwner');
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

function makeInput(options: {
    inNetworkOnly?: boolean;
    cursor?: Date;
} = {}) {
    return {
        userId: 'runtime-user',
        limit: 10,
        requestId: 'runtime-request',
        createBaseQuery: () => createFeedQuery('runtime-user', 10, options.inNetworkOnly ?? false, {
            requestId: 'runtime-request',
            cursor: options.cursor,
        }),
        withFeedTrendKeywords: async (query: ReturnType<typeof createFeedQuery>) => query,
        runBaselineFeed: vi.fn().mockResolvedValue([nodeCandidate]),
    };
}

function rustResult(candidates: any[], cursorMode = 'created_at_desc_v1') {
    const continuationAbstained = cursorMode === 'ranked_cursor_abstention_v1';
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
            serving: {
                cursorMode,
                hasMore: !continuationAbstained,
                nextCursor: continuationAbstained ? undefined : 'rust-next',
            },
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
