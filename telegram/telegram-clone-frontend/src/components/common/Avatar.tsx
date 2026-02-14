import React, { useEffect, useMemo, useState } from 'react';
import { getAvatarGradient, getInitials } from '../../lib/colorUtils';
import './Avatar.css';

export interface AvatarProps {
    id?: string | number; // Used for gradient generation
    src?: string; // Image URL
    name?: string; // Used for initials
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number; // Preset or pixel value
    isSavedMessages?: boolean; // Special case for "Saved Messages"
    onClick?: () => void;
    className?: string;
    online?: boolean; // Online status indicator
}

const Avatar: React.FC<AvatarProps> = ({
    id,
    src,
    name,
    size = 'md',
    isSavedMessages = false,
    onClick,
    className = '',
    online = false,
}) => {
    const [imgFailed, setImgFailed] = useState(false);

    // If the src changes (e.g., user updates avatar), allow a new load attempt.
    useEffect(() => {
        setImgFailed(false);
    }, [src]);

    // Determine dimensions
    const sizeStyle = useMemo(() => {
        if (typeof size === 'number') {
            return { width: size, height: size, fontSize: size * 0.4 };
        }
        // Class names will handle presets, but we might need inline for font size adjustments 
        // if we want perfect fluid scaling. For now, rely on CSS classes for presets.
        return {};
    }, [size]);

    // Determine background
    const backgroundStyle = useMemo(() => {
        // Only suppress the gradient when the image is actually usable.
        if ((src && !imgFailed) || isSavedMessages) return {};
        return { background: getAvatarGradient(id || 0) };
    }, [id, src, imgFailed, isSavedMessages]);

    const initials = useMemo(() => getInitials(name || ''), [name]);

    const handleClick = (e: React.MouseEvent) => {
        if (onClick) {
            e.stopPropagation();
            onClick();
        }
    };

    return (
        <div
            className={`tg-avatar tg-avatar-${typeof size === 'string' ? size : 'custom'} ${className}`}
            style={{ ...sizeStyle, ...backgroundStyle }}
            onClick={handleClick}
        >
            {isSavedMessages ? (
                <div className="tg-avatar-saved-icon">
                    {/* Simple bookmark icon for Saved Messages */}
                    <svg viewBox="0 0 24 24" fill="white" width="60%" height="60%">
                        <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                    </svg>
                </div>
            ) : src && !imgFailed ? (
                <img
                    src={src}
                    alt={name || 'Avatar'}
                    className="tg-avatar-img"
                    onError={() => setImgFailed(true)}
                />
            ) : (
                <span className="tg-avatar-initials">{initials}</span>
            )}

            {online && <span className="tg-avatar-online" />}
        </div>
    );
};

export default React.memo(Avatar);
