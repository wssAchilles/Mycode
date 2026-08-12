import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    logEvent: vi.fn(),
    logBatch: vi.fn(),
}));

vi.mock('../../src/services/eventStreamService', () => ({
    getEventStreamService: () => mocks,
}));

import analyticsRouter from '../../src/routes/analyticsRoutes';

function postHandler(path: string) {
    const layer = (analyticsRouter as any).stack.find(
        (candidate: any) => candidate.route?.path === path && candidate.route?.methods?.post,
    );
    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function response() {
    const res: any = {
        status: vi.fn(),
        json: vi.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
}

describe('analytics position ingestion', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes a single external 0-based position and overwrites forged contract metadata', async () => {
        await postHandler('/events')({
            userId: 'authenticated-user',
            body: {
                type: 'impression',
                postId: 'post-1',
                userId: 'forged-user',
                metadata: {
                    position: 0,
                    decisionId: 'fd3b9c5a-4208-4181-8f02-a1c20f141625',
                    candidateNamespace: 'serving_post_id',
                    candidateId: 'post-1',
                    servedPosition: 99,
                    positionContractVersion: 'client_forgery',
                },
            },
        }, response());

        expect(mocks.logEvent).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'authenticated-user',
            metadata: {
                servedPosition: 1,
                positionContractVersion: 'served_position_1_based_v1',
                decisionId: 'fd3b9c5a-4208-4181-8f02-a1c20f141625',
                candidateNamespace: 'serving_post_id',
                candidateId: 'post-1',
            },
        }));
        expect(mocks.logEvent.mock.calls[0][0].metadata).not.toHaveProperty('position');
    });

    it('normalizes batch positions and drops unsafe, negative, fractional, and missing values', async () => {
        const positions = [19, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER, undefined];
        await postHandler('/events/batch')({
            user: { id: 'authenticated-user' },
            body: {
                events: positions.map((position, index) => ({
                    type: 'impression',
                    postId: `post-${index}`,
                    userId: `forged-user-${index}`,
                    metadata: position === undefined ? {} : {
                        position,
                        decisionId: 'not-a-uuid',
                        candidateNamespace: 'not-a-namespace',
                        candidateId: '',
                    },
                })),
            },
        }, response());

        const events = mocks.logBatch.mock.calls[0][0];
        expect(events.map((event: any) => event.userId)).toEqual(
            positions.map(() => 'authenticated-user'),
        );
        expect(events.map((event: any) => event.metadata.servedPosition)).toEqual([
            20,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
        expect(events[0].metadata.positionContractVersion).toBe('served_position_1_based_v1');
        for (const event of events.slice(1)) {
            expect(event.metadata).not.toHaveProperty('servedPosition');
            expect(event.metadata).not.toHaveProperty('positionContractVersion');
            expect(event.metadata).not.toHaveProperty('position');
            expect(event.metadata).not.toHaveProperty('decisionId');
            expect(event.metadata).not.toHaveProperty('candidateNamespace');
            expect(event.metadata).not.toHaveProperty('candidateId');
        }
    });
});
