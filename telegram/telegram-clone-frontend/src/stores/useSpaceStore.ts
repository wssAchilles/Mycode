/**
 * Space 状态管理 Store
 * 管理帖子、Feed 等 Space 核心数据
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { PostData } from '../components/space';
import { spaceAPI } from '../services/spaceApi';

interface SpaceState {
    // Feed 数据
    posts: PostData[];
    isLoadingFeed: boolean;
    hasMore: boolean;
    nextCursor?: string;
    newPostsCount: number;
    isMLEnhanced: boolean; // 是否使用了 ML 推荐

    // 搜索状态
    searchResults: PostData[];
    isSearching: boolean;
    searchQuery: string;

    // 发帖状态
    isCreatingPost: boolean;

    // 错误
    error: string | null;

    // Feed 操作
    fetchFeed: (refresh?: boolean) => Promise<void>;
    fetchSmartFeed: (userId: string, historyPostIds?: string[]) => Promise<void>;
    loadMore: () => Promise<void>;
    refreshFeed: () => Promise<void>;

    // 搜索操作
    searchPosts: (query: string) => Promise<void>;
    clearSearch: () => void;

    // 帖子操作
    createPost: (content: string, media?: File[]) => Promise<PostData>;
    likePost: (postId: string) => Promise<void>;
    unlikePost: (postId: string) => Promise<void>;
    repostPost: (postId: string) => Promise<void>;

    // 本地状态更新
    addPostToTop: (post: PostData) => void;
    updatePost: (postId: string, updates: Partial<PostData>) => void;
    removePost: (postId: string) => void;
    incrementNewPostsCount: () => void;
    resetNewPostsCount: () => void;
    setError: (error: string | null) => void;
}

export const useSpaceStore = create<SpaceState>()(
    immer((set, get) => ({
        // 初始状态
        posts: [],
        isLoadingFeed: false,
        hasMore: true,
        nextCursor: undefined,
        newPostsCount: 0,
        isMLEnhanced: false,
        searchResults: [],
        isSearching: false,
        searchQuery: '',
        isCreatingPost: false,
        error: null,

        // === Feed 操作 ===
        fetchFeed: async (refresh = false) => {
            const state = get();
            if (state.isLoadingFeed) return;

            set((s) => {
                s.isLoadingFeed = true;
                s.error = null;
                if (refresh) {
                    s.posts = [];
                    s.nextCursor = undefined;
                    s.hasMore = true;
                }
            });

            try {
                const cursor = refresh ? undefined : state.nextCursor;
                const result = await spaceAPI.getFeed(20, cursor);

                set((s) => {
                    if (refresh) {
                        s.posts = result.posts;
                    } else {
                        // 追加并去重
                        const existingIds = new Set(s.posts.map((p) => p.id));
                        const newPosts = result.posts.filter((p) => !existingIds.has(p.id));
                        s.posts.push(...newPosts);
                    }
                    s.hasMore = result.hasMore;
                    s.nextCursor = result.nextCursor;
                    s.isLoadingFeed = false;
                });
            } catch (error: any) {
                set((s) => {
                    s.error = error.message || '加载动态失败';
                    s.isLoadingFeed = false;
                });
            }
        },

        loadMore: async () => {
            const state = get();
            if (!state.hasMore || state.isLoadingFeed) return;
            await state.fetchFeed(false);
        },

        refreshFeed: async () => {
            const state = get();
            state.resetNewPostsCount();
            await state.fetchFeed(true);
        },

        // 智能推荐 Feed (ML 增强)
        fetchSmartFeed: async (userId, historyPostIds = []) => {
            const state = get();
            if (state.isLoadingFeed) return;

            set((s) => {
                s.isLoadingFeed = true;
                s.error = null;
            });

            try {
                const result = await spaceAPI.getSmartFeed(userId, historyPostIds, 20);

                set((s) => {
                    s.posts = result.posts;
                    s.hasMore = result.hasMore;
                    s.isMLEnhanced = result.isMLEnhanced;
                    s.isLoadingFeed = false;
                });
            } catch (error: any) {
                set((s) => {
                    s.error = error.message || '加载智能推荐失败';
                    s.isLoadingFeed = false;
                });
            }
        },

        // 智能搜索
        searchPosts: async (query) => {
            if (!query.trim()) {
                set((s) => {
                    s.searchResults = [];
                    s.searchQuery = '';
                });
                return;
            }

            set((s) => {
                s.isSearching = true;
                s.searchQuery = query;
                s.error = null;
            });

            try {
                // 从 localStorage 获取用户信息
                const userStr = localStorage.getItem('user');
                const user = userStr ? JSON.parse(userStr) : { id: 'anonymous' };

                // 将搜索词分割为关键词数组
                const keywords = query.trim().split(/\s+/);

                // 获取历史浏览记录 (可从 localStorage 或 store 获取)
                const historyPostIds = get().posts.slice(0, 20).map(p => p.id);

                const result = await spaceAPI.searchPosts(
                    user.id || user._id || 'anonymous',
                    keywords,
                    historyPostIds,
                    20
                );

                set((s) => {
                    s.searchResults = result.posts;
                    s.isSearching = false;
                });
            } catch (error: any) {
                set((s) => {
                    s.error = error.message || '搜索失败';
                    s.isSearching = false;
                });
            }
        },

        clearSearch: () => {
            set((s) => {
                s.searchResults = [];
                s.searchQuery = '';
                s.isSearching = false;
            });
        },

        // === 帖子操作 ===
        createPost: async (content, media) => {
            set((s) => {
                s.isCreatingPost = true;
                s.error = null;
            });

            try {
                const newPost = await spaceAPI.createPost(content, media);

                set((s) => {
                    s.posts.unshift(newPost);
                    s.isCreatingPost = false;
                });

                return newPost;
            } catch (error: any) {
                set((s) => {
                    s.error = error.message || '发布失败';
                    s.isCreatingPost = false;
                });
                throw error;
            }
        },

        likePost: async (postId) => {
            // 乐观更新
            set((s) => {
                const post = s.posts.find((p) => p.id === postId);
                if (post) {
                    post.isLiked = true;
                    post.likeCount += 1;
                }
            });

            try {
                await spaceAPI.likePost(postId);
            } catch {
                // 回滚
                set((s) => {
                    const post = s.posts.find((p) => p.id === postId);
                    if (post) {
                        post.isLiked = false;
                        post.likeCount = Math.max(0, post.likeCount - 1);
                    }
                });
            }
        },

        unlikePost: async (postId) => {
            // 乐观更新
            set((s) => {
                const post = s.posts.find((p) => p.id === postId);
                if (post) {
                    post.isLiked = false;
                    post.likeCount = Math.max(0, post.likeCount - 1);
                }
            });

            try {
                await spaceAPI.unlikePost(postId);
            } catch {
                // 回滚
                set((s) => {
                    const post = s.posts.find((p) => p.id === postId);
                    if (post) {
                        post.isLiked = true;
                        post.likeCount += 1;
                    }
                });
            }
        },

        repostPost: async (postId) => {
            // 乐观更新
            set((s) => {
                const post = s.posts.find((p) => p.id === postId);
                if (post && !post.isReposted) {
                    post.isReposted = true;
                    post.repostCount += 1;
                }
            });

            try {
                await spaceAPI.repostPost(postId);
            } catch {
                // 回滚
                set((s) => {
                    const post = s.posts.find((p) => p.id === postId);
                    if (post) {
                        post.isReposted = false;
                        post.repostCount = Math.max(0, post.repostCount - 1);
                    }
                });
            }
        },

        // === 本地状态更新 ===
        addPostToTop: (post) =>
            set((s) => {
                const exists = s.posts.some((p) => p.id === post.id);
                if (!exists) {
                    s.posts.unshift(post);
                }
            }),

        updatePost: (postId, updates) =>
            set((s) => {
                const idx = s.posts.findIndex((p) => p.id === postId);
                if (idx !== -1) {
                    Object.assign(s.posts[idx], updates);
                }
            }),

        removePost: (postId) =>
            set((s) => {
                s.posts = s.posts.filter((p) => p.id !== postId);
            }),

        incrementNewPostsCount: () =>
            set((s) => {
                s.newPostsCount += 1;
            }),

        resetNewPostsCount: () =>
            set((s) => {
                s.newPostsCount = 0;
            }),

        setError: (error) =>
            set((s) => {
                s.error = error;
            }),
    }))
);

// 选择器
export const selectPosts = (state: SpaceState) => state.posts;
export const selectIsLoadingFeed = (state: SpaceState) => state.isLoadingFeed;
export const selectHasMore = (state: SpaceState) => state.hasMore;
export const selectNewPostsCount = (state: SpaceState) => state.newPostsCount;
