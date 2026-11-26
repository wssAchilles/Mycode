import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData } from '../../components/space';
import type { CommentData } from '../../services/spaceApi';

const spaceApiMock = vi.hoisted(() => ({
    bookmarkPost: vi.fn(),
    unbookmarkPost: vi.fn(),
    getBookmarks: vi.fn(),
}));

vi.mock('../../services/spaceApi', () => ({
    spaceAPI: spaceApiMock,
}));

import { useBookmarkStore } from '../../stores/useBookmarkStore';
import { filterAndSortComments } from '../../components/space/utils/commentSortFilter';

function makePost(id: string): PostData {
    return {
        id,
        author: { id: 'author-1', username: 'alice' },
        content: `动态 ${id}`,
        createdAt: new Date('2026-11-26T00:00:00.000Z'),
        likeCount: 3,
        commentCount: 1,
        repostCount: 0,
    };
}

describe('Wave 3 Space community UX: bookmarks store & comment sort/filter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBookmarkStore.getState().reset();
    });

    it('optimistically toggles bookmarks and rolls back on API failure', async () => {
        const post = makePost('p-101');
        spaceApiMock.bookmarkPost.mockResolvedValueOnce(undefined);

        await useBookmarkStore.getState().toggleBookmark(post);
        expect(useBookmarkStore.getState().isBookmarked('p-101')).toBe(true);
        expect(useBookmarkStore.getState().posts.map((p) => p.id)).toEqual(['p-101']);

        // 模拟取消收藏失败并验证回滚
        spaceApiMock.unbookmarkPost.mockRejectedValueOnce(new Error('network_error'));
        await useBookmarkStore.getState().toggleBookmark(post);
        expect(useBookmarkStore.getState().isBookmarked('p-101')).toBe(true);
        expect(useBookmarkStore.getState().posts.map((p) => p.id)).toEqual(['p-101']);
    });

    it('sorts comments by hot/latest and filters by post author', () => {
        const comments: CommentData[] = [
            {
                id: 'c1',
                postId: 'p1',
                content: '最早但最高赞',
                author: { id: 'other-1', username: 'bob' },
                likeCount: 18,
                createdAt: '2026-11-26T01:00:00.000Z',
            },
            {
                id: 'c2',
                postId: 'p1',
                content: '作者最新补充',
                author: { id: 'author-1', username: 'alice' },
                likeCount: 2,
                createdAt: '2026-11-26T03:00:00.000Z',
            },
            {
                id: 'c3',
                postId: 'p1',
                content: '中间评论',
                author: { id: 'other-2', username: 'carol' },
                likeCount: 5,
                createdAt: '2026-11-26T02:00:00.000Z',
            },
        ];

        const latest = filterAndSortComments(comments, {
            sortBy: 'latest',
            onlyAuthor: false,
            postAuthorId: 'author-1',
        });
        expect(latest.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);

        const hot = filterAndSortComments(comments, {
            sortBy: 'hot',
            onlyAuthor: false,
            postAuthorId: 'author-1',
        });
        expect(hot.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);

        const onlyAuthor = filterAndSortComments(comments, {
            sortBy: 'latest',
            onlyAuthor: true,
            postAuthorId: 'author-1',
        });
        expect(onlyAuthor.map((c) => c.id)).toEqual(['c2']);
    });
});
