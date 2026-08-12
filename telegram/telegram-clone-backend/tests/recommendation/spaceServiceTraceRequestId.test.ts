import mongoose from 'mongoose';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSpaceFeedMixer: vi.fn(),
    mixerGetFeed: vi.fn(),
    resolveFeedRuntime: vi.fn(),
    authorHydrate: vi.fn(),
    recordRecommendationTrace: vi.fn(),
}));

vi.mock('../../src/services/recommendation', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/services/recommendation')>(),
    getSpaceFeedMixer: mocks.getSpaceFeedMixer,
}));

vi.mock('../../src/services/recommendation/feed/rustFeedRuntime', () => ({
    resolveFeedRuntime: mocks.resolveFeedRuntime,
}));

vi.mock('../../src/services/recommendation/hydrators/AuthorInfoHydrator', () => ({
    AuthorInfoHydrator: class {
        hydrate = mocks.authorHydrate;
    },
}));

vi.mock('../../src/services/recommendation/observability/recommendationTrace', () => ({
    recordRecommendationTrace: mocks.recordRecommendationTrace,
}));

import { spaceService } from '../../src/services/spaceService';

describe('spaceService trace request ownership', () => {
    const originalMlFeedEnabled = process.env.ML_FEED_ENABLED;

    beforeEach(() => {
        vi.restoreAllMocks();
        process.env.ML_FEED_ENABLED = 'false';
        mocks.getSpaceFeedMixer.mockReset().mockReturnValue({
            getFeed: mocks.mixerGetFeed,
        });
        mocks.mixerGetFeed.mockReset().mockResolvedValue([]);
        mocks.authorHydrate.mockReset().mockImplementation(async (_query, candidates) => candidates);
        mocks.recordRecommendationTrace.mockReset().mockResolvedValue(undefined);
        mocks.resolveFeedRuntime.mockReset().mockImplementation(async (input) => {
            const feed = await input.runBaselineFeed();
            return {
                feed,
                finalFeedQuery: input.createBaseQuery(),
                debugInfo: {
                    requestId: input.requestId,
                    pipeline: 'node_baseline',
                    runtimeMode: 'off',
                    configuredServingOwner: 'node',
                    servingOwner: 'node',
                    owner: 'node',
                    fallbackMode: 'node_local_mixer',
                    selectedCount: 0,
                    sourceCounts: {},
                    generatedAt: '2026-07-15T12:00:00.000Z',
                },
            };
        });
    });

    afterAll(() => {
        if (originalMlFeedEnabled === undefined) {
            delete process.env.ML_FEED_ENABLED;
        } else {
            process.env.ML_FEED_ENABLED = originalMlFeedEnabled;
        }
    });

    it('passes one server decision ID through each query and returns fresh decisions', async () => {
        const first = await spaceService.getFeedPage('trace-request-user', 1, undefined, false, {
            requestId: 'b66ef958-9191-44a2-8715-da2a60913cdf',
            clientRequestId: 'client-retry-1',
        });
        const second = await spaceService.getFeedPage('trace-request-user', 1, undefined, false, {
            requestId: 'eb4ec039-a59f-4bb8-9282-b1e13764214f',
            clientRequestId: 'client-retry-1',
        });

        const firstRuntimeInput = mocks.resolveFeedRuntime.mock.calls[0][0];
        const firstMixerOptions = mocks.mixerGetFeed.mock.calls[0][4];
        const firstQuery = firstRuntimeInput.createBaseQuery();
        const secondQuery = mocks.resolveFeedRuntime.mock.calls[1][0].createBaseQuery();
        expect(firstMixerOptions.requestId).toBe(firstRuntimeInput.requestId);
        expect(firstMixerOptions.decisionId).toBe(firstQuery.decisionId);
        expect(firstQuery.clientRequestId).toBe('client-retry-1');
        expect(first.requestId).toBe(firstQuery.requestId);
        expect(first.decisionId).toBe(firstQuery.decisionId);
        expect(first.clientRequestId).toBe('client-retry-1');
        expect(second.decisionId).toBe(secondQuery.decisionId);
        expect(second.decisionId).not.toBe(first.decisionId);
    });

    it('keeps server identity authoritative over runtime page metadata', async () => {
        const resolveRuntime = mocks.resolveFeedRuntime.getMockImplementation()!;
        mocks.resolveFeedRuntime.mockImplementationOnce(async (input) => ({
            ...await resolveRuntime(input),
            pageMeta: {
                requestId: 'forged-runtime-request',
                decisionId: 'forged-runtime-decision',
                clientRequestId: 'forged-runtime-client',
            },
        }));

        const page = await spaceService.getFeedPage('trace-request-user', 1, undefined, false, {
            requestId: 'server-owned-request',
            clientRequestId: 'server-owned-client',
        });
        const query = mocks.resolveFeedRuntime.mock.calls[0][0].createBaseQuery();

        expect(query).toMatchObject({
            requestId: 'server-owned-request',
            clientRequestId: 'server-owned-client',
        });
        expect(page).toMatchObject({
            requestId: query.requestId,
            decisionId: query.decisionId,
            clientRequestId: query.clientRequestId,
        });
    });

    it('records the returned post-self page once with the independent policy feed', async () => {
        const selectedA = {
            postId: new mongoose.Types.ObjectId('507f191e810c19729de8c001'),
            authorId: 'author-a',
            content: 'selected A',
            createdAt: new Date('2026-07-16T07:00:00.000Z'),
            isReply: false,
            isRepost: false,
            recallSource: 'FollowingSource',
        };
        const selectedB = {
            ...selectedA,
            postId: new mongoose.Types.ObjectId('507f191e810c19729de8c002'),
            authorId: 'author-b',
            content: 'selected B',
            createdAt: new Date('2026-07-16T06:00:00.000Z'),
        };
        const selfId = new mongoose.Types.ObjectId('507f191e810c19729de8c000');
        mocks.mixerGetFeed.mockResolvedValueOnce([selectedA, selectedB]);
        vi.spyOn(spaceService as any, 'getUserPosts').mockResolvedValueOnce([{
            toObject: () => ({
                _id: selfId,
                authorId: 'trace-request-user',
                content: 'self post',
                createdAt: new Date('2026-07-16T08:00:00.000Z'),
            }),
        }]);
        vi.spyOn(spaceService as any, 'getUserMap').mockResolvedValueOnce(new Map([
            ['trace-request-user', { id: 'trace-request-user', username: 'viewer' }],
        ]));
        const recorder = vi.spyOn(spaceService as any, 'recordServedFeedTrace')
            .mockResolvedValue(undefined);

        const page = await spaceService.getFeedPage(
            'trace-request-user',
            2,
            undefined,
            true,
            { requestId: 'ce65f95a-c904-4c31-a28b-02bb61b14d75' },
        );

        expect(page.candidates.map((candidate) => candidate.postId.toString())).toEqual([
            selfId.toString(),
            selectedA.postId.toString(),
        ]);
        expect(page.decisionActionCandidateIds).toEqual([
            selectedA.postId.toString(),
        ]);
        expect(recorder).toHaveBeenCalledTimes(1);
        const [query, policyFeed, finalServedCandidates, , , , decisionAt] = recorder.mock.calls[0];
        expect(query).toMatchObject({ requestId: page.requestId, decisionId: page.decisionId });
        expect(policyFeed.map((candidate: any) => candidate.postId.toString())).toEqual([
            selectedA.postId.toString(),
            selectedB.postId.toString(),
        ]);
        expect(finalServedCandidates).toBe(page.candidates);
        expect(decisionAt).toBeInstanceOf(Date);
    });
});
