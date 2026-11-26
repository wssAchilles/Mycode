import React, { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Keyboard, X } from 'lucide-react';
import './ShortcutHelpModal.css';

export const OPEN_SHORTCUT_HELP_EVENT = 'tg:open-shortcut-help';

export function openShortcutHelp(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_SHORTCUT_HELP_EVENT));
}

interface ShortcutRow {
  keys: string[];
  label: string;
}

const SHORTCUT_GROUPS: Array<{ title: string; items: ShortcutRow[] }> = [
  {
    title: '全局效率操作',
    items: [
      { keys: ['⌘ / Ctrl', 'K'], label: '打开全局命令与会话搜索面板' },
      { keys: ['?'], label: '查看当前键盘快捷键指南' },
      { keys: ['Esc'], label: '关闭当前弹窗、灯箱或搜索模式' },
    ],
  },
  {
    title: '聊天与消息会话',
    items: [
      { keys: ['⌘ / Ctrl', 'F'], label: '在当前聊天上下文中搜索消息' },
      { keys: ['Enter'], label: '发送当前消息或附件' },
      { keys: ['Shift', 'Enter'], label: '在输入框内换行' },
      { keys: ['↑'], label: '输入为空时快速编辑上一条消息' },
      { keys: ['@'], label: '群聊中呼出 @成员 补全菜单' },
      { keys: ['双击气泡'], label: '快捷引用回复对应消息' },
    ],
  },
  {
    title: 'Space 动态与阅读',
    items: [
      { keys: ['J', 'K'], label: '在首页信息流逐条上下移动聚焦动态' },
      { keys: ['L'], label: '点赞 / 取消赞当前聚焦动态' },
      { keys: ['B'], label: '收藏 / 取消收藏当前聚焦动态' },
      { keys: ['C'], label: '打开当前聚焦动态的评论抽屉' },
      { keys: ['N'], label: '快速打开独立发布动态窗口' },
      { keys: ['R'], label: '静默刷新首页动态列表' },
      { keys: ['⌘ / Ctrl', 'Enter'], label: '在动态编辑器直接发布' },
      { keys: ['←', '→'], label: '大图灯箱内切换上一张 / 下一张' },
    ],
  },
];

export const ShortcutHelpModal: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== '?' && !(event.shiftKey && event.key === '/')) return;

      const target = event.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setOpen((prev) => !prev);
    };

    const handleCustomOpen = () => setOpen(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(OPEN_SHORTCUT_HELP_EVENT, handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(OPEN_SHORTCUT_HELP_EVENT, handleCustomOpen);
    };
  }, []);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="tg-shortcut-overlay" />
        <Dialog.Content className="tg-shortcut-dialog" aria-describedby={undefined}>
          <div className="tg-shortcut-header">
            <div className="tg-shortcut-title-wrap">
              <Keyboard size={18} />
              <Dialog.Title className="tg-shortcut-title">桌面端键盘快捷键</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="tg-shortcut-close" aria-label="关闭快捷键指南">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="tg-shortcut-body">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} className="tg-shortcut-group">
                <h3 className="tg-shortcut-group-title">{group.title}</h3>
                <div className="tg-shortcut-list">
                  {group.items.map((item) => (
                    <div key={item.label} className="tg-shortcut-row">
                      <span className="tg-shortcut-label">{item.label}</span>
                      <span className="tg-shortcut-keys">
                        {item.keys.map((key) => (
                          <kbd key={key} className="tg-shortcut-kbd">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ShortcutHelpModal;
