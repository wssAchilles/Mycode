/* eslint-disable react-refresh/only-export-components */
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motionDurations, useAnimeScope, waapi } from '../../core/animation';
import './Toast.css';

interface ToastProps {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
    onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', duration = 3000, onClose }) => {
    const liveRole = type === 'error' || type === 'warning' ? 'alert' : 'status';
    const livePriority = type === 'error' || type === 'warning' ? 'assertive' : 'polite';
    const toastMotion = useAnimeScope<HTMLDivElement, {
        enter: () => void;
        exit: (done: () => void) => void;
    }>(
        ({ root, reducedMotion, duration: motionDuration }) => ({
            enter: () => {
                if (reducedMotion || !root || typeof root.animate !== 'function') return;
                waapi.animate(root, {
                    opacity: [0, 1],
                    y: ['20px', '0px'],
                    scale: [0.94, 1],
                    duration: motionDuration(motionDurations.normal),
                    ease: 'out(4)',
                });
            },
            exit: (done) => {
                if (reducedMotion || !root || typeof root.animate !== 'function') {
                    done();
                    return;
                }
                waapi.animate(root, {
                    opacity: [1, 0],
                    y: ['0px', '12px'],
                    scale: [1, 0.96],
                    duration: motionDuration(motionDurations.normal),
                    ease: 'out(3)',
                    onComplete: done,
                });
            },
        }),
        [],
    );

    useEffect(() => {
        const timerIn = setTimeout(() => toastMotion.run('enter'), 10);
        const timerOut = setTimeout(() => {
            toastMotion.run('exit', () => onClose?.());
        }, duration);

        return () => {
            clearTimeout(timerIn);
            clearTimeout(timerOut);
        };
    }, [duration, onClose, toastMotion]);

    return (
        <div
            ref={toastMotion.rootRef}
            className={`tg-toast tg-toast--${type}`}
            role={liveRole}
            aria-live={livePriority}
            aria-atomic="true"
        >
            {message}
        </div>
    );
};

let toastContainer: HTMLDivElement | null = null;

function promoteToastContainerToTopLayer(el: HTMLDivElement): void {
    const popoverEl = el as HTMLDivElement & {
        showPopover?: () => void;
        hidePopover?: () => void;
    };
    if (typeof popoverEl.showPopover !== 'function') return;
    if (el.getAttribute('popover') !== 'manual') {
        el.setAttribute('popover', 'manual');
    }
    try {
        // 先关闭再打开，确保容器位于浏览器 Top Layer 栈最顶端（高于已打开的 showModal 对话框）
        if (typeof el.matches === 'function' && el.matches(':popover-open')) {
            popoverEl.hidePopover?.();
        }
        popoverEl.showPopover();
    } catch {
        // 某些测试环境或旧浏览器不支持时自动回退至普通固定层
    }
}

function demoteToastContainerIfEmpty(el: HTMLDivElement): void {
    if (el.childElementCount > 0) return;
    const popoverEl = el as HTMLDivElement & { hidePopover?: () => void };
    if (typeof popoverEl.hidePopover !== 'function') return;
    try {
        if (typeof el.matches === 'function' && el.matches(':popover-open')) {
            popoverEl.hidePopover();
        }
    } catch {
        // 静默忽略
    }
}

export const showToast = (message: string, type: ToastProps['type'] = 'info', duration = 2000) => {
    if (!toastContainer || !document.body.contains(toastContainer)) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'tg-toast-container';
        toastContainer.setAttribute('aria-label', '通知');
        document.body.appendChild(toastContainer);
    }

    const activeContainer = toastContainer;
    const wrapper = document.createElement('div');
    activeContainer.appendChild(wrapper);
    promoteToastContainerToTopLayer(activeContainer);

    const root = createRoot(wrapper);

    const handleClose = () => {
        root.unmount();
        if (wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
        demoteToastContainerIfEmpty(activeContainer);
    };

    root.render(
        <Toast message={message} type={type} duration={duration} onClose={handleClose} />
    );
};
