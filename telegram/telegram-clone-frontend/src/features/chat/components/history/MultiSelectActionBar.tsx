import React from 'react';
import { Copy, Forward, Trash2, X } from 'lucide-react';
import './MultiSelectActionBar.css';

interface MultiSelectActionBarProps {
  selectedCount: number;
  deletableCount: number;
  onForward: () => void;
  onCopyMerged: () => void;
  onDeleteSelected: () => void;
  onCancel: () => void;
}

export const MultiSelectActionBar: React.FC<MultiSelectActionBarProps> = ({
  selectedCount,
  deletableCount,
  onForward,
  onCopyMerged,
  onDeleteSelected,
  onCancel,
}) => {
  return (
    <div className="chat-multiselect-bar" role="region" aria-label="批量操作栏">
      <div className="chat-multiselect-bar__summary">
        <button
          type="button"
          className="chat-multiselect-bar__close"
          onClick={onCancel}
          aria-label="退出多选模式"
          title="退出多选 (Esc)"
        >
          <X size={16} />
        </button>
        <span className="chat-multiselect-bar__count">已选择 {selectedCount} 条消息</span>
      </div>

      <div className="chat-multiselect-bar__actions">
        <button
          type="button"
          className="chat-multiselect-bar__btn is-primary"
          disabled={selectedCount === 0}
          onClick={onForward}
        >
          <Forward size={15} />
          <span>转发</span>
        </button>
        <button
          type="button"
          className="chat-multiselect-bar__btn"
          disabled={selectedCount === 0}
          onClick={onCopyMerged}
        >
          <Copy size={15} />
          <span>合并复制</span>
        </button>
        <button
          type="button"
          className="chat-multiselect-bar__btn is-danger"
          disabled={deletableCount === 0}
          onClick={onDeleteSelected}
          title={deletableCount > 0 ? `撤回本人发出的 ${deletableCount} 条消息` : '仅支持撤回自己发送的消息'}
        >
          <Trash2 size={15} />
          <span>撤回{deletableCount > 0 ? ` (${deletableCount})` : ''}</span>
        </button>
      </div>
    </div>
  );
};
