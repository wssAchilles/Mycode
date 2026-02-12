import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { spaceService } from '../../src/services/spaceService';

describe('spaceService.getPostsByIds', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hydrates posts by mixed Mongo _id and news externalId while preserving input order', async () => {
        const objectId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');
        const externalOnlyObjectId = new mongoose.Types.ObjectId('507f191e810c19729de860eb');

        const byObjectId = {
            _id: objectId,
            newsMetadata: { externalId: 'N10001' },
        };
        const byExternalId = {
            _id: externalOnlyObjectId,
            newsMetadata: { externalId: 'N20002' },
        };

        const findSpy = vi
            .spyOn(Post as any, 'find')
            .mockResolvedValue([byObjectId, byExternalId] as any);

        const result = await spaceService.getPostsByIds([
            'N20002',
            objectId.toString(),
            'N40400',
        ]);

        expect(result.map((p) => p._id.toString())).toEqual([
            externalOnlyObjectId.toString(),
            objectId.toString(),
        ]);

        expect(findSpy).toHaveBeenCalledTimes(1);
        expect(findSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                deletedAt: null,
                $or: expect.arrayContaining([
                    expect.objectContaining({
                        _id: expect.objectContaining({
                            $in: expect.arrayContaining([expect.any(mongoose.Types.ObjectId)]),
                        }),
                    }),
                    expect.objectContaining({
                        'newsMetadata.externalId': expect.objectContaining({
                            $in: expect.arrayContaining(['N20002', 'N40400']),
                        }),
                    }),
                ]),
            })
        );
    });
});
