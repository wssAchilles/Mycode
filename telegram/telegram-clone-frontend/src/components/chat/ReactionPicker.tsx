/**
 * ReactionPicker 组件
 * 消息表情回复选择器（点赞、爱心等）
 */
import React, { useState, useRef, useEffect } from 'react';
import './ReactionPicker.css';

// 常用表情反应列表
const QUICK_REACTIONS = [
    { emoji: '👍', label: '点赞' },
    { emoji: '❤️', label: '爱心' },
    { emoji: '😂', label: '大笑' },
    { emoji: '😮', label: '惊讶' },
    { emoji: '😢', label: '伤心' },
    { emoji: '🙏', label: '祈祷' },
];

// 扩展表情列表
const EXTENDED_REACTIONS = [
    '😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉',
    '😊', '😋', '😍', '🥰', '😘', '😗', '😙', '😚',
    '🔥', '⭐', '✨', '🎉', '🎈', '💯', '👏', '🤝',
    '👌', '✌️', '🤞', '🤟', '🤘', '👊', '✊', '🤛',
];

interface Reaction {
    emoji: string;
    count: number;
    users: string[];
    hasReacted: boolean;
}

interface ReactionPickerProps {
    messageId: string;
    reactions?: Reaction[];
    onReact: (messageId: string, emoji: string) => void;
    onRemoveReaction?: (messageId: string, emoji: string) => void;
    position?: 'top' | 'bottom';
    disabled?: boolean;
}

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
    messageId,
    reactions = [],
    onReact,
    onRemoveReaction,
    position = 'top',
    disabled = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showExtended, setShowExtended] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setShowExtended(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // 处理反应点击
    const handleReactionClick = (emoji: string) => {
        const existingReaction = reactions.find(r => r.emoji === emoji);

        if (existingReaction?.hasReacted && onRemoveReaction) {
            onRemoveReaction(messageId, emoji);
        } else {
            onReact(messageId, emoji);
        }

        setIsOpen(false);
        setShowExtended(false);
    };

    // 渲染已有反应
    const renderExistingReactions = () => {
        if (reactions.length === 0) return null;

        return (
            <div className="tg-reactions__existing">
                {reactions.map((reaction) => (
                    <button
                        key={reaction.emoji}
                        className={`tg-reactions__badge ${reaction.hasReacted ? 'tg-reactions__badge--active' : ''}`}
                        onClick={() => handleReactionClick(reaction.emoji)}
                        title={reaction.users.join(', ')}
                        disabled={disabled}
                    >
                        <span className="tg-reactions__badge-emoji">{reaction.emoji}</span>
                        <span className="tg-reactions__badge-count">{reaction.count}</span>
                    </button>
                ))}
            </div>
        );
    };

    return (
        <div className="tg-reactions" ref={pickerRef}>
            {/* 已有反应 */}
            {renderExistingReactions()}

            {/* 添加反应按钮 */}
            <button
                className="tg-reactions__add-btn"
                onClick={() => setIsOpen(!isOpen)}
                disabled={disabled}
                title="添加表情回复"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
            </button>

            {/* 反应选择器弹窗 */}
            {isOpen && (
                <div className={`tg-reactions__picker tg-reactions__picker--${position}`}>
                    {/* 快速反应 */}
                    <div className="tg-reactions__quick">
                        {QUICK_REACTIONS.map((reaction) => (
                            <button
                                key={reaction.emoji}
                                className="tg-reactions__quick-item"
                                onClick={() => handleReactionClick(reaction.emoji)}
                                title={reaction.label}
                            >
                                {reaction.emoji}
                            </button>
                        ))}
                        <button
                            className="tg-reactions__expand-btn"
                            onClick={() => setShowExtended(!showExtended)}
                            title="更多表情"
                        >
                            {showExtended ? '−' : '+'}
                        </button>
                    </div>

                    {/* 扩展表情 */}
                    {showExtended && (
                        <div className="tg-reactions__extended">
                            {EXTENDED_REACTIONS.map((emoji, index) => (
                                <button
                                    key={index}
                                    className="tg-reactions__extended-item"
                                    onClick={() => handleReactionClick(emoji)}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReactionPicker;
