import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Trash2, X } from 'lucide-react';
import { spaceAPI, type SpaceRelationUser, type TrendItem } from '../../services/spaceApi';
import newsApi, { type NewsFeedItem } from '../../services/newsApi';
import { useSpaceStore } from '../../stores';
import { authUtils } from '../../services/apiClient';
import { showToast } from '../ui/Toast';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { SpacePost, type SpacePostProps } from './SpacePost';
import { NewsFeed } from './NewsFeed';
import { NewsPostsList } from './NewsPostsList';
import { useAnalytics } from '../../hooks/useAnalytics';
import './SpaceExplore.css';

export interface SpaceExploreProps {
    onLike: SpacePostProps['onLike'];
    onUnlike: SpacePostProps['onUnlike'];
    onComment: SpacePostProps['onComment'];
    onRepost: SpacePostProps['onRepost'];
    onUnrepost: SpacePostProps['onUnrepost'];
    onQuote?: SpacePostProps['onQuote'];
    onShare: SpacePostProps['onShare'];
    onPostClick: SpacePostProps['onClick'];
    onAuthorClick?: SpacePostProps['onAuthorClick'];
    onHashtagClick?: SpacePostProps['onHashtagClick'];
}

const RECENT_SEARCHES_KEY = 'tg:space:recent-searches';
const MAX_RECENT_SEARCHES = 8;

function readRecentSearches(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
    } catch {
        return [];
    }
}

function writeRecentSearches(items: string[]): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, MAX_RECENT_SEARCHES)));
    } catch {
        // 忽略存储异常
    }
}

type ExploreTab = 'recommend' | 'topics' | 'news';

const ExploreSkeleton: React.FC = () => (
    <div className="space-explore__skeleton" aria-label="内容加载中">
        {Array.from({ length: 3 }).map((_, index) => (
            <div className="space-explore__skeleton-card" key={`explore-skeleton-${index}`}>
                <Skeleton className="space-explore__skeleton-avatar" />
                <div className="space-explore__skeleton-copy">
                    <Skeleton className="space-explore__skeleton-line is-short" />
                    <Skeleton className="space-explore__skeleton-line" />
                    <Skeleton className="space-explore__skeleton-line" />
                </div>
            </div>
        ))}
    </div>
);

