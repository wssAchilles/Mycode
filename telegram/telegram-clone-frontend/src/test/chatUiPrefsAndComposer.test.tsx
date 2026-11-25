import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MessageInput from '../features/chat/components/MessageInput';
import { useChatUiPrefsStore } from '../features/chat/state/chatUiPrefsStore';

describe('Phase 1 输入法拦截、草稿隔离与附件预览', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useChatUiPrefsStore.getState().resetPrefs();
    useChatUiPrefsStore.getState().hydrateForUser('user-a');
  });

  it('按 userId 隔离保存会话草稿、置顶与免打扰状态', () => {
    const store = useChatUiPrefsStore.getState();
    store.setDraft('chat-1', '你好草稿');
    expect(store.togglePinChat('chat-1')).toBe(true);
    expect(store.toggleMuteChat('chat-2')).toBe(true);

    // 切换到 user-b 应隔离状态
    store.hydrateForUser('user-b');
    expect(useChatUiPrefsStore.getState().draftByChatId).toEqual({});
    expect(useChatUiPrefsStore.getState().pinnedChatIds).toEqual([]);

    // 切回 user-a 应恢复先前记录
    store.hydrateForUser('user-a');
    expect(useChatUiPrefsStore.getState().draftByChatId['chat-1']).toBe('你好草稿');
    expect(useChatUiPrefsStore.getState().pinnedChatIds).toEqual(['chat-1']);
    expect(useChatUiPrefsStore.getState().mutedChatIds).toEqual(['chat-2']);
  });

  it('拦截中文输入法组词阶段回车误发送，正常回车发送后清理草稿', () => {
    const onSend = vi.fn();
    const onUpload = vi.fn();
    render(
      <MessageInput
        chatId="chat-1"
        onSendMessage={onSend}
        onFileUpload={onUpload}
        isConnected
      />,
    );

    const textarea = screen.getByLabelText('输入消息内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'nihao' } });
    expect(useChatUiPrefsStore.getState().draftByChatId['chat-1']).toBe('nihao');

    // 模拟中文输入法选词回车（isComposing = true / keyCode = 229）
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    // Shift+Enter 不触发发送
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    // 正常输入完成后回车发送
    fireEvent.change(textarea, { target: { value: '你好世界' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('你好世界');
    expect(useChatUiPrefsStore.getState().draftByChatId['chat-1']).toBeUndefined();
  });

  it('切换 chatId 时自动恢复对应会话草稿', () => {
    useChatUiPrefsStore.getState().setDraft('chat-2', '待发送的草稿');
    const { rerender } = render(
      <MessageInput
        chatId="chat-1"
        onSendMessage={vi.fn()}
        onFileUpload={vi.fn()}
        isConnected
      />,
    );

    const textarea = screen.getByLabelText('输入消息内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');

    rerender(
      <MessageInput
        chatId="chat-2"
        onSendMessage={vi.fn()}
        onFileUpload={vi.fn()}
        isConnected
      />,
    );
    expect((screen.getByLabelText('输入消息内容') as HTMLTextAreaElement).value).toBe('待发送的草稿');
  });

  it('粘贴图片文件先生成待发送预览卡片，用户确认后再提交上传并附带文字', () => {
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const onSend = vi.fn();
    const onUpload = vi.fn();

    render(
      <MessageInput
        chatId="chat-1"
        onSendMessage={onSend}
        onFileUpload={onUpload}
        isConnected
      />,
    );

    const textarea = screen.getByLabelText('输入消息内容') as HTMLTextAreaElement;
    const file = new File(['mock-png'], 'screenshot.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: '请查收截图' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith(file, '请查收截图');
    expect(onSend).not.toHaveBeenCalled();

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });
});
