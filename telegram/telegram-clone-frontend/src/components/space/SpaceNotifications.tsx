import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { spaceAPI, type NotificationItem } from '../../services/spaceApi';
import { APP_SOCIAL_NOTIFICATION_EVENT } from '../../features/realtime/contracts';
import './SpaceNotifications.css';

export interface SpaceNotificationsProps {
    onPostClick: (postId: string) => void;
    onAuthorClick?: (userId: string) => void;
}

type NotificationFilter = 'all' | 'reply' | 'like' | 'repost';

const LAST_SEEN_STORAGE_KEY = 'tg_space_notif_last_seen';

function readNotifLastSeen(): number {
    if (typeof window === 'undefined') return 0;
    try {
        const raw = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY);
        const ts = raw ? Number(raw) : 0;
        return Number.isFinite(ts) ? ts : 0;
    } catch {
        return 0;
    }
}

function writeNotifLastSeen(ts: number): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, String(ts));
    } catch {
        // 忽略存储异常
    }
}

const actionLabelMap: Record<NotificationItem['type'], string> = {
    like: '赞了你的动态',
    reply: '回复了你',
    repost: '转发了你',
    quote: '引用了你',
};

const getNotificationKey = (item: NotificationItem) =>
    [item.actor.id, item.type, item.postId ?? ''].join(':');

const dedupeNotifications = (notifications: NotificationItem[]) => {
    const seen = new Set<string>();
    return notifications.filter((item) => {
        const key = getNotificationKey(item);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const SpaceNotifications: React.FC<SpaceNotificationsProps> = ({
    onPostClick,
    onAuthorClick,
}) => {
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const prevLastSeenRef = useRef<number>(readNotifLastSeen());

    const loadNotifications = async (reset: boolean = false, silent: boolean = false) => {
        if (!silent) {
            setLoading(true);
            setError(null);
        }
        try {
            const result = await spaceAPI.getNotifications(20, reset ? undefined : cursor);
            setItems((prev) => dedupeNotifications(reset ? result.items : [...prev, ...result.items]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
            if (reset && result.items.length > 0) {
                const newestTs = Math.max(...result.items.map((it) => new Date(it.createdAt).getTime() || 0));
                if (newestTs > 0) {
                    writeNotifLastSeen(newestTs);
                }
            }
        } catch (error) {
            if (!silent) {
                console.error('加载通知失败:', error);
                setError('通知加载失败，请稍后重试');
                setHasMore(false);
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    const visibleItems = useMemo(() => {
        if (filter === 'all') return items;
        if (filter === 'reply') return items.filter((item) => item.type === 'reply' || item.type === 'quote');
        return items.filter((item) => item.type === filter);
    }, [items, filter]);

    useEffect(() => {
        loadNotifications(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 收到实时社交互动推送时自动静默刷新列表，免手动点击刷新
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleSocialNotification = () => {
            void loadNotifications(true, true);
        };
        window.addEventListener(APP_SOCIAL_NOTIFICATION_EVENT, handleSocialNotification);
        return () => {
            window.removeEventListener(APP_SOCIAL_NOTIFICATION_EVENT, handleSocialNotification);
        };
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
                    type="button"
                    className="space-notifications__refresh"
                    onClick={() => loadNotifications(true)}
                    disabled={loading}
                    aria-busy={loading}
                >
                    刷新
                </button>
            </header>

            <div className="space-notifications__filters" role="tablist" aria-label="通知分类筛选">
                {([
                    { id: 'all', label: '全部' },
                    { id: 'reply', label: '回复与引用' },
                    { id: 'like', label: '点赞' },
                    { id: 'repost', label: '转发' },
                ] as const).map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={filter === tab.id}
                        className={`space-notifications__filter-pill ${filter === tab.id ? 'is-active' : ''}`}
                        onClick={() => setFilter(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="space-notifications__list">
                {loading && items.length === 0 && (
                    <div className="space-notifications__skeleton" aria-label="通知加载中">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div className="space-notifications__skeleton-row" key={`notification-skeleton-${index}`}>
                                <Skeleton className="space-notifications__skeleton-avatar" />
                                <div className="space-notifications__skeleton-copy">
                                    <Skeleton className="space-notifications__skeleton-line is-short" />
                                    <Skeleton className="space-notifications__skeleton-line" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {!loading && error && items.length === 0 && (
                    <StateBlock
                        variant="error"
                        title="通知加载失败"
                        description={error}
                        actionLabel="重试"
                        onAction={() => loadNotifications(true)}
                        className="space-notifications__state"
                    />
                )}
                {!loading && !error && visibleItems.length === 0 && (
                    <StateBlock
                        title={filter === 'all' ? '暂无新的互动' : '该分类下暂无通知'}
                        description="点赞、回复和转发会集中显示在这里。"
                        className="space-notifications__state"
                    />
                )}
                {visibleItems.map((item) => {
                    const itemTs = new Date(item.createdAt).getTime() || 0;
                    const isUnread = prevLastSeenRef.current > 0 && itemTs > prevLastSeenRef.current;
                    const isClickable = Boolean(item.postId);

                    return (
                        <div
                            key={item.id}
                            className={`space-notifications__item ${isUnread ? 'is-unread' : ''} ${
                                isClickable ? 'is-clickable' : ''
                            }`}
                            onClick={() => {
                                if (item.postId) onPostClick(item.postId);
                            }}
                        >
                            <button
                                type="button"
                                className="space-notifications__avatar space-notifications__avatar-btn"
                                aria-label={`查看 ${item.actor.username} 的主页`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAuthorClick?.(item.actor.id);
                                }}
                            >
                                {item.actor.avatarUrl ? (
                                    <img src={item.actor.avatarUrl} alt={item.actor.username} />
                                ) : (
                                    <span>{item.actor.username.charAt(0).toUpperCase()}</span>
                                )}
                                {item.actor.isOnline && <span className="space-notifications__online" />}
                            </button>
                            <div className="space-notifications__content">
                                <div className="space-notifications__text">
                                    <button
                                        type="button"
                                        className="space-notifications__actor-link"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAuthorClick?.(item.actor.id);
                                        }}
                                    >
                                        {item.actor.username}
                                    </button>
                                    <span>{actionLabelMap[item.type]}</span>
                                    {isUnread && <span className="space-notifications__unread-dot" aria-label="未读" />}
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
                                        type="button"
                                        className="space-notifications__view"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onPostClick(item.postId!);
                                        }}
                                    >
                                        查看
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {hasMore && (
                <div className="space-notifications__more">
                    <button
                        type="button"
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
