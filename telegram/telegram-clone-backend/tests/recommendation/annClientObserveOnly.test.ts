import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ANN from '../../src/services/recommendation/clients/ANNClient';

const evidence = {
    embeddingSpace: 'recommendation_two_tower_v1',
    retrievalEmbeddingDim: 256,
    modelVersion: 'model-v1',
    artifactVersion: 'artifact-v1',
    idNamespace: 'mongo_object_id',
    indexVersion: 'index-v1',
};

const request = {
    userId: 'viewer-1',
    keywords: [],
    historyPostIds: [],
    topK: 200,
    expectedEvidence: evidence,
};

describe('HttpAnnClient terminal attempts', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        ['success', [{ postId: '507f191e810c19729de8c001', score: 0.9 }], 'success', 1],
        ['empty', [], 'empty', 0],
    ] as const)('classifies a complete %s response', async (_label, candidates, outcome, returnedK) => {
        const { client, post } = clientWithPost();
        post.mockResolvedValue({ data: { candidates, evidence } });

        await expect(client.retrieve(request)).resolves.toMatchObject({
            outcome,
            requestedK: 200,
            returnedK,
            candidates,
            responseEvidence: evidence,
        });
    });

    it('classifies exhausted non-timeout retries as transport_error', async () => {
        const { client, post } = clientWithPost({ retries: 1, retryDelayMs: 0 });
        post.mockRejectedValue(new Error('connection reset'));

        await expect(client.retrieve(request)).resolves.toMatchObject({
            outcome: 'transport_error',
            requestedK: 200,
            returnedK: 0,
            candidates: [],
        });
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('classifies timeout before transport failure and bounds all retries plus delays by one deadline', async () => {
        vi.useFakeTimers();
        const { client, post } = clientWithPost({ timeoutMs: 50, retries: 5, retryDelayMs: 40 });
        post.mockRejectedValue(new Error('connection reset'));

        const pending = client.retrieve(request);
        const observed = Promise.race([
            pending,
            new Promise<'test_timeout'>((resolve) => setTimeout(() => resolve('test_timeout'), 60)),
        ]);
        await vi.advanceTimersByTimeAsync(60);

        const attempt = await observed;
        expect(attempt).not.toBe('test_timeout');
        expect(attempt).toMatchObject({
            outcome: 'timeout',
            requestedK: 200,
            returnedK: 0,
            candidates: [],
        });
        expect(post.mock.calls.length).toBeLessThan(6);
    });

    it('honors a caller deadline shorter than the configured client deadline', async () => {
        vi.useFakeTimers();
        const { client, post } = clientWithPost({ timeoutMs: 1000, retries: 5, retryDelayMs: 40 });
        post.mockRejectedValue(new Error('connection reset'));

        const pending = client.retrieve(request, { deadlineMs: Date.now() + 50 });
        const observed = Promise.race([
            pending,
            new Promise<'test_timeout'>((resolve) => setTimeout(() => resolve('test_timeout'), 60)),
        ]);
        await vi.advanceTimersByTimeAsync(60);
        const result = await observed;

        await vi.runAllTimersAsync();
        await pending;

        expect(result).not.toBe('test_timeout');
        expect(result).toMatchObject({ outcome: 'timeout', candidates: [] });
        expect(post.mock.calls.length).toBeLessThan(6);
    });

    it('aborts an in-flight request when its deadline expires', async () => {
        vi.useFakeTimers();
        const { client, post } = clientWithPost({ timeoutMs: 25 });
        post.mockImplementation(() => new Promise(() => {}));

        const pending = client.retrieve(request);
        await vi.advanceTimersByTimeAsync(25);
        const attempt = await pending;

        expect(attempt).toMatchObject({
            outcome: 'timeout',
            requestedK: 200,
            returnedK: 0,
            candidates: [],
        });
        expect(post).toHaveBeenCalledTimes(1);
        expect((post.mock.calls[0]?.[2] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
    });

    it.each(Object.keys(evidence) as Array<keyof typeof evidence>)(
        'rejects missing %s response evidence as invalid_response',
        async (field) => {
            const { client, post } = clientWithPost();
            const incomplete = { ...evidence } as Record<string, unknown>;
            delete incomplete[field];
            post.mockResolvedValue({
                data: {
                    candidates: [{ postId: '507f191e810c19729de8c001', score: 0.9 }],
                    evidence: incomplete,
                },
            });

            await expect(client.retrieve(request)).resolves.toMatchObject({
                outcome: 'invalid_response',
                candidates: [],
            });
        },
    );

    it.each(Object.keys(evidence) as Array<keyof typeof evidence>)(
        'rejects mismatched %s response evidence as contract_mismatch',
        async (field) => {
            const { client, post } = clientWithPost();
            const mismatched = {
                ...evidence,
                [field]: field === 'retrievalEmbeddingDim' ? 128 : `other-${field}`,
            };
            post.mockResolvedValue({
                data: {
                    candidates: [{ postId: '507f191e810c19729de8c001', score: 0.9 }],
                    evidence: mismatched,
                },
            });

            await expect(client.retrieve(request)).resolves.toMatchObject({
                outcome: 'contract_mismatch',
                returnedK: 1,
                candidates: [],
                responseEvidence: mismatched,
            });
        },
    );

    it('rejects malformed envelopes and candidates as invalid_response', async () => {
        const { client, post } = clientWithPost();
        post
            .mockResolvedValueOnce({ data: { evidence } })
            .mockResolvedValueOnce({
                data: { candidates: [{ postId: '', score: Number.NaN }], evidence },
            });

        await expect(client.retrieve(request)).resolves.toMatchObject({
            outcome: 'invalid_response',
            candidates: [],
        });
        await expect(client.retrieve(request)).resolves.toMatchObject({
            outcome: 'invalid_response',
            candidates: [],
        });
    });

    it('rejects a response larger than requestedK without exposing candidates', async () => {
        const { client, post } = clientWithPost();
        post.mockResolvedValue({
            data: {
                candidates: Array.from({ length: 201 }, (_, index) => ({
                    postId: `post-${index}`,
                    score: 1 - index / 1000,
                })),
                evidence,
            },
        });

        await expect(client.retrieve(request)).resolves.toMatchObject({
            outcome: 'invalid_response',
            requestedK: 200,
            returnedK: 201,
            candidates: [],
        });
    });

    it.each([
        ['success', 2, [{ postId: '507f191e810c19729de8c001', score: 0.9 }]],
        ['empty', 1, []],
    ] as const)('rejects a forged %s returnedK from an injected client', async (outcome, returnedK, candidates) => {
        const injected = {
            retrieve: vi.fn().mockResolvedValue({
                outcome,
                requestedK: 200,
                returnedK,
                latencyMs: 1,
                candidates,
                responseEvidence: evidence,
            }),
        };

        await expect(ANN.retrieveAnnWithinBudget(injected, request, 100)).resolves.toMatchObject({
            outcome: 'invalid_response',
            requestedK: 200,
            returnedK: 0,
            candidates: [],
        });
    });
});

describe('ANN observe-only evaluation helpers', () => {
    it('deduplicates and sorts evaluation Ks and skips without an independent exact baseline', () => {
        expect(ANN.buildAnnEvaluationKs).toBeTypeOf('function');
        expect(ANN.compareAnnAgainstExact).toBeTypeOf('function');

        const evaluationKs = ANN.buildAnnEvaluationKs(80);
        expect(evaluationKs).toEqual([20, 80, 200]);
        expect(ANN.buildAnnEvaluationKs(120)).toEqual([20, 80, 120, 200]);
        expect(ANN.compareAnnAgainstExact({
            evaluationKs,
            annIds: ['a'],
            annEvidence: evidence,
        })).toEqual({
            status: 'skipped',
            reason: 'exact_baseline_unavailable',
            evaluationKs,
        });
    });

    it('computes recall only when query, corpus, ANN, and exact evidence all match', () => {
        expect(ANN.compareAnnAgainstExact).toBeTypeOf('function');
        const contract = {
            ...evidence,
            metric: 'cosine',
            normalization: 'l2',
            queryVectorDigest: 'sha256:query-vector-v1',
        };
        const compared = ANN.compareAnnAgainstExact({
            evaluationKs: [2],
            annIds: ['a', 'x'],
            annEvidence: evidence,
            queryContract: contract,
            corpusContract: contract,
            exactBaseline: { ids: ['a', 'b'], contract },
        });
        expect(compared).toEqual({
            status: 'compared',
            evaluationKs: [2],
            atK: [{ k: 2, recall: 0.5, overlap: 1 }],
        });

        expect(ANN.compareAnnAgainstExact({
            evaluationKs: [2],
            annIds: ['a', 'x'],
            annEvidence: evidence,
            queryContract: contract,
            corpusContract: { ...contract, normalization: 'none' },
            exactBaseline: { ids: ['a', 'b'], contract },
        })).toMatchObject({
            status: 'skipped',
            reason: 'comparison_contract_mismatch',
        });

        expect(ANN.compareAnnAgainstExact({
            evaluationKs: [2],
            annIds: ['a', 'x'],
            annEvidence: evidence,
            queryContract: contract,
            corpusContract: contract,
            exactBaseline: {
                ids: ['a', 'b'],
                contract: { ...contract, queryVectorDigest: 'sha256:other-query-vector' },
            },
        })).toMatchObject({
            status: 'skipped',
            reason: 'comparison_contract_mismatch',
        });
    });
});

function clientWithPost(overrides: Partial<ANN.AnnClientConfig> = {}) {
    const client = new ANN.HttpAnnClient({
        endpoint: 'http://ann.invalid/ann/retrieve',
        timeoutMs: 100,
        retries: 0,
        retryDelayMs: 0,
        ...overrides,
    });
    const post = vi.fn();
    (client as any).client.post = post;
    return { client, post };
}
