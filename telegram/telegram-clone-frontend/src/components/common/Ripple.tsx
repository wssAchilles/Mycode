import React, { useState, useLayoutEffect, useCallback } from 'react';
import './Ripple.css';

interface RippleProps {
    color?: string;
    duration?: number;
}

interface RippleState {
    x: number;
    y: number;
    size: number;
    key: number;
}

/**
 * Ripple Component
 * Implements the Material Design ink ripple effect used in Telegram.
 * 
 * Usage:
 * Place inside a container with `position: relative` and `overflow: hidden`.
 * Pass `onMouseDown` from the parent to trigger it, usually handled automatically if integrated.
 * 
 * Ideally used within the generic Button component.
 */
const Ripple: React.FC<RippleProps> = ({ color = 'rgba(0, 0, 0, 0.08)', duration = 400 }) => {
    const [ripples, setRipples] = useState<RippleState[]>([]);

    // Cleanup ripples after animation
    useLayoutEffect(() => {
        let bounce: number;
        if (ripples.length > 0) {
            bounce = window.setTimeout(() => {
                setRipples([]);
            }, duration * 2);
        }
        return () => window.clearTimeout(bounce);
    }, [ripples.length, duration]);

    const addRipple = useCallback((event: React.MouseEvent<HTMLElement>) => {
        const container = event.currentTarget.getBoundingClientRect();
        const size = container.width > container.height ? container.width : container.height;

        // Check if event is triggered by keyboard (enter/space) which usually has coordinates 0,0 or similar
        // If so, center the ripple
        let x, y;
        if (event.clientX === 0 && event.clientY === 0) {
            x = container.width / 2;
            y = container.height / 2;
        } else {
            x = event.clientX - container.left;
            y = event.clientY - container.top;
        }

        const newRipple = {
            x,
            y,
            size,
            key: Date.now(),
        };

        setRipples((prev) => [...prev, newRipple]);
    }, []);

    // Expose the trigger method to parent? 
    // Actually, usually the parent attaches the handler. 
    // But a cleaner way in React is to have the Ripple overlay sitting on top and capturing clicks, 
    // OR the parent passes the event to a ref.
    // 
    // For simplicity in Telegram-style, we often just want a wrapper or a hook.
    // Let's make this component autonomous: it listens to its parent's mousedown? 
    // No, React events bubble. Let's make a container wrapper?

    // A common pattern: <div className="ripple-container" onMouseDown={addRipple} />
    // But we want it to be composable.

    return (
        <div
            className="ripple-container"
            onMouseDown={addRipple}
            style={{ '--tg-ripple-color': color, '--tg-ripple-duration': `${duration}ms` } as React.CSSProperties}
        >
            {ripples.map((ripple) => (
                <span
                    key={ripple.key}
                    style={{
                        top: ripple.y,
                        left: ripple.x,
                        width: ripple.size,
                        height: ripple.size,
                    }}
                />
            ))}
        </div>
    );
};

export default React.memo(Ripple);
