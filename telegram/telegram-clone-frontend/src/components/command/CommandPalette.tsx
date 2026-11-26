import React, { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useNavigate } from 'react-router-dom';
import { Bell, Bot, Keyboard, Monitor, Moon, Sun, Volume2, VolumeX } from 'lucide-react';
import { authUtils } from '../../services/apiClient';
import { useChatStore } from '../../features/chat/store/chatStore';
import { useChatUiPrefsStore } from '../../features/chat/state/chatUiPrefsStore';
import { formatThemeModeLabel, useThemeStore } from '../../core/theme/themeStore';
import { showToast } from '../ui/Toast';
import { openShortcutHelp } from './ShortcutHelpModal';
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

  const chats = useChatStore((state) => state.chats);
  const contacts = useChatStore((state) => state.contacts);
  const selectContact = useChatStore((state) => state.selectContact);
  const loadGroupDetails = useChatStore((state) => state.loadGroupDetails);
  const soundEnabled = useChatUiPrefsStore((state) => state.soundEnabled);
  const setSoundEnabled = useChatUiPrefsStore((state) => state.setSoundEnabled);
  const themeMode = useThemeStore((state) => state.mode);
  const cycleThemeMode = useThemeStore((state) => state.cycleMode);

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

  const handleOpenChatItem = (chatId: string, isGroup: boolean) => {
    setOpen(false);
    if (isGroup) {
      void loadGroupDetails(chatId);
    } else {
      const contact = contacts.find((c) => c.userId === chatId) || null;
      selectContact(contact);
    }
    navigate('/chat');
  };

  const handleCycleTheme = () => {
    const next = cycleThemeMode();
    showToast(`已切换为${formatThemeModeLabel(next)}`, 'info');
    setOpen(false);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    showToast(next ? '已开启新消息提示音' : '已关闭新消息提示音', 'info');
    setOpen(false);
  };

  const handleOpenShortcutHelp = () => {
    setOpen(false);
    openShortcutHelp();
  };

  const handleRefreshPage = () => {
    setOpen(false);
    window.location.reload();
  };

  const visibleChats = chats.slice(0, 8);

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
                placeholder="搜索会话、页面或快捷指令…"
                autoFocus
              />
              <kbd className="tg-command-kbd">ESC</kbd>
            </div>

            <Command.List className="tg-command-list">
              <Command.Empty className="tg-command-empty">未找到匹配的会话、页面或指令</Command.Empty>

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
                  value="探索发现 explore trends search"
                  onSelect={() => runNavigation('/space?section=explore')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <SearchIcon />
                  </span>
                  <span className="tg-command-item-label">探索发现</span>
                  <span className="tg-command-item-meta">热搜、话题与找人</span>
                </Command.Item>

                <Command.Item
                  value="动态通知 notifications"
                  onSelect={() => runNavigation('/space?section=notifications')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <Bell size={16} />
                  </span>
                  <span className="tg-command-item-label">动态通知</span>
                  <span className="tg-command-item-meta">点赞、回复与转发</span>
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
                  value="AI 智能助手 bot assistant chat"
                  onSelect={() => runNavigation('/chat?ai=1')}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <Bot size={16} />
                  </span>
                  <span className="tg-command-item-label">AI 智能助手</span>
                  <span className="tg-command-item-meta">对话与图片解析</span>
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

              {visibleChats.length > 0 && (
                <>
                  <Command.Separator className="tg-command-separator" />
                  <Command.Group heading="直达会话" className="tg-command-group">
                    {visibleChats.map((chat) => (
                      <Command.Item
                        key={chat.id}
                        value={`${chat.title} ${chat.isGroup ? '群聊 group' : '私聊 dm chat'} ${chat.id}`}
                        onSelect={() => handleOpenChatItem(chat.id, chat.isGroup)}
                        className="tg-command-item"
                      >
                        <span className="tg-command-item-icon" aria-hidden="true">
                          <MessageIcon />
                        </span>
                        <span className="tg-command-item-label">{chat.title}</span>
                        <span className="tg-command-item-meta">
                          {chat.isGroup ? '群聊' : '私聊'}
                          {chat.unreadCount > 0 ? ` · ${chat.unreadCount} 未读` : ''}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              )}

              <Command.Separator className="tg-command-separator" />

              <Command.Group heading="效率与设置" className="tg-command-group">
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
                  value="切换外观主题 浅色 深色 系统 theme dark light system"
                  onSelect={handleCycleTheme}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    {themeMode === 'dark' ? (
                      <Moon size={16} />
                    ) : themeMode === 'light' ? (
                      <Sun size={16} />
                    ) : (
                      <Monitor size={16} />
                    )}
                  </span>
                  <span className="tg-command-item-label">切换外观主题</span>
                  <span className="tg-command-item-meta">当前：{formatThemeModeLabel(themeMode)}</span>
                </Command.Item>

                <Command.Item
                  value="开关消息提示音 静音 sound mute notification"
                  onSelect={handleToggleSound}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </span>
                  <span className="tg-command-item-label">
                    {soundEnabled ? '关闭新消息提示音' : '开启新消息提示音'}
                  </span>
                  <span className="tg-command-item-meta">{soundEnabled ? '已开启' : '已静音'}</span>
                </Command.Item>

                <Command.Item
                  value="键盘快捷键 帮助 shortcut help"
                  onSelect={handleOpenShortcutHelp}
                  className="tg-command-item"
                >
                  <span className="tg-command-item-icon" aria-hidden="true">
                    <Keyboard size={16} />
                  </span>
                  <span className="tg-command-item-label">键盘快捷键指南</span>
                  <span className="tg-command-item-meta">按 ? 呼出</span>
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
