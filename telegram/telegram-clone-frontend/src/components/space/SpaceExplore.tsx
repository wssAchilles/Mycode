import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spaceAPI, type TrendItem } from '../../services/spaceApi';
import newsApi, { type NewsFeedItem } from '../../services/newsApi';
import { useSpaceStore } from '../../stores';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { SpacePost, type SpacePostProps } from './SpacePost';
import { NewsFeed } from './NewsFeed';
import { NewsPostsList } from './NewsPostsList';
import './SpaceExplore.css';

export interface SpaceExploreProps {
    onLike: SpacePostProps['onLike'];
    onUnlike: SpacePostProps['onUnlike'];
    onComment: SpacePostProps['onComment'];
    onRepost: SpacePostProps['onRepost'];
    onShare: SpacePostProps['onShare'];
    onPostClick: SpacePostProps['onClick'];
    onAuthorClick?: SpacePostProps['onAuthorClick'];
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
    onShare,
    onPostClick,
    onAuthorClick,
}) => {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [trends, setTrends] = useState<TrendItem[]>([]);
    const [trendsLoading, setTrendsLoading] = useState(true);
    const [trendsError, setTrendsError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ExploreTab>('recommend');
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
    const feedPosts = useSpaceStore((state) => state.posts);
    const isLoadingFeed = useSpaceStore((state) => state.isLoadingFeed);
    const fetchFeed = useSpaceStore((state) => state.fetchFeed);
    const spaceError = useSpaceStore((state) => state.error);

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
        // 推荐页默认展示推荐内容：优先复用首页 feed；如果为空则主动拉取一次。
        if (activeTab !== 'recommend') return;
        if (searchQuery) return;
        if (searchResults.length > 0) return;
        if (feedPosts.length > 0 || isLoadingFeed) return;
        fetchFeed(true);
    }, [activeTab, searchQuery, searchResults.length, feedPosts.length, isLoadingFeed, fetchFeed]);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = query.trim();
        setActiveTab('recommend');
        if (trimmed) {
            searchPosts(trimmed);
        } else {
            clearSearch();
        }
    };

    const handleTrendClick = (tag: string) => {
        const text = tag.startsWith('#') ? tag : `#${tag}`;
        setQuery(text);
        setActiveTab('recommend');
        searchTopicPosts(tag);
    };

    const recommendedPosts = useMemo(() => {
        if (searchResults.length > 0) return searchResults;
        if (searchQuery) return [];
        return feedPosts;
    }, [searchResults, searchQuery, feedPosts]);

    const shouldShowFallbackNews = useMemo(() => {
        return (
            activeTab === 'recommend'
            && !isSearching
            && !searchQuery
            && !isLoadingFeed
            && recommendedPosts.length === 0
        );
    }, [activeTab, isSearching, searchQuery, isLoadingFeed, recommendedPosts.length]);

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
        void fetchFeed(true);
    }, [fetchFeed, searchMode, searchPosts, searchQuery, searchTopicPosts, searchTopicTag]);

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
                    <button className="space-explore__submit" type="submit">
                        搜索
                    </button>
                </form>
            </header>

            {activeTab === 'recommend' && (
                <div className="space-explore__panel animate-fade-in">
                    <div className="space-explore__results">
                        {isSearching && recommendedPosts.length === 0 && (
                            <ExploreSkeleton />
                        )}
                        {searchQuery && recommendedPosts.length > 0 && (
                            <div className="space-explore__search-summary">
                                <div>
                                    <span className="space-explore__search-title">{searchResultLabel}</span>
                                    <span className="space-explore__search-count">{searchTotalCount} 条相关动态</span>
                                </div>
                                <span className="space-explore__search-shown">当前显示 {recommendedPosts.length}</span>
                            </div>
                        )}
                        {recommendedPosts.length > 0 && (
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
                                            onShare={onShare}
                                            onClick={onPostClick}
                                            onAuthorClick={onAuthorClick}
                                            showRecommendationReason={false}
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
                        {!isSearching && !searchQuery && isLoadingFeed && (
                            <ExploreSkeleton />
                        )}
                        {!isSearching && spaceError && recommendedPosts.length === 0 && (
                            <StateBlock
                                variant="error"
                                title={searchQuery ? '搜索结果加载失败' : '推荐内容加载失败'}
                                description={spaceError}
                                actionLabel="重试"
                                onAction={retryRecommendation}
                                className="space-explore__state"
                            />
                        )}
                        {!isSearching && !spaceError && !searchQuery && !isLoadingFeed && recommendedPosts.length === 0 && (
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
                        {!isSearching && !spaceError && searchQuery && searchResults.length === 0 && (
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
