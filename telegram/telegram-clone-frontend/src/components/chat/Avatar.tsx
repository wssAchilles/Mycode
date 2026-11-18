import React, { useEffect, useState } from 'react';
import { resolveMediaCrossOrigin } from '../../utils/apiUrl';
import './Avatar.css';

interface AvatarProps {
    src?: string;
    name?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    status?: 'online' | 'offline' | 'away' | 'busy';
    showStatus?: boolean;
    className?: string;
    onClick?: () => void;
}

/**
 * 头像组件
 * 支持图片、首字母、在线状态显示
 */
export const Avatar: React.FC<AvatarProps> = ({
    src,
    name = '',
    size = 'md',
    status,
    showStatus = true,
    className = '',
    onClick
}) => {
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
        setImgFailed(false);
    }, [src]);

    // 获取首字母
    const getInitials = (name: string): string => {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    };

    // 根据名字生成克制沉稳的头像色板
    const getGradient = (name: string): string => {
        if (!name) return 'linear-gradient(135deg, #1D9BF0 0%, #2563EB 100%)';

        const gradients = [
            'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
            'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)',
            'linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)',
            'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)',
            'linear-gradient(135deg, #059669 0%, #10B981 100%)',
            'linear-gradient(135deg, #0891B2 0%, #06B6D4 100%)',
            'linear-gradient(135deg, #1D9BF0 0%, #38BDF8 100%)',
        ];

        // 根据名字的 hash 选择渐变
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return gradients[Math.abs(hash) % gradients.length];
    };

    return (
        <div
            className={`tg-avatar tg-avatar--${size} ${onClick ? 'tg-avatar--clickable' : ''} ${className}`}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
        >
            {/* 头像图片或首字母 */}
            {src && !imgFailed ? (
                <img
                    src={src}
                    alt={name || 'Avatar'}
                    crossOrigin={resolveMediaCrossOrigin(src)}
                    className="tg-avatar__image"
                    loading="lazy"
                    onError={() => setImgFailed(true)}
                />
            ) : (
                <div
                    className="tg-avatar__initials"
                    style={{ background: getGradient(name) }}
                >
                    {getInitials(name)}
                </div>
            )}

            {/* 在线状态指示器 */}
            {showStatus && status && (
                <span className={`tg-avatar__status tg-avatar__status--${status}`} />
            )}
        </div>
    );
};

export default Avatar;
