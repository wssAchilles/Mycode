import React, { useEffect, useState } from 'react';
import { spaceAPI, type NotificationItem } from '../../services/spaceApi';
import './SpaceNotifications.css';

export interface SpaceNotificationsProps {
    onPostClick: (postId: string) => void;
}

const actionLabelMap: Record<NotificationItem['type'], string> = {
    like: '赞了你的动态',
    reply: '回复了你',
    repost: '转发了你',
    quote: '引用了你',
};

const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const SpaceNotifications: React.FC<SpaceNotificationsProps> = ({ onPostClick }) => {
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);

    const loadNotifications = async (reset: boolean = false) => {
        setLoading(true);
        try {
            const result = await spaceAPI.getNotifications(20, reset ? undefined : cursor);
            setItems((prev) => (reset ? result.items : [...prev, ...result.items]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
        } catch (error) {
            console.error('加载通知失败:', error);
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadNotifications(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <section className="space-notifications">
            <header className="space-notifications__header">
                <div>
                    <p className="space-notifications__eyebrow">动态提醒</p>
                    <h1 className="space-notifications__title">你的 Space 通知</h1>
                </div>
                <button
                    className="space-notifications__refresh"
                    onClick={() => loadNotifications(true)}
                    disabled={loading}
                >
                    刷新
                </button>
            </header>

            <div className="space-notifications__list">
                {loading && items.length === 0 && (
                    <div className="space-notifications__loading">加载中...</div>
                )}
                {!loading && items.length === 0 && (
                    <div className="space-notifications__empty">
                        暂无新的互动
                    </div>
                )}
                {items.map((item) => (
                    <div key={item.id} className="space-notifications__item">
                        <div className="space-notifications__avatar">
                            {item.actor.avatarUrl ? (
                                <img src={item.actor.avatarUrl} alt={item.actor.username} />
                            ) : (
                                <span>{item.actor.username.charAt(0).toUpperCase()}</span>
                            )}
                            {item.actor.isOnline && <span className="space-notifications__online" />}
                        </div>
                        <div className="space-notifications__content">
                            <div className="space-notifications__text">
                                <strong>{item.actor.username}</strong>
                                <span>{actionLabelMap[item.type]}</span>
                            </div>
                            {item.actionText && (
                                <div className="space-notifications__snippet space-notifications__snippet--action">
                                    “{item.actionText}”
                                </div>
                            )}
                            {item.postSnippet && (
                                <div className="space-notifications__snippet">
                                    {item.type === 'reply' ? '动态：' : ''}
                                    “{item.postSnippet}”
                                </div>
                            )}
                        </div>
                        <div className="space-notifications__meta">
                            <span>{formatTime(item.createdAt)}</span>
                            {item.postId && (
                                <button
                                    className="space-notifications__view"
                                    onClick={() => onPostClick(item.postId!)}
                                >
                                    查看
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {hasMore && (
                <div className="space-notifications__more">
                    <button
                        className="space-notifications__more-btn"
                        onClick={() => loadNotifications(false)}
                        disabled={loading}
                    >
                        {loading ? '加载中...' : '加载更多'}
                    </button>
                </div>
            )}
        </section>
    );
};

export default SpaceNotifications;
