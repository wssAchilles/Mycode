import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    newsUserEventCreate: vi.fn(),
    newsArticleIncrement: vi.fn(),
    newsArticleFindByPk: vi.fn(),
    newsArticleFindOne: vi.fn(),
    newsArticleCreate: vi.fn(),
    newsStorageSaveContent: vi.fn(),
    newsStorageSaveImageFromUrls: vi.fn(),
    recordRecommendationEvent: vi.fn(),
}));

vi.mock('../../src/models/NewsUserEvent', () => ({
    default: {
        create: mocks.newsUserEventCreate,
    },
}));

vi.mock('../../src/models/NewsArticle', () => ({
    default: {
        increment: mocks.newsArticleIncrement,
        findByPk: mocks.newsArticleFindByPk,
        findOne: mocks.newsArticleFindOne,
        create: mocks.newsArticleCreate,
    },
}));

vi.mock('../../src/models/NewsSource', () => ({
    default: {},
}));

vi.mock('../../src/models/NewsUserVector', () => ({
    default: {},
}));

vi.mock('../../src/services/newsTrends', () => ({
    getNewsTrendsRustMode: () => 'off',
    newsTrendService: {
        computeNewsTopics: vi.fn(),
    },
}));

vi.mock('../../src/services/newsStorageService', () => ({
    newsStorageService: {
        saveContent: mocks.newsStorageSaveContent,
        saveImageFromUrls: mocks.newsStorageSaveImageFromUrls,
        deleteContent: vi.fn(),
        deleteImage: vi.fn(),
        getContent: vi.fn(),
    },
}));

vi.mock('../../src/services/recommendation/events', () => ({
    recordRecommendationEvent: mocks.recordRecommendationEvent,
}));

import { newsService } from '../../src/services/newsService';

describe('news recommendation bridge', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('drops crawler embeddings without semantic provenance during ingest', async () => {
        const article = {
            id: 'news_2',
            source: 'Crawler',
            contentPath: null,
            coverImageUrl: null,
            update: vi.fn().mockResolvedValue(undefined),
        };
        mocks.newsArticleFindOne.mockResolvedValue(null);
        mocks.newsArticleCreate.mockResolvedValue(article);
        mocks.newsStorageSaveContent.mockResolvedValue({ path: 'content/news_2.md', url: 'content/news_2.md' });
        mocks.newsStorageSaveImageFromUrls.mockResolvedValue({ url: null });

        await newsService.ingestArticles([
            {
                title: 'Market rally',
                url: 'https://example.com/news/2',
                summary: 'Stocks rise',
                embedding: [0.1, 0.2, 0.3],
            },
        ]);

        expect(mocks.newsArticleCreate).toHaveBeenCalledWith(expect.objectContaining({
            embedding: undefined,
        }));
        expect(article.update).toHaveBeenCalledWith(expect.objectContaining({
            embedding: undefined,
        }));
    });

    it('preserves news counters while emitting unified recommendation feedback', async () => {
        mocks.newsArticleFindByPk.mockResolvedValue({
            id: 'news_1',
            source: 'Reuters',
            canonicalUrl: 'https://example.com/news/1',
            sourceUrl: 'https://source.example/news/1',
            keywords: ['recsys', 'ranking'],
        });

        await newsService.logEvent('user_1', 'news_1', 'click');
        await newsService.recordRecommendationFeedback({
            userId: 'user_1',
            newsId: 'news_1',
            eventType: 'click',
            requestId: 'req_news_1',
            rank: 2,
            source: 'NewsAnnSource',
            clientEventId: 'evt_news_1',
        });

        expect(mocks.newsUserEventCreate).toHaveBeenCalledWith({
            userId: 'user_1',
            newsId: 'news_1',
            eventType: 'click',
            dwellMs: null,
        });
        expect(mocks.newsArticleIncrement).toHaveBeenCalledWith(
            { clickCount: 1 },
            { where: { id: 'news_1' } },
        );
        expect(mocks.recordRecommendationEvent).toHaveBeenCalledWith(expect.objectContaining({
            clientEventId: 'evt_news_1',
            userId: 'user_1',
            eventType: 'click',
            targetType: 'post',
            targetId: 'news_1',
            productSurface: 'news_feed',
            requestId: 'req_news_1',
            servedPosition: 2,
            positionContractVersion: 'served_position_1_based_v1',
            recommendationSource: 'NewsAnnSource',
            isNews: true,
            modelPostId: 'news_1',
            targetUrl: 'https://example.com/news/1',
            targetKeywords: ['recsys', 'ranking'],
        }));
    });

    it('does not guess a base for invalid internal news ranks', async () => {
        mocks.newsArticleFindByPk.mockResolvedValue(null);

        for (const rank of [-1, 1.5, Number.NaN]) {
            await newsService.recordRecommendationFeedback({
                userId: 'user_1',
                newsId: 'news_1',
                eventType: 'click',
                rank,
            });
        }

        for (const [event] of mocks.recordRecommendationEvent.mock.calls) {
            expect(event.position).toBeUndefined();
            expect(event.servedPosition).toBeUndefined();
            expect(event.positionContractVersion).toBeUndefined();
        }
    });
});
