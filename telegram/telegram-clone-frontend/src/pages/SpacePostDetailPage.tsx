import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { spaceAPI, type CommentData } from '../services/spaceApi';
import { SpacePost, type PostData } from '../components/space';
import { ArrowLeftIcon } from '../components/icons/SpaceIcons';
import { showToast } from '../components/ui/Toast';
import './SpacePostDetailPage.css';

const SpacePostDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [post, setPost] = useState<PostData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [comments, setComments] = useState<CommentData[]>([]);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [loadingComments, setLoadingComments] = useState(false);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadComments = async (reset: boolean = false) => {
        if (!id) return;
        setLoadingComments(true);
        try {
            const result = await spaceAPI.getComments(id, 20, reset ? undefined : cursor);
            setComments((prev) => (reset ? result.comments : [...prev, ...result.comments]));
            setHasMore(result.hasMore);
            setCursor(result.nextCursor);
        } catch (err) {
            console.error('加载评论失败:', err);
            setHasMore(false);
        } finally {
            setLoadingComments(false);
        }
    };

    useEffect(() => {
        if (!id) return;
        let mounted = true;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await spaceAPI.getPost(id);
                if (!mounted) return;
                setPost(data);
                await loadComments(true);
            } catch (err: any) {
                if (!mounted) return;
                setError(err?.message || '加载失败');
            } finally {
                if (mounted) setLoading(false);
            }
        };
        load();
        return () => {
            mounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const handleCreateComment = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!id || !draft.trim()) return;
        setSubmitting(true);
        try {
            const created = await spaceAPI.createComment(id, draft.trim());
            setComments((prev) => [created, ...prev]);
            setDraft('');
            setPost((prev) => prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev);
        } catch (err) {
            console.error('发表评论失败:', err);
            showToast('评论失败，请稍后再试', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="space-detail">
                <div className="space-detail__shell">
                    <div className="space-detail__loading">加载中...</div>
                </div>
            </div>
        );
    }

    if (error || !post) {
        return (
            <div className="space-detail">
                <div className="space-detail__shell">
                    <div className="space-detail__error">{error || '内容不存在'}</div>
                    <button className="space-detail__back-btn" onClick={() => navigate('/space')}>
                        <ArrowLeftIcon />
                        返回 Space
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-detail">
            <div className="space-detail__shell">
                <header className="space-detail__header">
                    <button className="space-detail__back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeftIcon />
                        返回
                    </button>
                    <h1 className="space-detail__title">动态详情</h1>
                </header>

                <div className="space-detail__post">
                    <SpacePost
                        post={post}
                        onLike={(postId) => spaceAPI.likePost(postId)}
                        onUnlike={(postId) => spaceAPI.unlikePost(postId)}
                        onRepost={(postId) => spaceAPI.repostPost(postId)}
                        onShare={(postId) => {
                            navigator.clipboard.writeText(`https://telegram-clone.app/space/post/${postId}`);
                            showToast('链接已复制到剪贴板', 'success');
                        }}
                        onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                        showRecommendationReason={false}
                    />
                </div>

                <section className="space-detail__comments">
                    <h2>评论</h2>
                    <form className="space-detail__composer" onSubmit={handleCreateComment}>
                        <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="写下你的观点..."
                            rows={3}
                        />
                        <button type="submit" disabled={submitting || !draft.trim()}>
                            {submitting ? '发送中' : '发送'}
                        </button>
                    </form>

                    {comments.length === 0 && !loadingComments && (
                        <div className="space-detail__empty">还没有评论，来做第一个发声的人</div>
                    )}

                    <div className="space-detail__comment-list">
                        {comments.map((comment) => (
                            <div key={comment.id} className="space-detail__comment">
                                <div className="space-detail__comment-avatar">
                                    {comment.author.avatarUrl ? (
                                        <img src={comment.author.avatarUrl} alt={comment.author.username} />
                                    ) : (
                                        <span>{comment.author.username.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="space-detail__comment-body">
                                    <div className="space-detail__comment-meta">
                                        <span className="space-detail__comment-name">{comment.author.username}</span>
                                        <span className="space-detail__comment-time">
                                            {new Date(comment.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="space-detail__comment-text">{comment.content}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {hasMore && (
                        <button
                            className="space-detail__more"
                            onClick={() => loadComments(false)}
                            disabled={loadingComments}
                        >
                            {loadingComments ? '加载中...' : '加载更多'}
                        </button>
                    )}
                </section>
            </div>
        </div>
    );
};

export default SpacePostDetailPage;
