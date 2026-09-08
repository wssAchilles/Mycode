import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import RealGraphEdge from '../../src/models/RealGraphEdge';
import UserSettings from '../../src/models/UserSettings';
import UserSignal, { SignalType, TargetType } from '../../src/models/UserSignal';
import { realGraphService } from '../../src/services/recommendation/RealGraphService';
import negativeFeedbackRouter from '../../src/routes/space/negativeFeedback';

function undoHandler() {
    const layer = (negativeFeedbackRouter as any).stack.find(
        (candidate: any) => candidate.route?.path === '/users/:id/negative-feedback/:feedbackId/undo'
            && candidate.route?.methods?.post,
    );
    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function response() {
    const res: any = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
}

describe('negative feedback undo cache consistency', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('invalidates edge score caches after undoing a graph contribution', async () => {
        const feedbackId = '507f191e810c19729de8c000';
        const edge = {
            dailyCounts: { followCount: -1 },
            rollupCounts: { followCount: -1, blockCount: 0 },
            markModified: vi.fn(),
            save: vi.fn().mockResolvedValue(undefined),
        };
        const signal = {
            _id: new mongoose.Types.ObjectId(feedbackId),
            userId: 'viewer-1',
            signalType: SignalType.UNFOLLOW,
            targetType: TargetType.USER,
            targetId: 'target-1',
        };
        vi.spyOn(UserSignal, 'findOne').mockResolvedValue(signal as never);
        vi.spyOn(RealGraphEdge, 'findOne').mockResolvedValue(edge as never);
        vi.spyOn(RealGraphEdge, 'computeDecayedSum').mockReturnValue(0);
        vi.spyOn(UserSignal, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
        const invalidate = vi.spyOn(realGraphService, 'invalidateEdgeScoreCaches').mockResolvedValue(undefined);

        const res = response();
        await undoHandler()({ userId: 'viewer-1', params: { id: 'viewer-1', feedbackId } }, res);

        expect(edge.dailyCounts.followCount).toBe(0);
        expect(edge.rollupCounts.followCount).toBe(0);
        expect(invalidate).toHaveBeenCalledWith('viewer-1', 'target-1');
        expect(edge.save.mock.invocationCallOrder[0])
            .toBeLessThan(invalidate.mock.invocationCallOrder[0]);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            removed: expect.objectContaining({ graphUpdated: true }),
        }));
    });

    it('invalidates edge score caches when the edge save rejects', async () => {
        const feedbackId = '507f191e810c19729de8c001';
        const saveError = new Error('edge save failed');
        const edge = {
            dailyCounts: { muteCount: -1 },
            rollupCounts: { muteCount: -1, blockCount: 0 },
            markModified: vi.fn(),
            save: vi.fn().mockRejectedValue(saveError),
        };
        const signal = {
            _id: new mongoose.Types.ObjectId(feedbackId),
            userId: 'viewer-1',
            signalType: SignalType.MUTE,
            targetType: TargetType.USER,
            targetId: 'target-2',
        };
        vi.spyOn(UserSignal, 'findOne').mockResolvedValue(signal as never);
        vi.spyOn(RealGraphEdge, 'findOne').mockResolvedValue(edge as never);
        vi.spyOn(RealGraphEdge, 'computeDecayedSum').mockReturnValue(0);
        vi.spyOn(UserSignal, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
        vi.spyOn(UserSettings, 'removeMutedUser').mockResolvedValue(undefined as never);
        const invalidate = vi.spyOn(realGraphService, 'invalidateEdgeScoreCaches').mockResolvedValue(undefined);

        const res = response();
        await undoHandler()({ userId: 'viewer-1', params: { id: 'viewer-1', feedbackId } }, res);

        expect(invalidate).toHaveBeenCalledWith('viewer-1', 'target-2');
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
