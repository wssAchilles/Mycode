/**
 * Space 书签收藏状态管理 Store
 * 支持全局快速判断已收藏 ID 集合、乐观切换与收藏夹列表分页加载
 */
import { create } from 'zustand';
import type { PostData } from '../components/space';
import { showToast } from '../components/ui/Toast';
import { spaceAPI } from '../services/spaceApi';

interface BookmarkState {
    posts: PostData[];
    bookmarkedIds: Record<string, true>;
    isLoading: boolean;
    hasLoaded: boolean;
    hasMore: boolean;
    nextCursor?: string;
    error: string | null;

    loadBookmarks: (reset?: boolean) => Promise<void>;
    toggleBookmark: (post: PostData) => Promise<void>;
    isBookmarked: (postId: string) => boolean;
    reset: () => void;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
    posts: [],
    bookmarkedIds: {},
    isLoading: false,
    hasLoaded: false,
    hasMore: false,
    nextCursor: undefined,
    error: null,

    isBookmarked: (postId: string) => Boolean(get().bookmarkedIds[postId]),

    loadBookmarks: async (reset = true) => {
        const state = get();
        if (state.isLoading) return;
        const cursor = reset ? undefined : state.nextCursor;
        set({ isLoading: true, error: null });
        try {
            const res = await spaceAPI.getBookmarks(20, cursor);
            set((prev) => {
                const nextIds: Record<string, true> = reset ? {} : { ...prev.bookmarkedIds };
                for (const id of res.bookmarkIds) {
                    if (id) nextIds[id] = true;
                }
                for (const p of res.posts) {
                    if (p.id) nextIds[p.id] = true;
                }

                const nextPosts = reset
                    ? res.posts
                    : [
                        ...prev.posts,
                        ...res.posts.filter((p) => !prev.posts.some((existing) => existing.id === p.id)),
                    ];

                return {
                    posts: nextPosts,
                    bookmarkedIds: nextIds,
                    hasMore: res.hasMore,
                    nextCursor: res.nextCursor,
                    isLoading: false,
                    hasLoaded: true,
                    error: null,
                };
            });
        } catch (err) {
            set({
                isLoading: false,
                hasLoaded: true,
                error: err instanceof Error ? err.message : '加载收藏失败',
            });
        }
    },

    toggleBookmark: async (post: PostData) => {
        if (!post?.id) return;
        const currentlyBookmarked = Boolean(get().bookmarkedIds[post.id]);

        // 乐观更新
        set((prev) => {
            const nextIds = { ...prev.bookmarkedIds };
            let nextPosts: PostData[];
            if (currentlyBookmarked) {
                delete nextIds[post.id];
                nextPosts = prev.posts.filter((item) => item.id !== post.id);
            } else {
                nextIds[post.id] = true;
                nextPosts = prev.posts.some((item) => item.id === post.id)
                    ? prev.posts
                    : [post, ...prev.posts];
            }
            return { bookmarkedIds: nextIds, posts: nextPosts };
        });

        try {
            if (currentlyBookmarked) {
                await spaceAPI.unbookmarkPost(post.id);
                showToast('已移出收藏', 'info');
            } else {
                await spaceAPI.bookmarkPost(post.id);
                showToast('已加入收藏夹', 'success');
            }
        } catch (err) {
            // 回滚
            set((prev) => {
                const nextIds = { ...prev.bookmarkedIds };
                let nextPosts: PostData[];
                if (currentlyBookmarked) {
                    nextIds[post.id] = true;
                    nextPosts = prev.posts.some((item) => item.id === post.id)
                        ? prev.posts
                        : [post, ...prev.posts];
                } else {
                    delete nextIds[post.id];
                    nextPosts = prev.posts.filter((item) => item.id !== post.id);
                }
                return { bookmarkedIds: nextIds, posts: nextPosts };
            });
            showToast(err instanceof Error ? err.message : '收藏操作失败，请稍后重试', 'error');
        }
    },

    reset: () => {
        set({
            posts: [],
            bookmarkedIds: {},
            isLoading: false,
            hasLoaded: false,
            hasMore: false,
            nextCursor: undefined,
            error: null,
        });
    },
}));
