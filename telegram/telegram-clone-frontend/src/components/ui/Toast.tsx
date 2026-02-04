import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './Toast.css';

interface ToastProps {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
    onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', duration = 3000, onClose }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Yield to browser to allow animation start state
        const timerIn = setTimeout(() => setIsVisible(true), 10);

        const timerOut = setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => onClose?.(), 300); // Wait for exit animation
        }, duration);

        return () => {
            clearTimeout(timerIn);
            clearTimeout(timerOut);
        };
    }, [duration, onClose]);

    return (
        <div className={`tg-toast tg-toast--${type} ${isVisible ? 'is-visible' : ''}`}>
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
