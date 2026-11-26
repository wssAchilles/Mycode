import React from 'react';
import { Pin, X } from 'lucide-react';
import type { PinnedMessageEntry } from '../../state/chatUiPrefsStore';
import './PinnedMessageBanner.css';

interface PinnedMessageBannerProps {
  pinned: PinnedMessageEntry;
  onJump: (messageId: string) => void;
  onUnpin: () => void;
}

export const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({
  pinned,
  onJump,
  onUnpin,
}) => {
  return (
    <div className="chat-pinned-banner" role="region" aria-label="置顶消息">
      <button
        type="button"
        className="chat-pinned-banner__main"
        onClick={() => onJump(pinned.id)}
        title="点击跳转定位至该置顶消息"
      >
        <span className="chat-pinned-banner__icon" aria-hidden="true">
          <Pin size={14} />
        </span>
        <div className="chat-pinned-banner__copy">
          <div className="chat-pinned-banner__label">置顶消息 · {pinned.senderName}</div>
          <div className="chat-pinned-banner__preview">{pinned.content}</div>
        </div>
      </button>
      <button
        type="button"
        className="chat-pinned-banner__close"
        aria-label="取消置顶"
        title="取消置顶"
        onClick={onUnpin}
      >
        <X size={14} />
      </button>
    </div>
  );
};
