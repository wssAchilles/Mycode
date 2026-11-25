import React from 'react';
import { Copy, MoreHorizontal, Reply, RotateCw } from 'lucide-react';
import { MessageBubble, ProgressiveImage } from '../../../../components/common';
import type { MessageReplyPreview } from '../../../../components/common/MessageBubble';
import type { Message } from '../../../../types/chat';
import { formatMessageTimestamp } from '../../../../utils/dateTime';
import { ChatAttachmentCard } from '../media/ChatAttachmentCard';
import { computeMessageRowMeta, isRichAttachmentMessage } from './messageGrouping';

export type HighlightConfig = { termLower: string; regex: RegExp } | null;
export type SenderMeta = { senderName?: string; senderAvatarUrl?: string };

export interface ImagePreviewPayload {
  src: string;
  fileName?: string;
}

interface MessageBubbleRowProps {
  message: Message;
  previousMessage?: Message | null;
  currentUserId: string;
  useProgressiveImage?: boolean;
  highlightConfig: HighlightConfig;
  highlightSeq?: number;
  isFlashed?: boolean;
  showGroupSenderMeta: boolean;
  resolveSenderMeta: (msg: Message) => SenderMeta;
  resolveReplyTarget?: (replyToId: string) => Message | undefined;
  onJumpToMessage?: (messageId: string) => void;
  onPreviewImage?: (payload: ImagePreviewPayload) => void;
  onCopyMessage?: (msg: Message) => void;
  onReplyMessage?: (msg: Message) => void;
  onRetryMessage?: (msg: Message) => void;
  onOpenContextMenu?: (msg: Message, isOut: boolean, x: number, y: number) => void;
  enableActions?: boolean;
}

/**
 * 渲染被引用消息的简短摘要文本
 */
function summarizeReplyTarget(target?: Message): string {
  if (!target) return '引用的消息（点击定位）';
  if (target.type === 'image') return target.content || '[图片]';
  if (target.type === 'video') return target.fileName ? `[视频] ${target.fileName}` : '[视频]';
  if (target.type === 'audio') return target.fileName ? `[语音/音频] ${target.fileName}` : '[语音/音频]';
  if (target.type === 'file' || target.type === 'document') {
    return target.fileName ? `[文件] ${target.fileName}` : '[文件]';
  }
  return target.content || '[消息]';
}

/**
 * 单条消息行渲染组件：统一承载 Store 模式与搜索结果列表的视图渲染
 */
