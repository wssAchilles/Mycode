import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    recordInteractionsBatch: vi.fn(),
}));

vi.mock('../../src/models/UserAction', () => ({
    default: {
        find: mocks.find,
    },
    ActionType: {
        LIKE: 'like',
    },
}));

vi.mock('../../src/models/UserSignal', () => ({
    default: {},
    ProductSurface: {},
    SignalType: { FAVORITE: 'favorite' },
    TargetType: { POST: 'post' },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    InteractionType: {},
}));

vi.mock('../../src/services/recommendation/RealGraphService', () => ({
    realGraphService: {
        recordInteractionsBatch: mocks.recordInteractionsBatch,
    },
}));

vi.mock('../../src/config/db', () => ({
    connectMongoDB: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
    redis: { disconnect: vi.fn() },
}));

import { replayUserActionsToSignals } from '../../src/scripts/replayUserActionsToSignals';

describe('replayUserActionsToSignals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps same-timestamp actions reachable across replay batches', async () => {
        const timestamp = new Date('2026-08-25T00:00:00.000Z');
        const since = new Date('2026-08-24T00:00:00.000Z');
        const action = (id: string) => ({
            _id: id,
            action: 'like',
            targetPostId: 'post-1',
            userId: 'viewer-1',
            timestamp,
        });
        const pages = [[action('action-3'), action('action-2')], [action('action-1')], []];
        const queries: Array<Record<string, unknown>> = [];
        let pageIndex = 0;
        mocks.find.mockImplementation((query: Record<string, unknown>) => {
            queries.push(query);
            return {
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(pages[pageIndex++]),
            };
        });

        const result = await replayUserActionsToSignals({
            dryRun: true,
            limit: 10,
            batchSize: 2,
            since,
        });

        expect(result).toEqual({
            dryRun: true,
            scanned: 3,
            signalCandidates: 3,
            insertedSignals: 0,
            realGraphInteractions: 0,
        });
        expect(queries[0]).toEqual({
            action: { $in: ['like'] },
            targetPostId: { $exists: true, $ne: null },
            timestamp: { $gte: since },
        });
        expect(queries[1]).toEqual({
            action: { $in: ['like'] },
            targetPostId: { $exists: true, $ne: null },
            $or: [
                { timestamp: { $gte: since, $lt: timestamp } },
                { timestamp, _id: { $lt: 'action-2' } },
            ],
        });
    });
});
