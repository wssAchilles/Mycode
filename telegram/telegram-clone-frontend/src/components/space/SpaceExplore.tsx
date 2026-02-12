import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spaceAPI, type TrendItem } from '../../services/spaceApi';
import newsApi, { type NewsFeedItem } from '../../services/newsApi';
import { useSpaceStore } from '../../stores';
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
    const [activeTab, setActiveTab] = useState<ExploreTab>('recommend');
    const [fallbackNews, setFallbackNews] = useState<NewsFeedItem[]>([]);
    const [fallbackNewsLoading, setFallbackNewsLoading] = useState(false);

    const searchResults = useSpaceStore((state) => state.searchResults);
    const isSearching = useSpaceStore((state) => state.isSearching);
    const searchQuery = useSpaceStore((state) => state.searchQuery);
    const searchPosts = useSpaceStore((state) => state.searchPosts);
    const clearSearch = useSpaceStore((state) => state.clearSearch);
    const feedPosts = useSpaceStore((state) => state.posts);
    const isLoadingFeed = useSpaceStore((state) => state.isLoadingFeed);
    const fetchFeed = useSpaceStore((state) => state.fetchFeed);

    useEffect(() => {
        let mounted = true;
        spaceAPI.getTrends(8).then((data) => {
            if (mounted) setTrends(data);
        });
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (searchQuery && searchQuery !== query) {
            setQuery(searchQuery);
        }
    }, [searchQuery]);

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
        searchPosts(text);
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

    useEffect(() => {
        if (!shouldShowFallbackNews) return;
        if (fallbackNewsLoading) return;
        if (fallbackNews.length > 0) return;

        let mounted = true;
        setFallbackNewsLoading(true);
        newsApi
            .getFeed(6)
            .then((res) => {
                if (!mounted) return;
                setFallbackNews((res.items || []).slice(0, 6));
            })
            .catch(() => {
                // ignore fallback errors
            })
            .finally(() => {
                if (mounted) setFallbackNewsLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [shouldShowFallbackNews, fallbackNewsLoading, fallbackNews.length]);

    return (
        <section className="space-explore">
            <header className="space-explore__header">
                <div className="space-explore__title-group">
                    <p className="space-explore__eyebrow">探索空间</p>
                    <h1 className="space-explore__title">发现热门话题与新鲜观点</h1>
                </div>
                <div className="space-explore__tabs">
                    <button
                        type="button"
                        className={`space-explore__tab ${activeTab === 'recommend' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('recommend')}
                    >
                        推荐
                    </button>
                    <button
                        type="button"
                        className={`space-explore__tab ${activeTab === 'topics' ? 'is-active' : ''}`}
                        onClick={() => setActiveTab('topics')}
                    >
                        话题
                    </button>
                    <button
                        type="button"
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
                        {isSearching && (
                            <div className="space-explore__loading">搜索中...</div>
                        )}
                        {!isSearching && recommendedPosts.length > 0 && (
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
                        )}
                        {!isSearching && !searchQuery && isLoadingFeed && (
                            <div className="space-explore__loading">推荐内容加载中...</div>
                        )}
                        {!isSearching && !searchQuery && !isLoadingFeed && recommendedPosts.length === 0 && (
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
                                        <div className="space-explore__fallback-loading">加载中...</div>
                                    )}
                                    {!fallbackNewsLoading && fallbackNews.length === 0 && (
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
                        {!isSearching && searchQuery && searchResults.length === 0 && (
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
                            <span className="space-explore__section-subtitle">近 24 小时</span>
                        </div>
                        <div className="space-explore__chips">
                            {trends.map((trend) => (
                                <button
                                    key={trend.tag}
                                    className="space-explore__chip"
                                    onClick={() => handleTrendClick(trend.tag)}
                                >
                                    <span className="space-explore__chip-tag">#{trend.tag}</span>
                                    <span className="space-explore__chip-count">{trend.count}</span>
                                </button>
                            ))}
                            {trends.length === 0 && (
                                <div className="space-explore__empty-trend">暂无热门话题</div>
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
