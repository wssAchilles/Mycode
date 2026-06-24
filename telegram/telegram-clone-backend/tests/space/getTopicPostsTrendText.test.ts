import { afterEach, describe, expect, it, vi } from 'vitest';

import Post from '../../src/models/Post';
import { newsService } from '../../src/services/newsService';
import { spaceService } from '../../src/services/spaceService';

const createPost = (id: string, content: string, createdAt: Date) => ({
    _id: id,
    id,
    authorId: 'user-1',
    content,
    createdAt,
});

const mockFindResult = (posts: unknown[]) => ({
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(posts),
});

const mockCountResult = (count: number) => ({
    exec: vi.fn().mockResolvedValue(count),
});

describe('spaceService.getTopicPosts', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns posts whose content matches the trend text without requiring a hashtag', async () => {
        const trendPost = createPost(
            'post-1',
            '今天又是闷热的一天',
            new Date('2026-06-24T07:00:00.000Z')
        );

        const findSpy = vi.spyOn(Post as any, 'find').mockImplementation((query: Record<string, unknown>) => {
            const search = (query.$text as { $search?: string } | undefined)?.$search;
            const exactContent = ((query.$or as Array<{ content?: { $regex?: string } }> | undefined)?.[0]?.content?.$regex);
            return mockFindResult(!search && exactContent === '今天又是闷热的一天' ? [trendPost] : []);
        });
        vi.spyOn(Post as any, 'countDocuments').mockImplementation((query: Record<string, unknown>) => {
            const search = (query.$text as { $search?: string } | undefined)?.$search;
            const exactContent = ((query.$or as Array<{ content?: { $regex?: string } }> | undefined)?.[0]?.content?.$regex);
            return mockCountResult(!search && exactContent === '今天又是闷热的一天' ? 1 : 0);
        });
        vi.spyOn(newsService, 'searchTopicArticles').mockResolvedValue({
            articles: [],
            totalCount: 0,
            hasMore: false,
        } as any);

        const result = await spaceService.getTopicPosts('今天又是闷热的一天', 20);

        expect(result.posts).toEqual([trendPost]);
        expect(result.totalCount).toBe(1);
        expect(result.query).toBe('#今天又是闷热的一天');
        expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
            $text: { $search: '#今天又是闷热的一天' },
        }));
        expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
            $text: { $search: '今天又是闷热的一天' },
        }));
        expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
            $or: expect.arrayContaining([
                { content: { $regex: '今天又是闷热的一天', $options: 'i' } },
            ]),
        }));
    });
});
