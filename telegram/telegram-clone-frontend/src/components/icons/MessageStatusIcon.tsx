/**
 * MessageStatusIcon - 消息状态 SVG 图标组件
 * P1: 显示消息投递状态 (sending/sent/delivered/read/failed)
 * 遵循 UI/UX Pro Max Skill: 使用 SVG 图标，不使用 emoji
 */
import React from 'react';

export type MessageStatusType = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

interface MessageStatusIconProps {
    status: MessageStatusType;
    className?: string;
    size?: number;
}

/**
 * 消息状态图标组件
 * - sending: 旋转的圆环 (灰色)
 * - sent: 单勾 (灰色)
 * - delivered: 双勾 (灰色)
 * - read: 双勾 (蓝色)
 * - failed: 感叹号三角形 (红色，可点击重试)
 */
export const MessageStatusIcon: React.FC<MessageStatusIconProps> = ({
    status,
    className = '',
    size = 16,
}) => {
    const baseClass = `inline-flex items-center justify-center ${className}`;

    switch (status) {
        case 'sending':
            return (
                <span className={baseClass} title="发送中">
                    <svg
                        width={size}
                        height={size}
                        viewBox="0 0 16 16"
                        fill="none"
                        className="animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <circle
                            cx="8"
                            cy="8"
                            r="6"
                            stroke="#9CA3AF"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeDasharray="28.27"
                            strokeDashoffset="7"
                        />
                    </svg>
                </span>
            );

        case 'sent':
            return (
                <span className={baseClass} title="已发送">
                    <svg
                        width={size}
                        height={size}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M3 8L6.5 11.5L13 5"
                            stroke="#9CA3AF"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </span>
            );

        case 'delivered':
            return (
                <span className={baseClass} title="已送达">
                    <svg
                        width={size}
                        height={size}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* 第一个勾 */}
                        <path
                            d="M1 8L4 11L9.5 5"
                            stroke="#9CA3AF"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {/* 第二个勾 */}
                        <path
                            d="M6 8L9 11L14.5 5"
                            stroke="#9CA3AF"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </span>
            );

        case 'read':
            return (
                <span className={baseClass} title="已读">
                    <svg
                        width={size}
                        height={size}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* 第一个勾 - 蓝色 */}
                        <path
                            d="M1 8L4 11L9.5 5"
                            stroke="#3B82F6"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {/* 第二个勾 - 蓝色 */}
                        <path
                            d="M6 8L9 11L14.5 5"
                            stroke="#3B82F6"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </span>
            );

        case 'failed':
            return (
                <span className={`${baseClass} cursor-pointer`} title="发送失败，点击重试">
                    <svg
                        width={size}
                        height={size}
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* 圆形背景 */}
                        <circle cx="8" cy="8" r="7" fill="#EF4444" />
                        {/* 感叹号 */}
                        <path
                            d="M8 4V9"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                        <circle cx="8" cy="11.5" r="0.75" fill="white" />
                    </svg>
                </span>
            );

        default:
            return null;
    }
};

export default MessageStatusIcon;
