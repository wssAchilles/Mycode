/**
 * AiTypingIndicator 组件
 * AI 思考中淡色柔和胶囊圆点指示器
 */
import React from 'react';
import './AiTypingIndicator.css';

interface AiTypingIndicatorProps {
    className?: string;
    message?: string;
}

export const AiTypingIndicator: React.FC<AiTypingIndicatorProps> = ({
    className = '',
    message = 'AI 正在思考',
}) => {
    return (
        <div className={`tg-ai-typing ${className}`} role="status" aria-live="polite">
            <div className="tg-ai-typing__avatar" aria-hidden="true">
                <div className="tg-ai-typing__avatar-inner">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                        <circle cx="12" cy="5" r="2"></circle>
                        <path d="M12 7v4"></path>
                        <line x1="8" y1="16" x2="8.01" y2="16"></line>
                        <line x1="16" y1="16" x2="16.01" y2="16"></line>
                    </svg>
                </div>
            </div>

            <div className="tg-ai-typing__content">
                <div className="tg-ai-typing__dots" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <span className="tg-ai-typing__text">{message}</span>
            </div>
        </div>
    );
};

export default AiTypingIndicator;
