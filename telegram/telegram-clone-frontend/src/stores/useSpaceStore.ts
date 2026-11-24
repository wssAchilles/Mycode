/**
 * Space 状态管理 Store
 * 管理帖子、Feed 等 Space 核心数据
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { PostData } from '../components/space';
import type { SocialNotificationRealtimePayload } from '../features/realtime/contracts';
import { spaceAPI, type CreatePostOptions } from '../services/spaceApi';
import { authStorage } from '../utils/authStorage';

const FEED_STATE_WINDOW = 200;

export type SpaceFeedScope = 'all' | 'friends';

export interface SpaceFeedScopeState {
    posts: PostData[];
    isLoading: boolean;
    hasMore: boolean;
    nextCursor?: string;
    error: string | null;
    hasLoaded: boolean;
    seenIds: string[];
    servedIds: string[];
}

const getUserIdForFeedState = (): string => {
    if (typeof window === 'undefined') return 'anonymous';
    const user = authStorage.getUser();
    return user?.id ? String(user.id) : 'anonymous';
};

const feedStateKey = (name: 'seen' | 'served', scope: SpaceFeedScope): string => {
    const uid = getUserIdForFeedState();
    return `space_feed_${name}_ids:${uid}:${scope}`;
};

const loadIdWindow = (name: 'seen' | 'served', scope: SpaceFeedScope): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.sessionStorage.getItem(feedStateKey(name, scope));
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed)) return [];
        return parsed.map(String).filter(Boolean).slice(-FEED_STATE_WINDOW);
    } catch {
        return [];
    }
};

const saveIdWindow = (name: 'seen' | 'served', ids: string[], scope: SpaceFeedScope) => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(feedStateKey(name, scope), JSON.stringify(ids.slice(-FEED_STATE_WINDOW)));
    } catch {
        // 忽略存储异常
    }
};

const createInitialScopeState = (scope: SpaceFeedScope): SpaceFeedScopeState => ({
    posts: [],
    isLoading: false,
    hasMore: true,
    nextCursor: undefined,
    error: null,
    hasLoaded: false,
    seenIds: loadIdWindow('seen', scope),
    servedIds: loadIdWindow('served', scope),
});

const mergeIdWindow = (existing: string[], delta: string[], cap: number): string[] => {
    const all = [...(existing || []), ...(delta || [])].map(String).filter(Boolean);
    const seen = new Set<string>();
    const outRev: string[] = [];

    // Keep the last occurrence of each id (most recent) while preserving order.
    for (let i = all.length - 1; i >= 0; i--) {
        const id = all[i];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        outRev.push(id);
    }

    const out = outRev.reverse();
    return out.length > cap ? out.slice(out.length - cap) : out;
};

interface SpaceState {
    // 当前激活 Scope 的 Feed 视图数据（与 allFeed / friendsFeed 保持同步）
    posts: PostData[];
    isLoadingFeed: boolean;
    hasMore: boolean;
    nextCursor?: string;
    newPostsCount: number;
    isMLEnhanced: boolean; // 是否使用了 ML 推荐
    inNetworkOnly: boolean; // 工业级：只看好友/关注网内

    // 按范围独立缓存的 Feed 状态，避免 Tab 切换丢失列表及首页/探索互相污染
    allFeed: SpaceFeedScopeState;
    friendsFeed: SpaceFeedScopeState;

    // 客户端携带状态 (工业级): seen_ids / served_ids 滑窗
    seenIds: string[];
    servedIds: string[];

    // 搜索状态
    searchResults: PostData[];
    isSearching: boolean;
    searchQuery: string;
    searchTotalCount: number;
    searchHasMore: boolean;
    searchNextCursor?: string;
    searchMode: 'search' | 'topic';
    searchTopicTag?: string;

    // 发帖状态
    isCreatingPost: boolean;

    // 社交通知未读计数与实时事件去重状态
    unreadNotificationsCount: number;

    // 错误
    error: string | null;

    // 社交通知实时操作
    receiveRealtimeNotification: (event: SocialNotificationRealtimePayload) => void;
    clearUnreadNotifications: () => void;

    // Feed 操作
    fetchFeed: (refresh?: boolean) => Promise<void>;
    fetchExploreFeed: (refresh?: boolean) => Promise<void>;
    fetchFeedForScope: (scope: SpaceFeedScope, refresh?: boolean) => Promise<void>;
    fetchSmartFeed: () => Promise<void>;
    loadMore: () => Promise<void>;
    refreshFeed: () => Promise<void>;
    setInNetworkOnly: (value: boolean) => Promise<void>;

    // 搜索操作
    searchPosts: (query: string) => Promise<void>;
    searchTopicPosts: (tag: string) => Promise<void>;
    loadMoreSearchResults: () => Promise<void>;
    clearSearch: () => void;

    // 帖子操作
    createPost: (content: string, media?: File[], options?: CreatePostOptions) => Promise<PostData>;
    likePost: (postId: string) => Promise<void>;
    unlikePost: (postId: string) => Promise<void>;
    repostPost: (postId: string) => Promise<void>;
    unrepostPost: (postId: string) => Promise<void>;

    // 本地状态更新
    addPostToTop: (post: PostData) => void;
    updatePost: (postId: string, updates: Partial<PostData>) => void;
    removePost: (postId: string) => void;
    incrementNewPostsCount: () => void;
    resetNewPostsCount: () => void;
    markSeen: (postId: string) => void;
    setError: (error: string | null) => void;
}

const getScopeKey = (inNetworkOnly: boolean): SpaceFeedScope =>
    inNetworkOnly ? 'friends' : 'all';

const getScopeFeed = (state: SpaceState, scope: SpaceFeedScope): SpaceFeedScopeState =>
    scope === 'friends' ? state.friendsFeed : state.allFeed;

const syncRootFromActiveScope = (s: SpaceState) => {
    const active = getScopeFeed(s, getScopeKey(s.inNetworkOnly));
    s.posts = active.posts;
    s.isLoadingFeed = active.isLoading;
    s.hasMore = active.hasMore;
    s.nextCursor = active.nextCursor;
    s.error = active.error;
    s.seenIds = active.seenIds;
    s.servedIds = active.servedIds;
};

const mutatePostAcrossLists = (
    s: SpaceState,
    postId: string,
    updater: (post: PostData) => void
) => {
    const lists = [s.posts, s.allFeed.posts, s.friendsFeed.posts, s.searchResults];
    const visited = new Set<PostData[]>();
    for (const list of lists) {
        if (visited.has(list)) continue;
        visited.add(list);
        const target = list.find((p) => p.id === postId);
        if (target) {
            updater(target);
        }
    }
};

const initialAllFeed = createInitialScopeState('all');
const initialFriendsFeed = createInitialScopeState('friends');

const seenRealtimeNotificationIds = new Set<string>();

export const useSpaceStore = create<SpaceState>()(
    immer((set, get) => ({
        // 初始状态
        posts: initialAllFeed.posts,
        isLoadingFeed: initialAllFeed.isLoading,
        hasMore: initialAllFeed.hasMore,
        nextCursor: initialAllFeed.nextCursor,
        newPostsCount: 0,
        unreadNotificationsCount: 0,
        isMLEnhanced: false,
        inNetworkOnly: false,
        allFeed: initialAllFeed,
        friendsFeed: initialFriendsFeed,
        seenIds: initialAllFeed.seenIds,
        servedIds: initialAllFeed.servedIds,
        searchResults: [],
        isSearching: false,
        searchQuery: '',
        searchTotalCount: 0,
        searchHasMore: false,
        searchNextCursor: undefined,
        searchMode: 'search',
        searchTopicTag: undefined,
        isCreatingPost: false,
        error: null,

        // === Feed 操作 ===
        fetchFeedForScope: async (scope: SpaceFeedScope, refresh = false) => {
            const currentScopeFeed = getScopeFeed(get(), scope);
            if (currentScopeFeed.isLoading) return;

            const cursor = refresh ? undefined : currentScopeFeed.nextCursor;
            const seenIds = currentScopeFeed.seenIds;
            const servedIds = currentScopeFeed.servedIds;

            set((s) => {
                const target = getScopeFeed(s, scope);
                target.isLoading = true;
                target.error = null;
                if (refresh) {
                    target.posts = [];
                    target.nextCursor = undefined;
                    target.hasMore = true;
                }
                if (getScopeKey(s.inNetworkOnly) === scope) {
                    syncRootFromActiveScope(s);
                }
            });

            try {
                const result = await spaceAPI.getFeed(20, cursor, {
                    seenIds,
                    servedIds,
                    isBottomRequest: Boolean(cursor),
                    inNetworkOnly: scope === 'friends',
                });

                const delta = result.servedIdsDelta || result.posts.map((p) => p.id);
                const nextServed = mergeIdWindow(servedIds, delta, FEED_STATE_WINDOW);

                set((s) => {
                    const target = getScopeFeed(s, scope);
                    if (refresh) {
                        target.posts = result.posts;
                    } else {
                        // 追加并去重
                        const existingIds = new Set(target.posts.map((p) => p.id));
                        const newPosts = result.posts.filter((p) => !existingIds.has(p.id));
                        target.posts.push(...newPosts);
                    }
                    target.hasMore = result.hasMore;
                    target.nextCursor = result.nextCursor;
                    target.servedIds = nextServed;
                    target.isLoading = false;
                    target.hasLoaded = true;
                    target.error = null;
                    if (getScopeKey(s.inNetworkOnly) === scope) {
                        syncRootFromActiveScope(s);
                    }
                });

                // 持久化已下发滑窗
                saveIdWindow('served', nextServed, scope);
            } catch (error: unknown) {
                set((s) => {
                    const target = getScopeFeed(s, scope);
                    target.error = error instanceof Error ? error.message : '加载动态失败';
                    target.isLoading = false;
                    target.hasLoaded = true;
                    if (getScopeKey(s.inNetworkOnly) === scope) {
                        syncRootFromActiveScope(s);
                    }
                });
            }
        },

        fetchFeed: async (refresh = false) => {
            const scope = getScopeKey(get().inNetworkOnly);
            await get().fetchFeedForScope(scope, refresh);
        },

        fetchExploreFeed: async (refresh = false) => {
            // 探索页始终请求全站流（inNetworkOnly: false），与首页好友 Tab 隔离
            await get().fetchFeedForScope('all', refresh);
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

        setInNetworkOnly: async (value: boolean) => {
            const state = get();
            if (state.inNetworkOnly === value) return;
            const targetScope = getScopeKey(value);

            set((s) => {
                s.inNetworkOnly = value;
                syncRootFromActiveScope(s);
            });

            // 若目标范围尚未加载或上次加载失败，则拉取首屏；否则直接复用缓存列表
            const targetFeed = getScopeFeed(get(), targetScope);
            if (!targetFeed.hasLoaded || targetFeed.error) {
                await get().fetchFeedForScope(targetScope, true);
            }
        },

        // 智能推荐 Feed (ML 增强)
        fetchSmartFeed: async () => {
            const state = get();
            if (state.allFeed.isLoading) return;

            set((s) => {
                s.allFeed.isLoading = true;
                s.allFeed.error = null;
                if (!s.inNetworkOnly) {
                    syncRootFromActiveScope(s);
                }
            });

            try {
                const result = await spaceAPI.getSmartFeed(20);

                set((s) => {
                    s.allFeed.posts = result.posts;
                    s.allFeed.hasMore = result.hasMore;
                    s.allFeed.hasLoaded = true;
                    s.allFeed.isLoading = false;
                    s.isMLEnhanced = result.isMLEnhanced;
                    if (!s.inNetworkOnly) {
                        syncRootFromActiveScope(s);
                    }
                });
            } catch (error: unknown) {
                set((s) => {
                    s.allFeed.error = error instanceof Error ? error.message : '加载智能推荐失败';
                    s.allFeed.isLoading = false;
                    s.allFeed.hasLoaded = true;
                    if (!s.inNetworkOnly) {
                        syncRootFromActiveScope(s);
                    }
                });
            }
        },

        // 智能搜索
        searchPosts: async (query) => {
            if (!query.trim()) {
                set((s) => {
                    s.searchResults = [];
                    s.searchQuery = '';
                    s.searchTotalCount = 0;
                    s.searchHasMore = false;
                    s.searchNextCursor = undefined;
                    s.searchMode = 'search';
                    s.searchTopicTag = undefined;
                });
                return;
            }

            set((s) => {
                s.isSearching = true;
                s.searchQuery = query;
                s.searchTotalCount = 0;
                s.searchHasMore = false;
                s.searchNextCursor = undefined;
                s.searchMode = 'search';
                s.searchTopicTag = undefined;
                s.error = null;
            });

            try {
                // 从 localStorage 获取用户信息 (removed unused user variable)

                // 将搜索词分割为关键词数组
                const keywords = query.trim().split(/\s+/);

                // 获取历史浏览记录 (可从 localStorage 或 store 获取)
                const historyPostIds = get().posts.slice(0, 20).map(p => p.id);

                const result = await spaceAPI.searchPosts(
                    keywords,
                    historyPostIds,
                    20
                );

                set((s) => {
                    s.searchResults = result.posts;
                    s.searchTotalCount = result.totalCount;
                    s.searchHasMore = result.hasMore;
                    s.searchNextCursor = result.nextCursor;
                    s.isSearching = false;
                });
            } catch (error: unknown) {
                set((s) => {
                    s.error = error instanceof Error ? error.message : '搜索失败';
                    s.isSearching = false;
                });
            }
        },

        searchTopicPosts: async (tag) => {
            const normalizedTag = String(tag || '').trim().replace(/^#+/, '');
            if (!normalizedTag) {
                get().clearSearch();
                return;
            }

            const query = `#${normalizedTag}`;
            set((s) => {
                s.isSearching = true;
                s.searchQuery = query;
                s.searchResults = [];
                s.searchTotalCount = 0;
                s.searchHasMore = false;
                s.searchNextCursor = undefined;
                s.searchMode = 'topic';
                s.searchTopicTag = normalizedTag;
                s.error = null;
            });

            try {
                const result = await spaceAPI.getTopicPosts(normalizedTag, 20);
                set((s) => {
                    s.searchResults = result.posts;
                    s.searchTotalCount = result.totalCount;
                    s.searchHasMore = result.hasMore;
                    s.searchNextCursor = result.nextCursor;
                    s.searchQuery = result.query || query;
                    s.searchMode = 'topic';
                    s.searchTopicTag = result.tag || normalizedTag;
                    s.isSearching = false;
                });
            } catch (error: unknown) {
                set((s) => {
                    s.error = error instanceof Error ? error.message : '加载话题动态失败';
                    s.isSearching = false;
                });
            }
        },

        loadMoreSearchResults: async () => {
            const state = get();
            if (!state.searchHasMore || !state.searchNextCursor || state.isSearching) return;

            set((s) => {
                s.isSearching = true;
                s.error = null;
            });

            try {
                const result = state.searchMode === 'topic' && state.searchTopicTag
                    ? await spaceAPI.getTopicPosts(state.searchTopicTag, 20, state.searchNextCursor)
                    : await spaceAPI.searchPosts(
                        state.searchQuery.trim().split(/\s+/).filter(Boolean),
                        state.posts.slice(0, 20).map((p) => p.id),
                        20,
                        state.searchNextCursor
                    );

                set((s) => {
                    const existingIds = new Set(s.searchResults.map((post) => post.id));
                    const newPosts = result.posts.filter((post) => !existingIds.has(post.id));
                    s.searchResults.push(...newPosts);
                    s.searchTotalCount = result.totalCount;
                    s.searchHasMore = result.hasMore;
                    s.searchNextCursor = result.nextCursor;
                    s.isSearching = false;
                });
            } catch (error: unknown) {
                set((s) => {
                    s.error = error instanceof Error ? error.message : '加载更多搜索结果失败';
                    s.isSearching = false;
                });
            }
        },

        clearSearch: () => {
            set((s) => {
                s.searchResults = [];
                s.searchQuery = '';
                s.isSearching = false;
                s.searchTotalCount = 0;
                s.searchHasMore = false;
                s.searchNextCursor = undefined;
                s.searchMode = 'search';
                s.searchTopicTag = undefined;
            });
        },

        // === 帖子操作 ===
        createPost: async (content, media, options) => {
            set((s) => {
                s.isCreatingPost = true;
                s.error = null;
            });

            try {
                const newPost = await spaceAPI.createPost(content, media, options);

                set((s) => {
                    if (!s.allFeed.posts.some((p) => p.id === newPost.id)) {
                        s.allFeed.posts.unshift(newPost);
                    }
                    if (!s.friendsFeed.posts.some((p) => p.id === newPost.id)) {
                        s.friendsFeed.posts.unshift(newPost);
                    }
                    syncRootFromActiveScope(s);
                    s.isCreatingPost = false;
                });

                return newPost;
            } catch (error: unknown) {
                set((s) => {
                    s.error = error instanceof Error ? error.message : '发布失败';
                    s.isCreatingPost = false;
                });
                throw error;
            }
        },

        likePost: async (postId) => {
            // 乐观更新
            set((s) => {
                mutatePostAcrossLists(s, postId, (post) => {
                    post.isLiked = true;
                    post.likeCount += 1;
                });
            });

            try {
                await spaceAPI.likePost(postId);
            } catch {
                // 回滚
                set((s) => {
                    mutatePostAcrossLists(s, postId, (post) => {
                        post.isLiked = false;
                        post.likeCount = Math.max(0, post.likeCount - 1);
                    });
                });
            }
        },

        unlikePost: async (postId) => {
            // 乐观更新
            set((s) => {
                mutatePostAcrossLists(s, postId, (post) => {
                    post.isLiked = false;
                    post.likeCount = Math.max(0, post.likeCount - 1);
                });
            });

            try {
                await spaceAPI.unlikePost(postId);
            } catch {
                // 回滚
                set((s) => {
                    mutatePostAcrossLists(s, postId, (post) => {
                        post.isLiked = true;
                        post.likeCount += 1;
                    });
                });
            }
        },

        repostPost: async (postId) => {
            // 乐观更新
            set((s) => {
                mutatePostAcrossLists(s, postId, (post) => {
                    if (!post.isReposted) {
                        post.isReposted = true;
                        post.repostCount += 1;
                    }
                });
            });

            try {
                await spaceAPI.repostPost(postId);
            } catch {
                // 回滚
                set((s) => {
                    mutatePostAcrossLists(s, postId, (post) => {
                        post.isReposted = false;
                        post.repostCount = Math.max(0, post.repostCount - 1);
                    });
                });
            }
        },

        unrepostPost: async (postId) => {
            const state = get();
            const current = state.posts.find((p) => p.id === postId)
                || state.allFeed.posts.find((p) => p.id === postId)
                || state.friendsFeed.posts.find((p) => p.id === postId)
                || state.searchResults.find((p) => p.id === postId);
            const wasReposted = Boolean(current?.isReposted);
            if (!wasReposted) return;

            // 乐观更新
            set((s) => {
                mutatePostAcrossLists(s, postId, (post) => {
                    post.isReposted = false;
                    post.repostCount = Math.max(0, post.repostCount - 1);
                });
            });

            try {
                await spaceAPI.unrepostPost(postId);
            } catch {
                // 回滚
                set((s) => {
                    mutatePostAcrossLists(s, postId, (post) => {
                        post.isReposted = true;
                        post.repostCount += 1;
                    });
                });
            }
        },

        // === 本地状态更新 ===
        addPostToTop: (post) =>
            set((s) => {
                if (!s.allFeed.posts.some((p) => p.id === post.id)) {
                    s.allFeed.posts.unshift(post);
                }
                if (!s.friendsFeed.posts.some((p) => p.id === post.id)) {
                    s.friendsFeed.posts.unshift(post);
                }
                syncRootFromActiveScope(s);
            }),

        updatePost: (postId, updates) =>
            set((s) => {
                mutatePostAcrossLists(s, postId, (post) => {
                    Object.assign(post, updates);
                });
            }),

        removePost: (postId) =>
            set((s) => {
                s.allFeed.posts = s.allFeed.posts.filter((p) => p.id !== postId);
                s.friendsFeed.posts = s.friendsFeed.posts.filter((p) => p.id !== postId);
                s.searchResults = s.searchResults.filter((p) => p.id !== postId);
                syncRootFromActiveScope(s);
            }),

        incrementNewPostsCount: () =>
            set((s) => {
                s.newPostsCount += 1;
            }),

        resetNewPostsCount: () =>
            set((s) => {
                s.newPostsCount = 0;
            }),

        receiveRealtimeNotification: (event) =>
            set((s) => {
                const eventId = event?.eventId;
                if (eventId) {
                    if (seenRealtimeNotificationIds.has(eventId)) return;
                    seenRealtimeNotificationIds.add(eventId);
                    if (seenRealtimeNotificationIds.size > 200) {
                        const oldest = seenRealtimeNotificationIds.values().next().value;
                        if (oldest) seenRealtimeNotificationIds.delete(oldest);
                    }
                }
                s.unreadNotificationsCount += 1;
            }),

        clearUnreadNotifications: () =>
            set((s) => {
                s.unreadNotificationsCount = 0;
            }),

        markSeen: (postId) => {
            if (!postId) return;
            const state = get();
            const scope = getScopeKey(state.inNetworkOnly);
            const scopeFeed = getScopeFeed(state, scope);
            const nextSeen = mergeIdWindow(scopeFeed.seenIds, [postId], FEED_STATE_WINDOW);
            set((s) => {
                const target = getScopeFeed(s, scope);
                target.seenIds = nextSeen;
                s.seenIds = nextSeen;
            });
            saveIdWindow('seen', nextSeen, scope);
        },

        setError: (error) =>
            set((s) => {
                const scope = getScopeKey(s.inNetworkOnly);
                const target = getScopeFeed(s, scope);
                target.error = error;
                s.error = error;
            }),
    }))
);

// 选择器
export const selectPosts = (state: SpaceState) => state.posts;
export const selectIsLoadingFeed = (state: SpaceState) => state.isLoadingFeed;
export const selectHasMore = (state: SpaceState) => state.hasMore;
export const selectNewPostsCount = (state: SpaceState) => state.newPostsCount;
