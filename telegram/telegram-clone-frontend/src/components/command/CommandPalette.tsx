import React, { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useNavigate } from 'react-router-dom';
import { authUtils } from '../../services/apiClient';
import {
  HomeIcon,
  MessageIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
} from '../icons/SpaceIcons';
import './CommandPalette.css';

export const OPEN_COMMAND_PALETTE_EVENT = 'tg:open-command-palette';

export function openCommandPalette(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (!authUtils.isAuthenticated()) return;
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    const handleCustomOpen = () => {
      if (!authUtils.isAuthenticated()) return;
      setOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleCustomOpen);
    };
  }, []);

  // 未打开或未登录时不渲染任何面板 DOM，保持零常驻开销
  if (!open) {
    return null;
  }

  const currentUser = authUtils.getCurrentUser();
  const profilePath = currentUser?.id ? `/space/user/${currentUser.id}` : '/space';

  const runNavigation = (path: string, focusComposer = false) => {
    setOpen(false);
    navigate(path);
    if (focusComposer) {
      window.setTimeout(() => {
        const textarea = document.querySelector('.post-composer__textarea') as HTMLElement | null;
        textarea?.focus();
      }, 180);
    }
  };

  const handleRefreshPage = () => {
    setOpen(false);
    window.location.reload();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tg-command-overlay" />
        <DialogPrimitive.Content
          className="tg-command-dialog"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="tg-command-sr-only">
            全局指令面板
          </DialogPrimitive.Title>
          <Command label="全局指令面板">
            <div className="tg-command-header">
              <span className="tg-command-search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <Command.Input
                className="tg-command-input"
                placeholder="搜索页面或快捷指令…"
                autoFocus
              />
              <kbd className="tg-command-kbd">ESC</kbd>
            </div>

            <Command.List className="tg-command-list">
              <Command.Empty className="tg-command-empty">未找到匹配的页面或指令</Command.Empty>

              <Command.Group heading="页面导航" className="tg-command-group">
                <Command.Item
                  value="Space 首页 home feed"
                  onSelect={() => runNavigation('/space')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <HomeIcon />
                  </span>
                  <span className="tg-command-item-label">Space 首页</span>
                  <span className="tg-command-item-meta">动态流</span>
                </Command.Item>

                <Command.Item
                  value="探索发现 explore trends"
                  onSelect={() => runNavigation('/space?section=explore')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <SearchIcon />
                  </span>
                  <span className="tg-command-item-label">探索发现</span>
                  <span className="tg-command-item-meta">热搜与话题</span>
                </Command.Item>

                <Command.Item
                  value="消息中心 chat messages"
                  onSelect={() => runNavigation('/chat')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <MessageIcon />
                  </span>
                  <span className="tg-command-item-label">消息中心</span>
                  <span className="tg-command-item-meta">私聊与群组</span>
                </Command.Item>

                <Command.Item
                  value="个人主页 profile me"
                  onSelect={() => runNavigation(profilePath)}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <SparkIcon />
                  </span>
                  <span className="tg-command-item-label">个人主页</span>
                  <span className="tg-command-item-meta">
                    {currentUser?.username ? `@${currentUser.username}` : '我的主页'}
                  </span>
                </Command.Item>
              </Command.Group>

              <Command.Separator className="tg-command-separator" />

              <Command.Group heading="快捷操作" className="tg-command-group">
                <Command.Item
                  value="发布新动态 compose new post"
                  onSelect={() => runNavigation('/space', true)}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <PlusIcon />
                  </span>
                  <span className="tg-command-item-label">发布新动态</span>
                  <span className="tg-command-item-meta">聚焦编辑器</span>
                </Command.Item>

                <Command.Item
                  value="刷新当前页面 reload refresh"
                  onSelect={handleRefreshPage}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <polyline points="21 3 21 9 15 9" />
                    </svg>
                  </span>
                  <span className="tg-command-item-label">刷新当前页面</span>
                  <span className="tg-command-item-meta">同步最新内容</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default CommandPalette;
