import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, UserCheck, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { spaceAPI, type UserProfile } from '../../services/spaceApi';
import { authUtils } from '../../services/apiClient';
import {
    patchProfileFollowCache,
    readProfileCache,
} from '../../features/space/profileMemoryCache';
import { showToast } from '../ui/Toast';
import { resolveSpaceMediaUrl } from '../../utils/spaceMediaUrl';
import './AuthorHoverCard.css';

interface AuthorHoverCardProps {
    authorId: string;
    authorName: string;
    authorAvatarUrl?: string;
    children: React.ReactNode;
}

export const AuthorHoverCard: React.FC<AuthorHoverCardProps> = ({
    authorId,
    authorName,
    authorAvatarUrl,
    children,
}) => {
    const navigate = useNavigate();
    const triggerRef = useRef<HTMLDivElement>(null);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(false);
    const [mutatingFollow, setMutatingFollow] = useState(false);

    const currentUser = authUtils.getCurrentUser();
    const isSelf = currentUser?.id === authorId;
    const isBotOrExternal = !authorId || authorId === 'news_bot_official';

    useEffect(
        () => () => {
            if (openTimerRef.current) clearTimeout(openTimerRef.current);
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        },
        [],
    );

    const clearTimers = () => {
        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const scheduleOpen = () => {
        if (isBotOrExternal || typeof window === 'undefined') return;
        clearTimers();
        openTimerRef.current = setTimeout(() => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const left = Math.min(Math.max(12, rect.left), window.innerWidth - 312);
            const preferBelow = rect.bottom + 210 < window.innerHeight;
            const top = preferBelow ? rect.bottom + 8 : Math.max(12, rect.top - 196);
            setCoords({ top, left });
            setOpen(true);

            const cached = readProfileCache(authorId);
            if (cached?.profile) {
                setProfile(cached.profile);
                return;
            }
            if (!profile && !loading) {
                setLoading(true);
                void spaceAPI
                    .getUserProfile(authorId)
                    .then((res) => setProfile(res))
                    .catch(() => undefined)
                    .finally(() => setLoading(false));
            }
        }, 350);
    };

    const scheduleClose = () => {
        clearTimers();
        closeTimerRef.current = setTimeout(() => {
            setOpen(false);
        }, 180);
    };

    const handleFollowToggle = async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!profile || mutatingFollow || isSelf) return;
        setMutatingFollow(true);
        const wasFollowed = Boolean(profile.isFollowed);
        try {
            if (wasFollowed) {
                await spaceAPI.unfollowUser(profile.id);
                setProfile((prev) =>
                    prev
                        ? {
                            ...prev,
                            isFollowed: false,
                            stats: { ...prev.stats, followers: Math.max(0, prev.stats.followers - 1) },
                        }
                        : prev,
                );
                patchProfileFollowCache(profile.id, false, -1);
                showToast(`已取消关注 ${profile.username}`, 'info');
            } else {
                await spaceAPI.followUser(profile.id);
                setProfile((prev) =>
                    prev
                        ? {
                            ...prev,
                            isFollowed: true,
                            stats: { ...prev.stats, followers: prev.stats.followers + 1 },
                        }
                        : prev,
                );
                patchProfileFollowCache(profile.id, true, 1);
                showToast(`已关注 ${profile.username}`, 'success');
            }
        } catch {
            showToast('操作失败，请稍后重试', 'error');
        } finally {
            setMutatingFollow(false);
        }
    };

    const resolvedAvatar = resolveSpaceMediaUrl(profile?.avatarUrl || authorAvatarUrl);
    const displayName = profile?.displayName || profile?.username || authorName;

    return (
        <div
            ref={triggerRef}
            className="author-hover-trigger"
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
        >
            {children}
            {open &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className="author-hover-card"
                        style={{ top: coords.top, left: coords.left }}
                        onMouseEnter={clearTimers}
                        onMouseLeave={scheduleClose}
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-label={`${displayName} 简介卡片`}
                    >
                        <div className="author-hover-card__top">
                            <button
                                type="button"
                                className="author-hover-card__avatar"
                                onClick={() => {
                                    setOpen(false);
                                    navigate(`/space/user/${authorId}`);
                                }}
                            >
                                {resolvedAvatar ? (
                                    <img src={resolvedAvatar} alt={displayName} />
                                ) : (
                                    <span>{displayName.charAt(0).toUpperCase()}</span>
                                )}
                            </button>

                            {!isSelf && profile && (
                                <div className="author-hover-card__actions">
                                    <button
                                        type="button"
                                        className="author-hover-card__dm"
                                        onClick={() => {
                                            setOpen(false);
                                            navigate(`/chat?dm=${encodeURIComponent(authorId)}`);
                                        }}
                                        aria-label={`给 ${displayName} 发私信`}
                                        title="发私信"
                                    >
                                        <MessageSquare size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className={`author-hover-card__follow ${profile.isFollowed ? 'is-following' : ''}`}
                                        disabled={mutatingFollow}
                                        onClick={(e) => void handleFollowToggle(e)}
                                    >
                                        {profile.isFollowed ? <UserCheck size={13} /> : <UserPlus size={13} />}
                                        <span>{profile.isFollowed ? '已关注' : '关注'}</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div
                            className="author-hover-card__identity"
                            onClick={() => {
                                setOpen(false);
                                navigate(`/space/user/${authorId}`);
                            }}
                        >
                            <div className="author-hover-card__name">{displayName}</div>
                            <div className="author-hover-card__handle">@{profile?.username || authorName}</div>
                        </div>

                        {loading && !profile ? (
                            <div className="author-hover-card__bio is-muted">正在加载简介...</div>
                        ) : profile?.bio ? (
                            <div className="author-hover-card__bio">{profile.bio}</div>
                        ) : (
                            <div className="author-hover-card__bio is-muted">这个人很低调，还没有留下简介。</div>
                        )}

                        {profile && (
                            <div className="author-hover-card__stats">
                                <span>
                                    <strong>{profile.stats.following}</strong> 正在关注
                                </span>
                                <span>
                                    <strong>{profile.stats.followers}</strong> 粉丝
                                </span>
                                <span>
                                    <strong>{profile.stats.posts}</strong> 动态
                                </span>
                            </div>
                        )}
                    </div>,
                    document.body,
                )}
        </div>
    );
};
