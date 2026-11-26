import { beforeEach, describe, expect, it } from 'vitest';
import type { PostData } from '../../components/space';
import {
    buildSpaceScrollKey,
    clearSpaceScrollMemory,
    readSpaceScrollPosition,
    saveSpaceScrollPosition,
} from './scrollMemory';
import {
    findCachedSpacePost,
    invalidateProfileCache,
    patchProfileFollowCache,
    readProfileCache,
    writeProfileCache,
} from './profileMemoryCache';
import { useSpaceStore } from '../../stores/useSpaceStore';

function makePost(id: string): PostData {
    return {
        id,
        author: { id: `u-${id}`, username: `user_${id}` },
        content: `动态内容 ${id}`,
        createdAt: new Date('2026-11-26T00:00:00.000Z'),
        likeCount: 2,
        commentCount: 1,
        repostCount: 0,
    };
}

describe('Wave 1 UX enhancements: scrollMemory & profileMemoryCache', () => {
    beforeEach(() => {
        clearSpaceScrollMemory();
        invalidateProfileCache();
        useSpaceStore.setState({
            posts: [],
            searchResults: [],
            allFeed: {
                ...useSpaceStore.getState().allFeed,
                posts: [],
            },
            friendsFeed: {
                ...useSpaceStore.getState().friendsFeed,
                posts: [],
            },
        });
    });

    it('persists and restores Space scroll positions across tabs and routes', () => {
        const allKey = buildSpaceScrollKey('home', false);
        const friendsKey = buildSpaceScrollKey('home', true);

        expect(allKey).toBe('home:all');
        expect(friendsKey).toBe('home:friends');
        expect(readSpaceScrollPosition(allKey)).toBe(0);

        saveSpaceScrollPosition(allKey, 842.6);
        saveSpaceScrollPosition(friendsKey, -10);

        expect(readSpaceScrollPosition(allKey)).toBe(843);
        expect(readSpaceScrollPosition(friendsKey)).toBe(0);

        clearSpaceScrollMemory();
        expect(readSpaceScrollPosition(allKey)).toBe(0);
    });

    it('finds cached post synchronously from useSpaceStore or profileMemoryCache', () => {
        const feedPost = makePost('feed-post-1');
        useSpaceStore.setState({ posts: [feedPost] });
        expect(findCachedSpacePost('feed-post-1')?.id).toBe('feed-post-1');

        const profilePost = makePost('profile-post-2');
        writeProfileCache(
            'author-2',
            {
                profile: {
                    id: 'author-2',
                    username: 'alice',
                    isFollowed: false,
                    stats: { posts: 1, followers: 10, following: 3 },
                    createdAt: '2026-11-26T00:00:00.000Z',
                },
                pinnedPosts: [],
                posts: [profilePost],
                hasMore: false,
            },
            1_000,
        );
        expect(findCachedSpacePost('profile-post-2')?.id).toBe('profile-post-2');
        expect(readProfileCache('author-2', 2_000)?.profile.username).toBe('alice');

        patchProfileFollowCache('author-2', true, 1);
        expect(readProfileCache('author-2', 2_000)?.profile.isFollowed).toBe(true);
        expect(readProfileCache('author-2', 2_000)?.profile.stats.followers).toBe(11);

        // 超过 2 分钟 TTL 自动失效
        expect(readProfileCache('author-2', 1_000 + 2 * 60 * 1000 + 1)).toBeNull();
    });
});