export const SpaceExplore: React.FC<SpaceExploreProps> = ({
    onLike,
    onUnlike,
    onComment,
    onRepost,
    onUnrepost,
    onQuote,
    onShare,
    onPostClick,
    onAuthorClick,
    onHashtagClick,
}) => {
    const navigate = useNavigate();
    const currentUserId = authUtils.getCurrentUser()?.id;
    const analytics = useAnalytics({ source: 'space_explore' });
    const [query, setQuery] = useState('');
    const [trends, setTrends] = useState<TrendItem[]>([]);
    const [trendsLoading, setTrendsLoading] = useState(true);
    const [trendsError, setTrendsError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ExploreTab>('recommend');
    const [resultFilter, setResultFilter] = useState<'all' | 'posts' | 'users'>('all');
    const [userResults, setUserResults] = useState<SpaceRelationUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
    const [fallbackNews, setFallbackNews] = useState<NewsFeedItem[]>([]);
    const [fallbackNewsLoading, setFallbackNewsLoading] = useState(false);
    const [fallbackNewsError, setFallbackNewsError] = useState<string | null>(null);

    const searchResults = useSpaceStore((state) => state.searchResults);
    const isSearching = useSpaceStore((state) => state.isSearching);
    const searchQuery = useSpaceStore((state) => state.searchQuery);
    const searchTotalCount = useSpaceStore((state) => state.searchTotalCount);
    const searchHasMore = useSpaceStore((state) => state.searchHasMore);
    const searchMode = useSpaceStore((state) => state.searchMode);
    const searchTopicTag = useSpaceStore((state) => state.searchTopicTag);
    const searchPosts = useSpaceStore((state) => state.searchPosts);
    const searchTopicPosts = useSpaceStore((state) => state.searchTopicPosts);
    const loadMoreSearchResults = useSpaceStore((state) => state.loadMoreSearchResults);
    const clearSearch = useSpaceStore((state) => state.clearSearch);
    // 探索推荐流只读取全站 Scope（inNetworkOnly: false），与首页“好友”视图完全隔离
    const explorePosts = useSpaceStore((state) => state.allFeed?.posts ?? state.posts);
    const isLoadingExplore = useSpaceStore((state) => state.allFeed?.isLoading ?? state.isLoadingFeed);
    const exploreHasLoaded = useSpaceStore((state) => state.allFeed?.hasLoaded ?? false);
    const exploreError = useSpaceStore((state) => state.allFeed?.error ?? state.error);
    const searchError = useSpaceStore((state) => state.error);
    const fetchExploreFeed = useSpaceStore((state) => state.fetchExploreFeed ?? state.fetchFeed);
    const activeError = searchQuery ? searchError : exploreError;

    const loadTrends = useCallback(async () => {
        setTrendsLoading(true);
        setTrendsError(null);
        try {
            const data = await spaceAPI.getTrends(8);
            setTrends(data);
        } catch {
            setTrendsError('热门话题加载失败，请稍后重试');
        } finally {
            setTrendsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTrends();
    }, [loadTrends]);

    useEffect(() => {
        if (searchQuery && searchQuery !== query) {
            setQuery(searchQuery);
        }
    }, [query, searchQuery]);

    useEffect(() => {
        // 推荐页默认展示全站探索流：若全站缓存为空且未在加载，则主动拉取一次（不影响首页好友 Tab）。
        if (activeTab !== 'recommend') return;
        if (searchQuery) return;
        if (searchResults.length > 0) return;
        if (explorePosts.length > 0 || isLoadingExplore || exploreHasLoaded || exploreError) return;
        fetchExploreFeed(true);
    }, [activeTab, searchQuery, searchResults.length, explorePosts.length, isLoadingExplore, exploreHasLoaded, exploreError, fetchExploreFeed]);

    const recordRecentSearch = useCallback((keyword: string) => {
        const clean = keyword.trim();
        if (!clean) return;
        setRecentSearches((prev) => {
            const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, MAX_RECENT_SEARCHES);
            writeRecentSearches(next);
            return next;
        });
    }, []);

    const executeSearch = useCallback((rawKeyword: string) => {
        const trimmed = rawKeyword.trim();
        setActiveTab('recommend');
        if (!trimmed) {
            setUserResults([]);
            clearSearch();
            return;
        }
        recordRecentSearch(trimmed);
        analytics.trackSearchQuery(trimmed, { productSurface: 'explore' });
        void searchPosts(trimmed);
        setLoadingUsers(true);
        void spaceAPI.searchUsers(trimmed, 12)
            .then((users) => setUserResults(users))
            .finally(() => setLoadingUsers(false));
    }, [analytics, clearSearch, recordRecentSearch, searchPosts]);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        executeSearch(query);
    };

    const handleClearSearchInput = () => {
        setQuery('');
        setUserResults([]);
        setResultFilter('all');
        clearSearch();
    };

    const handleToggleExploreUserFollow = async (target: SpaceRelationUser) => {
        const nextFollow = !target.isFollowing;
        try {
            if (nextFollow) {
                await spaceAPI.followUser(target.id);
                showToast(`已关注 ${target.displayName || target.username}`, 'success');
            } else {
                await spaceAPI.unfollowUser(target.id);
                showToast(`已取消关注 ${target.displayName || target.username}`, 'info');
            }
            setUserResults((prev) =>
                prev.map((u) => (u.id === target.id ? { ...u, isFollowing: nextFollow } : u)),
            );
        } catch {
            showToast('操作失败，请稍后重试', 'error');
        }
    };

    const handleTrendClick = (tag: string) => {
        const text = tag.startsWith('#') ? tag : `#${tag}`;
        setQuery(text);
        setActiveTab('recommend');
        analytics.trackHashtagClick(tag, { productSurface: 'explore' });
        searchTopicPosts(tag);
    };

    const recommendedPosts = useMemo(() => {
        if (searchResults.length > 0) return searchResults;
        if (searchQuery) return [];
        return explorePosts;
    }, [searchResults, searchQuery, explorePosts]);

    const shouldShowFallbackNews = useMemo(() => {
        return (
            activeTab === 'recommend'
            && !isSearching
            && !searchQuery
            && !isLoadingExplore
            && recommendedPosts.length === 0
        );
    }, [activeTab, isSearching, searchQuery, isLoadingExplore, recommendedPosts.length]);

    const searchResultLabel = searchMode === 'topic' && searchTopicTag
        ? `#${searchTopicTag}`
        : searchQuery;

    const loadFallbackNews = useCallback(async () => {
        setFallbackNewsLoading(true);
        setFallbackNewsError(null);
        try {
            const res = await newsApi.getFeed(6);
            setFallbackNews((res.items || []).slice(0, 6));
        } catch {
            setFallbackNewsError('今日新闻加载失败，请稍后重试');
        } finally {
            setFallbackNewsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!shouldShowFallbackNews) return;
        if (fallbackNewsLoading) return;
        if (fallbackNews.length > 0) return;
        if (fallbackNewsError) return;

        loadFallbackNews();
    }, [shouldShowFallbackNews, fallbackNewsLoading, fallbackNews.length, fallbackNewsError, loadFallbackNews]);

    const retryRecommendation = useCallback(() => {
        if (searchMode === 'topic' && searchTopicTag) {
            void searchTopicPosts(searchTopicTag);
            return;
        }
        if (searchQuery) {
            void searchPosts(searchQuery);
            return;
        }
        void fetchExploreFeed(true);
    }, [fetchExploreFeed, searchMode, searchPosts, searchQuery, searchTopicPosts, searchTopicTag]);

    return (
        <section className="space-explore">
            <header className="space-explore__header">
                <div className="space-explore__title-group">
                    <p className="space-explore__eyebrow">探索空间</p>
                    <h1 className="space-explore__title">发现热门话题与新鲜观点</h1>
                </div>
                <div className="space-explore__tabs" role="tablist" aria-label="探索内容分类">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'recommend'}
                        className={`space-explore__tab ${activeTab === 'recommend' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('recommend')}
                    >
                        推荐
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'topics'}
                        className={`space-explore__tab ${activeTab === 'topics' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('topics')}
                    >
                        话题
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'news'}
                        className={`space-explore__tab ${activeTab === 'news' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('news')}
                    >
                        新闻
                    </button>
                </div>
                <form className="space-explore__search" onSubmit={handleSubmit}>
                    <label className="space-explore__sr-only" htmlFor="space-explore-input">
                        搜索 Space 动态
                    </label>
                    <input
                        id="space-explore-input"
                        name="spaceExplore"
                        className="space-explore__input"
                        placeholder="搜索话题、关键词或用户"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    {query.length > 0 && (
                        <button
                            type="button"
                            className="space-explore__clear-btn"
                            aria-label="清空搜索"
                            onClick={handleClearSearchInput}
                        >
                            <X size={15} />
                        </button>
                    )}
                    <button className="space-explore__submit" type="submit">
                        搜索
                    </button>
                </form>
                {recentSearches.length > 0 && (
                    <div className="space-explore__recent" aria-label="最近搜索">
                        <span className="space-explore__recent-label">
                            <Clock size={12} />
                            <span>最近</span>
                        </span>
                        <div className="space-explore__recent-chips">
                            {recentSearches.map((item) => (
                                <span key={item} className="space-explore__recent-chip">
                                    <button
                                        type="button"
                                        className="space-explore__recent-text"
                                        onClick={() => {
                                            setQuery(item);
                                            executeSearch(item);
                                        }}
                                    >
                                        {item}
                                    </button>
                                    <button
                                        type="button"
                                        className="space-explore__recent-del"
                                        aria-label={`删除搜索历史 ${item}`}
                                        onClick={() => {
                                            const next = recentSearches.filter((x) => x !== item);
                                            setRecentSearches(next);
                                            writeRecentSearches(next);
                                        }}
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="space-explore__recent-clear-all"
                            aria-label="清空全部历史"
                            title="清空历史"
                            onClick={() => {
                                setRecentSearches([]);
                                writeRecentSearches([]);
                            }}
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                )}
            </header>

            {activeTab === 'recommend' && (
                <div className="space-explore__panel animate-fade-in">
                    <div className="space-explore__results">
                        {searchQuery && (
                            <div className="space-explore__result-filters" role="tablist" aria-label="搜索结果分类">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={resultFilter === 'all'}
                                    className={`space-explore__filter-pill ${resultFilter === 'all' ? 'is-active' : ''}`}
                                    onClick={() => setResultFilter('all')}
                                >
                                    综合
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={resultFilter === 'posts'}
                                    className={`space-explore__filter-pill ${resultFilter === 'posts' ? 'is-active' : ''}`}
                                    onClick={() => setResultFilter('posts')}
                                >
                                    动态 ({recommendedPosts.length})
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={resultFilter === 'users'}
                                    className={`space-explore__filter-pill ${resultFilter === 'users' ? 'is-active' : ''}`}
                                    onClick={() => setResultFilter('users')}
                                >
                                    用户 ({userResults.length})
                                </button>
                            </div>
                        )}
                        {searchQuery && (resultFilter === 'all' || resultFilter === 'users') && (loadingUsers || userResults.length > 0) && (
                            <div className="space-explore__user-results">
                                <div className="space-explore__user-results-title">
                                    {loadingUsers ? '正在匹配用户...' : `相关用户 (${userResults.length})`}
                                </div>
                                {userResults.map((user) => {
                                    const isSelfUser = Boolean(currentUserId && currentUserId === user.id);
                                    return (
                                        <div key={user.id} className="space-explore__user-card">
                                            <button
                                                type="button"
                                                className="space-explore__user-trigger"
                                                onClick={() => {
                                                    if (onAuthorClick) {
                                                        onAuthorClick(user.id);
                                                    } else {
                                                        navigate(`/space/user/${user.id}`);
                                                    }
                                                }}
                                            >
                                                <span className="space-explore__user-avatar">
                                                    {user.avatarUrl ? (
                                                        <img src={user.avatarUrl} alt={user.username} />
                                                    ) : (
                                                        <span>{(user.displayName || user.username).charAt(0).toUpperCase()}</span>
                                                    )}
                                                </span>
                                                <span className="space-explore__user-meta">
                                                    <span className="space-explore__user-name">
                                                        {user.displayName || user.username}
                                                    </span>
                                                    <span className="space-explore__user-handle">@{user.username}</span>
                                                    {user.bio && <span className="space-explore__user-bio">{user.bio}</span>}
                                                </span>
                                            </button>
                                            {!isSelfUser && (
                                                <button
                                                    type="button"
                                                    className={`space-explore__user-follow ${user.isFollowing ? 'is-followed' : ''}`}
                                                    onClick={() => void handleToggleExploreUserFollow(user)}
                                                >
                                                    {user.isFollowing ? '已关注' : '关注'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {isSearching && recommendedPosts.length === 0 && (
                            <ExploreSkeleton />
                        )}
                        {searchQuery && recommendedPosts.length > 0 && (resultFilter === 'all' || resultFilter === 'posts') && (
                            <div className="space-explore__search-summary">
                                <div>
                                    <span className="space-explore__search-title">{searchResultLabel}</span>
                                    <span className="space-explore__search-count">{searchTotalCount} 条相关动态</span>
                                </div>
                                <span className="space-explore__search-shown">当前显示 {recommendedPosts.length}</span>
                            </div>
                        )}
                        {recommendedPosts.length > 0 && (!searchQuery || resultFilter === 'all' || resultFilter === 'posts') && (
                            <>
                                <div className="space-explore__post-list">
                                    {recommendedPosts.map((post) => (
                                        <SpacePost
                                            key={post.id}
                                            post={post}
                                            onLike={onLike}
                                            onUnlike={onUnlike}
                                            onComment={onComment}
                                            onRepost={onRepost}
                                            onUnrepost={onUnrepost}
                                            onQuote={onQuote}
                                            onShare={onShare}
                                            onClick={onPostClick}
                                            onAuthorClick={onAuthorClick}
                                            onHashtagClick={onHashtagClick}
                                            showRecommendationReason
                                        />
                                    ))}
                                </div>
                                {searchQuery && searchHasMore && (
                                    <button
                                        type="button"
                                        className="space-explore__load-more"
                                        disabled={isSearching}
                                        onClick={loadMoreSearchResults}
                                    >
                                        {isSearching ? '加载中...' : '加载更多'}
                                    </button>
                                )}
                            </>
                        )}
                        {!isSearching && !searchQuery && isLoadingExplore && (
                            <ExploreSkeleton />
                        )}
                        {!isSearching && activeError && recommendedPosts.length === 0 && (
                            <StateBlock
                                variant="error"
                                title={searchQuery ? '搜索结果加载失败' : '推荐内容加载失败'}
                                description={activeError}
                                actionLabel="重试"
                                onAction={retryRecommendation}
                                className="space-explore__state"
                            />
                        )}
                        {!isSearching && !activeError && !searchQuery && !isLoadingExplore && recommendedPosts.length === 0 && (
                            <>
                                <div className="space-explore__empty">
                                    <div className="space-explore__empty-title">暂时没有推荐内容</div>
                                    <div className="space-explore__empty-text">先看看今天的新闻，或发布一条动态来冷启动推荐。</div>
                                    <div className="space-explore__empty-actions">
                                        <button
                                            type="button"
                                            className="space-explore__empty-action"
                                            onClick={() => setActiveTab('news')}
                                        >
                                            看看新闻
                                        </button>
                                        <button
                                            type="button"
                                            className="space-explore__empty-action is-secondary"
                                            onClick={() => setActiveTab('topics')}
                                        >
                                            看看话题
                                        </button>
                                    </div>
                                </div>

                                <div className="space-explore__fallback">
                                    <div className="space-explore__fallback-header">
                                        <div className="space-explore__fallback-title">今日新闻</div>
                                        <button
                                            type="button"
                                            className="space-explore__fallback-link"
                                            onClick={() => setActiveTab('news')}
                                        >
                                            查看全部
                                        </button>
                                    </div>
                                    {fallbackNewsLoading && (
                                        <ExploreSkeleton />
                                    )}
                                    {!fallbackNewsLoading && fallbackNewsError && (
                                        <StateBlock
                                            compact
                                            variant="error"
                                            title="新闻加载失败"
                                            description={fallbackNewsError}
                                            actionLabel="重试"
                                            onAction={loadFallbackNews}
                                        />
                                    )}
                                    {!fallbackNewsLoading && !fallbackNewsError && fallbackNews.length === 0 && (
                                        <div className="space-explore__fallback-empty">暂无新闻内容</div>
                                    )}
                                    {!fallbackNewsLoading && fallbackNews.length > 0 && (
                                        <div className="space-explore__fallback-list">
                                            {fallbackNews.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    className="space-explore__fallback-item"
                                                    onClick={() => navigate(`/news/${item.id}`)}
                                                >
                                                    <div className="space-explore__fallback-item-meta">
                                                        <span className="space-explore__fallback-item-source">{item.source}</span>
                                                        <span className="space-explore__fallback-item-dot">·</span>
                                                        <span className="space-explore__fallback-item-cat">{item.category || '今日'}</span>
                                                    </div>
                                                    <div className="space-explore__fallback-item-title">{item.title}</div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                        {!isSearching && !activeError && searchQuery && searchResults.length === 0 && (
                            <div className="space-explore__empty">
                                <div className="space-explore__empty-title">没有找到相关动态</div>
                                <div className="space-explore__empty-text">换一个关键词试试吧。</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'topics' && (
                <div className="space-explore__panel animate-fade-in">
                    <div className="space-explore__trends">
                        <div className="space-explore__section-title">
                            热门话题
                            <span className="space-explore__section-subtitle">按相关动态数</span>
                        </div>
                        {trendsLoading && (
                            <StateBlock
                                compact
                                variant="info"
                                title="正在加载热门话题"
                                description="稍候即可查看今日讨论趋势。"
                                className="space-explore__state"
                            />
                        )}
                        {!trendsLoading && trendsError && (
                            <StateBlock
                                compact
                                variant="error"
                                title="话题加载失败"
                                description={trendsError}
                                actionLabel="重试"
                                onAction={loadTrends}
                                className="space-explore__state"
                            />
                        )}
                        <div className="space-explore__chips">
                            {!trendsLoading && !trendsError && trends.map((trend) => (
                                <button
                                    key={trend.tag}
                                    type="button"
                                    className="space-explore__chip"
                                    onClick={() => handleTrendClick(trend.tag)}
                                >
                                    <span className="space-explore__chip-tag">
                                        {trend.displayName?.trim() || `#${trend.tag}`}
                                    </span>
                                    <span className="space-explore__chip-count">{trend.count} 条相关动态</span>
                                </button>
                            ))}
                            {!trendsLoading && !trendsError && trends.length === 0 && (
                                <StateBlock
                                    compact
                                    title="暂无热门话题"
                                    description="稍后回来查看新的讨论趋势。"
                                    className="space-explore__state"
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'news' && (
                <div className="space-explore__panel space-explore__panel--news animate-fade-in">
                    <NewsFeed />
                    <NewsPostsList />
                </div>
            )}
        </section>
    );
};

export default SpaceExplore;
