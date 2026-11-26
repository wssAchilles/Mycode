import React, { useCallback, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { spaceAPI, type SpaceRelationUser } from '../../services/spaceApi';
import { showToast } from '../ui/Toast';
import './FollowListModal.css';

export type FollowListMode = 'followers' | 'following';

export interface FollowListModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string;
    username: string;
    viewerUserId?: string;
    initialMode: FollowListMode;
    onNavigateUser: (targetUserId: string) => void;
    onViewerFollowChanged?: (delta: number) => void;
}

const PAGE_SIZE = 20;

/**
 * 粉丝 / 正在关注用户列表弹窗：支持 Tab 切换、分页加载、快捷关注与跳转个人主页
 */
export const FollowListModal: React.FC<FollowListModalProps> = ({
    open,
    onOpenChange,
    userId,
    username,
    viewerUserId,
    initialMode,
    onNavigateUser,
    onViewerFollowChanged,
}) => {
    const [mode, setMode] = useState<FollowListMode>(initialMode);
    const [users, setUsers] = useState<SpaceRelationUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [busyUserId, setBusyUserId] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setMode(initialMode);
        }
    }, [open, initialMode]);

    const loadPage = useCallback(async (targetMode: FollowListMode, offset: number, reset: boolean) => {
        if (!userId) return;
        setLoading(true);
        if (reset) setError(null);
        try {
            const fetcher = targetMode === 'followers' ? spaceAPI.getUserFollowers : spaceAPI.getUserFollowing;
            const res = await fetcher(userId, PAGE_SIZE, offset);
            setUsers((prev) => (reset ? res.users : [...prev, ...res.users]));
            setHasMore(res.hasMore);
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载关系列表失败');
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!open) return;
        setUsers([]);
        void loadPage(mode, 0, true);
    }, [open, mode, userId, loadPage]);

    const handleToggleFollow = async (target: SpaceRelationUser) => {
        if (busyUserId) return;
        setBusyUserId(target.id);
        const nextFollow = !target.isFollowing;
        try {
            if (nextFollow) {
                await spaceAPI.followUser(target.id);
                showToast(`已关注 ${target.displayName || target.username}`, 'success');
            } else {
                await spaceAPI.unfollowUser(target.id);
                showToast(`已取消关注 ${target.displayName || target.username}`, 'info');
            }
            setUsers((prev) =>
                prev.map((u) => (u.id === target.id ? { ...u, isFollowing: nextFollow } : u)),
            );
            if (viewerUserId === userId && mode === 'following') {
                onViewerFollowChanged?.(nextFollow ? 1 : -1);
            }
        } catch {
            showToast('操作失败，请稍后重试', 'error');
        } finally {
            setBusyUserId(null);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="follow-modal__overlay" />
                <Dialog.Content className="follow-modal__content" aria-describedby={undefined}>
                    <div className="follow-modal__header">
                        <Dialog.Title className="follow-modal__title">
                            @{username} 的社交关系
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button type="button" className="follow-modal__close" aria-label="关闭关系列表">
                                <X size={18} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="follow-modal__tabs" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'followers'}
                            className={`follow-modal__tab ${mode === 'followers' ? 'is-active' : ''}`}
                            onClick={() => setMode('followers')}
                        >
                            关注者
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'following'}
                            className={`follow-modal__tab ${mode === 'following' ? 'is-active' : ''}`}
                            onClick={() => setMode('following')}
                        >
                            正在关注
                        </button>
                    </div>

                    <div className="follow-modal__list">
                        {loading && users.length === 0 && (
                            <div className="follow-modal__empty">正在加载用户列表...</div>
                        )}
                        {!loading && error && users.length === 0 && (
                            <div className="follow-modal__empty">
                                <span>{error}</span>
                                <button
                                    type="button"
                                    className="follow-modal__retry-btn"
                                    onClick={() => void loadPage(mode, 0, true)}
                                >
                                    重试
                                </button>
                            </div>
                        )}
                        {!loading && !error && users.length === 0 && (
                            <div className="follow-modal__empty">
                                {mode === 'followers' ? '还没有关注者' : '还没有正在关注的用户'}
                            </div>
                        )}

                        {users.map((item) => {
                            const isViewerSelf = Boolean(viewerUserId && viewerUserId === item.id);
                            return (
                                <div key={item.id} className="follow-modal__row">
                                    <button
                                        type="button"
                                        className="follow-modal__user-btn"
                                        onClick={() => {
                                            onOpenChange(false);
                                            onNavigateUser(item.id);
                                        }}
                                    >
                                        <span className="follow-modal__avatar">
                                            {item.avatarUrl ? (
                                                <img src={item.avatarUrl} alt={item.username} />
                                            ) : (
                                                <span>{(item.displayName || item.username).charAt(0).toUpperCase()}</span>
                                            )}
                                        </span>
                                        <span className="follow-modal__meta">
                                            <span className="follow-modal__name">{item.displayName || item.username}</span>
                                            <span className="follow-modal__handle">@{item.username}</span>
                                            {item.bio && <span className="follow-modal__bio">{item.bio}</span>}
                                        </span>
                                    </button>
                                    {!isViewerSelf && (
                                        <button
                                            type="button"
                                            className={`follow-modal__follow-btn ${item.isFollowing ? 'is-followed' : ''}`}
                                            disabled={busyUserId === item.id}
                                            onClick={() => void handleToggleFollow(item)}
                                        >
                                            {item.isFollowing ? '已关注' : '关注'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {hasMore && (
                            <div className="follow-modal__more-wrap">
                                <button
                                    type="button"
                                    className="follow-modal__more-btn"
                                    disabled={loading}
                                    onClick={() => void loadPage(mode, users.length, false)}
                                >
                                    {loading ? '加载中...' : '加载更多'}
                                </button>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default FollowListModal;
