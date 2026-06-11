import React from 'react';
import {
    BellOff,
    BookmarkX,
    EyeOff,
    Flag,
    HeartOff,
    Repeat2,
    ShieldOff,
    Undo2,
    UserMinus,
    UserX,
    VolumeX,
} from 'lucide-react';
import { StateBlock } from '@/components/design-system';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import type { NegativeFeedbackItem, NegativeFeedbackSummary, NegativeFeedbackSignalType } from '../../services/spaceApi';

type NegativeFeedbackPanelProps = {
    items: NegativeFeedbackItem[];
    summary: NegativeFeedbackSummary | null;
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadingMore: boolean;
    undoingId: string | null;
    onRetry: () => void;
    onLoadMore: () => void;
    onUndo: (item: NegativeFeedbackItem) => void;
    onOpenPost: (postId: string) => void;
    onOpenUser: (userId: string) => void;
};

const iconMap: Record<NegativeFeedbackSignalType, React.ComponentType<{ size?: number }>> = {
    unfavorite: HeartOff,
    unretweet: Repeat2,
    unfollow: UserMinus,
    block: UserX,
    mute: VolumeX,
    report: Flag,
    dismiss_post: ShieldOff,
    hide_post: EyeOff,
    unbookmark: BookmarkX,
    notification_dismiss: BellOff,
};

const formatTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatWeight = (value?: number | null): string => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '审计';
    return value > 0 ? `+${value}` : `${value}`;
};

const describeTarget = (item: NegativeFeedbackItem): string => {
    if (item.targetPost?.content) return item.targetPost.content;
    if (item.targetUser?.username) return `@${item.targetUser.username}`;
    if (item.targetType === 'notification') return item.targetId;
    return item.targetId;
};

export const NegativeFeedbackPanel: React.FC<NegativeFeedbackPanelProps> = ({
    items,
    summary,
    loading,
    error,
    hasMore,
    loadingMore,
    undoingId,
    onRetry,
    onLoadMore,
    onUndo,
    onOpenPost,
    onOpenUser,
}) => {
    if (loading && items.length === 0) {
        return (
            <div className="space-profile__negative-skeleton" aria-label="负反馈记录加载中">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div className="space-profile__negative-card" key={`negative-skeleton-${index}`}>
                        <Skeleton className="space-profile__negative-icon-skeleton" />
                        <div className="space-profile__negative-skeleton-copy">
                            <Skeleton className="space-profile__negative-skeleton-line is-title" />
                            <Skeleton className="space-profile__negative-skeleton-line" />
                            <Skeleton className="space-profile__negative-skeleton-line is-short" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error && items.length === 0) {
        return (
            <StateBlock
                title="负反馈记录不可用"
                description={error}
                variant="error"
                actionLabel="重试"
                onAction={onRetry}
            />
        );
    }

    if (items.length === 0) {
        return (
            <StateBlock
                title="还没有负反馈记录"
                description="取消点赞、取消转发、屏蔽、静音、举报、不感兴趣等推荐负特征会集中展示在这里。"
                variant="empty"
            />
        );
    }

    return (
        <div className="space-profile__negative-panel">
            <div className="space-profile__negative-summary" aria-label="负反馈摘要">
                <span>负反馈记录</span>
                <strong>{summary?.total ?? items.length}</strong>
                <span>累计权重</span>
                <strong>{formatWeight(summary?.negativeWeightTotal)}</strong>
            </div>

            <div className="space-profile__negative-list">
                {items.map((item) => {
                    const Icon = iconMap[item.signalType] || ShieldOff;
                    const targetText = describeTarget(item);
                    const undoing = undoingId === item.id;

                    return (
                        <article className="space-profile__negative-card" key={item.id}>
                            <div className="space-profile__negative-icon" aria-hidden="true">
                                <Icon size={18} />
                            </div>
                            <div className="space-profile__negative-main">
                                <div className="space-profile__negative-head">
                                    <div className="space-profile__negative-title">
                                        <span>{item.label}</span>
                                        <span className="space-profile__negative-time">{formatTime(item.createdAt)}</span>
                                    </div>
                                    <span className="space-profile__negative-weight">
                                        {formatWeight(item.negativeWeight)}
                                    </span>
                                </div>
                                <div className="space-profile__negative-meta">
                                    {item.reasonLabel && <span>原因：{item.reasonLabel}</span>}
                                    {item.productSurface && <span>来源：{item.productSurface}</span>}
                                    {item.generatedBy && <span>批次：{item.generatedBy}</span>}
                                </div>
                                <div className="space-profile__negative-target">
                                    <span className="space-profile__negative-target-label">
                                        {item.targetPost ? '帖子' : item.targetUser ? '用户' : '目标'}
                                    </span>
                                    <button
                                        type="button"
                                        className="space-profile__negative-target-btn"
                                        onClick={() => {
                                            if (item.targetPost) onOpenPost(item.targetPost.id);
                                            else if (item.targetUser) onOpenUser(item.targetUser.id);
                                        }}
                                        disabled={!item.targetPost && !item.targetUser}
                                    >
                                        {targetText}
                                    </button>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="space-profile__negative-undo"
                                onClick={() => onUndo(item)}
                                disabled={undoing}
                                aria-label={`撤销${item.label}`}
                            >
                                <Undo2 size={15} />
                                <span>{undoing ? '撤销中' : '撤销'}</span>
                            </button>
                        </article>
                    );
                })}
            </div>

            {error && (
                <StateBlock
                    title="部分记录加载失败"
                    description={error}
                    variant="error"
                    compact
                    actionLabel="重试"
                    onAction={onRetry}
                />
            )}

            {hasMore && (
                <button
                    type="button"
                    className="space-profile__more"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                >
                    {loadingMore ? '加载中...' : '加载更多'}
                </button>
            )}
        </div>
    );
};

export default NegativeFeedbackPanel;
