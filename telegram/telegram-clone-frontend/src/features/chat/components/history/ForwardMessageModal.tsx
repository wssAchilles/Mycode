import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, Send, Users, X } from 'lucide-react';
import { Avatar } from '../../../../components/common';
import type { Chat, Contact } from '../../types';
import './ForwardMessageModal.css';

export interface ForwardTarget {
  id: string;
  title: string;
  avatarUrl?: string;
  isGroup: boolean;
}

interface ForwardMessageModalProps {
  isOpen: boolean;
  messageCount: number;
  previewText: string;
  chats: Chat[];
  contacts: Contact[];
  onClose: () => void;
  onConfirmForward: (targets: ForwardTarget[]) => Promise<void>;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  messageCount,
  previewText,
  chats,
  contacts,
  onClose,
  onConfirmForward,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setKeyword('');
    setSelectedIds([]);
    setSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, submitting]);

  const targets = useMemo<ForwardTarget[]>(() => {
    const map = new Map<string, ForwardTarget>();
    for (const chat of chats) {
      if (!chat.id || chat.id === 'ai') continue;
      map.set(chat.id, {
        id: chat.id,
        title: chat.title,
        avatarUrl: chat.avatarUrl,
        isGroup: Boolean(chat.isGroup),
      });
    }
    for (const contact of contacts) {
      if (!contact.userId || map.has(contact.userId)) continue;
      map.set(contact.userId, {
        id: contact.userId,
        title: contact.alias || contact.username,
        avatarUrl: contact.avatarUrl,
        isGroup: false,
      });
    }
    const list = Array.from(map.values());
    const q = keyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => item.title.toLowerCase().includes(q));
  }, [chats, contacts, keyword]);

  if (!isOpen) return null;

  const toggleTarget = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0 || submitting) return;
    const targetMap = new Map(targets.map((t) => [t.id, t]));
    // 支持保留搜索切换前选中的对象
    for (const chat of chats) {
      if (!targetMap.has(chat.id)) {
        targetMap.set(chat.id, {
          id: chat.id,
          title: chat.title,
          avatarUrl: chat.avatarUrl,
          isGroup: Boolean(chat.isGroup),
        });
      }
    }
    for (const contact of contacts) {
      if (!targetMap.has(contact.userId)) {
        targetMap.set(contact.userId, {
          id: contact.userId,
          title: contact.alias || contact.username,
          avatarUrl: contact.avatarUrl,
          isGroup: false,
        });
      }
    }
    const chosen = selectedIds
      .map((id) => targetMap.get(id))
      .filter((t): t is ForwardTarget => Boolean(t));
    if (chosen.length === 0) return;

    setSubmitting(true);
    try {
      await onConfirmForward(chosen);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="forward-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="转发消息"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="forward-modal">
        <header className="forward-modal__header">
          <div>
            <h3 className="forward-modal__title">转发 {messageCount} 条消息</h3>
            <p className="forward-modal__subtitle">{previewText}</p>
          </div>
          <button
            type="button"
            className="forward-modal__close"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭转发窗口"
          >
            <X size={18} />
          </button>
        </header>

        <div className="forward-modal__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索联系人或群聊..."
            autoFocus
          />
        </div>

        <div className="forward-modal__list" role="listbox" aria-label="转发目标会话">
          {targets.length === 0 ? (
            <div className="forward-modal__empty">未找到匹配的联系人或群聊</div>
          ) : (
            targets.map((target) => {
              const checked = selectedIds.includes(target.id);
              return (
                <button
                  key={target.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`forward-modal__item ${checked ? 'is-selected' : ''}`}
                  onClick={() => toggleTarget(target.id)}
                >
                  <Avatar src={target.avatarUrl} name={target.title} size="sm" />
                  <div className="forward-modal__item-info">
                    <span className="forward-modal__item-name">{target.title}</span>
                    {target.isGroup && (
                      <span className="forward-modal__item-badge">
                        <Users size={11} /> 群聊
                      </span>
                    )}
                  </div>
                  <span className={`forward-modal__check ${checked ? 'is-checked' : ''}`} aria-hidden="true">
                    {checked && <Check size={13} strokeWidth={2.5} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <footer className="forward-modal__footer">
          <button
            type="button"
            className="forward-modal__btn ghost"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="forward-modal__btn primary"
            disabled={selectedIds.length === 0 || submitting}
            onClick={() => void handleConfirm()}
          >
            <Send size={14} />
            <span>{submitting ? '发送中...' : `发送至 ${selectedIds.length} 个会话`}</span>
          </button>
        </footer>
      </div>
    </div>
  );
};
