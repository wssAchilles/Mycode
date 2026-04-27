import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { VFCandidateHydrator } from '../../src/services/recommendation/hydrators/VFCandidateHydrator';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('VFCandidateHydrator', () => {
    it('uses rule-only VF by default on the recommendation serving path', async () => {
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
});
