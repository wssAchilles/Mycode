import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiClient', () => {
    return {
        default: {
            get: vi.fn(),
            post: vi.fn(),
        },
        authUtils: {
            getAccessToken: vi.fn(() => null),
            getCurrentUser: vi.fn(() => ({ id: 'u-test' })),
        },
    };
});

vi.mock('../services/mlService', () => {
    return {
        mlService: {
            annRetrieve: vi.fn(),
            vfCheck: vi.fn(),
        },
    };
});

import apiClient from '../services/apiClient';
import { mlService } from '../services/mlService';
import { spaceAPI } from '../services/spaceApi';

describe('spaceAPI.searchPosts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses batch hydration for ANN ids and does not call per-id getPost', async () => {
        vi.mocked(mlService.annRetrieve).mockResolvedValue([
            { postId: 'N12345', score: 0.9 } as any,
            { postId: '507f191e810c19729de860ea', score: 0.8 } as any,
        ]);
        vi.mocked(mlService.vfCheck).mockResolvedValue(true);

        vi.mocked((apiClient as any).post).mockResolvedValue({
            data: {
                posts: [
                    {
                        _id: '507f191e810c19729de860ea',
                        authorId: 'u1',
                        authorUsername: 'user1',
                        content: 'hello',
                        createdAt: '2026-02-12T00:00:00.000Z',
                    },
                ],
            },
        });
        vi.mocked((apiClient as any).get).mockResolvedValue({ data: { posts: [] } });

        const getPostSpy = vi.spyOn(spaceAPI, 'getPost');
        const result = await spaceAPI.searchPosts(['test'], ['507f191e810c19729de860aa'], 20);

        expect(getPostSpy).not.toHaveBeenCalled();
        expect((apiClient as any).post).toHaveBeenCalledWith('/api/space/posts/batch', {
            postIds: ['N12345', '507f191e810c19729de860ea'],
        });
        expect(result.isMLEnhanced).toBe(true);
        expect(result.posts).toHaveLength(1);
    });

    it('falls back to keyword search when ANN hydration returns empty', async () => {
        vi.mocked(mlService.annRetrieve).mockResolvedValue([
            { postId: 'N99999', score: 0.95 } as any,
        ]);
        vi.mocked(mlService.vfCheck).mockResolvedValue(true);

        vi.mocked((apiClient as any).post).mockResolvedValue({
            data: { posts: [] },
        });
        vi.mocked((apiClient as any).get).mockResolvedValue({
            data: {
                posts: [
                    {
                        _id: '507f191e810c19729de860ff',
                        authorId: 'u2',
                        authorUsername: 'fallback-user',
                        content: 'fallback result',
                        createdAt: '2026-02-12T01:00:00.000Z',
                    },
                ],
            },
        });

        const result = await spaceAPI.searchPosts(['fallback'], [], 20);

        expect((apiClient as any).get).toHaveBeenCalledWith(
            expect.stringContaining('/api/space/search?')
        );
        expect(result.isMLEnhanced).toBe(false);
        expect(result.posts).toHaveLength(1);
        expect(result.posts[0].content).toBe('fallback result');
    });
});
