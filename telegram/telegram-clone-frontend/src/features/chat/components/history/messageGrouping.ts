/**
 * 聊天消息分组与展示辅助纯函数
 * - 跨日分割线判断（formatChatDateDivider）
 * - 群聊 120 秒同发送者连续消息头像折叠
 * - 附件与引用消息判定
 */

import type { Message } from '../../../../types/chat';
import { formatChatDateDivider, isSameCalendarDay } from '../../../../utils/dateTime';

const GROUP_COLLAPSE_WINDOW_MS = 120_000;

export interface MessageRowVisualMeta {
  dateDividerLabel: string | null;
  collapseGroupSenderMeta: boolean;
}

/**
 * 计算单条消息在消息流中的日期分割与头像折叠状态
 */
export function computeMessageRowMeta(
  current: Message,
  previous: Message | null | undefined,
  now = new Date(),
): MessageRowVisualMeta {
  const curDate = current.timestamp ? new Date(current.timestamp) : null;
  const curValid = Boolean(curDate && Number.isFinite(curDate.getTime()));

  if (!previous) {
    return {
      dateDividerLabel: curValid && curDate ? formatChatDateDivider(curDate, now) : null,
      collapseGroupSenderMeta: false,
    };
  }

  const prevDate = previous.timestamp ? new Date(previous.timestamp) : null;
  const prevValid = Boolean(prevDate && Number.isFinite(prevDate.getTime()));
  const sameDay = Boolean(curValid && prevValid && curDate && prevDate && isSameCalendarDay(curDate, prevDate));

  const dateDividerLabel =
    !sameDay && curValid && curDate ? formatChatDateDivider(curDate, now) : null;

  let collapseGroupSenderMeta = false;
  if (sameDay && curDate && prevDate) {
    const curSender = String(current.senderId || current.userId || '');
    const prevSender = String(previous.senderId || previous.userId || '');
    const diffMs = Math.abs(curDate.getTime() - prevDate.getTime());
    if (curSender && prevSender && curSender === prevSender && diffMs <= GROUP_COLLAPSE_WINDOW_MS) {
      collapseGroupSenderMeta = true;
    }
  }

  return {
    dateDividerLabel,
    collapseGroupSenderMeta,
  };
}

/**
 * 判断消息是否应渲染为非图片附件卡片（文件 / 文档 / 音频 / 视频）
 */
export function isRichAttachmentMessage(msg: Message): boolean {
  const attachment = msg.attachments?.[0];
  const hasFile = Boolean(msg.fileUrl || attachment?.fileUrl);
  if (!hasFile) return false;
  return (
    msg.type === 'file'
    || msg.type === 'document'
    || msg.type === 'audio'
    || msg.type === 'video'
  );
}
