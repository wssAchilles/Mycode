import React from 'react';
import './AiSuggestionChips.css';

interface Suggestion {
    id: string;
    text: string;
    icon?: string;
}

interface AiSuggestionChipsProps {
    suggestions?: Suggestion[];
    onSelect?: (suggestion: Suggestion) => void;
    loading?: boolean;
    className?: string;
}

// 默认建议列表
const defaultSuggestions: Suggestion[] = [
    { id: '1', text: '帮我总结最近的通知', icon: '🔔' },
    { id: '2', text: '最近有哪些值得看的动态', icon: '🧭' },
    { id: '3', text: '把今天的新闻压缩成三条', icon: '📰' },
    { id: '4', text: '我现在应该先处理什么', icon: '✅' },
];

/**
 * AI 快捷建议标签组件
 * 预设问题标签，点击后快速发送
 */
export const AiSuggestionChips: React.FC<AiSuggestionChipsProps> = ({
    suggestions = defaultSuggestions,
    onSelect,
    loading = false,
    className = ''
}) => {
    if (loading) {
        return (
            <div className={`tg-ai-chips tg-ai-chips--loading ${className}`}>
                {[1, 2, 3].map((i) => (
                    <div key={i} className="tg-ai-chips__skeleton skeleton" />
                ))}
            </div>
        );
    }

    return (
        <div className={`tg-ai-chips ${className}`}>
            <div className="tg-ai-chips__label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                快速提问
            </div>

            <div className="tg-ai-chips__list">
                {suggestions.map((suggestion) => (
                    <button
                        key={suggestion.id}
                        className="tg-ai-chips__chip"
                        onClick={() => onSelect?.(suggestion)}
                        type="button"
                    >
                        {suggestion.icon && (
                            <span className="tg-ai-chips__icon">{suggestion.icon}</span>
                        )}
                        <span className="tg-ai-chips__text">{suggestion.text}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default AiSuggestionChips;
