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
    const toastMotion = useAnimeScope<HTMLDivElement, {
        enter: () => void;
        exit: (done: () => void) => void;
    }>(
        ({ root, reducedMotion, duration: motionDuration }) => ({
            enter: () => {
                if (reducedMotion || !root) return;
                waapi.animate(root, {
                    opacity: [0, 1],
                    y: ['20px', '0px'],
                    scale: [0.94, 1],
                    duration: motionDuration(motionDurations.normal),
                    ease: 'out(4)',
                });
            },
            exit: (done) => {
                if (reducedMotion || !root) {
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
        <div ref={toastMotion.rootRef} className={`tg-toast tg-toast--${type}`}>
            {message}
        </div>
    );
};

// Singleton toast manager
let toastContainer: HTMLDivElement | null = null;

export const showToast = (message: string, type: ToastProps['type'] = 'info', duration = 2000) => {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'tg-toast-container';
        document.body.appendChild(toastContainer);
    }

    const container = document.createElement('div');
    toastContainer.appendChild(container); // Append wrapper

    // Render toast into the wrapper
    const root = createRoot(container);

    const handleClose = () => {
        root.unmount();
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
    };

    root.render(
        <Toast message={message} type={type} duration={duration} onClose={handleClose} />
    );
};
