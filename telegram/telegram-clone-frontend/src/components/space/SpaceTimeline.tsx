/**
 * SpaceTimeline - 时间线组件
 * 整合帖子列表、加载状态、无限滚动
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SpacePost, type PostData, type SpacePostProps } from './SpacePost';
import { PostComposer, type PostComposerProps } from './PostComposer';
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
}

// 空状态图标
const EmptyIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="space-timeline__empty-icon">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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

    // 渲染空状态
    const renderEmpty = () => (
        <div className="space-timeline__empty">
            <EmptyIcon />
            <h3 className="space-timeline__empty-title">欢迎来到 Space</h3>
            <p className="space-timeline__empty-text">
                还没有任何帖子。发布你的第一条动态，与大家分享精彩瞬间！
            </p>
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
