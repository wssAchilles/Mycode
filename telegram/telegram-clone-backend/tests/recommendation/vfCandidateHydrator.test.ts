import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { VFCandidateHydrator } from '../../src/services/recommendation/hydrators/VFCandidateHydrator';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('VFCandidateHydrator', () => {
    it('uses injected VF client when explicitly provided', async () => {
        const postId = oid('507f191e810c19729de8c001');
        const vfClient = {
            checkExtended: vi.fn().mockResolvedValue([
                {
                    postId: postId.toString(),
                    safe: true,
                    level: 'safe',
                    score: 0,
                    violations: [],
                    requiresReview: false,
                },
            ]),
        } as any;
        const hydrator = new VFCandidateHydrator(vfClient);
        const query = createFeedQuery('user', 20);
        const candidate = {
            postId,
            authorId: 'author',
            content: 'safe content',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
        } as any;

        const out = await hydrator.hydrate(query as any, [candidate]);

        expect(vfClient.checkExtended).toHaveBeenCalledWith(
            expect.objectContaining({ skipML: true }),
        );
        expect(out[0].vfResult).toMatchObject({ safe: true, level: 'safe' });
    });

    it('uses local rule-only VF by default without calling an external service', async () => {
        const postId = oid('507f191e810c19729de8c002');
        const hydrator = new VFCandidateHydrator();
        const query = createFeedQuery('user', 20);
        const candidate = {
            postId,
            authorId: 'author',
            content: 'safe recommendation content',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
        } as any;

        expect(hydrator.enable(query as any)).toBe(true);
        const out = await hydrator.hydrate(query as any, [candidate]);

        expect(out[0].vfResult).toMatchObject({
            safe: true,
            reason: 'local_rule_skip_ml',
            level: 'safe',
        });
    });

    it('blocks obvious local rule violations without timing out the serving path', async () => {
        const postId = oid('507f191e810c19729de8c003');
        const hydrator = new VFCandidateHydrator();
        const query = createFeedQuery('user', 20);
        const candidate = {
            postId,
            authorId: 'author',
            content: 'obvious spam content',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
        } as any;

        const out = await hydrator.hydrate(query as any, [candidate]);

        expect(out[0].vfResult).toMatchObject({
            safe: false,
            reason: 'local_rule:spam',
            level: 'blocked',
            requiresReview: true,
        });
    });
});
