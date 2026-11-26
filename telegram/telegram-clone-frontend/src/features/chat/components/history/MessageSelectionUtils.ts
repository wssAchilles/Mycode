/**
 * 聊天消息多选格式化与筛选辅助纯函数
 */
import type { Message } from '../../../types/chat';

export function summarizeMessagePreview(msg: Message): string {
  const text = msg.content?.trim();
  if (text) return text;
  if (msg.type === 'image') return '[图片]';
  if (msg.type === 'video') return msg.fileName ? `[视频] ${msg.fileName}` : '[视频]';
  if (msg.type === 'audio') return msg.fileName ? `[语音] ${msg.fileName}` : '[语音]';
  if (msg.type === 'file' || msg.type === 'document') {
    return msg.fileName ? `[文件] ${msg.fileName}` : '[文件]';
  }
  return '[消息]';
}

export function formatMergedMessagesForCopy(
  messages: Message[],
  currentUserId: string,
  resolveSenderName?: (msg: Message) => string,
): string {
  const ordered = [...messages].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return ta - tb;
  });

  return ordered
    .map((msg) => {
      const isOut = msg.userId === currentUserId || msg.senderId === currentUserId;
      const sender = isOut
        ? '我'
        : resolveSenderName?.(msg) || msg.senderUsername || msg.username || '联系人';
      const date = new Date(msg.timestamp);
      const time = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const body = summarizeMessagePreview(msg);
      return time ? `[${sender} ${time}] ${body}` : `[${sender}] ${body}`;
    })
    .join('\n');
}
