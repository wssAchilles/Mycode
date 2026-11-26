import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Reply, SendHorizontal } from 'lucide-react';
import { spaceAPI, type CommentData } from '../services/spaceApi';
import { authUtils } from '../services/apiClient';
import { SpacePost, type PostData } from '../components/space';
import { findCachedSpacePost } from '../features/space/profileMemoryCache';
import {
    COMMENT_MAX_LENGTH,
    formatCommentTime,
    formatFullCommentTime,
} from '../components/space/utils/formatCommentTime';
import { showToast } from '../components/ui/Toast';
import { SHARE_BASE_URL } from '../config/share';
import './SpacePostDetailPage.css';

const SpacePostDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const initialCachedPost = useMemo(() => findCachedSpacePost(id), [id]);
    const [post, setPost] = useState<PostData | null>(initialCachedPost);
    const [loading, setLoading] = useState(!initialCachedPost);
    const [error, setError] = useState<string | null>(null);

    const [comments, setComments] = useState<CommentData[]>([]);
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(true);
    const [loadingComments, setLoadingComments] = useState(false);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [isComposerFocused, setIsComposerFocused] = useState(false);

    const composerRef = useRef<HTMLTextAreaElement>(null);
    const isComposingRef = useRef(false);
    const currentUser = useMemo(() => authUtils.getCurrentUser(), []);

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
        const cached = findCachedSpacePost(id);
        if (cached) {
            setPost(cached);
            setLoading(false);
        } else {
            setPost(null);
            setLoading(true);
        }
        setError(null);

        const load = async () => {
            setLoadingComments(true);
            try {
                const [postResult, commentsResult] = await Promise.allSettled([
                    spaceAPI.getPost(id),
                    spaceAPI.getComments(id, 20),
                ]);
                if (!mounted) return;

                if (postResult.status === 'fulfilled') {
                    setPost(postResult.value);
                } else if (!cached) {
                    const reason = postResult.reason;
                    setError(reason instanceof Error ? reason.message : '加载失败');
                }

                if (commentsResult.status === 'fulfilled') {
                    setComments(commentsResult.value.comments);
                    setHasMore(commentsResult.value.hasMore);
                    setCursor(commentsResult.value.nextCursor);
                } else {
                    setHasMore(false);
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                    setLoadingComments(false);
                }
            }
        };
        void load();
        return () => {
            mounted = false;
        };
    }, [id]);

    const submitComment = useCallback(async () => {
        if (!id || !draft.trim() || submitting) return;
        setSubmitting(true);
        try {
            const created = await spaceAPI.createComment(id, draft.trim());
            setComments((prev) => [created, ...prev]);
            setDraft('');
            setPost((prev) => (prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev));
        } catch (err) {
            console.error('发表评论失败:', err);
            showToast('评论失败，请稍后再试', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [draft, id, submitting]);

    const handleCreateComment = async (event: React.FormEvent) => {
        event.preventDefault();
        await submitComment();
    };

    const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isComposingRef.current || event.nativeEvent.isComposing) {
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void submitComment();
        }
    };

    const focusComposer = useCallback(() => {
        const textarea = composerRef.current;
        if (!textarea) return;
        if (typeof textarea.scrollIntoView === 'function') {
            textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        textarea.focus();
    }, []);

    const handleReplyToAuthor = useCallback((username: string) => {
        const mentionPrefix = `@${username} `;
        setDraft((prev) => {
            if (prev.startsWith(mentionPrefix)) {
                return prev;
            }
            const trimmedStart = prev.trimStart();
            return trimmedStart ? `${mentionPrefix}${trimmedStart}` : mentionPrefix;
        });

        requestAnimationFrame(() => {
            const textarea = composerRef.current;
            if (!textarea) return;
            if (typeof textarea.scrollIntoView === 'function') {
                textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            textarea.focus();
            const len = textarea.value.length;
            if (typeof textarea.setSelectionRange === 'function') {
                textarea.setSelectionRange(len, len);
            }
        });
    }, []);

    const totalComments = post ? Math.max(post.commentCount, comments.length) : comments.length;
    const isNearLimit = draft.length >= Math.floor(COMMENT_MAX_LENGTH * 0.9);
    const isAtLimit = draft.length >= COMMENT_MAX_LENGTH;
    const userInitial = (currentUser?.username?.trim().charAt(0) || '我').toUpperCase();

    if (loading) {
        return (
            <div className="space-detail">
                <div className="space-detail__shell">
                    <header className="space-detail__header">
                        <button
                            type="button"
                            className="space-detail__back-btn"
                            onClick={() => navigate(-1)}
                            aria-label="返回"
                        >
                            <ArrowLeft size={18} aria-hidden="true" />
                        </button>
                        <div className="space-detail__header-text">
                            <h1 className="space-detail__title">动态详情</h1>
                        </div>
                    </header>
                    <div className="space-detail__skeleton-wrap" aria-label="正在加载动态详情">
                        <div className="space-detail__skeleton-post">
                            <div className="space-detail__skeleton-avatar" />
                            <div className="space-detail__skeleton-lines">
                                <div className="space-detail__skeleton-line space-detail__skeleton-line--short" />
                                <div className="space-detail__skeleton-line" />
                                <div className="space-detail__skeleton-line space-detail__skeleton-line--medium" />
                            </div>
                        </div>
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="space-detail__skeleton-comment">
                                <div className="space-detail__skeleton-avatar space-detail__skeleton-avatar--sm" />
                                <div className="space-detail__skeleton-lines">
                                    <div className="space-detail__skeleton-line space-detail__skeleton-line--short" />
                                    <div className="space-detail__skeleton-line space-detail__skeleton-line--medium" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (error || !post) {
        return (
            <div className="space-detail">
                <div className="space-detail__shell">
                    <header className="space-detail__header">
                        <button
                            type="button"
                            className="space-detail__back-btn"
                            onClick={() => navigate('/space')}
                            aria-label="返回 Space"
                        >
                            <ArrowLeft size={18} aria-hidden="true" />
                        </button>
                        <div className="space-detail__header-text">
                            <h1 className="space-detail__title">动态详情</h1>
                        </div>
                    </header>
                    <div className="space-detail__error-state">
                        <div className="space-detail__empty-icon" aria-hidden="true">
                            <MessageCircle size={22} />
                        </div>
                        <p className="space-detail__error-title">{error || '动态不存在或已被删除'}</p>
                        <button
                            type="button"
                            className="space-detail__error-action"
                            onClick={() => navigate('/space')}
                        >
                            返回 Space 广场
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-detail">
            <div className="space-detail__shell">
                <header className="space-detail__header">
                    <button
                        type="button"
                        className="space-detail__back-btn"
                        onClick={() => navigate(-1)}
                        aria-label="返回"
                    >
                        <ArrowLeft size={18} aria-hidden="true" />
                    </button>
                    <div className="space-detail__header-text">
                        <h1 className="space-detail__title">动态详情</h1>
                        <span className="space-detail__header-sub">{totalComments} 条回复</span>
                    </div>
                </header>

                <div className="space-detail__post">
                    <SpacePost
                        post={post}
                        onLike={(postId) => spaceAPI.likePost(postId)}
                        onUnlike={(postId) => spaceAPI.unlikePost(postId)}
                        onComment={focusComposer}
                        onRepost={(postId) => spaceAPI.repostPost(postId)}
                        onUnrepost={(postId) => spaceAPI.unrepostPost(postId)}
                        onQuote={(postId, quoteContent) =>
                            spaceAPI.createPost(quoteContent, undefined, {
                                quotePostId: postId,
                                quoteContent,
                            })
                        }
                        onShare={(postId) => {
                            navigator.clipboard.writeText(`${SHARE_BASE_URL}/space/post/${postId}`);
                            showToast('链接已复制到剪贴板', 'success');
                        }}
                        onAuthorClick={(authorId) => navigate(`/space/user/${authorId}`)}
                        showRecommendationReason={false}
                    />
                </div>

                <section className="space-detail__composer-section" aria-label="发表回复">
                    <div className="space-detail__reply-context">
                        回复 <span className="space-detail__reply-target">@{post.author.username}</span>
                    </div>
                    <form className="space-detail__composer-row" onSubmit={handleCreateComment}>
                        <div className="space-detail__composer-avatar" aria-hidden="true">
                            {currentUser?.avatarUrl ? (
                                <img src={currentUser.avatarUrl} alt={currentUser.username || '我'} />
                            ) : (
                                <span>{userInitial}</span>
                            )}
                        </div>

                        <div
                            className={`space-detail__composer-box ${isComposerFocused ? 'is-focused' : ''}`}
                        >
                            <textarea
                                ref={composerRef}
                                value={draft}
                                maxLength={COMMENT_MAX_LENGTH}
                                onChange={(event) => setDraft(event.target.value)}
                                onFocus={() => setIsComposerFocused(true)}
                                onBlur={() => setIsComposerFocused(false)}
                                onKeyDown={handleComposerKeyDown}
                                onCompositionStart={() => {
                                    isComposingRef.current = true;
                                }}
                                onCompositionEnd={() => {
                                    isComposingRef.current = false;
                                }}
                                placeholder="写下你的观点或回复..."
                                aria-label="输入回复内容"
                                rows={isComposerFocused || draft.length > 0 ? 3 : 2}
                            />

                            <div className="space-detail__composer-footer">
                                <div className="space-detail__composer-meta">
                                    <span className="space-detail__shortcut-hint">⌘/Ctrl + Enter 发送</span>
                                    {draft.length > 0 && (
                                        <span
                                            className={`space-detail__char-count ${
                                                isAtLimit
                                                    ? 'is-limit'
                                                    : isNearLimit
                                                      ? 'is-warning'
                                                      : ''
                                            }`}
                                        >
                                            {draft.length}/{COMMENT_MAX_LENGTH}
                                        </span>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className="space-detail__submit-btn"
                                    disabled={submitting || !draft.trim()}
                                >
                                    <SendHorizontal size={14} aria-hidden="true" />
                                    <span>{submitting ? '发送中...' : '回复'}</span>
                                </button>
                            </div>
                        </div>
                    </form>
                </section>

                <section className="space-detail__comments" aria-label="回复列表">
                    <div className="space-detail__comments-header">
                        <h2>全部回复</h2>
                        <span className="space-detail__count-badge">{totalComments}</span>
                    </div>

                    {loadingComments && comments.length === 0 && (
                        <div className="space-detail__comment-skeletons" aria-label="正在加载评论">
                            {[0, 1, 2].map((index) => (
                                <div key={index} className="space-detail__skeleton-comment">
                                    <div className="space-detail__skeleton-avatar space-detail__skeleton-avatar--sm" />
                                    <div className="space-detail__skeleton-lines">
                                        <div className="space-detail__skeleton-line space-detail__skeleton-line--short" />
                                        <div className="space-detail__skeleton-line space-detail__skeleton-line--medium" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {comments.length === 0 && !loadingComments && (
                        <div className="space-detail__empty">
                            <div className="space-detail__empty-icon" aria-hidden="true">
                                <MessageCircle size={22} />
                            </div>
                            <p className="space-detail__empty-title">还没有回复</p>
                            <p className="space-detail__empty-desc">
                                在上方输入你的观点，开启第一条讨论
                            </p>
                        </div>
                    )}

                    <div className="space-detail__comment-list">
                        {comments.map((comment) => {
                            const relativeTime = formatCommentTime(comment.createdAt);
                            const fullTime = formatFullCommentTime(comment.createdAt);
                            return (
                                <article key={comment.id} className="space-detail__comment">
                                    <button
                                        type="button"
                                        className="space-detail__comment-avatar"
                                        onClick={() => navigate(`/space/user/${comment.author.id}`)}
                                        aria-label={`查看 ${comment.author.username} 的主页`}
                                    >
                                        {comment.author.avatarUrl ? (
                                            <img
                                                src={comment.author.avatarUrl}
                                                alt={comment.author.username}
                                            />
                                        ) : (
                                            <span>
                                                {comment.author.username.charAt(0).toUpperCase()}
                                            </span>
                                        )}
                                    </button>

                                    <div className="space-detail__comment-body">
                                        <div className="space-detail__comment-meta">
                                            <button
                                                type="button"
                                                className="space-detail__comment-name"
                                                onClick={() =>
                                                    navigate(`/space/user/${comment.author.id}`)
                                                }
                                            >
                                                {comment.author.username}
                                            </button>
                                            <span className="space-detail__comment-handle">
                                                @{comment.author.username}
                                            </span>
                                            <span
                                                className="space-detail__comment-dot"
                                                aria-hidden="true"
                                            >
                                                ·
                                            </span>
                                            <time
                                                className="space-detail__comment-time"
                                                title={fullTime}
                                            >
                                                {relativeTime}
                                            </time>
                                        </div>

                                        <div className="space-detail__comment-text">
                                            {comment.content}
                                        </div>

                                        <div className="space-detail__comment-actions">
                                            <button
                                                type="button"
                                                className="space-detail__comment-reply-btn"
                                                aria-label={`回复 @${comment.author.username}`}
                                                onClick={() =>
                                                    handleReplyToAuthor(comment.author.username)
                                                }
                                            >
                                                <Reply size={13} aria-hidden="true" />
                                                <span>回复</span>
                                            </button>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    {hasMore && (
                        <button
                            type="button"
                            className="space-detail__more"
                            onClick={() => loadComments(false)}
                            disabled={loadingComments}
                        >
                            {loadingComments ? '加载中...' : '加载更多回复'}
                        </button>
                    )}
                </section>
            </div>
        </div>
    );
};

export default SpacePostDetailPage;
