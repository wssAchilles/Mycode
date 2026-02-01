import React, { useEffect, useMemo, useState } from 'react';
import { spaceAPI, type TrendItem } from '../../services/spaceApi';
import { useSpaceStore } from '../../stores';
import { SpacePost, type SpacePostProps } from './SpacePost';
import './SpaceExplore.css';

export interface SpaceExploreProps {
    onLike: SpacePostProps['onLike'];
    onUnlike: SpacePostProps['onUnlike'];
    onComment: SpacePostProps['onComment'];
    onRepost: SpacePostProps['onRepost'];
    onShare: SpacePostProps['onShare'];
    onPostClick: SpacePostProps['onClick'];
}

export const SpaceExplore: React.FC<SpaceExploreProps> = ({
    onLike,
    onUnlike,
    onComment,
    onRepost,
    onShare,
    onPostClick,
}) => {
    const [query, setQuery] = useState('');
    const [trends, setTrends] = useState<TrendItem[]>([]);

    const searchResults = useSpaceStore((state) => state.searchResults);
    const isSearching = useSpaceStore((state) => state.isSearching);
    const searchQuery = useSpaceStore((state) => state.searchQuery);
    const searchPosts = useSpaceStore((state) => state.searchPosts);
    const clearSearch = useSpaceStore((state) => state.clearSearch);

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

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (trimmed) {
            searchPosts(trimmed);
        } else {
            clearSearch();
        }
    };

    const handleTrendClick = (tag: string) => {
        const text = tag.startsWith('#') ? tag : `#${tag}`;
        setQuery(text);
        searchPosts(text);
    };

    const showEmptyState = useMemo(() => !isSearching && searchResults.length === 0 && !searchQuery, [isSearching, searchResults.length, searchQuery]);

    return (
        <section className="space-explore">
            <header className="space-explore__header">
                <div className="space-explore__title-group">
                    <p className="space-explore__eyebrow">探索空间</p>
                    <h1 className="space-explore__title">发现热门话题与新鲜观点</h1>
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

            <div className="space-explore__results">
                {isSearching && (
                    <div className="space-explore__loading">搜索中...</div>
                )}
                {!isSearching && searchResults.length > 0 && (
                    <div className="space-explore__post-list">
                        {searchResults.map((post) => (
                            <SpacePost
                                key={post.id}
                                post={post}
                                onLike={onLike}
                                onUnlike={onUnlike}
                                onComment={onComment}
                                onRepost={onRepost}
                                onShare={onShare}
                                onClick={onPostClick}
                                showRecommendationReason={false}
                            />
                        ))}
                    </div>
                )}
                {showEmptyState && (
                    <div className="space-explore__empty">
                        <div className="space-explore__empty-title">还没有搜索结果</div>
                        <div className="space-explore__empty-text">试试搜索热门话题或关注新作者。</div>
                    </div>
                )}
                {!isSearching && searchQuery && searchResults.length === 0 && (
                    <div className="space-explore__empty">
                        <div className="space-explore__empty-title">没有找到相关动态</div>
                        <div className="space-explore__empty-text">换一个关键词试试吧。</div>
                    </div>
                )}
            </div>
        </section>
    );
};

export default SpaceExplore;
