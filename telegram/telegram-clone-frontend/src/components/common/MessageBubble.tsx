import React from 'react';
import './MessageBubble.css';

export interface MessageBubbleProps {
    isOut?: boolean; // True if sent by me
    children: React.ReactNode;
    time?: string;
    isRead?: boolean; // For double tick
    isSent?: boolean; // For single tick (if false => clock or error)
    withTail?: boolean; // Should show the tail?
    className?: string;
    isMedia?: boolean; // [NEW] Is this a media/image bubble?
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
    isOut = false,
    children,
    time,
    isRead = false,
    isSent = true,
    withTail = true,
    className = '',
    isMedia = false,
}) => {
    return (
        <div className={`tg-message-bubble ${isOut ? 'is-out' : 'is-in'} ${withTail ? 'has-tail' : ''} ${isMedia ? 'is-media' : ''} ${className}`}>
            <div className="tg-message-content">
                {children}

                <div className={`tg-message-meta ${isMedia ? 'is-media-meta' : ''}`}>
                    <span className="tg-message-time">{time}</span>
                    {isOut && (
                        <span className={`tg-message-status ${isRead ? 'is-read' : ''}`}>
                            {isRead ? (
                                <svg viewBox="0 0 18 10" width="16" height="10" className="icon-read">
                                    <path d="M4.8 9.2L0.5 4.9L1.9 3.5L4.8 6.4L11.9 0.5L13.3 1.9L4.8 9.2Z M12.8 9.2L8.5 4.9L9.9 3.5L12.8 6.4L16.2 3.5L17.6 4.9L12.8 9.2Z" fill="currentColor" />
                                </svg>
                            ) : isSent ? (
                                <svg viewBox="0 0 12 10" width="11" height="9" className="icon-sent">
                                    <path d="M4.8 9.2L0.5 4.9L1.9 3.5L4.8 6.4L10.5 0.7L11.9 2.1L4.8 9.2Z" fill="currentColor" />
                                </svg>
                            ) : (
                                <span className="icon-pending">🕒</span>
                            )}
                        </span>
                    )}
                </div>
            </div>

            {withTail && (
                <svg className="tg-message-tail" width="9" height="20" viewBox="0 0 9 20" xmlns="http://www.w3.org/2000/svg">
                    {isOut ? (
                        <path d="M0,0 C1.04936081,0 4.14188059,0.306001275 6.00767232,0.92787075 C9.88371286,2.21997233 8.35824963,7.91039804 7.64917409,10.5562719 C7.2797672,11.934887 6.27532354,16.5921867 5.0747472,18.0673322 C4.58287711,18.671694 2.8290325,19.3496032 0,20 L0,0 Z" fillRule="evenodd" />
                    ) : (
                        <path d="M9,0 C7.95063919,0 4.85811941,0.306001275 2.99232768,0.92787075 C-0.883712864,2.21997233 0.641750371,7.91039804 1.35082591,10.5562719 C1.7202328,11.934887 2.72467646,16.5921867 3.9252528,18.0673322 C4.41712289,18.671694 6.1709675,19.3496032 9,20 L9,0 Z" fillRule="evenodd" />
                    )}
                </svg>
            )}
        </div>
    );
};

export default React.memo(MessageBubble);
