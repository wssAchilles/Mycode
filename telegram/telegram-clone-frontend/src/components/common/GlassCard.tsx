/**
 * GlassCard - 高级毛玻璃卡片组件
 * Telegram Premium 风格的容器组件
 * 
 * 特性:
 * - 真正的 backdrop-filter blur 效果
 * - 边缘高光和渐变边框
 * - 悬停动画
 * - 多种变体 (default, elevated, subtle)
 */

import React from 'react';
import './GlassCard.css';

export interface GlassCardProps {
    children: React.ReactNode;
    variant?: 'default' | 'elevated' | 'subtle';
    hover?: boolean;
    className?: string;
    onClick?: () => void;
    as?: 'div' | 'section' | 'article';
}

export const GlassCard: React.FC<GlassCardProps> = ({
    children,
    variant = 'default',
    hover = false,
    className = '',
    onClick,
    as: Component = 'div',
}) => {
    const classes = [
        'glass-card',
        `glass-card--${variant}`,
        hover && 'glass-card--hoverable',
        onClick && 'glass-card--clickable',
        className,
    ].filter(Boolean).join(' ');

    return (
        <Component className={classes} onClick={onClick}>
            <div className="glass-card__inner">
                {children}
            </div>
            {/* 边缘高光效果 */}
            <div className="glass-card__shine" aria-hidden="true" />
        </Component>
    );
};

export default GlassCard;
