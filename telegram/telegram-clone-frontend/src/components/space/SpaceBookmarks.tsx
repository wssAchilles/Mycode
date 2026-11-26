import React, { useEffect } from 'react';
import { Bookmark, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { StateBlock } from '@/components/design-system';
import { useBookmarkStore } from '../../stores/useBookmarkStore';
import { SpacePost, type SpacePostProps } from './SpacePost';
import './SpaceBookmarks.css';

interface SpaceBookmarksProps {
    onLike: SpacePostProps['onLike'];
    onUnlike: SpacePostProps['onUnlike'];
    onComment: SpacePostProps['onComment'];
    onRepost: SpacePostProps['onRepost'];
    onUnrepost: SpacePostProps['onUnrepost'];
    onQuote?: SpacePostProps['onQuote'];
    onShare: SpacePostProps['onShare'];
    onPostClick: SpacePostProps['onClick'];
    onAuthorClick?: SpacePostProps['onAuthorClick'];
    onHashtagClick?: SpacePostProps['onHashtagClick'];
    onBrowseHome?: () => void;
}

export const SpaceBookmarks: React.FC<SpaceBookmarksProps> = ({
    onLike,
    onUnlike,
    onComment,
    onRepost,
    onUnrepost,
    onQuote,
    onShare,
    onPostClick,
    onAuthorClick,
    onHashtagClick,
    onBrowseHome,
}) => {
    const posts = useBookmarkStore((state) => state.posts);
    const isLoading = useBookmarkStore((state) => state.isLoading);
    const hasLoaded = useBookmarkStore((state) => state.hasLoaded);
    const hasMore = useBookmarkStore((state) => state.hasMore);
    const error = useBookmarkStore((state) => state.error);
    const loadBookmarks = useBookmarkStore((state) => state.loadBookmarks);

    useEffect(() => {
        if (!hasLoaded && !isLoading) {
            void loadBookmarks(true);
        }
    }, [hasLoaded, isLoading, loadBookmarks]);

    return (
        <div className="space-bookmarks">
            <header className="space-bookmarks__header">
                <div className="space-bookmarks__title-wrap">
                    <Bookmark size={18} />
                    <h1 className="space-bookmarks__title">收藏夹</h1>
                    <span className="space-bookmarks__count">{posts.length}</span>
                </div>
                <button
                    type="button"
                    className={`space-bookmarks__refresh ${isLoading ? 'is-loading' : ''}`}
                    onClick={() => void loadBookmarks(true)}
                    disabled={isLoading}
                    aria-label="刷新收藏夹"
                >
                    <RefreshCw size={15} />
                </button>
            </header>

            {isLoading && posts.length === 0 ? (
                <div className="space-bookmarks__skeletons" aria-label="正在加载收藏">
                    {[0, 1, 2].map((idx) => (
                        <div key={idx} className="space-bookmarks__skeleton-item">
                            <Skeleton className="space-bookmarks__skeleton-avatar" />
                            <div className="space-bookmarks__skeleton-lines">
                                <Skeleton className="space-bookmarks__skeleton-line is-short" />
                                <Skeleton className="space-bookmarks__skeleton-line" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : error && posts.length === 0 ? (
                <div className="space-bookmarks__empty">
                    <StateBlock
                        variant="error"
                        title="加载收藏失败"
                        description={error}
                        actionLabel="重试"
                        onAction={() => void loadBookmarks(true)}
                    />
                </div>
            ) : posts.length === 0 ? (
                <div className="space-bookmarks__empty">
                    <StateBlock
                        title="还没有收藏任何动态"
                        description="点击任意动态卡片右下角的书签图标，即可保存在这里稍后阅读。"
                        actionLabel={onBrowseHome ? '去首页逛逛' : undefined}
                        onAction={onBrowseHome}
                    />
                </div>
            ) : (
                <div className="space-bookmarks__list">
                    {posts.map((post) => (
                        <SpacePost
                            key={post.id}
                            post={post}
                            onLike={onLike}
                            onUnlike={onUnlike}
                            onComment={onComment}
                            onRepost={onRepost}
                            onUnrepost={onUnrepost}
                            onQuote={onQuote}
                            onShare={onShare}
                            onClick={onPostClick}
                            onAuthorClick={onAuthorClick}
                            onHashtagClick={onHashtagClick}
                        />
                    ))}
                    {hasMore && (
                        <button
                            type="button"
                            className="space-bookmarks__more"
                            disabled={isLoading}
                            onClick={() => void loadBookmarks(false)}
                        >
                            {isLoading ? '加载中...' : '加载更多收藏'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
