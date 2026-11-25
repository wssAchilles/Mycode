import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  computeMessageRowMeta,
  isRichAttachmentMessage,
} from '../features/chat/components/history/messageGrouping';
import { ChatAttachmentCard } from '../features/chat/components/media/ChatAttachmentCard';
import { ChatImageLightbox } from '../features/chat/components/media/ChatImageLightbox';
import { MessageActionMenu } from '../features/chat/components/history/MessageActionMenu';
import type { Message } from '../types/chat';

function makeMsg(overrides: Partial<Message>): Message {
  return {
    id: 'm1',
    chatId: 'p:u1:u2',
    chatType: 'private',
    content: '你好',
    senderId: 'u1',
    senderUsername: 'alice',
    userId: 'u1',
    username: 'alice',
    timestamp: '2026-11-25T10:00:00.000Z',
    type: 'text',
    isGroupChat: false,
    status: 'read',
    ...overrides,
  };
}

describe('Phase 2 消息分组、附件卡片、灯箱与气泡菜单', () => {
  it('同一天且 120 秒内同一发送者在群聊中应折叠头像与发送者名称', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const prev = makeMsg({ id: 'm1', senderId: 'u1', timestamp: '2026-11-25T10:00:00.000Z' });
    const withinWindow = makeMsg({ id: 'm2', senderId: 'u1', timestamp: '2026-11-25T10:01:30.000Z' });
    const afterWindow = makeMsg({ id: 'm3', senderId: 'u1', timestamp: '2026-11-25T10:05:00.000Z' });
    const otherSender = makeMsg({ id: 'm4', senderId: 'u2', timestamp: '2026-11-25T10:01:10.000Z' });
    const nextDay = makeMsg({ id: 'm5', senderId: 'u1', timestamp: '2026-11-26T00:00:10.000Z' });

    const firstMeta = computeMessageRowMeta(prev, null, now);
    expect(firstMeta.dateDividerLabel).toBe('今天');
    expect(firstMeta.collapseGroupSenderMeta).toBe(false);

    const sameSenderMeta = computeMessageRowMeta(withinWindow, prev, now);
    expect(sameSenderMeta.dateDividerLabel).toBeNull();
    expect(sameSenderMeta.collapseGroupSenderMeta).toBe(true);

    const timeoutMeta = computeMessageRowMeta(afterWindow, prev, now);
    expect(timeoutMeta.collapseGroupSenderMeta).toBe(false);

    const diffSenderMeta = computeMessageRowMeta(otherSender, prev, now);
    expect(diffSenderMeta.collapseGroupSenderMeta).toBe(false);

    const crossDayMeta = computeMessageRowMeta(nextDay, prev, new Date('2026-11-26T10:00:00.000Z'));
    expect(crossDayMeta.dateDividerLabel).toBe('今天');
    expect(crossDayMeta.collapseGroupSenderMeta).toBe(false);
  });

  it('能识别非图片附件并正确渲染文件卡片', () => {
    const docMsg = makeMsg({
      type: 'document',
      content: '设计方案.pdf',
      fileUrl: '/uploads/plan.pdf',
      fileName: '设计方案.pdf',
      fileSize: 2048 * 1024,
    });
    const imgMsg = makeMsg({
      type: 'image',
      content: '[图片]',
      fileUrl: '/uploads/a.png',
    });

    expect(isRichAttachmentMessage(docMsg)).toBe(true);
    expect(isRichAttachmentMessage(imgMsg)).toBe(false);

    render(<ChatAttachmentCard message={docMsg} />);
    expect(screen.getByText('设计方案.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载 设计方案.pdf' })).toHaveAttribute(
      'href',
      expect.stringContaining('/uploads/plan.pdf'),
    );
  });

  it('图片灯箱支持展示原图并响应 Escape 关闭', () => {
    const onClose = vi.fn();
    render(<ChatImageLightbox src="/uploads/demo.jpg" fileName="demo.jpg" onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: '图片大图查看' });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('右键菜单对本人与对方消息展示差异化操作权限', () => {
    const onCopy = vi.fn();
    const onReply = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onRetry = vi.fn();
    const onClose = vi.fn();

    const incomingMsg = makeMsg({ id: 'm_in', senderId: 'u2', userId: 'u2', content: '对方消息' });
    const { rerender } = render(
      <MessageActionMenu
        message={incomingMsg}
        isOut={false}
        x={100}
        y={100}
        onClose={onClose}
        onCopy={onCopy}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('menuitem', { name: '引用回复' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制文字' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '编辑消息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '撤回消息' })).not.toBeInTheDocument();

    const outgoingMsg = makeMsg({ id: 'm_out', status: 'read', content: '我的消息' });
    rerender(
      <MessageActionMenu
        message={outgoingMsg}
        isOut
        x={100}
        y={100}
        onClose={onClose}
        onCopy={onCopy}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: '编辑消息' }));
    expect(onEdit).toHaveBeenCalledWith(outgoingMsg);
    expect(onClose).toHaveBeenCalled();

    expect(screen.getByRole('menuitem', { name: '撤回消息' })).toBeInTheDocument();
  });
});
