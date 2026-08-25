import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/redis', () => ({
    redis: {
        del: vi.fn().mockResolvedValue(1),
    },
}));

import UserSignal, { ProductSurface, SignalType, TargetType } from '../../src/models/UserSignal';
import { userSignalService } from '../../src/services/recommendation/UserSignalService';

describe('UserSignalService graceful shutdown', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('waits for in-flight and final buffered writes before stopping', async () => {
        const writeFinished: Array<Promise<void>> = [];
        const resolveWrite: Array<() => void> = [];
        const writeBatch = vi
            .spyOn(UserSignal, 'logSignalsBatch')
            .mockImplementation(async () => {
                const write = new Promise<void>((resolve) => {
                    resolveWrite.push(resolve);
                });
                writeFinished.push(write);
                await write;
            });

        const signal = {
            userId: 'user-1',
            signalType: SignalType.TWEET_CLICK,
            targetId: 'post-1',
            targetType: TargetType.POST,
            productSurface: ProductSurface.SPACE_FEED,
        } as const;

        await userSignalService.logSignal(signal);
        const inFlightFlush = userSignalService.flush();
        await Promise.resolve();

        await userSignalService.logSignal({
            ...signal,
            targetId: 'post-2',
        });

        let stopped = false;
        const stopPromise = userSignalService.stop().then(() => {
            stopped = true;
        });
        await Promise.resolve();

        expect(writeBatch).toHaveBeenCalledTimes(1);
        expect(stopped).toBe(false);

        resolveWrite[0]();
        await inFlightFlush;
        await Promise.resolve();
        expect(writeBatch).toHaveBeenCalledTimes(2);
        expect(stopped).toBe(false);

        resolveWrite[1]();
        await stopPromise;
        expect(stopped).toBe(true);
        expect(writeFinished).toHaveLength(2);
    });

    it('waits for direct batch writes that bypass the buffer', async () => {
        let resolveWrite!: () => void;
        const writeFinished = new Promise<void>((resolve) => {
            resolveWrite = resolve;
        });
        const writeBatch = vi
            .spyOn(UserSignal, 'logSignalsBatch')
            .mockReturnValue(writeFinished as ReturnType<typeof UserSignal.logSignalsBatch>);

        const directWrite = userSignalService.logSignalsBatch([{
            userId: 'user-1',
            signalType: SignalType.TWEET_CLICK,
            targetId: 'post-3',
            targetType: TargetType.POST,
            productSurface: ProductSurface.SPACE_FEED,
        }]);
        await Promise.resolve();

        let stopped = false;
        const stopPromise = userSignalService.stop().then(() => {
            stopped = true;
        });
        await Promise.resolve();

        expect(writeBatch).toHaveBeenCalledTimes(1);
        expect(stopped).toBe(false);

        resolveWrite();
        await directWrite;
        await stopPromise;
        expect(stopped).toBe(true);
    });
});
