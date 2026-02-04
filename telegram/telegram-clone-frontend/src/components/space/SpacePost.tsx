/**
 * SpacePost - 帖子卡片组件
 * 融合 Telegram 简洁风格 + Twitter 信息流布局
 */

import React, { useState, useCallback, useEffect } from 'react';
import { RecommendationReason, type RecallSource } from './RecommendationReason';
import { SensitiveContentOverlay, type SafetyLevel } from './SensitiveContentOverlay';
import { useImpressionTracker, useDwellTracker } from '../../hooks/useAnalytics';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export interface PostData {
    id: string;
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
    showRecommendationReason = true,
    showPinAction = false,
}) => {
    const [isLiked, setIsLiked] = useState(post.isLiked || false);
    const [isReposted, setIsReposted] = useState(post.isReposted || false);
    const [likeCount, setLikeCount] = useState(post.likeCount);
    const [repostCount, setRepostCount] = useState(post.repostCount);
    const [isPinned, setIsPinned] = useState(post.isPinned || false);

    useEffect(() => {
        setIsPinned(post.isPinned || false);
    }, [post.id, post.isPinned]);

    // 曝光和停留时间追踪
    const impressionRef = useImpressionTracker(post.id, post.recallSource);
    const dwellRef = useDwellTracker(post.id, post.recallSource);

    // 处理点赞
    const handleLike = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isLiked) {
                setIsLiked(false);
                setLikeCount((prev) => Math.max(0, prev - 1));
                onUnlike?.(post.id);
            } else {
                setIsLiked(true);
                setLikeCount((prev) => prev + 1);
                onLike?.(post.id);
            }
        },
        [isLiked, post.id, onLike, onUnlike]
    );

    // 处理评论
    const handleComment = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onComment?.(post.id);
        },
        [post.id, onComment]
    );

    // 处理转发
    const handleRepost = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!isReposted) {
                setIsReposted(true);
                setRepostCount((prev) => prev + 1);
                onRepost?.(post.id);
            }
        },
        [isReposted, post.id, onRepost]
    );

    // 处理分享
    const handleShare = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onShare?.(post.id);
        },
        [post.id, onShare]
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
        onClick?.(post.id);
    }, [post.id, onClick]);

    const handleAuthorClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onAuthorClick?.(post.author.id);
        },
        [post.author.id, onAuthorClick]
    );

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
                            src={media.thumbnailUrl || media.url}
                            alt=""
                            className="space-post__media-item"
                            loading="lazy"
                        />
                    ))}
                </div>
            </div>
        );
    };

    const [isExpanded, setIsExpanded] = useState(false);
    const MAX_LENGTH = 280; // 超过此长度折叠
    const isLongContent = post.content.length > MAX_LENGTH;

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
                            <button className="space-post__username space-post__author-btn" onClick={handleAuthorClick}>
                                {post.author.username}
                            </button>
                            {post.author.handle && (
                                <>
                                    <span className="space-post__handle">@{post.author.handle}</span>
                                </>
                            )}
                            <span className="space-post__dot">·</span>
                            <span className="space-post__time">{formatTimeAgo(post.createdAt)}</span>
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
                                <RecommendationReason source={post.recallSource} compact />
                            </div>
                        )}
                    </div>

                    <button
                        className="space-post__more-btn"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="更多选项"
                    >
                        <MoreIcon />
                    </button>
                </header>

                {/* 帖子内容 */}
                <div className="space-post__content">
                    <div className="space-post__markdown">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} />
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

    return (
        <article
            className="space-post"
            onClick={handleClick}
            ref={(el) => {
                // 合并 refs
                if (impressionRef.current !== el) (impressionRef as any).current = el;
                if (dwellRef.current !== el) (dwellRef as any).current = el;
            }}
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
