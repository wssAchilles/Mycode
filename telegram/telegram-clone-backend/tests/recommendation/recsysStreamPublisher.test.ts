import { describe, expect, it, vi } from 'vitest';
import {
    isValidSemanticIdTuple,
    RecsysStreamPublisher,
    RECSYS_EVENT_STREAM_KEY,
    RECSYS_EVENT_STREAM_MAX_LEN,
    SidEncoderClient,
} from '../../src/services/recommendation/realtime';

describe('Phase 28D recsysStreamPublisher & SidEncoderClient', () => {
    it('validates 6x256 semantic id tuples strictly', () => {
        expect(isValidSemanticIdTuple([0, 127, 255, 10, 20, 30])).toBe(true);
        expect(isValidSemanticIdTuple([1, 2, 3])).toBe(false);
        expect(isValidSemanticIdTuple([0, 256, 1, 2, 3, 4])).toBe(false);
        expect(isValidSemanticIdTuple([0, -1, 1, 2, 3, 4])).toBe(false);
        expect(isValidSemanticIdTuple([0, 1.5, 1, 2, 3, 4])).toBe(false);
    });

    it('enforces MAXLEN ~ 10000 on VPS Redis stream xadd for graph.edge_delta', async () => {
        const xadd = vi.fn().mockResolvedValue('1794888000000-0');
        const publisher = new RecsysStreamPublisher({
            redisClient: { xadd, status: 'ready' },
        });

        publisher.publishGraphEdgeDelta({
            sourceUserId: 'u_alice',
            targetUserId: 'u_bob',
            edgeOp: 'block',
            timestampMs: 1794888000000,
        });

        await Promise.resolve();

        expect(xadd).toHaveBeenCalledTimes(1);
        const args = xadd.mock.calls[0];
        expect(args[0]).toBe(RECSYS_EVENT_STREAM_KEY);
        expect(args[1]).toBe('MAXLEN');
        expect(args[2]).toBe('~');
        expect(args[3]).toBe(String(RECSYS_EVENT_STREAM_MAX_LEN));
        expect(args[4]).toBe('*');

        const payloadIdx = args.indexOf('payload');
        expect(payloadIdx).toBeGreaterThan(-1);
        const parsed = JSON.parse(args[payloadIdx + 1]);
        expect(parsed).toEqual({
            sourceUserId: 'u_alice',
            targetUserId: 'u_bob',
            edgeOp: 'block',
            weightDelta: -10.0,
            timestampMs: 1794888000000,
        });
    });

    it('drops invalid or mismatched-dim /sid/encode results fail-closed', async () => {
        const sidClient = new SidEncoderClient({ baseUrl: 'http://127.0.0.1:18080' });
        const postSpy = vi.spyOn((sidClient as any).client, 'post').mockResolvedValue({
            data: {
                results: [
                    {
                        postId: 'bad_sids',
                        semanticIds: [1, 2, 3],
                        embedding256d: new Array(256).fill(0.1),
                        embeddingContract: { semantic: true },
                    },
                    {
                        postId: 'bad_dim',
                        semanticIds: [1, 2, 3, 4, 5, 6],
                        embedding256d: [0.1, 0.2],
                        embeddingContract: { semantic: true },
                    },
                    {
                        postId: 'good_post',
                        semanticIds: [10, 20, 30, 40, 50, 60],
                        semanticIdsU64: '123456',
                        embedding256d: new Array(256).fill(0.05),
                        embeddingContract: {
                            embeddingSpace: 'recommendation_two_tower_v3',
                            dimensions: 256,
                            retrievalEmbeddingDim: 256,
                            rankingEmbeddingDim: 256,
                            modelVersion: 'two_tower_v3',
                            artifactVersion: 'v3',
                            producer: 'ml-services',
                            semantic: true,
                        },
                    },
                ],
            },
        });

        const items = await sidClient.encodeBatch([
            { postId: 'bad_sids', content: 'x' },
            { postId: 'bad_dim', content: 'y' },
            { postId: 'good_post', content: 'z' },
        ]);
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(items).toHaveLength(1);
        expect(items[0].postId).toBe('good_post');
        expect(items[0].semanticIds).toEqual([10, 20, 30, 40, 50, 60]);
    });
});
