/**
 * SpaceTimeline - 时间线组件
 * 整合帖子列表、加载状态、无限滚动
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SpacePost, type PostData, type SpacePostProps } from './SpacePost';
import { PostComposer, type PostComposerProps } from './PostComposer';
import { NewsFeed } from './NewsFeed';
import { NewsBrief } from './NewsBrief';
import './SpaceTimeline.css';

export interface SpaceTimelineProps {
    posts: PostData[];
    isLoading: boolean;
    hasMore: boolean;
    newPostsCount?: number;
    currentUser: PostComposerProps['currentUser'];
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
}) => {
    const [showNewPostsHint, setShowNewPostsHint] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

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
        // 滚动到顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [onRefresh]);

    // 无限滚动 - IntersectionObserver
    useEffect(() => {
        if (isLoading || !hasMore) return;

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    onLoadMore();
                }
            },
            { rootMargin: '200px' }
        );

        if (loadMoreRef.current) {
            observerRef.current.observe(loadMoreRef.current);
        }

        return () => {
            observerRef.current?.disconnect();
        };
    }, [isLoading, hasMore, onLoadMore]);

    // 渲染空状态 (Premium Glass Hero)
    const renderEmpty = () => (
        <div className="space-timeline__empty-hero">
            <div className="space-timeline__empty-content glass-card">
                <div className="space-timeline__empty-visual">
                    <EmptyIcon />
                    <div className="space-timeline__empty-glow" />
                </div>
                <h3 className="space-timeline__empty-title">这里有些安静...</h3>
                <p className="space-timeline__empty-text">
                    还没有动态。做第一个发声的人，点亮这个空间！
                </p>
                <button
                    className="space-timeline__empty-cta"
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                >
                    发布第一条动态
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
            {/* 头部 */}
            <header className="space-timeline__header">
                <h1 className="space-timeline__title">首页</h1>
            </header>

            {/* 发帖组件 */}
            <PostComposer currentUser={currentUser} onSubmit={onCreatePost} />

            {/* 分隔线 */}
            <div className="space-timeline__divider" />

            {/* 今日新闻 */}
            <NewsBrief />

            {/* 热门话题 */}
            <NewsFeed />

            {/* 新帖子提示 */}
            {showNewPostsHint && newPostsCount > 0 && (
                <div className="space-timeline__new-posts">
                    <button className="space-timeline__new-posts-btn" onClick={handleNewPostsClick}>
                        查看 {newPostsCount} 条新帖子
                    </button>
                </div>
            )}

            {/* 帖子列表 */}
            <div className="space-timeline__posts">
                {posts.length === 0 && !isLoading ? (
                    renderEmpty()
                ) : (
                    posts.map((post, index) => (
                        <div
                            key={post.id}
                            className="space-post-enter"
                            style={{ animationDelay: `${index * 0.05}s` }}
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
                    ))
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
