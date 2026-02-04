/**
 * AiMessageBubble 组件
 * AI 专用消息气泡，带有特殊的渐变边框和"AI"标识
 */
import React from 'react';
import './AiMessageBubble.css';

interface AiMessageBubbleProps {
    content: string;
    timestamp: string;
    isUser?: boolean;
    avatar?: string;
    username?: string;
    isThinking?: boolean;
}

export const AiMessageBubble: React.FC<AiMessageBubbleProps> = ({
    content,
    timestamp,
    isUser = false,
    avatar,
    username = 'Gemini AI',
    isThinking = false,
}) => {
    const formatTime = (ts: string) => {
        try {
            const date = new Date(ts);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    // AI 思考状态
    if (isThinking) {
        return (
            <div className="tg-ai-bubble tg-ai-bubble--ai">
                <div className="tg-ai-bubble__avatar">
                    <div className="tg-ai-bubble__avatar-inner">🤖</div>
                    <span className="tg-ai-bubble__ai-badge">AI</span>
                </div>
                <div className="tg-ai-bubble__content tg-ai-bubble__content--thinking">
                    <div className="tg-ai-thinking">
                        <div className="tg-ai-thinking__dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <span className="tg-ai-thinking__text">正在思考...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`tg-ai-bubble ${isUser ? 'tg-ai-bubble--user' : 'tg-ai-bubble--ai'}`}>
            {/* AI 头像 */}
            {!isUser && (
                <div className="tg-ai-bubble__avatar">
                    <div className="tg-ai-bubble__avatar-inner">🤖</div>
                    <span className="tg-ai-bubble__ai-badge">AI</span>
                </div>
            )}

            {/* 消息内容 */}
            <div className="tg-ai-bubble__wrapper">
                {!isUser && (
                    <div className="tg-ai-bubble__sender">{username}</div>
                )}
                <div className="tg-ai-bubble__content">
                    <div className="tg-ai-bubble__text">{content}</div>
                    <div className="tg-ai-bubble__time">{formatTime(timestamp)}</div>
                </div>
            </div>

            {/* 用户头像 */}
            {isUser && (
                <div className="tg-ai-bubble__avatar tg-ai-bubble__avatar--user">
                    {avatar ? (
                        <img src={avatar} alt="User" className="tg-ai-bubble__avatar-img" />
                    ) : (
                        <div className="tg-ai-bubble__avatar-inner tg-ai-bubble__avatar-inner--user">
                            {username?.[0]?.toUpperCase() || '👤'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AiMessageBubble;
