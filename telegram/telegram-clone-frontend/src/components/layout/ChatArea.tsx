import React from 'react';
import './ChatArea.css';

interface ChatAreaProps {
    children: React.ReactNode;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    showEmptyState?: boolean;
    emptyStateIcon?: React.ReactNode;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
}

/**
 * 聊天区域容器组件
 * 包含头部、消息列表区、底部输入区的布局容器
 */
export const ChatArea: React.FC<ChatAreaProps> = ({
    children,
    header,
    footer,
    className = '',
    showEmptyState = false,
    emptyStateIcon,
    emptyStateTitle = '选择一个联系人开始聊天',
    emptyStateDescription = '或者点击左侧添加新的联系人'
}) => {
    return (
        <main className={`tg-chat-area ${className}`}>
            {/* 聊天头部 */}
            {header && (
                <header className="tg-chat-area__header">
                    {header}
                </header>
            )}

            {/* 消息区域 */}
            <div className="tg-chat-area__messages">
                {showEmptyState ? (
                    <div className="tg-chat-area__empty">
                        <div className="tg-chat-area__empty-icon">
                            {emptyStateIcon || (
                                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                            )}
                        </div>
                        <h3 className="tg-chat-area__empty-title">{emptyStateTitle}</h3>
                        <p className="tg-chat-area__empty-desc">{emptyStateDescription}</p>
                    </div>
                ) : (
                    children
                )}
            </div>

            {/* 输入区域 */}
            {footer && !showEmptyState && (
                <footer className="tg-chat-area__footer">
                    {footer}
                </footer>
            )}
        </main>
    );
};

export default ChatArea;
