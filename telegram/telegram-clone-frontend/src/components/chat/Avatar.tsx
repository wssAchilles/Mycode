import React from 'react';
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
    // 获取首字母
    const getInitials = (name: string): string => {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    };

    // 根据名字生成渐变色
    const getGradient = (name: string): string => {
        if (!name) return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

        const gradients = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
            'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
            'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
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
            {src ? (
                <img
                    src={src}
                    alt={name || 'Avatar'}
                    className="tg-avatar__image"
                    loading="lazy"
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
