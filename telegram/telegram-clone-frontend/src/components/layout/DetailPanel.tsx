import React, { useState } from 'react';
import './DetailPanel.css';

interface DetailPanelProps {
    children: React.ReactNode;
    title?: string;
    isOpen?: boolean;
    onClose?: () => void;
    width?: number;
    className?: string;
}

/**
 * 右侧详情面板组件
 * 显示用户信息、媒体文件、共享链接等
 */
export const DetailPanel: React.FC<DetailPanelProps> = ({
    children,
    title = '详情',
    isOpen = false,
    onClose,
    width = 320,
    className = ''
}) => {
    return (
        <>
            {/* 背景遮罩 - 仅移动端 */}
            {isOpen && (
                <div
                    className="tg-detail-panel__backdrop"
                    onClick={onClose}
                />
            )}

            <aside
                className={`tg-detail-panel ${isOpen ? 'tg-detail-panel--open' : ''} ${className}`}
                style={{ width }}
            >
                {/* 面板头部 */}
                <header className="tg-detail-panel__header">
                    <h3 className="tg-detail-panel__title">{title}</h3>
                    {onClose && (
                        <button
                            className="tg-detail-panel__close"
                            onClick={onClose}
                            aria-label="关闭详情面板"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </header>

                {/* 面板内容 */}
                <div className="tg-detail-panel__content">
                    {children}
                </div>
            </aside>
        </>
    );
};

/**
 * 详情面板分组组件
 */
interface DetailSectionProps {
    title: string;
    children: React.ReactNode;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

export const DetailSection: React.FC<DetailSectionProps> = ({
    title,
    children,
    collapsible = false,
    defaultCollapsed = false
}) => {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

    return (
        <section className={`tg-detail-section ${isCollapsed ? 'tg-detail-section--collapsed' : ''}`}>
            <header
                className="tg-detail-section__header"
                onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
                style={{ cursor: collapsible ? 'pointer' : 'default' }}
            >
                <span className="tg-detail-section__title">{title}</span>
                {collapsible && (
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="tg-detail-section__arrow"
                        style={{
                            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
                        }}
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                )}
            </header>
            {!isCollapsed && (
                <div className="tg-detail-section__content">
                    {children}
                </div>
            )}
        </section>
    );
};

export default DetailPanel;
