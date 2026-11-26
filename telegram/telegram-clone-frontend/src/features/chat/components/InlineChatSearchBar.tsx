import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import './InlineChatSearchBar.css';

interface InlineChatSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  totalMatches: number;
  activeIndex: number;
  onStep: (delta: number) => void;
  onSearchRemote?: () => void;
  onClose: () => void;
}

export const InlineChatSearchBar: React.FC<InlineChatSearchBarProps> = ({
  query,
  onQueryChange,
  totalMatches,
  activeIndex,
  onStep,
  onSearchRemote,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const hasQuery = query.trim().length > 0;
  const counterLabel = !hasQuery
    ? '输入关键词定位'
    : totalMatches > 0
      ? `${activeIndex + 1} / ${totalMatches}`
      : '暂无本地匹配';

  return (
    <div className="inline-chat-search" role="search" aria-label="会话内快速搜索">
      <div className="inline-chat-search__field">
        <Search size={14} className="inline-chat-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="inline-chat-search__input"
          value={query}
          placeholder="在当前对话中查找（Enter 下一条，Shift+Enter 上一条）..."
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (totalMatches > 0) {
                onStep(e.shiftKey ? -1 : 1);
              } else if (hasQuery) {
                onSearchRemote?.();
              }
            }
          }}
        />
        <span className="inline-chat-search__counter">{counterLabel}</span>
      </div>

      <div className="inline-chat-search__actions">
        <button
          type="button"
          className="inline-chat-search__btn"
          disabled={totalMatches === 0}
          onClick={() => onStep(-1)}
          aria-label="上一条匹配消息"
          title="上一条 (Shift+Enter)"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          className="inline-chat-search__btn"
          disabled={totalMatches === 0}
          onClick={() => onStep(1)}
          aria-label="下一条匹配消息"
          title="下一条 (Enter)"
        >
          <ChevronDown size={15} />
        </button>
        {hasQuery && onSearchRemote && (
          <button
            type="button"
            className="inline-chat-search__remote-btn"
            onClick={onSearchRemote}
            title="在云端更早历史记录中检索"
          >
            搜全量历史
          </button>
        )}
        <button
          type="button"
          className="inline-chat-search__btn"
          onClick={onClose}
          aria-label="关闭会话搜索"
          title="关闭 (Esc)"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
