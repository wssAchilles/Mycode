/**
 * AiMessageBubble 组件
 * AI 专用消息气泡，支持 Markdown 代码块高对比展示与一键复制工具栏
 */
import React, { useState } from 'react';
import { formatMessageTimestamp } from '../../utils/dateTime';
import './AiMessageBubble.css';

interface AiMessageBubbleProps {
    content: string;
    timestamp: string;
    isUser?: boolean;
    avatar?: string;
    username?: string;
    isThinking?: boolean;
}

// 解析行内反引号代码片段
const renderInlineCode = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts = text.split(/(`[^`\n]+`)/g);
    return parts.map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            return (
                <code key={`${keyPrefix}-ic-${idx}`} className="tg-ai-bubble__inline-code">
                    {part.slice(1, -1)}
                </code>
            );
        }
        return <React.Fragment key={`${keyPrefix}-tx-${idx}`}>{part}</React.Fragment>;
    });
};

export const AiMessageBubble: React.FC<AiMessageBubbleProps> = ({
    content,
    timestamp,
    isUser = false,
    avatar,
    username = 'Gemini AI',
    isThinking = false,
}) => {
    const [copied, setCopied] = useState(false);

    const formatTime = (ts: string) => {
        return formatMessageTimestamp(ts);
    };

    const handleCopy = async (textToCopy: string) => {
        try {
            await navigator.clipboard?.writeText(textToCopy);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            // 剪贴板不可用时静默降级
        }
    };

    // 解析三反引号代码块与行内代码
    const renderContent = (raw: string) => {
        if (!raw.includes('`')) {
            return raw;
        }
        const segments = raw.split(/(```[\s\S]*?```)/g);
        return segments.map((segment, index) => {
            if (segment.startsWith('```') && segment.endsWith('```')) {
                const inner = segment.slice(3, -3);
                const firstNewline = inner.indexOf('\n');
                const lang = firstNewline > -1 ? inner.slice(0, firstNewline).trim() : '';
                const codeBody = firstNewline > -1 ? inner.slice(firstNewline + 1) : inner;
                return (
                    <div key={`cb-${index}`} className="tg-ai-bubble__code-wrap">
                        <div className="tg-ai-bubble__code-header">
                            <span>{lang || 'code'}</span>
                            <button
                                type="button"
                                className="tg-ai-bubble__action-btn"
                                onClick={() => void handleCopy(codeBody)}
                                aria-label="复制代码"
                            >
                                复制代码
                            </button>
                        </div>
                        <pre className="tg-ai-bubble__code-block">
                            <code>{codeBody}</code>
                        </pre>
                    </div>
                );
            }
            return (
                <React.Fragment key={`seg-${index}`}>
                    {renderInlineCode(segment, `seg-${index}`)}
                </React.Fragment>
            );
        });
    };

    const aiAvatarIcon = (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
            <circle cx="12" cy="5" r="2"></circle>
            <path d="M12 7v4"></path>
            <line x1="8" y1="16" x2="8.01" y2="16"></line>
            <line x1="16" y1="16" x2="16.01" y2="16"></line>
        </svg>
    );

    // AI 思考状态
    if (isThinking) {
        return (
            <div className="tg-ai-bubble tg-ai-bubble--ai" role="status" aria-live="polite">
                <div className="tg-ai-bubble__avatar" aria-hidden="true">
                    <div className="tg-ai-bubble__avatar-inner">{aiAvatarIcon}</div>
                    <span className="tg-ai-bubble__ai-badge">AI</span>
                </div>
                <div className="tg-ai-bubble__content tg-ai-bubble__content--thinking">
                    <div className="tg-ai-thinking">
                        <div className="tg-ai-thinking__dots" aria-hidden="true">
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
                <div className="tg-ai-bubble__avatar" aria-hidden="true">
                    <div className="tg-ai-bubble__avatar-inner">{aiAvatarIcon}</div>
                    <span className="tg-ai-bubble__ai-badge">AI</span>
                </div>
            )}

            {/* 消息主体 */}
            <div className="tg-ai-bubble__wrapper">
                {!isUser && (
                    <div className="tg-ai-bubble__sender">{username}</div>
                )}
                <div className="tg-ai-bubble__content">
                    <div className="tg-ai-bubble__text">{renderContent(content)}</div>
                    <div className="tg-ai-bubble__footer">
                        {!isUser && content && (
                            <button
                                type="button"
                                className="tg-ai-bubble__action-btn"
                                onClick={() => void handleCopy(content)}
                                title="复制回复"
                                aria-label="复制回复"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                <span>{copied ? '已复制' : '复制'}</span>
                            </button>
                        )}
                        <div className="tg-ai-bubble__time">{formatTime(timestamp)}</div>
                    </div>
                </div>
            </div>

            {/* 用户头像 */}
            {isUser && (
                <div className="tg-ai-bubble__avatar tg-ai-bubble__avatar--user">
                    {avatar ? (
                        <img src={avatar} alt="User" className="tg-ai-bubble__avatar-img" />
                    ) : (
                        <div className="tg-ai-bubble__avatar-inner tg-ai-bubble__avatar-inner--user">
                            {username?.[0]?.toUpperCase() || '我'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AiMessageBubble;
