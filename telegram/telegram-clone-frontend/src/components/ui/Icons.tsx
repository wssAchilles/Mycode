/**
 * SVG 图标库 - 替换所有 emoji
 * 基于 Heroicons 风格
 */

import React from 'react';

interface IconProps {
    size?: number;
    className?: string;
    color?: string;
}

// 聊天图标
export const ChatIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M8 12H8.01M12 12H12.01M16 12H16.01M21 12C21 16.4183 16.9706 20 12 20C10.4607 20 9.01172 19.6565 7.74467 19.0511L3 20L4.39499 16.28C3.51156 15.0423 3 13.5743 3 12C3 7.58172 7.02944 4 12 4C16.9706 4 21 7.58172 21 12Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 发送图标
export const SendIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 用户图标
export const UserIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21M16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 眼睛图标 (显示密码)
export const EyeIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 眼睛关闭图标 (隐藏密码)
export const EyeOffIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M17.94 17.94C16.2306 19.243 14.1491 19.9649 12 20C5 20 1 12 1 12C2.24389 9.68192 3.96914 7.65661 6.06 6.06M9.9 4.24C10.5883 4.07888 11.2931 3.99834 12 4C19 4 23 12 23 12C22.393 13.1356 21.6691 14.2048 20.84 15.19M14.12 14.12C13.8454 14.4148 13.5141 14.6512 13.1462 14.8151C12.7782 14.9791 12.3809 15.0673 11.9781 15.0744C11.5753 15.0815 11.1752 15.0074 10.8016 14.8565C10.4281 14.7056 10.0887 14.4811 9.80385 14.1962C9.51897 13.9113 9.29439 13.5719 9.14351 13.1984C8.99262 12.8248 8.91853 12.4247 8.92563 12.0219C8.93274 11.6191 9.02091 11.2218 9.18488 10.8538C9.34884 10.4859 9.58525 10.1546 9.88 9.88M1 1L23 23" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 警告图标
export const AlertIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18C1.64537 18.3024 1.55299 18.6453 1.55201 18.9945C1.55103 19.3437 1.64149 19.6871 1.81443 19.9905C1.98737 20.2939 2.23673 20.5467 2.53773 20.7238C2.83873 20.9009 3.18082 20.996 3.53 21H20.47C20.8192 20.996 21.1613 20.9009 21.4623 20.7238C21.7633 20.5467 22.0126 20.2939 22.1856 19.9905C22.3585 19.6871 22.449 19.3437 22.448 18.9945C22.447 18.6453 22.3546 18.3024 22.18 18L13.71 3.86C13.5318 3.56611 13.2807 3.32313 12.981 3.15449C12.6814 2.98585 12.3435 2.89725 12 2.89725C11.6565 2.89725 11.3186 2.98585 11.019 3.15449C10.7193 3.32313 10.4682 3.56611 10.29 3.86Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 退出图标
export const LogoutIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9M16 17L21 12M21 12L16 7M21 12H9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 搜索图标
export const SearchIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 添加用户图标
export const UserPlusIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M16 21V19C16 17.9391 15.5786 16.9217 14.8284 16.1716C14.0783 15.4214 13.0609 15 12 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21M20 8V14M23 11H17M12.5 7C12.5 9.20914 10.7091 11 8.5 11C6.29086 11 4.5 9.20914 4.5 7C4.5 4.79086 6.29086 3 8.5 3C10.7091 3 12.5 4.79086 12.5 7Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 图片图标
export const ImageIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 10C9.32843 10 10 9.32843 10 8.5C10 7.67157 9.32843 7 8.5 7C7.67157 7 7 7.67157 7 8.5C7 9.32843 7.67157 10 8.5 10Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 15L16 10L5 21" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 附件图标
export const PaperclipIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M21.44 11.05L12.25 20.24C11.1242 21.3658 9.59723 21.9983 8.00502 21.9983C6.41282 21.9983 4.88584 21.3658 3.76002 20.24C2.6342 19.1142 2.00171 17.5872 2.00171 15.995C2.00171 14.4028 2.6342 12.8758 3.76002 11.75L12.95 2.56C13.7006 1.80944 14.7186 1.3877 15.78 1.3877C16.8415 1.3877 17.8594 1.80944 18.61 2.56C19.3606 3.31057 19.7823 4.32855 19.7823 5.39C19.7823 6.45146 19.3606 7.46944 18.61 8.22L9.41002 17.41C9.03474 17.7853 8.52574 17.9961 7.99502 17.9961C7.4643 17.9961 6.95531 17.7853 6.58002 17.41C6.20474 17.0347 5.99393 16.5257 5.99393 15.995C5.99393 15.4643 6.20474 14.9553 6.58002 14.58L15.07 6.1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 表情图标
export const SmileIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 14C8 14 9.5 16 12 16C14.5 16 16 14 16 14" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 9H9.01M15 9H15.01" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 麦克风图标
export const MicIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1C11.2044 1 10.4413 1.31607 9.87868 1.87868C9.31607 2.44129 9 3.20435 9 4V12C9 12.7956 9.31607 13.5587 9.87868 14.1213C10.4413 14.6839 11.2044 15 12 15C12.7956 15 13.5587 14.6839 14.1213 14.1213C14.6839 13.5587 15 12.7956 15 12V4C15 3.20435 14.6839 2.44129 14.1213 1.87868C13.5587 1.31607 12.7956 1 12 1Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 10V12C19 13.8565 18.2625 15.637 16.9497 16.9497C15.637 18.2625 13.8565 19 12 19C10.1435 19 8.36301 18.2625 7.05025 16.9497C5.7375 15.637 5 13.8565 5 12V10" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 19V23M8 23H16" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 文件图标
export const FileIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 2V8H20" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 在线状态点
export const OnlineDot: React.FC<{ size?: number; className?: string }> = ({ size = 10, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className} xmlns="http://www.w3.org/2000/svg">
        <circle cx="5" cy="5" r="5" fill="#10B981" />
    </svg>
);

// 离线状态点
export const OfflineDot: React.FC<{ size?: number; className?: string }> = ({ size = 10, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className} xmlns="http://www.w3.org/2000/svg">
        <circle cx="5" cy="5" r="5" fill="#EF4444" />
    </svg>
);

// 加载动画图标
export const LoadingSpinner: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" strokeOpacity="0.25" />
        <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
);

// 勾选图标
export const CheckIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M20 6L9 17L4 12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 关闭图标
export const XIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M18 6L6 18M6 6L18 18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// AI 机器人图标
export const BotIcon: React.FC<IconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2V4M12 4C8.68629 4 6 6.68629 6 10V16C6 17.1046 6.89543 18 8 18H16C17.1046 18 18 17.1046 18 16V10C18 6.68629 15.3137 4 12 4ZM8 22H16M10 14H14M9 10H9.01M15 10H15.01" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export default {
    ChatIcon,
    SendIcon,
    UserIcon,
    EyeIcon,
    EyeOffIcon,
    AlertIcon,
    LogoutIcon,
    SearchIcon,
    UserPlusIcon,
    ImageIcon,
    PaperclipIcon,
    SmileIcon,
    MicIcon,
    FileIcon,
    OnlineDot,
    OfflineDot,
    LoadingSpinner,
    CheckIcon,
    XIcon,
    BotIcon,
};
