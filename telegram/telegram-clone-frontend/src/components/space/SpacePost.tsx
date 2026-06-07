/**
 * SpacePost - 帖子卡片组件
 * 融合 Telegram 简洁风格 + Twitter 信息流布局
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RecommendationReason, type RecallSource } from './RecommendationReason';
import { SensitiveContentOverlay, type SafetyLevel } from './SensitiveContentOverlay';
import { useAnalytics, useImpressionTracker, useDwellTracker } from '../../hooks/useAnalytics';
import { useSpaceStore } from '../../stores';
import apiClient from '../../services/apiClient';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motionDurations, useAnimeScope, waapi } from '../../core/animation';
import './SpacePost.css';

// 类型定义
export interface PostMedia {
    type: 'image' | 'video' | 'gif';
    url: string;
    thumbnailUrl?: string;
}

export interface PostAuthor {
    id: string;
    username: string;
    handle?: string;
    avatarUrl?: string;
}

export interface NewsMetadata {
    title?: string;
    summary?: string;
    url?: string;
    source?: string;
    clusterId?: number;
}

export interface RecommendationExplain {
    detail?: string;
    primarySource?: string;
    sourceReason?: string;
    inNetwork?: boolean;
    embeddingMatched?: boolean;
    graphMatched?: boolean;
    popularFallback?: boolean;
    diversityAdjusted?: boolean;
    userState?: string;
    selectionPool?: string;
    selectionReason?: string;
    evidence?: string[];
    signals?: Record<string, number>;
}

export interface PostData {
    id: string;
    /** related IDs for industrial-grade seen/served dedup */
    originalPostId?: string;
    replyToPostId?: string;
    conversationId?: string;
    author: PostAuthor;
    content: string;
    media?: PostMedia[];
    createdAt: Date;
    likeCount: number;
    commentCount: number;
    repostCount: number;
    isLiked?: boolean;
    isReposted?: boolean;
    isPinned?: boolean;
    isNews?: boolean;
    newsMetadata?: NewsMetadata;
    // 新增：推荐元数据
    recallSource?: RecallSource;
    recommendationDetail?: string;
    recommendationExplain?: RecommendationExplain;
    recommendationRequestId?: string;
    recommendationRank?: number;
    recommendationScore?: number;
    weightedScore?: number;
    selectionPool?: string;
    selectionReason?: string;
    safetyLevel?: SafetyLevel;
    safetyReason?: string;
}

export interface SpacePostProps {
    post: PostData;
    onLike?: (postId: string) => void;
    onUnlike?: (postId: string) => void;
    onComment?: (postId: string) => void;
    onRepost?: (postId: string) => void;
    onShare?: (postId: string) => void;
    onPinToggle?: (postId: string, nextPinned: boolean) => void;
    onClick?: (postId: string) => void;
    onAuthorClick?: (authorId: string) => void;
    onDismiss?: (postId: string) => void;
    onHide?: (postId: string) => void;
    onBlock?: (authorId: string) => void;
    onMute?: (authorId: string) => void;
    onLayoutChanged?: () => void;
    feedPosition?: number;
    showRecommendationReason?: boolean;
    showPinAction?: boolean;
}

// SVG 图标组件
const HeartIcon: React.FC<{ filled?: boolean }> = ({ filled }) => (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
);

const CommentIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
);

const RepostIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
);

const ShareIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
);

const MoreIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
        <circle cx="5" cy="12" r="1.5" />
    </svg>
);

// 工具函数
const formatTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟`;
    if (diffHours < 24) return `${diffHours}小时`;
    if (diffDays < 7) return `${diffDays}天`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const formatCount = (count: number): string => {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}K`;
    if (count < 1000000) return `${Math.floor(count / 1000)}K`;
    return `${(count / 1000000).toFixed(1)}M`;
};

const getInitials = (name: string): string => {
    return name.charAt(0).toUpperCase();
};

