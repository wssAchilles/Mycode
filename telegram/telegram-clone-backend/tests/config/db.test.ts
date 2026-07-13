import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const URI_A = 'mongodb://reader-a@localhost:27017/telegram';
const URI_B = 'mongodb://reader-b@localhost:27017/telegram';

describe('connectMongoDB ownership', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.resetModules();
        delete process.env.MONGODB_RECONNECT_DELAY_MS;
    });

    it('keeps one stable handler per event and reconnects once with the owned URI/options', async () => {
        vi.useFakeTimers();
        process.env.MONGODB_RECONNECT_DELAY_MS = '5';
        const harness = await loadDb();

        await harness.db.connectMongoDB({ uri: URI_A, autoIndex: false, autoCreate: false });
        const ownedOptions = harness.mongoose.connect.mock.calls[0][1];
        await harness.db.connectMongoDB({ uri: URI_A, autoIndex: false, autoCreate: false });

        expect(harness.connection.listenerCount('error')).toBe(1);
        expect(harness.connection.listenerCount('disconnected')).toBe(1);

        harness.mongoose.connect.mockClear();
        harness.connection.readyState = 0;
        harness.connection.emit('disconnected');
        await vi.advanceTimersByTimeAsync(5);

        expect(harness.mongoose.connect).toHaveBeenCalledTimes(1);
        expect(harness.mongoose.connect).toHaveBeenCalledWith(URI_A, ownedOptions);
    });

    it('fails closed before mongoose.connect when an active connection owns another URI', async () => {
        const harness = await loadDb();
        await harness.db.connectMongoDB({ uri: URI_A });

        await expect(harness.db.connectMongoDB({ uri: URI_B }))
            .rejects
            .toThrow(/^mongodb_connection_uri_change_forbidden:/);
        expect(harness.mongoose.connect).toHaveBeenCalledTimes(1);
    });

    it('does not replace the owned URI while a reconnect is pending', async () => {
        vi.useFakeTimers();
        const harness = await loadDb();
        await harness.db.connectMongoDB({ uri: URI_A });
        harness.connection.readyState = 0;
        harness.connection.emit('disconnected');

        await expect(harness.db.connectMongoDB({ uri: URI_B }))
            .rejects
            .toThrow(/^mongodb_connection_uri_change_forbidden:/);
        expect(harness.mongoose.connect).toHaveBeenCalledTimes(1);
    });

    it('allows URI replacement only while disconnected with no pending reconnect', async () => {
        const harness = await loadDb();
        await harness.db.connectMongoDB({ uri: URI_A });
        harness.connection.readyState = 0;

        await harness.db.connectMongoDB({ uri: URI_B });

        expect(harness.mongoose.connect).toHaveBeenNthCalledWith(2, URI_B, expect.any(Object));
    });

    it('suppresses connection and reconnect lifecycle logs in quiet mode', async () => {
        vi.useFakeTimers();
        process.env.MONGODB_RECONNECT_DELAY_MS = '5';
        const harness = await loadDb();
        await harness.db.connectMongoDB({ uri: URI_A, quiet: true });
        harness.mongoose.connect.mockRejectedValueOnce(new Error('reconnect failed'));
        harness.connection.readyState = 0;
        harness.connection.emit('error', new Error('tls failure'));
        await vi.advanceTimersByTimeAsync(5);

        expect(harness.log.info).not.toHaveBeenCalled();
        expect(harness.log.warn).not.toHaveBeenCalled();
        expect(harness.log.error).not.toHaveBeenCalled();
    });

    it('preserves connection logging by default', async () => {
        const harness = await loadDb();

        await harness.db.connectMongoDB({ uri: URI_A });

        expect(harness.log.info).toHaveBeenCalled();
    });

    it('owns shutdown by cancelling reconnect, detaching its handlers, and resetting URI ownership', async () => {
        vi.useFakeTimers();
        process.env.MONGODB_RECONNECT_DELAY_MS = '5';
        const harness = await loadDb();
        await harness.db.connectMongoDB({ uri: URI_A });
        harness.connection.readyState = 0;
        harness.connection.emit('disconnected');
        harness.mongoose.connect.mockClear();

        await harness.db.disconnectMongoDB();
        await vi.advanceTimersByTimeAsync(5);

        expect(harness.mongoose.connect).not.toHaveBeenCalled();
        expect(harness.connection.listenerCount('error')).toBe(0);
        expect(harness.connection.listenerCount('disconnected')).toBe(0);
        expect(harness.mongoose.disconnect).toHaveBeenCalledTimes(1);

        await harness.db.connectMongoDB({ uri: URI_B });
        expect(harness.mongoose.connect).toHaveBeenCalledWith(URI_B, expect.any(Object));
    });
});

async function loadDb() {
    vi.resetModules();
    const connection = Object.assign(new EventEmitter(), { readyState: 0 });
    const connect = vi.fn(async () => {
        connection.readyState = 1;
    });
    const disconnect = vi.fn(async () => {
        connection.readyState = 0;
        connection.emit('disconnected');
    });
    const mongoose = { connect, disconnect, connection };
    const log = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };

    vi.doMock('mongoose', () => ({ default: mongoose }));
    vi.doMock('dotenv', () => ({ default: { config: vi.fn() } }));
    vi.doMock('../../src/utils/logger', () => ({
        createChildLogger: vi.fn(() => log),
    }));

    const db = await import('../../src/config/db');
    return { db, mongoose, connection, log };
}
