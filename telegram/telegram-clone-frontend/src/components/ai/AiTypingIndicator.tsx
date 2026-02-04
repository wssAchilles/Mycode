/**
 * AiTypingIndicator 组件
 * AI 专属思考动画，比普通 TypingIndicator 更具科技感
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
        <div className={`tg-ai-typing ${className}`}>
            <div className="tg-ai-typing__avatar">
                <div className="tg-ai-typing__avatar-inner">🤖</div>
                <div className="tg-ai-typing__pulse-ring"></div>
            </div>

            <div className="tg-ai-typing__content">
                <div className="tg-ai-typing__wave">
                    <span></span>
                    <span></span>
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