// 主组件
export const SpacePost: React.FC<SpacePostProps> = ({
    post,
    onLike,
    onUnlike,
    onComment,
    onRepost,
    onShare,
    onPinToggle,
    onClick,
    onAuthorClick,
    onDismiss,
    onHide,
    onBlock,
    onMute,
    onLayoutChanged,
    feedPosition,
    showRecommendationReason = true,
    showPinAction = false,
}) => {
    const [isLiked, setIsLiked] = useState(post.isLiked || false);
    const [isReposted, setIsReposted] = useState(post.isReposted || false);
    const [likeCount, setLikeCount] = useState(post.likeCount);
    const [repostCount, setRepostCount] = useState(post.repostCount);
    const [isPinned, setIsPinned] = useState(post.isPinned || false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showReportMenu, setShowReportMenu] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);
    const [isRemoved, setIsRemoved] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement>(null);
    const moreBtnRef = useRef<HTMLButtonElement>(null);
    const analytics = useAnalytics({ source: post.recallSource });
    const recommendationPosition = typeof post.recommendationRank === 'number'
        ? Math.max(0, post.recommendationRank - 1)
        : feedPosition;
    const recommendationEventContext = useMemo(() => ({
        position: recommendationPosition,
        requestId: post.recommendationRequestId,
        recommendationScore: post.recommendationScore,
        selectionPool: post.selectionPool ?? post.recommendationExplain?.selectionPool,
        selectionReason: post.selectionReason ?? post.recommendationExplain?.selectionReason,
    }), [
        recommendationPosition,
        post.recommendationExplain?.selectionPool,
        post.recommendationExplain?.selectionReason,
        post.recommendationRequestId,
        post.recommendationScore,
        post.selectionPool,
        post.selectionReason,
    ]);
    const postMotion = useAnimeScope<HTMLElement, {
        like: () => void;
        repost: () => void;
        menu: () => void;
        remove: (done: () => void) => void;
    }>(
        ({ root, reducedMotion, duration }) => ({
            like: () => {
                if (reducedMotion || !root) return;
                const icon = root.querySelector('.space-post__action--like .space-post__action-icon');
                const count = root.querySelector('.space-post__action--like .space-post__action-count');
                if (icon) {
                    waapi.animate(icon, {
                        scale: [1, 1.18, 1],
                        duration: duration(motionDurations.normal),
                        ease: 'out(4)',
                    });
                }
                if (count) {
                    waapi.animate(count, {
                        opacity: [0.65, 1],
                        y: ['4px', '0px'],
                        duration: duration(motionDurations.fast),
                        ease: 'out(4)',
                    });
                }
            },
            repost: () => {
                if (reducedMotion || !root) return;
                const icon = root.querySelector('.space-post__action--repost .space-post__action-icon');
                const count = root.querySelector('.space-post__action--repost .space-post__action-count');
                if (icon) {
                    waapi.animate(icon, {
                        rotate: ['0deg', '18deg', '0deg'],
                        scale: [1, 1.12, 1],
                        duration: duration(motionDurations.normal),
                        ease: 'out(4)',
                    });
                }
                if (count) {
                    waapi.animate(count, {
                        opacity: [0.65, 1],
                        y: ['4px', '0px'],
                        duration: duration(motionDurations.fast),
                        ease: 'out(4)',
                    });
                }
            },
            menu: () => {
                if (reducedMotion || !moreMenuRef.current) return;
                waapi.animate(moreMenuRef.current, {
                    opacity: [0, 1],
                    y: ['-4px', '0px'],
                    scale: [0.98, 1],
                    duration: duration(motionDurations.fast),
                    ease: 'out(4)',
                });
            },
            remove: (done) => {
                if (reducedMotion || !root) {
                    done();
                    return;
                }
                waapi.animate(root, {
                    opacity: [1, 0],
                    y: ['0px', '-10px'],
                    scale: [1, 0.98],
                    duration: duration(motionDurations.normal),
                    ease: 'out(3)',
                    onComplete: done,
                });
            },
        }),
        [moreMenuRef],
    );

    // 点击外部关闭菜单
    useEffect(() => {
        if (!showMoreMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node) &&
                moreBtnRef.current && !moreBtnRef.current.contains(e.target as Node)
            ) {
                setShowMoreMenu(false);
                setShowReportMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMoreMenu]);

    // 更多选项菜单处理
    const handleMoreClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMoreMenu((prev) => !prev);
        setShowReportMenu(false);
    }, []);

    const finishRemoval = useCallback(
        (callback?: (postId: string) => void) => {
            setIsRemoved(true);
            callback?.(post.id);
            onLayoutChanged?.();
        },
        [onLayoutChanged, post.id],
    );

    const handleDismiss = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMoreMenu(false);
        setIsRemoving(true);
        analytics.trackDismiss(post.id, post.author.id, recommendationEventContext);
        void apiClient.post(`/api/space/posts/${post.id}/not-interested`).catch(() => undefined);
        postMotion.run('remove', () => finishRemoval(onDismiss));
    }, [analytics, finishRemoval, onDismiss, post.author.id, post.id, postMotion, recommendationEventContext]);

    const handleHide = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMoreMenu(false);
        setIsRemoving(true);
        analytics.trackHide(post.id, post.author.id, recommendationEventContext);
        void apiClient.post(`/api/space/posts/${post.id}/hide`).catch(() => undefined);
        postMotion.run('remove', () => finishRemoval(onHide));
    }, [analytics, finishRemoval, onHide, post.author.id, post.id, postMotion, recommendationEventContext]);

    const handleReport = useCallback(async (e: React.MouseEvent, reason: string) => {
        e.stopPropagation();
        setShowMoreMenu(false);
        setShowReportMenu(false);
        analytics.trackReport(post.id, reason, recommendationEventContext);
        try {
            await apiClient.post(`/api/space/posts/${post.id}/report`, { reason });
        } catch { /* fire-and-forget */ }
    }, [analytics, post.id, recommendationEventContext]);

    const handleBlock = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMoreMenu(false);
        analytics.trackBlock(post.author.id, recommendationEventContext);
        try {
            await apiClient.post(`/api/space/users/${post.author.id}/block`);
        } catch { /* fire-and-forget */ }
        onBlock?.(post.author.id);
    }, [analytics, post.author.id, onBlock, recommendationEventContext]);

    const handleMute = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMoreMenu(false);
        analytics.trackMute(post.author.id, recommendationEventContext);
        try {
            await apiClient.post(`/api/space/users/${post.author.id}/mute`);
        } catch { /* fire-and-forget */ }
        onMute?.(post.author.id);
    }, [analytics, post.author.id, onMute, recommendationEventContext]);

    const markSeen = useSpaceStore((state) => state.markSeen);
    const handleImpression = useCallback(
        (postId: string) => {
            // Mark the primary post id as seen.
            markSeen(postId);

            // Mark related ids (thread / reply / repost root) so the server can dedup
            // across related content, aligning with x-algorithm semantics.
            const related = [post.originalPostId, post.replyToPostId, post.conversationId]
                .map((v) => (v ? String(v) : ''))
                .filter(Boolean);
            for (const rid of related) {
                markSeen(rid);
            }
        },
        [markSeen, post.originalPostId, post.replyToPostId, post.conversationId]
    );

    useEffect(() => {
        setIsPinned(post.isPinned || false);
    }, [post.id, post.isPinned]);

    useEffect(() => {
        onLayoutChanged?.();
    }, [onLayoutChanged, post.id, isExpanded, isRemoving]);

    // 曝光和停留时间追踪
    const impressionRef = useImpressionTracker(post.id, post.recallSource, {
        metadata: recommendationEventContext,
        onImpression: handleImpression,
    });
    const dwellRef = useDwellTracker(post.id, post.recallSource, recommendationEventContext);

    const setArticleRef = useCallback(
        (el: HTMLElement | null) => {
            postMotion.rootRef.current = el;
            (impressionRef as unknown as React.MutableRefObject<HTMLElement | null>).current = el;
            (dwellRef as unknown as React.MutableRefObject<HTMLElement | null>).current = el;
        },
        [dwellRef, impressionRef, postMotion.rootRef],
    );

    // 处理点赞
    const handleLike = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isLiked) {
                setIsLiked(false);
                setLikeCount((prev) => Math.max(0, prev - 1));
                analytics.trackUnlike(post.id, recommendationEventContext);
                onUnlike?.(post.id);
            } else {
                setIsLiked(true);
                setLikeCount((prev) => prev + 1);
                postMotion.run('like');
                analytics.trackLike(post.id, recommendationEventContext);
                onLike?.(post.id);
            }
        },
        [analytics, isLiked, onLike, onUnlike, post.id, postMotion, recommendationEventContext]
    );

    // 处理评论
    const handleComment = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            analytics.trackReply(post.id, recommendationEventContext);
            onComment?.(post.id);
        },
        [analytics, post.id, onComment, recommendationEventContext]
    );

    // 处理转发
    const handleRepost = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!isReposted) {
                setIsReposted(true);
                setRepostCount((prev) => prev + 1);
                postMotion.run('repost');
                analytics.trackRepost(post.id, recommendationEventContext);
                onRepost?.(post.id);
            }
        },
        [analytics, isReposted, onRepost, post.id, postMotion, recommendationEventContext]
    );

    // 处理分享
    const handleShare = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            analytics.trackShare(post.id, recommendationEventContext);
            onShare?.(post.id);
        },
        [analytics, post.id, onShare, recommendationEventContext]
    );

    const handlePinToggle = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            const nextPinned = !isPinned;
            setIsPinned(nextPinned);
            onPinToggle?.(post.id, nextPinned);
        },
        [isPinned, onPinToggle, post.id]
    );

    // 处理卡片点击
    const handleClick = useCallback(() => {
        analytics.trackClick(post.id, recommendationPosition, recommendationEventContext);
        onClick?.(post.id);
    }, [analytics, recommendationPosition, post.id, onClick, recommendationEventContext]);

    const handleAuthorClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            analytics.trackProfileClick(post.id, post.author.id, recommendationEventContext);
            onAuthorClick?.(post.author.id);
        },
        [analytics, post.id, post.author.id, onAuthorClick, recommendationEventContext]
    );

    useEffect(() => {
        if (showMoreMenu) {
            postMotion.run('menu');
        }
    }, [postMotion, showMoreMenu]);

    // 渲染媒体网格
    const renderMedia = () => {
        if (!post.media || post.media.length === 0) return null;

        const mediaCount = Math.min(post.media.length, 4);
        const gridClass = `space-post__media-grid grid-${mediaCount}`;

        return (
            <div className="space-post__media">
                <div className={gridClass}>
                    {post.media.slice(0, 4).map((media, index) => (
                        <img
                            key={index}
                            src={media.url}
                            srcSet={media.thumbnailUrl ? `${media.thumbnailUrl} 320w, ${media.url} 1200w` : undefined}
                            sizes="(max-width: 900px) 100vw, 680px"
                            alt=""
                            className="space-post__media-item"
                            loading="lazy"
                            decoding="async"
                            onLoad={onLayoutChanged}
                            onError={onLayoutChanged}
                        />
                    ))}
                </div>
            </div>
        );
    };

    const MAX_LENGTH = 280; // 超过此长度折叠
    const isLongContent = post.content.length > MAX_LENGTH;
    const isNewsPost = Boolean(post.isNews);
    const sourceLabel = post.newsMetadata?.source?.trim();
    const createdAtLabel = formatTimeAgo(post.createdAt);
    const createdAtFull = post.createdAt.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });

    // 帖子内容渲染
    const renderPostContent = () => {
        // 如果未展开且内容过长，截取前 MAX_LENGTH 个字符
        const displayContent = !isExpanded && isLongContent
            ? `${post.content.slice(0, MAX_LENGTH)}...`
            : post.content;

        return (
            <>
                {/* 帖子头部 */}
                <header className="space-post__header">
                    <button className="space-post__avatar" onClick={handleAuthorClick} aria-label={`查看 ${post.author.username} 的主页`}>
                        {post.author.avatarUrl ? (
                            <img src={post.author.avatarUrl} alt={post.author.username} />
                        ) : (
                            <div className="space-post__avatar-placeholder">
                                {getInitials(post.author.username)}
                            </div>
                        )}
                    </button>

                    <div className="space-post__user-info">
                        <div className="space-post__user-row">
                            {isNewsPost && sourceLabel && (
                                <span className="space-post__source-badge">{sourceLabel}</span>
                            )}
                            <button className="space-post__username space-post__author-btn" onClick={handleAuthorClick}>
                                {post.author.username}
                            </button>
                            {post.author.handle && (
                                <>
                                    <span className="space-post__handle">@{post.author.handle}</span>
                                </>
                            )}
                            <span className="space-post__dot">·</span>
                            <span className="space-post__time" title={createdAtFull}>{createdAtLabel}</span>
                            {isPinned && (
                                <>
                                    <span className="space-post__dot">·</span>
                                    <span className="space-post__pinned">置顶</span>
                                </>
                            )}
                        </div>
                        {/* 推荐理由标签 */}
                        {showRecommendationReason && post.recallSource && (
                            <div className="space-post__reason">
                                <RecommendationReason
                                    source={post.recallSource}
                                    detail={post.recommendationDetail}
                                    explain={post.recommendationExplain}
                                    compact
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-post__more-wrapper">
                        <button
                            ref={moreBtnRef}
                            className={`space-post__more-btn ${showMoreMenu ? 'is-active' : ''}`}
                            onClick={handleMoreClick}
                            aria-label="更多选项"
                            aria-expanded={showMoreMenu}
                        >
                            <MoreIcon />
                        </button>
                        {showMoreMenu && createPortal(
                            <div
                                ref={moreMenuRef}
                                className="space-post__more-menu"
                                style={{
                                    position: 'fixed',
                                    top: moreBtnRef.current ? moreBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
                                    right: moreBtnRef.current ? window.innerWidth - moreBtnRef.current.getBoundingClientRect().right : 0,
                                }}
                            >
                                {!showReportMenu ? (
                                    <>
                                        <button className="space-post__menu-item" onClick={handleDismiss}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                            </svg>
                                            不感兴趣
                                        </button>
                                        <button className="space-post__menu-item" onClick={handleHide}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                                <line x1="1" y1="1" x2="23" y2="23" />
                                            </svg>
                                            隐藏此帖
                                        </button>
                                        <button className="space-post__menu-item" onClick={(e) => { e.stopPropagation(); setShowReportMenu(true); }}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                                <line x1="4" y1="22" x2="4" y2="15" />
                                            </svg>
                                            举报
                                        </button>
                                        <div className="space-post__menu-divider" />
                                        <button className="space-post__menu-item space-post__menu-item--danger" onClick={handleBlock}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                            </svg>
                                            屏蔽 @{post.author.username}
                                        </button>
                                        <button className="space-post__menu-item" onClick={handleMute}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                                <line x1="23" y1="9" x2="17" y2="15" />
                                                <line x1="17" y1="9" x2="23" y2="15" />
                                            </svg>
                                            静音 @{post.author.username}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="space-post__menu-item space-post__menu-item--back" onClick={(e) => { e.stopPropagation(); setShowReportMenu(false); }}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                                <polyline points="15 18 9 12 15 6" />
                                            </svg>
                                            返回
                                        </button>
                                        <div className="space-post__menu-divider" />
                                        <button className="space-post__menu-item" onClick={(e) => handleReport(e, 'spam')}>垃圾内容/广告</button>
                                        <button className="space-post__menu-item" onClick={(e) => handleReport(e, 'harassment')}>骚扰/霸凌</button>
                                        <button className="space-post__menu-item" onClick={(e) => handleReport(e, 'misinformation')}>虚假信息</button>
                                        <button className="space-post__menu-item" onClick={(e) => handleReport(e, 'violence')}>暴力/仇恨</button>
                                        <button className="space-post__menu-item" onClick={(e) => handleReport(e, 'other')}>其他原因</button>
                                    </>
                                )}
                            </div>,
                            document.body
                        )}
                    </div>
                </header>

                {/* 帖子内容 */}
                <div className="space-post__content">
                    <div className="space-post__markdown">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                a: ({ node: _node, ...props }) => {
                                    void _node;
                                    return (
                                        <a
                                            {...props}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const href = typeof props.href === 'string' ? props.href : '';
                                                if (href) {
                                                    analytics.trackOpenLink(post.id, href, {
                                                        ...recommendationEventContext,
                                                        authorId: post.author.id,
                                                    });
                                                }
                                            }}
                                        />
                                    );
                                },
                            }}
                        >
                            {displayContent}
                        </ReactMarkdown>
                    </div>

                    {isLongContent && (
                        <button
                            className="space-post__read-more"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                        >
                            {isExpanded ? '收起' : '阅读全文'}
                        </button>
                    )}

                    {renderMedia()}
                </div>

                {/* 操作栏 */}
                <div className="space-post__actions">
                    <button
                        className={`space-post__action space-post__action--comment`}
                        onClick={handleComment}
                        aria-label="评论"
                    >
                        <span className="space-post__action-icon">
                            <CommentIcon />
                        </span>
                        {post.commentCount > 0 && (
                            <span className="space-post__action-count">{formatCount(post.commentCount)}</span>
                        )}
                    </button>

                    <button
                        className={`space-post__action space-post__action--repost ${isReposted ? 'is-active' : ''}`}
                        onClick={handleRepost}
                        aria-label="转发"
                    >
                        <span className="space-post__action-icon">
                            <RepostIcon />
                        </span>
                        {repostCount > 0 && (
                            <span className="space-post__action-count">{formatCount(repostCount)}</span>
                        )}
                    </button>

                    <button
                        className={`space-post__action space-post__action--like ${isLiked ? 'is-active' : ''}`}
                        onClick={handleLike}
                        aria-label="点赞"
                    >
                        <span className="space-post__action-icon">
                            <HeartIcon filled={isLiked} />
                        </span>
                        {likeCount > 0 && (
                            <span className="space-post__action-count">{formatCount(likeCount)}</span>
                        )}
                    </button>

                    <button
                        className="space-post__action space-post__action--share"
                        onClick={handleShare}
                        aria-label="分享"
                    >
                        <span className="space-post__action-icon">
                            <ShareIcon />
                        </span>
                    </button>
                    {showPinAction && (
                        <button
                            className={`space-post__action space-post__action--pin ${isPinned ? 'is-active' : ''}`}
                            onClick={handlePinToggle}
                            aria-label={isPinned ? '取消置顶' : '设为置顶'}
                        >
                            <span className="space-post__action-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 17v5" />
                                    <path d="M9 3h6l1 7-4 4v3H12v-3l-4-4 1-7z" />
                                </svg>
                            </span>
                        </button>
                    )}
                </div>
            </>
        );
    };

    if (isRemoved) return null;

    return (
        <article
            className={`space-post ${isNewsPost ? 'space-post--news' : ''} ${showMoreMenu ? 'space-post--menu-open' : ''} ${isRemoving ? 'is-removing' : ''}`}
            onClick={handleClick}
            ref={setArticleRef}
        >
            {/* 敏感内容遮罩 */}
            {post.safetyLevel && post.safetyLevel !== 'safe' ? (
                <SensitiveContentOverlay
                    level={post.safetyLevel}
                    reason={post.safetyReason}
                >
                    {renderPostContent()}
                </SensitiveContentOverlay>
            ) : (
                renderPostContent()
            )}
        </article>
    );
};

export default SpacePost;
