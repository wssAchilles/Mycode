import React, { useEffect } from 'react';
import { CheckSquare, Copy, Edit3, Forward, Pin, Reply, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import type { Message } from '../../../../types/chat';
import './MessageActionMenu.css';

interface MessageActionMenuProps {
  message: Message;
  isOut: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onCopy: (msg: Message) => void;
  onReply: (msg: Message) => void;
  onForward?: (msg: Message) => void;
  onMultiSelect?: (msg: Message) => void;
  onPin?: (msg: Message) => void;
  onAskAi?: (msg: Message) => void;
  onEdit: (msg: Message) => void;
  onDelete: (msg: Message) => void;
  onRetry: (msg: Message) => void;
}

export const MessageActionMenu: React.FC<MessageActionMenuProps> = ({
  message,
  isOut,
  x,
  y,
  onClose,
  onCopy,
  onReply,
  onForward,
  onMultiSelect,
  onPin,
  onAskAi,
  onEdit,
  onDelete,
  onRetry,
}) => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOutside = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const canCopy = Boolean(message.content && message.content.trim());
  const canEdit = isOut && message.type === 'text' && message.status !== 'failed' && message.status !== 'pending';
  const canDelete = isOut && message.status !== 'pending' && message.status !== 'failed';
  const canRetry = isOut && message.status === 'failed';

  return (
    <div
      className="msg-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="消息操作菜单"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {canRetry && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onRetry(message);
            onClose();
          }}
        >
          <RotateCw size={14} />
          <span>重新发送</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="msg-context-menu__item"
        onClick={() => {
          onReply(message);
          onClose();
        }}
      >
        <Reply size={14} />
        <span>引用回复</span>
      </button>
      {onForward && message.status !== 'failed' && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onForward(message);
            onClose();
          }}
        >
          <Forward size={14} />
          <span>转发消息</span>
        </button>
      )}
      {onPin && message.status !== 'failed' && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onPin(message);
            onClose();
          }}
        >
          <Pin size={14} />
          <span>置顶消息</span>
        </button>
      )}
      {onMultiSelect && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onMultiSelect(message);
            onClose();
          }}
        >
          <CheckSquare size={14} />
          <span>多选消息</span>
        </button>
      )}
      {canCopy && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onCopy(message);
            onClose();
          }}
        >
          <Copy size={14} />
          <span>复制文字</span>
        </button>
      )}
      {canCopy && onAskAi && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onAskAi(message);
            onClose();
          }}
        >
          <Sparkles size={14} />
          <span>问 AI 解释/翻译</span>
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item"
          onClick={() => {
            onEdit(message);
            onClose();
          }}
        >
          <Edit3 size={14} />
          <span>编辑消息</span>
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          role="menuitem"
          className="msg-context-menu__item is-danger"
          onClick={() => {
            onDelete(message);
            onClose();
          }}
        >
          <Trash2 size={14} />
          <span>撤回消息</span>
        </button>
      )}
    </div>
  );
};

export default MessageActionMenu;
