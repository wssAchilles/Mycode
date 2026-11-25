import React, { useEffect, useMemo, useState } from 'react';
import { motionDurations, useAnimeScope, waapi } from '../../core/animation';
import { resolveMediaCrossOrigin, withApiBase } from '../../utils/apiUrl';
import { isAvatarUrlLoaded, markAvatarUrlLoaded, resolveAvatarUrl } from '../../utils/media';
import './MessageBubble.css';

export interface MessageReplyPreview {
    senderName: string;
    text: string;
    onClick?: () => void;
}

export interface MessageBubbleProps {
    isOut?: boolean; // 是否为我方发出消息
    children: React.ReactNode;
    time?: string;
    isEdited?: boolean; // 消息是否被编辑过
    status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    isRead?: boolean; // 双勾已读
    isSent?: boolean; // 单勾已送达（为 false 时显示时钟发送中）
    isFailed?: boolean; // 发送失败告警态
    withTail?: boolean; // 是否显示气泡尾角
    className?: string;
    isMedia?: boolean; // 是否为媒体/图片气泡
    readCount?: number; // 群聊已读人数
    showSenderMeta?: boolean; // 群聊中显示发言人信息（仅接收方）
    senderName?: string;
    senderAvatarUrl?: string;
    attentionKey?: string | number;
    replyPreview?: MessageReplyPreview; // 引用消息预览条
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
    isOut = false,
    children,
    time,
    isEdited = false,
    status,
    isRead = false,
    isSent = true,
    isFailed = false,
    withTail = true,
    className = '',
    isMedia = false,
    readCount,
    showSenderMeta = false,
    senderName,
    senderAvatarUrl,
    attentionKey,
    replyPreview,
}) => {
    const resolvedStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' = isFailed || status === 'failed'
        ? 'failed'
        : status ?? (isRead ? 'read' : isSent ? 'delivered' : 'pending');
    const resolvedIsRead = resolvedStatus === 'read';
    const resolvedIsFailed = resolvedStatus === 'failed';
    const resolvedIsSent = resolvedStatus === 'sent' || resolvedStatus === 'delivered';
    const statusLabel = resolvedIsRead
        ? '已读'
        : resolvedIsFailed
            ? '发送失败'
            : resolvedIsSent
                ? '已送达'
                : '发送中';
    const showIncomingMeta = !isOut && showSenderMeta;
    const hasReadCountBadge = isOut && !resolvedIsFailed && resolvedStatus !== 'pending' && typeof readCount === 'number' && readCount > 0;
    const senderInitial = (senderName || '?').trim().charAt(0).toUpperCase() || '?';

    const primaryAvatarSrc = useMemo(() => resolveAvatarUrl(senderAvatarUrl, 32), [senderAvatarUrl]);
    const fallbackAvatarSrc = useMemo(() => withApiBase(senderAvatarUrl) ?? undefined, [senderAvatarUrl]);
    const [useFallbackAvatar, setUseFallbackAvatar] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const [avatarLoaded, setAvatarLoaded] = useState(false);

    useEffect(() => {
        setUseFallbackAvatar(false);
        setAvatarFailed(false);
        setAvatarLoaded(false);
    }, [primaryAvatarSrc]);

    const activeAvatarSrc = useFallbackAvatar ? fallbackAvatarSrc : primaryAvatarSrc;
    const isAvatarCached = Boolean(activeAvatarSrc && isAvatarUrlLoaded(activeAvatarSrc));
    const effectiveAvatarLoaded = avatarLoaded || isAvatarCached;
    const showAvatarImg = Boolean(activeAvatarSrc && !avatarFailed);
    const bubbleMotion = useAnimeScope<HTMLDivElement, { attention: () => void }>(
        ({ root, reducedMotion, duration }) => ({
            attention: () => {
                if (reducedMotion || !root) return;
                waapi.animate(root, {
                    scale: [1, 1.018, 1],
                    boxShadow: [
                        '0 0 0 0 rgba(16, 185, 129, 0)',
                        '0 0 0 2px rgba(16, 185, 129, 0.35)',
                        '0 0 0 0 rgba(16, 185, 129, 0)',
                    ],
                    duration: duration(motionDurations.slow),
                    ease: 'out(4)',
                });
            },
        }),
        [],
    );

    useEffect(() => {
        if (attentionKey !== undefined) {
            bubbleMotion.run('attention');
        }
    }, [attentionKey, bubbleMotion]);

    return (
        <div className={`tg-message-row ${isOut ? 'is-out' : 'is-in'} ${showIncomingMeta ? 'has-sender-meta' : ''} ${hasReadCountBadge ? 'has-readcount' : ''} ${isMedia ? 'is-media-row' : ''}`}>
            {showIncomingMeta && (
                <div className="tg-message-avatar" aria-hidden="true">
                    {(!showAvatarImg || !effectiveAvatarLoaded) && <span>{senderInitial}</span>}
                    {showAvatarImg && activeAvatarSrc && (
                        <img
                            src={activeAvatarSrc}
                            alt=""
                            crossOrigin={resolveMediaCrossOrigin(activeAvatarSrc)}
                            className={effectiveAvatarLoaded ? 'is-loaded' : ''}
                            loading="eager"
                            decoding="async"
                            onLoad={() => {
                                markAvatarUrlLoaded(activeAvatarSrc);
                                setAvatarLoaded(true);
                            }}
                            onError={() => {
                                if (!useFallbackAvatar && fallbackAvatarSrc && fallbackAvatarSrc !== primaryAvatarSrc) {
                                    setUseFallbackAvatar(true);
                                    setAvatarLoaded(false);
                                    return;
                                }
                                setAvatarFailed(true);
                            }}
                        />
                    )}
                </div>
            )}

            <div
                ref={bubbleMotion.rootRef}
                className={`tg-message-bubble ${isOut ? 'is-out' : 'is-in'} ${withTail ? 'has-tail' : ''} ${isMedia ? 'is-media' : ''} ${hasReadCountBadge ? 'has-readcount' : ''} ${className}`}
            >
                <div className="tg-message-content">
                    {showIncomingMeta && senderName && (
                        <div className="tg-message-sender">{senderName}</div>
                    )}
                    {replyPreview && (
                        <button
                            type="button"
                            className="tg-message-reply"
                            onClick={(event) => {
                                event.stopPropagation();
                                replyPreview.onClick?.();
                            }}
                            title="点击定位到被引用消息"
                        >
                            <span className="tg-message-reply__sender">{replyPreview.senderName}</span>
                            <span className="tg-message-reply__text">{replyPreview.text}</span>
                        </button>
                    )}
                    {children}

                    <div className={`tg-message-meta ${isMedia ? 'is-media-meta' : ''}`}>
                        {isEdited && <span className="tg-message-edited">已编辑</span>}
                        <span className="tg-message-time">{time}</span>
                        {isOut && (
                            <span
                                className={`tg-message-status ${resolvedIsRead ? 'is-read' : ''} ${resolvedIsFailed ? 'is-failed' : ''}`.trim()}
                                role="img"
                                aria-label={statusLabel}
                                title={statusLabel}
                                data-status={resolvedStatus}
                            >
                                {resolvedIsRead ? (
                                    <svg viewBox="0 0 20 12" width="17" height="11" className="icon-read" aria-hidden="true">
                                        <path
                                            d="M1.8 6.6L5.1 9.8L12.2 2.2M7.6 6.6L10.9 9.8L18.1 2.2"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.75"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                ) : resolvedIsFailed ? (
                                    <svg viewBox="0 0 16 16" width="13" height="13" className="icon-failed" aria-hidden="true">
                                        <circle cx="8" cy="8" r="6.75" fill="#FF3B30" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
                                        <path d="M8 4.2V8.6" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
                                        <circle cx="8" cy="11.3" r="0.95" fill="#FFFFFF" />
                                    </svg>
                                ) : resolvedIsSent ? (
                                    <svg viewBox="0 0 14 12" width="12" height="11" className="icon-sent" aria-hidden="true">
                                        <path
                                            d="M2.1 6.6L5.4 9.8L12.3 2.2"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.75"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 16 16" width="12" height="12" className="icon-pending" aria-hidden="true">
                                        <path
                                            d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A6.5 6.5 0 0 0 8 1.5Zm.75 3.25a.75.75 0 0 0-1.5 0v3.8c0 .2.08.39.22.53l2.22 2.22a.75.75 0 1 0 1.06-1.06L8.75 8.2Z"
                                            fill="currentColor"
                                        />
                                    </svg>
                                )}
                            </span>
                        )}
                    </div>
                </div>

                {hasReadCountBadge && (
                    <span className="tg-message-readcount-badge">已读 {readCount}</span>
                )}

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
        </div>
    );
};

export default React.memo(MessageBubble);
