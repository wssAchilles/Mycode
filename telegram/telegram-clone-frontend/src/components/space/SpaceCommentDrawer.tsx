import React, { useEffect, useMemo, useState, useRef } from 'react';
import { spaceAPI, type CommentData } from '../../services/spaceApi';
import type { PostData } from './SpacePost';
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
    const [renderedPost, setRenderedPost] = useState<PostData | null>(post);
    const panelRef = useRef<HTMLElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
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
        if (!renderedPost) return '';
        return renderedPost.content.length > 120
            ? `${renderedPost.content.slice(0, 120)}...`
            : renderedPost.content;
    }, [renderedPost]);

    if (!isPresent || !renderedPost) return null;

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
                    <div>
                        <div id="space-comment-drawer-title" className="space-comment-drawer__title">评论</div>
                        <div className="space-comment-drawer__subtitle">{renderedPost.author.username}</div>
                    </div>
                    <button className="space-comment-drawer__close" onClick={onClose} aria-label="关闭评论">
                        ×
                    </button>
                </header>

                <div className="space-comment-drawer__post">
                    <div className="space-comment-drawer__post-author">@{renderedPost.author.username}</div>
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
                        ref={textareaRef}
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
