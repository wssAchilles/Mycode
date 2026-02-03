import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { spaceAPI } from '../../services/spaceApi';
import { useAnalytics, useDwellTracker, useImpressionTracker } from '../../hooks/useAnalytics';
import type { PostData } from './SpacePost';
import './NewsPostsList.css';

const PAGE_SIZE = 12;

const formatTime = (date: Date) => {
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const trimText = (text?: string, max = 180) => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max)}...`;
};

interface NewsCardProps {
    post: PostData;
    index: number;
    onOpen: (post: PostData, position: number) => void;
}

const NewsCard: React.FC<NewsCardProps> = ({ post, index, onOpen }) => {
    const impressionRef = useImpressionTracker(post.id, 'news_explore');
    const dwellRef = useDwellTracker(post.id, 'news_explore');

    const title = post.newsMetadata?.title || post.content.split('\n')[0] || '新闻速递';
    const summary = post.newsMetadata?.summary || trimText(post.content, 160);
    const source = post.newsMetadata?.source || 'news';
    const coverUrl = post.media?.[0]?.url;
    const timeLabel = formatTime(post.createdAt);

    return (
        <button
            type="button"
            className="news-post-card"
            onClick={() => onOpen(post, index)}
            ref={(el) => {
                if (impressionRef.current !== el) (impressionRef as any).current = el;
                if (dwellRef.current !== el) (dwellRef as any).current = el;
            }}
        >
            <div className="news-post-card__content">
                <div className="news-post-card__meta">
                    <span className="news-post-card__source">{source}</span>
                    {timeLabel && <span className="news-post-card__time">· {timeLabel}</span>}
                </div>
                <h3 className="news-post-card__title">{title}</h3>
                {summary && <p className="news-post-card__summary">{summary}</p>}
            </div>
            <div
                className="news-post-card__cover"
                style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
            />
        </button>
    );
};

export const NewsPostsList: React.FC = () => {
    const [posts, setPosts] = useState<PostData[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const analytics = useAnalytics({ source: 'news_explore' });

    const loadInitial = useCallback(async () => {
        setLoading(true);
        try {
            const response = await spaceAPI.getNewsPosts(PAGE_SIZE, undefined, 1);
            setPosts(response.posts);
            setCursor(response.nextCursor);
            setHasMore(response.hasMore);
        } catch {
            // noop
        } finally {
            setLoading(false);
        }
    }, []);

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            const response = await spaceAPI.getNewsPosts(PAGE_SIZE, cursor, 1);
            setPosts((prev) => [...prev, ...response.posts]);
            setCursor(response.nextCursor);
            setHasMore(response.hasMore);
        } catch {
            // noop
        } finally {
            setLoadingMore(false);
        }
    }, [cursor, hasMore, loadingMore]);

    useEffect(() => {
        loadInitial();
    }, [loadInitial]);

    const handleOpen = useCallback(
        (post: PostData, position: number) => {
            const url = post.newsMetadata?.url;
            if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            analytics.trackClick(post.id, position);
            spaceAPI.getPost(post.id).catch(() => undefined);
        },
        [analytics]
    );

    const skeletons = useMemo(
        () => Array.from({ length: 4 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="news-post-card news-post-card--skeleton">
                <div className="news-post-card__content">
                    <div className="news-post-card__skeleton-line" />
                    <div className="news-post-card__skeleton-line long" />
                    <div className="news-post-card__skeleton-line" />
                </div>
                <div className="news-post-card__cover" />
            </div>
        )),
        []
    );

    return (
        <section className="news-posts">
            <div className="news-posts__header">
                <h2>新闻列表</h2>
                <span>近 24 小时</span>
            </div>

            {loading && <div className="news-posts__skeletons">{skeletons}</div>}

            {!loading && posts.length === 0 && (
                <div className="news-posts__empty">暂时没有新闻内容</div>
            )}

            {!loading && posts.length > 0 && (
                <div className="news-posts__list">
                    {posts.map((post, index) => (
                        <NewsCard key={post.id} post={post} index={index} onOpen={handleOpen} />
                    ))}
                </div>
            )}

            {hasMore && !loading && (
                <div className="news-posts__footer">
                    <button
                        className="news-posts__load-more"
                        onClick={loadMore}
                        disabled={loadingMore}
                    >
                        {loadingMore ? '加载中...' : '加载更多'}
                    </button>
                    {loadingMore && <div className="news-posts__skeletons">{skeletons}</div>}
                </div>
            )}
        </section>
    );
};

export default NewsPostsList;
