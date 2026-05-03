/**
 * SpaceTimeline - 时间线组件
 * 整合帖子列表、加载状态、无限滚动
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { SpacePost, type PostData, type SpacePostProps } from './SpacePost';
import { PostComposer, type PostComposerProps } from './PostComposer';
import { NewsHomeSection } from './NewsHomeSection';
import './SpaceTimeline.css';

export interface SpaceTimelineProps {
    posts: PostData[];
    isLoading: boolean;
    error?: string | null;
    hasMore: boolean;
    newPostsCount?: number;
    currentUser: PostComposerProps['currentUser'];
    /** 工业级：只显示好友/关注网络内内容（类似 Twitter Following） */
    inNetworkOnly?: boolean;
    onInNetworkOnlyChange?: (value: boolean) => void;
    onLoadMore: () => void;
    onRefresh?: () => void;
    onRetry?: () => void;
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

export const SpaceTimeline: React.FC<SpaceTimelineProps> = ({
    posts,
    isLoading,
    error,
    hasMore,
    newPostsCount = 0,
    currentUser,
    inNetworkOnly = false,
    onInNetworkOnlyChange,
    onLoadMore,
    onRefresh,
    onRetry,
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
    const shouldVirtualize = posts.length >= 80;
    const [showNewPostsHint, setShowNewPostsHint] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const topRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    const remeasureRafRef = useRef<number | null>(null);

    const scrollToTop = useCallback(() => {
        const el = scrollElementRef?.current;
        if (el) {
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
        if (!shouldVirtualize) {
            setScrollMargin(0);
            return;
        }
        const scrollEl = scrollElementRef?.current;
        const listEl = listRef.current;
        if (!scrollEl || !listEl) return;

        const compute = () => {
            const scrollRect = scrollEl.getBoundingClientRect();
            const listRect = listEl.getBoundingClientRect();
            const top = listRect.top - scrollRect.top + scrollEl.scrollTop;
            setScrollMargin(top);
        };

        compute();

        const ro = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => compute())
            : null;

        if (ro && topRef.current) ro.observe(topRef.current);
        if (ro) ro.observe(listEl);

        return () => ro?.disconnect();
    }, [scrollElementRef, posts.length, showNewPostsHint, inNetworkOnly, shouldVirtualize]);

    const estimateSize = useCallback((index: number) => {
        const post = posts[index];
        if (!post) return 320;
        const base = 240;
        const contentLen = (post.content || '').length;
        const textExtra = Math.min(Math.ceil(contentLen / 110) * 20, 320);
        // Heuristic for media: assume up to 1-2 rows of images/video.
        const legacyMediaUrls = (post as PostData & { mediaUrls?: unknown[] }).mediaUrls;
        const hasMedia =
            (Array.isArray(legacyMediaUrls) && legacyMediaUrls.length > 0)
            || (Array.isArray(post.media) && post.media.length > 0);
        const mediaExtra = hasMedia ? 260 : 0;
        return base + textExtra + mediaExtra + 56;
    }, [posts]);

    const virtualizer = useVirtualizer({
        count: shouldVirtualize ? posts.length : 0,
        getScrollElement: () => scrollElementRef?.current || null,
        estimateSize,
        measureElement: (element) => {
            const rect = (element as HTMLElement).getBoundingClientRect();
            return Math.max(1, rect.height);
        },
        overscan: 6,
        scrollMargin,
        getItemKey: (index) => posts[index]?.id ?? index,
    });

    const virtualItems = virtualizer.getVirtualItems();

    const scheduleMeasure = useCallback(() => {
        if (!shouldVirtualize) return;
        if (remeasureRafRef.current !== null) return;
        remeasureRafRef.current = requestAnimationFrame(() => {
            remeasureRafRef.current = null;
            virtualizer.measure();
        });
    }, [shouldVirtualize, virtualizer]);

    useEffect(() => {
        scheduleMeasure();
    }, [scheduleMeasure, posts.length, inNetworkOnly, showNewPostsHint]);

    useEffect(() => () => {
        if (remeasureRafRef.current !== null) {
            cancelAnimationFrame(remeasureRafRef.current);
            remeasureRafRef.current = null;
        }
    }, []);

    const renderState = () => (
        <div className="space-timeline__empty-hero">
            {error ? (
                <StateBlock
                    className="space-timeline__state"
                    variant="error"
                    title="动态加载失败"
                    description={error}
                    actionLabel="重试"
                    onAction={onRetry || onRefresh}
                />
            ) : (
                <StateBlock
                    className="space-timeline__state"
                    title={inNetworkOnly ? '还没有好友动态' : '这里有些安静'}
                    description={
                        inNetworkOnly
                            ? '去关注一些好友，或者切回全部动态继续浏览。'
                            : '还没有动态。做第一个发声的人，点亮这个空间。'
                    }
                    actionLabel={inNetworkOnly ? '切回全部动态' : '发布第一条动态'}
                    onAction={() => {
                        if (inNetworkOnly && onInNetworkOnlyChange) {
                            onInNetworkOnlyChange(false);
                            return;
                        }
                        scrollToTop();
                    }}
                />
            )}
        </div>
    );

    // 渲染加载状态
    const renderLoading = () => (
        <div className="space-timeline__loading" aria-label="动态加载中">
            <Skeleton className="space-timeline__loading-avatar" />
            <div className="space-timeline__loading-copy">
                <Skeleton className="space-timeline__loading-line is-short" />
                <Skeleton className="space-timeline__loading-line" />
                <Skeleton className="space-timeline__loading-line" />
            </div>
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
                    <NewsHomeSection />
                )}

                {/* 新帖子提示 */}
                {showNewPostsHint && newPostsCount > 0 && (
                    <div className="space-timeline__new-posts">
                        <button type="button" className="space-timeline__new-posts-btn" onClick={handleNewPostsClick}>
                            查看 {newPostsCount} 条新帖子
                        </button>
                    </div>
                )}

                {error && posts.length > 0 && !isLoading && (
                    <div className="space-timeline__inline-error">
                        <StateBlock
                            compact
                            variant="error"
                            title="部分内容刷新失败"
                            description={error}
                            actionLabel="重试"
                            onAction={onRetry || onRefresh}
                        />
                    </div>
                )}
            </div>

            {/* 帖子列表 */}
            <div className="space-timeline__posts" id="space-posts">
                {posts.length === 0 && !isLoading ? (
                    renderState()
                ) : !shouldVirtualize ? (
                    <div className="space-timeline__post-stack">
                        {posts.map((post) => (
                            <div key={post.id} className="space-timeline__post-item">
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
                        ))}
                    </div>
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
                                    data-index={virtualRow.index}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${Math.max(0, virtualRow.start - scrollMargin)}px)`,
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
                                        onLayoutChanged={scheduleMeasure}
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
                    <button type="button" className="space-timeline__load-more-btn" onClick={onLoadMore}>
                        加载更多
                    </button>
                )}
            </div>
        </div>
    );
};

export default SpaceTimeline;
