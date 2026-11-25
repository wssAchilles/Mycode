import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, SendHorizontal, X } from 'lucide-react';
import { spaceAPI, type CommentData } from '../../services/spaceApi';
import { authUtils } from '../../services/apiClient';
import type { PostData } from './SpacePost';
import {
    COMMENT_MAX_LENGTH,
    formatCommentTime,
    formatFullCommentTime,
} from './utils/formatCommentTime';
import { showToast } from '../ui/Toast';
import {
    createTimeline,
    limitedMotionItems,
    motionDurations,
    motionStaggers,
    stagger,
    useAnimeScope,
    useMotionPresence,
    waapi,
} from '../../core/animation';
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
    const [isComposerFocused, setIsComposerFocused] = useState(false);
    const [renderedPost, setRenderedPost] = useState<PostData | null>(post);
    const panelRef = useRef<HTMLElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const isComposingRef = useRef(false);
    const currentUser = useMemo(() => authUtils.getCurrentUser(), []);
    const { isPresent, isExiting, finishExit } = useMotionPresence(open, motionDurations.normal);

    const postId = post?.id;

    const drawerMotion = useAnimeScope<HTMLDivElement, {
        enter: () => void;
        exit: () => void;
        revealComments: () => void;
    }>(
        ({ root, reducedMotion, duration, runHeavy }) => ({
            enter: () => {
                if (reducedMotion || !root) {
                    textareaRef.current?.focus();
                    return;
                }
                runHeavy(motionDurations.normal, () => {
                    const overlay = root.querySelector('.space-comment-drawer__overlay');
                    const panel = root.querySelector('.space-comment-drawer__panel');
                    if (!overlay || !panel) return;
                    createTimeline({
                        onComplete: () => textareaRef.current?.focus(),
                    })
                        .sync(
                            waapi.animate(overlay, {
                                opacity: [0, 1],
                                duration: duration(motionDurations.fast),
                            }),
                            0,
                        )
                        .sync(
                            waapi.animate(panel, {
                                opacity: [0, 1],
                                x: ['24px', '0px'],
                                duration: duration(motionDurations.normal),
                                ease: 'out(4)',
                            }),
                            0,
                        );
                });
            },
            exit: () => {
                if (reducedMotion || !root) {
                    finishExit();
                    return;
                }
                runHeavy(motionDurations.normal, () => {
                    const overlay = root.querySelector('.space-comment-drawer__overlay');
                    const panel = root.querySelector('.space-comment-drawer__panel');
                    if (!overlay || !panel) {
                        finishExit();
                        return;
                    }
                    createTimeline({
                        onComplete: finishExit,
                    })
                        .sync(
                            waapi.animate(panel, {
                                opacity: [1, 0],
                                x: ['0px', '24px'],
                                duration: duration(motionDurations.normal),
                                ease: 'out(3)',
                            }),
                            0,
                        )
                        .sync(
                            waapi.animate(overlay, {
                                opacity: [1, 0],
                                duration: duration(motionDurations.fast),
                            }),
                            60,
                        );
                });
            },
            revealComments: () => {
                if (reducedMotion || !root) return;
                const items = limitedMotionItems(root.querySelectorAll('.space-comment-drawer__item'));
                if (items.length === 0) return;
                waapi.animate(items, {
                    opacity: [0, 1],
                    y: ['8px', '0px'],
                    duration: duration(motionDurations.fast),
                    delay: stagger(motionStaggers.tight),
                    ease: 'out(4)',
                });
            },
        }),
        [finishExit],
    );

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
        if (open && post) {
            setRenderedPost(post);
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement && !panelRef.current?.contains(activeElement)) {
                returnFocusRef.current = activeElement;
            }
        }
    }, [open, post]);

    useEffect(() => {
        if (open && isPresent) {
            drawerMotion.run('enter');
        } else if (isExiting) {
            drawerMotion.run('exit');
        }
    }, [drawerMotion, isExiting, isPresent, open]);

    useEffect(() => {
        if (!isPresent) {
            resetState();
            setDraft('');
            const returnTarget = returnFocusRef.current;
            returnFocusRef.current = null;
            if (returnTarget && document.contains(returnTarget)) {
                returnTarget.focus();
            }
        }
    }, [isPresent]);

    useEffect(() => {
        if (open && comments.length > 0) {
            drawerMotion.run('revealComments');
        }
    }, [comments.length, drawerMotion, open]);

    useEffect(() => {
        if (open && postId) {
            resetState();
            loadComments(true);
        }
        if (!open) {
            setDraft('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, postId]);

    useEffect(() => {
        if (!open) return;
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            const panel = panelRef.current;
            if (!panel) return;

            const focusable = Array.from(
                panel.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
                ),
            ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

            if (focusable.length === 0) {
                event.preventDefault();
                panel.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [open, onClose]);

    const submitComment = useCallback(async () => {
        if (!postId || !draft.trim() || submitting) return;
        setSubmitting(true);
        try {
            const created = await spaceAPI.createComment(postId, draft.trim());
            setComments((prev) => [created, ...prev]);
            setRenderedPost((prev) =>
                prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev,
            );
            setDraft('');
            onCommentAdded?.(postId);
        } catch (error) {
            console.error('发送评论失败:', error);
            showToast('评论失败，请稍后再试', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [draft, onCommentAdded, postId, submitting]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        await submitComment();
    };

    const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isComposingRef.current || event.nativeEvent.isComposing) {
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void submitComment();
        }
    };

    const shortContent = useMemo(() => {
        if (!renderedPost) return '';
        return renderedPost.content.length > 140
            ? `${renderedPost.content.slice(0, 140)}...`
            : renderedPost.content;
    }, [renderedPost]);

    if (!isPresent || !renderedPost) return null;

    const totalComments = Math.max(renderedPost.commentCount, comments.length);
    const postAuthorInitial = renderedPost.author.username.charAt(0).toUpperCase();
    const currentUserInitial = (currentUser?.username?.trim().charAt(0) || '我').toUpperCase();
    const isNearLimit = draft.length >= Math.floor(COMMENT_MAX_LENGTH * 0.9);
    const isAtLimit = draft.length >= COMMENT_MAX_LENGTH;

    return (
        <div ref={drawerMotion.rootRef} className="space-comment-drawer">
            <div className="space-comment-drawer__overlay" onClick={onClose} />
            <aside
                ref={panelRef}
                className="space-comment-drawer__panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="space-comment-drawer-title"
                tabIndex={-1}
            >
                <header className="space-comment-drawer__header">
                    <div className="space-comment-drawer__header-info">
                        <div className="space-comment-drawer__title-row">
                            <h2 id="space-comment-drawer-title" className="space-comment-drawer__title">
                                评论
                            </h2>
                            <span className="space-comment-drawer__count">{totalComments}</span>
                        </div>
                        <div className="space-comment-drawer__subtitle">
                            回复 @{renderedPost.author.username}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="space-comment-drawer__close"
                        onClick={onClose}
                        aria-label="关闭评论"
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                </header>

                <div className="space-comment-drawer__post">
                    <div className="space-comment-drawer__post-rail" aria-hidden="true">
                        <div className="space-comment-drawer__post-avatar">
                            {renderedPost.author.avatarUrl ? (
                                <img
                                    src={renderedPost.author.avatarUrl}
                                    alt={renderedPost.author.username}
                                />
                            ) : (
                                <span>{postAuthorInitial}</span>
                            )}
                        </div>
                        <span className="space-comment-drawer__thread-line" />
                    </div>
                    <div className="space-comment-drawer__post-main">
                        <div className="space-comment-drawer__post-author-row">
                            <span className="space-comment-drawer__post-name">
                                {renderedPost.author.username}
                            </span>
                            <span className="space-comment-drawer__post-author">
                                @{renderedPost.author.username}
                            </span>
                        </div>
                        <div className="space-comment-drawer__post-content">{shortContent}</div>
                    </div>
                </div>

                <div className="space-comment-drawer__list">
                    {loading && comments.length === 0 && (
                        <div className="space-comment-drawer__skeletons" aria-label="加载评论中">
                            {[0, 1, 2].map((index) => (
                                <div key={index} className="space-comment-drawer__skeleton-item">
                                    <div className="space-comment-drawer__skeleton-avatar" />
                                    <div className="space-comment-drawer__skeleton-lines">
                                        <div className="space-comment-drawer__skeleton-line space-comment-drawer__skeleton-line--short" />
                                        <div className="space-comment-drawer__skeleton-line" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && comments.length === 0 && (
                        <div className="space-comment-drawer__empty">
                            <div className="space-comment-drawer__empty-icon" aria-hidden="true">
                                <MessageCircle size={20} />
                            </div>
                            <p className="space-comment-drawer__empty-title">还没有评论</p>
                            <p className="space-comment-drawer__empty-desc">
                                来做第一个发声的人
                            </p>
                        </div>
                    )}

                    {comments.map((comment) => {
                        const relativeTime = formatCommentTime(comment.createdAt);
                        const fullTime = formatFullCommentTime(comment.createdAt);
                        return (
                            <div key={comment.id} className="space-comment-drawer__item">
                                <div className="space-comment-drawer__avatar">
                                    {comment.author.avatarUrl ? (
                                        <img
                                            src={comment.author.avatarUrl}
                                            alt={comment.author.username}
                                        />
                                    ) : (
                                        <span>{comment.author.username.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="space-comment-drawer__body">
                                    <div className="space-comment-drawer__meta">
                                        <span className="space-comment-drawer__name">
                                            {comment.author.username}
                                        </span>
                                        <span
                                            className="space-comment-drawer__dot"
                                            aria-hidden="true"
                                        >
                                            ·
                                        </span>
                                        <time
                                            className="space-comment-drawer__time"
                                            title={fullTime}
                                        >
                                            {relativeTime}
                                        </time>
                                    </div>
                                    <div className="space-comment-drawer__text">
                                        {comment.content}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {hasMore && (
                        <button
                            type="button"
                            className="space-comment-drawer__more"
                            onClick={() => loadComments(false)}
                            disabled={loading}
                        >
                            {loading ? '加载中...' : '加载更多评论'}
                        </button>
                    )}
                </div>

                <form className="space-comment-drawer__composer" onSubmit={handleSubmit}>
                    <div
                        className={`space-comment-drawer__composer-box ${isComposerFocused ? 'is-focused' : ''}`}
                    >
                        <div className="space-comment-drawer__composer-input-row">
                            <div className="space-comment-drawer__composer-avatar" aria-hidden="true">
                                {currentUser?.avatarUrl ? (
                                    <img
                                        src={currentUser.avatarUrl}
                                        alt={currentUser.username || '我'}
                                    />
                                ) : (
                                    <span>{currentUserInitial}</span>
                                )}
                            </div>

                            <label
                                className="space-comment-drawer__sr-only"
                                htmlFor="space-comment-input"
                            >
                                输入评论内容
                            </label>
                            <textarea
                                ref={textareaRef}
                                id="space-comment-input"
                                name="spaceComment"
                                maxLength={COMMENT_MAX_LENGTH}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onFocus={() => setIsComposerFocused(true)}
                                onBlur={() => setIsComposerFocused(false)}
                                onKeyDown={handleTextareaKeyDown}
                                onCompositionStart={() => {
                                    isComposingRef.current = true;
                                }}
                                onCompositionEnd={() => {
                                    isComposingRef.current = false;
                                }}
                                placeholder="写下你的观点..."
                                rows={2}
                            />
                        </div>

                        <div className="space-comment-drawer__composer-footer">
                            <div className="space-comment-drawer__composer-meta">
                                <span className="space-comment-drawer__shortcut-hint">
                                    ⌘ + Enter
                                </span>
                                {draft.length > 0 && (
                                    <span
                                        className={`space-comment-drawer__char-count ${
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
                                className="space-comment-drawer__submit-btn"
                                disabled={submitting || !draft.trim()}
                            >
                                <SendHorizontal size={14} aria-hidden="true" />
                                <span>{submitting ? '发送中...' : '发送'}</span>
                            </button>
                        </div>
                    </div>
                </form>
            </aside>
        </div>
    );
};

export default SpaceCommentDrawer;
