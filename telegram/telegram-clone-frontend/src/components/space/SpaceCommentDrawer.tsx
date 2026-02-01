import React, { useEffect, useMemo, useState } from 'react';
import { spaceAPI, type CommentData } from '../../services/spaceApi';
import type { PostData } from './SpacePost';
import './SpaceCommentDrawer.css';

export interface SpaceCommentDrawerProps {
    open: boolean;
    post: PostData | null;
    onClose: () => void;
    onCommentAdded?: (postId: string) => void;
}

export const SpaceCommentDrawer: React.FC<SpaceCommentDrawerProps> = ({
    open,
    post,
    onClose,
    onCommentAdded,
}) => {
    const [comments, setComments] = useState<CommentData[]>([]);
    const [loading, setLoading] = useState(false);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const postId = post?.id;

    const resetState = () => {
        setComments([]);
        setCursor(undefined);
        setHasMore(true);
    };

    const loadComments = async (reset: boolean = false) => {
        if (!postId) return;
        setLoading(true);
        try {
            const result = await spaceAPI.getComments(postId, 20, reset ? undefined : cursor);
            setComments((prev) => (reset ? result.comments : [...prev, ...result.comments]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
        } catch (error) {
            console.error('加载评论失败:', error);
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open && postId) {
            resetState();
            loadComments(true);
        }
        if (!open) {
            resetState();
            setDraft('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, postId]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!postId || !draft.trim()) return;
        setSubmitting(true);
        try {
            const created = await spaceAPI.createComment(postId, draft.trim());
            setComments((prev) => [created, ...prev]);
            setDraft('');
            onCommentAdded?.(postId);
        } catch (error) {
            console.error('发送评论失败:', error);
        } finally {
            setSubmitting(false);
        }
    };

    const shortContent = useMemo(() => {
        if (!post) return '';
        return post.content.length > 120 ? `${post.content.slice(0, 120)}...` : post.content;
    }, [post]);

    if (!open || !post) return null;

    return (
        <div className="space-comment-drawer">
            <div className="space-comment-drawer__overlay" onClick={onClose} />
            <aside className="space-comment-drawer__panel" role="dialog" aria-modal="true">
                <header className="space-comment-drawer__header">
                    <div>
                        <div className="space-comment-drawer__title">评论</div>
                        <div className="space-comment-drawer__subtitle">{post.author.username}</div>
                    </div>
                    <button className="space-comment-drawer__close" onClick={onClose} aria-label="关闭评论">
                        ×
                    </button>
                </header>

                <div className="space-comment-drawer__post">
                    <div className="space-comment-drawer__post-author">@{post.author.username}</div>
                    <div className="space-comment-drawer__post-content">{shortContent}</div>
                </div>

                <div className="space-comment-drawer__list">
                    {loading && comments.length === 0 && (
                        <div className="space-comment-drawer__loading">加载评论中...</div>
                    )}
                    {!loading && comments.length === 0 && (
                        <div className="space-comment-drawer__empty">还没有评论，来做第一个发声的人</div>
                    )}
                    {comments.map((comment) => (
                        <div key={comment.id} className="space-comment-drawer__item">
                            <div className="space-comment-drawer__avatar">
                                {comment.author.avatarUrl ? (
                                    <img src={comment.author.avatarUrl} alt={comment.author.username} />
                                ) : (
                                    <span>{comment.author.username.charAt(0).toUpperCase()}</span>
                                )}
                            </div>
                            <div className="space-comment-drawer__body">
                                <div className="space-comment-drawer__meta">
                                    <span className="space-comment-drawer__name">{comment.author.username}</span>
                                    <span className="space-comment-drawer__time">
                                        {new Date(comment.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <div className="space-comment-drawer__text">{comment.content}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {hasMore && (
                    <button
                        className="space-comment-drawer__more"
                        onClick={() => loadComments(false)}
                        disabled={loading}
                    >
                        {loading ? '加载中...' : '加载更多'}
                    </button>
                )}

                <form className="space-comment-drawer__composer" onSubmit={handleSubmit}>
                    <label className="space-comment-drawer__sr-only" htmlFor="space-comment-input">
                        输入评论内容
                    </label>
                    <textarea
                        id="space-comment-input"
                        name="spaceComment"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="写下你的观点..."
                        rows={2}
                    />
                    <button type="submit" disabled={submitting || !draft.trim()}>
                        {submitting ? '发送中' : '发送'}
                    </button>
                </form>
            </aside>
        </div>
    );
};

export default SpaceCommentDrawer;
