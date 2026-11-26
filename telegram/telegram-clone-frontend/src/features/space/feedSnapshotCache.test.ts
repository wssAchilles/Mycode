import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData } from '../../components/space';

const spaceApiMock = vi.hoisted(() => ({
    getFeed: vi.fn(),
}));

vi.mock('../../services/spaceApi', () => ({
    spaceAPI: spaceApiMock,
}));

import {
    MAX_SNAPSHOT_POSTS,
    SNAPSHOT_TTL_MS,
    buildFeedSnapshotKey,
    clearFeedSnapshots,
    readFeedSnapshot,
    writeFeedSnapshot,
} from './feedSnapshotCache';
import { useSpaceStore } from '../../stores/useSpaceStore';

function makePost(id: string, createdAtIso = '2026-11-26T00:00:00.000Z'): PostData {
    return {
        id,
        author: { id: `author-${id}`, username: `user_${id}` },
        content: `动态内容 ${id}`,
        createdAt: new Date(createdAtIso),
        likeCount: 1,
        commentCount: 0,
        repostCount: 0,
    };
}

function resetStore() {
    localStorage.clear();
    sessionStorage.clear();
    useSpaceStore.setState({
        posts: [],
        isLoadingFeed: false,
        hasMore: true,
        nextCursor: undefined,
        newPostsCount: 0,
        isMLEnhanced: false,
        inNetworkOnly: false,
        allFeed: {
            posts: [],
            isLoading: false,
            isRefreshing: false,
            hasMore: true,
            nextCursor: undefined,
            error: null,
            hasLoaded: false,
            seenIds: [],
            servedIds: [],
        },
        friendsFeed: {
            posts: [],
            isLoading: false,
            isRefreshing: false,
            hasMore: true,
            nextCursor: undefined,
            error: null,
            hasLoaded: false,
            seenIds: [],
            servedIds: [],
        },
        seenIds: [],
        servedIds: [],
        error: null,
    });
}

describe('feedSnapshotCache & useSpaceStore SWR behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('writes, reads, truncates to 20 items, and revives Date fields', () => {
        const posts = Array.from({ length: 25 }, (_, i) =>
            makePost(`p-${i}`, `2026-11-26T00:${String(i).padStart(2, '0')}:00.000Z`),
        );

        writeFeedSnapshot('all', posts, 'u1', 1_000);
        const restored = readFeedSnapshot('all', 'u1', 2_000);

        expect(restored).not.toBeNull();
        expect(restored).toHaveLength(MAX_SNAPSHOT_POSTS);
        expect(restored?.[0]?.id).toBe('p-0');
        expect(restored?.[0]?.createdAt).toBeInstanceOf(Date);
        expect(restored?.[0]?.createdAt.toISOString()).toBe('2026-11-26T00:00:00.000Z');
        expect(readFeedSnapshot('friends', 'u1', 2_000)).toBeNull();
    });

    it('expires snapshots past TTL and handles corrupted JSON gracefully', () => {
        writeFeedSnapshot('all', [makePost('p-1')], 'u2', 1_000);
        expect(readFeedSnapshot('all', 'u2', 1_000 + SNAPSHOT_TTL_MS + 1)).toBeNull();

        localStorage.setItem(buildFeedSnapshotKey('all', 'u2'), '{invalid-json');
        expect(readFeedSnapshot('all', 'u2')).toBeNull();

        writeFeedSnapshot('friends', [makePost('p-2')], 'u2', 1_000);
        clearFeedSnapshots('u2');
        expect(readFeedSnapshot('friends', 'u2', 2_000)).toBeNull();
    });

    it('keeps snapshot posts visible during background refresh without flashing skeleton', async () => {
        const stalePost = makePost('stale-1');
        const freshPost = makePost('fresh-1');
        writeFeedSnapshot('all', [stalePost]);

        let resolveFetch!: (val: { posts: PostData[]; hasMore: boolean; nextCursor?: string }) => void;
        spaceApiMock.getFeed.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveFetch = resolve;
                }),
        );

        const refreshPromise = useSpaceStore.getState().fetchFeed(true);

        // 请求进行中：立刻读入快照、列表不被清空、且不触发 isLoadingFeed 骨架屏
        const midState = useSpaceStore.getState();
        expect(midState.posts).toHaveLength(1);
        expect(midState.posts[0]?.id).toBe('stale-1');
        expect(midState.isLoadingFeed).toBe(false);
        expect(midState.allFeed.isRefreshing).toBe(true);

        resolveFetch({ posts: [freshPost], hasMore: false, nextCursor: undefined });
        await refreshPromise;

        const doneState = useSpaceStore.getState();
        expect(doneState.posts).toHaveLength(1);
        expect(doneState.posts[0]?.id).toBe('fresh-1');
        expect(doneState.allFeed.isRefreshing).toBe(false);
        expect(doneState.allFeed.hasLoaded).toBe(true);

        const cachedAfter = readFeedSnapshot('all');
        expect(cachedAfter?.[0]?.id).toBe('fresh-1');
    });
});
