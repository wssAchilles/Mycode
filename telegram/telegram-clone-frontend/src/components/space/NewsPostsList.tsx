import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import newsApi, { type NewsFeedItem } from '../../services/newsApi';
import './NewsPostsList.css';

const PAGE_SIZE = 12;

const formatTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const trimText = (text?: string, max = 180) => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max)}...`;
};

const useNewsTracking = (newsId: string) => {
    const ref = React.useRef<HTMLButtonElement | null>(null);
    const impressed = React.useRef(false);
    const start = React.useRef<number | null>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    if (!impressed.current) {
                        impressed.current = true;
                        newsApi.trackEvent(newsId, 'impression');
                    }
                    start.current = Date.now();
                } else if (start.current) {
                    const dwell = Date.now() - start.current;
                    newsApi.trackEvent(newsId, 'dwell', dwell);
                    start.current = null;
                }
            },
            { threshold: 0.6 }
        );
        observer.observe(el);
        return () => {
            observer.disconnect();
            if (start.current) {
                const dwell = Date.now() - start.current;
                newsApi.trackEvent(newsId, 'dwell', dwell);
                start.current = null;
            }
        };
    }, [newsId]);

    return ref;
};

interface NewsCardProps {
    item: NewsFeedItem;
    onOpen: (id: string) => void;
}

const NewsCard: React.FC<NewsCardProps> = ({ item, onOpen }) => {
    const trackRef = useNewsTracking(item.id);
    return (
        <button className="news-post-card" type="button" onClick={() => onOpen(item.id)} ref={trackRef}>
            <div className="news-post-card__content">
                <div className="news-post-card__meta">
                    <span className="news-post-card__source">{item.source}</span>
                    {item.publishedAt && <span className="news-post-card__time">· {formatTime(item.publishedAt)}</span>}
                </div>
                <h3 className="news-post-card__title">{item.title}</h3>
                {item.summary && <p className="news-post-card__summary">{trimText(item.summary, 160)}</p>}
            </div>
            <div
                className="news-post-card__cover"
                style={{ backgroundImage: item.coverImageUrl ? `url(${item.coverImageUrl})` : undefined }}
            />
        </button>
    );
};

export const NewsPostsList: React.FC = () => {
    const [items, setItems] = useState<NewsFeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [windowKey, setWindowKey] = useState<string | undefined>(undefined);
    const navigate = useNavigate();

    const loadInitial = useCallback(async () => {
        setLoading(true);
        try {
            const response = await newsApi.getFeed(PAGE_SIZE);
            setItems(response.items);
            setCursor(response.nextCursor);
            setHasMore(response.hasMore);
            setWindowKey(response.windowKey || response.windowStart);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            const response = await newsApi.getFeed(PAGE_SIZE, cursor);
            setItems((prev) => [...prev, ...response.items]);
            setCursor(response.nextCursor);
            setHasMore(response.hasMore);
        } finally {
            setLoadingMore(false);
        }
    }, [cursor, hasMore, loadingMore]);

    useEffect(() => {
        loadInitial();
    }, [loadInitial]);

    useEffect(() => {
        let mounted = true;
        const poll = async () => {
            try {
                const response = await newsApi.getFeed(PAGE_SIZE);
                if (!mounted) return;

                const nextWindowKey = response.windowKey || response.windowStart;
                if (windowKey && nextWindowKey && windowKey !== nextWindowKey) {
                    // Cross-day: replace list with today's items only.
                    setItems(response.items);
                    setCursor(response.nextCursor);
                    setHasMore(response.hasMore);
                    setWindowKey(nextWindowKey);
                    return;
                }

                if (!windowKey && nextWindowKey) setWindowKey(nextWindowKey);

                // Same-day: merge new items at top (dedupe by id).
                if (response.items?.length) {
                    setItems((prev) => {
                        const seen = new Set<string>();
                        const merged: NewsFeedItem[] = [];
                        for (const it of [...response.items, ...prev]) {
                            if (seen.has(it.id)) continue;
                            seen.add(it.id);
                            merged.push(it);
                        }
                        return merged;
                    });
                }
            } catch {
                // ignore polling errors
            }
        };

        const intervalId = window.setInterval(poll, 60 * 60 * 1000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') poll();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            mounted = false;
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [windowKey]);

    const openDetail = (id: string) => {
        newsApi.trackEvent(id, 'click');
        navigate(`/news/${id}`);
    };

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
                <span>今天</span>
            </div>

            {loading && <div className="news-posts__skeletons">{skeletons}</div>}

            {!loading && items.length === 0 && (
                <div className="news-posts__empty">暂时没有新闻内容</div>
            )}

            {!loading && items.length > 0 && (
                <div className="news-posts__list">
                    {items.map((item) => (
                        <NewsCard key={item.id} item={item} onOpen={openDetail} />
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
