/**
 * SpaceTimeline - 时间线组件
 * 整合帖子列表、加载状态、无限滚动
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SpacePost, type PostData, type SpacePostProps } from './SpacePost';
import { PostComposer, type PostComposerProps } from './PostComposer';
import { NewsFeed } from './NewsFeed';
import { NewsHomeSection } from './NewsHomeSection';
import './SpaceTimeline.css';

export interface SpaceTimelineProps {
    posts: PostData[];
    isLoading: boolean;
    hasMore: boolean;
    newPostsCount?: number;
    currentUser: PostComposerProps['currentUser'];
    /** 工业级：只显示好友/关注网络内内容（类似 Twitter Following） */
    inNetworkOnly?: boolean;
    onInNetworkOnlyChange?: (value: boolean) => void;
    onLoadMore: () => void;
    onRefresh?: () => void;
    onCreatePost: PostComposerProps['onSubmit'];
    onLike: SpacePostProps['onLike'];
    onUnlike: SpacePostProps['onUnlike'];
    onComment: SpacePostProps['onComment'];
    onRepost: SpacePostProps['onRepost'];
    onShare: SpacePostProps['onShare'];
    onPostClick: SpacePostProps['onClick'];
    onAuthorClick?: SpacePostProps['onAuthorClick'];
    /** SpacePage scroll container (avoid window scrolling + enables virtualization). */
    scrollElementRef?: React.RefObject<HTMLElement | null>;
}

// 空状态图标
// 3D 浮动气泡图标 - Premium SVG
const EmptyIcon: React.FC = () => (
    <svg viewBox="0 0 100 100" className="space-timeline__empty-icon">
        <defs>
            <linearGradient id="bubbleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3390EC" />
                <stop offset="100%" stopColor="#8774E1" />
            </linearGradient>
            <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>
        <circle cx="50" cy="50" r="28" fill="url(#bubbleGradient)" filter="url(#glow)" opacity="0.9" />
        <path d="M50 38c-8 0-15 6-15 13.5 0 4.5 2.5 8.5 6.5 11l-1.5 4.5 6-3c1.5 0.5 3 0.5 4 0.5 8 0 15-6 15-13.5s-7-13.5-15-13.5z" fill="white" transform="translate(0, 0)" />
    </svg>
);

