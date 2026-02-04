import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { spaceAPI, type NewsBriefItem } from '../../services/spaceApi';
import { useAnalytics, useDwellTracker, useImpressionTracker } from '../../hooks/useAnalytics';
import './NewsBrief.css';

const DEFAULT_LIMIT = 5;

const formatTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const trimText = (text?: string, max = 140) => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max)}...`;
};

interface NewsBriefCardProps {
    item: NewsBriefItem & { summaryText?: string; timeLabel?: string; index: number };
    onOpen: (item: NewsBriefItem, position: number) => void;
}

const NewsBriefCard: React.FC<NewsBriefCardProps> = ({ item, onOpen }) => {
    const impressionRef = useImpressionTracker(item.postId, 'news_home');
    const dwellRef = useDwellTracker(item.postId, 'news_home');

    return (
        <button
            type="button"
            className="news-brief__card"
            onClick={() => onOpen(item, item.index)}
            ref={(el) => {
                if (impressionRef.current !== el) (impressionRef as any).current = el;
                if (dwellRef.current !== el) (dwellRef as any).current = el;
            }}
        >
            <div
                className="news-brief__cover"
                style={{ backgroundImage: item.coverUrl ? `url(${item.coverUrl})` : undefined }}
            >
                <span className="news-brief__badge">NEWS</span>
            </div>
            <div className="news-brief__content">
                <h3 className="news-brief__card-title">{item.title}</h3>
                {item.summaryText && (
                    <p className="news-brief__summary">{item.summaryText}</p>
                )}
                <div className="news-brief__footer">
                    <span>{item.source || 'news'}</span>
                    {item.timeLabel && <span>· {item.timeLabel}</span>}
                </div>
            </div>
        </button>
    );
};

export const NewsBrief: React.FC = () => {
    const [items, setItems] = useState<NewsBriefItem[]>([]);
    const [loading, setLoading] = useState(true);
    const analytics = useAnalytics({ source: 'news_home' });

    useEffect(() => {
        let mounted = true;
        const fetchBrief = async () => {
            try {
                const data = await spaceAPI.getNewsBrief(DEFAULT_LIMIT, 24);
                if (mounted) {
                    setItems(data);
                }
            } catch {
                // noop
            } finally {
                if (mounted) setLoading(false);
            }
        };
        fetchBrief();
        return () => {
            mounted = false;
        };
    }, []);

    const cards = useMemo(() => {
        return items.map((item, index) => ({
            ...item,
            summaryText: trimText(item.summary),
            timeLabel: formatTime(item.createdAt),
            index,
        }));
    }, [items]);

    const handleOpen = useCallback(
        (item: NewsBriefItem, position: number) => {
            if (item.url) {
                window.open(item.url, '_blank', 'noopener,noreferrer');
            }
            if (item.postId) {
                analytics.trackClick(item.postId, position);
                spaceAPI.getPost(item.postId).catch(() => undefined);
            }
        },
        [analytics]
    );

    if (!loading && items.length === 0) {
        return null;
    }

    return (
        <section className="news-brief">
            <div className="news-brief__header">
                <div>
                    <p className="news-brief__eyebrow">Daily News</p>
                    <h2 className="news-brief__title">今日时事速递</h2>
                </div>
                <span className="news-brief__meta">更新周期：每小时</span>
            </div>

            <div className="news-brief__grid">
                {loading &&
                    Array.from({ length: DEFAULT_LIMIT }).map((_, idx) => (
                        <div key={`skeleton-${idx}`} className="news-brief__card news-brief__card--skeleton">
                            <div className="news-brief__skeleton-cover" />
                            <div className="news-brief__skeleton-line" />
                            <div className="news-brief__skeleton-line short" />
                        </div>
                    ))}

                {!loading &&
                    cards.map((item) => (
                        <NewsBriefCard key={item.postId} item={item} onOpen={handleOpen} />
                    ))}
            </div>
        </section>
    );
};

export default NewsBrief;
