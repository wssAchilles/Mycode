import React, { useState } from 'react';
import { Check, Copy, MoreHorizontal, Reply, RotateCw, SmilePlus } from 'lucide-react';
import { MessageBubble, ProgressiveImage } from '../../../../components/common';
import type { MessageReplyPreview } from '../../../../components/common/MessageBubble';
import type { Message } from '../../../../types/chat';
import { formatMessageTimestamp } from '../../../../utils/dateTime';
import { ChatAttachmentCard } from '../media/ChatAttachmentCard';
import { computeMessageRowMeta, isRichAttachmentMessage } from './messageGrouping';
import { renderChatRichText, type HighlightConfig } from './richTextRender';

export type { HighlightConfig };
export type SenderMeta = { senderName?: string; senderAvatarUrl?: string };

export interface ImagePreviewPayload {
  messageId?: string;
  src: string;
  fileName?: string;
}

const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '👀'];

interface MessageBubbleRowProps {
  message: Message;
  previousMessage?: Message | null;
  currentUserId: string;
  currentUsername?: string;
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
  onToggleReaction?: (msg: Message, emoji: string) => void;
  onOpenContextMenu?: (msg: Message, isOut: boolean, x: number, y: number) => void;
  enableActions?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (msg: Message) => void;
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
    currentUsername,
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
    onToggleReaction,
    onOpenContextMenu,
    enableActions = false,
    selectionMode = false,
    isSelected = false,
    onToggleSelect,
  }) => {
    const [showReactionPicker, setShowReactionPicker] = useState(false);
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
      if (!message.content) return message.content;
      return renderChatRichText(message.content, {
        messageId: message.id,
        highlightConfig,
        currentUsername,
        isOut,
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
                  messageId: message.id,
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
    const activeReactions = Array.isArray(message.reactions)
      ? message.reactions.filter((r) => r && r.emoji && Array.isArray(r.userIds) && r.userIds.length > 0)
      : [];

    const handleBubbleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!enableActions || !onReplyMessage) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('a, button, audio, video, code, pre')) return;
      const selected = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
      if (selected && selected.trim().length > 0) return;
      onReplyMessage(message);
    };

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
          } ${selectionMode ? 'is-selection-mode' : ''} ${isSelected ? 'is-selected' : ''}`}
          onClick={
            selectionMode && onToggleSelect
              ? (event) => {
                  event.stopPropagation();
                  onToggleSelect(message);
                }
              : undefined
          }
          onDoubleClick={selectionMode ? undefined : handleBubbleDoubleClick}
          onMouseLeave={() => {
            if (showReactionPicker) setShowReactionPicker(false);
          }}
          onContextMenu={(event) => {
            if (selectionMode || !enableActions || !onOpenContextMenu) return;
            event.preventDefault();
            onOpenContextMenu(message, isOut, event.clientX, event.clientY);
          }}
        >
          {selectionMode && (
            <button
              type="button"
              className={`chat-history__select-box ${isSelected ? 'is-checked' : ''}`}
              aria-label={isSelected ? '取消选择该消息' : '选择该消息'}
              aria-pressed={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect?.(message);
              }}
            >
              {isSelected && <Check size={12} strokeWidth={3} />}
            </button>
          )}
          <div className={`chat-history__bubble-stack ${isOut ? 'is-out' : 'is-in'}`}>
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

            {activeReactions.length > 0 && (
              <div className={`chat-history__reactions ${isOut ? 'is-out' : 'is-in'}`}>
                {activeReactions.map((reaction) => {
                  const reactedByMe = reaction.userIds.includes(currentUserId);
                  return (
                    <button
                      key={reaction.emoji}
                      type="button"
                      className={`chat-history__reaction-pill ${reactedByMe ? 'is-mine' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleReaction?.(message, reaction.emoji);
                      }}
                      title={reactedByMe ? '取消此表情回应' : '添加同样表情回应'}
                    >
                      <span>{reaction.emoji}</span>
                      <span className="chat-history__reaction-count">{reaction.userIds.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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

          {enableActions && !selectionMode && !canRetry && (
            <div className="chat-history__hover-actions" aria-label="快捷消息操作">
              {onToggleReaction && (
                <div className="chat-history__reaction-trigger-wrap">
                  <button
                    type="button"
                    className="chat-history__hover-btn"
                    title="添加表情回应"
                    aria-label="添加表情回应"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowReactionPicker((prev) => !prev);
                    }}
                  >
                    <SmilePlus size={13} />
                  </button>
                  {showReactionPicker && (
                    <div className="chat-history__reaction-picker" onClick={(e) => e.stopPropagation()}>
                      {QUICK_REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="chat-history__reaction-pick-btn"
                          onClick={() => {
                            setShowReactionPicker(false);
                            onToggleReaction(message, emoji);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {onReplyMessage && (
                <button
                  type="button"
                  className="chat-history__hover-btn"
                  title="引用回复（也可双击气泡）"
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