export const SpaceTimeline: React.FC<SpaceTimelineProps> = ({
    posts,
    isLoading,
    hasMore,
    newPostsCount = 0,
    currentUser,
    inNetworkOnly = false,
    onInNetworkOnlyChange,
    onLoadMore,
    onRefresh,
    onCreatePost,
    onLike,
    onUnlike,
    onComment,
    onRepost,
    onShare,
    onPostClick,
    onAuthorClick,
    scrollElementRef,
}) => {
    const [showNewPostsHint, setShowNewPostsHint] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const topRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);

    const scrollToTop = useCallback(() => {
        const el = scrollElementRef?.current as any;
        if (el && typeof el.scrollTo === 'function') {
            el.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [scrollElementRef]);

    // 显示新帖子提示
    useEffect(() => {
        if (newPostsCount > 0) {
            setShowNewPostsHint(true);
        }
    }, [newPostsCount]);

    // 处理点击新帖子提示
    const handleNewPostsClick = useCallback(() => {
        setShowNewPostsHint(false);
        onRefresh?.();
        scrollToTop();
    }, [onRefresh, scrollToTop]);

    // 无限滚动 - IntersectionObserver
    useEffect(() => {
        if (isLoading || !hasMore) return;

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    onLoadMore();
                }
            },
            { root: scrollElementRef?.current || null, rootMargin: '200px' }
        );

        if (loadMoreRef.current) {
            observerRef.current.observe(loadMoreRef.current);
        }

        return () => {
            observerRef.current?.disconnect();
        };
    }, [isLoading, hasMore, onLoadMore, scrollElementRef]);

    // Keep scrollMargin in sync so virtualization works inside SpacePage's scroll container.
    useLayoutEffect(() => {
        const scrollEl = scrollElementRef?.current;
        const listEl = listRef.current;
        if (!scrollEl || !listEl) return;

        const compute = () => {
            const scrollRect = scrollEl.getBoundingClientRect();
            const listRect = listEl.getBoundingClientRect();
            const top = listRect.top - scrollRect.top + (scrollEl as any).scrollTop;
            setScrollMargin(top);
        };

        compute();

        const ro = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => compute())
            : null;

        if (ro && topRef.current) ro.observe(topRef.current);
        if (ro) ro.observe(listEl);

        return () => ro?.disconnect();
    }, [scrollElementRef, posts.length, showNewPostsHint, inNetworkOnly]);

    const estimateSize = useCallback((index: number) => {
        const post = posts[index];
        if (!post) return 520;
        const base = 360;
        const contentLen = (post.content || '').length;
        const textExtra = Math.min(Math.ceil(contentLen / 120) * 22, 440);
        // Heuristic for media: assume up to 1-2 rows of images/video.
        const mediaExtra = Array.isArray((post as any).mediaUrls) && (post as any).mediaUrls.length > 0 ? 280 : 0;
        return base + textExtra + mediaExtra;
    }, [posts]);

    const virtualizer = useVirtualizer({
        count: posts.length,
        getScrollElement: () => (scrollElementRef?.current as any) || null,
        estimateSize,
        overscan: 6,
        scrollMargin,
        getItemKey: (index) => posts[index]?.id ?? index,
    });

    const virtualItems = virtualizer.getVirtualItems();

    // 渲染空状态 (Premium Glass Hero)
    const renderEmpty = () => (
        <div className="space-timeline__empty-hero">
            <div className="space-timeline__empty-content glass-card">
                <div className="space-timeline__empty-visual">
                    <EmptyIcon />
                    <div className="space-timeline__empty-glow" />
                </div>
                <h3 className="space-timeline__empty-title">
                    {inNetworkOnly ? '还没有好友动态' : '这里有些安静...'}
                </h3>
                <p className="space-timeline__empty-text">
                    {inNetworkOnly
                        ? '去关注一些好友，或者让好友发布动态后这里就会出现内容。'
                        : '还没有动态。做第一个发声的人，点亮这个空间！'}
                </p>
                <button
                    className="space-timeline__empty-cta"
                    onClick={() => {
                        if (inNetworkOnly && onInNetworkOnlyChange) {
                            onInNetworkOnlyChange(false);
                            return;
                        }
                        scrollToTop();
                    }}
                >
                    {inNetworkOnly ? '切回全部动态' : '发布第一条动态'}
                </button>
            </div>
        </div>
    );

    // 渲染加载状态
    const renderLoading = () => (
        <div className="space-timeline__loading">
            <div className="space-timeline__spinner" />
        </div>
    );

    return (
        <div className="space-timeline">
            <div ref={topRef}>
                {/* 头部 */}
                <header className="space-timeline__header">
                    <h1 className="space-timeline__title">首页</h1>
                    {onInNetworkOnlyChange && (
                        <div className="space-timeline__feed-toggle" role="tablist" aria-label="切换动态范围">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={!inNetworkOnly}
                                className={`space-timeline__feed-tab ${!inNetworkOnly ? 'is-active' : ''}`}
                                onClick={() => onInNetworkOnlyChange(false)}
                            >
                                全部
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={inNetworkOnly}
                                className={`space-timeline__feed-tab ${inNetworkOnly ? 'is-active' : ''}`}
                                onClick={() => onInNetworkOnlyChange(true)}
                            >
                                好友
                            </button>
                        </div>
                    )}
                </header>

                {/* 发帖组件 */}
                <PostComposer currentUser={currentUser} onSubmit={onCreatePost} />

                {/* 分隔线 */}
                <div className="space-timeline__divider" />

                {/* 今日新闻 / 热门话题：仅在“全部”范围展示 */}
                {!inNetworkOnly && (
                    <>
                        <NewsHomeSection />
                        <NewsFeed />
                    </>
                )}

                {/* 新帖子提示 */}
                {showNewPostsHint && newPostsCount > 0 && (
                    <div className="space-timeline__new-posts">
                        <button className="space-timeline__new-posts-btn" onClick={handleNewPostsClick}>
                            查看 {newPostsCount} 条新帖子
                        </button>
                    </div>
                )}
            </div>

            {/* 帖子列表 */}
            <div className="space-timeline__posts" id="space-posts">
                {posts.length === 0 && !isLoading ? (
                    renderEmpty()
                ) : (
                    <div
                        ref={listRef}
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualItems.map((virtualRow) => {
                            const post = posts[virtualRow.index];
                            if (!post) return null;

                            return (
                                <div
                                    key={virtualRow.key}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    ref={virtualizer.measureElement}
                                >
                                    <SpacePost
                                        post={post}
                                        onLike={onLike}
                                        onUnlike={onUnlike}
                                        onComment={onComment}
                                        onRepost={onRepost}
                                        onShare={onShare}
                                        onClick={onPostClick}
                                        onAuthorClick={onAuthorClick}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 加载更多触发器 */}
            <div ref={loadMoreRef} className="space-timeline__load-more">
                {isLoading && renderLoading()}
                {!isLoading && hasMore && (
                    <button className="space-timeline__load-more-btn" onClick={onLoadMore}>
                        加载更多
                    </button>
                )}
            </div>
        </div>
    );
};

export default SpaceTimeline;
