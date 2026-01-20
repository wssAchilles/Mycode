import React, { useState } from 'react';
import './Sidebar.css';

interface SidebarProps {
    children: React.ReactNode;
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    collapsible?: boolean;
    collapsed?: boolean;
    onCollapse?: (collapsed: boolean) => void;
    className?: string;
}

/**
 * 可折叠侧边栏组件
 * Telegram 风格侧边栏，支持拖拽调整宽度
 */
export const Sidebar: React.FC<SidebarProps> = ({
    children,
    width = 320,
    minWidth = 280,
    maxWidth = 420,
    collapsible = true,
    collapsed: controlledCollapsed,
    onCollapse,
    className = ''
}) => {
    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const [currentWidth, setCurrentWidth] = useState(width);
    const [isResizing, setIsResizing] = useState(false);

    const isCollapsed = controlledCollapsed ?? internalCollapsed;

    const handleCollapse = () => {
        const newState = !isCollapsed;
        if (onCollapse) {
            onCollapse(newState);
        } else {
            setInternalCollapsed(newState);
        }
    };

    // 拖拽调整宽度
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);

        const startX = e.clientX;
        const startWidth = currentWidth;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
            setCurrentWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <aside
            className={`tg-sidebar ${isCollapsed ? 'tg-sidebar--collapsed' : ''} ${className}`}
            style={{
                width: isCollapsed ? 72 : currentWidth,
                minWidth: isCollapsed ? 72 : minWidth
            }}
        >
            {/* 侧边栏内容 */}
            <div className="tg-sidebar__content">
                {children}
            </div>

            {/* 折叠按钮 */}
            {collapsible && (
                <button
                    className="tg-sidebar__toggle"
                    onClick={handleCollapse}
                    aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform var(--anim-normal) var(--ease-out)'
                        }}
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
            )}

            {/* 拖拽调整宽度的手柄 */}
            {!isCollapsed && (
                <div
                    className={`tg-sidebar__resize-handle ${isResizing ? 'tg-sidebar__resize-handle--active' : ''}`}
                    onMouseDown={handleMouseDown}
                />
            )}
        </aside>
    );
};

export default Sidebar;
