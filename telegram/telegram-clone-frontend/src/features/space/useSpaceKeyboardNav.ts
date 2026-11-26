/**
 * Space 桌面端专业键盘浏览流 Hook（J/K/L/B/C/N/Enter）
 * 仅在主页流激活、无输入焦点且未打开弹窗时响应
 */
import { useEffect, useState } from 'react';
import type { PostData } from '../../components/space';

interface UseSpaceKeyboardNavOptions {
    enabled: boolean;
    posts: PostData[];
    onLikeToggle: (post: PostData) => void;
    onBookmarkToggle: (post: PostData) => void;
    onCommentOpen: (postId: string) => void;
    onPostOpen: (postId: string) => void;
    onComposeOpen: () => void;
}

function isEditableElement(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
    );
}

export function useSpaceKeyboardNav({
    enabled,
    posts,
    onLikeToggle,
    onBookmarkToggle,
    onCommentOpen,
    onPostOpen,
    onComposeOpen,
}: UseSpaceKeyboardNavOptions): {
    focusedIndex: number;
    setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
} {
    const [focusedIndex, setFocusedIndex] = useState(-1);

    useEffect(() => {
        if (posts.length === 0) {
            setFocusedIndex(-1);
        } else if (focusedIndex >= posts.length) {
            setFocusedIndex(posts.length - 1);
        }
    }, [focusedIndex, posts.length]);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return;

        const focusPostCardAt = (idx: number) => {
            const targetPost = posts[idx];
            if (!targetPost) return;
            const node = document.querySelector<HTMLElement>(
                `[data-space-post-id="${targetPost.id}"]`,
            );
            if (node && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
            if (isEditableElement(event.target)) return;
            // 有模态框打开时让步
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

            const key = event.key.toLowerCase();
            if (key === 'n') {
                event.preventDefault();
                onComposeOpen();
                return;
            }
            if (posts.length === 0) return;

            if (key === 'j') {
                event.preventDefault();
                const next = focusedIndex < 0 ? 0 : Math.min(posts.length - 1, focusedIndex + 1);
                setFocusedIndex(next);
                focusPostCardAt(next);
            } else if (key === 'k') {
                event.preventDefault();
                const next = focusedIndex <= 0 ? 0 : focusedIndex - 1;
                setFocusedIndex(next);
                focusPostCardAt(next);
            } else if (key === 'l' && focusedIndex >= 0 && posts[focusedIndex]) {
                event.preventDefault();
                onLikeToggle(posts[focusedIndex]);
            } else if (key === 'b' && focusedIndex >= 0 && posts[focusedIndex]) {
                event.preventDefault();
                onBookmarkToggle(posts[focusedIndex]);
            } else if (key === 'c' && focusedIndex >= 0 && posts[focusedIndex]) {
                event.preventDefault();
                onCommentOpen(posts[focusedIndex].id);
            } else if (key === 'enter' && focusedIndex >= 0 && posts[focusedIndex]) {
                const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
                if (activeTag === 'BUTTON' || activeTag === 'A') return;
                event.preventDefault();
                onPostOpen(posts[focusedIndex].id);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        enabled,
        focusedIndex,
        onBookmarkToggle,
        onCommentOpen,
        onComposeOpen,
        onLikeToggle,
        onPostOpen,
        posts,
    ]);

    return { focusedIndex, setFocusedIndex };
}
