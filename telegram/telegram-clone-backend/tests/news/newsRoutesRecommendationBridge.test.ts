import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    logEvent: vi.fn(),
    recordRecommendationFeedback: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('../../src/services/newsService', () => ({
    newsService: {
        logEvent: mocks.logEvent,
        recordRecommendationFeedback: mocks.recordRecommendationFeedback,
    },
}));

vi.mock('../../src/utils/logger', () => ({
    createChildLogger: () => ({
        warn: mocks.logWarn,
        error: mocks.logError,
    }),
}));

describe('news routes recommendation bridge', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        const { default: newsRoutes } = await import('../../src/routes/newsRoutes');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            (req as any).userId = 'user_1';
            next();
        });
        app.use('/api/news', newsRoutes);

        server = app.listen(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('failed to bind test server');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    });

    it('keeps news event writes successful when recommendation feedback bridge fails', async () => {
        mocks.logEvent.mockResolvedValue(undefined);
        mocks.recordRecommendationFeedback.mockRejectedValue(new Error('mongo unavailable'));

        const response = await fetch(`${baseUrl}/api/news/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                newsId: 'news_1',
                eventType: 'click',
                requestId: 'req_news_1',
                rank: 2,
                source: 'NewsAnnSource',
                clientEventId: 'evt_news_1',
            }),
        });

        expect(response.status).toBe(201);
        expect(mocks.logEvent).toHaveBeenCalledWith('user_1', 'news_1', 'click', undefined);
        expect(mocks.recordRecommendationFeedback).toHaveBeenCalledWith({
            userId: 'user_1',
            newsId: 'news_1',
            eventType: 'click',
            dwellMs: undefined,
            requestId: 'req_news_1',
            rank: 2,
            source: 'NewsAnnSource',
            clientEventId: 'evt_news_1',
        });
        expect(mocks.logWarn).toHaveBeenCalledTimes(1);
    });
});
