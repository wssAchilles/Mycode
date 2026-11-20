/**
 * Space Page Icons - Apple SF Symbols 风格双态图标集
 * 未选中态采用 1.85px 圆润几何描边，激活态采用饱满实心或双层质感填充
 */

import React from 'react';

interface IconProps {
    active?: boolean;
    className?: string;
}

export const HomeIcon: React.FC<IconProps> = ({ active, className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={active ? '1.6' : '1.85'}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M3.5 9.5L12 3l8.5 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6.25a1.25 1.25 0 0 0-1.25-1.25h-2.5a1.25 1.25 0 0 0-1.25 1.25v6.25H5A1.5 1.5 0 0 1 3.5 20V9.5z" />
    </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ active, className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? '2.4' : '1.85'}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <circle cx="10.75" cy="10.75" r="7.25" fill={active ? 'rgba(15, 20, 25, 0.08)' : 'none'} />
        <line x1="20.5" y1="20.5" x2="16" y2="16" />
    </svg>
);

export const NotificationIcon: React.FC<IconProps> = ({ active, className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={active ? '1.75' : '1.85'}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M18 8.25a6 6 0 0 0-12 0c0 6.25-2.5 8.25-2.5 8.25h17S18 14.5 18 8.25z" />
        <path d="M13.73 20.5a2 2 0 0 1-3.46 0" fill="none" />
    </svg>
);

export const MessageIcon: React.FC<IconProps> = ({ active, className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={active ? '1.75' : '1.85'}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M20.5 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20.8l1.7-5.3a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 7.7 7.8v.5z" />
    </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="12" y1="5.25" x2="12" y2="18.75" />
        <line x1="5.25" y1="12" x2="18.75" y2="12" />
    </svg>
);

export const SparkIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M12 2.75l2.15 5.65 5.65 2.15-5.65 2.15L12 18.35l-2.15-5.65-5.65-2.15 5.65-2.15L12 2.75z" />
    </svg>
);

export const TrendIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M3 16.5l5.75-5.75 3.75 3.75L20 7" />
        <path d="M14.5 7H20v5.5" />
    </svg>
);

export const UserPlusIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M15 20.5v-1.75a3.75 3.75 0 0 0-3.75-3.75H5.25A3.75 3.75 0 0 0 1.5 18.75v1.75" />
        <circle cx="8.25" cy="7.25" r="3.75" />
        <path d="M19 8.25v5.5" />
        <path d="M16.25 11h5.5" />
    </svg>
);

// 通用箭头图标
export const ArrowLeftIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
);

// 登出图标
export const LogoutIcon: React.FC<IconProps> = ({ className }) => (
    <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);