export const MessageBubbleRow: React.FC<MessageBubbleRowProps> = React.memo(
  ({
    message,
    previousMessage,
    currentUserId,
    useProgressiveImage = false,
    highlightConfig,
    highlightSeq,
    isFlashed = false,
    showGroupSenderMeta,
    resolveSenderMeta,
    resolveReplyTarget,
    onJumpToMessage,
    onPreviewImage,
    onCopyMessage,
    onReplyMessage,
    onRetryMessage,
    onOpenContextMenu,
    enableActions = false,
  }) => {
    const isOut = message.userId === currentUserId || message.senderId === currentUserId;
    const attachment = message.attachments?.[0];
    const fileUrl = message.fileUrl || attachment?.fileUrl;
    const isMedia = message.type === 'image' && Boolean(fileUrl);
    const isRichAttachment = !isMedia && isRichAttachmentMessage(message);
    const isHighlighted = isFlashed || (typeof highlightSeq === 'number' && message.seq === highlightSeq);

    const { dateDividerLabel, collapseGroupSenderMeta } = computeMessageRowMeta(
      message,
      previousMessage,
    );
    const shouldShowSenderMeta = showGroupSenderMeta && !isOut && !collapseGroupSenderMeta;
    const senderMeta = shouldShowSenderMeta ? resolveSenderMeta(message) : {};
    const time = formatMessageTimestamp(message.timestamp);

    // 构造引用预览数据
    let replyPreview: MessageReplyPreview | undefined;
    if (message.replyTo) {
      const targetMsg = resolveReplyTarget?.(message.replyTo);
      const targetIsOut = targetMsg
        ? targetMsg.userId === currentUserId || targetMsg.senderId === currentUserId
        : false;
      const targetSenderName = targetMsg
        ? targetIsOut
          ? '我'
          : resolveSenderMeta(targetMsg).senderName || '联系人'
        : '引用消息';

      replyPreview = {
        senderName: targetSenderName,
        text: summarizeReplyTarget(targetMsg),
        onClick: onJumpToMessage ? () => onJumpToMessage(message.replyTo!) : undefined,
      };
    }

    const renderTextContent = () => {
      if (!highlightConfig || !message.content) return message.content;
      return message.content.split(highlightConfig.regex).map((part, index) => {
        const isMatch = part.toLowerCase() === highlightConfig.termLower;
        return isMatch ? (
          <mark key={`${message.id}-mark-${index}`} className="tg-highlight">
            {part}
          </mark>
        ) : (
          <span key={`${message.id}-text-${index}`}>{part}</span>
        );
      });
    };

    const renderContent = () => {
      if (isMedia && fileUrl) {
        const hasCaption =
          Boolean(message.content)
          && !message.content.startsWith('[图片]')
          && message.content !== message.fileName;

        return (
          <>
            <button
              type="button"
              className="chat-history__media-btn"
              aria-label="点击查看大图"
              onClick={(event) => {
                event.stopPropagation();
                onPreviewImage?.({
                  src: fileUrl,
                  fileName: message.fileName || attachment?.fileName,
                });
              }}
            >
              {useProgressiveImage ? (
                <ProgressiveImage
                  src={fileUrl}
                  thumbnailSrc={message.thumbnailUrl || attachment?.thumbnailUrl}
                  alt={message.fileName || '图片'}
                  className="chat-history__media"
                />
              ) : (
                <img
                  src={fileUrl}
                  alt={message.fileName || '图片'}
                  className="chat-history__media"
                  loading="lazy"
                  decoding="async"
                />
              )}
            </button>
            {hasCaption && <div className="chat-history__media-caption">{renderTextContent()}</div>}
          </>
        );
      }

      if (isRichAttachment) {
        return <ChatAttachmentCard message={message} />;
      }

      return renderTextContent();
    };

    const canCopy = Boolean(message.content && message.content.trim());
    const canRetry = isOut && message.status === 'failed' && Boolean(onRetryMessage);

    return (
      <>
        {dateDividerLabel && (
          <div className="chat-history__date-divider" role="separator" aria-label={dateDividerLabel}>
            <span>{dateDividerLabel}</span>
          </div>
        )}

        <div
          className={`chat-history__row ${isOut ? 'is-out' : 'is-in'} ${
            collapseGroupSenderMeta ? 'is-collapsed-sender' : ''
          }`}
          onContextMenu={(event) => {
            if (!enableActions || !onOpenContextMenu) return;
            event.preventDefault();
            onOpenContextMenu(message, isOut, event.clientX, event.clientY);
          }}
        >
          <MessageBubble
            isOut={isOut}
            time={time}
            isEdited={Boolean(message.editedAt)}
            status={message.status}
            isRead={message.status === 'read'}
            isSent={message.status !== 'failed' && message.status !== 'pending'}
            isFailed={message.status === 'failed'}
            readCount={message.readCount}
            withTail={!collapseGroupSenderMeta}
            isMedia={isMedia}
            showSenderMeta={shouldShowSenderMeta}
            senderName={senderMeta.senderName}
            senderAvatarUrl={senderMeta.senderAvatarUrl}
            attentionKey={isHighlighted ? `${message.id}-${highlightSeq ?? 'flash'}` : undefined}
            className={isHighlighted ? 'is-highlighted' : ''}
            replyPreview={replyPreview}
          >
            {renderContent()}
          </MessageBubble>

          {canRetry && (
            <button
              type="button"
              className="chat-history__retry-pill"
              onClick={(event) => {
                event.stopPropagation();
                onRetryMessage?.(message);
              }}
              title="重新发送该消息"
            >
              <RotateCw size={12} />
              <span>重发</span>
            </button>
          )}

          {enableActions && !canRetry && (
            <div className="chat-history__hover-actions" aria-label="快捷消息操作">
              {onReplyMessage && (
                <button
                  type="button"
                  className="chat-history__hover-btn"
                  title="引用回复"
                  aria-label="引用回复"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReplyMessage(message);
                  }}
                >
                  <Reply size={13} />
                </button>
              )}
              {canCopy && onCopyMessage && (
                <button
                  type="button"
                  className="chat-history__hover-btn"
                  title="复制文字"
                  aria-label="复制文字"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopyMessage(message);
                  }}
                >
                  <Copy size={13} />
                </button>
              )}
              {onOpenContextMenu && (
                <button
                  type="button"
                  className="chat-history__hover-btn"
                  title="更多操作"
                  aria-label="更多操作"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onOpenContextMenu(message, isOut, rect.left, rect.bottom + 4);
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </>
    );
  },
);
