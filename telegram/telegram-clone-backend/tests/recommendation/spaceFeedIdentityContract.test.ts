import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFeedPage: vi.fn(),
}));

vi.mock('../../src/services/spaceService', () => ({
    spaceService: { getFeedPage: mocks.getFeedPage },
}));

import feedRouter from '../../src/routes/space/feed';

function handler(method: 'get' | 'post') {
    const layer = (feedRouter as any).stack.find(
        (candidate: any) => candidate.route?.path === '/feed' && candidate.route?.methods?.[method],
    );
    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function response() {
    const res: any = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
}

function page(requestId: string, decisionId: string, clientRequestId?: string) {
    return {
        candidates: [],
        decisionActionCandidateIds: [],
        hasMore: false,
        servedIdsDelta: [],
        requestId,
        decisionId,
        clientRequestId,
    };
}

describe('space feed server-owned identity', () => {
    beforeEach(() => {
        mocks.getFeedPage.mockReset();
    });

    it('treats POST request_id as client correlation and creates fresh server IDs', async () => {
        const first = page(
            '3bcd1f9b-9800-4bb6-8592-4338d56bf4ae',
            'fd3b9c5a-4208-4181-8f02-a1c20f141625',
            'client-retry-1',
        );
        const second = page(
            '942282e1-f2d4-4522-bbd2-fe5678279154',
            '4ae94c30-3d21-4cb9-8eeb-a6f354b74ac0',
            'client-retry-1',
        );
        mocks.getFeedPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const body = { request_id: 'client-retry-1', decision_id: 'client-forged-decision' };
        const responses = [response(), response()];

        await handler('post')({ userId: 'viewer-1', body }, responses[0]);
        await handler('post')({ userId: 'viewer-1', body }, responses[1]);

        const firstOptions = mocks.getFeedPage.mock.calls[0][4];
        const secondOptions = mocks.getFeedPage.mock.calls[1][4];
        expect(firstOptions.clientRequestId).toBe('client-retry-1');
        expect(secondOptions.clientRequestId).toBe('client-retry-1');
        expect(firstOptions.requestId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(secondOptions.requestId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(firstOptions.requestId).not.toBe('client-retry-1');
        expect(secondOptions.requestId).not.toBe(firstOptions.requestId);
        expect(firstOptions).not.toHaveProperty('decisionId');
        expect(responses[0].json).toHaveBeenCalledWith(expect.objectContaining({
            request_id: first.requestId,
            decision_id: first.decisionId,
            client_request_id: 'client-retry-1',
        }));
        expect(responses[1].json).toHaveBeenCalledWith(expect.objectContaining({
            request_id: second.requestId,
            decision_id: second.decisionId,
        }));
    });

    it('parses consumed GET fields and ignores POST-only fields', async () => {
        const result = page(
            'ff49a8ee-af47-4189-b81d-f22b0b93fc36',
            '1958a2a9-213d-413e-9a09-447489a12422',
        );
        mocks.getFeedPage.mockResolvedValueOnce(result);
        const res = response();
        const cursor = '2026-07-16T06:00:00.000Z';

        await handler('get')({
            userId: 'viewer-1',
            query: {
                limit: '50',
                cursor,
                includeSelf: 'false',
                in_network_only: 'true',
                request_id: '',
                seen_ids: 'ignored-by-simple-get',
            },
        }, res);

        expect(mocks.getFeedPage).toHaveBeenCalledWith(
            'viewer-1',
            50,
            new Date(cursor),
            false,
            {
                requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
                inNetworkOnly: true,
            },
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            request_id: result.requestId,
            decision_id: result.decisionId,
        }));
    });

    it.each([
        ['get', '-1'],
        ['get', '0'],
        ['get', '51'],
        ['get', '20junk'],
        ['get', '0x10'],
        ['get', '1e1'],
        ['get', 'not-a-number'],
        ['post', '20junk'],
        ['post', '0x10'],
        ['post', '1e1'],
    ] as const)(
        'rejects invalid %s limit %s before fetching the feed',
        async (method, limit) => {
            const res = response();
            const req = method === 'get'
                ? { userId: 'viewer-1', query: { limit } }
                : { userId: 'viewer-1', body: { limit } };

            await handler(method)(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'invalid_feed_request',
                details: expect.any(Object),
            });
            expect(mocks.getFeedPage).not.toHaveBeenCalled();
        },
    );

    it('rejects repeated GET cursor values before fetching the feed', async () => {
        const res = response();

        await handler('get')({
            userId: 'viewer-1',
            query: { cursor: ['2026-07-16T06:00:00.000Z', '2026-07-16T05:00:00.000Z'] },
        }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mocks.getFeedPage).not.toHaveBeenCalled();
    });

    it.each([
        ['get', 'not-a-date'],
        ['get', '0'],
        ['post', 'not-a-date'],
        ['post', '0'],
    ] as const)(
        'rejects invalid %s cursor %s before fetching the feed',
        async (method, cursor) => {
            const res = response();
            const req = method === 'get'
                ? { userId: 'viewer-1', query: { cursor } }
                : { userId: 'viewer-1', body: { cursor } };

            await handler(method)(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'invalid_feed_request',
                details: expect.any(Object),
            });
            expect(mocks.getFeedPage).not.toHaveBeenCalled();
        },
    );

    it.each(['get', 'post'] as const)(
        'only attaches decision action identity to served policy posts for %s',
        async (method) => {
            const selfId = '507f191e810c19729de8c000';
            const policyId = '507f191e810c19729de8c001';
            const result = {
                ...page(
                    'ef79a522-848b-43c4-b7f5-64d9cf2c8d99',
                    '55f7275f-6244-4e10-8b62-b93c9c74582d',
                ),
                candidates: [
                    {
                        postId: selfId,
                        authorId: 'viewer-1',
                        content: 'self post',
                        createdAt: new Date('2026-07-16T08:00:00.000Z'),
                    },
                    {
                        postId: policyId,
                        authorId: 'author-a',
                        content: 'policy post',
                        createdAt: new Date('2026-07-16T07:00:00.000Z'),
                    },
                ],
                decisionActionCandidateIds: [policyId],
            };
            mocks.getFeedPage.mockResolvedValueOnce(result);
            const res = response();
            const req = method === 'get'
                ? { userId: 'viewer-1', query: {} }
                : { userId: 'viewer-1', body: {} };

            await handler(method)(req, res);

            const payload = res.json.mock.calls[0][0];
            const [selfPost, policyPost] = payload.posts;
            expect(selfPost._recommendationRequestId).toBeUndefined();
            expect(selfPost._recommendationDecisionId).toBeUndefined();
            expect(selfPost._recommendationContext.decisionId).toBeUndefined();
            expect(selfPost._recommendationContext.servedPosition).toBeUndefined();
            expect(selfPost._recommendationContext.positionContractVersion).toBeUndefined();
            expect(policyPost).toMatchObject({
                _recommendationRequestId: result.requestId,
                _recommendationDecisionId: result.decisionId,
                _recommendationRank: 2,
                _recommendationContext: {
                    requestId: result.requestId,
                    decisionId: result.decisionId,
                    candidateNamespace: 'serving_post_id',
                    candidateId: policyId,
                    servedPosition: 2,
                    positionContractVersion: 'served_position_1_based_v1',
                    rank: 2,
                },
            });
        },
    );
});
