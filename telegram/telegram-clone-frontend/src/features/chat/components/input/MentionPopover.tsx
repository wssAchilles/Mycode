import React from 'react';
import { Avatar } from '../../../../components/common';
import './MentionPopover.css';

export interface MentionCandidate {
  userId: string;
  username: string;
  avatarUrl?: string;
  role?: 'owner' | 'admin' | 'member' | string;
}

interface MentionPopoverProps {
  open: boolean;
  candidates: MentionCandidate[];
  activeIndex: number;
  onSelect: (candidate: MentionCandidate) => void;
}

function formatRoleLabel(role?: string): string | null {
  if (role === 'owner') return '群主';
  if (role === 'admin') return '管理员';
  if (role === 'all') return '全体成员';
  return null;
}

/**
 * 群聊输入框 @成员 自动补全浮层
 */
export const MentionPopover: React.FC<MentionPopoverProps> = ({
  open,
  candidates,
  activeIndex,
  onSelect,
}) => {
  if (!open || candidates.length === 0) return null;

  return (
    <div className="tg-mention-popover" role="listbox" aria-label="选择要提及的群成员">
      <div className="tg-mention-popover__header">提及群成员</div>
      <div className="tg-mention-popover__list">
        {candidates.map((candidate, index) => {
          const isActive = index === activeIndex;
          const roleLabel = formatRoleLabel(candidate.role);
          return (
            <button
              key={candidate.userId}
              type="button"
              role="option"
              aria-selected={isActive}
              className={`tg-mention-popover__item ${isActive ? 'is-active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(candidate);
              }}
            >
              <Avatar
                name={candidate.username}
                src={candidate.avatarUrl}
                size="sm"
              />
              <span className="tg-mention-popover__name">@{candidate.username}</span>
              {roleLabel && (
                <span className={`tg-mention-popover__role is-${candidate.role || 'member'}`}>
                  {roleLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MentionPopover;
